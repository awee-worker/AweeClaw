/**
 * 头像右键菜单窗口（自定义渲染菜单）
 *
 * 为什么不用原生 Menu.popup：
 * - Menu.popup 的 x/y 坐标系在不同传参/平台下行为不一致（窗口相对 vs 屏幕坐标），
 *   头像窗口为透明不可聚焦悬浮窗，拖动后参考系错乱导致菜单出现在错误位置
 * - 原生菜单宽度无法精确获取，向左展开时估算宽度永远有间隙/重叠误差
 *
 * 方案：独立【不透明】无边框窗口渲染 React 菜单：
 * - setPosition 使用【确定的屏幕坐标】，无坐标系歧义
 * - 菜单宽度 CSS 固定（MENU_WIDTH），定位计算精确无估算
 * - 不透明窗口在 macOS 上能正常接收鼠标事件（透明窗口在某些组合下吞鼠标事件）
 *
 * 关键教训：
 * - 之前用 transparent:true 的透明窗口，导致 webContents 收不到鼠标事件
 *   （窗口 visible/focused/inside 均为 true，但 mouseDown/mouseEnter 事件缺失）
 * - 菜单本身有完整背景（圆角卡片），不需要窗口透明，改用不透明窗口彻底解决
 *
 * 生命周期：
 * - 懒创建：首次 showAt 时创建窗口（复用 avatar.html?mode=menu 入口）
 * - showAt(x, y)：定位 + 显示 + 聚焦（聚焦用于接收 blur 关闭事件）
 * - blur / ESC / 点击项 → hide
 */

import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import { logger } from '@shared/toolkit/LogEngine'
import { FloatingAvatarManager } from './FloatingAvatarManager'

/** 菜单窗口固定宽度（px，与渲染层 CSS 宽度一致） */
export const MENU_WIDTH = 168
/** 菜单项高度（px） */
const MENU_ITEM_HEIGHT = 32
/** 分隔线高度（px，含上下 margin） */
const MENU_SEPARATOR_HEIGHT = 9
/** 菜单容器上下 padding（px） */
const MENU_VERTICAL_PADDING = 6

/** 菜单项 ID（渲染层点击后回传，主进程据此分发动作） */
export type AvatarMenuItemId =
  | 'toggle-avatar'
  | 'open-main-window'
  | 'screenshot-ask'
  | 'meeting-notes'
  | 'wake-word'
  | 'settings'
  | 'quit'

/** 菜单项描述（主进程 → 渲染层） */
export interface AvatarMenuItem {
  id: AvatarMenuItemId
  label: string
  /** 是否为分隔线（无 id/label） */
  separator?: boolean
  /** 是否勾选（语音唤醒开关状态） */
  checked?: boolean
}

/** 菜单动作回调（由 AvatarMenu 注入，复用现有回调集合） */
export interface AvatarMenuActions {
  openMainWindow: () => void
  startScreenshotAsk: () => void
  startMeetingNotes: () => void
  openSettings: () => void
  quitApp: () => void
  toggleWakeWord: () => Promise<boolean>
  notifyWakeWordChanged: (enabled: boolean) => void
}

/** 菜单文案（由 AvatarMenu 按语言注入） */
export interface AvatarMenuLabels {
  showAvatar: string
  hideAvatar: string
  openMainWindow: string
  screenshotAsk: string
  meetingNotes: string
  wakeWord: string
  settings: string
  quit: string
}

/**
 * 头像右键菜单窗口管理器（单例）
 */
export class AvatarMenuWindow {
  private static instance: AvatarMenuWindow | null = null

  private window: BrowserWindow | null = null
  private actions: AvatarMenuActions | null = null
  private labels: AvatarMenuLabels | null = null
  private ipcRegistered = false

  private constructor() {}

  static getInstance(): AvatarMenuWindow {
    if (!AvatarMenuWindow.instance) {
      AvatarMenuWindow.instance = new AvatarMenuWindow()
    }
    return AvatarMenuWindow.instance
  }

  /** 注入菜单动作回调与文案（attach 时调用一次；语言切换时重复调用更新文案） */
  configure(actions: AvatarMenuActions, labels: AvatarMenuLabels): void {
    this.actions = actions
    this.labels = labels
  }

