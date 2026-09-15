/**
 * 设置对话框本地状态管理 Hook
 *
 * 将 PreferencesDialog 中的 19 个 useState 统一为 useReducer，
 * 集中管理状态变更逻辑、isDirty 检测和保存操作。
 *
 * 使用方式：
 * ```tsx
 * const { state, dispatch, isDirty, finalEditorConfig, handleSave, ... } = useSettingsLocalState(embedded)
 * ```
 */

import { useReducer, useEffect, useMemo, useCallback, useRef } from 'react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { logger } from '@shared/toolkit/LogEngine'
import { PROVIDERS } from '@configuration/aiProviders'
import stableStringify from 'fast-json-stable-stringify'
import { invalidateAgentConfigCache } from '@intelligence/utils/intelligenceConfig'
import { settingsService } from '@renderer/settings/preferencesService'
import { resolveRuntimeLLMConfig } from '@shared/configuration/modelConfigResolver'
import { t, type Language } from '@renderer/i18n'
import { toast } from '@components/foundation/NotificationProvider'
import type { LLMConfig } from '@shared/protocols/modelProtocol'
import type { PersistedLLMConfig, EditorConfig, SecurityPolicyPanel, AutoApproveSettings, AgentConfig } from '@shared/configuration/configTypes'
import type { ProviderModelConfig } from '@shared/configuration/preferenceSync'
import type { WebSearchConfig, McpConfig, EmailConfig } from '@shared/configuration/configTypes'
import type { PrivacySettings } from '@shared/configuration/defaultProfile'
import type { EditorSettingsState, SettingsTab } from './preferencesTypes'

// ===== 状态接口 =====

export interface SettingsLocalState {
  activeTab: SettingsTab
  showApiKey: boolean
  isClosing: boolean
  localConfig: LLMConfig
  localLanguage: Language
  localAutoApprove: AutoApproveSettings
  localPromptTemplateId: string
  localAgentConfig: AgentConfig
  localProviderConfigs: Record<string, ProviderModelConfig>
  localAiInstructions: string
  localWebSearchConfig: WebSearchConfig
  localMcpConfig: McpConfig
  localEmailConfig: EmailConfig
  localEnableFileLogging: boolean
  localSecuritySettings: SecurityPolicyPanel
  localPrivacySettings: PrivacySettings
  editorSettings: EditorSettingsState
  advancedEditorConfig: EditorConfig
}

// ===== Action 类型 =====

export type SettingsAction =
  | { type: 'SET_ACTIVE_TAB'; tab: SettingsTab }
  | { type: 'SET_SHOW_API_KEY'; show: boolean }
  | { type: 'SET_CLOSING'; closing: boolean }
  | { type: 'SET_LOCAL_CONFIG'; config: LLMConfig }
  | { type: 'SET_LOCAL_LANGUAGE'; language: Language }
  | { type: 'SET_LOCAL_AUTO_APPROVE'; value: AutoApproveSettings }
  | { type: 'SET_LOCAL_PROMPT_TEMPLATE_ID'; value: string }
  | { type: 'SET_LOCAL_AGENT_CONFIG'; config: AgentConfig }
  | { type: 'SET_LOCAL_PROVIDER_CONFIGS'; configs: Record<string, ProviderModelConfig> }
  | { type: 'SET_LOCAL_AI_INSTRUCTIONS'; value: string }
  | { type: 'SET_LOCAL_WEB_SEARCH_CONFIG'; config: WebSearchConfig }
  | { type: 'SET_LOCAL_MCP_CONFIG'; config: McpConfig }
  | { type: 'SET_LOCAL_EMAIL_CONFIG'; config: EmailConfig }
  | { type: 'SET_LOCAL_ENABLE_FILE_LOGGING'; value: boolean }
  | { type: 'SET_LOCAL_SECURITY_SETTINGS'; settings: SecurityPolicyPanel }
  | { type: 'SET_LOCAL_PRIVACY_SETTINGS'; settings: PrivacySettings }
  | { type: 'SET_EDITOR_SETTINGS'; settings: EditorSettingsState }
  | { type: 'SET_ADVANCED_EDITOR_CONFIG'; config: EditorConfig }
  | { type: 'SYNC_FROM_STORE'; payload: Partial<SettingsLocalState> }

// ===== Reducer =====

