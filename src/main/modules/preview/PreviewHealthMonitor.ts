/**
 * 内置浏览器页面健康监控
 *
 * 采集 webview 内页面的运行状况，供工具栏状态灯与 AI 调试回路读取：
 * - 控制台 warning / error（console-message）
 * - 主文档加载失败（did-fail-load）
 * - 子资源加载失败（session.webRequest.onErrorOccurred）
 * - 白屏检测（did-finish-load 后采样页面像素）
 * - 渲染进程崩溃（render-process-gone）
 *
 * 关联方式：渲染进程在 webview 就绪后上报 guest webContents id，这里据此
 * 把 guest 事件归到具体预览会话，并把快照推回该会话所在窗口。
 *
 * 两处必要的收敛：
 * - 推送节拍：dev server 报错时控制台会瞬间刷出上百条，逐条推送会让渲染进程
 *   反复重建会话状态；同一节拍内的多条记录合并成一次 IPC。
 * - 记录上限：长时间运行的页面会持续累积错误，数组按 FIFO 截断。
 */

import { webContents } from 'electron'
import type { Session, WebContents } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'
import {
    PREVIEW_HEALTH_CHANNEL,
    type PreviewConsoleEntry,
    type PreviewConsoleLevel,
    type PreviewHealthLevel,
    type PreviewHealthSnapshot,
    type PreviewLoadFailure,
    type PreviewNetworkEntry,
} from '@shared/protocols/previewProtocol'

/** 单会话保留的控制台记录上限（超出后丢弃最早的） */
const MAX_CONSOLE_ENTRIES = 50
/** 单会话保留的加载失败记录上限 */
const MAX_LOAD_FAILURES = 20

/** 状态推送节拍：同一节拍内的多条记录合并为一次 IPC */
const PUSH_INTERVAL_MS = 250

/** 白屏检测延迟：等待首帧渲染与异步内容就绪 */
const BLANK_CHECK_DELAY_MS = 700
/** 白屏采样边长，40 像素足以判断页面是否接近纯色 */
const BLANK_SAMPLE_SIZE = 40
/** 主导色占比阈值：超过该比例认为页面几乎没有可见内容 */
const BLANK_DOMINANT_RATIO = 0.995
/** 主导色判定的通道容差（0-255） */
const BLANK_CHANNEL_TOLERANCE = 6

/** 单次采集的资源条数上限 */
const MAX_NETWORK_ENTRIES = 200

/** ERR_ABORTED：导航被重定向或被新导航打断，不是真实故障 */
const ERR_ABORTED = -3

/**
 * 资源瀑布采集脚本
 *
 * 读取页面自身的 Performance API，不改动页面状态、不注入依赖。
 * 只在排查问题时按需执行，不常驻。
 */
const RESOURCE_TIMING_PROBE = `(() => {
  try {
    const entries = performance.getEntriesByType('resource') || []
    return JSON.stringify(entries.slice(-${MAX_NETWORK_ENTRIES}).map((entry) => ({
      url: entry.name,
      type: entry.initiatorType || 'other',
      duration: Math.round(entry.duration || 0),
      size: entry.transferSize || 0,
      status: entry.responseStatus || 0
    })))
  } catch (error) {
    return '[]'
  }
})()`

interface SessionRecord {
    sessionId: string
    guestId: number
    /** 承载该 webview 的窗口 contents，用于回推健康状态 */
    owner: WebContents
    url: string
    consoleMessages: PreviewConsoleEntry[]
    loadFailures: PreviewLoadFailure[]
    blank: boolean
    crashed: boolean
    errorCount: number
    cleanups: Array<() => void>
    blankTimer: ReturnType<typeof setTimeout> | null
    pushTimer: ReturnType<typeof setTimeout> | null
    updatedAt: number
}

/** 归一化后的控制台载荷 */
type NormalizedConsolePayload = Pick<PreviewConsoleEntry, 'level' | 'message' | 'line' | 'source'>

/**
 * 判定健康等级
 *
 * 入参只取判定所需的字段，便于脱离 Electron 运行环境单独验证。
 */
