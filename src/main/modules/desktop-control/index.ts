/**
 * 桌面控制模块入口
 * 统一导出管理器、子服务、类型
 */

export { DesktopControlManager, getDesktopControlManager } from './DesktopControlManager'
export { AppLauncher } from './AppLauncher'
export { SystemInfoService } from './SystemInfo'
export { ProcessManager } from './ProcessManager'
export { DesktopGuard } from './DesktopGuard'
export type { PermissionCheckResult } from './DesktopGuard'

// 紧急停止机制
export {
  getEmergencyStopController,
  EmergencyStopError,
  EmergencyStopController,
  EMERGENCY_STOP_EVENT,
  EMERGENCY_RESET_EVENT,
} from './EmergencyStop'
export type { EmergencyStopSource, EmergencyStopState, EmergencyStopParams } from './EmergencyStop'

// 辅助功能权限引导
export { AccessibilityPermissionService, getAccessibilityPermissionService } from './AccessibilityPermission'
export type {
  AccessibilityPermissionType,
  AccessibilityPermissionStatus,
  AccessibilityPermissionResult,
} from './AccessibilityPermission'

export { getPlatformAdapter } from './platform'
export type { PlatformAdapter } from './platform/types'

export type {
  AppInfo,
  ProcessInfo,
  SystemInfo,
  LaunchResult,
  ActionResult,
  Rect,
} from './types/actions'

export { DesktopOperationType, DesktopPermissionLevel } from './types/permissions'
export type { DesktopPermissionConfig } from './types/permissions'
