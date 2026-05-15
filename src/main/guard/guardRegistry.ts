/**
 * 安全模块统一导出
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