export function computeHealthLevel(input: {
    crashed: boolean
    loadFailures: PreviewLoadFailure[]
    consoleMessages: PreviewConsoleEntry[]
    blank: boolean
}): PreviewHealthLevel {
    if (input.crashed) return 'error'
    if (input.loadFailures.length > 0) return 'error'
    if (input.consoleMessages.some((entry) => entry.level === 'error')) return 'error'
    if (input.consoleMessages.length > 0 || input.blank) return 'warning'
    return 'healthy'
}

/** 把 Electron 各版本的 console level 表示统一为内部枚举 */
export function toConsoleLevel(raw: unknown): PreviewConsoleLevel | null {
    if (typeof raw === 'string') {
        if (raw === 'error') return 'error'
        if (raw === 'warning' || raw === 'warn') return 'warning'
        return null
    }
    if (typeof raw === 'number') {
        // 旧签名：0 verbose / 1 info / 2 warning / 3 error
        if (raw === 3) return 'error'
        if (raw === 2) return 'warning'
        return null
    }
    return null
}

/**
 * 归一化 console-message 事件载荷
 *
 * Electron 32 起该事件改为 (event, details)，此前是 (event, level, message, line, sourceId)。
 * 两种签名都接住，避免升级 Electron 后静默失效。args 已剔除 event 本身。
 */
export function normalizeConsolePayload(args: unknown[]): NormalizedConsolePayload | null {
    const [second, third, fourth, fifth] = args

    let rawLevel: unknown
    let message = ''
    let line = 0
    let source = ''

    if (second && typeof second === 'object') {
        const details = second as {
            level?: unknown
            message?: unknown
            lineNumber?: unknown
            sourceId?: unknown
        }
        rawLevel = details.level
        message = typeof details.message === 'string' ? details.message : ''
        line = typeof details.lineNumber === 'number' ? details.lineNumber : 0
        source = typeof details.sourceId === 'string' ? details.sourceId : ''
    } else {
        rawLevel = second
        message = typeof third === 'string' ? third : ''
        line = typeof fourth === 'number' ? fourth : 0
        source = typeof fifth === 'string' ? fifth : ''
    }

    const level = toConsoleLevel(rawLevel)
    if (!level || !message) return null

    return { level, message, line, source }
}

/**
 * 判断页面是否白屏
 *
 * 采样缩略图的像素并统计主导色占比：几乎全是同一种颜色说明页面没有渲染出
 * 可见内容。capturePage 在窗口最小化或被完全遮挡时会失败，此时返回 false ——
 * 宁可漏报也不误报。
 */
export function isBlankBitmap(bitmap: Buffer): boolean {
    const total = bitmap.length / 4
    if (total === 0) return false

    // 以左上角像素为基准色（页面背景通常就在这个位置）
    const baseB = bitmap[0]
    const baseG = bitmap[1]
    const baseR = bitmap[2]
    const baseA = bitmap[3]

    let same = 0
    for (let i = 0; i < bitmap.length; i += 4) {
        if (
            Math.abs(bitmap[i] - baseB) <= BLANK_CHANNEL_TOLERANCE &&
            Math.abs(bitmap[i + 1] - baseG) <= BLANK_CHANNEL_TOLERANCE &&
            Math.abs(bitmap[i + 2] - baseR) <= BLANK_CHANNEL_TOLERANCE &&
            Math.abs(bitmap[i + 3] - baseA) <= BLANK_CHANNEL_TOLERANCE
        ) {
            same++
        }
    }

    return same / total >= BLANK_DOMINANT_RATIO
}

async function detectBlank(guest: WebContents): Promise<boolean> {
    try {
        const image = await guest.capturePage()
        if (image.isEmpty()) return false

        const bitmap = image
            .resize({ width: BLANK_SAMPLE_SIZE, height: BLANK_SAMPLE_SIZE, quality: 'good' })
            .toBitmap()

        return isBlankBitmap(bitmap)
    } catch {
        return false
    }
}

