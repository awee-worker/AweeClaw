/**
 * 设置持久化服务 — 基于 SQLite 的设置存储
 *
 * 数据存储架构（v2 - SQLite）:
 * - 主存储: SQLite 数据库（{userData}/.aweeclaw/db/settings.db）
 * - 缓存层: localStorage（快速启动，后台同步 SQLite）
 * - 兼容层: electron-store（editorConfig/securitySettings/privacySettings 仍走旧通道）
 *
 * SQLite 表结构:
 * - provider_config: 每个 provider 独立一行，彻底隔离配置，杜绝串数据
 * - llm_behavior: LLM 生成参数（temperature/maxTokens 等）
 * - app_settings: 通用键值设置（language/autoApprove 等）
 *
 * 数据迁移:
 * - 首次启动时自动从 JSON (electron-store) 迁移到 SQLite
 * - 迁移后 SQLite 为唯一真相来源
 */

import { api } from '../adapters/electronBridge'
import { logger } from '@shared/toolkit/LogEngine'
import { StorageService } from '@shared/toolkit/StorageService'
import { BRAND } from '@shared/brand'
import {
  SETTINGS,
  type SettingsState,
  type SettingKey,
  type SettingValue,
  type ProviderModelConfig,
  getAllDefaults,
} from '@shared/configuration/preferenceSync'
import { resolveRuntimeLLMConfig } from '@shared/configuration/modelConfigResolver'
import {
  isBuiltinProvider,
  getBuiltinProvider,
  getDefaultOpenAICompatibilityProfile,
  resolveOpenAICompatibilityProfile,
} from '@shared/configuration/aiProviders'
import { serializePersistedLLMConfig } from '@configuration/modelPersistence'
import { DEFAULT_SCENARIO_PREFERENCES } from '@shared/configuration/preferenceSchema'
import type {
  ProviderConfig,
  PersistedLLMConfig,
} from '@shared/configuration/providerTypes'
import type { AgentConfig } from '@shared/configuration/configTypes'

// ============================================
// 常量
// ============================================

const STORAGE_KEYS = {
  APP: 'app-settings',
  EDITOR: 'editorConfig',
  SECURITY: 'securitySettings',
  PRIVACY: 'privacySettings',
} as const

const LOCAL_CACHE_KEY = BRAND.storageKeys.settingsCache

// LLM 行为参数键列表（这些参数存在 llm_behavior 表）
const LLM_BEHAVIOR_KEYS = [
  'temperature', 'maxTokens', 'topP', 'topK', 'seed',
  'frequencyPenalty', 'presencePenalty', 'stopSequences', 'logitBias',
  'maxRetries', 'toolChoice', 'parallelToolCalls',
  'enableThinking', 'thinkingBudget', 'reasoningEffort',
] as const

// 存在 app_settings 表的键列表
const APP_SETTING_KEYS = [
  'language', 'autoApprove', 'authorizationMode', 'promptTemplateId', 'activeScenarioId',
  'agentConfig', 'aiInstructions', 'onboardingCompleted',
  'webSearchConfig', 'mcpConfig', 'emailConfig', 'enableFileLogging',
  'browserMode', 'scenarioPreferences',
] as const

// ============================================
// 工具函数
// ============================================

function deepMerge<T extends object>(target: T, source: Partial<T>): T {
  const result = { ...target }

  for (const key in source) {
    if (source[key] === undefined) continue

    const sourceValue = source[key]
    const targetValue = target[key]

    if (
      typeof sourceValue === 'object' &&
      sourceValue !== null &&
      !Array.isArray(sourceValue) &&
      typeof targetValue === 'object' &&
      targetValue !== null
    ) {
      ;(result as Record<string, unknown>)[key] = deepMerge(
        targetValue as object,
        sourceValue as object,
      )
      continue
    }

    ;(result as Record<string, unknown>)[key] = sourceValue
  }

  return result
}

