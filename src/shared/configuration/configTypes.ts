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

/**
 * 授权方式：控制 UI 层工具审批门禁的严格程度
 *
 * 优先级：authorizationMode > freeModeEnabled > autoApprove
 * - undefined（旧版本未设置）时回退到 autoApprove/freeModeEnabled 逻辑
 * - 有值时覆盖 autoApprove/freeModeEnabled，成为工具审批的唯一开关
 *
 * 仅控制 UI 层审批门禁，不影响主进程安全底线（命令黑名单、危险模式、敏感路径、工作区边界）
 */
export type AuthorizationMode = 'every-step' | 'dangerous-only' | 'never'

export interface LoopDetectionConfig {
  enabled: boolean
  maxHistory: number
  maxExactRepeats: number
  maxSameTargetRepeats: number
  patternRepeatHardStop: number
  /** 模式重复警告阈值：达到此次数才发出非阻塞警告（默认 5） */
  patternWarningThreshold?: number
  /** 相同工具+相同参数的渐进式警告阈值（默认 5） */
  sameToolWarningThreshold?: number
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
  /** 当前激活的自定义智能体 ID */
  activeCustomAgentId?: string
  /** 自定义 Agent 角色配置 */
  customAgentProfiles?: Array<{
    id: string
    name: string
    description: string
    systemPrompt: string
    capabilities: string[]
    priority: number
    enabled: boolean
    icon?: string
    identifier?: string
    /** 是否可被其他智能体调用 */
    callable?: boolean
    /** 何时被调用：always | on_request | manual */
    triggerMode?: 'always' | 'on_request' | 'manual'
    /** 关联的内置工具 ID 列表 */
    builtinTools?: string[]
    /** 关联的 MCP 服务 ID 列表 */
    mcpServices?: string[]
    /** 关联的插件 ID 列表 */
    plugins?: string[]
    createdAt?: number
    updatedAt?: number
  }>
  /** 声音提醒设置 */
  soundNotifications?: {
    enabled: boolean
    taskComplete: boolean
    taskError: boolean
    needApproval: boolean
  }
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
  /** 版本控制状态自动刷新（文件变更 / 窗口聚焦时重读 git status） */
  autoRefresh: boolean
  /** 打开工作区时静默执行 git fetch（有远程仓库时；失败不打扰用户） */
  autoFetchOnOpen: boolean
  /** 允许 AI 使用 Git 写操作（git_commit / git_branch） */
  aiWriteEnabled: boolean
  /** 允许 AI 使用远程同步操作（git_sync：pull / push / fetch / clone） */
  aiSyncEnabled: boolean
  /** 允许 AI 使用 worktree 隔离（git_worktree：并行任务各占独立工作目录，互不污染） */
  aiWorktreeEnabled: boolean
  /** 允许 AI 封存审计轨迹（git_audit：合规场景提交并打审计 tag，形成可追溯记录） */
  auditSealEnabled: boolean
  /** 凭证弹窗中「记住凭证」的默认勾选状态 */
  rememberCredentials: boolean
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
  /** 授权方式：undefined 表示旧版本未设置，回退到 autoApprove/freeModeEnabled 逻辑 */
  authorizationMode?: AuthorizationMode
  promptTemplateId?: string
  agentConfig: AgentConfig
  providerConfigs: Record<string, ProviderConfig>
  aiInstructions: string
  onboardingCompleted: boolean
  webSearchConfig?: WebSearchConfig
  mcpConfig?: McpConfig
  emailConfig?: EmailConfig
}
