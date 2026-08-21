/**
 * 场景 Cron 任务管理器
 *
 * 模式切换时：
 * 1. 暂停旧模式的所有 Cron 任务（按 ruleId 前缀匹配）
 * 2. 激活新模式的所有 Cron 任务（通过 upsertByRuleId 注册/恢复）
 *
 * 任务 ID 规范：ruleId = `scene:{mode}:{jobId}`
 * 例如：scene:work:weekly-report, scene:life:water
 *
 * @see {@link file:///Volumes/MacData/Ai/aweeclaw/aweeclaw-client/docs/scene-modes/04-d-implementation.md} D-步骤3 设计
 */

import type { SceneMode } from '@protocols/sceneModeProtocol'
import type { SceneModeProfile, SceneCronJob } from './SceneModeDescriptor'
import { api } from '@renderer/adapters/electronBridge'
import { useSceneModeStore } from '@renderer/modes/sceneModeStore'
import { logger } from '@toolkit/LogEngine'

/** 场景模式 Cron 任务 ruleId 前缀 */
const SCENE_CRON_PREFIX = 'scene'

/** 构建 scene cron 任务的 ruleId */
function buildSceneCronRuleId(mode: SceneMode, jobId: string): string {
  return `${SCENE_CRON_PREFIX}:${mode}:${jobId}`
}

/** 构建 scene cron 任务的 ruleId 前缀（用于批量操作） */
function buildSceneCronPrefix(mode: SceneMode): string {
  return `${SCENE_CRON_PREFIX}:${mode}:`
}

/**
 * 场景 Cron 管理器
 *
 * 通过 addSceneModeListener 注册，模式切换时自动：
 * 1. 暂停旧模式的所有 Cron 任务
 * 2. 激活新模式的所有 Cron 任务
 */
class SceneCronManager {
  private currentMode: SceneMode | null = null

  /**
   * 激活指定模式的所有 Cron 任务
   *
   * 应用用户覆盖配置（频率/开关），并尊重全局开关。
   */
  async activateModeCronJobs(profile: SceneModeProfile): Promise<void> {
    const { cronJobs, id: mode } = profile
    const prefix = buildSceneCronPrefix(mode)

    // 检查全局开关
    const { cronGlobalEnabled, cronOverrides } = useSceneModeStore.getState()
    if (!cronGlobalEnabled) {
      logger.system.info(`[SceneCron] Cron global disabled, skipping activation for ${mode}`)
      return
    }

    // 先恢复该模式下所有已暂停的任务
    try {
      await api.cron.resumeByRuleIdPrefix(prefix)
    } catch (err) {
      logger.system.warn(`[SceneCron] Failed to resume existing jobs for ${mode}:`, err)
    }

    // 注册/更新所有 Cron 任务
    let activatedCount = 0
    for (const job of cronJobs) {
      // 应用用户覆盖配置
      const overrideKey = `${mode}:${job.id}`
      const override = cronOverrides[overrideKey]
      const isEnabled = override ? override.enabled : job.enabled
      const schedule = override?.schedule ?? job.schedule

      if (!isEnabled) continue

      const ruleId = buildSceneCronRuleId(mode, job.id)
      const command = this.buildCommand(job, profile)

      try {
        await api.cron.upsertByRuleId(
          ruleId,
          {
            name: `[${profile.displayNameZh}] ${job.name}`,
            description: `场景模式 ${profile.displayNameZh} 自动任务: ${job.name}`,
            expression: schedule,
            command,
          },
          true, // active = true
        )
        activatedCount++
        logger.system.info(
          `[SceneCron] Registered ${ruleId}: ${schedule} → ${command}`,
        )
      } catch (err) {
        logger.system.warn(`[SceneCron] Failed to register ${ruleId}:`, err)
      }
    }

    logger.system.info(
      `[SceneCron] Activated ${activatedCount} cron jobs for ${profile.displayNameZh}`,
    )
  }

  /**
   * 暂停指定模式的所有 Cron 任务
   *
   * 通过 ruleId 前缀批量暂停，不删除任务（便于切换回来时恢复）。
   */
  async pauseModeCronJobs(mode: SceneMode): Promise<void> {
    const prefix = buildSceneCronPrefix(mode)
    try {
      const result = await api.cron.pauseByRuleIdPrefix(prefix)
      const count = (result as { count?: number })?.count ?? 0
      if (count > 0) {
        logger.system.info(`[SceneCron] Paused ${count} cron jobs for mode: ${mode}`)
      }
    } catch (err) {
      logger.system.warn(`[SceneCron] Failed to pause jobs for ${mode}:`, err)
    }
  }

  /**
   * 构建 Cron 触发的 Agent 指令
   *
   * 指令中包含场景模式信息，让 Agent 知道这是场景模式的定时任务。
   */
  private buildCommand(job: SceneCronJob, profile: SceneModeProfile): string {
    return `[场景模式:${profile.displayNameZh}] ${job.name} — 执行动作: ${job.action}`
  }

  /**
   * 模式切换处理器
   *
   * 1. 暂停旧模式 Cron（如果有）
   * 2. 激活新模式 Cron
   * 3. 更新 currentMode
   */
  handleSceneModeChange = async (
    newMode: SceneMode,
    newProfile: SceneModeProfile,
  ): Promise<void> => {
    // 1. 暂停旧模式 Cron
    if (this.currentMode && this.currentMode !== newMode) {
      await this.pauseModeCronJobs(this.currentMode)
    }

    // 2. 激活新模式 Cron
    await this.activateModeCronJobs(newProfile)

    this.currentMode = newMode
  }

  /**
   * 刷新当前模式的 Cron 任务
   *
   * 用于设置页修改 Cron 配置后重新激活任务：
   * 1. 暂停当前模式所有任务
   * 2. 重新激活（应用最新配置）
   */
  async refreshCurrentMode(): Promise<void> {
    if (!this.currentMode) return
    const { activeProfile } = useSceneModeStore.getState()
    // 先暂停所有，再重新激活（避免旧任务残留）
    await this.pauseModeCronJobs(this.currentMode)
    // 全局关闭时不需要重新激活
    const { cronGlobalEnabled } = useSceneModeStore.getState()
    if (cronGlobalEnabled) {
      await this.activateModeCronJobs(activeProfile)
    }
  }

  /**
   * 暂停所有场景 Cron 任务
   *
   * 用于全局开关关闭时。
   */
  async pauseAllSceneCronJobs(): Promise<void> {
    if (!this.currentMode) return
    await this.pauseModeCronJobs(this.currentMode)
  }
}

/** 场景 Cron 管理器单例 */
export const sceneCronManager = new SceneCronManager()
