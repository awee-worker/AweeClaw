/**
 * 在内置浏览器打开预览
 *
 * 统一入口：把「本地静态页面」或「本地服务地址」交给内置浏览器（预览标签页）。
 *
 * 为什么要有这一层：
 * - 内置浏览器的 webview 只接受 http/https 源，本地页面不能直接用 file:// 加载，
 *   因此本地文件先经主进程的预览静态服务转成回环地址（api.preview.resolveLocalUrl）。
 * - 预览会话集合由 previewSessionService 统一管理（同 URL 复用已有标签页），
 *   调用方不必关心标签页的创建与复用。
 */

import type { PreviewSession } from '@shared/protocols/previewProtocol'
import { api } from '@renderer/adapters/electronBridge'
import { useStore } from '@store'
import { previewSessionService } from './previewSessionManager'

const HTTP_URL_PATTERN = /^https?:\/\//i

/** 等待 webview 挂载并完成健康绑定的时长与轮询间隔 */
const GUEST_READY_TIMEOUT_MS = 3000
const GUEST_READY_POLL_MS = 100

export interface OpenBuiltinPreviewInput {
    /** 直接打开的 http/https 地址（通常是本地开发服务，如 http://localhost:5173） */
    url?: string
    /** 本地文件或目录的绝对路径（.html 文件，或含 index.html 的目录） */
    path?: string
    /** 标签页标题；缺省时按地址推导 */
    title?: string
    /** 初始设备模拟档位 id（预设 id / 'desktop' / 'custom'）；缺省为桌面 */
    device?: string
    /**
     * 优先开在站点内置浏览器的新标签里
     *
     * 内置浏览器正托管着某个系统时，预览标签页落在编辑器里会被它挡住——用户得先
     * 关掉站点页面才看得到报告。开启后这类页面改开成站点浏览器的新标签，与站点
     * 页面并排在同一处，谁都不用退出。浏览器没开时照旧走预览标签页。
     */
    preferSiteTab?: boolean
}

export interface OpenBuiltinPreviewResult {
    success: boolean
    /** 实际在内置浏览器中打开的地址 */
    url?: string
    /** 实际使用的标签页标题 */
    title?: string
    /** 预览会话 id（供调用方继续操作该标签页，如设置设备档位） */
    sessionId?: string
    /** 本地静态预览的根目录（供调用方登记自动刷新） */
    rootDir?: string
    /**
     * 页面是否已完成挂载与健康绑定（即 AI 的 browser_* 工具能否定位到它）
     *
     * false 只表示「在等待窗口内还没就绪」，不算打开失败：页面可能仍在加载。
     * 调用方据此提示模型先确认页面再操作，而不是直接扑一个空。
     */
    ready?: boolean
    /**
     * 页面最后落在哪一处
     *
     * preview-tab：编辑器里的预览标签页；site-browser：站点内置浏览器的新标签。
     * AI 据此给出准确提示，不至于让用户去编辑器里找一个不存在的标签。
     */
    openedIn?: PreviewOpenedIn
    error?: string
}

/** 从地址或本地路径推导一个可读的标签页标题 */
function deriveTitle(value: string): string {
    const trimmed = value.replace(/[\\/]+$/, '')
    const name = trimmed.split(/[\\/]/).pop() || trimmed
    return name || value
}

/**
 * 等待预览会话的 webview 就绪
 *
 * 打开动作返回后，AI 往往立刻读取或操作页面；而 webview 要先挂载、页面 dom-ready
 * 触发上报、主进程完成健康绑定，这中间的空档会让浏览器自动化工具定位不到标签页。
 * 把等待收进「打开」这一步，打开完成即代表页面已经可被自动化。
 *
 * 就绪信号取会话上的健康快照：它是主进程完成绑定的直接结果，比单纯的 guest id
 * 更晚一点、也更准确。超时不算失败（返回 false 由调用方决定怎么提示）——页面可能
 * 仍在加载；浏览器自动化工具自身也带等待窗口兜底。
 */
