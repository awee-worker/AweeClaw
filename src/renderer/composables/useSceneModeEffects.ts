/**
 * 场景模式副作用协调器
 *
 * 在应用初始化时注册场景模式切换的副作用监听器：
 * - 悬浮头像主题色切换（D-步骤1）
 * - Cron 任务激活/暂停（D-步骤3）
 * - 主动行为规则同步（D-步骤4）
 * - 感知策略切换（D-步骤5）
 *
 * 语音音色切换（D-步骤2）不需要监听器：
 * useVoiceChat 在每次 TTS 调用时直接从 useSceneModeStore 读取当前 voiceProfile。
 *
 * @see {@link file:///Volumes/MacData/Ai/aweeclaw/aweeclaw-client/docs/scene-modes/04-d-implementation.md} D 阶段实施文档
 */

import { useEffect } from 'react'
import { addSceneModeListener } from '@/renderer/modes/sceneModeStore'
import { useSceneModeStore } from '@/renderer/modes/sceneModeStore'
import type { SceneMode } from '@protocols/sceneModeProtocol'
import { api } from '../adapters/electronBridge'
import { sceneCronManager } from '@intelligence/capabilities/sceneMode/sceneCronManager'
import { sceneProactiveManager } from '@intelligence/capabilities/sceneMode/sceneProactiveManager'
import { scenePerceptionManager } from '@intelligence/capabilities/sceneMode/scenePerceptionManager'
import { sceneModeAutoSwitcher } from '@intelligence/capabilities/sceneMode/sceneModeAutoSwitcher'
import { smartProactiveManager } from '@intelligence/capabilities/sceneMode/smartProactiveManager'
import { logger } from '@toolkit/LogEngine'

/**
 * 场景模式副作用协调 Hook
 *
 * 在 AppContent 或 useAppInit 中调用一次即可。
 * 注册后，每次场景模式切换会自动触发副作用。
 */
export function useSceneModeEffects(): void {
  useEffect(() => {
    /** 获取当前主题模式（light/dark） */
    const getCurrentThemeMode = (): string => {
      if (typeof document === 'undefined') return 'dark'
      return document.documentElement.classList.contains('light') ? 'light' : 'dark'
    }

    // ── D-步骤1：悬浮头像主题色切换 ──
    const unsubscribeAvatar = addSceneModeListener(async (_mode, profile) => {
      try {
        api.floatingAvatar.updateTheme({
          themeColor: profile.avatarStyle.primaryColor,
          themeMode: getCurrentThemeMode(),
        })
        logger.agent.info(
          `[SceneModeEffects] Avatar theme updated to ${profile.avatarStyle.primaryColor} (${profile.displayNameZh})`,
        )
      } catch (err) {
        logger.agent.warn('[SceneModeEffects] Failed to update avatar theme:', err)
      }
    })

    // ── D-步骤3：Cron 任务切换 ──
    const unsubscribeCron = addSceneModeListener(async (mode, profile) => {
      try {
        await sceneCronManager.handleSceneModeChange(mode, profile)
      } catch (err) {
        logger.agent.warn('[SceneModeEffects] Cron switch failed:', err)
      }
    })

    // ── D-步骤4：主动行为规则切换 ──
    const unsubscribeProactive = addSceneModeListener(async (_mode, profile) => {
      try {
        await sceneProactiveManager.syncProactiveRules(profile)
      } catch (err) {
        logger.agent.warn('[SceneModeEffects] Proactive rules sync failed:', err)
      }
    })

    // ── D-步骤5：感知策略切换 ──
    const unsubscribePerception = addSceneModeListener(async (_mode, profile) => {
      try {
        await scenePerceptionManager.syncPerceptionFilter(profile)
      } catch (err) {
        logger.agent.warn('[SceneModeEffects] Perception filter sync failed:', err)
      }
    })

    // ── D-步骤2：语音音色 ──
    // 无需监听器，useVoiceChat 在 TTS 调用时直接从 useSceneModeStore 读取 voiceProfile

    logger.agent.info('[SceneModeEffects] Registered scene mode effect listeners')

    // 启动时初始化当前模式的副作用
    const { currentSceneMode, activeProfile, autoSwitchEnabled } = useSceneModeStore.getState()
    sceneCronManager.handleSceneModeChange(currentSceneMode, activeProfile).catch((err) => {
      logger.agent.warn('[SceneModeEffects] Initial cron activation failed:', err)
    })
    sceneProactiveManager.syncProactiveRules(activeProfile).catch((err) => {
      logger.agent.warn('[SceneModeEffects] Initial proactive sync failed:', err)
    })
    scenePerceptionManager.syncPerceptionFilter(activeProfile).catch((err) => {
      logger.agent.warn('[SceneModeEffects] Initial perception sync failed:', err)
    })

    // ── 方向2：时间自动切换 ──
    // 根据 autoSwitchEnabled 开关启动/停止自动切换器
    if (autoSwitchEnabled) {
      sceneModeAutoSwitcher.start()
    }

    // 监听 autoSwitchEnabled 变化，动态启停
    const unsubscribeAutoSwitch = useSceneModeStore.subscribe(
      (state, prevState) => {
        if (state.autoSwitchEnabled !== prevState.autoSwitchEnabled) {
          if (state.autoSwitchEnabled) {
            sceneModeAutoSwitcher.start()
          } else {
            sceneModeAutoSwitcher.stop()
          }
        }
      },
    )

    // ── AI 智能主动模式 ──
    if (autoSwitchEnabled) {
      // 复用 autoSwitchEnabled 初始化时机
    }
    // 初始启动（如果已开启）
    const { smartProactiveEnabled } = useSceneModeStore.getState()
    if (smartProactiveEnabled) {
      smartProactiveManager.start()
    }
    // 监听 smartProactiveEnabled 变化
    const unsubscribeSmartProactive = useSceneModeStore.subscribe(
      (state, prevState) => {
        if (state.smartProactiveEnabled !== prevState.smartProactiveEnabled) {
          if (state.smartProactiveEnabled) {
            smartProactiveManager.start()
          } else {
            smartProactiveManager.stop()
          }
        }
      },
    )

    // ── 方向4：监听移动端→PC 场景模式同步 ──
    const unsubscribeDeviceLink = api.deviceLink.onSceneModeSync((payload) => {
      logger.agent.info(`[SceneModeEffects] Received scene mode sync from mobile: ${payload.mode}`)
      const validModes: SceneMode[] = ['work', 'life', 'study']
      if (validModes.includes(payload.mode as SceneMode)) {
        // 静默切换，避免反向推送形成循环
        useSceneModeStore.getState().setSceneMode(payload.mode as SceneMode, { silent: true })
      }
    })

    return () => {
      unsubscribeAvatar()
      unsubscribeCron()
      unsubscribeProactive()
      unsubscribePerception()
      unsubscribeAutoSwitch()
      unsubscribeSmartProactive()
      unsubscribeDeviceLink()
      sceneModeAutoSwitcher.stop()
      smartProactiveManager.stop()
    }
  }, [])
}