/** 解析页面回传的资源瀑布 JSON */
export function parseNetworkEntries(raw: unknown): PreviewNetworkEntry[] {
    if (typeof raw !== 'string' || !raw) return []

    try {
        const parsed = JSON.parse(raw) as unknown
        if (!Array.isArray(parsed)) return []

        return parsed
            .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
            .map((item) => ({
                url: typeof item.url === 'string' ? item.url : '',
                type: typeof item.type === 'string' ? item.type : 'other',
                duration: typeof item.duration === 'number' ? item.duration : 0,
                size: typeof item.size === 'number' ? item.size : 0,
                status: typeof item.status === 'number' ? item.status : 0,
            }))
            .filter((entry) => Boolean(entry.url))
    } catch {
        return []
    }
}

class PreviewHealthMonitor {
    private readonly recordsByGuest = new Map<number, SessionRecord>()
    private readonly guestBySession = new Map<string, number>()
    /** 已挂载 webRequest 监听的 session：同一 session 只能挂一份 */
    private readonly watchedSessions = new Set<Session>()

    /**
     * 绑定一个 webview guest 到预览会话
     *
     * @param guestId guest webContents id（渲染进程由 webview.getWebContentsId() 取得）
     * @param sessionId 预览会话 id
     * @param url 当前会话地址
     * @param owner 承载 webview 的窗口 contents
     * @returns 绑定后的初始快照；guest 不可用时返回 null
     */
    attach(guestId: number, sessionId: string, url: string, owner: WebContents): PreviewHealthSnapshot | null {
        const guest = webContents.fromId(guestId)
        if (!guest || guest.isDestroyed()) {
            logger.system.warn(
                `[PreviewHealth] attach rejected: guest unavailable (guest=${guestId} session=${sessionId})`,
            )
            return null
        }

        // 同一 guest 重复上报（导航、重挂载）时以最新会话为准
        this.detach(guestId)

        const record: SessionRecord = {
            sessionId,
            guestId,
            owner,
            url,
            consoleMessages: [],
            loadFailures: [],
            blank: false,
            crashed: false,
            errorCount: 0,
            cleanups: [],
            blankTimer: null,
            pushTimer: null,
            updatedAt: Date.now(),
        }

        this.recordsByGuest.set(guestId, record)
        this.guestBySession.set(sessionId, guestId)
        this.watchSession(guest.session)
        this.bindGuest(record, guest)

        // 绑定后先推一次初始快照：一个既没告警也没加载失败的页面不会再有后续变更，
        // 不推就等于这个会话永远「没有健康数据」。
        this.schedulePush(record)

        // 采集是否真的挂上，只在运行时能看出来：留一行可检索的记录，便于排查
        // 「状态灯一直没数据」时区分「请求没到」与「绑定被拒」
        logger.system.info(
            `[PreviewHealth] attached session=${sessionId} guest=${guestId} url=${url || '-'}`,
        )

        return this.toSnapshot(record)
    }

    /** 解绑 guest（webview 卸载或标签页关闭时调用） */
    detach(guestId: number): void {
        const record = this.recordsByGuest.get(guestId)
        if (!record) return

        record.cleanups.forEach((cleanup) => cleanup())
        if (record.blankTimer) clearTimeout(record.blankTimer)
        if (record.pushTimer) clearTimeout(record.pushTimer)

        this.recordsByGuest.delete(guestId)
        if (this.guestBySession.get(record.sessionId) === guestId) {
            this.guestBySession.delete(record.sessionId)
        }
    }

    /** 读取会话当前健康快照（工具栏与 AI 调试回路按需调用） */
    getSnapshot(sessionId: string): PreviewHealthSnapshot | null {
        const guestId = this.guestBySession.get(sessionId)
        if (guestId === undefined) return null
        const record = this.recordsByGuest.get(guestId)
        return record ? this.toSnapshot(record) : null
    }

    /** 列出全部正在采集的会话快照（移动端接力等需要整体视图的场景） */
    listSnapshots(): PreviewHealthSnapshot[] {
        return [...this.recordsByGuest.values()].map((record) => this.toSnapshot(record))
    }

