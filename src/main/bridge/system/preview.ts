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
import { BrowserWindow, webContents } from 'electron'
import type { IpcMainInvokeEvent, WebContents } from 'electron'
import { safeIpcHandle } from '../core/ipcGuard'
import { previewStaticServer } from '../../modules/preview/PreviewStaticServer'
import { previewHealthMonitor } from '../../modules/preview/PreviewHealthMonitor'
import { previewAutoReload } from '../../modules/preview/PreviewAutoReload'
import { previewDevTools, type DevToolsRect } from '../../modules/preview/PreviewDevTools'

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
}
