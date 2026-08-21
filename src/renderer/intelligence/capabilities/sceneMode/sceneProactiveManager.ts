/**
 * 场景主动行为管理器（D-步骤4）
 *
 * 模式切换时，将新模式的 proactiveRules 通过 IPC 同步到主进程
 * ProactiveDecisionEngine，替换当前生效的规则集。
 *
 * 决策引擎内部会注册一个名为 'scene-mode-detector' 的场景探测器，
 * 在每个节拍中评估规则条件并生成提案。
 *
 * 规则 ID 规范：`scene:{mode}:{ruleId}`
 * 例如：scene:work:focus-guard、scene:life:water-remind
 *
 * @see {@link file:///Volumes/MacData/Ai/aweeclaw/aweeclaw-client/docs/scene-modes/04-d-implementation.md} D-步骤4 设计
 */

import type { SceneModeProfile, ProactiveRule } from './SceneModeDescriptor'
import { api } from '@renderer/adapters/electronBridge'
import { logger } from '@toolkit/LogEngine'

/** 场景规则 ID 前缀（与 sceneCronManager 保持一致） */
const SCENE_RULE_PREFIX = 'scene'

/** 构建场景规则的唯一 ID */
function buildSceneRuleId(modeId: string, ruleId: string): string {
  return `${SCENE_RULE_PREFIX}:${modeId}:${ruleId}`
}

/**
 * 将场景模式的 ProactiveRule 转换为决策引擎可识别的规则格式
 *
 * ProactiveRule.action 是联合类型（'notify' | 'remind' | 'suggest' | 'trigger-skill' | 'iot-control'），
 * 决策引擎的规则 action 是字符串，直接透传并附带 payload。
 */
function toEngineRule(
  rule: ProactiveRule,
  modeId: string,
): {
  id: string
  name: string
  condition: string
  action: string
  payload: string
} {
  return {
    id: buildSceneRuleId(modeId, rule.id),
    name: rule.name,
    condition: rule.condition,
    action: rule.action,
    payload: rule.payload,
  }
}

/**
 * 场景主动行为管理器
 *
 * 通过 addSceneModeListener 注册，模式切换时自动：
 * 1. 过滤出 enabled=true 的规则
 * 2. 转换为决策引擎规则格式（带场景前缀 ID）
 * 3. 通过 IPC 同步到主进程 ProactiveDecisionEngine.setSceneRules()
 */
class SceneProactiveManager {
  /**
   * 同步主动行为规则到主进程
   *
   * 传入空数组会清空当前场景规则集（决策引擎内部会注销场景探测器）。
   */
  async syncProactiveRules(profile: SceneModeProfile): Promise<void> {
    const enabledRules = profile.proactiveRules.filter((r) => r.enabled)
    const engineRules = enabledRules.map((r) => toEngineRule(r, profile.id))

    try {
      const result = await api.proactive.setSceneRules(engineRules)
      if (!result.success) {
        logger.system.warn(
          `[SceneProactive] setSceneRules 返回失败: ${result.error ?? 'unknown'}`,
        )
        return
      }
      logger.system.info(
        `[SceneProactive] Synced ${engineRules.length} rules for ${profile.displayNameZh}`,
      )
    } catch (err) {
      logger.system.warn('[SceneProactive] Failed to sync rules:', err)
    }
  }
}

/** 场景主动行为管理器单例 */
export const sceneProactiveManager = new SceneProactiveManager()