async function waitForSessionReady(sessionId: string): Promise<boolean> {
    const deadline = Date.now() + GUEST_READY_TIMEOUT_MS
    // 等待过半仍未就绪时，主动请求该标签页重报一次 guest：覆盖「上报早于监听
    // 注册 / 绑定被中途解绑」的时序竞争，比一路等到超时更可能把它吸收成正常命中。
    const nudgeAt = Date.now() + Math.floor(GUEST_READY_TIMEOUT_MS / 2)
    let nudged = false
    while (Date.now() < deadline) {
        if (previewSessionService.getSession(sessionId)?.health) {
            return true
        }
        if (!nudged && Date.now() >= nudgeAt) {
            nudged = true
            previewSessionService.requestGuestReport(sessionId)
        }
        await new Promise((resolve) => setTimeout(resolve, GUEST_READY_POLL_MS))
    }
    return false
}

/**
 * 站点内置浏览器正开着时，把页面开成它的新标签
 *
 * 内置浏览器占着主内容区，预览标签页落在编辑器里，被它整块挡住——用户只能先关掉
 * 站点页面才看得到报告。开成站点浏览器的新标签，两者并排在同一处，站点也不用退出。
 *
 * 返回 false 表示浏览器没开或没有承载站点，调用方照旧走预览标签页。
 */
function openInSiteBrowserTab(url: string, title: string): boolean {
    const state = useStore.getState()
    if (!state.internalBrowserUrl || !state.internalBrowserSite) return false
    state.openInternalBrowserTab(url, title)
    return true
}

/** 打开方式：占位说明页面最后落在哪一处，调用方据此给出准确的提示 */
export type PreviewOpenedIn = 'preview-tab' | 'site-browser'

/**
 * 在内置浏览器打开预览
 *
 * @param input url 与 path 二选一；同时给出时以 url 为准
 */
export async function openBuiltinPreview(
    input: OpenBuiltinPreviewInput,
): Promise<OpenBuiltinPreviewResult> {
    const rawUrl = (input.url || '').trim()

    if (rawUrl) {
        if (!HTTP_URL_PATTERN.test(rawUrl)) {
            return {
                success: false,
                error: `内置浏览器只接受 http/https 地址，收到：${rawUrl}`,
            }
        }
        const title = input.title || deriveTitle(rawUrl)
        if (input.preferSiteTab && openInSiteBrowserTab(rawUrl, title)) {
            return { success: true, url: rawUrl, title, openedIn: 'site-browser' }
        }
        const session = await activatePreview(rawUrl, title, undefined, input.device)
        const ready = await waitForSessionReady(session.id)
        return { success: true, url: rawUrl, title, sessionId: session.id, ready, openedIn: 'preview-tab' }
    }

    const rawPath = (input.path || '').trim()
    if (!rawPath) {
        return { success: false, error: '必须提供 url 或 path 之一' }
    }

    try {
        const resolved = await api.preview.resolveLocalUrl(rawPath)
        if (!resolved?.success || !resolved.url) {
            return {
                success: false,
                error: resolved?.error || `无法为本地路径建立预览：${rawPath}`,
            }
        }
        const title = input.title || deriveTitle(rawPath)
        if (input.preferSiteTab && openInSiteBrowserTab(resolved.url, title)) {
            return { success: true, url: resolved.url, title, rootDir: resolved.rootDir, openedIn: 'site-browser' }
        }
        const session = await activatePreview(resolved.url, title, resolved.rootDir, input.device)
        const ready = await waitForSessionReady(session.id)
        return { success: true, url: resolved.url, title, sessionId: session.id, rootDir: resolved.rootDir, ready, openedIn: 'preview-tab' }
    } catch (err) {
        return {
            success: false,
            error: `打开内置预览失败：${err instanceof Error ? err.message : String(err)}`,
        }
    }
}

/** 打开（或复用）预览标签页并激活，返回对应会话（调用方据此等待页面就绪） */
async function activatePreview(url: string, title: string, rootDir?: string, device?: string): Promise<PreviewSession> {
    // 侧边栏的收起交给 useFocusChromeCollapse：它按「浏览器专注」的模式在绘制前
    // 与标签页激活落在同一次提交里，并保留打开前的面板快照。
    // 这里手动 setActiveSidePanel(null) 会把打开前的侧栏状态抹掉，关闭浏览器后无法恢复。
    const session = previewSessionService.openUrl(url, {
        title,
        source: 'manual',
        activate: true,
        previewRoot: rootDir,
        // 设备档随会话一起下发：首帧就是设备框形态，不会先按铺满渲染一轮再缩回去
        deviceId: device,
    })

    // 本地静态页面：登记目录监听，页面文件改动后自动刷新
    if (rootDir) {
        void api.preview.watchAutoReload(rootDir, url)
    }

    return session
}