    /**
     * 采集页面资源瀑布
     *
     * 通过页面自身的 Performance API 读取，不注入依赖、不改动页面状态。
     * 只在排查问题时按需调用，不常驻采集。
     */
    async collectNetwork(guestId: number): Promise<PreviewNetworkEntry[]> {
        const guest = webContents.fromId(guestId)
        if (!guest || guest.isDestroyed()) return []

        try {
            const raw = await guest.executeJavaScript(RESOURCE_TIMING_PROBE, true)
            return parseNetworkEntries(raw)
        } catch (err) {
            logger.system.warn('[PreviewHealth] Failed to collect resource timing:', err)
            return []
        }
    }

    /** 应用退出时释放全部监听 */
    dispose(): void {
        for (const guestId of [...this.recordsByGuest.keys()]) {
            this.detach(guestId)
        }
        this.watchedSessions.clear()
    }

    /**
     * 为 session 挂载子资源失败监听
     *
     * webRequest 是 session 级单例：同一 session 重复挂载会互相覆盖，
     * 因此这里只挂一次，回调里再按 webContentsId 分发到对应会话。
     */
    private watchSession(session: Session): void {
        if (this.watchedSessions.has(session)) return
        this.watchedSessions.add(session)

        session.webRequest.onErrorOccurred((details) => {
            // 主文档失败由 did-fail-load 记录，这里跳过避免重复
            if (details.resourceType === 'mainFrame') return

            const guestId = details.webContentsId
            if (typeof guestId !== 'number') return

            const record = this.recordsByGuest.get(guestId)
            if (!record) return

            this.recordLoadFailure(record, {
                url: details.url,
                errorCode: 0,
                errorDescription: details.error || 'FAILED',
                at: Date.now(),
            })
        })
    }

    /** 绑定 guest 事件；每个监听都登记清理函数，detach 时统一解绑 */
    private bindGuest(record: SessionRecord, guest: WebContents): void {
        const bind = (event: string, handler: (...args: never[]) => void): void => {
            guest.on(event as never, handler as never)
            record.cleanups.push(() => {
                if (!guest.isDestroyed()) {
                    guest.removeListener(event as never, handler as never)
                }
            })
        }

        bind('console-message', ((...args: unknown[]) => {
            // Electron 把 event 放在首位，此处剔除后交给归一化处理
            this.handleConsoleMessage(record, args.slice(1))
        }) as never)

        bind('did-fail-load', ((...args: unknown[]) => {
            this.handleFailLoad(record, args.slice(1))
        }) as never)

        bind('did-navigate', ((...args: unknown[]) => {
            this.handleMainFrameNavigate(record, args.slice(1))
        }) as never)

        bind('did-finish-load', (() => {
            this.scheduleBlankCheck(record)
        }) as never)

        bind('render-process-gone', (() => {
            this.handleProcessGone(record)
        }) as never)

        bind('destroyed', (() => {
            this.detach(record.guestId)
        }) as never)
    }

    /** 主框架导航到新地址：上一页的错误不再属于当前页面，清空重建 */
    private handleMainFrameNavigate(record: SessionRecord, args: unknown[]): void {
        const [url] = args as [unknown]
        if (typeof url === 'string' && url) {
            record.url = url
        }

        record.consoleMessages = []
        record.loadFailures = []
        record.blank = false
        record.crashed = false
        record.errorCount = 0

        if (record.blankTimer) {
            clearTimeout(record.blankTimer)
            record.blankTimer = null
        }

        this.schedulePush(record)
    }

