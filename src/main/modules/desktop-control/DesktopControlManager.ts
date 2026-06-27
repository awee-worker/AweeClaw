/**
 * 桌面控制编排器
 * 统一调度 AppLauncher / SystemInfoService / ProcessManager
 * / WindowManager / ScreenCaptureService / InputSimulator / FileManager
 * 在执行前进行权限校验，必要时弹窗确认
 */

import { BrowserWindow } from 'electron'
import { OperationType } from '@main/guard/securityPolicyEngine'
import { logger } from '@shared/toolkit/LogEngine'
import { getPlatformAdapter } from './platform'
import type { PlatformAdapter } from './platform/types'
import { AppLauncher } from './AppLauncher'
import { SystemInfoService } from './SystemInfo'
import { ProcessManager } from './ProcessManager'
import { WindowManager } from './WindowManager'
import { ScreenCaptureService } from './ScreenCapture'
import { InputSimulator } from './InputSimulator'
import { FileManager } from './FileManager'
import { DesktopGuard } from './DesktopGuard'
import {
  getEmergencyStopController,
  type EmergencyStopParams,
  type EmergencyStopState,
} from './EmergencyStop'
import { getAutomationModeController } from './AutomationModeController'
import type {
  AppInfo,
  LaunchResult,
  ActionResult,
  SystemInfo,
  ProcessInfo,
  WindowInfo,
  ScreenshotResult,
  Rect,
  MouseClickParams,
  MouseMoveParams,
  MouseScrollParams,
  MouseDragParams,
  FileOperationResult,
  FileInfo,
  InputOperationResult,
} from './types/actions'

export class DesktopControlManager {
  readonly launcher: AppLauncher
  readonly systemInfo: SystemInfoService
  readonly processManager: ProcessManager
  readonly windowManager: WindowManager
  readonly screenCapture: ScreenCaptureService
  readonly inputSimulator: InputSimulator
  readonly fileManager: FileManager
  readonly guard: DesktopGuard
  readonly emergencyStop = getEmergencyStopController()

  private mainWindow: BrowserWindow | null = null
  private adapter: PlatformAdapter

  constructor() {
    this.adapter = getPlatformAdapter()
    this.launcher = new AppLauncher(this.adapter)
    this.systemInfo = new SystemInfoService(this.adapter)
    this.processManager = new ProcessManager(this.adapter)
    this.windowManager = new WindowManager(this.adapter)
    this.screenCapture = new ScreenCaptureService(this.adapter)
    this.inputSimulator = new InputSimulator(this.adapter)
    this.fileManager = new FileManager()
    this.guard = new DesktopGuard()
  }

  /** 绑定主窗口（用于权限确认弹窗） */
  bindWindow(window: BrowserWindow): void {
    this.mainWindow = window
    logger.desktop.info('[DesktopControlManager] Window bound')
  }

  /** 获取主窗口 */
  private getWindow(): BrowserWindow | null {
    return this.mainWindow && !this.mainWindow.isDestroyed() ? this.mainWindow : null
  }

