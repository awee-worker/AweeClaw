/**
 * 设置 Schema - 单一真相来源
 * 
 * 所有设置项在此声明式定义：
 * - 类型（通过 TypeScript 推断）
 * - 默认值
 * - 持久化键名
 * - 主进程同步标识
 * 
 * 新增设置只需：
 * 1. 在此文件添加定义
 * 2. 在 UI 组件中使用
 */

import {
  LLM_DEFAULTS,
  AGENT_DEFAULTS,
  AUTO_APPROVE_DEFAULTS,
  EDITOR_DEFAULTS,
  TERMINAL_DEFAULTS,
  GIT_DEFAULTS,
  LSP_DEFAULTS,
  PERFORMANCE_DEFAULTS,
  AI_COMPLETION_DEFAULTS,
  SECURITY_SETTINGS_DEFAULTS,
  PRIVACY_SETTINGS_DEFAULTS,
  type PrivacySettings,
  type ScenarioDomain,
} from './defaultProfile'
import type {
  LLMConfig,
  AgentConfig,
  AutoApproveSettings,
  EditorConfig,
  SecurityPolicyPanel,
  WebSearchConfig,
  McpConfig,
  EmailConfig,
  ProviderConfig,
} from './providerTypes'
import {
  BUILTIN_PROVIDERS,
  getDefaultOpenAICompatibilityProfile,
} from '@shared/configuration/aiProviders'
import type { ApiProtocol } from '@shared/configuration/aiProviders'
import { generateDefaultSearchEngineConfigs } from '@shared/configuration/searchProviders'

// ============================================
// Provider 扩展类型（运行时使用）
// ============================================

export interface ProviderModelConfig extends Omit<ProviderConfig, 'protocol'> {
  customModels?: string[]
  protocol?: ApiProtocol
  modelConfigs?: Record<string, import('@renderer/types/modelProvider').ModelConfig>
  enabled?: boolean
}

export interface ScenarioPreferences {
    activeDomain: ScenarioDomain
    customScenarioLabels: Record<ScenarioDomain, string>
    domainEnabled: Record<ScenarioDomain, boolean>
    auditLoggingEnabled: boolean
    complianceModeEnabled: boolean
}

export const DEFAULT_SCENARIO_PREFERENCES: ScenarioPreferences = {
    activeDomain: 'general',
    customScenarioLabels: {
        legal: 'Legal',
        medical: 'Medical',
        education: 'Education',
        general: 'General',
    },
    domainEnabled: {
        legal: true,
        medical: true,
        education: true,
        general: true,
    },
    auditLoggingEnabled: false,
    complianceModeEnabled: false,
}

// ============================================
// 设置项元数据
// ============================================

export interface SettingMeta<T> {
  /** 默认值 */
  default: T
  /** 持久化存储键（不设置则使用设置名） */
  storageKey?: string
  /** 只持久化部分字段 */
  persistFields?: readonly (keyof T)[]
  /** 需要同步到主进程的标识 */
  syncToMain?: string
}

// ============================================
// 默认值构建
// ============================================

const defaultLLMConfig: LLMConfig = {
  provider: LLM_DEFAULTS.defaultProvider,
  model: LLM_DEFAULTS.defaultModel,
  apiKey: '',
  openAICompatibilityProfile: 'full',
  timeout: LLM_DEFAULTS.timeout,
  temperature: LLM_DEFAULTS.temperature,
  maxTokens: LLM_DEFAULTS.maxTokens,
  topP: LLM_DEFAULTS.topP,
  topK: LLM_DEFAULTS.topK,
  seed: LLM_DEFAULTS.seed,
  frequencyPenalty: LLM_DEFAULTS.frequencyPenalty,
  presencePenalty: LLM_DEFAULTS.presencePenalty,
  stopSequences: LLM_DEFAULTS.stopSequences,
  logitBias: LLM_DEFAULTS.logitBias,
  // AI SDK 高级参数
  maxRetries: LLM_DEFAULTS.maxRetries,
  toolChoice: LLM_DEFAULTS.toolChoice,
  parallelToolCalls: LLM_DEFAULTS.parallelToolCalls,
  headers: LLM_DEFAULTS.headers,
  // 功能开关
  enableThinking: false,
  thinkingBudget: 10000,
  reasoningEffort: 'medium' as const,
}

