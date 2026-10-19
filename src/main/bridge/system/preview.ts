/**
 * 内置预览桥接
 *
 * 职责：
 * - 把本地静态文件映射成内置浏览器可直接加载的 http 地址
 * - 提供页面健康数据的订阅与读取（工具栏状态灯 / AI 调试回路）
 *
 * 内置浏览器的 webview 只接受 http/https 源，本地页面必须经由预览静态服务
 * （modules/preview/PreviewStaticServer）暴露；渲染进程不关心端口与目录登记，
 * 只拿一个可加载的 URL。
 */

import * as path from 'node:path'
import * as fs from 'node:fs'
import { app, BrowserWindow, webContents } from 'electron'
import type { IpcMainInvokeEvent, WebContents } from 'electron'
import { safeIpcHandle } from '../core/ipcGuard'
import { previewStaticServer } from '../../modules/preview/PreviewStaticServer'
import { previewHealthMonitor } from '../../modules/preview/PreviewHealthMonitor'
import { previewAutoReload } from '../../modules/preview/PreviewAutoReload'
import { previewDevTools, type DevToolsRect } from '../../modules/preview/PreviewDevTools'
import { PREVIEW_DEVICE_CHANNEL, type PreviewDeviceRequest } from '@shared/protocols/previewProtocol'
import {
    PICKER_PROBE,
    PICKER_CANCEL_PROBE,
    buildElementContextProbe,
    buildElementEditProbe,
    buildUndoEditsProbe,
    type ElementEditOp,
} from '../../modules/preview/previewDomProbe'
import { captureElementImage } from '../../modules/preview/previewElementCapture'

/**
 * 校验 guest 确实由发起请求的窗口承载
 *
 * 渲染进程传来的 id 可能指向任意 WebContents（例如主窗口自身），
 * 必须先确认它是该窗口内嵌的 webview，再允许绑定事件采集。
 */
function resolveOwnedGuest(event: IpcMainInvokeEvent, guestId: unknown): WebContents | null {
    if (typeof guestId !== 'number' || !Number.isInteger(guestId)) return null

    const guest = webContents.fromId(guestId)
    if (!guest || guest.isDestroyed()) return null

    const host = guest.hostWebContents
    if (!host || host.id !== event.sender.id) return null

    return guest
}

/**
 * 校验并换算 DevTools 面板矩形
 *
 * 渲染进程给的是 CSS 像素，原生图层按 DIP 定位，需要按页面缩放换算。
 */
function resolveDevToolsRect(sender: WebContents, raw: unknown): DevToolsRect | null {
    if (!raw || typeof raw !== 'object') return null

    const { x, y, width, height } = raw as Partial<DevToolsRect>
    if (typeof x !== 'number' || typeof y !== 'number') return null
    if (typeof width !== 'number' || typeof height !== 'number') return null
    if (![x, y, width, height].every((value) => Number.isFinite(value))) return null

    // 页面缩放为 z 时，视口 CSS 尺寸 = 内容区 DIP 尺寸 / z，故 DIP = CSS × z
    const zoom = sender.getZoomFactor() || 1
    return { x: x * zoom, y: y * zoom, width: width * zoom, height: height * zoom }
}

/** 校验并规整预览根目录（必须是一个真实存在的目录） */
async function resolvePreviewRoot(dir: unknown): Promise<string | null> {
    if (typeof dir !== 'string' || !dir.trim()) return null

    const resolved = path.resolve(dir.trim())
    try {
        const stats = await fs.promises.stat(resolved)
        return stats.isDirectory() ? resolved : null
    } catch {
        return null
    }
}

/** 可作为页面直接预览的扩展名（其余文件按目录入口处理） */
const PAGE_EXT = /\.(html?|svg)$/i