  /** 弹出菜单窗口是否已完成首次渲染（ready-to-show），用于避免白底闪现 */
  private firstRenderReady = false
  /** 待显示的坐标（ready-to-show 触发前缓存，触发后据此定位显示） */
  private pendingShow: { x: number; y: number; width: number; height: number } | null = null

  /**
   * 在指定屏幕坐标显示菜单
   *
   * @param screenX 菜单左上角屏幕 x 坐标（调用方已按头像左右侧计算好）
   * @param screenY 菜单左上角屏幕 y 坐标（通常对齐头像顶部）
   */
  showAt(screenX: number, screenY: number): void {
    if (!this.actions || !this.labels) {
      logger.system.warn('[AvatarMenuWindow] Not configured, ignore showAt')
      return
    }

    try {
      this.registerIpc()
      const win = this.ensureWindow()
      const { width, height } = this.measureSize()

      if (this.firstRenderReady) {
        // 首次渲染已完成，直接定位显示（后续复用窗口无闪现）
        win.setSize(width, height)
        win.setPosition(Math.round(screenX), Math.round(screenY))
        win.show()
        win.focus()
        // 复用窗口时通知渲染层重新获取菜单项（勾选态等可能已变化）
        win.webContents.send('avatar-menu:refresh')
      } else {
        // 首次渲染未完成：缓存坐标，等 ready-to-show 事件触发后再显示
        // 窗口此时 show:false，用户看不到白底闪现
        win.setSize(width, height)
        win.setPosition(Math.round(screenX), Math.round(screenY))
        this.pendingShow = { x: screenX, y: screenY, width, height }
      }

      logger.system.debug('[AvatarMenuWindow] Shown', { screenX, screenY, width, height, ready: this.firstRenderReady })
    } catch (err) {
      logger.system.error('[AvatarMenuWindow] showAt failed:', err)
    }
  }

  /** 隐藏菜单 */
  hide(): void {
    if (this.window && !this.window.isDestroyed() && this.window.isVisible()) {
      this.window.hide()
    }
  }

  /** 菜单是否可见 */
  isVisible(): boolean {
    return !!this.window && !this.window.isDestroyed() && this.window.isVisible()
  }

  // --------------------------------------------
  // 内部实现
  // --------------------------------------------

  /** 计算菜单窗口尺寸（宽度固定，高度按菜单项/分隔线累加） */
  private measureSize(): { width: number; height: number } {
    const items = this.buildMenuItems()
    let height = MENU_VERTICAL_PADDING * 2
    for (const item of items) {
      height += item.separator ? MENU_SEPARATOR_HEIGHT : MENU_ITEM_HEIGHT
    }
    return { width: MENU_WIDTH, height }
  }

  /** 构建当前菜单项（文案/勾选态实时读取，保证显示最新状态） */
  private buildMenuItems(): AvatarMenuItem[] {
    const manager = FloatingAvatarManager.getInstance()
    const isVisible = manager.isVisible()
    const labels = this.labels!
    const wakeEnabled = this.wakeEnabledGetter ? this.wakeEnabledGetter() : false

    return [
      {
        id: 'toggle-avatar',
        label: isVisible ? labels.hideAvatar : labels.showAvatar,
      },
      { id: 'open-main-window', label: labels.openMainWindow },
      { id: 'toggle-avatar', label: '', separator: true },
      // 截图提问与会议纪要与语音唤醒同组（AI 交互能力组）
      { id: 'screenshot-ask', label: labels.screenshotAsk },
      { id: 'meeting-notes', label: labels.meetingNotes },
      { id: 'wake-word', label: labels.wakeWord, checked: wakeEnabled },
      { id: 'settings', label: labels.settings },
      { id: 'toggle-avatar', label: '', separator: true },
      { id: 'quit', label: labels.quit },
    ]
  }

  /** 唤醒开关状态读取器（由 AvatarMenu 注入，保持与原生菜单一致的数据源） */
  private wakeEnabledGetter: (() => boolean) | null = null

  /** 注入唤醒开关状态读取器 */
  setWakeEnabledGetter(getter: () => boolean): void {
    this.wakeEnabledGetter = getter
  }

  /** 懒创建菜单窗口 */
  private ensureWindow(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) {
      return this.window
    }

