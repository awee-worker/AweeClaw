/**
 * 模型路由器（Model Router）
 *
 * 职责：
 * - 基于任务复杂度，在同提供商下选择合适层级的模型
 * - 简单对话（打招呼/闲聊/短问答）路由到轻量模型，降低 token 消耗与延迟
 * - 中等/复杂任务保留用户选择的主模型，确保能力充足
 * - 仅在同提供商内替换模型（复用同一 apiKey/baseUrl/protocol），不跨提供商
 * - 全流程可观测：记录路由决策与原因
 *
 * 路由层级：
 * - lightweight：简单对话，尝试切换到同提供商的轻量模型（mini/flash/haiku/lite 等）
 * - standard：中等任务，保留用户主模型
 * - complex：复杂任务（多步骤/跨领域），保留主模型，多智能体由上层决定
 *
 * 设计原则：
 * - 安全兜底：任何异常或未命中轻量模型时，原样返回主模型
 * - 不修改 UI/Store：纯路由决策，调用方决定如何使用结果
 * - 可配置：阈值与轻量模型启发式规则集中管理，便于后续接入设置项
 * - 可观测：所有路由决策写入 agent 日志，便于排查与调优
 */

import { logger } from '@toolkit/LogEngine'
import { getBuiltinProvider } from '@shared/configuration/aiProviders'
import { useStore } from '@store'
import type { LLMConfig } from '@intelligence/providerTypes'
import type { ComplexityScore } from '../capabilities/planning/TaskComplexityDetector'

/** 路由层级 */
export type ModelTier = 'lightweight' | 'standard' | 'complex'

/** 路由决策结果 */
export interface RoutingDecision {
  /** 最终使用的配置（可能与入参 config 不同） */
  config: LLMConfig
  /** 路由层级 */
  tier: ModelTier
  /** 是否发生了模型替换 */
  swapped: boolean
  /** 原始模型（替换前） */
  originalModel?: string
  /** 路由后模型（替换后） */
  routedModel?: string
  /** 路由原因 */
  reason: string
}

/** 路由器配置 */
export interface ModelRouterConfig {
  /** 是否启用模型路由 */
  enabled: boolean
  /** 简单任务阈值（复杂度总分低于此值视为简单，尝试轻量模型） */
  simpleThreshold: number
  /** 复杂任务阈值（总分高于此值视为复杂） */
  complexThreshold: number
}

const DEFAULT_ROUTER_CONFIG: ModelRouterConfig = {
  enabled: true,
  simpleThreshold: 15,
  complexThreshold: 40,
}

/**
 * 轻量模型名称启发式规则
 *
 * 匹配模型 ID 中的轻量关键词（含边界，避免误匹配如 "minimaster"）。
 * 按优先级排序，越靠前优先级越高。
 */
const LIGHTWEIGHT_PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'mini', re: /(^|[-_:.])mini([-_:.]|$)/i },
  { name: 'flash', re: /(^|[-_:.])flash([-_:.]|$)/i },
  { name: 'haiku', re: /(^|[-_:.])haiku([-_:.]|$)/i },
  { name: 'lite', re: /(^|[-_:.])lite([-_:.]|$)/i },
  { name: 'nano', re: /(^|[-_:.])nano([-_:.]|$)/i },
  { name: 'small', re: /(^|[-_:.])small([-_:.]|$)/i },
  { name: 'turbo', re: /(^|[-_:.])turbo([-_:.]|$)/i },
  // 参数量后缀模型（8b/4b/7b/1.5b 等本地小模型）
  { name: 'param-b', re: /(^|[-_:.])(\d+(\.\d+)?b)([-_:.]|$)/i },
]

class ModelRouter {
  private config: ModelRouterConfig

  constructor(config: Partial<ModelRouterConfig> = {}) {
    this.config = { ...DEFAULT_ROUTER_CONFIG, ...config }
  }

