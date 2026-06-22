/**
 * 桌面控制模块 - 权限类型定义
 * 扩展自 guard/securityPolicyEngine 的 OperationType
 */

/**
 * 桌面控制操作类型
 * 与 securityPolicyEngine.ts 中的 OperationType 保持同步
 * 新增条目需同步更新 securityPolicyEngine.ts
 */
export const DesktopOperationType = {
  // 应用
  APP_LAUNCH: 'app:launch',
  APP_QUIT: 'app:quit',

  // 窗口（Phase 2）
  WINDOW_CONTROL: 'window:control',
  WINDOW_MOVE: 'window:move',

  // 屏幕（Phase 2）
  SCREEN_CAPTURE: 'screen:capture',

  // 输入模拟（Phase 3）
  MOUSE_INPUT: 'mouse:input',
  KEYBOARD_INPUT: 'keyboard:input',

  // 进程
  PROCESS_KILL: 'process:kill',

  // 系统设置
  SYSTEM_SETTING: 'system:setting',

  // 工作流（Phase 4）
  WORKFLOW_EXECUTE: 'workflow:execute',
  VISUAL_AGENT_LOOP: 'agent:visual-loop',
} as const

export type DesktopOperation = typeof DesktopOperationType[keyof typeof DesktopOperationType]

/** 权限等级 */
export enum DesktopPermissionLevel {
  ALLOWED = 'allowed',
  ASK = 'ask',
  DENIED = 'denied',
}

/** 权限配置映射 */
export type DesktopPermissionConfig = Record<string, DesktopPermissionLevel>

/** Phase 1 默认权限策略 */
export const DEFAULT_DESKTOP_PERMISSIONS: DesktopPermissionConfig = {
  [DesktopOperationType.APP_LAUNCH]: DesktopPermissionLevel.ASK,
  [DesktopOperationType.APP_QUIT]: DesktopPermissionLevel.ASK,
  [DesktopOperationType.PROCESS_KILL]: DesktopPermissionLevel.DENIED,
  [DesktopOperationType.SYSTEM_SETTING]: DesktopPermissionLevel.ASK,
  // Phase 2+
  [DesktopOperationType.WINDOW_CONTROL]: DesktopPermissionLevel.ALLOWED,
  [DesktopOperationType.WINDOW_MOVE]: DesktopPermissionLevel.ASK,
  [DesktopOperationType.SCREEN_CAPTURE]: DesktopPermissionLevel.ALLOWED,
  [DesktopOperationType.MOUSE_INPUT]: DesktopPermissionLevel.ASK,
  [DesktopOperationType.KEYBOARD_INPUT]: DesktopPermissionLevel.ASK,
  [DesktopOperationType.WORKFLOW_EXECUTE]: DesktopPermissionLevel.ASK,
  [DesktopOperationType.VISUAL_AGENT_LOOP]: DesktopPermissionLevel.ASK,
}
