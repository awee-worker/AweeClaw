/**
 * 共享配置类型 — 持久化设置相关类型的唯一数据源
 */

import type { ApiProtocol, OpenAICompatibilityProfile } from '@shared/configuration/aiProviders'
import type { LLMConfig, LLMProviderOptions } from '@shared/protocols/modelGateway'

export type { LLMConfig }
export type { ApiProtocol }

export interface ProviderConfig {
  apiKey?: string
  baseUrl?: string
  model?: string
  timeout?: number
  customModels?: string[]
  headers?: Record<string, string>
  openAICompatibilityProfile?: OpenAICompatibilityProfile
  displayName?: string
  protocol?: ApiProtocol
  createdAt?: number
  updatedAt?: number
}

export interface AutoApproveSettings {
  terminal: boolean
  dangerous: boolean
}

export interface LoopDetectionConfig {
  enabled: boolean
  maxHistory: number
  maxExactRepeats: number
  maxSameTargetRepeats: number
  patternRepeatHardStop: number
  dynamicThreshold?: boolean
}

export interface AgentConfig {
  maxToolLoops: number
  maxHistoryMessages: number
  maxToolResultChars: number
  maxFileContentChars: number
  maxTotalContextChars: number
  maxContextTokens: number
  maxSingleFileChars: number
  maxContextFiles: number
  maxSemanticResults: number
  maxTerminalChars: number
  maxRetries: number
  retryDelayMs: number
  retryBackoffMultiplier?: number
  toolTimeoutMs: number
  enableAutoFix: boolean
  expandThinkingByDefault: boolean
  expandToolCallsByDefault: boolean
  expandContextByDefault: boolean
  keepRecentTurns: number
  deepCompressionTurns: number
  maxImportantOldTurns: number
  enableLLMSummary: boolean
  autoHandoff: boolean
  summaryMaxContextChars?: {
    quick: number
    detailed: number
    handoff: number
  }
  enableAutoContext?: boolean
  pruneMinimumTokens?: number
  pruneProtectTokens?: number
  loopDetection: LoopDetectionConfig
  dynamicConcurrency?: {
    enabled: boolean
    minConcurrency: number
    maxConcurrency: number
    cpuMultiplier: number
  }
  modePostProcessHooks?: Record<string, unknown>
  toolDependencies?: Record<string, unknown>
  ignoredDirectories: string[]
  multiAgent?: {
    enabled: boolean
    mode: 'auto' | 'always'
    threshold: number
    requireConsensus: boolean
    maxAgents: number
  }
  /** 自定义 Agent 角色配置 */
  customAgentProfiles?: Array<{
    id: string
    name: string
    description: string
    systemPrompt: string
    capabilities: string[]
    priority: number
    enabled: boolean
  }>
}

export interface TerminalConfig {
  fontSize: number
  fontFamily: string
  lineHeight: number
  cursorBlink: boolean
  scrollback: number
  maxOutputLines: number
}

export interface GitConfig {
  autoRefresh: boolean
}

export interface LspConfig {
  timeoutMs: number
  completionTimeoutMs: number
  crashCooldownMs: number
}

export interface PerformanceConfig {
  maxProjectFiles: number
  maxFileTreeDepth: number
  fileChangeDebounceMs: number
  completionDebounceMs: number
  searchDebounceMs: number
  saveDebounceMs: number
  indexStatusIntervalMs: number
  fileWatchIntervalMs: number
  flushIntervalMs: number
  requestTimeoutMs: number
  commandTimeoutMs: number
  workerTimeoutMs: number
  healthCheckTimeoutMs: number
  terminalBufferSize: number
  maxResultLength: number
  largeFileWarningThresholdMB: number
  largeFileLineCount: number
  veryLargeFileLineCount: number
  maxSearchResults: number
}

export interface AiCompletionConfig {
  completionEnabled: boolean
  completionMaxTokens: number
  completionTemperature: number
  completionTriggerChars: string[]
}

export interface EditorConfig {
  fontSize: number
  chatFontSize: number
  fontFamily: string
  tabSize: number
  wordWrap: 'on' | 'off' | 'wordWrapColumn'
  lineHeight: number
  minimap: boolean
  minimapScale: number
  lineNumbers: 'on' | 'off' | 'relative'
  bracketPairColorization: boolean
  enableInlineDiff: boolean
  formatOnSave: boolean
  autoSave: 'off' | 'afterDelay' | 'onFocusChange'
  autoSaveDelay: number
  terminal: TerminalConfig
  git: GitConfig
  lsp: LspConfig
  performance: PerformanceConfig
  ai: AiCompletionConfig
}

export interface SecurityPolicyPanel {
  enablePermissionConfirm: boolean
  strictWorkspaceMode: boolean
  /**
   * 旧版 Shell 命令白名单（保留以兼容已安装版本，不再用于实际校验）。
   * AI 执行 Shell 命令时改由 deniedShellCommands 黑名单拦截。
   */
  allowedShellCommands: string[]
  /** Shell 命令黑名单：命中即拒绝执行（AI 执行 Shell 命令时实际生效的拦截策略） */
  deniedShellCommands: string[]
  allowedGitSubcommands: string[]
  showSecurityWarnings: boolean
  /**
   * 工作区外允许访问的目录列表。
   * 用户主动配置的额外可读写目录，这些目录及其子目录和文件不受工作区边界限制，
   * 但仍受敏感路径检查约束（如 .ssh、.aws 等系统敏感目录仍被拒绝）。
   * 适用于需要读取工作区外文件（如引用公共库、配置文件等）的场景。
   */
  allowedExternalDirectories?: string[]
}

export interface SearchEngineConfig {
  enabled: boolean
  apiKey?: string
  extraValues?: Record<string, string>
  customBaseUrl?: string
  timeout?: number
}

export interface WebSearchConfig {
  googleApiKey?: string
  googleCx?: string
  searchEngines?: Record<string, SearchEngineConfig>
  activeSearchEngine?: string
  searchTimeout?: number
}

export interface McpConfig {
  autoConnect?: boolean
}

export interface EmailSmtpConfig {
  host: string
  port: number
  secure: boolean
  user: string
  pass: string
}

export interface EmailConfig {
  enabled: boolean
  smtp?: EmailSmtpConfig
  fromName?: string
  fromAddress?: string
}

export interface PersistedLLMConfig {
  provider: string
  model: string
  enableThinking?: boolean
  thinkingBudget?: number
  reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  temperature?: number
  maxTokens?: number
  topP?: number
  topK?: number
  frequencyPenalty?: number
  presencePenalty?: number
  stopSequences?: string[]
  seed?: number
  logitBias?: Record<string, number>
  maxRetries?: number
  toolChoice?: 'auto' | 'none' | 'required' | { type: 'tool'; toolName: string }
  parallelToolCalls?: boolean
  providerOptions?: LLMProviderOptions
}

export interface AppSettings {
  llmConfig: PersistedLLMConfig
  language: string
  autoApprove: AutoApproveSettings
  promptTemplateId?: string
  agentConfig: AgentConfig
  providerConfigs: Record<string, ProviderConfig>
  aiInstructions: string
  onboardingCompleted: boolean
  webSearchConfig?: WebSearchConfig
  mcpConfig?: McpConfig
  emailConfig?: EmailConfig
}
