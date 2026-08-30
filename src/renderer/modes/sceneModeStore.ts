/**
 * 场景模式状态管理
 *
 * 通过 electron-store (preferencesStore) 持久化，
 * 与 workModeStore 同存储后端，通过 IPC 调用 settings:get/set。
 *
 * 切换模式时通过监听器机制通知各子系统（PromptComposer/Skills/Knowledge/Memory/Avatar/Voice/Cron）。
 *
 * @see {@link file:///Volumes/MacData/Ai/aweeclaw/aweeclaw-client/docs/scene-modes/02-mode-profile.md} 设计文档
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { SceneMode } from '@protocols/sceneModeProtocol'
import { sceneModeRegistry } from '@intelligence/capabilities/sceneMode/SceneModeRegistry'
import type { SceneModeProfile } from '@intelligence/capabilities/sceneMode/SceneModeDescriptor'
import { api } from '../adapters/electronBridge'
import { logger } from '@toolkit/LogEngine'

const STORE_KEY = 'sceneModeStore'

/** 各模式累计使用时长（秒） */
export interface ModeUsageStats {
  work: number
  life: number
  study: number
  /** 上次切换时间戳（ms） */
  lastSwitchAt: number
}

/** Cron 任务覆盖配置（key: `${mode}:${jobId}`） */
export interface CronTaskOverride {
  /** 是否启用（覆盖 Profile 中的 enabled） */
  enabled: boolean
  /** 自定义频率（cron 表达式，覆盖 Profile 中的 schedule） */
  schedule?: string
}

interface SceneModeState {
  /** 当前场景模式 */
  currentSceneMode: SceneMode
  /** 上一个模式（用于切换回去） */
  previousSceneMode: SceneMode | null
  /** 当前激活的 Profile（缓存，避免每次查 registry） */
  activeProfile: SceneModeProfile
  /** 各模式使用时长统计 */
  modeUsageStats: ModeUsageStats
  /** 是否启用时间自动切换 */
  autoSwitchEnabled: boolean
  /** Cron 任务全局开关（关闭后所有场景 Cron 任务暂停） */
  cronGlobalEnabled: boolean
  /** Cron 任务覆盖配置（key: `${mode}:${jobId}`） */
  cronOverrides: Record<string, CronTaskOverride>
  /** AI 智能主动模式开关（开启后根据用户活动主动提醒，限制每2小时最多1次） */
  smartProactiveEnabled: boolean
  /** AI 智能主动模式上次触发时间戳（ms，用于限频） */
  smartProactiveLastTriggeredAt: number
}

interface SceneModeActions {
  /**
   * 设置当前场景模式
   * @param mode 目标模式
   * @param options.silent 静默切换（不显示 Toast、不推送移动端），用于自动切换/同步
   */
  setSceneMode: (mode: SceneMode, options?: { silent?: boolean }) => Promise<void>
  /** 切换回上一个模式 */
  restorePreviousSceneMode: () => Promise<void>
  /** 检查是否为指定模式 */
  isSceneMode: (mode: SceneMode) => boolean
  /** 获取当前 Profile */
  getActiveProfile: () => SceneModeProfile
  /** 设置自动切换开关 */
  setAutoSwitchEnabled: (enabled: boolean) => void
  /** 重置使用统计 */
  resetModeUsageStats: () => void
  /** 设置 Cron 全局开关 */
  setCronGlobalEnabled: (enabled: boolean) => void
  /** 设置单个 Cron 任务覆盖配置 */
  setCronOverride: (key: string, override: Partial<CronTaskOverride>) => void
  /** 重置某个 Cron 任务为默认配置 */
  resetCronOverride: (key: string) => void
  /** 设置 AI 智能主动模式开关 */
  setSmartProactiveEnabled: (enabled: boolean) => void
  /** 检查 AI 智能主动模式是否可以触发（限频：每2小时最多1次） */
  canTriggerSmartProactive: () => boolean
  /** 标记 AI 智能主动模式已触发（更新时间戳） */
  markSmartProactiveTriggered: () => void
}

type SceneModeStore = SceneModeState & SceneModeActions

/**
 * 自定义 Storage：通过 IPC 存到 electron-store 的 preferencesStore，
 * 统一与其他设置的存储后端，避免使用 localStorage。
 */
const electronStoreStorage = {
  getItem: async (name: string): Promise<string | null> => {
    try {
      const value = await api.settings.get(`${STORE_KEY}.${name}`)
      return value ? JSON.stringify(value) : null
    } catch {
      return null
    }
  },
  setItem: async (name: string, value: string): Promise<void> => {
    try {
      const parsed = JSON.parse(value)
      await api.settings.set(`${STORE_KEY}.${name}`, parsed)
    } catch {
      /* ignore */
    }
  },
  removeItem: async (name: string): Promise<void> => {
    try {
      await api.settings.set(`${STORE_KEY}.${name}`, undefined)
    } catch {
      /* ignore */
    }
  },
}

/** 模式切换监听器类型 */
type SceneModeChangeListener = (newMode: SceneMode, profile: SceneModeProfile) => void | Promise<void>