  /**
   * 执行需要鉴权的操作
   * 内部统一处理权限校验 + 用户确认流程
   *
   * 自动化模式优化：
   * 当视觉智能体（VisualAgentLoop）处于运行状态时，用户已通过启动任务整体授权
   * 桌面操作。此时对输入类操作（鼠标/键盘/应用启动/窗口控制）自动放行，避免
   * 每步都弹窗打断自动化流程。紧急停止检查与 DENIED 级别拒绝仍然生效。
   */
  private async executeWithPermission<T>(
    operation: OperationType,
    target: string,
    action: () => Promise<T>,
    args?: unknown[],
  ): Promise<T> {
    // 紧急停止检查（最高优先级，先于权限校验）
    this.emergencyStop.check()

    const check = this.guard.checkPermission(operation)

    if (!check.allowed && !check.needConfirm) {
      // DENIED
      throw new Error(`Operation ${operation} is denied by security policy`)
    }

    // 自动化模式下，输入类操作自动放行（用户启动视觉任务时已整体授权）
    const automationCtrl = getAutomationModeController()
    const isAutoApproved = automationCtrl.isActive() && isAutomationAutoApprovedOperation(operation)

    if (check.needConfirm && !isAutoApproved) {
      const window = this.getWindow()
      if (!window) {
        throw new Error('No window available for permission confirmation')
      }
      // 确认弹窗期间临时提升主窗口层级为最高（pop-up-menu），确保不被其他窗口遮挡
      // 同时在自动化模式运行时，覆盖层为 screen-saver 级别仍高于此，但覆盖层在确认期间
      // 已切换为穿透模式，不会阻挡弹窗交互。完成后恢复原 alwaysOnTop 状态。
      const prevAlwaysOnTop = automationCtrl.pushMainWindowAlwaysOnTop()
      // 确认弹窗期间允许用户操作（覆盖层切穿透），否则用户无法点击弹窗
      automationCtrl.setInputElementActive(true)
      try {
        const result = await this.guard.requestConfirmation(window, operation, target, args)
        if (result.outcome !== 'approved') {
          if (result.outcome === 'timeout') {
            throw new Error(`User confirmation timed out for operation ${operation} on ${target}. The confirmation dialog may not have been displayed. Please retry.`)
          }
          throw new Error(`User denied operation ${operation} on ${target}`)
        }
      } finally {
        automationCtrl.setInputElementActive(false)
        automationCtrl.popMainWindowAlwaysOnTop(prevAlwaysOnTop)
      }
    }

    return action()
  }

  // ============ 应用启动 ============

  async launchApp(name: string, args?: string[]): Promise<LaunchResult> {
    return this.executeWithPermission(
      OperationType.APP_LAUNCH,
      name,
      () => this.launcher.launch(name, args),
      args,
    )
  }

  /** 激活已运行的应用，将窗口置于最前面 */
  async activateApp(name: string): Promise<ActionResult> {
    return this.launcher.activate(name)
  }

  async quitApp(name: string): Promise<ActionResult> {
    return this.executeWithPermission(
      OperationType.APP_QUIT,
      name,
      () => this.launcher.quit(name),
    )
  }

  async listInstalledApps(): Promise<AppInfo[]> {
    // 列表查询无需鉴权
    return this.launcher.listInstalled()
  }

  async findApp(name: string): Promise<AppInfo | null> {
    return this.launcher.find(name)
  }

  async openUrl(url: string): Promise<ActionResult> {
    // URL 打开默认放行（shell.openExternal 已有安全检查）
    return this.launcher.openUrl(url)
  }

  async openFile(filePath: string): Promise<ActionResult> {
    return this.launcher.openFile(filePath)
  }

  // ============ 系统信息 ============

  async getSystemInfo(): Promise<SystemInfo> {
    // 只读操作，无需鉴权
    return this.systemInfo.getInfo()
  }

  async setVolume(volume: number): Promise<ActionResult> {
    return this.executeWithPermission(
      OperationType.SYSTEM_SETTING,
      `volume=${volume}`,
      () => this.systemInfo.setVolume(volume),
    )
  }

  async setBrightness(level: number): Promise<ActionResult> {
    return this.executeWithPermission(
      OperationType.SYSTEM_SETTING,
      `brightness=${level}`,
      () => this.systemInfo.setBrightness(level),
    )
  }

  // ============ 进程管理 ============

  async listProcesses(): Promise<ProcessInfo[]> {
    // 只读操作，无需鉴权
    return this.processManager.list()
  }

  async findProcess(query: string | number): Promise<ProcessInfo[]> {
    return this.processManager.find(query)
  }

  async killProcess(pid: number, force = false): Promise<ActionResult> {
    return this.executeWithPermission(
      OperationType.PROCESS_KILL,
      `pid=${pid}`,
      () => this.processManager.kill(pid, force),
      [force],
    )
  }

  async isProcessRunning(name: string): Promise<boolean> {
    return this.processManager.isRunning(name)
  }

  // ============ 窗口控制（Phase 2） ============

  async listWindows(): Promise<WindowInfo[]> {
    // 只读操作，无需鉴权
    return this.windowManager.list()
  }

  async findWindow(query: string): Promise<WindowInfo[]> {
    return this.windowManager.find(query)
  }

