/**
 * Shared configuration types.
 * This is the single source of truth for persisted settings-related shapes.
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
  expandAgentBlocksByDefault: boolean
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
  allowedShellCommands: string[]
  allowedGitSubcommands: string[]
  showSecurityWarnings: boolean
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