function settingsReducer(state: SettingsLocalState, action: SettingsAction): SettingsLocalState {
  switch (action.type) {
    case 'SET_ACTIVE_TAB':
      return { ...state, activeTab: action.tab }
    case 'SET_SHOW_API_KEY':
      return { ...state, showApiKey: action.show }
    case 'SET_CLOSING':
      return { ...state, isClosing: action.closing }
    case 'SET_LOCAL_CONFIG':
      return { ...state, localConfig: action.config }
    case 'SET_LOCAL_LANGUAGE':
      return { ...state, localLanguage: action.language }
    case 'SET_LOCAL_AUTO_APPROVE':
      return { ...state, localAutoApprove: action.value }
    case 'SET_LOCAL_PROMPT_TEMPLATE_ID':
      return { ...state, localPromptTemplateId: action.value }
    case 'SET_LOCAL_AGENT_CONFIG':
      return { ...state, localAgentConfig: action.config }
    case 'SET_LOCAL_PROVIDER_CONFIGS':
      return { ...state, localProviderConfigs: action.configs }
    case 'SET_LOCAL_AI_INSTRUCTIONS':
      return { ...state, localAiInstructions: action.value }
    case 'SET_LOCAL_WEB_SEARCH_CONFIG':
      return { ...state, localWebSearchConfig: action.config }
    case 'SET_LOCAL_MCP_CONFIG':
      return { ...state, localMcpConfig: action.config }
    case 'SET_LOCAL_EMAIL_CONFIG':
      return { ...state, localEmailConfig: action.config }
    case 'SET_LOCAL_ENABLE_FILE_LOGGING':
      return { ...state, localEnableFileLogging: action.value }
    case 'SET_LOCAL_SECURITY_SETTINGS':
      return { ...state, localSecuritySettings: action.settings }
    case 'SET_LOCAL_PRIVACY_SETTINGS':
      return { ...state, localPrivacySettings: action.settings }
    case 'SET_EDITOR_SETTINGS':
      return { ...state, editorSettings: action.settings }
    case 'SET_ADVANCED_EDITOR_CONFIG':
      return { ...state, advancedEditorConfig: action.config }
    case 'SYNC_FROM_STORE':
      return { ...state, ...action.payload }
    default:
      return state
  }
}

// ===== 工具函数 =====

function serializeComparable(value: unknown): string {
  try {
    return stableStringify(value as Record<string, unknown>) ?? ''
  } catch {
    return String(value)
  }
}

function toEditorSettingsState(config: EditorConfig): EditorSettingsState {
  return {
    fontSize: config.fontSize ?? 14,
    chatFontSize: config.chatFontSize ?? 14,
    tabSize: config.tabSize ?? 2,
    wordWrap: config.wordWrap ?? 'off',
    lineNumbers: config.lineNumbers ?? 'on',
    minimap: config.minimap ?? true,
    bracketPairColorization: config.bracketPairColorization ?? true,
    formatOnSave: config.formatOnSave ?? false,
    autoSave: config.autoSave ?? 'off',
    autoSaveDelay: config.autoSaveDelay ?? 1000,
    theme: 'light',
    completionEnabled: config.ai?.completionEnabled ?? true,
    completionDebounceMs: config.performance?.completionDebounceMs ?? 150,
    completionMaxTokens: config.ai?.completionMaxTokens ?? 256,
    completionTriggerChars: config.ai?.completionTriggerChars ?? ['.', '/', '@'],
    terminalScrollback: config.terminal?.scrollback ?? 1000,
    terminalMaxOutputLines: config.terminal?.maxOutputLines ?? 5000,
    lspTimeoutMs: config.lsp?.timeoutMs ?? 10000,
    lspCompletionTimeoutMs: config.lsp?.completionTimeoutMs ?? 5000,
    largeFileWarningThresholdMB: config.performance?.largeFileWarningThresholdMB ?? 5,
    largeFileLineCount: config.performance?.largeFileLineCount ?? 20000,
    commandTimeoutMs: config.performance?.commandTimeoutMs ?? 30000,
    workerTimeoutMs: config.performance?.workerTimeoutMs ?? 60000,
    healthCheckTimeoutMs: config.performance?.healthCheckTimeoutMs ?? 15000,
    maxProjectFiles: config.performance?.maxProjectFiles ?? 50000,
    maxFileTreeDepth: config.performance?.maxFileTreeDepth ?? 10,
    maxSearchResults: config.performance?.maxSearchResults ?? 5000,
    saveDebounceMs: config.performance?.saveDebounceMs ?? 1000,
    flushIntervalMs: config.performance?.flushIntervalMs ?? 5000,
  }
}

// ===== Hook =====

