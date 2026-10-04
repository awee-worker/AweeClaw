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
  expandThinkingByDefault?: boolean
  expandToolCallsByDefault?: boolean
  expandContextByDefault?: boolean
  liveFilePreview?: boolean
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
  /** 当前会话锁定的专家（角色库角色 id），null/undefined 表示自动编排档 */
  activeExpertId?: string | null
  multiAgent?: {
    enabled?: boolean
    mode?: 'auto' | 'always'
    threshold?: number
    requireConsensus?: boolean
    maxAgents?: number
  }
  activeCustomAgentId?: string
  soundNotifications?: {
    enabled?: boolean
    taskComplete?: boolean
    taskError?: boolean
    needApproval?: boolean
  }
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
    callable?: boolean
    triggerMode?: 'always' | 'on_request' | 'manual'
    builtinTools?: string[]
    mcpServices?: string[]
    plugins?: string[]
    createdAt?: number
    updatedAt?: number
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

  const boolFields = ['enableAutoFix', 'expandThinkingByDefault', 'expandToolCallsByDefault', 'expandContextByDefault', 'liveFilePreview', 'enableLLMSummary', 'autoHandoff', 'enableAutoContext'] as const
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

  // activeCustomAgentId
  if (typeof config.activeCustomAgentId === 'string') {
    cleaned.activeCustomAgentId = config.activeCustomAgentId
  }

  // activeExpertId（会话锁定的专家角色，null 表示自动档）
  if (config.activeExpertId === null || typeof config.activeExpertId === 'string') {
    cleaned.activeExpertId = config.activeExpertId
  }

  // soundNotifications 子对象
  if (config.soundNotifications && typeof config.soundNotifications === 'object') {
    const sn = config.soundNotifications as Record<string, unknown>
    const cleanedSn: { enabled?: boolean; taskComplete?: boolean; taskError?: boolean; needApproval?: boolean } = {}
    if (typeof sn.enabled === 'boolean') cleanedSn.enabled = sn.enabled
    if (typeof sn.taskComplete === 'boolean') cleanedSn.taskComplete = sn.taskComplete
    if (typeof sn.taskError === 'boolean') cleanedSn.taskError = sn.taskError
    if (typeof sn.needApproval === 'boolean') cleanedSn.needApproval = sn.needApproval
    cleaned.soundNotifications = cleanedSn as NonNullable<AgentConfigSchema['soundNotifications']>
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
        ...(typeof p.icon === 'string' ? { icon: p.icon } : {}),
        ...(typeof p.identifier === 'string' ? { identifier: p.identifier } : {}),
        ...(typeof p.callable === 'boolean' ? { callable: p.callable } : {}),
        ...(p.triggerMode === 'always' ? { triggerMode: 'always' as const } : {}),
        ...(p.triggerMode === 'on_request' ? { triggerMode: 'on_request' as const } : {}),
        ...(p.triggerMode === 'manual' ? { triggerMode: 'manual' as const } : {}),
        builtinTools: Array.isArray(p.builtinTools)
          ? p.builtinTools.filter((t): t is string => typeof t === 'string')
          : undefined,
        mcpServices: Array.isArray(p.mcpServices)
          ? p.mcpServices.filter((t): t is string => typeof t === 'string')
          : undefined,
        plugins: Array.isArray(p.plugins)
          ? p.plugins.filter((t): t is string => typeof t === 'string')
          : undefined,
        createdAt: typeof p.createdAt === 'number' ? p.createdAt : undefined,
        updatedAt: typeof p.updatedAt === 'number' ? p.updatedAt : undefined,
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
    activeSearchEngine?: string
    searchTimeout?: number
    searchEngines?: Record<string, { enabled: boolean; apiKey?: string; extraValues?: Record<string, string>; customBaseUrl?: string; timeout?: number }>
  }
  mcpConfig?: {
    autoConnect?: boolean
  }
  emailConfig?: {
    enabled?: boolean
    smtp?: {
      host?: string
      port?: number
      secure?: boolean
      user?: string
      pass?: string
    }
    fromName?: string
    fromAddress?: string
    /**
     * 收件账户列表（IMAP）
     *
     * 仅保留非敏感元信息；密码/授权码密文由主进程 safeStorage 单独持有，
     * 不写入 config.json，也不随设置同步到后端。
     */
    accounts?: Array<{
      id?: string
      label?: string
      address?: string
      provider?: string
      imap?: { host?: string; port?: number; secure?: boolean }
      /** 外发（SMTP）服务器；省略时按服务商规则自动推导 */
      smtp?: { host?: string; port?: number; secure?: boolean }
      auth?: { type?: string; user?: string; hasSecret?: boolean }
      idleEnabled?: boolean
      folders?: string[]
      enabled?: boolean
      createdAt?: number
    }>
    /**
     * 新增收件账户的表单草稿（非敏感字段）
     *
     * 不含密码/授权码，仅承载收件与外发表单的未保存编辑态。
     */
    accountDraft?: {
      label?: string
      address?: string
      provider?: string
      host?: string
      port?: number
      secure?: boolean
      /** 外发服务器地址；留空表示自动推导 */
      smtpHost?: string
      /** 外发服务器端口 */
      smtpPort?: number
      /** 外发是否直连 TLS */
      smtpSecure?: boolean
    }
    /** 定时自动整理设置 */
    autoOrganize?: {
      enabled?: boolean
      expression?: string
      ruleId?: string
    }
  }
  /**
   * 以下三项除独立持久化键外，也会随 app-settings 一并写入。
   * 必须原样透传（不做字段裁剪），否则 securitySettings 里
   * allowedExternalDirectories 这类扩展字段会在清洗时被丢弃，
   * 造成「安全设置里配了工作区外允许访问目录却不生效」。
   */
  editorConfig?: Record<string, unknown>
  securitySettings?: Record<string, unknown>
  privacySettings?: Record<string, unknown>
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
    if (typeof ws.activeSearchEngine === 'string') cleaned.webSearchConfig.activeSearchEngine = ws.activeSearchEngine
    if (typeof ws.searchTimeout === 'number') cleaned.webSearchConfig.searchTimeout = ws.searchTimeout
    if (ws.searchEngines && typeof ws.searchEngines === 'object') {
      const engines: Record<string, { enabled: boolean; apiKey?: string; extraValues?: Record<string, string>; customBaseUrl?: string; timeout?: number }> = {}
      for (const [id, cfg] of Object.entries(ws.searchEngines as Record<string, unknown>)) {
        if (cfg && typeof cfg === 'object') {
          const c = cfg as Record<string, unknown>
          engines[id] = {
            enabled: typeof c.enabled === 'boolean' ? c.enabled : false,
          }
          if (typeof c.apiKey === 'string') engines[id].apiKey = c.apiKey
          if (c.extraValues && typeof c.extraValues === 'object') engines[id].extraValues = c.extraValues as Record<string, string>
          if (typeof c.customBaseUrl === 'string') engines[id].customBaseUrl = c.customBaseUrl
          if (typeof c.timeout === 'number') engines[id].timeout = c.timeout
        }
      }
      cleaned.webSearchConfig.searchEngines = engines
    }
  }

  // mcpConfig
  if (config.mcpConfig && typeof config.mcpConfig === 'object') {
    const mcp = config.mcpConfig as Record<string, unknown>
    cleaned.mcpConfig = {}
    if (typeof mcp.autoConnect === 'boolean') cleaned.mcpConfig.autoConnect = mcp.autoConnect
  }

  // emailConfig
  if (config.emailConfig && typeof config.emailConfig === 'object') {
    const email = config.emailConfig as Record<string, unknown>
    cleaned.emailConfig = {}
    if (typeof email.enabled === 'boolean') cleaned.emailConfig.enabled = email.enabled
    if (email.smtp && typeof email.smtp === 'object') {
      const smtp = email.smtp as Record<string, unknown>
      cleaned.emailConfig.smtp = {}
      if (typeof smtp.host === 'string') cleaned.emailConfig.smtp.host = smtp.host
      if (typeof smtp.port === 'number') cleaned.emailConfig.smtp.port = smtp.port
      if (typeof smtp.secure === 'boolean') cleaned.emailConfig.smtp.secure = smtp.secure
      if (typeof smtp.user === 'string') cleaned.emailConfig.smtp.user = smtp.user
      if (typeof smtp.pass === 'string') cleaned.emailConfig.smtp.pass = smtp.pass
    }
    if (typeof email.fromName === 'string') cleaned.emailConfig.fromName = email.fromName
    if (typeof email.fromAddress === 'string') cleaned.emailConfig.fromAddress = email.fromAddress

    // 收件账户：逐字段白名单清洗，任何疑似凭据字段（pass/password/token）一律丢弃。
    // 凭据由主进程安全存储持有，此结构只承载连接元信息与 hasSecret 标记。
    // 账户可携带 smtp 端点（外发服务器与收件不同时使用），同样只保留非敏感连接参数。
    type SanitizedAccount = {
      id: string
      label?: string
      address?: string
      provider?: string
      imap?: { host?: string; port?: number; secure?: boolean }
      smtp?: { host?: string; port?: number; secure?: boolean }
      auth?: { type?: string; user?: string; hasSecret?: boolean }
      idleEnabled?: boolean
      folders?: string[]
      enabled?: boolean
      createdAt?: number
    }
    if (Array.isArray(email.accounts)) {
      const accounts: SanitizedAccount[] = []
      for (const raw of email.accounts) {
        if (!raw || typeof raw !== 'object') continue
        const a = raw as Record<string, unknown>
        if (typeof a.id !== 'string' || !a.id) continue
        const acc: SanitizedAccount = { id: a.id }
        if (typeof a.label === 'string') acc.label = a.label
        if (typeof a.address === 'string') acc.address = a.address
        if (typeof a.provider === 'string') acc.provider = a.provider
        if (typeof a.enabled === 'boolean') acc.enabled = a.enabled
        if (typeof a.idleEnabled === 'boolean') acc.idleEnabled = a.idleEnabled
        if (typeof a.createdAt === 'number') acc.createdAt = a.createdAt
        if (Array.isArray(a.folders)) {
          acc.folders = a.folders.filter((f): f is string => typeof f === 'string')
        }
        if (a.imap && typeof a.imap === 'object') {
          const im = a.imap as Record<string, unknown>
          acc.imap = {}
          if (typeof im.host === 'string') acc.imap.host = im.host
          if (typeof im.port === 'number') acc.imap.port = im.port
          if (typeof im.secure === 'boolean') acc.imap.secure = im.secure
        }
        if (a.smtp && typeof a.smtp === 'object') {
          const sm = a.smtp as Record<string, unknown>
          acc.smtp = {}
          if (typeof sm.host === 'string') acc.smtp.host = sm.host
          if (typeof sm.port === 'number') acc.smtp.port = sm.port
          if (typeof sm.secure === 'boolean') acc.smtp.secure = sm.secure
        }
        if (a.auth && typeof a.auth === 'object') {
          const au = a.auth as Record<string, unknown>
          acc.auth = {}
          if (typeof au.type === 'string') acc.auth.type = au.type
          if (typeof au.user === 'string') acc.auth.user = au.user
          if (typeof au.hasSecret === 'boolean') acc.auth.hasSecret = au.hasSecret
        }
        accounts.push(acc)
      }
      cleaned.emailConfig.accounts = accounts
    }

    // 新增账户表单草稿：逐字段白名单，凭据字段一律不在此结构中出现
    if (email.accountDraft && typeof email.accountDraft === 'object') {
      const draft = email.accountDraft as Record<string, unknown>
      const cleanDraft: NonNullable<AppSettingsSchema['emailConfig']>['accountDraft'] = {}
      if (typeof draft.label === 'string') cleanDraft.label = draft.label
      if (typeof draft.address === 'string') cleanDraft.address = draft.address
      if (typeof draft.provider === 'string') cleanDraft.provider = draft.provider
      if (typeof draft.host === 'string') cleanDraft.host = draft.host
      if (typeof draft.port === 'number') cleanDraft.port = draft.port
      if (typeof draft.secure === 'boolean') cleanDraft.secure = draft.secure
      if (typeof draft.smtpHost === 'string') cleanDraft.smtpHost = draft.smtpHost
      if (typeof draft.smtpPort === 'number') cleanDraft.smtpPort = draft.smtpPort
      if (typeof draft.smtpSecure === 'boolean') cleanDraft.smtpSecure = draft.smtpSecure
      cleaned.emailConfig.accountDraft = cleanDraft
    }

    // 定时自动整理
    if (email.autoOrganize && typeof email.autoOrganize === 'object') {
      const ao = email.autoOrganize as Record<string, unknown>
      cleaned.emailConfig.autoOrganize = {}
      if (typeof ao.enabled === 'boolean') cleaned.emailConfig.autoOrganize.enabled = ao.enabled
      if (typeof ao.expression === 'string') cleaned.emailConfig.autoOrganize.expression = ao.expression
      if (typeof ao.ruleId === 'string') cleaned.emailConfig.autoOrganize.ruleId = ao.ruleId
    }
  }

  // editorConfig / securitySettings / privacySettings 原样透传。
  // 这三项结构开放（如 securitySettings.allowedExternalDirectories），
  // 逐字段白名单裁剪会静默丢失扩展字段，导致设置读回后失效。
  if (config.editorConfig && typeof config.editorConfig === 'object') {
    cleaned.editorConfig = config.editorConfig as Record<string, unknown>
  }
  if (config.securitySettings && typeof config.securitySettings === 'object') {
    cleaned.securitySettings = config.securitySettings as Record<string, unknown>
  }
  if (config.privacySettings && typeof config.privacySettings === 'object') {
    cleaned.privacySettings = config.privacySettings as Record<string, unknown>
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
