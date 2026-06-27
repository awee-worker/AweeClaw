/**
 * 桌面控制模块 - 平台抽象接口
 * 每个平台（darwin/win32/linux）需实现此接口
 */

import type {
  AppInfo,
  ProcessInfo,
  SystemInfo,
  LaunchResult,
  ActionResult,
  WindowInfo,
  WindowActionType,
  ScreenshotResult,
  Rect,
  MouseClickParams,
  MouseMoveParams,
  MouseScrollParams,
  MouseDragParams,
  InputOperationResult,
} from '../types/actions'

/**
 * 平台适配器接口
 * 抽象跨平台差异，主进程根据 process.platform 动态加载实现
 */
export interface PlatformAdapter {
  // ========== L1 应用启动 ==========

  /** 启动应用 */
  launchApp(name: string, args?: string[]): Promise<LaunchResult>

  /** 激活应用（将已运行的应用窗口置于最前面，不启动新实例） */
  activateApp(name: string): Promise<ActionResult>

  /** 退出应用 */
  quitApp(name: string): Promise<ActionResult>

  /** 列出已安装应用 */
  listInstalledApps(): Promise<AppInfo[]>

  /** 查找已安装应用 */
  findApp(name: string): Promise<AppInfo | null>

  /** 用默认浏览器打开 URL */
  openUrl(url: string): Promise<ActionResult>

  /** 用默认程序打开文件 */
  openFile(filePath: string): Promise<ActionResult>

  // ========== L3 系统信息 ==========

  /** 获取系统信息 */
  getSystemInfo(): Promise<SystemInfo>

  /** 列出进程 */
  listProcesses(): Promise<ProcessInfo[]>

  /** 查找进程 */
  findProcess(query: string | number): Promise<ProcessInfo[]>

  /** 终止进程 */
  killProcess(pid: number, force?: boolean): Promise<ActionResult>

  /** 设置系统音量（0-100） */
  setVolume(volume: number): Promise<ActionResult>

  /** 设置屏幕亮度（0-100） */
  setBrightness(level: number): Promise<ActionResult>

  // ========== L4 窗口控制 ==========

  /** 列出所有窗口 */
  listWindows(): Promise<WindowInfo[]>

  /** 查找窗口（按标题或应用名） */
  findWindow(query: string): Promise<WindowInfo[]>

  /** 获取指定应用前台的窗口边界（用于 OCR 裁剪） */
  getActiveWindowBounds(appName: string): Promise<Rect | null>

  /** 窗口操作（聚焦/最小化/最大化/还原/关闭/置顶） */
  performWindowAction(windowId: string, action: WindowActionType, bounds?: Rect): Promise<ActionResult>

  // ========== L4 屏幕截图 ==========

  /** 截取整个屏幕 */
  captureScreen(displayId?: number): Promise<ScreenshotResult>

  /** 截取指定区域 */
  captureRegion(region: Rect, displayId?: number): Promise<ScreenshotResult>

  // ========== L4 输入模拟 ==========

  /** 鼠标点击 */
  mouseClick(params: MouseClickParams): Promise<InputOperationResult>

  /** 鼠标移动 */
  mouseMove(params: MouseMoveParams): Promise<InputOperationResult>

  /** 鼠标滚动 */
  mouseScroll(params: MouseScrollParams): Promise<InputOperationResult>

  /** 鼠标拖拽 */
  mouseDrag(params: MouseDragParams): Promise<InputOperationResult>

  /** 输入文本 */
  typeText(text: string, delayMs?: number): Promise<InputOperationResult>

  /** 按下单个按键（如 Enter, Tab） */
  pressKey(key: string): Promise<InputOperationResult>

  /** 组合键（如 Cmd+C） */
  keyCombo(keys: string[]): Promise<InputOperationResult>
}

/** 平台适配器工厂函数类型 */
export type PlatformAdapterFactory = () => PlatformAdapter
