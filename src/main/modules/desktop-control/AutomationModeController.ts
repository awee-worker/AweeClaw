/**
 * 自动化模式控制器（Automation Mode Controller）
 *
 * 职责：
 * 1. 维护"桌面自动化模式"的全局状态（进入 / 退出 / 步骤进度）
 * 2. 创建独立的透明全屏置顶覆盖窗口，渲染边缘光晕 + 右下角悬浮退出按钮
 * 3. 在自动化运行期间锁定用户输入：
 *    - 默认阻塞模式：覆盖窗口捕获所有鼠标事件，用户只能点击退出按钮
 *    - 输入穿透模式：AI 执行输入动作前瞬间切换为 click-through，让模拟事件穿透到目标应用
 * 4. 注册全局快捷键作为安全兜底退出通道
 * 5. 与 EmergencyStop 联动：紧急停止触发时自动退出自动化模式
 *
 * 设计要点：
 * - 单例模式，进程内唯一
 * - 继承 EventEmitter，向渲染层（覆盖窗口）推送状态变更与步骤进度
 * - 覆盖窗口复用主渲染构建产物，通过 ?window=automation-overlay 路由轻量加载
 *
 * 输入锁定说明：
 *   Electron 无法在无原生钩子的前提下拦截 OS 级物理键盘事件。
 *   本控制器通过覆盖窗口阻塞鼠标点击（默认阻塞模式）实现"用户无法点击屏幕其他内容"；
 *   键盘层面提供全局快捷键 CommandOrControl+Alt+Q 作为安全退出兜底。
 *   如需 OS 级键盘完全锁定，需后续接入原生输入钩子模块（CGEventTap / WH_KEYBOARD_LL）。
 *
 * @module desktop-control/AutomationModeController
 */

import { EventEmitter } from 'events'
import {
  app,
  BrowserWindow,
  screen,
  globalShortcut,
  type BrowserWindowConstructorOptions,
} from 'electron'
import * as path from 'path'
import { logger } from '@shared/toolkit/LogEngine'
import {
  getEmergencyStopController,
  EMERGENCY_STOP_EVENT,
  type EmergencyStopState,
} from './EmergencyStop'

// ============================================
// 事件常量
// ============================================

export const AUTOMATION_EVENT_STATE_CHANGE = 'automation:state-change'
export const AUTOMATION_EVENT_STEP = 'automation:step'
export const AUTOMATION_EVENT_LOG = 'automation:log'

/** 覆盖窗口路由标识（渲染层 bootstrap 据此加载覆盖 UI） */
export const AUTOMATION_OVERLAY_ROUTE = 'automation-overlay'

/** 安全退出快捷键（自动化模式期间注册，退出后立即注销） */
const EMERGENCY_EXIT_ACCELERATOR = 'CommandOrControl+Alt+Q'

// ============================================
// 类型定义
// ============================================

/** 自动化模式状态 */
export interface AutomationModeState {
  /** 是否处于自动化模式 */
  readonly active: boolean
  /** 当前任务描述 */
  readonly task: string
  /** 已执行步数 */
  readonly currentStep: number
  /** 最大步数（0 表示未限定） */
  readonly maxSteps: number
  /** 进入时间戳（ms） */
  readonly startedAt: number | null
  /** 退出原因（仅 inactive 时有效） */
  readonly lastExitReason: string | null
}

/** 步骤进度信息（推送至覆盖窗口展示） */
export interface AutomationStepInfo {
  /** 步骤序号（从 0 开始） */
  index: number
  /** 动作类型（click / type_text / ...） */
  actionType: string
  /** 动作描述 */
  description: string
  /** 状态：running / completed / error */
  status: 'running' | 'completed' | 'error'
  /** 时间戳 */
  timestamp: number
}

/** 进入自动化模式参数 */
export interface AutomationEnterParams {
  /** 任务描述 */
  task: string
  /** 最大步数（可选） */
  maxSteps?: number
}

/** IPC 推送至渲染层的事件 payload */
export interface AutomationStatePayload extends AutomationModeState {}
export interface AutomationStepPayload extends AutomationStepInfo {}

// ============================================
// 控制器实现
// ============================================