/** 将 SQLite 中的 provider 配置合并默认值，生成运行时 ProviderModelConfig */
function mergeDbProviderConfigs(
  dbConfigs: Record<string, any>,
): Record<string, ProviderModelConfig> {
  const defaults = SETTINGS.providerConfigs.default
  const merged: Record<string, ProviderModelConfig> = { ...defaults }

  for (const [id, config] of Object.entries(dbConfigs)) {
    if (isBuiltinProvider(id)) {
      const resolved = { ...defaults[id], ...config }
      merged[id] = {
        ...resolved,
        openAICompatibilityProfile: resolveOpenAICompatibilityProfile(
          id,
          resolved.protocol ?? defaults[id]?.protocol,
          resolved.openAICompatibilityProfile,
        ),
      }
      continue
    }

    merged[id] = {
      ...config,
      openAICompatibilityProfile: resolveOpenAICompatibilityProfile(
        id,
        config.protocol,
        config.openAICompatibilityProfile,
      ),
    }
  }

  return merged
}

/** 从 SQLite 数据重建完整的 SettingsState */
function rebuildSettingsFromDb(dbData: {
  providerConfigs: Record<string, any>
  llmBehavior: Record<string, any>
  appSettings: Record<string, any>
  currentProviderId: string | null
}): SettingsState {
  const defaults = getAllDefaults()
  const providerConfigs = mergeDbProviderConfigs(dbData.providerConfigs)

  // 从 llmBehavior + currentProviderId 重建 llmConfig
  const behavior = dbData.llmBehavior
  const currentProviderId = dbData.currentProviderId ?? defaults.llmConfig.provider

  // 从 providerConfigs 中获取当前 provider 的传输配置
  const currentProviderDbConfig = dbData.providerConfigs[currentProviderId] || {}
  const builtinDef = getBuiltinProvider(currentProviderId)

  const llmConfig = resolveRuntimeLLMConfig(
    {
      provider: currentProviderId,
      model: currentProviderDbConfig.model || builtinDef?.defaultModel,
      ...behavior,
    } as Partial<PersistedLLMConfig>,
    providerConfigs,
  )

  // 从 appSettings 重建其他设置
  const appSettings = dbData.appSettings

  return {
    llmConfig,
    language: (appSettings.language as 'en' | 'zh') || defaults.language,
    autoApprove: { ...defaults.autoApprove, ...(appSettings.autoApprove as object || {}) },
    // authorizationMode：不合并默认值，保持 undefined 以标记旧版本未设置（回退到 autoApprove/freeModeEnabled 逻辑）
    authorizationMode: appSettings.authorizationMode as SettingsState['authorizationMode'],
    promptTemplateId: (appSettings.promptTemplateId as string) || defaults.promptTemplateId,
    activeScenarioId: (appSettings.activeScenarioId as string) || defaults.activeScenarioId,
    providerConfigs: providerConfigs as Record<string, ProviderModelConfig>,
    agentConfig: appSettings.agentConfig
      ? deepMerge(defaults.agentConfig, appSettings.agentConfig as object)
      : defaults.agentConfig,
    editorConfig: (() => {
      const merged = appSettings.editorConfig
        ? deepMerge(defaults.editorConfig, appSettings.editorConfig as object)
        : defaults.editorConfig
      // 迁移：minimap 默认改为 false，旧配置中可能保存了 true
      // 只在用户从未通过设置界面手动修改过时强制设为 false
      // 由于无法区分"手动设置 true"和"默认 true"，统一迁移为 false
      // 用户可在设置→外观→编辑器设置中重新开启
      if (merged.minimap === true && (appSettings.editorConfig as any)?.minimap === true) {
        merged.minimap = false
      }
      return merged
    })(),
    securitySettings: appSettings.securitySettings
      ? deepMerge(defaults.securitySettings, appSettings.securitySettings as object)
      : defaults.securitySettings,
    webSearchConfig: { ...defaults.webSearchConfig, ...(appSettings.webSearchConfig as object || {}) },
    mcpConfig: { ...defaults.mcpConfig, ...(appSettings.mcpConfig as object || {}) },
    emailConfig: { ...defaults.emailConfig, ...(appSettings.emailConfig as object || {}) },
    aiInstructions: (appSettings.aiInstructions as string) || defaults.aiInstructions,
    onboardingCompleted: typeof appSettings.onboardingCompleted === 'boolean'
      ? appSettings.onboardingCompleted
      : defaults.onboardingCompleted,
    enableFileLogging: typeof appSettings.enableFileLogging === 'boolean'
      ? appSettings.enableFileLogging
      : defaults.enableFileLogging,
    browserMode: (appSettings.browserMode as string) === 'internal' || (appSettings.browserMode as string) === 'external'
      ? appSettings.browserMode as 'internal' | 'external'
      : defaults.browserMode,
    scenarioPreferences: appSettings.scenarioPreferences
      ? { ...DEFAULT_SCENARIO_PREFERENCES, ...(appSettings.scenarioPreferences as object) }
      : defaults.scenarioPreferences,
    privacySettings: appSettings.privacySettings
      ? { ...defaults.privacySettings, ...(appSettings.privacySettings as object) }
      : defaults.privacySettings,
  }
}

