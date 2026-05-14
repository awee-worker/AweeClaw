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
} from './securityModule'
export { registerSecureTerminalHandlers, cleanupTerminals, updateWhitelist, getWhitelist } from './secureTerminal'
export { registerSecureFileHandlers, cleanupSecureFileWatcher } from './secureFile'
