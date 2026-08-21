/**
 * 场景模式时间自动切换器（方向2）
 *
 * 根据当前时间自动切换场景模式：
 * - 工作日（周一至周五）9:00-18:00 → 工作模式
 * - 每日 19:00-23:00 → 生活模式
 * - 其他时段（夜间、周末白天）→ 不主动切换，保持用户当前选择
 *
 * 仅在用户开启 autoSwitchEnabled 时生效，避免打扰用户。
 *
 * @see {@link file:///Volumes/MacData/Ai/aweeclaw/aweeclaw-client/docs/scene-modes/05-extensions.md} 方向2 设计
 */

import type { SceneMode } from '@protocols/sceneModeProtocol'
import { useSceneModeStore } from '@renderer/modes/sceneModeStore'
import { logger } from '@toolkit/LogEngine'

/** 检查间隔：5 分钟 */
const CHECK_INTERVAL_MS = 5 * 60 * 1000

/** 工作时段：9:00-18:00 */
const WORK_HOUR_START = 9
const WORK_HOUR_END = 18

/** 生活时段：19:00-23:00 */
const LIFE_HOUR_START = 19
const LIFE_HOUR_END = 23

/**
 * 根据时间判断目标模式
 *
 * @returns 目标模式，null 表示当前时段不自动切换
 */
function getTargetModeByTime(now: Date): SceneMode | null {
  const hour = now.getHours()
  const day = now.getDay() // 0=周日, 6=周六
  const isWeekday = day >= 1 && day <= 5

  // 工作日工作时段 → 工作模式
  if (isWeekday && hour >= WORK_HOUR_START && hour < WORK_HOUR_END) {
    return 'work'
  }

  // 每日晚间 → 生活模式
  if (hour >= LIFE_HOUR_START && hour < LIFE_HOUR_END) {
    return 'life'
  }

  // 其他时段（夜间、周末白天）不主动切换
  return null
}

/**
 * 场景模式自动切换器
 *
 * 使用单例模式，通过 start/stop 控制。
 * 在 useSceneModeEffects 中根据 autoSwitchEnabled 开关调用。
 */
class SceneModeAutoSwitcher {
  private intervalId: ReturnType<typeof setInterval> | null = null
  private lastSwitchedMode: SceneMode | null = null

  /**
   * 启动自动切换
   */
  start(): void {
    if (this.intervalId) {
      logger.system.debug('[SceneAutoSwitcher] Already running')
      return
    }

    logger.system.info('[SceneAutoSwitcher] Started (check every 5 min)')

    // 立即检查一次
    this.check()

    // 定时检查
    this.intervalId = setInterval(() => {
      this.check()
    }, CHECK_INTERVAL_MS)
  }

  /**
   * 停止自动切换
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
      this.lastSwitchedMode = null
      logger.system.info('[SceneAutoSwitcher] Stopped')
    }
  }

  /**
   * 检查是否需要切换
   */
  private async check(): Promise<void> {
    try {
      const { autoSwitchEnabled, currentSceneMode, setSceneMode } =
        useSceneModeStore.getState()

      // 未启用自动切换，跳过
      if (!autoSwitchEnabled) return

      const now = new Date()
      const targetMode = getTargetModeByTime(now)

      // 当前时段不自动切换
      if (!targetMode) return

      // 已在目标模式，跳过
      if (currentSceneMode === targetMode) return

      // 避免短时间内重复切换（同一目标模式 10 分钟内只切一次）
      if (this.lastSwitchedMode === targetMode) {
        const elapsed = Date.now() - (this.lastSwitchTime ?? 0)
        if (elapsed < 10 * 60 * 1000) return
      }

      logger.system.info(
        `[SceneAutoSwitcher] Auto switching: ${currentSceneMode} -> ${targetMode} (time: ${now.toLocaleTimeString()})`,
      )

      // 静默切换（不显示 Toast，因为是自动行为）
      await setSceneMode(targetMode, { silent: true })

      this.lastSwitchedMode = targetMode
      this.lastSwitchTime = Date.now()
    } catch (err) {
      logger.system.warn('[SceneAutoSwitcher] Check failed:', err)
    }
  }

  private lastSwitchTime: number | null = null
}

/** 场景模式自动切换器单例 */
export const sceneModeAutoSwitcher = new SceneModeAutoSwitcher()

/** 导出用于测试的时间判断函数 */
export { getTargetModeByTime }
