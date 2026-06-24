/**
 * 设置模块
 * 
 * 统一导出设置相关功能
 */

// 偏好服务接口
export {
  settingsService,
  getEditorConfig,
  saveEditorConfig,
  resetEditorConfig,
} from './preferencesService'

// 设置 Schema 与类型定义
export {
  SETTINGS,
  type SettingsState,
  type SettingKey,
  type SettingValue,
  type ProviderModelConfig,
  getAllDefaults,
  getDefault,
  // 各模块默认配置
  defaultLLMConfig,
  defaultAgentConfig,
  defaultEditorConfig,
  defaultSecuritySettings,
  defaultAutoApprove,
  defaultWebSearchConfig,
  defaultMcpConfig,
} from '@shared/configuration/preferenceSync'

// 类型声明导出
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

// 配置备份与恢复工具
export { exportSettings, importSettings, downloadSettings } from './configMigration'