    this.window = new BrowserWindow({
      width: MENU_WIDTH,
      height: 200,
      frame: false,
      // 关键：不透明窗口！透明窗口（transparent:true）在 macOS 上会吞鼠标事件，
      // 导致 webContents 收不到 mouseDown/mouseEnter（visible/focused/inside 均为 true 但无事件）。
      // 菜单本身有完整背景，不需要窗口透明。
      transparent: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: true,
      // macOS 关键：非激活应用的窗口默认「首次点击只激活窗口、事件不传给内容」，
      // 导致菜单项 hover/点击全无反应。acceptFirstMouse 让首次点击直接传递给内容。
      acceptFirstMouse: true,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      hasShadow: false, // 渲染层容器自带阴影
      show: false,
      // 暗色背景：与菜单容器深色背景接近，减少首次显示时的白底闪现
      // （配合 ready-to-show 事件，窗口在渲染层完成首次绘制后才显示）
      backgroundColor: '#1a1a1a',
      webPreferences: {
        preload: path.join(__dirname, '../preload/preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    })

    // 层级高于头像窗口（'pop-up-menu' > 'screen-saver'），
    // 确保菜单浮在头像之上
    this.window.setAlwaysOnTop(true, 'pop-up-menu')

    // 首次渲染完成后再显示窗口，避免白底闪现
    // （窗口 show:false 创建，ready-to-show 表示渲染层已完成首次绘制）
    this.window.once('ready-to-show', () => {
      this.firstRenderReady = true
      if (this.pendingShow && this.window && !this.window.isDestroyed()) {
        const { x, y, width, height } = this.pendingShow
        this.pendingShow = null
        this.window.setSize(width, height)
        this.window.setPosition(Math.round(x), Math.round(y))
        this.window.show()
        this.window.focus()
      }
    })

    // 失焦自动关闭（点击菜单外区域）
    this.window.on('blur', () => {
      this.hide()
    })

    this.window.on('closed', () => {
      this.window = null
    })

    // 加载菜单页面（复用 avatar 入口，URL 参数 mode=menu 分流渲染菜单组件）
    if (app.isPackaged) {
      const avatarPath = path.join(__dirname, '../renderer/avatar.html')
      this.window.loadFile(avatarPath, { query: { mode: 'menu' } })
    } else if (process.env.VITE_DEV_SERVER_URL) {
      this.window.loadURL(`${process.env.VITE_DEV_SERVER_URL}avatar.html?mode=menu`)
    } else {
      const avatarPath = path.join(__dirname, '../renderer/avatar.html')
      this.window.loadFile(avatarPath, { query: { mode: 'menu' } })
    }

    return this.window
  }

  /** 注册 IPC handler（幂等） */
  private registerIpc(): void {
    if (this.ipcRegistered) return
    this.ipcRegistered = true

    // 渲染层获取菜单项（窗口加载完成后主动请求，避免推送时序问题）
    ipcMain.handle('avatar-menu:get-items', () => this.buildMenuItems())

    // 渲染层点击菜单项
    ipcMain.on('avatar-menu:click', async (_event, itemId: AvatarMenuItemId) => {
      try {
        await this.dispatchAction(itemId)
      } catch (err) {
        logger.system.error('[AvatarMenuWindow] Action failed:', { itemId, err })
      } finally {
        this.hide()
      }
    })

    // 渲染层请求关闭（ESC 键）
    ipcMain.on('avatar-menu:close', () => {
      this.hide()
    })
  }

  /** 分发菜单动作 */
  private async dispatchAction(itemId: AvatarMenuItemId): Promise<void> {
    const actions = this.actions
    if (!actions) return
    const manager = FloatingAvatarManager.getInstance()

    switch (itemId) {
      case 'toggle-avatar':
        manager.toggle()
        break
      case 'open-main-window':
        actions.openMainWindow()
        break
      case 'screenshot-ask':
        actions.startScreenshotAsk()
        break
      case 'meeting-notes':
        actions.startMeetingNotes()
        break
      case 'wake-word': {
        const next = await actions.toggleWakeWord()
        actions.notifyWakeWordChanged(next)
        manager.sendToAvatar('floating-avatar:wake-word-toggled', next)
        break
      }
      case 'settings':
        actions.openSettings()
        break
      case 'quit':
        actions.quitApp()
        break
    }
  }
}
