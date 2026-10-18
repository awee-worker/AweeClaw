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

import { useStore } from '@store'
import type { PreviewSession } from '@shared/protocols/previewProtocol'
import { api } from '@renderer/adapters/electronBridge'
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
        const session = await activatePreview(rawUrl, title, undefined, input.device)
        const ready = await waitForSessionReady(session.id)
        return { success: true, url: rawUrl, title, sessionId: session.id, ready }
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
        const session = await activatePreview(resolved.url, title, resolved.rootDir, input.device)
        const ready = await waitForSessionReady(session.id)
        return { success: true, url: resolved.url, title, sessionId: session.id, rootDir: resolved.rootDir, ready }
    } catch (err) {
        return {
            success: false,
            error: `打开内置预览失败：${err instanceof Error ? err.message : String(err)}`,
        }
    }
}

/** 打开（或复用）预览标签页并激活，返回对应会话（调用方据此等待页面就绪） */
async function activatePreview(url: string, title: string, rootDir?: string, device?: string): Promise<PreviewSession> {
    const store = useStore.getState()

    // 侧边栏收起与打开标签页必须落在同一次 React 提交里
    //
    // 收起侧边栏会让主内容区变宽，打开标签页又会让聊天栏从「弹性占满」变成
    // 「固定宽度」，同时挤出编辑器区域。拆成两帧时用户会先看到界面变宽、紧接着
    // 内容被压窄——两次布局变化连着闪，观感就是整个界面缩了一下。合并到同一次
    // 提交后只有一次布局与一次绘制，直接到达最终形态。
    if (store.activeSidePanel !== null) {
        store.setActiveSidePanel(null)
    }

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
