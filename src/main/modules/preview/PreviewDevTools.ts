/**
 * 内嵌 DevTools
 *
 * 内置浏览器原来把 DevTools 弹成独立窗口：盖住应用、位置和预览对不上，用完还得多关一个
 * 窗口。这里把预览 webview 的 DevTools 渲染到一个 WebContentsView 上，按渲染进程给出的
 * 矩形贴在主窗口右侧，成为应用内的一块面板。
 *
 * 依赖 webContents.setDevToolsWebContents()：它允许把 DevTools 画到指定的 webContents 上，
 * 再由 WebContentsView 镶进窗口。
 *
 * 任何一步失败都回退到独立窗口（openDevTools 的默认行为），保证功能不会因此丢失。
 */

import { BrowserWindow, WebContentsView, webContents } from 'electron'
import type { WebContents } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'

/** 面板矩形（DIP，相对窗口内容区左上角） */
export interface DevToolsRect {
    x: number
    y: number
    width: number
    height: number
}

interface DockedEntry {
    view: WebContentsView
    guest: WebContents
    windowId: number
}

/** 低于该尺寸的 DevTools 无法使用，直接按独立窗口处理 */
const MIN_WIDTH = 200
const MIN_HEIGHT = 160

class PreviewDevToolsManager {
    private readonly entries = new Map<number, DockedEntry>()

    /** 该 guest 的 DevTools 是否已内嵌 */
    isDocked(guestId: number): boolean {
        return this.entries.has(guestId)
    }

    /**
     * 打开内嵌 DevTools
     *
     * @returns true 表示已内嵌；false 表示条件不满足或失败，调用方应回退到独立窗口
     */
    open(guestId: number, win: BrowserWindow, rect: DevToolsRect): boolean {
        if (rect.width < MIN_WIDTH || rect.height < MIN_HEIGHT) return false

        const guest = webContents.fromId(guestId)
        if (!guest || guest.isDestroyed()) return false

        const existing = this.entries.get(guestId)
        if (existing) {
            this.setBounds(guestId, rect)
            return true
        }

        // DevTools 只能挂在一个目标上：先关掉已在独立窗口里打开的那份
        if (guest.isDevToolsOpened()) {
            try {
                guest.closeDevTools()
            } catch (err) {
                logger.system.warn('[PreviewDevTools] Failed to close previous devtools:', err)
            }
        }

        let view: WebContentsView
        try {
            view = new WebContentsView()
        } catch (err) {
            logger.system.warn('[PreviewDevTools] Failed to create devtools view:', err)
            return false
        }

        // 先登记再挂载：后面任何一步失败都能被 close() 完整回收，
        // 否则 guest 会停在「DevTools 已打开、却没有视图承载」的死状态，
        // 之后再次打开只会被认为已经开着，表现为按钮点了没反应
        this.entries.set(guestId, { view, guest, windowId: win.id })
        guest.once('destroyed', () => this.close(guestId))

        try {
            guest.setDevToolsWebContents(view.webContents)
            guest.openDevTools()
            view.setBounds(toBounds(rect))
            win.contentView.addChildView(view)
        } catch (err) {
            logger.system.warn('[PreviewDevTools] Failed to dock devtools:', err)
            this.close(guestId)
            return false
        }

        logger.system.info(`[PreviewDevTools] Docked devtools for guest ${guestId}`)
        return true
    }

    /** 同步面板矩形（窗口尺寸变化、面板拖拽时调用） */
    setBounds(guestId: number, rect: DevToolsRect): void {
        const entry = this.entries.get(guestId)
        if (!entry) return

        // 尺寸为 0 时跳过：窗口最小化后 DevTools 内部布局会算坏，恢复时再同步一次即可
        if (rect.width <= 0 || rect.height <= 0) return

        try {
            entry.view.setBounds(toBounds(rect))
        } catch (err) {
            logger.system.warn('[PreviewDevTools] Failed to set bounds:', err)
        }
    }

    /** 关闭内嵌面板并销毁其 contents */
    close(guestId: number): void {
        const entry = this.entries.get(guestId)
        if (!entry) return

        this.entries.delete(guestId)

        // 先断开 DevTools 与目标 webContents 的关联，再销毁承载它的视图。
        // 内嵌模式下 guest.isDevToolsOpened() 并不为真，不能拿它当开关。
        if (!entry.guest.isDestroyed()) {
            try {
                entry.guest.closeDevTools()
            } catch (err) {
                logger.system.warn('[PreviewDevTools] Failed to close guest devtools:', err)
            }
        }

        const win = BrowserWindow.fromId(entry.windowId)
        if (win && !win.isDestroyed()) {
            try {
                win.contentView.removeChildView(entry.view)
            } catch (err) {
                logger.system.warn('[PreviewDevTools] Failed to detach view:', err)
            }
        }

        if (!entry.view.webContents.isDestroyed()) {
            entry.view.webContents.close()
        }
    }

    /** 应用退出时释放全部面板 */
    dispose(): void {
        for (const guestId of [...this.entries.keys()]) {
            this.close(guestId)
        }
    }
}

function toBounds(rect: DevToolsRect): { x: number; y: number; width: number; height: number } {
    return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
    }
}

export const previewDevTools = new PreviewDevToolsManager()