export function registerPreviewHandlers(): void {
    /**
     * 为一个本地文件（或目录）解析出内置浏览器可加载的地址
     *
     * @param localPath 绝对路径：页面文件返回同目录下的文件地址，目录返回其 index.html
     */
    safeIpcHandle('preview:resolveLocalUrl', async (_, localPath: unknown) => {
        if (typeof localPath !== 'string' || !localPath.trim()) {
            return { success: false, error: 'localPath is required' }
        }

        const target = path.resolve(localPath.trim())

        let stats: fs.Stats
        try {
            stats = await fs.promises.stat(target)
        } catch {
            return { success: false, error: `Path does not exist: ${target}` }
        }

        const isPageFile = stats.isFile() && PAGE_EXT.test(target)
        const isDirectory = stats.isDirectory()

        if (!isPageFile && !isDirectory) {
            return {
                success: false,
                error: `Not a previewable target (expect an .html file or a folder): ${target}`,
            }
        }

        const rootDir = isPageFile ? path.dirname(target) : target
        const origin = await previewStaticServer.registerRoot(rootDir)
        if (!origin) {
            return { success: false, error: `Preview root unavailable: ${rootDir}` }
        }

        const url = isPageFile
            ? `${origin}/${encodeURIComponent(path.basename(target))}`
            : `${origin}/`

        // 一并返回根目录：渲染进程据此登记目录监听，页面文件改动后自动刷新
        return { success: true, url, rootDir }
    })

    /**
     * 把 webview guest 绑定到预览会话并开始采集健康数据
     *
     * 渲染进程在 webview dom-ready 后上报 guest id；每次导航都会重新上报，
     * 监控侧以最新会话为准重建采集状态。
     */
    safeIpcHandle(
        'preview:health-attach',
        async (event, guestId: unknown, sessionId: unknown, url: unknown) => {
            const guest = resolveOwnedGuest(event, guestId)
            if (!guest) {
                return { success: false, error: 'Unknown preview guest' }
            }
            if (typeof sessionId !== 'string' || !sessionId) {
                return { success: false, error: 'sessionId is required' }
            }

            const snapshot = previewHealthMonitor.attach(
                guest.id,
                sessionId,
                typeof url === 'string' ? url : '',
                event.sender,
            )

            return snapshot
                ? { success: true, data: snapshot }
                : { success: false, error: 'Attach failed' }
        },
    )

    /**
     * 解绑 guest，停止健康采集
     *
     * 解绑按 id 直接删除记录：guest 可能已销毁（webview 卸载），此时无法再校验归属，
     * 而记录已在 destroyed 事件里清理过，这里属于提前释放，不会影响其他会话。
     */
    safeIpcHandle('preview:health-detach', async (_event, guestId: unknown) => {
        if (typeof guestId !== 'number' || !Number.isInteger(guestId)) {
            return { success: false, error: 'guestId is required' }
        }

        previewHealthMonitor.detach(guestId)
        return { success: true }
    })

    /** 读取指定会话的健康快照（明细面板手动刷新、AI 调试回路读取） */
    safeIpcHandle('preview:health-get', async (_event, sessionId: unknown) => {
        if (typeof sessionId !== 'string' || !sessionId) {
            return { success: false, error: 'sessionId is required' }
        }

        return { success: true, data: previewHealthMonitor.getSnapshot(sessionId) }
    })

    /** 采集页面资源瀑布（按需触发，不常驻） */
    safeIpcHandle('preview:network-collect', async (event, guestId: unknown) => {
        const guest = resolveOwnedGuest(event, guestId)
        if (!guest) {
            return { success: false, error: 'Unknown preview guest' }
        }

        return { success: true, data: await previewHealthMonitor.collectNetwork(guest.id) }
    })

    /**
     * 采集页面内容摘要（白屏判定的交叉验证，按需触发）
     *
     * 白屏来自像素采样，SPA 延迟渲染等场景可能误报；这里读 DOM 文本量
     * 复核，两个信号都为空才可靠判定页面没有内容。
     */
    safeIpcHandle('preview:content-probe', async (event, guestId: unknown) => {
        const guest = resolveOwnedGuest(event, guestId)
        if (!guest) {
            return { success: false, error: 'Unknown preview guest' }
        }

        return { success: true, data: await previewHealthMonitor.collectContentSummary(guest.id) }
    })

    /**
     * 按 guest 重载页面
     *
     * 重载交给主进程的 WebContents.reload()：webview 标签自身的 reload() 与
     * loadURL() 在部分页面状态下会静默失效（表现为「点了刷新没反应」），
     * 而这里是同一个 webContents 的原生重载路径，不经过标签层。
     */
    safeIpcHandle('preview:reload', async (event, guestId: unknown) => {
        const guest = resolveOwnedGuest(event, guestId)
        if (!guest) {
            return { success: false, error: 'Unknown preview guest' }
        }

        guest.reload()
        return { success: true }
    })

    /**
     * 按 guest 导航到新地址
     *
     * 导航与重载走同一条可靠路径：webview 标签自身的 loadURL() 在部分页面状态下
     * 会静默失效（同址被当作同文档导航短路、SPA 路由接管等），表现为「地址栏换了
     * 地址但页面没动」。这里对同一个 webContents 调原生 loadURL()，不经过标签层。
     * 协议白名单与 webviewGuard 一致，只放行 http/https。
     */
    safeIpcHandle('preview:navigate', async (event, guestId: unknown, url: unknown) => {
        const guest = resolveOwnedGuest(event, guestId)
        if (!guest) {
            return { success: false, error: 'Unknown preview guest' }
        }
        if (typeof url !== 'string' || !url.trim()) {
            return { success: false, error: 'url is required' }
        }

        let parsed: URL
        try {
            parsed = new URL(url.trim())
        } catch {
            return { success: false, error: `Invalid URL: ${url}` }
        }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return { success: false, error: `Only http/https URLs are allowed, got: ${parsed.protocol}` }
        }

        try {
            await guest.loadURL(parsed.toString())
        } catch (error) {
            // 重定向或新导航打断时页面可能已经加载完成，以最终地址为准判定
            const finalUrl = guest.getURL()
            if (!finalUrl.startsWith(parsed.origin)) {
                return { success: false, error: (error as Error).message }
            }
        }

        return { success: true, data: { url: guest.getURL() } }
    })

    /**
     * 应用设备模拟的 User-Agent
     *
     * 设备框尺寸由渲染进程用 CSS 约束（决定页面 viewport 宽度），主进程只负责让
     * guest 的 UA 与设备一致：移动档换移动 UA，桌面档恢复默认 UA。UA 变化后必须
     * 重载页面才会生效——只改 UA 不刷新，页面仍是旧 UA 渲染出的 DOM。
     */
    safeIpcHandle('preview:apply-device', async (event, guestId: unknown, ua: unknown) => {
        const guest = resolveOwnedGuest(event, guestId)
        if (!guest) {
            return { success: false, error: 'Unknown preview guest' }
        }

        const nextUa = typeof ua === 'string' && ua.trim() ? ua.trim() : null
        const target = nextUa || app.userAgentFallback
        if (!target) {
            return { success: false, error: 'No user agent available' }
        }

        const changed = guest.getUserAgent() !== target
        guest.setUserAgent(target)
        if (changed) {
            guest.reload()
        }

        return { success: true, data: { ua: target, reloaded: changed } }
    })


    /**
     * 登记预览目录的自动刷新
     *
     * 只对本地静态页面调用：dev server 自带 HMR，不需要这份监听。
     * 命中改动后主进程按 URL 通知渲染进程重载对应标签页。
     */
    safeIpcHandle('preview:auto-reload-watch', async (event, dir: unknown, url: unknown) => {
        const target = await resolvePreviewRoot(dir)
        if (!target) {
            return { success: false, error: 'Invalid preview root' }
        }
        if (typeof url !== 'string' || !url) {
            return { success: false, error: 'url is required' }
        }

        previewAutoReload.watch(target, url, event.sender)
        return { success: true }
    })

    /** 取消预览目录的自动刷新（标签页关闭或切走地址时调用） */
    safeIpcHandle('preview:auto-reload-unwatch', async (event, dir: unknown, url: unknown) => {
        const target = await resolvePreviewRoot(dir)
        if (!target) {
            return { success: false, error: 'Invalid preview root' }
        }

        previewAutoReload.unwatch(
            target,
            typeof url === 'string' && url ? url : undefined,
            event.sender.id,
        )
        return { success: true }
    })

    /**
     * 打开内嵌 DevTools
     *
     * 渲染进程先布局出右侧面板，再把矩形传进来。条件不满足（面板太窄、原生视图不可用）
     * 时返回 docked: false，由渲染进程退回独立窗口模式。
     */
    safeIpcHandle('preview:devtools-open', async (event, guestId: unknown, rect: unknown) => {
        const guest = resolveOwnedGuest(event, guestId)
        const win = BrowserWindow.fromWebContents(event.sender)
        const resolved = resolveDevToolsRect(event.sender, rect)

        if (!guest || !win || !resolved) {
            return { success: true, data: { docked: false } }
        }

        return { success: true, data: { docked: previewDevTools.open(guest.id, win, resolved) } }
    })

    /** 同步内嵌 DevTools 的面板矩形（面板拖拽 / 窗口尺寸变化） */
    safeIpcHandle('preview:devtools-bounds', async (event, guestId: unknown, rect: unknown) => {
        const guest = resolveOwnedGuest(event, guestId)
        const resolved = resolveDevToolsRect(event.sender, rect)

        if (!guest || !resolved) {
            return { success: false, error: 'Invalid devtools bounds' }
        }

        previewDevTools.setBounds(guest.id, resolved)
        return { success: true }
    })

    /** 关闭内嵌 DevTools */
    safeIpcHandle('preview:devtools-close', async (_event, guestId: unknown) => {
        if (typeof guestId !== 'number' || !Number.isInteger(guestId)) {
            return { success: false, error: 'guestId is required' }
        }

        previewDevTools.close(guestId)
        return { success: true }
    })

    /**
     * 开始一次元素拾取
     *
     * 页面脚本返回的 Promise 会一直挂到用户点击元素、按 Esc 或超时。
     * 这正是「等待用户操作」的语义，不需要轮询页面状态。
     *
     * 主进程比页面脚本多等 2 秒才兜底超时：页面自身超时会先 resolve 成
     * reason=timeout，那条路径能正常走到这里；只有脚本被页面 CSP 阻断或
     * 文档中途被替换（Promise 永远不 resolve）时，才需要这层兜底。
     */
    safeIpcHandle('preview:pick-start', async (event, guestId: unknown) => {
        const guest = resolveOwnedGuest(event, guestId)
        if (!guest) {
            return { success: false, error: 'Unknown preview guest' }
        }

        let timer: ReturnType<typeof setTimeout> | null = null
        try {
            const raw = await Promise.race([
                guest.executeJavaScript(PICKER_PROBE, true),
                new Promise<null>((resolve) => {
                    timer = setTimeout(() => resolve(null), PICK_TIMEOUT_MS + 2_000)
                }),
            ])

            if (raw === null) {
                // 主进程兜底超时：页面里的拾取器还挂着，主动结束它，避免残留覆盖层
                void guest.executeJavaScript(PICKER_CANCEL_PROBE, true).catch(() => undefined)
                return { success: true, data: { ok: false, reason: 'timeout' } }
            }
            if (typeof raw !== 'string' || !raw) {
                return { success: false, error: 'Picker returned unexpected data' }
            }

            return { success: true, data: JSON.parse(raw) }
        } catch (error) {
            return { success: false, error: (error as Error).message }
        } finally {
            if (timer) clearTimeout(timer)
        }
    })

    /** 结束正在等待的拾取（用户按 Esc、切换标签页、页面导航时调用） */
    safeIpcHandle('preview:pick-cancel', async (event, guestId: unknown) => {
        const guest = resolveOwnedGuest(event, guestId)
        if (!guest) {
            return { success: false, error: 'Unknown preview guest' }
        }

        try {
            await guest.executeJavaScript(PICKER_CANCEL_PROBE, true)
            return { success: true }
        } catch (error) {
            return { success: false, error: (error as Error).message }
        }
    })

    /** 按选择器读取元素快照（AI 侧 browser_element_context） */
    safeIpcHandle('preview:element-context', async (event, guestId: unknown, selector: unknown) => {
        const guest = resolveOwnedGuest(event, guestId)
        if (!guest) {
            return { success: false, error: 'Unknown preview guest' }
        }
        if (typeof selector !== 'string' || !selector.trim()) {
            return { success: false, error: 'selector is required' }
        }

        const result = await runPreviewProbe(guest, buildElementContextProbe(selector.trim()))
        return result.ok
            ? { success: true, data: result.data }
            : { success: false, error: result.error }
    })

    /**
     * 就地修改元素
     *
     * 只接受固定的几种操作（文案/样式/属性/结构/隐藏），不接受任意脚本：
     * 每次修改都记进页面的编辑账本，可以整体回滚。
     */
    safeIpcHandle('preview:element-edit', async (event, guestId: unknown, payload: unknown) => {
        const guest = resolveOwnedGuest(event, guestId)
        if (!guest) {
            return { success: false, error: 'Unknown preview guest' }
        }

        const parsed = payload as { selector?: unknown; edit?: unknown; scope?: unknown } | null
        const selector = typeof parsed?.selector === 'string' ? parsed.selector.trim() : ''
        if (!selector) {
            return { success: false, error: 'selector is required' }
        }

        const edit = normalizeElementEdit(parsed?.edit)
        if (!edit) {
            return { success: false, error: 'Unsupported edit payload' }
        }

        const scope = parsed?.scope === 'similar' ? 'similar' : 'one'
        const result = await runPreviewProbe(guest, buildElementEditProbe(selector, edit, scope))
        return result.ok
            ? { success: true, data: result.data }
            : { success: false, error: result.error }
    })

    /** 回滚就地修改（mode=last 撤销最近一次，mode=all 全部还原） */
    safeIpcHandle('preview:undo-edits', async (event, guestId: unknown, mode: unknown) => {
        const guest = resolveOwnedGuest(event, guestId)
        if (!guest) {
            return { success: false, error: 'Unknown preview guest' }
        }

        const resolvedMode = mode === 'last' ? 'last' : 'all'
        const result = await runPreviewProbe(guest, buildUndoEditsProbe(resolvedMode))
        return result.ok
            ? { success: true, data: result.data }
            : { success: false, error: result.error }
    })

    /**
     * 截取单个元素的画面
     *
     * AI 判断「间距不对 / 配色脏」这类视觉问题时，看一张元素截图比读 computed
     * style 准得多，成本也只是几十 KB 的 base64。截图前先把元素滚进视口，
     * 视口外的区域 capturePage 只会给空白。
     */
    safeIpcHandle('preview:capture-element', async (event, guestId: unknown, selector: unknown) => {
        const guest = resolveOwnedGuest(event, guestId)
        if (!guest) {
            return { success: false, error: 'Unknown preview guest' }
        }
        if (typeof selector !== 'string' || !selector.trim()) {
            return { success: false, error: 'selector is required' }
        }

        const shot = await captureElementImage(guest, selector.trim())
        if (!shot) {
            return { success: false, error: 'Element is not visible or could not be captured' }
        }

        return { success: true, data: shot }
    })
}

