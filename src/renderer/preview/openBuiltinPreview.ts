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
import { api } from '@renderer/adapters/electronBridge'
import { previewSessionService } from './previewSessionManager'

const HTTP_URL_PATTERN = /^https?:\/\//i

export interface OpenBuiltinPreviewInput {
    /** 直接打开的 http/https 地址（通常是本地开发服务，如 http://localhost:5173） */
    url?: string
    /** 本地文件或目录的绝对路径（.html 文件，或含 index.html 的目录） */
    path?: string
    /** 标签页标题；缺省时按地址推导 */
    title?: string
}

export interface OpenBuiltinPreviewResult {
    success: boolean
    /** 实际在内置浏览器中打开的地址 */
    url?: string
    /** 实际使用的标签页标题 */
    title?: string
    error?: string
}

/** 从地址或本地路径推导一个可读的标签页标题 */
function deriveTitle(value: string): string {
    const trimmed = value.replace(/[\\/]+$/, '')
    const name = trimmed.split(/[\\/]/).pop() || trimmed
    return name || value
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
        activatePreview(rawUrl, title)
        return { success: true, url: rawUrl, title }
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
        activatePreview(resolved.url, title)
        return { success: true, url: resolved.url, title }
    } catch (err) {
        return {
            success: false,
            error: `打开内置预览失败：${err instanceof Error ? err.message : String(err)}`,
        }
    }
}

/** 打开（或复用）预览标签页并激活 */
function activatePreview(url: string, title: string): void {
    previewSessionService.openUrl(url, {
        title,
        source: 'manual',
        activate: true,
    })
    // 预览要抢焦点，避免被右侧边栏挡住
    useStore.getState().setActiveSidePanel(null)
}
