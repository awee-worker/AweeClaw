/**
 * 系统托盘管理器（单例）
 *
 * 作为悬浮头像的伴生入口：
 * - 关闭主窗口后，托盘图标维持应用存活（macOS/Windows/Linux 均生效）
 * - 托盘菜单提供：显示/隐藏头像、打开主窗口、设置、退出
 * - 托盘图标随语音状态变化（idle/对话中），便于用户感知
 *
 * 设计：
 * - 单例，destroy() 时销毁托盘
 * - macOS 上托盘图标建议 16x16/22x22 template image（自动适配深浅色），此处用 sizes/16.png
 * - Linux/Windows 用 app.png
 */

import { app, Tray, Menu, MenuItem, nativeImage } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import { logger } from '@shared/toolkit/LogEngine'
import { FloatingAvatarManager } from './FloatingAvatarManager'

/** 托盘菜单文案 */
interface TrayLabels {
  showAvatar: string
  hideAvatar: string
  openMainWindow: string
  settings: string
  quit: string
}

const LABELS_ZH: TrayLabels = {
  showAvatar: '显示头像',
  hideAvatar: '隐藏头像',
  openMainWindow: '打开主窗口',
  settings: '设置',
  quit: '退出',
}

const LABELS_EN: TrayLabels = {
  showAvatar: 'Show Avatar',
  hideAvatar: 'Hide Avatar',
  openMainWindow: 'Open Main Window',
  settings: 'Settings',
  quit: 'Quit',
}

/** 托盘回调（由上层注入） */
export interface TrayCallbacks {
  openMainWindow: () => void
  openSettings: () => void
  quitApp: () => void
}

/** 托盘图标状态 */
export type TrayIconState = 'idle' | 'listening' | 'conversation' | 'error'

export class TrayManager {
  private static instance: TrayManager | null = null
  private tray: Tray | null = null
  private labels: TrayLabels = LABELS_ZH
  private iconState: TrayIconState = 'idle'
  private callbacks: TrayCallbacks | null = null

  private constructor() {}

  static getInstance(): TrayManager {
    if (!TrayManager.instance) {
      TrayManager.instance = new TrayManager()
    }
    return TrayManager.instance
  }

  /** 创建托盘（若已存在则刷新） */
  create(callbacks: TrayCallbacks): Tray | null {
    this.callbacks = callbacks
    if (this.tray && !this.tray.isDestroyed()) {
      this.rebuildMenu()
      return this.tray
    }

    const iconPath = this.resolveTrayIcon()
    if (!iconPath) {
      logger.system.warn('[TrayManager] Tray icon not found, tray disabled')
      return null
    }

    let image: Electron.NativeImage
    try {
      image = nativeImage.createFromPath(iconPath)
      // macOS template image：自动适配深浅色（仅对单色图标有效）
      if (process.platform === 'darwin') {
        image.setTemplateImage(true)
      }
      if (image.isEmpty()) {
        logger.system.warn('[TrayManager] Tray icon image is empty:', iconPath)
      }
    } catch (err) {
      logger.system.error('[TrayManager] Failed to create tray icon:', err)
      return null
    }

    this.tray = new Tray(image)
    this.tray.setToolTip('AweeClaw')
    this.rebuildMenu()

    // 点击托盘图标：切换头像显示/隐藏（macOS 左键单击、Windows 左键单击）
    this.tray.on('click', () => {
      const manager = FloatingAvatarManager.getInstance()
      manager.toggle()
    })

    logger.system.info('[TrayManager] Tray created', { iconPath })
    return this.tray
  }

  /** 设置语言并重建菜单 */
  setLanguage(language: 'zh' | 'en'): void {
    this.labels = language === 'en' ? LABELS_EN : LABELS_ZH
    this.rebuildMenu()
  }

  /** 更新托盘图标状态 */
  setIconState(state: TrayIconState): void {
    if (this.iconState === state) return
    this.iconState = state
    // 状态变化时刷新 tooltip（图标本身保持不变，避免多套图标的维护成本）
    if (this.tray && !this.tray.isDestroyed()) {
      const tooltip = this.buildTooltip(state)
      this.tray.setToolTip(tooltip)
    }
  }

  /** 重建托盘菜单 */
  private rebuildMenu(): void {
    if (!this.tray || this.tray.isDestroyed() || !this.callbacks) return

    const manager = FloatingAvatarManager.getInstance()
    const isVisible = manager.isVisible()

    const menu = Menu.buildFromTemplate([
      new MenuItem({
        label: isVisible ? this.labels.hideAvatar : this.labels.showAvatar,
        click: () => manager.toggle(),
      }),
      new MenuItem({
        label: this.labels.openMainWindow,
        click: () => this.callbacks?.openMainWindow(),
      }),
      new MenuItem({ type: 'separator' }),
      new MenuItem({
        label: this.labels.settings,
        click: () => this.callbacks?.openSettings(),
      }),
      new MenuItem({ type: 'separator' }),
      new MenuItem({
        label: this.labels.quit,
        click: () => this.callbacks?.quitApp(),
      }),
    ])

    this.tray.setContextMenu(menu)
  }

  /** 构建 tooltip 文案 */
  private buildTooltip(state: TrayIconState): string {
    const base = 'AweeClaw'
    switch (state) {
      case 'listening':
        return `${base} - 正在聆听唤醒词…`
      case 'conversation':
        return `${base} - 语音对话中`
      case 'error':
        return `${base} - 发生错误`
      case 'idle':
      default:
        return base
    }
  }

  /** 解析托盘图标路径 */
  private resolveTrayIcon(): string | null {
    const brandIconDir = path.join(app.getAppPath(), 'public/brand/icons')

    if (process.platform === 'darwin') {
      // macOS 托盘推荐 16x16 或 22x22 template image
      const candidates = [
        path.join(brandIconDir, 'sizes/app/16.png'),
        path.join(brandIconDir, 'sizes/app/32.png'),
        path.join(brandIconDir, 'app.png'),
      ]
      return candidates.find((p) => fs.existsSync(p)) || null
    }

    if (process.platform === 'win32') {
      // Windows 托盘推荐 16x16 或 32x32 .ico
      const candidates = [
        path.join(brandIconDir, 'app.ico'),
        path.join(brandIconDir, 'sizes/app/32.png'),
        path.join(brandIconDir, 'app.png'),
      ]
      return candidates.find((p) => fs.existsSync(p)) || null
    }

    // Linux
    const candidates = [
      path.join(brandIconDir, 'sizes/app/32.png'),
      path.join(brandIconDir, 'app.png'),
    ]
    return candidates.find((p) => fs.existsSync(p)) || null
  }

  /** 销毁托盘（彻底退出时调用） */
  destroy(): void {
    if (this.tray && !this.tray.isDestroyed()) {
      this.tray.destroy()
      logger.system.info('[TrayManager] Tray destroyed')
    }
    this.tray = null
  }

  /** 是否已创建 */
  isCreated(): boolean {
    return !!this.tray && !this.tray.isDestroyed()
  }
}
