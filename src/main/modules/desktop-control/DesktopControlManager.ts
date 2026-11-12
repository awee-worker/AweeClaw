/**
 * 桌面控制编排器
 * 统一调度 AppLauncher / SystemInfoService / ProcessManager
 * / WindowManager / ScreenCaptureService / InputSimulator / FileManager
 * 在执行前进行权限校验
 */

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
import { getInputInjectionGuard } from './InputInjectionGuard'
import {
  getEmergencyStopController,
  type EmergencyStopParams,
  type EmergencyStopState,
} from './EmergencyStop'
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

/**
 * 需要系统级辅助功能授权才能真正生效的操作
 *
 * 只有这两类：鼠标与键盘。截图、文件、进程等操作走的是各自的系统 API，
 * 未授权时会以真实错误返回，不需要在这里重复拦截。
 */
const INPUT_OPERATIONS = new Set<OperationType>([
  OperationType.MOUSE_INPUT,
  OperationType.KEYBOARD_INPUT,
])

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

  /**
   * 执行需要鉴权的操作
   * 内部统一处理权限校验 + 用户确认流程
   */
  private async executeWithPermission<T>(
    operation: OperationType,
    _target: string,
    action: () => Promise<T>,
    _args?: unknown[],
  ): Promise<T> {
    // 紧急停止检查（最高优先级，先于权限校验）
    this.emergencyStop.check()

    const check = this.guard.checkPermission(operation)

    // DENIED：安全策略明确拒绝的操作直接拦截
    if (!check.allowed && !check.needConfirm) {
      throw new Error(`Operation ${operation} is denied by security policy`)
    }

    // 注入类操作额外过一次系统授权校验：macOS 未授予辅助功能时 CGEventPost
    // 会静默丢弃事件，平台层仍报 success，最终表现为「点了没反应」。
    // 放在这里而不是各个入口，是因为 MCP 工具与远程控制走的是同一条路径。
    if (INPUT_OPERATIONS.has(operation)) {
      await getInputInjectionGuard().assertReady()
    }

    // ASK（needConfirm）：MCP 工具自带审批流程，此处不再弹窗确认，直接执行。
    // 旧桌面自动化的弹窗确认已移除，避免与 MCP 工具审批重复并导致调用超时。
    // 紧急停止（emergencyStop）仍然作为全局安全守卫生后。

    return action()
  }

  /**
   * 校验指针是否真的落到了目标位置
   *
   * 只有平台层自报成功不足以说明注入生效：系统吞掉事件时同样返回成功。
   * 回读指针位置是唯一不依赖平台层自述的客观信号，未落地即判失败。
   */
  /**
   * 校验指针是否真的落到了目标位置
   *
   * 平台层自报成功不足以说明注入生效：系统吞掉事件时同样返回成功。但反过来，
   * 调用返回后立刻回读位置也不可靠——事件是异步投递到窗口服务器的，指针桥下发
   * 后马上读往往还是旧坐标，于是「已经点中了」被判成「操作没生效」，用户看到的
   * 就是操作生效了却在手机上弹错误。
   *
   * 因此这里等事件落地后再校验，且校验只作为诊断信号：不符时记告警，不推翻
   * 已经成功提交的操作。真正被系统吞掉的事件不会让用户产生误判，反而误报会。
   */
  private verifyPointerLandedAsync(x: number, y: number): void {
    void getInputInjectionGuard()
      .verifyPointerLandedEventually(x, y)
      .then((landed) => {
        if (!landed) {
          logger.desktop.warn(
            `[DesktopControl] 指针未落到目标点 (${x},${y})，操作已提交但落点不确定`,
          )
        }
      })
      .catch((err) => {
        logger.desktop.warn('[DesktopControl] 指针落点校验异常，已忽略:', err)
      })
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
    const result = await this.executeWithPermission(
      OperationType.MOUSE_INPUT,
      `(${params.x},${params.y})`,
      () => this.inputSimulator.click(params),
      [params],
    )
    // 落点校验只作诊断，不阻断：事件已提交，指针未及时到位不代表点击没生效
    this.verifyPointerLandedAsync(params.x, params.y)
    return result
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
    const result = await this.executeWithPermission(
      OperationType.MOUSE_INPUT,
      `(${params.fromX},${params.fromY})->(${params.toX},${params.toY})`,
      () => this.inputSimulator.drag(params),
      [params],
    )
    // 同上，拖拽的终点同样可能在读回时还未落地
    this.verifyPointerLandedAsync(params.toX, params.toY)
    return result
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

  // ============ 锁屏状态 ============

  /** 锁屏探测结果的缓存窗口：一次远程操作会连续触发多次探测，逐个问系统没必要 */
  private static readonly LOCK_CACHE_MS = 1000
  private lockCache: { at: number; locked: boolean } | null = null

  /**
   * 当前输入桌面是否处于锁屏 / 登录界面
   *
   * 会话锁定时输入焦点在安全桌面，普通用户态进程的注入到不了那里：不提前判断，
   * 上游只会收到一个「平台层自报成功」的结果，用户看到的是「密码怎么输都没反应」。
   *
   * 平台未实现时按「未锁屏」处理——把判断失败的代价控制成一次正常的注入尝试，
   * 而不是凭一个拿不到的信号把用户拦在门外。
   */
  async isSessionLocked(force = false): Promise<boolean> {
    if (!force && this.lockCache && Date.now() - this.lockCache.at < DesktopControlManager.LOCK_CACHE_MS) {
      return this.lockCache.locked
    }
    let locked = false
    try {
      locked = (await this.adapter.isSessionLocked?.()) ?? false
    } catch (err) {
      logger.desktop.warn('[DesktopControl] 锁屏状态探测异常，按未锁屏处理:', err)
      locked = false
    }
    this.lockCache = { at: Date.now(), locked }
    return locked
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

/** 单例 */
let desktopControlManager: DesktopControlManager | null = null

export function getDesktopControlManager(): DesktopControlManager {
  if (!desktopControlManager) {
    desktopControlManager = new DesktopControlManager()
  }
  return desktopControlManager
}
