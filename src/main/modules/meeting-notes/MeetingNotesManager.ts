/**
 * 会议纪要窗口管理器（单例）
 *
 * 职责：
 * - 创建/复用/显示/聚焦/销毁会议纪要 BrowserWindow
 * - 常规独立窗口（980×680，有标题栏，可调整大小），区别于截图的全屏透明覆盖窗口
 * - 常驻复用：show() 时若窗口已存在则 restore+focus，不重建（用户可能中途切走再回来）
 * - 持有工作区路径获取器（用于文件落盘）
 * - 注册 IPC handler（委托给 registerMeetingNotesIpc，幂等）
 *
 * 窗口属性要点：
 * - frame:true 有原生标题栏，标题「AweeClaw 会议纪要」
 * - resizable:true / maximizable:true / minimizable:true
 * - show:false + ready-to-show 防止白底闪烁
 * - 不注册进 windowManager.windows Map（与悬浮头像一致，避免影响 window-all-closed）
 *
 * 与 ScreenshotAskManager 的差异：
 * - 截图是全屏透明覆盖一次性窗口；会议纪要是常规常驻窗口
 * - 截图窗口关闭即销毁；会议纪要窗口关闭后下次 show 复用（若未销毁）或重建
 */

import { app, BrowserWindow } from 'electron'
import * as path from 'path'
import { logger } from '@shared/toolkit/LogEngine'
import { registerMeetingNotesIpc } from './MeetingNotesIpc'
import type { WorkspacePathGetter } from './types'

/** 窗口默认尺寸 */
const WINDOW_WIDTH = 980
const WINDOW_HEIGHT = 680
const WINDOW_MIN_WIDTH = 720
const WINDOW_MIN_HEIGHT = 480

export class MeetingNotesManager {
  private static instance: MeetingNotesManager | null = null

  private window: BrowserWindow | null = null
  private ipcRegistered = false
  private readonly getWorkspacePath: WorkspacePathGetter

  private constructor(getWorkspacePath: WorkspacePathGetter) {
    this.getWorkspacePath = getWorkspacePath
  }

  /** 获取单例（首次调用需传入 getWorkspacePath） */
  static getInstance(getWorkspacePath?: WorkspacePathGetter): MeetingNotesManager {
    if (!MeetingNotesManager.instance) {
      if (!getWorkspacePath) {
        throw new Error('[MeetingNotesManager] 首次 getInstance 必须传入 getWorkspacePath')
      }
      MeetingNotesManager.instance = new MeetingNotesManager(getWorkspacePath)
    }
    return MeetingNotesManager.instance
  }

  /** 暴露工作区路径获取器（供 IPC handler 使用） */
  getWorkspacePathGetter(): WorkspacePathGetter {
    return this.getWorkspacePath
  }

  /**
   * 显示会议纪要窗口（已存在则聚焦，不存在则创建）
   *
   * 幂等：重复调用安全。窗口已存在时 restore + focus，不重建。
   */
  show(): void {
    this.registerIpc()
    const win = this.ensureWindow()

    if (win.isMinimized()) {
      win.restore()
    }
    if (!win.isVisible()) {
      win.show()
    }
    win.focus()
    logger.system.info('[MeetingNotes] Window shown')
  }

  /** 关闭窗口（不销毁，保留 warm renderer 便于下次快速显示） */
  hide(): void {
    if (this.window && !this.window.isDestroyed() && this.window.isVisible()) {
      this.window.hide()
    }
  }

  /** 销毁窗口（应用退出时调用） */
  destroy(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.destroy()
    }
    this.window = null
  }

  /** 向窗口发送消息 */
  sendToWindow(channel: string, ...args: unknown[]): void {
    if (
      this.window &&
      !this.window.isDestroyed() &&
      !this.window.webContents.isDestroyed()
    ) {
      this.window.webContents.send(channel, ...args)
    }
  }

  // --------------------------------------------
  // 内部实现
  // --------------------------------------------

  /** 注册 IPC（幂等，仅注册一次） */
  private registerIpc(): void {
    if (this.ipcRegistered) return
    this.ipcRegistered = true
    registerMeetingNotesIpc(this)
  }

  /** 懒创建/复用窗口 */
  private ensureWindow(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) {
      return this.window
    }

    this.window = new BrowserWindow({
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT,
      minWidth: WINDOW_MIN_WIDTH,
      minHeight: WINDOW_MIN_HEIGHT,
      title: 'AweeClaw 会议纪要',
      frame: true,
      resizable: true,
      maximizable: true,
      minimizable: true,
      fullscreenable: false,
      show: false, // ready-to-show 后再显示，避免白底闪烁
      backgroundColor: '#1a1a1a',
      webPreferences: {
        preload: path.join(__dirname, '../preload/preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    })

    // 渲染层首次绘制完成后再显示，避免白底闪现
    this.window.once('ready-to-show', () => {
      this.window?.show()
      this.window?.focus()
    })

    // 加载失败日志
    this.window.webContents.on('did-fail-load', (_e, errorCode, errorDescription) => {
      logger.system.error(
        `[MeetingNotes] Window load failed: ${errorCode} ${errorDescription}`,
      )
    })

    this.window.on('closed', () => {
      this.window = null
    })

    this.loadContent()
    logger.system.info('[MeetingNotes] Window created')
    return this.window
  }

  /** 加载窗口内容：生产 loadFile / 开发 loadURL */
  private loadContent(): void {
    if (!this.window) return

    if (app.isPackaged) {
      const filePath = path.join(__dirname, '../renderer/meeting-notes.html')
      this.window.loadFile(filePath)
      return
    }

    if (process.env.VITE_DEV_SERVER_URL) {
      const devUrl = `${process.env.VITE_DEV_SERVER_URL}meeting-notes.html`
      this.window.loadURL(devUrl)
      return
    }

    // 非打包且无开发服务器：回退到构建产物
    const filePath = path.join(__dirname, '../renderer/meeting-notes.html')
    this.window.loadFile(filePath)
  }
}