/** 模式切换监听器集合（各子系统通过 addSceneModeListener 注册） */
const sceneModeListeners: Set<SceneModeChangeListener> = new Set()

/**
 * 注册场景模式切换监听器
 * @returns 取消注册函数
 */
export function addSceneModeListener(fn: SceneModeChangeListener): () => void {
  sceneModeListeners.add(fn)
  return () => {
    sceneModeListeners.delete(fn)
  }
}

/** 通知所有监听器模式已切换 */
async function notifySceneModeChange(mode: SceneMode, profile: SceneModeProfile): Promise<void> {
  for (const listener of sceneModeListeners) {
    try {
      await listener(mode, profile)
    } catch (err) {
      logger.agent.warn('[SceneModeStore] Listener error:', err)
    }
  }
}

export const useSceneModeStore = create<SceneModeStore>()(
  persist(
    (set, get) => ({
      currentSceneMode: 'work',
      previousSceneMode: null,
      activeProfile: sceneModeRegistry.getOrDefault('work'),
      modeUsageStats: { work: 0, life: 0, study: 0, lastSwitchAt: 0 },
      autoSwitchEnabled: false,
      cronGlobalEnabled: true,
      cronOverrides: {},
      smartProactiveEnabled: false,
      smartProactiveLastTriggeredAt: 0,

      setSceneMode: async (mode, options) => {
        const current = get().currentSceneMode
        if (current === mode) return

        const profile = sceneModeRegistry.getOrDefault(mode)
        logger.agent.info(`[SceneModeStore] Switching scene mode: ${current} -> ${mode}`)

        // 累加上一模式的使用时长（方向2：使用统计）
        const now = Date.now()
        const stats = { ...get().modeUsageStats }
        if (stats.lastSwitchAt > 0) {
          const duration = Math.floor((now - stats.lastSwitchAt) / 1000)
          if (duration > 0 && duration < 86400) {
            // 防止异常长时长（如应用长时间挂起后恢复）
            stats[current] = (stats[current] ?? 0) + duration
          }
        }
        stats.lastSwitchAt = now

        set({
          currentSceneMode: mode,
          previousSceneMode: current,
          activeProfile: profile,
          modeUsageStats: stats,
        })

        // 通知各子系统切换配置
        await notifySceneModeChange(mode, profile)

        // 方向4：PC→移动端模式同步（非 silent 调用才推送，避免循环）
        if (!options?.silent) {
          try {
            const { api } = await import('../adapters/electronBridge')
            await api.deviceLink.pushSceneMode(mode)
          } catch (err) {
            logger.agent.warn('[SceneModeStore] Failed to push scene mode to mobile:', err)
          }
        }
      },

      restorePreviousSceneMode: async () => {
        const previous = get().previousSceneMode
        if (!previous) return

        const profile = sceneModeRegistry.getOrDefault(previous)
        logger.agent.info(`[SceneModeStore] Restoring previous scene mode: ${previous}`)

        set({
          currentSceneMode: previous,
          previousSceneMode: null,
          activeProfile: profile,
        })

        await notifySceneModeChange(previous, profile)
      },

      isSceneMode: (mode) => get().currentSceneMode === mode,

      getActiveProfile: () => get().activeProfile,

      setAutoSwitchEnabled: (enabled) => {
        set({ autoSwitchEnabled: enabled })
      },

      resetModeUsageStats: () => {
        set({
          modeUsageStats: { work: 0, life: 0, study: 0, lastSwitchAt: Date.now() },
        })
      },

      setCronGlobalEnabled: (enabled) => {
        set({ cronGlobalEnabled: enabled })
      },

      setCronOverride: (key, override) => {
        const overrides = { ...get().cronOverrides }
        const existing = overrides[key] ?? { enabled: true }
        overrides[key] = { ...existing, ...override }
        set({ cronOverrides: overrides })
      },

      resetCronOverride: (key) => {
        const overrides = { ...get().cronOverrides }
        delete overrides[key]
        set({ cronOverrides: overrides })
      },

      setSmartProactiveEnabled: (enabled) => {
        set({ smartProactiveEnabled: enabled })
      },

      canTriggerSmartProactive: () => {
        if (!get().smartProactiveEnabled) return false
        const lastTriggered = get().smartProactiveLastTriggeredAt
        if (lastTriggered === 0) return true
        // 限频：每2小时最多1次
        return Date.now() - lastTriggered >= 2 * 60 * 60 * 1000
      },

      markSmartProactiveTriggered: () => {
        set({ smartProactiveLastTriggeredAt: Date.now() })
      },
    }),
    {
      name: 'aweeclaw-scene-mode-store',
      storage: createJSONStorage(() => electronStoreStorage),
      partialize: (state) => ({
        currentSceneMode: state.currentSceneMode,
        modeUsageStats: state.modeUsageStats,
        autoSwitchEnabled: state.autoSwitchEnabled,
        cronGlobalEnabled: state.cronGlobalEnabled,
        cronOverrides: state.cronOverrides,
        smartProactiveEnabled: state.smartProactiveEnabled,
        smartProactiveLastTriggeredAt: state.smartProactiveLastTriggeredAt,
      }),
    },
  ),
)