// ============================================
// SettingsService 类
// ============================================

class SettingsService {
  private cache: SettingsState | null = null
  private dbInitialized = false

  /** 初始化 SQLite 数据库（含自动迁移） */
  private async ensureDbInitialized(): Promise<void> {
    if (this.dbInitialized) return
    try {
      const result = await api.settings.dbInitialize() as { success?: boolean; error?: string; dbPath?: string }
      // 必须检查 success 字段：IPC 不会抛异常，而是返回 { success: false, error }
      if (result?.success) {
        this.dbInitialized = true
        logger.settings.info('[SettingsService] SQLite DB initialized at', result.dbPath)
      } else {
        this.dbInitialized = false
        logger.settings.error('[SettingsService] SQLite DB init returned failure:', result?.error)
      }
    } catch (err) {
      logger.settings.error('[SettingsService] SQLite DB init failed, falling back to JSON:', err)
      this.dbInitialized = false
    }
  }

  /** 从 SQLite 加载全部设置 */
  async load(): Promise<SettingsState> {
    // 1. 优先从 SQLite 数据库加载（唯一真相来源）
    await this.ensureDbInitialized()

    if (this.dbInitialized) {
      try {
        const dbData = await api.settings.dbLoadAll()
        const hasDbData = Object.keys(dbData.providerConfigs).length > 0 ||
          Object.keys(dbData.appSettings).length > 0

        if (hasDbData) {
          const merged = rebuildSettingsFromDb(dbData)
          // 关键字段缺失时（如旧数据迁移不完整），从 localStorage / electron-store 补全
          const filled = await this.fillMissingFromFallbackStores(merged, dbData.appSettings)
          this.cache = filled
          this.saveToLocalStorage(filled)
          return filled
        }
      } catch (err) {
        logger.settings.error('[SettingsService] SQLite load failed, falling back to cache:', err)
      }
    }

    // 2. 回退到 localStorage 缓存（快速启动兜底）
    try {
      const cached = StorageService.get<Record<string, unknown>>(LOCAL_CACHE_KEY)
      if (cached) {
        const merged = this.mergeFromJson(cached)
        this.cache = merged
        return merged
      }
    } catch {
      // ignore local cache corruption
    }

    // 3. 回退到 JSON (electron-store)
    try {
      const [appSettings, editorConfig, securitySettings] = await Promise.all([
        api.settings.get(STORAGE_KEYS.APP),
        api.settings.get(STORAGE_KEYS.EDITOR),
        api.settings.get(STORAGE_KEYS.SECURITY),
      ])

      const merged = this.mergeFromJson({
        ...(appSettings as object || {}),
        editorConfig,
        securitySettings,
      })

      this.cache = merged
      this.saveToLocalStorage(merged)
      return merged
    } catch (error) {
      logger.settings.error('[SettingsService] Load failed:', error)
      return getAllDefaults()
    }
  }

