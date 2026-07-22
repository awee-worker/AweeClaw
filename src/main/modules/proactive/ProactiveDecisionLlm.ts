/**
 * 主动决策 LLM 增强器（阶段10 s10-03 新增）
 *
 * 职责：
 * - 接收规则引擎产出的候选提案（最多 5 条）
 * - 调用主进程 LLMService.generateStructuredObject 进行再评估
 * - 输出优化后的提案（可能调整 severity/title/description/action/confidence）
 * - 过滤 shouldDispatch=false 的提案（LLM 认为不应打扰用户）
 * - 失败时返回原始候选（降级到纯规则模式）
 *
 * 评估维度：
 * 1. 打扰必要性：当前场景是否值得打扰用户？
 * 2. 严重度校准：候选 severity 是否合理？需上调还是下调？
 * 3. 行动优化：建议的 action 是否最优？是否有更好的行动方式？
 * 4. 个性化：结合用户历史反馈，调整表达方式
 *
 * 降级策略：
 * - LLM 调用失败/超时 → 返回原始候选（全部放行）
 * - JSON 解析失败 → 返回原始候选
 * - 部分候选拒绝（shouldDispatch=false）→ 仅保留通过的
 *
 * 性能参数：
 * - 超时 8s（与 BehaviorPredictorLlm 一致）
 * - 温度 0.3（决策场景需稳定）
 * - 单次最多 5 个候选（控制 token 用量）
 *
 * @module proactive/ProactiveDecisionLlm
 */

import { logger } from '@shared/toolkit/LogEngine'
import type {
  ProactiveProposal,
  ProactiveSeverity,
  ProactiveActionType,
} from './ProactiveInterface'

// ============================================================
// 常量
// ============================================================

/** LLM 调用超时（ms） */
const LLM_TIMEOUT_MS = 8000

/** 单次最多送入 LLM 的候选数 */
const MAX_CANDIDATES_PER_CALL = 5

/** LLM 模型版本标识 */
export const LLM_MODEL_VERSION = 'proactive-refiner-v1.0.0'

// ============================================================
// 类型定义
// ============================================================

/** LLM 配置（最小接口，与 LLMConfig 兼容） */
export interface LlmConfigLike {
  model: string
  apiKey?: string
  baseUrl?: string
  temperature?: number
  maxTokens?: number
}

/** LLM 服务最小接口（与 LLMService.generateStructuredObject 兼容） */
export interface LlmServiceLike {
  generateStructuredObject<T>(params: {
    config: LlmConfigLike
    schema: unknown
    system: string
    prompt: string
  }): Promise<{ data: T }>
}

/** LLM 输出的单条优化结果 */
interface LlmRefinedProposalRaw {
  originalIndex: number
  severity: ProactiveSeverity
  title: string
  description: string
  actionType: ProactiveActionType
  actionPayload: string
  confidence: number
  reason: string
  shouldDispatch: boolean
}

/** LLM 输出结构 */
interface LlmRefinedResult {
  refinedProposals: LlmRefinedProposalRaw[]
}

// ============================================================
// 提示词模板
// ============================================================

const SYSTEM_PROMPT = `你是一名主动式 AI 助手的决策评估专家，负责对规则引擎产出的候选主动提案进行再评估。

核心目标：在「不打扰用户」与「及时提供价值」之间找到最优平衡。

评估维度：
1. 打扰必要性（0-10 分）：当前场景是否值得打扰用户？
   - 10 分：必须立即处理（如磁盘满、关键构建失败、异常告警）
   - 7-9 分：建议处理（如重复操作提示、效率优化建议）
   - 4-6 分：可选提醒（如定时任务即将执行、IoT 状态变化）
   - 0-3 分：不值得打扰（如常规状态变化、已知模式）

2. 严重度校准：
   - info：静默记录（无需打扰）
   - low：系统通知（用户可忽略）
   - medium：建议卡片（用户需确认）
   - high：主动对话（AI 主动发起讨论）
   - critical：主动执行（AI 直接执行预授权动作）

3. 行动优化：
   - notify 适合 info/low
   - suggest 适合 medium
   - chat 适合 high
   - execute 仅适合 critical（且必须在白名单内）

4. 个性化原则：
   - 标题简洁（≤30 字），描述具体（1-2 行）
   - 避免命令式语气，使用建议式表达
   - 理由需结合当前场景，避免空泛

输出要求：
- shouldDispatch=false 表示当前不应打扰用户（如用户正在专注编码）
- confidence 范围 [0, 1]，反映对本次决策的把握
- 保持 originalIndex 与输入候选一一对应`

