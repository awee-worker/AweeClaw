/**
 * 设置模块
 * 
 * 统一导出设置相关功能
 */

// 服务
export {
  settingsService,
  getEditorConfig,
  saveEditorConfig,
  resetEditorConfig,
} from './preferencesService'

// Schema 和类型（从 shared 重新导出）
export {
  SETTINGS,
  type SettingsState,
  type SettingKey,
  type SettingValue,
  type ProviderModelConfig,
  getAllDefaults,
  getDefault,
  // 默认值
  defaultLLMConfig,
  defaultAgentConfig,
  defaultEditorConfig,
  defaultSecuritySettings,
  defaultAutoApprove,
  defaultWebSearchConfig,
  defaultMcpConfig,
} from '@shared/configuration/preferenceSync'

// 类型重新导出
export type {
  LLMConfig,
  AgentConfig,
  AutoApproveSettings,
  EditorConfig,
  SecurityPolicyPanel,
  WebSearchConfig,
  McpConfig,
  ProviderConfig,
} from '@shared/configuration/providerTypes'

// 配置导出/导入工具
export { exportSettings, importSettings, downloadSettings } from './configMigration'