  /**
   * 从 localStorage / electron-store 补全 SQLite 中缺失的字段
   * 场景：SQLite 初始化成功但部分字段缺失（如旧版本数据迁移不完整）
   *
   * @param sqliteSettings 从 SQLite 重建的设置（缺失字段已用默认值填充）
   * @param dbAppSettings SQLite app_settings 表原始数据（用于判断字段是否真的缺失）
   */
  private async fillMissingFromFallbackStores(
    sqliteSettings: SettingsState,
    dbAppSettings?: Record<string, any>,
  ): Promise<SettingsState> {
    // 通过原始数据判断字段是否真的缺失（而非用户设置为默认值）
    const languageMissing = !dbAppSettings || dbAppSettings.language === undefined || dbAppSettings.language === null
    const onboardingMissing = !dbAppSettings || dbAppSettings.onboardingCompleted === undefined || dbAppSettings.onboardingCompleted === null

    if (!languageMissing && !onboardingMissing) {
      return sqliteSettings
    }

    // 优先从 localStorage 补全
    try {
      const cached = StorageService.get<Record<string, unknown>>(LOCAL_CACHE_KEY)
      if (cached) {
        return {
          ...sqliteSettings,
          language: languageMissing ? ((cached.language as 'en' | 'zh') || sqliteSettings.language) : sqliteSettings.language,
          onboardingCompleted: onboardingMissing
            ? (typeof cached.onboardingCompleted === 'boolean' ? cached.onboardingCompleted : sqliteSettings.onboardingCompleted)
            : sqliteSettings.onboardingCompleted,
        }
      }
    } catch {
      // ignore
    }

    // 其次从 electron-store 补全
    try {
      const appSettings = await api.settings.get(STORAGE_KEYS.APP) as Record<string, unknown> | undefined
      if (appSettings) {
        return {
          ...sqliteSettings,
          language: languageMissing ? ((appSettings.language as 'en' | 'zh') || sqliteSettings.language) : sqliteSettings.language,
          onboardingCompleted: onboardingMissing
            ? (typeof appSettings.onboardingCompleted === 'boolean' ? appSettings.onboardingCompleted : sqliteSettings.onboardingCompleted)
            : sqliteSettings.onboardingCompleted,
        }
      }
    } catch {
      // ignore
    }

    return sqliteSettings
  }

  /** 保存全部设置到 SQLite + electron-store（双写） */
  async save(settings: SettingsState): Promise<void> {
    try {
      this.cache = settings
      this.saveToLocalStorage(settings)

      // 并行发起 SQLite 与 electron-store 写入
      // 使用 allSettled 确保 electron-store（语言持久化的关键）不受 SQLite 失败影响
      const [sqliteResult, jsonResult] = await Promise.allSettled([
        this.saveToDb(settings),
        this.saveToJsonStore(settings),
      ])

      // SQLite 失败仅记录日志，不阻塞流程（electron-store 仍是可靠兜底）
      if (sqliteResult.status === 'rejected') {
        logger.settings.warn('[SettingsService] SQLite save failed (JSON still saved):', sqliteResult.reason)
      }
      // electron-store 失败是严重错误（语言等关键设置可能丢失）
      if (jsonResult.status === 'rejected') {
        logger.settings.error('[SettingsService] JSON store save failed:', jsonResult.reason)
        throw jsonResult.reason
      }

      await this.syncToMain(settings)

      logger.settings.info('[SettingsService] Saved (SQLite + JSON)')
    } catch (error) {
      logger.settings.error('[SettingsService] Save failed:', error)
      throw error
    }
  }

  async saveSingle<K extends SettingKey>(key: K, value: SettingValue<K>): Promise<void> {
    const current = this.cache || await this.load()
    await this.save({ ...current, [key]: value })
  }

  /**
   * 从 SQLite 数据库直接加载 providerConfigs（绕过 localStorage 缓存）。
   * 用于设置界面打开时确保数据来源是数据库而非可能过期的缓存/store。
   */
  async loadProviderConfigsFromDb(): Promise<{
    providerConfigs: Record<string, ProviderModelConfig>
    currentProviderId: string | null
    llmBehavior: Record<string, any>
  } | null> {
    try {
      await this.ensureDbInitialized()
      if (!this.dbInitialized) return null

      const dbData = await api.settings.dbLoadAll()
      const hasDbData = Object.keys(dbData.providerConfigs).length > 0

      if (!hasDbData) return null

      const providerConfigs = mergeDbProviderConfigs(dbData.providerConfigs)
      return {
        providerConfigs: providerConfigs as Record<string, ProviderModelConfig>,
        currentProviderId: dbData.currentProviderId,
        llmBehavior: dbData.llmBehavior,
      }
    } catch (err) {
      logger.settings.error('[SettingsService] loadProviderConfigsFromDb failed:', err)
      return null
    }
  }

  getCache(): SettingsState | null {
    return this.cache
  }

  clearCache(): void {
    this.cache = null
    try {
      StorageService.remove(LOCAL_CACHE_KEY)
    } catch {
      // ignore
    }
  }

  // ============================================
  // SQLite 读写
  // ============================================

