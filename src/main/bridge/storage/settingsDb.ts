/**
 * 设置数据库桥接 — SQLite 设置数据库的 IPC 接口
 *
 * 为渲染进程提供 SQLite 设置数据库的读写能力：
 * - settings-db:initialize     — 初始化数据库（含自动迁移）
 * - settings-db:loadAll        — 加载全部设置数据
 * - settings-db:saveAll        — 保存全部设置数据（事务）
 * - settings-db:getProvider    — 获取单个 provider 配置
 * - settings-db:deleteProvider — 删除 provider 配置
 * - settings-db:getPath        — 获取数据库文件路径
 */

import { logger } from '@shared/toolkit/LogEngine'
import { safeIpcHandle } from '../core/ipcGuard'
import { SettingsDb } from '../../modules/settings-db'
import Store from 'electron-store'
import {
  isBuiltinProvider,
  resolveOpenAICompatibilityProfile,
} from '@shared/configuration/aiProviders'
import { SETTINGS } from '@shared/configuration/preferenceSchema'
import type { ProviderConfig } from '@shared/configuration/providerTypes'

// ============================================
// 类型定义
// ============================================

interface SaveAllParams {
  providerConfigs: Record<string, any>
  currentProviderId: string
  llmBehavior: Record<string, any>
  appSettings: Record<string, any>
}

interface LoadAllResult {
  providerConfigs: Record<string, any>
  llmBehavior: Record<string, any>
  appSettings: Record<string, any>
  currentProviderId: string | null
}

// ============================================
// JSON -> SQLite 数据迁移
// ============================================

function migrateFromJsonStore(preferencesStore: Store): boolean {
  const db = SettingsDb.getInstance()

  // 检查是否已迁移
  const existingProviders = db.getAllProviderConfigs()
  if (Object.keys(existingProviders).length > 0) {
    logger.settings.info('[SettingsDb] Already migrated, skipping')
    return false
  }

  logger.settings.info('[SettingsDb] Starting migration from JSON store...')

  try {
    const appSettings = preferencesStore.get('app-settings', {}) as Record<string, any>

    if (!appSettings || Object.keys(appSettings).length === 0) {
      logger.settings.info('[SettingsDb] No existing settings to migrate')
      return false
    }

    // 迁移 provider 配置
    const savedProviderConfigs = appSettings.providerConfigs as Record<string, ProviderConfig> | undefined
    const currentProviderId = (appSettings.llmConfig as any)?.provider ?? SETTINGS.llmConfig.default.provider

    if (savedProviderConfigs) {
      const defaults = SETTINGS.providerConfigs.default
      const mergedConfigs: Record<string, any> = { ...defaults }

      for (const [id, config] of Object.entries(savedProviderConfigs)) {
        if (isBuiltinProvider(id)) {
          mergedConfigs[id] = {
            ...defaults[id],
            ...config,
            openAICompatibilityProfile: resolveOpenAICompatibilityProfile(
              id,
              config.protocol ?? defaults[id]?.protocol,
              config.openAICompatibilityProfile,
            ),
          }
        } else {
          mergedConfigs[id] = {
            ...config,
            openAICompatibilityProfile: resolveOpenAICompatibilityProfile(
              id,
              config.protocol,
              config.openAICompatibilityProfile,
            ),
          }
        }
      }

      db.batchUpsertProviderConfigs(mergedConfigs, currentProviderId)
    }

    // 迁移 LLM 行为参数
    const llmConfig = appSettings.llmConfig as any
    if (llmConfig) {
      const behaviorKeys = [
        'temperature', 'maxTokens', 'topP', 'topK', 'seed',
        'frequencyPenalty', 'presencePenalty', 'stopSequences', 'logitBias',
        'maxRetries', 'toolChoice', 'parallelToolCalls',
        'enableThinking', 'thinkingBudget', 'reasoningEffort',
      ]
      const behaviors: Record<string, any> = {}
      for (const key of behaviorKeys) {
        if (llmConfig[key] !== undefined) {
          behaviors[key] = llmConfig[key]
        }
      }
      db.batchUpsertLlmBehavior(behaviors)
    }

    // 迁移通用应用设置
    const appSettingKeys = [
      'language', 'autoApprove', 'promptTemplateId', 'activeScenarioId',
      'agentConfig', 'aiInstructions', 'onboardingCompleted',
      'environmentCheckCompleted',
      'webSearchConfig', 'mcpConfig', 'emailConfig', 'enableFileLogging',
      'browserMode', 'scenarioPreferences',
    ]
    const appSettingsToMigrate: Record<string, any> = {}
    for (const key of appSettingKeys) {
      if (appSettings[key] !== undefined) {
        appSettingsToMigrate[key] = appSettings[key]
      }
    }
    db.batchUpsertAppSettings(appSettingsToMigrate)

    logger.settings.info('[SettingsDb] Migration completed successfully')
    return true
  } catch (err) {
    logger.settings.error('[SettingsDb] Migration failed:', err)
    return false
  }
}