    private handleConsoleMessage(record: SessionRecord, args: unknown[]): void {
        const payload = normalizeConsolePayload(args)
        if (!payload) return

        const last = record.consoleMessages[record.consoleMessages.length - 1]
        // 同一错误反复刷屏时只保留一条并累加次数，避免数组被同一个问题挤满
        if (
            last &&
            last.level === payload.level &&
            last.message === payload.message &&
            last.line === payload.line &&
            last.source === payload.source
        ) {
            last.count++
            last.at = Date.now()
        } else {
            record.consoleMessages.push({ ...payload, at: Date.now(), count: 1 })
            if (record.consoleMessages.length > MAX_CONSOLE_ENTRIES) {
                record.consoleMessages.shift()
            }
        }

        if (payload.level === 'error') {
            record.errorCount++
        }

        this.schedulePush(record)
    }

    private handleFailLoad(record: SessionRecord, args: unknown[]): void {
        const [errorCode, errorDescription, validatedURL, isMainFrame] = args as [
            number,
            string,
            string,
            boolean,
        ]

        // 子框架失败不改变主页面可用性，忽略
        if (isMainFrame === false) return
        if (errorCode === ERR_ABORTED) return

        this.recordLoadFailure(record, {
            url: validatedURL || record.url,
            errorCode,
            errorDescription: errorDescription || 'FAILED',
            at: Date.now(),
        })
    }

    private handleProcessGone(record: SessionRecord): void {
        record.crashed = true
        record.errorCount++
        this.schedulePush(record)
    }

    private recordLoadFailure(record: SessionRecord, failure: PreviewLoadFailure): void {
        record.loadFailures.push(failure)
        if (record.loadFailures.length > MAX_LOAD_FAILURES) {
            record.loadFailures.shift()
        }
        record.errorCount++
        this.schedulePush(record)
    }

    /** 加载完成后延迟做一次白屏采样（等待异步内容渲染） */
    private scheduleBlankCheck(record: SessionRecord): void {
        if (record.blankTimer) {
            clearTimeout(record.blankTimer)
        }

        const guestId = record.guestId
        record.blankTimer = setTimeout(() => {
            record.blankTimer = null

            const guest = webContents.fromId(guestId)
            if (!guest || guest.isDestroyed()) return

            void detectBlank(guest).then((blank) => {
                // 采样期间可能已解绑或已导航，重新取记录再写入
                const current = this.recordsByGuest.get(guestId)
                if (!current) return
                // 无论结果是否翻转都要推：加载完成本身就是一个需要同步出去的状态
                // （快照里还带着标题），只有翻转才推会让「页面正常」一直不外显。
                current.blank = blank
                this.schedulePush(current)
            })
        }, BLANK_CHECK_DELAY_MS)
    }

    /** 合并推送：节拍内多次变更只发一次 IPC */
    private schedulePush(record: SessionRecord): void {
        if (record.pushTimer) return

        record.pushTimer = setTimeout(() => {
            record.pushTimer = null
            this.push(record)
        }, PUSH_INTERVAL_MS)
    }

    private push(record: SessionRecord): void {
        // 解绑后的迟到推送直接丢弃
        if (this.recordsByGuest.get(record.guestId) !== record) return
        if (record.owner.isDestroyed()) return

        record.updatedAt = Date.now()
        try {
            record.owner.send(PREVIEW_HEALTH_CHANNEL, this.toSnapshot(record))
        } catch (err) {
            logger.system.warn('[PreviewHealth] Failed to push snapshot:', err)
        }
    }

    private toSnapshot(record: SessionRecord): PreviewHealthSnapshot {
        const guest = webContents.fromId(record.guestId)
        return {
            sessionId: record.sessionId,
            level: computeHealthLevel(record),
            url: record.url,
            // 标题只存在于 webview 里，快照带上它，消费方（移动端接力等）不必再回查
            title: guest && !guest.isDestroyed() ? guest.getTitle() : undefined,
            // 复制一份再发，避免渲染进程改到主进程的采集状态
            consoleMessages: record.consoleMessages.map((entry) => ({ ...entry })),
            loadFailures: record.loadFailures.map((failure) => ({ ...failure })),
            blank: record.blank,
            crashed: record.crashed,
            errorCount: record.errorCount,
            updatedAt: record.updatedAt,
        }
    }
}

export const previewHealthMonitor = new PreviewHealthMonitor()
