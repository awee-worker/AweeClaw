/**
 * 邮件中心窗口管理器（单例）
 *
 * 职责：
 * - 创建/复用/显示/聚焦/销毁邮件中心 BrowserWindow（1200×800，可调整大小）
 * - 常驻复用：show() 时若窗口已存在则 restore+focus，不重建
 * - 注册 mail:window:show IPC handler（幂等）
 *
 * 窗口属性要点：
 * - frame:true 有原生标题栏，标题「AweeClaw 邮件中心」
 * - show:false + ready-to-show 防止白底闪烁
 * - 不注册进 windowManager.windows Map（与悬浮头像/会议纪要一致，避免影响 window-all-closed）
 */

import { app, BrowserWindow } from 'electron'
import * as path from 'path'
import { logger } from '@shared/toolkit/LogEngine'
import { safeIpcHandle } from '../../bridge/core/ipcGuard'

/** 窗口默认尺寸 */
const WINDOW_WIDTH = 1200
const WINDOW_HEIGHT = 800
const WINDOW_MIN_WIDTH = 900
const WINDOW_MIN_HEIGHT = 560

export class MailCenterManager {
  private static instance: MailCenterManager | null = null

  private window: BrowserWindow | null = null
  private ipcRegistered = false

  private constructor() {
    // 构造即注册窗口 IPC（不创建窗口，懒创建）
    this.registerIpc()
  }

  /** 获取单例 */
  static getInstance(): MailCenterManager {
    if (!MailCenterManager.instance) {
      MailCenterManager.instance = new MailCenterManager()
    }
    return MailCenterManager.instance
  }

  /**
   * 显示邮件中心窗口（已存在则聚焦，不存在则创建）
   *
   * 幂等：重复调用安全。窗口已存在时 restore + focus，不重建。
   */
  show(): void {
    const win = this.ensureWindow()

    if (win.isMinimized()) {
      win.restore()
    }
    if (!win.isVisible()) {
      win.show()
    }
    win.focus()
    logger.system.info('[MailCenter] Window shown')
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

  /** 向窗口发送消息（供后续实时刷新使用） */
  sendToWindow(channel: string, ...args: unknown[]): void {
    if (this.window && !this.window.isDestroyed() && !this.window.webContents.isDestroyed()) {
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

    safeIpcHandle('mail:window:show', async () => {
      this.show()
      return { success: true }
    })

    safeIpcHandle('mail:window:hide', async () => {
      this.hide()
      return { success: true }
    })
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
      title: 'AweeClaw 邮件中心',
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

    this.window.once('ready-to-show', () => {
      this.window?.show()
      this.window?.focus()
    })

    this.window.webContents.on('did-fail-load', (_e, errorCode, errorDescription) => {
      logger.system.error(`[MailCenter] Window load failed: ${errorCode} ${errorDescription}`)
    })

    this.window.on('closed', () => {
      this.window = null
    })

    this.loadContent()
    logger.system.info('[MailCenter] Window created')
    return this.window
  }

  /** 加载窗口内容：生产 loadFile / 开发 loadURL */
  private loadContent(): void {
    if (!this.window) return

    if (app.isPackaged) {
      this.window.loadFile(path.join(__dirname, '../renderer/mail-center.html'))
      return
    }

    if (process.env.VITE_DEV_SERVER_URL) {
      this.window.loadURL(`${process.env.VITE_DEV_SERVER_URL}mail-center.html`)
      return
    }

    // 非打包且无开发服务器：回退到构建产物
    this.window.loadFile(path.join(__dirname, '../renderer/mail-center.html'))
  }
}

/** 全局单例 */
export const mailCenterManager = MailCenterManager.getInstance()
