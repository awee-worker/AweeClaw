/**
 * 桌面控制模块 - 操作类型定义
 * 覆盖 L1 应用启动层 + L2 文件操作 + L3 系统命令层 + L4 GUI 自动化层
 */

/** 矩形区域 */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** 已安装应用信息 */
export interface AppInfo {
  /** 应用显示名称 */
  name: string
  /** macOS bundleId（其他平台为空） */
  bundleId?: string
  /** 可执行文件路径 */
  executablePath: string
  /** 图标路径（base64 或文件路径） */
  iconPath?: string
  /** 版本号 */
  version?: string
  /** 发布者/开发者 */
  publisher?: string
  /** 应用分类（如 Productivity, Developer, Social） */
  categories?: string[]
}

/** 窗口信息 */
export interface WindowInfo {
  id: string
  title: string
  appName: string
  bounds: Rect
  isFocused: boolean
  isMinimized: boolean
  isMaximized: boolean
  pid: number
}

/** 系统信息 */
export interface SystemInfo {
  platform: NodeJS.Platform
  osVersion: string
  hostname: string
  cpu: {
    model: string
    cores: number
    usage: number
  }
  memory: {
    total: number
    free: number
    used: number
  }
  disk: {
    total: number
    free: number
  }
  displays: Array<{
    id: number
    bounds: Rect
    scaleFactor: number
  }>
  network: {
    ip: string
    connected: boolean
  }
  power: {
    batteryLevel?: number
    charging: boolean
  }
}

/** 进程信息 */
export interface ProcessInfo {
  pid: number
  name: string
  cpuUsage: number
  memoryUsage: number
  command?: string
}

/** 启动应用结果 */
export interface LaunchResult {
  success: boolean
  pid?: number
  windowId?: string
  error?: string
  duration: number
}

/** 通用操作结果 */
export interface ActionResult {
  success: boolean
  operation: string
  target?: string
  duration: number
  error?: string
}

/** ============ Phase 2: L2 文件操作 ============ */

/** 文件操作类型 */
export type FileOperationType = 'copy' | 'move' | 'delete' | 'rename'

/** 文件操作结果 */
export interface FileOperationResult extends ActionResult {
  operation: FileOperationType
  sourcePath: string
  targetPath?: string
  /** 操作影响的字节数（复制/移动） */
  bytesProcessed?: number
}

/** 文件信息 */
export interface FileInfo {
  path: string
  name: string
  size: number
  isDirectory: boolean
  createdAt: number
  modifiedAt: number
  permissions: string
}

/** ============ Phase 2: L4 窗口控制 ============ */

/** 窗口操作类型 */
export type WindowActionType =
  | 'focus'
  | 'minimize'
  | 'maximize'
  | 'restore'
  | 'close'
  | 'bringToFront'
  | 'setBounds'

/** 窗口操作结果 */
export interface WindowOperationResult extends ActionResult {
  operation: WindowActionType
  windowId: string
}

/** ============ Phase 2: L4 屏幕截图 ============ */

/** 截图结果 */
export interface ScreenshotResult {
  success: boolean
  /** base64 编码的 PNG 图片 */
  dataUrl: string
  /** 截图区域 */
  region: Rect
  /** 显示器 ID */
  displayId: number
  /** 截图时间戳 */
  timestamp: number
  error?: string
}

/** ============ Phase 2: L4 输入模拟 ============ */

/** 鼠标按键 */
export type MouseButton = 'left' | 'right' | 'middle'

/** 点击类型 */
export type ClickType = 'single' | 'double'

/** 鼠标点击参数 */
export interface MouseClickParams {
  x: number
  y: number
  button: MouseButton
  clickType: ClickType
}

/** 鼠标移动参数 */
export interface MouseMoveParams {
  x: number
  y: number
  /** 是否平滑移动 */
  smooth?: boolean
  /** 移动耗时（ms） */
  duration?: number
}

/** 鼠标滚动参数 */
export interface MouseScrollParams {
  x: number
  y: number
  /** 滚动量（正向下，负向上） */
  amount: number
}

/** 鼠标拖拽参数 */
export interface MouseDragParams {
  fromX: number
  fromY: number
  toX: number
  toY: number
  button: MouseButton
  duration?: number
}

/** 输入操作结果 */
export interface InputOperationResult extends ActionResult {
  operation: string
}

/** 桌面操作审计条目 */
export interface DesktopAuditEntry {
  timestamp: number
  operation: string
  target: string
  params: Record<string, unknown>
  result: 'success' | 'failed' | 'denied' | 'cancelled'
  duration: number
  agentId?: string
  sessionId?: string
  userApproved: boolean
}

/** 桌面控制配置 */
export interface DesktopControlConfig {
  /** 是否启用桌面控制 */
  enabled: boolean
  /** 应用启动白名单（空数组表示允许全部） */
  appWhitelist: string[]
  /** 应用启动黑名单 */
  appBlacklist: string[]
  /** 单次会话最大操作数 */
  maxOperationsPerSession: number
  /** 每秒最大操作数 */
  maxOperationsPerSecond: number
  /** 截图保存目录 */
  screenshotDir: string
  /** 截图保留天数 */
  screenshotRetentionDays: number
  /** 是否启用操作前自动截图 */
  autoScreenshotBeforeAction: boolean
  /** 紧急停止快捷键 */
  emergencyStopShortcut: string
}

/** 默认配置 */
export const DEFAULT_DESKTOP_CONTROL_CONFIG: DesktopControlConfig = {
  enabled: true,
  appWhitelist: [],
  appBlacklist: [
    // 默认禁止启动密码管理器等敏感应用
    '1Password',
    'KeychainAccess',
    'KeePass',
    'Bitwarden',
  ],
  maxOperationsPerSession: 100,
  maxOperationsPerSecond: 5,
  screenshotDir: '',
  screenshotRetentionDays: 7,
  autoScreenshotBeforeAction: false,
  emergencyStopShortcut: 'CommandOrControl+Shift+Escape',
}
