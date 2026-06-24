/**
 * 安全模块统一导出 — 集中暴露安全相关 API
 *
 * 导出内容：
 * - securityManager：安全策略引擎
 * - OperationType / PermissionLevel：操作类型与权限级别
 * - 场景权限策略管理（setScenarioPermissionPolicy 等）
 * - 安全事件管理（onSecurityEvent / getSecurityEvents 等）
 */

export {
  securityManager,
  OperationType,
  PermissionLevel,
  checkWorkspacePermission,
  setScenarioPermissionPolicy,
  getScenarioPermissionPolicy,
  removeScenarioPermissionPolicy,
  listScenarioPermissionPolicies,
  checkScenarioPermission,
  onSecurityEvent,
  getSecurityEvents,
  clearSecurityEvents,
  emitSecurityEvent,
  BUILTIN_SCENARIO_POLICIES,
  type ScenarioPermissionPolicy,
  type SecurityEvent,
} from './securityPolicyEngine'
export { registerSecureTerminalHandlers, cleanupTerminals, updateWhitelist, getWhitelist } from './terminalSandbox'
export { registerSecureFileHandlers, cleanupSecureFileWatcher } from './filePermissionGuard'