const USER_PROMPT_TEMPLATE = `当前时间：{currentTime}
当前场景：{sceneSummary}
注意力分数：{attentionScore}
最近异常数：{anomalyCount}

候选提案（共 {candidateCount} 条）：
{candidatesList}

请对以上候选提案进行再评估，输出 refinedProposals 数组。`

// ============================================================
// JSON Schema（约束 LLM 输出）
// ============================================================

const REFINE_SCHEMA = {
  type: 'object',
  properties: {
    refinedProposals: {
      type: 'array',
      maxItems: MAX_CANDIDATES_PER_CALL,
      items: {
        type: 'object',
        properties: {
          originalIndex: {
            type: 'number',
            minimum: 0,
            description: '对应输入候选的索引（0-based）',
          },
          severity: {
            type: 'string',
            enum: ['info', 'low', 'medium', 'high', 'critical'],
            description: '校准后的严重度',
          },
          title: {
            type: 'string',
            maxLength: 60,
            description: '优化后的标题（≤30 字）',
          },
          description: {
            type: 'string',
            maxLength: 200,
            description: '优化后的描述（1-2 行）',
          },
          actionType: {
            type: 'string',
            enum: ['notify', 'suggest', 'chat', 'execute'],
            description: '优化后的行动类型',
          },
          actionPayload: {
            type: 'string',
            maxLength: 1000,
            description: '优化后的行动载荷',
          },
          confidence: {
            type: 'number',
            minimum: 0,
            maximum: 1,
            description: '本次决策的置信度 [0, 1]',
          },
          reason: {
            type: 'string',
            maxLength: 300,
            description: '本次决策的理由',
          },
          shouldDispatch: {
            type: 'boolean',
            description: '是否应该派发此提案（false=不应打扰用户）',
          },
        },
        required: [
          'originalIndex',
          'severity',
          'title',
          'description',
          'actionType',
          'actionPayload',
          'confidence',
          'reason',
          'shouldDispatch',
        ],
      },
    },
  },
  required: ['refinedProposals'],
}

// ============================================================
// ProactiveDecisionLlm 实现
// ============================================================

/**
 * 主动决策 LLM 增强器（非单例，由 ProactiveDecisionEngine 持有实例）
 *
 * 使用方式：
 * ```ts
 * const refiner = new ProactiveDecisionLlm()
 * refiner.initialize(llmService, { model: 'gpt-4', apiKey: '...' })
 *
 * // 注入到决策引擎
 * proactiveDecisionEngine.setRefiner(async (candidates) => {
 *   return refiner.refine(candidates, context)
 * })
 * ```
 */
export class ProactiveDecisionLlm {
  /** LLM 服务实例 */
  private llmService: LlmServiceLike | null = null

  /** LLM 配置 */
  private llmConfig: LlmConfigLike | null = null

  /** 是否已初始化 */
  private initialized = false

  /** 初始化时间戳 */
  private initializedAt = 0

  // ============================================================
  // 生命周期
  // ============================================================