const defaultAgentConfig: AgentConfig = {
  maxToolLoops: AGENT_DEFAULTS.maxToolLoops,
  maxHistoryMessages: AGENT_DEFAULTS.maxHistoryMessages,
  maxToolResultChars: AGENT_DEFAULTS.maxToolResultChars,
  maxFileContentChars: AGENT_DEFAULTS.maxFileContentChars,
  maxTotalContextChars: AGENT_DEFAULTS.maxTotalContextChars,
  maxContextTokens: AGENT_DEFAULTS.maxContextTokens,
  maxSingleFileChars: AGENT_DEFAULTS.maxSingleFileChars,
  maxContextFiles: AGENT_DEFAULTS.maxContextFiles,
  maxSemanticResults: AGENT_DEFAULTS.maxSemanticResults,
  maxTerminalChars: AGENT_DEFAULTS.maxTerminalChars,
  maxRetries: AGENT_DEFAULTS.maxRetries,
  retryDelayMs: AGENT_DEFAULTS.retryDelayMs,
  toolTimeoutMs: AGENT_DEFAULTS.toolTimeoutMs,
  enableAutoFix: AGENT_DEFAULTS.enableAutoFix,
  expandAgentBlocksByDefault: AGENT_DEFAULTS.expandAgentBlocksByDefault,
  keepRecentTurns: AGENT_DEFAULTS.keepRecentTurns,
  deepCompressionTurns: AGENT_DEFAULTS.deepCompressionTurns,
  maxImportantOldTurns: AGENT_DEFAULTS.maxImportantOldTurns,
  enableLLMSummary: AGENT_DEFAULTS.enableLLMSummary,
  autoHandoff: AGENT_DEFAULTS.autoHandoff,
  loopDetection: { ...AGENT_DEFAULTS.loopDetection },
  ignoredDirectories: [...AGENT_DEFAULTS.ignoredDirectories],
  multiAgent: { ...AGENT_DEFAULTS.multiAgent },
  customAgentProfiles: [...AGENT_DEFAULTS.customAgentProfiles],
}

const defaultEditorConfig: EditorConfig = {
  fontSize: EDITOR_DEFAULTS.fontSize,
  chatFontSize: EDITOR_DEFAULTS.chatFontSize,
  fontFamily: EDITOR_DEFAULTS.fontFamily,
  tabSize: EDITOR_DEFAULTS.tabSize,
  wordWrap: EDITOR_DEFAULTS.wordWrap,
  lineHeight: EDITOR_DEFAULTS.lineHeight,
  minimap: EDITOR_DEFAULTS.minimap,
  minimapScale: EDITOR_DEFAULTS.minimapScale,
  lineNumbers: EDITOR_DEFAULTS.lineNumbers,
  bracketPairColorization: EDITOR_DEFAULTS.bracketPairColorization,
  formatOnSave: EDITOR_DEFAULTS.formatOnSave,
  autoSave: EDITOR_DEFAULTS.autoSave,
  autoSaveDelay: EDITOR_DEFAULTS.autoSaveDelay,
  terminal: { ...TERMINAL_DEFAULTS },
  git: { ...GIT_DEFAULTS },
  lsp: { ...LSP_DEFAULTS },
  performance: { ...PERFORMANCE_DEFAULTS },
  ai: {
    completionEnabled: AI_COMPLETION_DEFAULTS.enabled,
    completionMaxTokens: AI_COMPLETION_DEFAULTS.maxTokens,
    completionTemperature: AI_COMPLETION_DEFAULTS.temperature,
    completionTriggerChars: [...AI_COMPLETION_DEFAULTS.triggerChars],
  },
  enableInlineDiff: false
}

const defaultSecuritySettings: SecurityPolicyPanel = {
  enablePermissionConfirm: SECURITY_SETTINGS_DEFAULTS.enablePermissionConfirm,
  strictWorkspaceMode: SECURITY_SETTINGS_DEFAULTS.strictWorkspaceMode,
  allowedShellCommands: [...SECURITY_SETTINGS_DEFAULTS.allowedShellCommands],
  allowedGitSubcommands: [...SECURITY_SETTINGS_DEFAULTS.allowedGitSubcommands],
  showSecurityWarnings: SECURITY_SETTINGS_DEFAULTS.showSecurityWarnings,
}

const defaultAutoApprove: AutoApproveSettings = { ...AUTO_APPROVE_DEFAULTS }

const defaultWebSearchConfig: WebSearchConfig = {
  googleApiKey: '',
  googleCx: '',
  searchEngines: generateDefaultSearchEngineConfigs(),
  activeSearchEngine: 'duckduckgo',
  searchTimeout: 30,
}

const defaultMcpConfig: McpConfig = {
  autoConnect: true,
}

const defaultEmailConfig: EmailConfig = {
  enabled: false,
}

export type BrowserMode = 'internal' | 'external'

const defaultBrowserMode: BrowserMode = 'internal'

function generateDefaultProviderConfigs(): Record<string, ProviderModelConfig> {
  const configs: Record<string, ProviderModelConfig> = {}
  for (const [id, provider] of Object.entries(BUILTIN_PROVIDERS)) {
    configs[id] = {
      customModels: [],
      model: provider.defaultModel || '',
      baseUrl: provider.baseUrl,
      openAICompatibilityProfile: getDefaultOpenAICompatibilityProfile(id, provider.protocol),
    }
  }
  return configs
}