  private async saveToDb(settings: SettingsState): Promise<void> {
    await this.ensureDbInitialized()
    if (!this.dbInitialized) return

    // 构建 provider 配置（完整数据，不做 clean，SQLite 是唯一真相来源）
    const providerConfigs: Record<string, any> = {}
    for (const [id, config] of Object.entries(settings.providerConfigs)) {
      providerConfigs[id] = {
        apiKey: config.apiKey ?? '',
        baseUrl: config.baseUrl ?? '',
        model: config.model ?? '',
        timeout: config.timeout ?? 120000,
        customModels: config.customModels ?? [],
        headers: config.headers ?? {},
        openAICompatibilityProfile: config.openAICompatibilityProfile ?? 'full',
        protocol: config.protocol ?? 'openai',
        displayName: config.displayName ?? '',
        modelConfigs: config.modelConfigs ?? {},
        enabled: config.enabled !== false,
      }
    }

    // 构建 LLM 行为参数
    const llmBehavior: Record<string, any> = {}
    for (const key of LLM_BEHAVIOR_KEYS) {
      const value = (settings.llmConfig as any)[key]
      if (value !== undefined) {
        llmBehavior[key] = value
      }
    }

    // 构建应用设置
    const appSettings: Record<string, any> = {}
    for (const key of APP_SETTING_KEYS) {
      const value = (settings as any)[key]
      if (value !== undefined) {
        appSettings[key] = value
      }
    }
    // editorConfig/securitySettings/privacySettings 也存入 app_settings
    appSettings.editorConfig = settings.editorConfig
    appSettings.securitySettings = settings.securitySettings
    appSettings.privacySettings = settings.privacySettings

    const result = await api.settings.dbSaveAll({
      providerConfigs,
      currentProviderId: settings.llmConfig.provider,
      llmBehavior,
      appSettings,
    }) as { success?: boolean; error?: string }

    // 检查保存结果：SQLite 保存失败不应阻塞流程（electron-store 仍保存成功）
    if (!result?.success) {
      logger.settings.warn('[SettingsService] SQLite save returned failure:', result?.error)
      throw new Error(`SQLite save failed: ${result?.error || 'unknown'}`)
    }
  }

  // ============================================
  // JSON (electron-store) 读写（兼容层）
  // ============================================

  private async saveToJsonStore(settings: SettingsState): Promise<void> {
    const cleanedProviderConfigs: Record<string, ProviderConfig> = {}

    for (const [id, config] of Object.entries(settings.providerConfigs)) {
      const cleaned = cleanProviderConfig(id, config, id === settings.llmConfig.provider)
      if (cleaned) cleanedProviderConfigs[id] = cleaned as ProviderConfig
    }

    const appSettings = buildPersistedSettingsPayload(settings, cleanedProviderConfigs)

    await Promise.all([
      api.settings.set(STORAGE_KEYS.APP, appSettings),
      api.settings.set(STORAGE_KEYS.EDITOR, settings.editorConfig),
      api.settings.set(STORAGE_KEYS.SECURITY, settings.securitySettings),
      api.settings.set(STORAGE_KEYS.PRIVACY, settings.privacySettings),
    ])
  }

  // ============================================
  // localStorage 缓存
  // ============================================

  private saveToLocalStorage(settings: SettingsState): void {
    try {
      StorageService.set(
        LOCAL_CACHE_KEY,
        buildPersistedSettingsPayload(settings, settings.providerConfigs),
      )
    } catch {
      // ignore local cache write failures
    }
  }

  // ============================================
  // JSON 合并（兼容旧数据格式）
  // ============================================