// ============================================
// IPC Handlers
// ============================================

export function registerSettingsDbIpcHandlers(preferencesStore: Store): void {
  const db = SettingsDb.getInstance()

  // 初始化数据库 + 自动迁移
  safeIpcHandle('settings-db:initialize', async () => {
    try {
      await db.initialize()
      migrateFromJsonStore(preferencesStore)
      return { success: true, dbPath: db.getDbPath() }
    } catch (err) {
      logger.settings.error('[SettingsDb] Initialize failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 加载全部设置
  safeIpcHandle('settings-db:loadAll', async (): Promise<LoadAllResult> => {
    try {
      const providerConfigs = db.getAllProviderConfigs()
      const llmBehavior = db.getAllLlmBehavior()
      const appSettings = db.getAllAppSettings()
      const currentProviderId = db.getCurrentProviderId()

      return { providerConfigs, llmBehavior, appSettings, currentProviderId }
    } catch (err) {
      logger.settings.error('[SettingsDb] LoadAll failed:', err)
      return { providerConfigs: {}, llmBehavior: {}, appSettings: {}, currentProviderId: null }
    }
  })

  // 保存全部设置（事务）
  safeIpcHandle('settings-db:saveAll', async (_event, params: SaveAllParams) => {
    try {
      const { providerConfigs, currentProviderId, llmBehavior, appSettings } = params

      // SettingsDb 内部已有事务支持，分批调用
      db.batchUpsertProviderConfigs(providerConfigs, currentProviderId)
      db.batchUpsertLlmBehavior(llmBehavior)
      db.batchUpsertAppSettings(appSettings)

      return { success: true }
    } catch (err) {
      logger.settings.error('[SettingsDb] SaveAll failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 获取单个 provider 配置
  safeIpcHandle('settings-db:getProvider', async (_event, providerId: string) => {
    try {
      return db.getProviderConfig(providerId)
    } catch (err) {
      logger.settings.error('[SettingsDb] GetProvider failed:', err)
      return null
    }
  })

  // 删除 provider 配置
  safeIpcHandle('settings-db:deleteProvider', async (_event, providerId: string) => {
    try {
      db.deleteProviderConfig(providerId)
      return { success: true }
    } catch (err) {
      logger.settings.error('[SettingsDb] DeleteProvider failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 获取数据库路径
  safeIpcHandle('settings-db:getPath', async () => {
    return db.getDbPath()
  })

  // ============ 视觉模型配置（自定义模式） ============

  // 获取视觉模型配置
  safeIpcHandle('settings-db:getVisionModelConfig', async () => {
    try {
      return db.getVisionModelConfig()
    } catch (err) {
      logger.settings.error('[SettingsDb] GetVisionModelConfig failed:', err)
      return null
    }
  })

  // 保存视觉模型配置
  safeIpcHandle('settings-db:saveVisionModelConfig', async (_event, config: any) => {
    try {
      db.upsertVisionModelConfig(config)
      return { success: true }
    } catch (err) {
      logger.settings.error('[SettingsDb] SaveVisionModelConfig failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 更新视觉模型启用状态
  safeIpcHandle('settings-db:setVisionModelEnabled', async (_event, enabled: boolean) => {
    try {
      db.setVisionModelEnabled(enabled)
      return { success: true }
    } catch (err) {
      logger.settings.error('[SettingsDb] SetVisionModelEnabled failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ============ 语音模型配置（自定义模式） ============
  // STT（语音识别）和 TTS（语音合成）合并存储，但可分别启用

  // 获取语音模型配置
  safeIpcHandle('settings-db:getVoiceModelConfig', async () => {
    try {
      return db.getVoiceModelConfig()
    } catch (err) {
      logger.settings.error('[SettingsDb] GetVoiceModelConfig failed:', err)
      return null
    }
  })

  // 保存语音模型配置（upsert，STT 和 TTS 一并写入）
  safeIpcHandle('settings-db:saveVoiceModelConfig', async (_event, config: any) => {
    try {
      db.upsertVoiceModelConfig(config)
      return { success: true }
    } catch (err) {
      logger.settings.error('[SettingsDb] SaveVoiceModelConfig failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 更新语音模型启用状态（STT/TTS 分别控制）
  safeIpcHandle('settings-db:setVoiceModelEnabled', async (_event, payload: { sttEnabled: boolean; ttsEnabled: boolean }) => {
    try {
      db.setVoiceModelEnabled(payload.sttEnabled, payload.ttsEnabled)
      return { success: true }
    } catch (err) {
      logger.settings.error('[SettingsDb] SetVoiceModelEnabled failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ============ 语音唤醒配置 ============

  // 获取语音唤醒配置
  safeIpcHandle('settings-db:getWakeWordConfig', async () => {
    try {
      return db.getWakeWordConfig()
    } catch (err) {
      logger.settings.error('[SettingsDb] GetWakeWordConfig failed:', err)
      return null
    }
  })

  // 保存语音唤醒配置（upsert，唤醒词/灵敏度/冷却一并写入）
  safeIpcHandle('settings-db:saveWakeWordConfig', async (_event, config: any) => {
    try {
      db.upsertWakeWordConfig(config)
      return { success: true }
    } catch (err) {
      logger.settings.error('[SettingsDb] SaveWakeWordConfig failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 仅更新唤醒启用状态（即时生效，无需走保存栏）
  safeIpcHandle('settings-db:setWakeWordEnabled', async (_event, enabled: boolean) => {
    try {
      db.setWakeWordEnabled(enabled)
      return { success: true }
    } catch (err) {
      logger.settings.error('[SettingsDb] SetWakeWordEnabled failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 获取视觉 OCR 配置（macOS Vision OCR + OCR 路由策略）
  // 配置存储在 app_settings.visualOcrConfig，无配置时返回 null（使用默认值）
  safeIpcHandle('settings-db:getVisualOcrConfig', async () => {
    try {
      return db.getAppSetting('visualOcrConfig')
    } catch (err) {
      logger.settings.error('[SettingsDb] GetVisualOcrConfig failed:', err)
      return null
    }
  })

  // 保存视觉 OCR 配置
  // config 结构：{ pythonBin?, timeoutMs?, prefer?, enabled? }
  // 所有字段可选，未提供字段保留原值
  safeIpcHandle('settings-db:saveVisualOcrConfig', async (_event, config: any) => {
    try {
      const existing = (db.getAppSetting('visualOcrConfig') as Record<string, any> | null) || {}
      const merged = { ...existing, ...config }
      db.upsertAppSetting('visualOcrConfig', merged)
      return { success: true, config: merged }
    } catch (err) {
      logger.settings.error('[SettingsDb] SaveVisualOcrConfig failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  logger.ipc.info('[SettingsDb] IPC handlers registered')
}