// ============================================
// 设置 Schema
// ============================================

export const SETTINGS = {
  llmConfig: {
    default: defaultLLMConfig,
    // 注意：完整的 llmConfig 由 settingsService 单独处理
  },
  language: {
    default: 'en' as const,
  },
  autoApprove: {
    default: defaultAutoApprove,
  },
  promptTemplateId: {
    default: 'default' as string,
  },
  activeScenarioId: {
    default: 'general-assistant' as string,
  },
  providerConfigs: {
    default: generateDefaultProviderConfigs(),
  },
  agentConfig: {
    default: defaultAgentConfig,
  },
  editorConfig: {
    default: defaultEditorConfig,
    storageKey: 'editorConfig',
  },
  securitySettings: {
    default: defaultSecuritySettings,
    storageKey: 'securitySettings',
  },
  webSearchConfig: {
    default: defaultWebSearchConfig,
    syncToMain: 'googleSearch',
  },
  mcpConfig: {
    default: defaultMcpConfig,
    syncToMain: 'mcpAutoConnect',
  },
  emailConfig: {
    default: defaultEmailConfig,
  },
  aiInstructions: {
    default: '' as string,
  },
  onboardingCompleted: {
    default: false as boolean,
  },
  enableFileLogging: {
    default: false as boolean,
  },
  browserMode: {
    default: defaultBrowserMode,
  },
  scenarioPreferences: {
    default: DEFAULT_SCENARIO_PREFERENCES,
  },
  privacySettings: {
    default: PRIVACY_SETTINGS_DEFAULTS,
    storageKey: 'privacySettings',
  },
}

// ============================================
// 类型推断
// ============================================

export type SettingsSchema = typeof SETTINGS
export type SettingKey = keyof SettingsSchema

/** 设置值类型推断 */
export type SettingValue<K extends SettingKey> = SettingsSchema[K]['default']

/** 完整设置状态 */
export type SettingsState = {
  llmConfig: LLMConfig
  language: 'en' | 'zh'
  autoApprove: AutoApproveSettings
  promptTemplateId: string
  activeScenarioId: string
  providerConfigs: Record<string, ProviderModelConfig>
  agentConfig: AgentConfig
  editorConfig: EditorConfig
  securitySettings: SecurityPolicyPanel
  webSearchConfig: WebSearchConfig
  mcpConfig: McpConfig
  emailConfig: EmailConfig
  aiInstructions: string
  onboardingCompleted: boolean
  enableFileLogging: boolean
  browserMode: BrowserMode
  scenarioPreferences: ScenarioPreferences
  privacySettings: PrivacySettings
}

// ============================================
// 工具函数
// ============================================

/** 获取单个设置的默认值 */
export function getDefault<K extends SettingKey>(key: K): SettingValue<K> {
  return SETTINGS[key].default as SettingValue<K>
}

/** 获取所有默认值 */
export function getAllDefaults(): SettingsState {
  return {
    llmConfig: SETTINGS.llmConfig.default,
    language: SETTINGS.language.default as 'en' | 'zh',
    autoApprove: SETTINGS.autoApprove.default,
    promptTemplateId: SETTINGS.promptTemplateId.default,
    activeScenarioId: SETTINGS.activeScenarioId.default,
    providerConfigs: SETTINGS.providerConfigs.default,
    agentConfig: SETTINGS.agentConfig.default,
    editorConfig: SETTINGS.editorConfig.default,
    securitySettings: SETTINGS.securitySettings.default,
    webSearchConfig: SETTINGS.webSearchConfig.default,
    mcpConfig: SETTINGS.mcpConfig.default,
    emailConfig: SETTINGS.emailConfig.default,
    aiInstructions: SETTINGS.aiInstructions.default,
    onboardingCompleted: SETTINGS.onboardingCompleted.default,
    enableFileLogging: SETTINGS.enableFileLogging.default,
    browserMode: SETTINGS.browserMode.default,
    scenarioPreferences: SETTINGS.scenarioPreferences.default,
    privacySettings: SETTINGS.privacySettings.default,
  }
}

/** 获取需要同步到主进程的设置 */
export function getMainSyncSettings(): SettingKey[] {
  return (Object.keys(SETTINGS) as SettingKey[]).filter(
    key => (SETTINGS[key] as SettingMeta<unknown>).syncToMain
  )
}

// ============================================
// 默认值导出
// ============================================

export {
  defaultLLMConfig,
  defaultAgentConfig,
  defaultEditorConfig,
  defaultSecuritySettings,
  defaultAutoApprove,
  defaultWebSearchConfig,
  defaultMcpConfig,
  defaultEmailConfig,
}