/**
 * 自动化模式控制器
 *
 * 使用方式：
 * ```ts
 * const ctrl = getAutomationModeController()
 * ctrl.bindMainWindow(mainWindow)
 * await ctrl.enter({ task: '打开浏览器搜索天气', maxSteps: 15 })
 * // ... AI 执行过程中：
 * ctrl.setInputElementActive(true)   // AI 即将输入，切换为穿透
 * await manager.mouseClick(...)
 * ctrl.setInputElementActive(false)  // 输入完成，恢复阻塞
 * // 任务完成或用户点击退出按钮：
 * await ctrl.exit('task completed')
 * ```
 */
export class AutomationModeController extends EventEmitter {
  private overlayWindow: BrowserWindow | null = null
  private mainWindow: BrowserWindow | null = null

  private active = false
  private task = ''
  private currentStep = 0
  private maxSteps = 0
  private startedAt: number | null = null
  private lastExitReason: string | null = null

  /** 输入穿透模式标志（true=AI 正在输入，覆盖窗口 click-through） */
  private inputPassthrough = false

  /** 紧急停止事件解绑函数 */
  private unsubscribeEmergencyStop: (() => void) | null = null

  /** 绑定主窗口（用于确认弹窗 alwaysOnTop 切换） */
  bindMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
    logger.desktop?.info?.('[AutomationMode] Main window bound')
  }

  /** 当前状态快照 */
  getState(): AutomationModeState {
    return {
      active: this.active,
      task: this.task,
      currentStep: this.currentStep,
      maxSteps: this.maxSteps,
      startedAt: this.startedAt,
      lastExitReason: this.lastExitReason,
    }
  }

  /** 是否处于自动化模式 */
  isActive(): boolean {
    return this.active
  }

  /**
   * 进入自动化模式
   * - 创建并显示覆盖窗口
   * - 注册安全退出快捷键
   * - 监听紧急停止
   * @returns 是否成功进入（已在自动化模式时返回 false）
   */
  async enter(params: AutomationEnterParams): Promise<boolean> {
    if (this.active) {
      logger.desktop?.warn?.('[AutomationMode] Already active, update task only')
      this.task = params.task
      this.maxSteps = params.maxSteps ?? 0
      this.emitStateChange()
      return false
    }

    logger.desktop?.info?.(`[AutomationMode] Entering: task="${params.task}", maxSteps=${params.maxSteps ?? 0}`)

    this.task = params.task
    this.maxSteps = params.maxSteps ?? 0
    this.currentStep = 0
    this.startedAt = Date.now()
    this.lastExitReason = null
    this.inputPassthrough = false

    // 1. 创建覆盖窗口
    await this.createOverlayWindow()

    // 2. 注册安全退出快捷键
    this.registerEmergencyExitShortcut()

    // 3. 监听紧急停止
    this.subscribeEmergencyStop()

    // 4. 默认进入阻塞模式（覆盖窗口捕获鼠标，仅退出按钮可点击）
    this.applyBlockingMode()

    this.active = true
    this.emitStateChange()

    logger.desktop?.info?.('[AutomationMode] Entered successfully')
    return true
  }

  /**
   * 退出自动化模式
   * - 隐藏并销毁覆盖窗口
   * - 注销快捷键
   * - 解除紧急停止监听
   * - 恢复输入穿透标志
   */
  async exit(reason: string): Promise<void> {
    if (!this.active) {
      logger.desktop?.warn?.(`[AutomationMode] Not active, ignore exit (reason=${reason})`)
      return
    }

    logger.desktop?.info?.(`[AutomationMode] Exiting: reason=${reason}`)

    this.active = false
    this.lastExitReason = reason
    this.inputPassthrough = false

    this.unregisterEmergencyExitShortcut()
    this.unsubscribeEmergencyStop?.()
    this.unsubscribeEmergencyStop = null

    await this.destroyOverlayWindow()

    this.currentStep = 0
    this.startedAt = null
    this.emitStateChange()
  }

  /**
   * 切换输入穿透模式
   * - true：AI 即将执行输入动作，覆盖窗口设为 click-through，模拟事件穿透到目标应用
   * - false：输入动作完成，恢复阻塞模式，用户无法点击屏幕其他内容
   */
  setInputElementActive(active: boolean): void {
    if (!this.active) return
    if (this.inputPassthrough === active) return

    this.inputPassthrough = active
    if (active) {
      this.applyPassthroughMode()
    } else {
      this.applyBlockingMode()
    }
    logger.desktop?.info?.(`[AutomationMode] Input passthrough = ${active}`)
  }

  /**
   * 推送步骤进度到覆盖窗口
   * 同时更新内部 currentStep 计数
   */
  reportStep(step: AutomationStepInfo): void {
    this.currentStep = Math.max(this.currentStep, step.index + 1)
    this.emit(AUTOMATION_EVENT_STEP, step)
    this.sendToOverlay(AUTOMATION_EVENT_STEP, step)
  }

  /** 推送日志到覆盖窗口 */
  reportLog(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    const payload = { message, level, timestamp: Date.now() }
    this.emit(AUTOMATION_EVENT_LOG, payload)
    this.sendToOverlay(AUTOMATION_EVENT_LOG, payload)
  }

  /**
   * 由覆盖窗口退出按钮触发
   * 视为用户主动退出，同时触发紧急停止以中断正在运行的视觉闭环
   *
   * 关键：必须先取消 emergency stop 订阅，再触发 trigger。
   * 否则 emergency stop 事件 handler 会并发调用 exit()，
   * 导致 overlay 窗口在 IPC 返回值送达前被销毁，渲染端永远卡在 await 状态。
   */
  async requestUserExit(): Promise<void> {
    logger.desktop?.info?.('[AutomationMode] User requested exit via overlay button')

    // 1. 先取消 emergency stop 订阅，避免 handler 并发调用 exit 销毁窗口
    this.unsubscribeEmergencyStop?.()
    this.unsubscribeEmergencyStop = null

    // 2. 触发紧急停止（同步 emit），中断 VisualAgentLoop 等长时操作
    //    此时 handler 已取消订阅，不会触发 exit
    try {
      getEmergencyStopController().trigger({
        source: 'user',
        reason: 'User clicked exit button on automation overlay',
      })
    } catch (err) {
      logger.desktop?.error?.('[AutomationMode] Trigger emergency stop failed:', err)
    }

    // 3. 由本次调用独占执行 exit，销毁覆盖窗口
    //    IPC 返回值能在窗口销毁前送达渲染端
    await this.exit('user-exit-button')
  }

  // ============================================
  // 内部：覆盖窗口生命周期
  // ============================================

  private async createOverlayWindow(): Promise<void> {
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      this.overlayWindow.show()
      return
    }

    const primaryDisplay = screen.getPrimaryDisplay()
    const { width, height } = primaryDisplay.bounds

    const options: BrowserWindowConstructorOptions = {
      width,
      height,
      x: primaryDisplay.bounds.x,
      y: primaryDisplay.bounds.y,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      focusable: false, // 不抢焦点，保证 AI 输入作用于目标应用
      hasShadow: false,
      backgroundColor: '#00000000',
      alwaysOnTop: true,
      webPreferences: {
        preload: path.join(__dirname, '../preload/preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        backgroundThrottling: false,
      },
    }

    this.overlayWindow = new BrowserWindow(options)

    // 置顶层级：screen-saver 之上、普通窗口之上（macOS: 'screen-saver'；其他平台: 'pop-up-menu'）
    this.overlayWindow.setAlwaysOnTop(true, 'screen-saver')
    // 所有工作区可见，确保用户切换桌面时覆盖层仍在
    this.overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

    // 加载覆盖窗口路由（复用主渲染构建产物）
    await this.loadOverlayURL()

    // 窗口关闭时清理引用
    this.overlayWindow.on('closed', () => {
      this.overlayWindow = null
    })

    // 防止覆盖窗口被意外关闭后状态不一致
    this.overlayWindow.on('hide', () => {
      // 不主动退出，仅记录
      logger.desktop?.info?.('[AutomationMode] Overlay window hidden')
    })

    logger.desktop?.info?.('[AutomationMode] Overlay window created')
  }

  private async loadOverlayURL(): Promise<void> {
    if (!this.overlayWindow) return

    const query = { window: AUTOMATION_OVERLAY_ROUTE }

    if (app.isPackaged) {
      await this.overlayWindow.loadFile(
        path.join(__dirname, '../renderer/index.html'),
        { query },
      )
    } else if (process.env.VITE_DEV_SERVER_URL) {
      const base = process.env.VITE_DEV_SERVER_URL.replace(/\/$/, '')
      const qs = new URLSearchParams(query).toString()
      await this.overlayWindow.loadURL(`${base}?${qs}`)
    } else {
      await this.overlayWindow.loadFile(
        path.join(__dirname, '../renderer/index.html'),
        { query },
      )
    }
  }

  private async destroyOverlayWindow(): Promise<void> {
    if (!this.overlayWindow) return
    const win = this.overlayWindow
    this.overlayWindow = null
    try {
      win.hide()
      win.destroy()
    } catch (err) {
      logger.desktop?.error?.('[AutomationMode] Destroy overlay failed:', err)
    }
  }

  // ============================================
  // 内部：输入锁定模式切换
  // ============================================

  /** 阻塞模式：覆盖窗口捕获所有鼠标事件，用户仅能点击退出按钮 */
  private applyBlockingMode(): void {
    if (!this.overlayWindow || this.overlayWindow.isDestroyed()) return
    // forward=false：不转发鼠标事件到底层，覆盖窗口全量接收
    this.overlayWindow.setIgnoreMouseEvents(false, { forward: false })
  }

  /** 穿透模式：覆盖窗口 click-through，AI 模拟事件可作用于目标应用 */
  private applyPassthroughMode(): void {
    if (!this.overlayWindow || this.overlayWindow.isDestroyed()) return
    // forward=true：鼠标移动事件仍转发，点击事件穿透到底层窗口
    this.overlayWindow.setIgnoreMouseEvents(true, { forward: true })
  }

  // ============================================
  // 内部：快捷键 & 紧急停止
  // ============================================

  private registerEmergencyExitShortcut(): void {
    try {
      // 避免重复注册
      globalShortcut.unregister(EMERGENCY_EXIT_ACCELERATOR)
      const ok = globalShortcut.register(EMERGENCY_EXIT_ACCELERATOR, () => {
        logger.desktop?.info?.('[AutomationMode] Emergency exit shortcut triggered')
        void this.requestUserExit()
      })
      if (!ok) {
        logger.desktop?.warn?.(`[AutomationMode] Failed to register shortcut: ${EMERGENCY_EXIT_ACCELERATOR}`)
      }
    } catch (err) {
      logger.desktop?.error?.('[AutomationMode] Register shortcut failed:', err)
    }
  }

  private unregisterEmergencyExitShortcut(): void {
    try {
      globalShortcut.unregister(EMERGENCY_EXIT_ACCELERATOR)
    } catch (err) {
      logger.desktop?.error?.('[AutomationMode] Unregister shortcut failed:', err)
    }
  }

  private subscribeEmergencyStop(): void {
    const stopCtrl = getEmergencyStopController()
    const handler = (state: EmergencyStopState): void => {
      if (state.stopped && this.active) {
        logger.desktop?.info?.('[AutomationMode] Emergency stop detected, auto-exit')
        void this.exit('emergency-stop')
      }
    }
    stopCtrl.on(EMERGENCY_STOP_EVENT, handler)
    this.unsubscribeEmergencyStop = (): void => {
      stopCtrl.off(EMERGENCY_STOP_EVENT, handler)
    }
  }

  // ============================================
  // 内部：渲染层通信
  // ============================================

  private emitStateChange(): void {
    const payload = this.getState()
    this.emit(AUTOMATION_EVENT_STATE_CHANGE, payload)
    this.sendToOverlay(AUTOMATION_EVENT_STATE_CHANGE, payload)
  }

  private sendToOverlay(channel: string, payload: unknown): void {
    if (!this.overlayWindow || this.overlayWindow.isDestroyed()) return
    try {
      this.overlayWindow.webContents.send(`desktop:${channel}`, payload)
    } catch (err) {
      logger.desktop?.warn?.('[AutomationMode] Send to overlay failed:', err)
    }
  }

  /**
   * 确认弹窗期间临时置主窗口置顶（由 DesktopControlManager 调用）
   * @returns 之前的 alwaysOnTop 状态，用于恢复
   */
  pushMainWindowAlwaysOnTop(): boolean {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return false
    const prev = this.mainWindow.isAlwaysOnTop()
    this.mainWindow.setAlwaysOnTop(true, 'pop-up-menu')
    this.mainWindow.focus()
    return prev
  }

  /** 恢复主窗口 alwaysOnTop 状态 */
  popMainWindowAlwaysOnTop(prev: boolean): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return
    this.mainWindow.setAlwaysOnTop(prev)
  }

  /** 应用退出时清理资源 */
  dispose(): void {
    this.unregisterEmergencyExitShortcut()
    this.unsubscribeEmergencyStop?.()
    this.unsubscribeEmergencyStop = null
    void this.destroyOverlayWindow()
    this.removeAllListeners()
  }
}

// ============================================
// 单例
// ============================================

let instance: AutomationModeController | null = null

/** 获取自动化模式控制器单例 */
export function getAutomationModeController(): AutomationModeController {
  if (!instance) {
    instance = new AutomationModeController()
  }
  return instance
}