export function useSettingsLocalState(embedded: boolean) {
  // 从 store 读取源数据
  const storeValues = useStore(useShallow((s) => ({
    llmConfig: s.llmConfig,
    language: s.language,
    autoApprove: s.autoApprove,
    promptTemplateId: s.promptTemplateId,
    agentConfig: s.agentConfig,
    providerConfigs: s.providerConfigs,
    aiInstructions: s.aiInstructions,
    webSearchConfig: s.webSearchConfig,
    mcpConfig: s.mcpConfig,
    emailConfig: s.emailConfig,
    enableFileLogging: s.enableFileLogging,
    securitySettings: s.securitySettings,
    privacySettings: s.privacySettings,
    editorConfig: s.editorConfig,
    save: s.save,
    settingsInitialTab: s.settingsInitialTab,
    settingsIntent: s.settingsIntent,
    set: s.set,
    setProvider: s.setProvider,
    setShowSettings: s.setShowSettings,
    setShowSettingsPage: s.setShowSettingsPage,
  })))

  const {
    llmConfig, language, autoApprove, promptTemplateId, agentConfig,
    providerConfigs, aiInstructions, webSearchConfig, mcpConfig, emailConfig,
    enableFileLogging, securitySettings, privacySettings, editorConfig,
    save, settingsInitialTab, settingsIntent, set, setProvider,
    setShowSettings, setShowSettingsPage,
  } = storeValues

  // 初始化 reducer state（settingsIntent.tab 优先于 settingsInitialTab）
  const [state, dispatch] = useReducer(settingsReducer, {
    activeTab: (settingsIntent?.tab || settingsInitialTab || 'provider') as SettingsTab,
    showApiKey: false,
    isClosing: false,
    localConfig: llmConfig,
    localLanguage: language,
    localAutoApprove: autoApprove,
    localPromptTemplateId: promptTemplateId,
    localAgentConfig: agentConfig,
    localProviderConfigs: providerConfigs,
    localAiInstructions: aiInstructions,
    localWebSearchConfig: webSearchConfig,
    localMcpConfig: mcpConfig,
    localEmailConfig: emailConfig,
    localEnableFileLogging: enableFileLogging,
    localSecuritySettings: securitySettings,
    localPrivacySettings: privacySettings,
    editorSettings: toEditorSettingsState(editorConfig),
    advancedEditorConfig: editorConfig,
  })

  // 从数据库加载 providerConfigs
  const dbLoadedRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    settingsService.loadProviderConfigsFromDb().then((dbResult) => {
      if (cancelled || !dbResult) return
      dbLoadedRef.current = true
      dispatch({ type: 'SET_LOCAL_PROVIDER_CONFIGS', configs: dbResult.providerConfigs })

      const currentProviderId = dbResult.currentProviderId || llmConfig.provider
      const dbProviderConfig = dbResult.providerConfigs[currentProviderId]
      const builtinDef = PROVIDERS[currentProviderId]

      if (dbProviderConfig) {
        const resolvedConfig = resolveRuntimeLLMConfig(
          {
            provider: currentProviderId,
            model: dbProviderConfig.model || '',
            ...dbResult.llmBehavior,
          } as Partial<PersistedLLMConfig>,
          dbResult.providerConfigs,
        )
        dispatch({ type: 'SET_LOCAL_CONFIG', config: resolvedConfig })
        set('llmConfig', resolvedConfig)
      }
      set('providerConfigs', dbResult.providerConfigs)
    }).catch(() => {
      // 数据库加载失败时回退到 store 数据
    })
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 同步 store 变化到本地状态
  useEffect(() => {
    if (dbLoadedRef.current) {
      dbLoadedRef.current = false
      return
    }
    dispatch({
      type: 'SYNC_FROM_STORE',
      payload: {
        localConfig: llmConfig,
        localLanguage: language,
        localAutoApprove: autoApprove,
        localPromptTemplateId: promptTemplateId,
        localAgentConfig: agentConfig,
        localProviderConfigs: providerConfigs,
        localAiInstructions: aiInstructions,
        localWebSearchConfig: webSearchConfig,
        localMcpConfig: mcpConfig,
        localEmailConfig: emailConfig,
        localEnableFileLogging: enableFileLogging,
        localSecuritySettings: securitySettings,
        localPrivacySettings: privacySettings,
        editorSettings: toEditorSettingsState(editorConfig),
        advancedEditorConfig: editorConfig,
      },
    })
  }, [
    agentConfig, aiInstructions, autoApprove, editorConfig, emailConfig,
    enableFileLogging, language, llmConfig, mcpConfig, promptTemplateId,
    providerConfigs, securitySettings, privacySettings, webSearchConfig,
  ])

  // 初始 tab 同步
  useEffect(() => {
    if (settingsInitialTab) {
      dispatch({ type: 'SET_ACTIVE_TAB', tab: settingsInitialTab as SettingsTab })
    }
  }, [settingsInitialTab])

  // 合并编辑器配置
  const finalEditorConfig = useMemo(() => ({
    ...state.advancedEditorConfig,
    fontSize: state.editorSettings.fontSize,
    chatFontSize: state.editorSettings.chatFontSize,
    tabSize: state.editorSettings.tabSize,
    wordWrap: state.editorSettings.wordWrap,
    lineNumbers: state.editorSettings.lineNumbers,
    minimap: state.editorSettings.minimap,
    bracketPairColorization: state.editorSettings.bracketPairColorization,
    formatOnSave: state.editorSettings.formatOnSave,
    autoSave: state.editorSettings.autoSave,
    autoSaveDelay: state.editorSettings.autoSaveDelay,
    ai: {
      ...state.advancedEditorConfig.ai,
      completionEnabled: state.editorSettings.completionEnabled,
      completionMaxTokens: state.editorSettings.completionMaxTokens,
      completionTriggerChars: state.editorSettings.completionTriggerChars,
    },
    terminal: {
      ...state.advancedEditorConfig.terminal,
      scrollback: state.editorSettings.terminalScrollback,
      maxOutputLines: state.editorSettings.terminalMaxOutputLines,
    },
    lsp: {
      ...state.advancedEditorConfig.lsp,
      timeoutMs: state.editorSettings.lspTimeoutMs,
      completionTimeoutMs: state.editorSettings.lspCompletionTimeoutMs,
    },
    performance: {
      ...state.advancedEditorConfig.performance,
      completionDebounceMs: state.editorSettings.completionDebounceMs,
      largeFileWarningThresholdMB: state.editorSettings.largeFileWarningThresholdMB,
      largeFileLineCount: state.editorSettings.largeFileLineCount,
      commandTimeoutMs: state.editorSettings.commandTimeoutMs,
      workerTimeoutMs: state.editorSettings.workerTimeoutMs,
      healthCheckTimeoutMs: state.editorSettings.healthCheckTimeoutMs,
      maxProjectFiles: state.editorSettings.maxProjectFiles,
      maxFileTreeDepth: state.editorSettings.maxFileTreeDepth,
      maxSearchResults: state.editorSettings.maxSearchResults,
      saveDebounceMs: state.editorSettings.saveDebounceMs,
      flushIntervalMs: state.editorSettings.flushIntervalMs,
    },
  }), [state.advancedEditorConfig, state.editorSettings])

  // isDirty 检测
  const isDirty = useMemo(() => {
    return serializeComparable(state.localConfig) !== serializeComparable(llmConfig) ||
      state.localLanguage !== language ||
      state.localAutoApprove !== autoApprove ||
      state.localPromptTemplateId !== promptTemplateId ||
      serializeComparable(state.localAgentConfig) !== serializeComparable(agentConfig) ||
      state.localAiInstructions !== aiInstructions ||
      serializeComparable(state.localWebSearchConfig) !== serializeComparable(webSearchConfig) ||
      serializeComparable(state.localMcpConfig) !== serializeComparable(mcpConfig) ||
      serializeComparable(state.localEmailConfig) !== serializeComparable(emailConfig) ||
      state.localEnableFileLogging !== enableFileLogging ||
      serializeComparable(state.localProviderConfigs) !== serializeComparable(providerConfigs) ||
      serializeComparable(state.localSecuritySettings) !== serializeComparable(securitySettings) ||
      serializeComparable(state.localPrivacySettings) !== serializeComparable(privacySettings) ||
      serializeComparable(finalEditorConfig) !== serializeComparable(editorConfig)
  }, [
    state.localConfig, state.localLanguage, state.localAutoApprove,
    state.localPromptTemplateId, state.localAgentConfig, state.localAiInstructions,
    state.localWebSearchConfig, state.localMcpConfig, state.localEmailConfig,
    state.localEnableFileLogging, state.localProviderConfigs,
    state.localSecuritySettings, state.localPrivacySettings, finalEditorConfig,
    llmConfig, language, autoApprove, promptTemplateId, agentConfig,
    aiInstructions, webSearchConfig, mcpConfig, emailConfig,
    enableFileLogging, providerConfigs, securitySettings, privacySettings, editorConfig,
  ])

  /**
   * 立即应用语言切换（阶段7 s7-09）
   *
   * 与其他设置项"先编辑后保存"的流程不同，语言切换需要立即生效：
   * 1. 更新本地 reducer 状态（保证 UI 选中态即时反馈）
   * 2. 更新 zustand store（触发所有 useI18n() 订阅者响应式重渲染）
   * 3. 同步到主进程（影响原生菜单、系统对话框语言）
   * 4. 后台异步持久化到 SQLite + electron-store（不阻塞 UI）
   *
   * 异常处理：仅记录日志，不向用户抛出 toast —— 即时生效已在 UI 体现，
   * 持久化失败不会影响当前会话体验，下次启动会回退到旧值但用户可重新选择。
   */
  const applyLanguageImmediately = useCallback((lang: Language) => {
    // 1. 更新本地选中态
    dispatch({ type: 'SET_LOCAL_LANGUAGE', language: lang })

    // 2. 更新 store，触发响应式重渲染
    set('language', lang)

    // 3. 同步主进程（菜单、对话框）
    try {
      window.electronAPI?.setLanguage?.(lang)
    } catch (e) {
      logger.settings.error('[useSettingsLocalState] 语言同步主进程失败:', e)
    }

    // 4. 后台异步持久化（不阻塞 UI，不抛 toast）
    // 注：saveSingle<'language'> 的形参类型被 schema 中的 `default: 'zh' as const`
    // 推断为字面量 "zh"，需用 `as never` 绕过这个预存的窄类型问题，运行时无影响
    settingsService.saveSingle('language', lang as never).catch((err) => {
      logger.settings.error('[useSettingsLocalState] 语言持久化失败:', err)
    })
  }, [set])

  // 保存逻辑
  const handleSave = useCallback(async () => {
    if (!isDirty) return

    const currentProvider = state.localConfig.provider
    const providerExists = state.localProviderConfigs[currentProvider] !== undefined || !!PROVIDERS[currentProvider]

    const finalProviderConfigs = providerExists
      ? {
          ...state.localProviderConfigs,
          [currentProvider]: {
            ...state.localProviderConfigs[currentProvider],
            apiKey: state.localConfig.apiKey,
            baseUrl: state.localConfig.baseUrl,
            timeout: state.localConfig.timeout,
            model: state.localConfig.model,
            headers: state.localConfig.headers,
            openAICompatibilityProfile: state.localConfig.openAICompatibilityProfile,
            protocol: state.localConfig.protocol,
          },
        }
      : { ...state.localProviderConfigs }

    try {
      set('llmConfig', state.localConfig)
      set('language', state.localLanguage)
      set('autoApprove', state.localAutoApprove)
      set('promptTemplateId', state.localPromptTemplateId)
      set('agentConfig', state.localAgentConfig)
      invalidateAgentConfigCache()
      set('aiInstructions', state.localAiInstructions)
      set('webSearchConfig', state.localWebSearchConfig)
      set('mcpConfig', state.localMcpConfig)
      set('emailConfig', state.localEmailConfig)
      set('enableFileLogging', state.localEnableFileLogging)
      set('securitySettings', state.localSecuritySettings)
      set('privacySettings', state.localPrivacySettings)
      set('providerConfigs', finalProviderConfigs)
      set('editorConfig', finalEditorConfig)

      // 语言同步到主进程必须在 save() 之前执行，确保即使 save 失败，
      // 主进程的语言设置（影响菜单、系统对话框）也能持久化
      try {
        window.electronAPI?.setLanguage?.(state.localLanguage)
      } catch (e) {
        logger.settings.error('语言同步失败:', e)
      }

      await save()

      window.electronAPI?.httpSetSearchEngineState?.({
        searchEngines: state.localWebSearchConfig.searchEngines || {},
        activeSearchEngine: state.localWebSearchConfig.activeSearchEngine || 'aweeclaw-searxng',
      })

      window.electronAPI?.mcpSetAutoConnect?.(state.localMcpConfig.autoConnect ?? true)

      toast.success(t('success.settingsSaved', state.localLanguage as Language))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }, [isDirty, state, finalEditorConfig, set, save])

  return {
    state,
    dispatch,
    finalEditorConfig,
    isDirty,
    handleSave,
    // 语言运行时切换（阶段7 s7-09）
    applyLanguageImmediately,
    // store 相关
    language,
    setProvider,
    setShowSettings,
    setShowSettingsPage,
    embedded,
  }
}
