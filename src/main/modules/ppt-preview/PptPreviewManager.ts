/**
 * PPT 预览管理器（单例）v2.3
 *
 * v2.3 架构变更：从独立窗口改为主窗口内嵌 Tab
 * - 不再创建独立 BrowserWindow
 * - 通过 IPC 向主窗口渲染进程推送数据
 * - 主窗口渲染层接收数据后打开 PptPreviewPanel Tab
 *
 * 职责：
 * - 维护会话数据：按 sessionId 缓存幻灯片列表
 * - 向主窗口 webContents 发送 IPC 事件（open/pushSlide/markComplete）
 * - 主窗口接收后调用 store.openPptPreview() 打开 Tab
 * - 支持降级：若主窗口不可用，回退到独立窗口模式
 *
 * 数据流：
 * 插件 → PptPreviewBridge.open/pushSlide/markComplete
 *      → PptPreviewManager（缓存数据 + 向主窗口发 IPC）
 *      → 主窗口渲染层（监听 IPC，更新 store，渲染 PptPreviewPanel）
 */

import { app, BrowserWindow, ipcMain } from 'electron'
import * as path from 'path'
import { logger } from '@shared/toolkit/LogEngine'
import {
  PPT_PREVIEW_CHANNELS,
  type PptSlideData,
  type PptPresentationMeta,
} from '@shared/protocols/pptPreviewProtocol'

/** 独立窗口降级模式的尺寸（仅主窗口不可用时使用） */
const FALLBACK_WINDOW_WIDTH = 960
const FALLBACK_WINDOW_HEIGHT = 680

/** 单个会话的缓存数据 */
interface SessionCache {
  meta: PptPresentationMeta
  slides: Map<number, PptSlideData>
}

export class PptPreviewManager {
  private static instance: PptPreviewManager | null = null

  /** 降级窗口（仅主窗口不可用时使用） */
  private fallbackWindow: BrowserWindow | null = null
  private ipcRegistered = false
  /** 会话缓存：sessionId → SessionCache */
  private readonly sessions = new Map<string, SessionCache>()
  /** 当前活动会话 ID */
  private activeSessionId: string | null = null
  /** 主窗口引用获取函数（延迟注入，避免循环依赖） */
  private getMainWindowFn: (() => BrowserWindow | null) | null = null

  private constructor() {}

  static getInstance(): PptPreviewManager {
    if (!PptPreviewManager.instance) {
      PptPreviewManager.instance = new PptPreviewManager()
    }
    return PptPreviewManager.instance
  }

  /**
   * 注入主窗口获取函数
   * 在 moduleInitializer 中调用，确保能拿到主窗口引用
   */
  setMainWindowGetter(fn: () => BrowserWindow | null): void {
    this.getMainWindowFn = fn
  }

  // --------------------------------------------
  // 预览控制（供 PptPreviewBridge 调用）
  // --------------------------------------------

  /**
   * 打开预览 Tab 并初始化会话。
   * 向主窗口发送 IPC 事件，主窗口接收后打开 PptPreviewPanel Tab。
   * 若主窗口不可用，降级为独立窗口。
   *
   * @param slideSize 幻灯片实际尺寸（英寸），用于预览画布正确缩放。
   *                  未提供时 PptPreviewPanel 用默认 10×5.625。
   */
  openSession(sessionId: string, title: string, slideSize?: { width: number; height: number }): void {
    this.registerIpc()

    // 初始化或获取会话缓存
    let session = this.sessions.get(sessionId)
    if (!session) {
      session = {
        meta: {
          sessionId,
          title,
          slideCount: 0,
          completed: false,
          slideSize,
        },
        slides: new Map(),
      }
      this.sessions.set(sessionId, session)
    } else {
      session.meta.title = title
      if (slideSize) session.meta.slideSize = slideSize
    }

    this.activeSessionId = sessionId

    // 优先向主窗口发 IPC（v2.3 内嵌模式）
    const mainWindow = this.getMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      // 激活应用并聚焦主窗口
      if (!app.isPackaged || process.platform === 'darwin') {
        app.focus({ steal: true })
      }
      if (mainWindow.isMinimized()) mainWindow.restore()
      if (!mainWindow.isVisible()) mainWindow.show()
      mainWindow.focus()
      mainWindow.moveTop()

      // 通知主窗口渲染层打开 PPT 预览 Tab
      this.sendToWebContents(
        mainWindow.webContents,
        PPT_PREVIEW_CHANNELS.OPEN,
        session.meta,
      )
      // 回放已缓存的幻灯片（窗口刚加载或 Tab 重建场景）
      for (const slide of session.slides.values()) {
        this.sendToWebContents(
          mainWindow.webContents,
          PPT_PREVIEW_CHANNELS.PUSH_SLIDE,
          slide,
        )
      }
      if (session.meta.completed && session.meta.filePath) {
        this.sendToWebContents(
          mainWindow.webContents,
          PPT_PREVIEW_CHANNELS.MARK_COMPLETE,
          { sessionId, filePath: session.meta.filePath },
        )
      }

      logger.system.info('[PptPreview] Tab opened in main window', {
        sessionId,
        title,
      })
      return
    }

