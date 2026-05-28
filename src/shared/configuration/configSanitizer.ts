/**
 * 配置清理器
 * 
 * 在保存配置时自动移除不存在的字段，保持配置文件干净
 */

import { sanitizePersistedLLMConfig } from '@configuration/modelPersistence'
import type { ScenarioDomain } from './defaultProfile'

// ============================================
// EditorConfig 清理
// ============================================

export interface EditorConfigSchema {
  fontSize?: number
  chatFontSize?: number
  fontFamily?: string
  tabSize?: number
  wordWrap?: 'on' | 'off' | 'wordWrapColumn'
  lineHeight?: number
  minimap?: boolean
  minimapScale?: number
  lineNumbers?: 'on' | 'off' | 'relative'
  bracketPairColorization?: boolean
  enableInlineDiff?: boolean
  formatOnSave?: boolean
  autoSave?: 'off' | 'afterDelay' | 'onFocusChange'
  autoSaveDelay?: number
  terminal?: {
    fontSize?: number
    fontFamily?: string
    lineHeight?: number
    cursorBlink?: boolean
    scrollback?: number
    maxOutputLines?: number
  }
  git?: {
    autoRefresh?: boolean
  }
  lsp?: {
    timeoutMs?: number
    completionTimeoutMs?: number
    crashCooldownMs?: number
  }
  performance?: {
    maxProjectFiles?: number
    maxFileTreeDepth?: number
    fileChangeDebounceMs?: number
    completionDebounceMs?: number
    searchDebounceMs?: number
    saveDebounceMs?: number
    indexStatusIntervalMs?: number
    fileWatchIntervalMs?: number
    flushIntervalMs?: number
    requestTimeoutMs?: number
    commandTimeoutMs?: number
    workerTimeoutMs?: number
    healthCheckTimeoutMs?: number
    terminalBufferSize?: number
    maxResultLength?: number
    largeFileWarningThresholdMB?: number
    largeFileLineCount?: number
    veryLargeFileLineCount?: number
    maxSearchResults?: number
  }
  ai?: {
    completionEnabled?: boolean
    completionMaxTokens?: number
    completionTemperature?: number
    completionTriggerChars?: string[]
  }
}

