/**
 * 设置状态切片
 *
 * 统一管理应用偏好、Provider 配置与场景设置，提供加载/保存生命周期。
 */

import { StateCreator } from 'zustand'
import { logger } from '@shared/toolkit/LogEngine'
import { settingsService } from '@renderer/settings/preferencesService'
import {
  type SettingsState,
  type SettingKey,
  type ProviderModelConfig,
  getAllDefaults,
} from '@shared/configuration/preferenceSync'
import { DEFAULT_SCENARIO_PREFERENCES } from '@shared/configuration/preferenceSchema'
import type { ApiProtocol } from '@shared/configuration/aiProviders'

/** 自定义 Provider 标识前缀 */
const CUSTOM_PROVIDER_PREFIX = 'custom-'

/** 切片接口 */
export interface SettingsSlice extends SettingsState {
  hasExistingConfig: boolean

  set: <K extends SettingKey>(key: K, value: SettingsState[K]) => void
  update: <K extends SettingKey>(key: K, partial: Partial<SettingsState[K]>) => void

  setProvider: (id: string, config: ProviderModelConfig) => void
  updateProvider: (id: string, updates: Partial<ProviderModelConfig>) => void
  removeProvider: (id: string) => void
  addModel: (providerId: string, model: string) => void
  removeModel: (providerId: string, model: string) => void
  getCustomProviders: () => Array<{ id: string; config: ProviderModelConfig }>

  load: () => Promise<void>
  save: () => Promise<void>
}

/* ------------------------------------------------------------------ */
/* 辅助函数                                                          */
/* ------------------------------------------------------------------ */

/** 规范化 Provider 配置，确保 customModels 与 protocol 字段存在 */
function normalizeProviderConfig(config: ProviderModelConfig): ProviderModelConfig {
  return {
    ...config,
    customModels: config.customModels || [],
    protocol: config.protocol as ApiProtocol | undefined,
  }
}

/** 在 Provider 配置上应用变更并刷新更新时间 */
function applyProviderPatch(
  current: ProviderModelConfig | undefined,
  patch: Partial<ProviderModelConfig>,
): ProviderModelConfig {
  return { ...(current || {}), ...patch, updatedAt: Date.now() }
}

/** 构造保存时所需的设置快照 */
function buildSavePayload(state: SettingsSlice): SettingsState {
  return {
    llmConfig: state.llmConfig,
    language: state.language,
    autoApprove: state.autoApprove,
    promptTemplateId: state.promptTemplateId,
    activeScenarioId: state.activeScenarioId,
    providerConfigs: state.providerConfigs,
    agentConfig: state.agentConfig,
    editorConfig: state.editorConfig,
    securitySettings: state.securitySettings,
    webSearchConfig: state.webSearchConfig,
    mcpConfig: state.mcpConfig,
    emailConfig: state.emailConfig,
    aiInstructions: state.aiInstructions,
    onboardingCompleted: state.onboardingCompleted,
    enableFileLogging: state.enableFileLogging,
    browserMode: state.browserMode,
    scenarioPreferences: state.scenarioPreferences ?? DEFAULT_SCENARIO_PREFERENCES,
    privacySettings: state.privacySettings,
  }
}

/* ------------------------------------------------------------------ */
/* 切片实现                                                          */
/* ------------------------------------------------------------------ */

export const createSettingsSlice: StateCreator<SettingsSlice, [], [], SettingsSlice> = (set, get) => ({
  ...getAllDefaults(),
  hasExistingConfig: false,

  set: (key, value) => set({ [key]: value } as Partial<SettingsState>),

  update: (key, partial) =>
    set((state) => ({
      [key]: { ...(state[key] as object), ...partial },
    }) as Partial<SettingsState>),

  setProvider: (id, config) =>
    set((state) => ({
      providerConfigs: { ...state.providerConfigs, [id]: config },
    })),

  updateProvider: (id, updates) =>
    set((state) => ({
      providerConfigs: {
        ...state.providerConfigs,
        [id]: applyProviderPatch(state.providerConfigs[id], updates),
      },
    })),

  removeProvider: (id) =>
    set((state) => {
      const { [id]: _removed, ...rest } = state.providerConfigs
      return { providerConfigs: rest }
    }),

  addModel: (providerId, model) =>
    set((state) => {
      const current = state.providerConfigs[providerId] || { customModels: [] }
      return {
        providerConfigs: {
          ...state.providerConfigs,
          [providerId]: {
            ...current,
            customModels: [...(current.customModels || []), model],
          },
        },
      }
    }),

  removeModel: (providerId, model) =>
    set((state) => {
      const current = state.providerConfigs[providerId]
      if (!current) return state
      return {
        providerConfigs: {
          ...state.providerConfigs,
          [providerId]: {
            ...current,
            customModels: (current.customModels || []).filter((m) => m !== model),
          },
        },
      }
    }),

  getCustomProviders: () =>
    Object.entries(get().providerConfigs)
      .filter(([id]) => id.startsWith(CUSTOM_PROVIDER_PREFIX))
      .map(([id, config]) => ({ id, config })),

  load: async () => {
    try {
      const settings = await settingsService.load()
      logger.settings.info('[Settings] Loaded')

      const providerConfigs: Record<string, ProviderModelConfig> = {}
      for (const [id, config] of Object.entries(settings.providerConfigs)) {
        providerConfigs[id] = normalizeProviderConfig(config)
      }

      set({
        ...settings,
        providerConfigs,
        hasExistingConfig: !!settings.llmConfig.apiKey,
      })
    } catch (e) {
      logger.settings.error('[Settings] Load failed:', e)
    }
  },

  save: async () => {
    try {
      await settingsService.save(buildSavePayload(get()))
      logger.settings.info('[Settings] Saved')
    } catch (e) {
      logger.settings.error('[Settings] Save failed:', e)
      throw e
    }
  },
})