  /**
   * 根据任务复杂度路由模型
   *
   * @param originalConfig - 用户选择的原始 LLM 配置
   * @param complexity - 任务复杂度评分
   * @param userMessage - 用户消息原文（仅用于日志）
   * @returns 路由决策（含最终使用的 config）
   */
  route(
    originalConfig: LLMConfig,
    complexity: ComplexityScore,
    userMessage: string,
  ): RoutingDecision {
    const originalModel = originalConfig.model

    // 未启用：直接返回标准层级
    if (!this.config.enabled) {
      return {
        config: originalConfig,
        tier: 'standard',
        swapped: false,
        reason: 'model routing disabled',
      }
    }

    const tier = this.resolveTier(complexity)

    // 非简单层级：保留主模型（中等/复杂任务需要主模型能力）
    if (tier !== 'lightweight') {
      return {
        config: originalConfig,
        tier,
        swapped: false,
        reason: `complexity=${complexity.total} → ${tier} tier, keep main model`,
      }
    }

    // 简单层级：当前模型本身已是轻量模型，无需替换
    if (this.isLightweightModel(originalModel)) {
      return {
        config: originalConfig,
        tier: 'lightweight',
        swapped: false,
        reason: `complexity=${complexity.total} → lightweight, main model already lightweight`,
      }
    }

    // 在同提供商下查找轻量模型
    const lightweightModel = this.findLightweightModel(originalConfig.provider, originalModel)
    if (!lightweightModel) {
      return {
        config: originalConfig,
        tier: 'lightweight',
        swapped: false,
        reason: `complexity=${complexity.total} → lightweight, no lightweight model for provider "${originalConfig.provider}"`,
      }
    }

    // 替换模型（保留 apiKey/baseUrl/protocol/参数等其余配置）
    const routedConfig: LLMConfig = {
      ...originalConfig,
      model: lightweightModel,
    }

    logger.agent.info(
      `[ModelRouter] lightweight routing: ${originalModel} → ${lightweightModel} ` +
      `(complexity=${complexity.total}, msg="${this.truncate(userMessage, 30)}")`
    )

    return {
      config: routedConfig,
      tier: 'lightweight',
      swapped: true,
      originalModel,
      routedModel: lightweightModel,
      reason: `complexity=${complexity.total} → lightweight, swapped to ${lightweightModel}`,
    }
  }

  /** 判定路由层级 */
  private resolveTier(complexity: ComplexityScore): ModelTier {
    // 简单对话（打招呼/闲聊）或复杂度极低 → lightweight
    if (complexity.isSimpleConversation || complexity.total < this.config.simpleThreshold) {
      return 'lightweight'
    }
    // 高复杂度 → complex
    if (complexity.total >= this.config.complexThreshold) {
      return 'complex'
    }
    // 介于两者之间 → standard
    return 'standard'
  }

  /** 判断模型是否为轻量模型 */
  isLightweightModel(modelId: string): boolean {
    if (!modelId) return false
    return LIGHTWEIGHT_PATTERNS.some(({ re }) => re.test(modelId))
  }

  /**
   * 在同提供商下查找轻量模型
   *
   * 候选来源：内置模型列表 + 用户自定义模型（Store 只读）
   * 排除当前主模型，按轻量优先级排序后取最优
   */
  private findLightweightModel(providerId: string, currentModel: string): string | null {
    try {
      const candidates = this.collectProviderModels(providerId)
      if (candidates.length === 0) return null

      const lightweightCandidates = candidates.filter(
        m => m !== currentModel && this.isLightweightModel(m),
      )
      if (lightweightCandidates.length === 0) return null

      // 按轻量优先级排序（mini > flash > haiku > lite > ...）
      lightweightCandidates.sort((a, b) => this.lightweightPriority(a) - this.lightweightPriority(b))

      return lightweightCandidates[0]
    } catch (err) {
      logger.agent.warn(
        `[ModelRouter] findLightweightModel failed: ${err instanceof Error ? err.message : String(err)}`,
      )
      return null
    }
  }

  /** 收集某提供商的所有可用模型（内置 + 用户自定义，去重） */
  private collectProviderModels(providerId: string): string[] {
    const models: string[] = []

    // 内置模型
    const builtin = getBuiltinProvider(providerId)
    if (builtin?.models?.length) {
      models.push(...builtin.models)
    }

    // 用户自定义模型（Store 只读，不写入）
    try {
      const store = useStore.getState()
      const userConfig = store.providerConfigs?.[providerId]
      if (userConfig?.customModels?.length) {
        for (const m of userConfig.customModels) {
          if (!models.includes(m)) models.push(m)
        }
      }
    } catch {
      // Store 未初始化等场景，静默降级到仅内置模型
    }

    return models
  }

  /** 轻量模型优先级（数字越小越优先） */
  private lightweightPriority(modelId: string): number {
    const lower = modelId.toLowerCase()
    for (let i = 0; i < LIGHTWEIGHT_PATTERNS.length; i++) {
      if (LIGHTWEIGHT_PATTERNS[i].re.test(lower)) return i
    }
    return LIGHTWEIGHT_PATTERNS.length
  }

  private truncate(s: string, n: number): string {
    if (!s) return ''
    return s.length > n ? s.slice(0, n) + '…' : s
  }
}

/** 模型路由器单例 */
export const modelRouter = new ModelRouter()
