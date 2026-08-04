/**
 * 头像右键菜单（自定义菜单窗口版）
 *
 * 在头像窗口上右键时弹出，提供：
 * - 显示/隐藏头像
 * - 打开主窗口
 * - 截图提问
 * - 语音唤醒开关
 * - 设置（打开主窗口的语音设置）
 * - 退出应用（触发完整退出，头像+托盘消失）
 *
 * 实现：不再使用原生 Menu.popup（坐标系行为不稳定 + 菜单宽度不可知导致定位误差），
 * 改用 AvatarMenuWindow（独立透明窗口 + React 渲染菜单），
 * setPosition 使用确定的屏幕坐标，菜单宽度 CSS 固定，定位精确。
 *
 * 定位规则：
 * - 头像在屏幕右半 → 菜单显示在头像【左侧】（菜单右边缘贴头像左边缘）
 * - 头像在屏幕左半 → 菜单显示在头像【右侧】（菜单左边缘贴头像右边缘）
 * - 菜单顶部对齐头像顶部
 *
 * 设计：菜单文案随语言切换（zh/en），通过 setLanguage 刷新。
 */

import { BrowserWindow, screen } from 'electron'
import { AvatarMenuWindow, MENU_WIDTH, type AvatarMenuLabels } from './AvatarMenuWindow'

/** 菜单文案 */
interface MenuLabels {
  showAvatar: string
  hideAvatar: string
  openMainWindow: string
  screenshotAsk: string
  meetingNotes: string
  wakeWord: string
  settings: string
  quit: string
}

/** 中文文案 */
const LABELS_ZH: MenuLabels = {
  showAvatar: '显示头像',
  hideAvatar: '隐藏头像',
  openMainWindow: '打开主窗口',
  screenshotAsk: '截图提问',
  meetingNotes: '会议纪要',
  wakeWord: '语音唤醒',
  settings: '设置',
  quit: '退出',
}

/** 英文文案 */
const LABELS_EN: MenuLabels = {
  showAvatar: 'Show Avatar',
  hideAvatar: 'Hide Avatar',
  openMainWindow: 'Open Main Window',
  screenshotAsk: 'Screenshot & Ask',
  meetingNotes: 'Meeting Notes',
  wakeWord: 'Wake Word',
  settings: 'Settings',
  quit: 'Quit',
}

/** 菜单回调集合（由上层注入，避免直接依赖 appBootstrap/windowManager 造成循环依赖） */
export interface AvatarMenuCallbacks {
  /** 打开/创建并聚焦主窗口 */
  openMainWindow: () => void
  /** 截图提问：启动全屏区域选择 → 截图 → 推送到头像窗口 */
  startScreenshotAsk: () => void
  /** 会议纪要：打开会议纪要窗口 */
  startMeetingNotes: () => void
  /** 打开设置（语音设置） */
  openSettings: () => void
  /** 退出应用（触发完整退出流程） */
  quitApp: () => void
  /** 读取语音唤醒开关当前状态 */
  isWakeWordEnabled: () => boolean
  /** 切换语音唤醒开关，返回切换后的状态 */
  toggleWakeWord: () => Promise<boolean>
  /** 通知头像窗口唤醒开关已变化（供 UI 同步） */
  notifyWakeWordChanged: (enabled: boolean) => void
}

/**
 * 头像右键菜单管理器
 *
 * 用法：
 * 1. const menu = new AvatarMenu(callbacks)
 * 2. menu.attach(window)  —— 绑定到头像窗口的 context-menu 事件
 * 3. menu.setLanguage('en') —— 语言切换时刷新文案
 */
export class AvatarMenu {
  private labels: MenuLabels = LABELS_ZH

  constructor(private callbacks: AvatarMenuCallbacks) {}

  /** 设置语言（下次弹出菜单时生效） */
  setLanguage(language: 'zh' | 'en'): void {
    this.labels = language === 'en' ? LABELS_EN : LABELS_ZH
    // 同步到菜单窗口（若已配置）
    this.configureMenuWindow()
  }

  /** 绑定到头像窗口（监听 webContents 的 context-menu 事件弹出自定义菜单） */
  attach(win: BrowserWindow): void {
    this.configureMenuWindow()

    // webContents 'context-menu' 事件：用户在窗口内右键时触发
    win.webContents.on('context-menu', () => {
      this.popup(win)
    })
  }

  /** 注入动作回调与文案到菜单窗口 */
  private configureMenuWindow(): void {
    const menuWindow = AvatarMenuWindow.getInstance()
    menuWindow.configure(
      {
        openMainWindow: () => this.callbacks.openMainWindow(),
        startScreenshotAsk: () => this.callbacks.startScreenshotAsk(),
        startMeetingNotes: () => this.callbacks.startMeetingNotes(),
        openSettings: () => this.callbacks.openSettings(),
        quitApp: () => this.callbacks.quitApp(),
        toggleWakeWord: () => this.callbacks.toggleWakeWord(),
        notifyWakeWordChanged: (enabled) => this.callbacks.notifyWakeWordChanged(enabled),
      },
      this.labels as AvatarMenuLabels,
    )
    menuWindow.setWakeEnabledGetter(() => this.callbacks.isWakeWordEnabled())
  }

  /**
   * 弹出菜单：计算菜单左上角屏幕坐标后调 AvatarMenuWindow.showAt
   *
   * 计算要素（全部为确定值，无估算）：
   * - 头像屏幕坐标 (winX, winY)、头像宽高 (winW)
   * - 菜单固定宽度 MENU_WIDTH（与渲染层 CSS 一致）
   * - 头像所在显示器 workArea 中心 → 判断头像在屏幕左半/右半
   */
  private popup(win: BrowserWindow): void {
    const [winX, winY] = win.getPosition()
    const [winW] = win.getSize()

    // 头像中心 x（屏幕坐标）
    const avatarCenterX = winX + Math.floor(winW / 2)
    // 头像所在显示器 workArea 中心 x
    const workArea = screen.getDisplayNearestPoint({ x: winX, y: winY }).workArea
    const workAreaCenterX = workArea.x + Math.floor(workArea.width / 2)

    let menuX: number
    if (avatarCenterX >= workAreaCenterX) {
      // 头像在屏幕右半 → 菜单在头像左侧：菜单右边缘贴头像左边缘
      menuX = winX - MENU_WIDTH
      // 兜底：左侧超出 workArea → 改为头像右侧
      if (menuX < workArea.x) {
        menuX = winX + winW
      }
    } else {
      // 头像在屏幕左半 → 菜单在头像右侧：菜单左边缘贴头像右边缘
      menuX = winX + winW
      // 兜底：右侧超出 workArea → 改为头像左侧
      if (menuX + MENU_WIDTH > workArea.x + workArea.width) {
        menuX = winX - MENU_WIDTH
      }
    }

    // 菜单顶部对齐头像顶部
    const menuY = winY

    AvatarMenuWindow.getInstance().showAt(menuX, menuY)
  }
}