export type { SettingsState, SettingKey, ProviderModelConfig }

/* ------------------------------------------------------------------ */
/* 场景感知设置切片扩展                                              */
/* ------------------------------------------------------------------ */

import type { ScenarioDomain } from '@configuration/defaultProfile'
import { SCENARIO_PROFILE_DEFAULTS } from '@configuration/defaultProfile'

/** 场景设置操作接口 */
export interface ScenarioSettingsActions {
  /** 切换当前场景 */
  setActiveScenario: (domain: ScenarioDomain) => void
  /** 启用/禁用场景 */
  toggleScenarioEnabled: (domain: ScenarioDomain, enabled: boolean) => void
  /** 设置场景自定义标签 */
  setScenarioLabel: (domain: ScenarioDomain, label: string) => void
  /** 启用/禁用审计日志 */
  setAuditLoggingEnabled: (enabled: boolean) => void
  /** 启用/禁用合规模式 */
  setComplianceModeEnabled: (enabled: boolean) => void
  /** 获取当前场景的配置覆盖 */
  getActiveScenarioOverride: () => ReturnType<typeof SCENARIO_PROFILE_DEFAULTS[ScenarioDomain] extends infer T ? () => T : never>
  /** 重置场景偏好为默认值 */
  resetScenarioPreferences: () => void
}

/** 场景设置切片扩展 */
export function createScenarioSettingsActions(
  set: (fn: (state: SettingsSlice) => Partial<SettingsSlice>) => void,
  get: () => SettingsSlice,
): ScenarioSettingsActions {
  return {
    setActiveScenario: (domain) => {
      set((state) => ({
        activeScenarioId: domain,
        scenarioPreferences: {
          ...(state.scenarioPreferences ?? DEFAULT_SCENARIO_PREFERENCES),
          activeDomain: domain,
        },
      }))
      logger.settings.info(`[Settings] Scenario switched to: ${domain}`)
    },

    toggleScenarioEnabled: (domain, enabled) => {
      set((state) => {
        const prefs = state.scenarioPreferences ?? DEFAULT_SCENARIO_PREFERENCES
        return {
          scenarioPreferences: {
            ...prefs,
            domainEnabled: {
              ...prefs.domainEnabled,
              [domain]: enabled,
            },
          },
        }
      })
    },

    setScenarioLabel: (domain, label) => {
      set((state) => {
        const prefs = state.scenarioPreferences ?? DEFAULT_SCENARIO_PREFERENCES
        return {
          scenarioPreferences: {
            ...prefs,
            customScenarioLabels: {
              ...prefs.customScenarioLabels,
              [domain]: label,
            },
          },
        }
      })
    },

    setAuditLoggingEnabled: (enabled) => {
      set((state) => ({
        scenarioPreferences: {
          ...(state.scenarioPreferences ?? DEFAULT_SCENARIO_PREFERENCES),
          auditLoggingEnabled: enabled,
        },
      }))
    },

    setComplianceModeEnabled: (enabled) => {
      set((state) => ({
        scenarioPreferences: {
          ...(state.scenarioPreferences ?? DEFAULT_SCENARIO_PREFERENCES),
          complianceModeEnabled: enabled,
        },
      }))
    },

    getActiveScenarioOverride: () => {
      const domain = get().scenarioPreferences?.activeDomain ?? 'general'
      return SCENARIO_PROFILE_DEFAULTS[domain]
    },

    resetScenarioPreferences: () => {
      set(() => ({
        scenarioPreferences: { ...DEFAULT_SCENARIO_PREFERENCES },
      }))
      logger.settings.info('[Settings] Scenario preferences reset to defaults')
    },
  }
}