/** 拾取等待上限：与页面脚本内的超时保持一致 */
const PICK_TIMEOUT_MS = 120_000

/** 在页面里执行探测脚本并解析 JSON，失败统一转成错误字符串 */
async function runPreviewProbe<T>(
    guest: WebContents,
    expression: string,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
    try {
        const raw = await guest.executeJavaScript(expression, true)
        if (typeof raw !== 'string' || !raw) {
            return { ok: false, error: 'Page probe returned unexpected data' }
        }
        const parsed = JSON.parse(raw) as T & { ok?: boolean; error?: string }
        if (parsed && parsed.ok === false) {
            return { ok: false, error: parsed.error || 'Page probe failed' }
        }
        return { ok: true, data: parsed }
    } catch (error) {
        return { ok: false, error: `Page probe failed: ${(error as Error).message}` }
    }
}

/**
 * 规整元素编辑指令
 *
 * 渲染进程与 MCP 工具都能发起编辑，这里做统一收敛：只放行固定操作类型，
 * 其余一律拒绝。样式名与属性名会以 JSON 字符串形式注入页面脚本，
 * 不做字符串拼接，因此不存在注入面。
 */
function normalizeElementEdit(raw: unknown): ElementEditOp | null {
    if (!raw || typeof raw !== 'object') return null
    const value = raw as Record<string, unknown>

    if (value.op === 'hide') return { op: 'hide' }
    if (value.op === 'text') {
        return typeof value.value === 'string' ? { op: 'text', value: value.value } : null
    }
    if (value.op === 'html') {
        return typeof value.value === 'string' ? { op: 'html', value: value.value } : null
    }
    if (value.op === 'style') {
        if (typeof value.prop !== 'string' || !value.prop.trim()) return null
        if (typeof value.value !== 'string') return null
        return { op: 'style', prop: value.prop.trim(), value: value.value }
    }
    if (value.op === 'attr') {
        if (typeof value.prop !== 'string' || !value.prop.trim()) return null
        if (value.value !== null && typeof value.value !== 'string') return null
        return { op: 'attr', prop: value.prop.trim(), value: value.value as string | null }
    }
    return null
}

/**
 * 把设备模式切换意图广播给承载预览的渲染进程
 *
 * AI 工具运行在主进程，看不到渲染层的设备框与前端状态，只能把「切成哪个档位」
 * 交给渲染进程，由它复用「手动切换」的同一条应用链路（更新会话 → 重排设备框 →
 * 应用 UA），保证 UI 与工具两条入口最终落到同一份状态。
 *
 * @returns 是否送达（host 缺失或已销毁时为 false）
 */
export function requestPreviewDeviceChange(
    guest: WebContents,
    request: PreviewDeviceRequest,
): boolean {
    const host = guest.hostWebContents
    if (!host || host.isDestroyed()) return false
    host.send(PREVIEW_DEVICE_CHANNEL, request)
    return true
}