  /**
   * 初始化 LLM 增强器
   * @param llmService LLM 服务实例（通常为 LLMService）
   * @param llmConfig LLM 配置（model + apiKey + baseUrl 等）
   */
  initialize(llmService: LlmServiceLike, llmConfig: LlmConfigLike): void {
    this.llmService = llmService
    // 强制温度 0.3（决策场景需稳定，避免幻觉）
    const temp =
      typeof llmConfig.temperature === 'number' &&
      llmConfig.temperature >= 0 &&
      llmConfig.temperature <= 1
        ? llmConfig.temperature
        : 0.3
    this.llmConfig = { ...llmConfig, temperature: temp }
    this.initialized = true
    this.initializedAt = Date.now()
    logger.proactive?.info(
      `[ProactiveDecisionLlm] 已初始化，模型: ${llmConfig.model}, 温度: ${temp}`,
    )
  }

  /** 是否已初始化 */
  isInitialized(): boolean {
    return this.initialized
  }

  /** 获取初始化时间戳 */
  getInitializedAt(): number {
    return this.initializedAt
  }

  /** 重置（清除 LLM 配置，决策引擎将降级为纯规则模式） */
  reset(): void {
    this.llmService = null
    this.llmConfig = null
    this.initialized = false
    this.initializedAt = 0
    logger.proactive?.info('[ProactiveDecisionLlm] 已重置')
  }

  // ============================================================
  // 核心增强逻辑
  // ============================================================