    // 降级：独立窗口模式
    logger.system.warn(
      '[PptPreview] Main window unavailable, falling back to standalone window',
    )
    this.openStandaloneWindow(session)
  }

  /**
   * 推送/更新一张幻灯片数据。
   * 优先推送到主窗口，降级推送到独立窗口。
   */
  pushSlide(data: PptSlideData): void {
    const session = this.sessions.get(data.sessionId)
    if (!session) {
      logger.system.warn('[PptPreview] Session not found for pushSlide', {
        sessionId: data.sessionId,
      })
      return
    }

    // 缓存幻灯片
    session.slides.set(data.slideIndex, data)
    session.meta.slideCount = session.slides.size

    // 优先推送到主窗口
    const mainWindow = this.getMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      this.sendToWebContents(
        mainWindow.webContents,
        PPT_PREVIEW_CHANNELS.PUSH_SLIDE,
        data,
      )
      return
    }

    // 降级：推送到独立窗口
    if (this.fallbackWindow && !this.fallbackWindow.isDestroyed()) {
      this.sendToWebContents(
        this.fallbackWindow.webContents,
        PPT_PREVIEW_CHANNELS.PUSH_SLIDE,
        data,
      )
    }
  }

  /** 标记会话完成，附带保存路径 */
  markComplete(sessionId: string, filePath: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return

    session.meta.completed = true
    session.meta.filePath = filePath

    const mainWindow = this.getMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      this.sendToWebContents(
        mainWindow.webContents,
        PPT_PREVIEW_CHANNELS.MARK_COMPLETE,
        { sessionId, filePath },
      )
    } else if (this.fallbackWindow && !this.fallbackWindow.isDestroyed()) {
      this.sendToWebContents(
        this.fallbackWindow.webContents,
        PPT_PREVIEW_CHANNELS.MARK_COMPLETE,
        { sessionId, filePath },
      )
    }

    logger.system.info('[PptPreview] Marked complete', { sessionId, filePath })
  }

  /** 清理会话数据 */
  clearSession(sessionId: string): void {
    this.sessions.delete(sessionId)
    if (this.activeSessionId === sessionId) {
      this.activeSessionId = null
    }
  }

  // --------------------------------------------
  // 窗口/资源管理
  // --------------------------------------------

  /** 隐藏降级窗口（不销毁） */
  hide(): void {
    if (
      this.fallbackWindow &&
      !this.fallbackWindow.isDestroyed() &&
      this.fallbackWindow.isVisible()
    ) {
      this.fallbackWindow.hide()
    }
  }

  /** 销毁降级窗口和应用退出时调用 */
  destroy(): void {
    if (this.fallbackWindow && !this.fallbackWindow.isDestroyed()) {
      this.fallbackWindow.destroy()
    }
    this.fallbackWindow = null
    this.sessions.clear()
  }

  // --------------------------------------------
  // 内部实现
  // --------------------------------------------

  /** 获取主窗口 */
  private getMainWindow(): BrowserWindow | null {
    if (this.getMainWindowFn) {
      try {
        return this.getMainWindowFn()
      } catch (err) {
        logger.system.warn('[PptPreview] getMainWindow failed:', err)
        return null
      }
    }
    // 兜底：从所有窗口中查找主窗口
    const windows = BrowserWindow.getAllWindows()
    return windows.find((w) => !w.isDestroyed()) || null
  }

  /** 向 webContents 发送消息（等 ready） */
  private sendToWebContents(
    wc: Electron.WebContents,
    channel: string,
    ...args: unknown[]
  ): void {
    if (wc.isDestroyed()) return
    if (wc.isLoading()) {
      wc.once('did-finish-load', () => {
        if (!wc.isDestroyed()) wc.send(channel, ...args)
      })
    } else {
      wc.send(channel, ...args)
    }
  }

  /** 注册 IPC（幂等，仅注册一次） */
  private registerIpc(): void {
    if (this.ipcRegistered) return
    this.ipcRegistered = true

    // 渲染进程请求关闭预览（关闭 Tab 或隐藏窗口）
    ipcMain.handle(PPT_PREVIEW_CHANNELS.CLOSE, () => {
      this.hide()
      return { success: true }
    })

    // 渲染进程请求导出（在系统文件管理器中显示）
    ipcMain.handle(PPT_PREVIEW_CHANNELS.EXPORT, (_e, filePath: string) => {
      if (filePath) {
        import('electron').then(({ shell }) => shell.showItemInFolder(filePath))
      }
      return { success: true }
    })

    logger.system.info('[PptPreview] IPC registered')
  }

  // --------------------------------------------
  // 降级：独立窗口模式（仅主窗口不可用时使用）
  // --------------------------------------------

  /** 打开独立降级窗口 */
  private openStandaloneWindow(session: SessionCache): void {
    const win = this.ensureFallbackWindow()

    if (!app.isPackaged || process.platform === 'darwin') {
      app.focus({ steal: true })
    }
    if (win.isMinimized()) win.restore()
    if (!win.isVisible()) win.show()
    win.focus()
    win.moveTop()

    this.sendToWebContents(win.webContents, PPT_PREVIEW_CHANNELS.OPEN, session.meta)
    for (const slide of session.slides.values()) {
      this.sendToWebContents(win.webContents, PPT_PREVIEW_CHANNELS.PUSH_SLIDE, slide)
    }
    if (session.meta.completed && session.meta.filePath) {
      this.sendToWebContents(
        win.webContents,
        PPT_PREVIEW_CHANNELS.MARK_COMPLETE,
        { sessionId: session.meta.sessionId, filePath: session.meta.filePath },
      )
    }
  }

  /** 懒创建/复用降级窗口 */
  private ensureFallbackWindow(): BrowserWindow {
    if (this.fallbackWindow && !this.fallbackWindow.isDestroyed()) {
      return this.fallbackWindow
    }

    this.fallbackWindow = new BrowserWindow({
      width: FALLBACK_WINDOW_WIDTH,
      height: FALLBACK_WINDOW_HEIGHT,
      minWidth: 720,
      minHeight: 480,
      title: 'AweeClaw PPT 预览（降级模式）',
      frame: true,
      resizable: true,
      maximizable: true,
      minimizable: true,
      fullscreenable: false,
      show: false,
      backgroundColor: '#1a1a1a',
      webPreferences: {
        preload: path.join(__dirname, '../preload/preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    })

    this.fallbackWindow.once('ready-to-show', () => {
      this.fallbackWindow?.show()
      this.fallbackWindow?.focus()
    })

    this.fallbackWindow.webContents.on('did-fail-load', (_e, errorCode, errorDescription) => {
      logger.system.error(
        `[PptPreview] Fallback window load failed: ${errorCode} ${errorDescription}`,
      )
    })

    this.fallbackWindow.on('closed', () => {
      this.fallbackWindow = null
    })

    this.loadFallbackContent()
    logger.system.info('[PptPreview] Fallback window created')
    return this.fallbackWindow
  }

  /** 加载降级窗口内容 */
  private loadFallbackContent(): void {
    if (!this.fallbackWindow) return

    if (app.isPackaged) {
      const filePath = path.join(__dirname, '../renderer/ppt-preview.html')
      this.fallbackWindow.loadFile(filePath).catch((err) => {
        logger.system.error(`[PptPreview] Failed to load ppt-preview.html: ${err.message}`)
      })
      return
    }

    if (process.env.VITE_DEV_SERVER_URL) {
      const base = process.env.VITE_DEV_SERVER_URL.endsWith('/')
        ? process.env.VITE_DEV_SERVER_URL
        : process.env.VITE_DEV_SERVER_URL + '/'
      const devUrl = `${base}ppt-preview.html`
      this.fallbackWindow.loadURL(devUrl).catch((err) => {
        logger.system.error(`[PptPreview] Failed to load dev URL ${devUrl}: ${err.message}`)
      })
      return
    }

    const filePath = path.join(__dirname, '../renderer/ppt-preview.html')
    this.fallbackWindow.loadFile(filePath).catch((err) => {
      logger.system.error(`[PptPreview] Failed to load fallback ppt-preview.html: ${err.message}`)
    })
  }
}