export function cleanEditorConfig(config: Record<string, unknown>): EditorConfigSchema {
  const cleaned: EditorConfigSchema = {}

  // 基础字段
  if (typeof config.fontSize === 'number') cleaned.fontSize = config.fontSize
  if (typeof config.chatFontSize === 'number') cleaned.chatFontSize = config.chatFontSize
  if (typeof config.fontFamily === 'string') cleaned.fontFamily = config.fontFamily
  if (typeof config.tabSize === 'number') cleaned.tabSize = config.tabSize
  if (config.wordWrap === 'on' || config.wordWrap === 'off' || config.wordWrap === 'wordWrapColumn') {
    cleaned.wordWrap = config.wordWrap
  }
  if (typeof config.lineHeight === 'number') cleaned.lineHeight = config.lineHeight
  if (typeof config.minimap === 'boolean') cleaned.minimap = config.minimap
  if (typeof config.minimapScale === 'number') cleaned.minimapScale = config.minimapScale
  if (config.lineNumbers === 'on' || config.lineNumbers === 'off' || config.lineNumbers === 'relative') {
    cleaned.lineNumbers = config.lineNumbers
  }
  if (typeof config.bracketPairColorization === 'boolean') cleaned.bracketPairColorization = config.bracketPairColorization
  if (typeof config.enableInlineDiff === 'boolean') cleaned.enableInlineDiff = config.enableInlineDiff
  if (typeof config.formatOnSave === 'boolean') cleaned.formatOnSave = config.formatOnSave
  if (config.autoSave === 'off' || config.autoSave === 'afterDelay' || config.autoSave === 'onFocusChange') {
    cleaned.autoSave = config.autoSave
  }
  if (typeof config.autoSaveDelay === 'number') cleaned.autoSaveDelay = config.autoSaveDelay

  // terminal 子对象
  if (config.terminal && typeof config.terminal === 'object') {
    const t = config.terminal as Record<string, unknown>
    cleaned.terminal = {}
    if (typeof t.fontSize === 'number') cleaned.terminal.fontSize = t.fontSize
    if (typeof t.fontFamily === 'string') cleaned.terminal.fontFamily = t.fontFamily
    if (typeof t.lineHeight === 'number') cleaned.terminal.lineHeight = t.lineHeight
    if (typeof t.cursorBlink === 'boolean') cleaned.terminal.cursorBlink = t.cursorBlink
    if (typeof t.scrollback === 'number') cleaned.terminal.scrollback = t.scrollback
    if (typeof t.maxOutputLines === 'number') cleaned.terminal.maxOutputLines = t.maxOutputLines
  }

  // git 子对象
  if (config.git && typeof config.git === 'object') {
    const g = config.git as Record<string, unknown>
    cleaned.git = {}
    if (typeof g.autoRefresh === 'boolean') cleaned.git.autoRefresh = g.autoRefresh
  }

  // lsp 子对象
  if (config.lsp && typeof config.lsp === 'object') {
    const l = config.lsp as Record<string, unknown>
    cleaned.lsp = {}
    if (typeof l.timeoutMs === 'number') cleaned.lsp.timeoutMs = l.timeoutMs
    if (typeof l.completionTimeoutMs === 'number') cleaned.lsp.completionTimeoutMs = l.completionTimeoutMs
    if (typeof l.crashCooldownMs === 'number') cleaned.lsp.crashCooldownMs = l.crashCooldownMs
  }

  // performance 子对象
  if (config.performance && typeof config.performance === 'object') {
    const p = config.performance as Record<string, unknown>
    cleaned.performance = {}
    const numFields = [
      'maxProjectFiles', 'maxFileTreeDepth', 'fileChangeDebounceMs', 'completionDebounceMs',
      'searchDebounceMs', 'saveDebounceMs', 'indexStatusIntervalMs', 'fileWatchIntervalMs',
      'flushIntervalMs', 'requestTimeoutMs', 'commandTimeoutMs', 'workerTimeoutMs',
      'healthCheckTimeoutMs', 'terminalBufferSize', 'maxResultLength',
      'largeFileWarningThresholdMB', 'largeFileLineCount', 'veryLargeFileLineCount', 'maxSearchResults'
    ] as const
    for (const field of numFields) {
      if (typeof p[field] === 'number') {
        (cleaned.performance as Record<string, number>)[field] = p[field] as number
      }
    }
  }

  // ai 子对象
  if (config.ai && typeof config.ai === 'object') {
    const a = config.ai as Record<string, unknown>
    cleaned.ai = {}
    if (typeof a.completionEnabled === 'boolean') cleaned.ai.completionEnabled = a.completionEnabled
    if (typeof a.completionMaxTokens === 'number') cleaned.ai.completionMaxTokens = a.completionMaxTokens
    if (typeof a.completionTemperature === 'number') cleaned.ai.completionTemperature = a.completionTemperature
    if (Array.isArray(a.completionTriggerChars)) {
      cleaned.ai.completionTriggerChars = a.completionTriggerChars.filter(c => typeof c === 'string')
    }
  }

  return cleaned
}

// ============================================
// AgentConfig 清理
// ============================================