  /**
   * 使用 LLM 对候选提案进行再评估
   *
   * @param candidates 规则引擎产出的候选提案（最多 5 条）
   * @param context 当前环境上下文摘要
   * @returns 优化后的提案列表（已过滤 shouldDispatch=false）
   */
  async refine(
    candidates: ProactiveProposal[],
    context: {
      sceneSummary: string
      attentionScore: number
      anomalyCount: number
    },
  ): Promise<ProactiveProposal[]> {
    if (!this.initialized || !this.llmService || !this.llmConfig) {
      logger.proactive?.debug('[ProactiveDecisionLlm] 未初始化，跳过 LLM 增强')
      return candidates
    }

    if (candidates.length === 0) {
      return candidates
    }

    // 限制候选数（控制 token 用量）
    const limited = candidates.slice(0, MAX_CANDIDATES_PER_CALL)
    if (candidates.length > MAX_CANDIDATES_PER_CALL) {
      logger.proactive?.warn(
        `[ProactiveDecisionLlm] 候选数 ${candidates.length} 超过上限，仅处理前 ${MAX_CANDIDATES_PER_CALL} 条`,
      )
    }

    try {
      const prompt = this.buildPrompt(limited, context)
      logger.proactive?.info(
        `[ProactiveDecisionLlm] 开始 LLM 再评估，候选 ${limited.length} 条，prompt 长度: ${prompt.length}`,
      )

      const result = await this.callWithTimeout(
        this.llmService.generateStructuredObject<LlmRefinedResult>({
          config: this.llmConfig,
          schema: REFINE_SCHEMA,
          system: SYSTEM_PROMPT,
          prompt,
        }),
        LLM_TIMEOUT_MS,
      )

      const refinedRaw = result?.data?.refinedProposals || []
      if (!Array.isArray(refinedRaw)) {
        logger.proactive?.warn('[ProactiveDecisionLlm] LLM 返回非数组，降级为原始候选')
        return candidates
      }

      // 将 LLM 输出合并回原提案（保留原 id/dedupKey/createdAt/signals）
      const refined: ProactiveProposal[] = []
      for (const raw of refinedRaw) {
        const original = limited[raw.originalIndex]
        if (!original) {
          logger.proactive?.warn(
            `[ProactiveDecisionLlm] LLM 返回的 originalIndex=${raw.originalIndex} 越界，跳过`,
          )
          continue
        }

        if (!raw.shouldDispatch) {
          logger.proactive?.info(
            `[ProactiveDecisionLlm] LLM 建议不派发: ${original.title} (originalIndex=${raw.originalIndex})`,
          )
          continue
        }

        // 合并：保留原提案的 id/source/trigger/dedupKey/signals/createdAt
        // 覆盖：severity/title/description/action/confidence/reason
        refined.push({
          ...original,
          severity: this.normalizeSeverity(raw.severity, original.severity),
          title: this.sanitizeString(raw.title, original.title, 60),
          description: this.sanitizeString(raw.description, original.description, 200),
          action: {
            type: this.normalizeActionType(raw.actionType, original.action.type),
            payload: this.sanitizeString(raw.actionPayload, original.action.payload, 1000),
          },
          confidence: this.normalizeConfidence(raw.confidence, original.confidence),
          reason: this.sanitizeString(raw.reason, original.reason, 300),
        })
      }

      logger.proactive?.info(
        `[ProactiveDecisionLlm] 再评估完成: 候选 ${limited.length} → 通过 ${refined.length}`,
      )

      // 若 LLM 全部拒绝，返回空数组（决策引擎将不派发任何提案）
      // 若 LLM 部分通过，仅返回通过的
      // 若 LLM 全部通过，返回全部（已被 LLM 优化过）
      return refined
    } catch (err) {
      logger.proactive?.warn(
        `[ProactiveDecisionLlm] LLM 再评估失败，降级为原始候选: ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
      return candidates
    }
  }

  // ============================================================
  // 内部方法：提示词构建
  // ============================================================

  /** 构建用户提示词 */
  private buildPrompt(
    candidates: ProactiveProposal[],
    context: { sceneSummary: string; attentionScore: number; anomalyCount: number },
  ): string {
    const now = new Date()
    const currentTime = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
      now.getDate(),
    ).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(
      now.getMinutes(),
    ).padStart(2, '0')}`

    const candidatesList = candidates
      .map((c, i) => {
        return `${i}. [${c.severity}] ${c.title}
   - 描述: ${c.description}
   - 行动: ${c.action.type} → ${c.action.payload}
   - 置信度: ${c.confidence.toFixed(2)}
   - 来源: ${c.source} / 触发: ${c.trigger}
   - 理由: ${c.reason}`
      })
      .join('\n')

    return USER_PROMPT_TEMPLATE
      .replace('{currentTime}', currentTime)
      .replace('{sceneSummary}', context.sceneSummary || '无场景数据')
      .replace('{attentionScore}', context.attentionScore.toFixed(2))
      .replace('{anomalyCount}', String(context.anomalyCount))
      .replace('{candidateCount}', String(candidates.length))
      .replace('{candidatesList}', candidatesList)
  }

  // ============================================================
  // 内部方法：字段规范化
  // ============================================================

  /** 规范化 severity（LLM 可能返回非法值） */
  private normalizeSeverity(raw: string, fallback: ProactiveSeverity): ProactiveSeverity {
    const valid: ProactiveSeverity[] = ['info', 'low', 'medium', 'high', 'critical']
    return valid.includes(raw as ProactiveSeverity) ? (raw as ProactiveSeverity) : fallback
  }

  /** 规范化 actionType */
  private normalizeActionType(raw: string, fallback: ProactiveActionType): ProactiveActionType {
    const valid: ProactiveActionType[] = ['notify', 'suggest', 'chat', 'execute']
    return valid.includes(raw as ProactiveActionType) ? (raw as ProactiveActionType) : fallback
  }

  /** 规范化 confidence（限制 [0, 1]） */
  private normalizeConfidence(raw: number, fallback: number): number {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback
    return Math.max(0, Math.min(1, raw))
  }

  /** 规范化字符串（非空 + 长度限制） */
  private sanitizeString(raw: string, fallback: string, maxLength: number): string {
    if (typeof raw !== 'string' || raw.trim().length === 0) return fallback
    return raw.trim().slice(0, maxLength)
  }

  // ============================================================
  // 内部方法：超时保护
  // ============================================================

  /**
   * 带超时的 Promise 调用
   *
   * @param promise 原始 Promise
   * @param timeoutMs 超时毫秒
   */
  private async callWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error(`LLM 调用超时（${timeoutMs}ms）`)),
        timeoutMs,
      )
    })
    return Promise.race([promise, timeout]) as Promise<T>
  }
}

// ============================================================
// 导出
// ============================================================

export const proactiveDecisionLlm = new ProactiveDecisionLlm()