  private mergeFromJson(saved: Record<string, unknown>): SettingsState {
    const defaults = getAllDefaults()
    const providerConfigs = mergeProviderConfigsFromJson(
      saved.providerConfigs as Record<string, ProviderConfig> | undefined,
    )
    const llmConfig = resolveRuntimeLLMConfig(
      saved.llmConfig as Partial<PersistedLLMConfig> | undefined,
      providerConfigs,
    )

    return {
      llmConfig,
      language: ((saved.language as string) || defaults.language) as 'en' | 'zh',
      autoApprove: { ...defaults.autoApprove, ...(saved.autoApprove as object || {}) },
      // authorizationMode：不合并默认值，保持 undefined 以标记旧版本未设置
      authorizationMode: saved.authorizationMode as SettingsState['authorizationMode'],
      promptTemplateId: (saved.promptTemplateId as string) || defaults.promptTemplateId,
      activeScenarioId: (saved.activeScenarioId as string) || defaults.activeScenarioId,
      providerConfigs: providerConfigs as Record<string, ProviderModelConfig>,
      agentConfig: saved.agentConfig
        ? (this.migrateAgentConfig(deepMerge(defaults.agentConfig, saved.agentConfig as object) as unknown as Record<string, unknown>) as unknown as AgentConfig)
        : defaults.agentConfig,
      editorConfig: (() => {
        const merged = saved.editorConfig
          ? deepMerge(defaults.editorConfig, saved.editorConfig as object)
          : defaults.editorConfig
        // 迁移：minimap 默认改为 false
        if (merged.minimap === true && (saved.editorConfig as any)?.minimap === true) {
          merged.minimap = false
        }
        return merged
      })(),
      securitySettings: saved.securitySettings
        ? deepMerge(defaults.securitySettings, saved.securitySettings as object)
        : defaults.securitySettings,
      webSearchConfig: { ...defaults.webSearchConfig, ...(saved.webSearchConfig as object || {}) },
      mcpConfig: { ...defaults.mcpConfig, ...(saved.mcpConfig as object || {}) },
      emailConfig: { ...defaults.emailConfig, ...(saved.emailConfig as object || {}) },
      aiInstructions: (saved.aiInstructions as string) || defaults.aiInstructions,
      onboardingCompleted: typeof saved.onboardingCompleted === 'boolean'
        ? saved.onboardingCompleted
        : defaults.onboardingCompleted,
      enableFileLogging: typeof saved.enableFileLogging === 'boolean'
        ? saved.enableFileLogging
        : defaults.enableFileLogging,
      browserMode: (saved.browserMode as string) === 'internal' || (saved.browserMode as string) === 'external'
        ? saved.browserMode as 'internal' | 'external'
        : defaults.browserMode,
      scenarioPreferences: saved.scenarioPreferences
        ? { ...DEFAULT_SCENARIO_PREFERENCES, ...(saved.scenarioPreferences as object) }
        : defaults.scenarioPreferences,
      privacySettings: saved.privacySettings
        ? { ...defaults.privacySettings, ...(saved.privacySettings as object) }
        : defaults.privacySettings,
    }
  }

  // ============================================
  // 数据迁移
  // ============================================

  /**
   * 迁移 agentConfig 中的旧字段到新字段
   * expandAgentBlocksByDefault → expandThinkingByDefault + expandToolCallsByDefault + expandContextByDefault
   */
  private migrateAgentConfig(config: Record<string, unknown>): Record<string, unknown> {
    if ('expandAgentBlocksByDefault' in config
      && !('expandThinkingByDefault' in config)
      && !('expandToolCallsByDefault' in config)
      && !('expandContextByDefault' in config)) {
      const legacyValue = config.expandAgentBlocksByDefault as boolean
      config.expandThinkingByDefault = legacyValue
      config.expandToolCallsByDefault = legacyValue
      config.expandContextByDefault = legacyValue
      delete config.expandAgentBlocksByDefault
      logger.system.info('[SettingsService] Migrated expandAgentBlocksByDefault → 3 split fields')
    }
    return config
  }

  // ============================================
  // 主进程同步
  // ============================================

  private async syncToMain(settings: SettingsState): Promise<void> {
    const promises: Promise<unknown>[] = []

    if (settings.webSearchConfig.searchEngines) {
      promises.push(
        api.http.setSearchEngineState({
          searchEngines: settings.webSearchConfig.searchEngines,
          activeSearchEngine: settings.webSearchConfig.activeSearchEngine || 'duckduckgo',
        }),
      )
    }

    promises.push(api.mcp.setAutoConnect(settings.mcpConfig.autoConnect ?? true))

    await Promise.all(promises)
  }
}

// ============================================
// 旧版 JSON 工具函数（兼容层保留）
// ============================================