  /** 获取指定应用前台窗口的真实边界（用于 OCR 裁剪） */
  async getActiveWindowBounds(appName: string): Promise<import('./types/actions').Rect | null> {
    return this.windowManager.getActiveWindowBounds(appName)
  }

  async focusWindow(windowId: string): Promise<ActionResult> {
    return this.executeWithPermission(
      OperationType.WINDOW_CONTROL,
      windowId,
      () => this.windowManager.focus(windowId),
    )
  }

  async minimizeWindow(windowId: string): Promise<ActionResult> {
    return this.executeWithPermission(
      OperationType.WINDOW_CONTROL,
      windowId,
      () => this.windowManager.minimize(windowId),
    )
  }

  async maximizeWindow(windowId: string): Promise<ActionResult> {
    return this.executeWithPermission(
      OperationType.WINDOW_CONTROL,
      windowId,
      () => this.windowManager.maximize(windowId),
    )
  }

  async restoreWindow(windowId: string): Promise<ActionResult> {
    return this.executeWithPermission(
      OperationType.WINDOW_CONTROL,
      windowId,
      () => this.windowManager.restore(windowId),
    )
  }

  async closeWindow(windowId: string): Promise<ActionResult> {
    return this.executeWithPermission(
      OperationType.WINDOW_CONTROL,
      windowId,
      () => this.windowManager.close(windowId),
    )
  }

  async bringWindowToFront(windowId: string): Promise<ActionResult> {
    return this.executeWithPermission(
      OperationType.WINDOW_CONTROL,
      windowId,
      () => this.windowManager.bringToFront(windowId),
    )
  }

  async setWindowBounds(windowId: string, bounds: Rect): Promise<ActionResult> {
    return this.executeWithPermission(
      OperationType.WINDOW_MOVE,
      windowId,
      () => this.windowManager.setBounds(windowId, bounds),
      [bounds],
    )
  }

  // ============ 屏幕截图（Phase 2） ============

  async captureScreen(displayId?: number): Promise<ScreenshotResult> {
    return this.executeWithPermission(
      OperationType.SCREEN_CAPTURE,
      `display=${displayId ?? 0}`,
      () => this.screenCapture.captureScreen(displayId),
    )
  }

  async captureRegion(region: Rect, displayId?: number): Promise<ScreenshotResult> {
    return this.executeWithPermission(
      OperationType.SCREEN_CAPTURE,
      `region=${JSON.stringify(region)}`,
      () => this.screenCapture.captureRegion(region, displayId),
      [region],
    )
  }

  async captureAllScreens(): Promise<ScreenshotResult[]> {
    return this.executeWithPermission(
      OperationType.SCREEN_CAPTURE,
      'all',
      () => this.screenCapture.captureAllScreens(),
    )
  }

  // ============ 输入模拟（Phase 2） ============

  async mouseClick(params: MouseClickParams): Promise<InputOperationResult> {
    return this.executeWithPermission(
      OperationType.MOUSE_INPUT,
      `(${params.x},${params.y})`,
      () => this.inputSimulator.click(params),
      [params],
    )
  }

  async mouseMove(params: MouseMoveParams): Promise<InputOperationResult> {
    return this.executeWithPermission(
      OperationType.MOUSE_INPUT,
      `(${params.x},${params.y})`,
      () => this.inputSimulator.move(params),
      [params],
    )
  }

  async mouseScroll(params: MouseScrollParams): Promise<InputOperationResult> {
    return this.executeWithPermission(
      OperationType.MOUSE_INPUT,
      `(${params.x},${params.y})`,
      () => this.inputSimulator.scroll(params),
      [params],
    )
  }

  async mouseDrag(params: MouseDragParams): Promise<InputOperationResult> {
    return this.executeWithPermission(
      OperationType.MOUSE_INPUT,
      `(${params.fromX},${params.fromY})->(${params.toX},${params.toY})`,
      () => this.inputSimulator.drag(params),
      [params],
    )
  }

  async typeText(text: string, delayMs?: number): Promise<InputOperationResult> {
    return this.executeWithPermission(
      OperationType.KEYBOARD_INPUT,
      text.slice(0, 50),
      () => this.inputSimulator.typeText(text, delayMs),
      [text],
    )
  }