export interface AgentConfigSchema {
  maxToolLoops?: number
  maxHistoryMessages?: number
  enableAutoFix?: boolean
  maxToolResultChars?: number
  maxFileContentChars?: number
  maxTotalContextChars?: number
  maxContextTokens?: number
  maxSingleFileChars?: number
  maxContextFiles?: number
  maxSemanticResults?: number
  maxTerminalChars?: number
  maxRetries?: number
  retryDelayMs?: number
  toolTimeoutMs?: number
  expandAgentBlocksByDefault?: boolean
  keepRecentTurns?: number
  deepCompressionTurns?: number
  maxImportantOldTurns?: number
  enableLLMSummary?: boolean
  autoHandoff?: boolean
  loopDetection?: {
    enabled?: boolean
    maxHistory?: number
    maxExactRepeats?: number
    maxSameTargetRepeats?: number
    patternRepeatHardStop?: number
    dynamicThreshold?: boolean
  }
  ignoredDirectories?: string[]
  multiAgent?: {
    enabled?: boolean
    mode?: 'auto' | 'always'
    threshold?: number
    requireConsensus?: boolean
    maxAgents?: number
  }
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

export function cleanAgentConfig(config: Record<string, unknown>): AgentConfigSchema {
  const cleaned: AgentConfigSchema = {}

  const numFields = [
    'maxToolLoops', 'maxHistoryMessages', 'maxToolResultChars', 'maxFileContentChars',
    'maxTotalContextChars', 'maxContextTokens', 'maxSingleFileChars', 'maxContextFiles',
    'maxSemanticResults', 'maxTerminalChars', 'maxRetries', 'retryDelayMs', 'toolTimeoutMs',
    'keepRecentTurns', 'deepCompressionTurns', 'maxImportantOldTurns'
  ] as const

  for (const field of numFields) {
    if (typeof config[field] === 'number') {
      (cleaned as Record<string, number>)[field] = config[field] as number
    }
  }

  const boolFields = ['enableAutoFix', 'expandAgentBlocksByDefault', 'enableLLMSummary', 'autoHandoff', 'enableAutoContext'] as const
  for (const field of boolFields) {
    if (typeof config[field] === 'boolean') {
      (cleaned as Record<string, boolean>)[field] = config[field] as boolean
    }
  }

  // loopDetection 子对象
  if (config.loopDetection && typeof config.loopDetection === 'object') {
    const ld = config.loopDetection as Record<string, unknown>
    cleaned.loopDetection = {}
    if (typeof ld.enabled === 'boolean') cleaned.loopDetection.enabled = ld.enabled
    if (typeof ld.maxHistory === 'number') cleaned.loopDetection.maxHistory = ld.maxHistory
    if (typeof ld.maxExactRepeats === 'number') cleaned.loopDetection.maxExactRepeats = ld.maxExactRepeats
    if (typeof ld.maxSameTargetRepeats === 'number') cleaned.loopDetection.maxSameTargetRepeats = ld.maxSameTargetRepeats
    if (typeof ld.patternRepeatHardStop === 'number') cleaned.loopDetection.patternRepeatHardStop = ld.patternRepeatHardStop
    if (typeof ld.dynamicThreshold === 'boolean') cleaned.loopDetection.dynamicThreshold = ld.dynamicThreshold
  }

  // ignoredDirectories 数组
  if (Array.isArray(config.ignoredDirectories)) {
    cleaned.ignoredDirectories = config.ignoredDirectories.filter(d => typeof d === 'string')
  }

  // multiAgent 子对象
  if (config.multiAgent && typeof config.multiAgent === 'object') {
    const ma = config.multiAgent as Record<string, unknown>
    cleaned.multiAgent = {}
    if (typeof ma.enabled === 'boolean') cleaned.multiAgent.enabled = ma.enabled
    if (ma.mode === 'auto' || ma.mode === 'always') cleaned.multiAgent.mode = ma.mode
    if (typeof ma.threshold === 'number') cleaned.multiAgent.threshold = ma.threshold
    if (typeof ma.requireConsensus === 'boolean') cleaned.multiAgent.requireConsensus = ma.requireConsensus
    if (typeof ma.maxAgents === 'number') cleaned.multiAgent.maxAgents = ma.maxAgents
  }

  // customAgentProfiles 数组
  if (Array.isArray(config.customAgentProfiles)) {
    cleaned.customAgentProfiles = config.customAgentProfiles
      .filter((p): p is Record<string, unknown> => typeof p === 'object' && p !== null)
      .map((p) => ({
        id: typeof p.id === 'string' ? p.id : '',
        name: typeof p.name === 'string' ? p.name : '',
        description: typeof p.description === 'string' ? p.description : '',
        systemPrompt: typeof p.systemPrompt === 'string' ? p.systemPrompt : '',
        capabilities: Array.isArray(p.capabilities)
          ? p.capabilities.filter((c): c is string => typeof c === 'string')
          : [],
        priority: typeof p.priority === 'number' ? p.priority : 5,
        enabled: typeof p.enabled === 'boolean' ? p.enabled : true,
      }))
      .filter((p) => p.id && p.name)
  }

  return cleaned
}

// ============================================
// AppSettings 清理
// ============================================

export interface AppSettingsSchema {
  llmConfig?: {
    provider?: string
    model?: string
    enableThinking?: boolean
    thinkingBudget?: number
    reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
    // 核心参数
    temperature?: number
    maxTokens?: number
    topP?: number
    topK?: number
    frequencyPenalty?: number
    presencePenalty?: number
    stopSequences?: string[]
    seed?: number
    logitBias?: Record<string, number>
    // AI SDK 高级参数
    maxRetries?: number
    toolChoice?: 'auto' | 'none' | 'required' | { type: 'tool'; toolName: string }
    parallelToolCalls?: boolean
    providerOptions?: {
      openai?: Record<string, unknown>
      anthropic?: Record<string, unknown>
      google?: Record<string, unknown>
    }
  }
  language?: string
  autoApprove?: {
    terminal?: boolean
    dangerous?: boolean
  }
  promptTemplateId?: string
  agentConfig?: AgentConfigSchema
  providerConfigs?: Record<string, unknown>
  aiInstructions?: string
  onboardingCompleted?: boolean
  enableFileLogging?: boolean
  webSearchConfig?: {
    googleApiKey?: string
    googleCx?: string
  }
  mcpConfig?: {
    autoConnect?: boolean
  }
}

export function cleanAppSettings(config: Record<string, unknown>): AppSettingsSchema {
  const cleaned: AppSettingsSchema = {}

  // llmConfig
  if (config.llmConfig && typeof config.llmConfig === 'object') {
    cleaned.llmConfig = sanitizePersistedLLMConfig(config.llmConfig)
  }

  if (typeof config.language === 'string') cleaned.language = config.language

  // autoApprove
  if (config.autoApprove && typeof config.autoApprove === 'object') {
    const aa = config.autoApprove as Record<string, unknown>
    cleaned.autoApprove = {}
    if (typeof aa.terminal === 'boolean') cleaned.autoApprove.terminal = aa.terminal
    if (typeof aa.dangerous === 'boolean') cleaned.autoApprove.dangerous = aa.dangerous
  }

  if (typeof config.promptTemplateId === 'string') cleaned.promptTemplateId = config.promptTemplateId

  // agentConfig
  if (config.agentConfig && typeof config.agentConfig === 'object') {
    cleaned.agentConfig = cleanAgentConfig(config.agentConfig as Record<string, unknown>)
  }

  // providerConfigs - 保持原样（结构复杂，由 settingsService 处理）
  if (config.providerConfigs && typeof config.providerConfigs === 'object') {
    cleaned.providerConfigs = config.providerConfigs as Record<string, unknown>
  }

  if (typeof config.aiInstructions === 'string') cleaned.aiInstructions = config.aiInstructions
  if (typeof config.onboardingCompleted === 'boolean') cleaned.onboardingCompleted = config.onboardingCompleted
  if (typeof config.enableFileLogging === 'boolean') cleaned.enableFileLogging = config.enableFileLogging

  // webSearchConfig
  if (config.webSearchConfig && typeof config.webSearchConfig === 'object') {
    const ws = config.webSearchConfig as Record<string, unknown>
    cleaned.webSearchConfig = {}
    if (typeof ws.googleApiKey === 'string') cleaned.webSearchConfig.googleApiKey = ws.googleApiKey
    if (typeof ws.googleCx === 'string') cleaned.webSearchConfig.googleCx = ws.googleCx
  }

  // mcpConfig
  if (config.mcpConfig && typeof config.mcpConfig === 'object') {
    const mcp = config.mcpConfig as Record<string, unknown>
    cleaned.mcpConfig = {}
    if (typeof mcp.autoConnect === 'boolean') cleaned.mcpConfig.autoConnect = mcp.autoConnect
  }

  return cleaned
}

// ============================================
// 统一清理入口
// ============================================

/**
 * 根据 key 清理配置值
 */
export function cleanConfigValue(key: string, value: unknown): unknown {
  if (value === null || value === undefined) return value

  switch (key) {
    case 'editorConfig':
      return typeof value === 'object' ? cleanEditorConfig(value as Record<string, unknown>) : value

    case 'app-settings':
      return typeof value === 'object' ? cleanAppSettings(value as Record<string, unknown>) : value

    default:
      return value
  }
}

// ============================================
// 场景感知配置清洗
// ============================================

export interface ScenarioConfigConstraints {
    domain: ScenarioDomain
    maxTemperature: number
    minTemperature: number
    maxTopP: number
    forcePermissionConfirm: boolean
    forceStrictWorkspace: boolean
    forbidDangerousAutoApprove: boolean
    forbidTerminalAutoApprove: boolean
    maxToolLoops: number
}

const SCENARIO_CONSTRAINTS: Record<ScenarioDomain, ScenarioConfigConstraints> = {
    legal: {
        domain: 'legal',
        maxTemperature: 0.5,
        minTemperature: 0,
        maxTopP: 0.95,
        forcePermissionConfirm: true,
        forceStrictWorkspace: true,
        forbidDangerousAutoApprove: true,
        forbidTerminalAutoApprove: true,
        maxToolLoops: 90,
    },
    medical: {
        domain: 'medical',
        maxTemperature: 0.4,
        minTemperature: 0,
        maxTopP: 0.9,
        forcePermissionConfirm: true,
        forceStrictWorkspace: true,
        forbidDangerousAutoApprove: true,
        forbidTerminalAutoApprove: true,
        maxToolLoops: 60,
    },
    education: {
        domain: 'education',
        maxTemperature: 1.0,
        minTemperature: 0,
        maxTopP: 1.0,
        forcePermissionConfirm: false,
        forceStrictWorkspace: false,
        forbidDangerousAutoApprove: false,
        forbidTerminalAutoApprove: false,
        maxToolLoops: 150,
    },
    general: {
        domain: 'general',
        maxTemperature: 2.0,
        minTemperature: 0,
        maxTopP: 1.0,
        forcePermissionConfirm: false,
        forceStrictWorkspace: false,
        forbidDangerousAutoApprove: false,
        forbidTerminalAutoApprove: false,
        maxToolLoops: 150,
    },
}

export function sanitizeScenarioConfig(
    config: Record<string, unknown>,
    domain: ScenarioDomain
): Record<string, unknown> {
    const constraints = SCENARIO_CONSTRAINTS[domain]
    const sanitized = { ...config }

    if (sanitized.llmConfig && typeof sanitized.llmConfig === 'object') {
        const llm = sanitized.llmConfig as Record<string, unknown>
        if (typeof llm.temperature === 'number') {
            llm.temperature = Math.min(
                Math.max(llm.temperature, constraints.minTemperature),
                constraints.maxTemperature
            )
        }
        if (typeof llm.topP === 'number') {
            llm.topP = Math.min(llm.topP, constraints.maxTopP)
        }
    }

    if (sanitized.autoApprove && typeof sanitized.autoApprove === 'object') {
        const aa = sanitized.autoApprove as Record<string, unknown>
        if (constraints.forbidTerminalAutoApprove) {
            aa.terminal = false
        }
        if (constraints.forbidDangerousAutoApprove) {
            aa.dangerous = false
        }
    }

    if (sanitized.securitySettings && typeof sanitized.securitySettings === 'object') {
        const ss = sanitized.securitySettings as Record<string, unknown>
        if (constraints.forcePermissionConfirm) {
            ss.enablePermissionConfirm = true
        }
        if (constraints.forceStrictWorkspace) {
            ss.strictWorkspaceMode = true
        }
    }

    if (sanitized.agentConfig && typeof sanitized.agentConfig === 'object') {
        const ac = sanitized.agentConfig as Record<string, unknown>
        if (typeof ac.maxToolLoops === 'number') {
            ac.maxToolLoops = Math.min(ac.maxToolLoops, constraints.maxToolLoops)
        }
    }

    return sanitized
}

export function getScenarioConstraints(domain: ScenarioDomain): ScenarioConfigConstraints {
    return { ...SCENARIO_CONSTRAINTS[domain] }
}

export function sanitizeAppSettingsForScenario(
    config: Record<string, unknown>,
    domain: ScenarioDomain
): AppSettingsSchema {
    const scenarioSanitized = sanitizeScenarioConfig(config, domain)
    return cleanAppSettings(scenarioSanitized)
}