function cleanProviderConfig(
  providerId: string,
  config: ProviderConfig,
  isCurrentProvider: boolean,
): Partial<ProviderConfig> | null {
  const builtinDef = getBuiltinProvider(providerId)
  const cleaned: Partial<ProviderConfig> = {}
  const resolvedProtocol = config.protocol ?? builtinDef?.protocol
  const defaultOpenAIProfile = getDefaultOpenAICompatibilityProfile(providerId, resolvedProtocol)

  if (config.apiKey) cleaned.apiKey = config.apiKey
  if (config.baseUrl && config.baseUrl !== builtinDef?.baseUrl) {
    cleaned.baseUrl = config.baseUrl
  }
  if (isCurrentProvider && config.model) cleaned.model = config.model
  if (
    typeof config.timeout === 'number' &&
    config.timeout > 0 &&
    config.timeout !== SETTINGS.llmConfig.default.timeout
  ) {
    cleaned.timeout = config.timeout
  }
  if (config.customModels?.length) cleaned.customModels = config.customModels
  if (config.headers && Object.keys(config.headers).length > 0) cleaned.headers = config.headers
  if (config.protocol && config.protocol !== builtinDef?.protocol) cleaned.protocol = config.protocol
  if (
    config.openAICompatibilityProfile &&
    config.openAICompatibilityProfile !== defaultOpenAIProfile
  ) {
    cleaned.openAICompatibilityProfile = config.openAICompatibilityProfile
  }

  if (!isBuiltinProvider(providerId)) {
    if (config.displayName) cleaned.displayName = config.displayName
    if (config.createdAt) cleaned.createdAt = config.createdAt
    if (config.updatedAt) cleaned.updatedAt = config.updatedAt
    if (config.baseUrl) cleaned.baseUrl = config.baseUrl
  }

  return Object.keys(cleaned).length > 0 ? cleaned : null
}

function mergeProviderConfigsFromJson(
  saved: Record<string, ProviderConfig> | undefined,
): Record<string, ProviderModelConfig> {
  const defaults = SETTINGS.providerConfigs.default
  if (!saved) return { ...defaults }

  const merged: Record<string, ProviderModelConfig> = { ...defaults }

  for (const [id, config] of Object.entries(saved)) {
    if (isBuiltinProvider(id)) {
      const resolved = { ...defaults[id], ...config }
      merged[id] = {
        ...resolved,
        openAICompatibilityProfile: resolveOpenAICompatibilityProfile(
          id,
          resolved.protocol ?? defaults[id]?.protocol,
          resolved.openAICompatibilityProfile,
        ),
      }
      continue
    }

    merged[id] = {
      ...config,
      openAICompatibilityProfile: resolveOpenAICompatibilityProfile(
        id,
        config.protocol,
        config.openAICompatibilityProfile,
      ),
    }
  }

  return merged
}

function buildPersistedSettingsPayload(
  settings: SettingsState,
  providerConfigs: Record<string, unknown>,
) {
  return {
    llmConfig: serializePersistedLLMConfig(settings.llmConfig),
    language: settings.language,
    autoApprove: settings.autoApprove,
    authorizationMode: settings.authorizationMode,
    promptTemplateId: settings.promptTemplateId,
    agentConfig: settings.agentConfig,
    providerConfigs,
    aiInstructions: settings.aiInstructions,
    onboardingCompleted: settings.onboardingCompleted,
    webSearchConfig: settings.webSearchConfig,
    mcpConfig: settings.mcpConfig,
    emailConfig: settings.emailConfig,
    enableFileLogging: settings.enableFileLogging,
    browserMode: settings.browserMode,
    scenarioPreferences: settings.scenarioPreferences ?? DEFAULT_SCENARIO_PREFERENCES,
  }
}

// ============================================
// 导出
// ============================================

export const settingsService = new SettingsService()

export function getEditorConfig(): SettingsState['editorConfig'] {
  return settingsService.getCache()?.editorConfig || SETTINGS.editorConfig.default
}

export function saveEditorConfig(config: Partial<SettingsState['editorConfig']>): void {
  const current = settingsService.getCache()
  if (!current) return

  const merged = deepMerge(current.editorConfig, config)
  settingsService.saveSingle('editorConfig', merged).catch((error) => {
    logger.settings.error('Failed to save editor config:', error)
  })
}

export function resetEditorConfig(): void {
  settingsService.saveSingle('editorConfig', SETTINGS.editorConfig.default).catch((error) => {
    logger.settings.error('Failed to reset editor config:', error)
  })
}