  async pressKey(key: string): Promise<InputOperationResult> {
    return this.executeWithPermission(
      OperationType.KEYBOARD_INPUT,
      key,
      () => this.inputSimulator.pressKey(key),
      [key],
    )
  }

  async keyCombo(keys: string[]): Promise<InputOperationResult> {
    return this.executeWithPermission(
      OperationType.KEYBOARD_INPUT,
      keys.join('+'),
      () => this.inputSimulator.keyCombo(keys),
      keys,
    )
  }

  // ============ 文件操作（Phase 2） ============

  async copyFile(sourcePath: string, targetPath: string): Promise<FileOperationResult> {
    return this.executeWithPermission(
      OperationType.SYSTEM_SETTING,
      `${sourcePath} -> ${targetPath}`,
      () => this.fileManager.copy(sourcePath, targetPath),
      [sourcePath, targetPath],
    )
  }

  async moveFile(sourcePath: string, targetPath: string): Promise<FileOperationResult> {
    return this.executeWithPermission(
      OperationType.SYSTEM_SETTING,
      `${sourcePath} -> ${targetPath}`,
      () => this.fileManager.move(sourcePath, targetPath),
      [sourcePath, targetPath],
    )
  }

  async deleteFile(targetPath: string): Promise<FileOperationResult> {
    return this.executeWithPermission(
      OperationType.SYSTEM_SETTING,
      targetPath,
      () => this.fileManager.delete(targetPath),
      [targetPath],
    )
  }

  async renameFile(sourcePath: string, newName: string): Promise<FileOperationResult> {
    return this.executeWithPermission(
      OperationType.SYSTEM_SETTING,
      `${sourcePath} -> ${newName}`,
      () => this.fileManager.rename(sourcePath, newName),
      [sourcePath, newName],
    )
  }

  async getFileInfo(targetPath: string): Promise<FileInfo> {
    // 只读操作，无需鉴权
    return this.fileManager.getFileInfo(targetPath)
  }

  async fileExists(targetPath: string): Promise<boolean> {
    return this.fileManager.exists(targetPath)
  }

  async createDirectory(targetPath: string): Promise<ActionResult> {
    return this.executeWithPermission(
      OperationType.SYSTEM_SETTING,
      targetPath,
      () => this.fileManager.createDirectory(targetPath),
      [targetPath],
    )
  }

  async listDirectory(targetPath: string): Promise<FileInfo[]> {
    // 只读操作，无需鉴权
    return this.fileManager.listDirectory(targetPath)
  }

  // ============ 紧急停止（Phase 3） ============

  /** 获取紧急停止状态 */
  getEmergencyStopState(): EmergencyStopState {
    return this.emergencyStop.getState()
  }

  /** 是否处于停止状态 */
  isEmergencyStopped(): boolean {
    return this.emergencyStop.isStopped()
  }

  /** 触发紧急停止 */
  triggerEmergencyStop(params: EmergencyStopParams): void {
    this.emergencyStop.trigger(params)
  }

  /** 复位紧急停止（需用户确认） */
  resetEmergencyStop(): void {
    this.emergencyStop.reset()
  }
}

/**
 * 判断操作类型是否在自动化模式下自动放行（无需弹窗确认）
 *
 * 这些操作属于视觉智能体执行任务的必要输入手段，用户启动视觉任务时
 * 已整体授权。危险操作（PROCESS_KILL、SYSTEM_SETTING 中的音量/亮度等）
 * 不在自动放行范围内，仍需用户确认。
 */
function isAutomationAutoApprovedOperation(operation: OperationType): boolean {
  switch (operation) {
    case OperationType.MOUSE_INPUT:
    case OperationType.KEYBOARD_INPUT:
    case OperationType.APP_LAUNCH:
    case OperationType.WINDOW_CONTROL:
      return true
    default:
      return false
  }
}

/** 单例 */
let desktopControlManager: DesktopControlManager | null = null

export function getDesktopControlManager(): DesktopControlManager {
  if (!desktopControlManager) {
    desktopControlManager = new DesktopControlManager()
  }
  return desktopControlManager
}
