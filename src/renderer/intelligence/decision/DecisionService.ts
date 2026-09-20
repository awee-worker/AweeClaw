/**
 * 决策服务 —— 分层判定的统一入口
 *
 * 编排策略（成本与准确率的权衡）：
 * 1. 规则层先行：命中即高置信，零成本、可离线，直接采用
 * 2. 仅当规则层「缺席」或「置信度不足」时，才升级到 LLM 判定
 * 3. LLM 不可用或超时 → 降级沿用规则层结果，并标记 degraded
 *
 * 这样设计的收益：
 * - 高频且模式明确的判定不产生任何模型调用（省 token）
 * - 语义模糊的表达才付出模型调用成本（保准确率）
 * - 判定结果统一携带置信度，上层可对低置信结果转人工而非硬猜
 */

import { logger } from '@toolkit/LogEngine'
import { ruleProvider, RuleProvider } from './RuleProvider'
import { llmProvider, LlmProvider } from './LlmProvider'
import {
  isLowConfidence,
  type DecisionAnswer,
  type DecisionOptions,
  type DecisionQuestion,
  type DecisionResult,
  type DecisionState,
} from './types'

/** 默认置信度门禁：低于该值视为「拿不准」，触发升级或转人工 */
export const DEFAULT_LOW_CONFIDENCE_THRESHOLD = 0.7

/** 单次判定请求 */
export interface DecisionRequest {
  state: DecisionState
  questions: DecisionQuestion[]
  options?: DecisionOptions
}

/** 便捷判定的返回结构 */
export interface SingleDecision {
  answer: DecisionAnswer | undefined
  /** 是否低于置信度门禁（含完全未判定的情况） */
  lowConfidence: boolean
  /** 判定是否发生降级 */
  degraded: boolean
}

export class DecisionService {
  constructor(
    private readonly rule: RuleProvider = ruleProvider,
    private readonly llm: LlmProvider = llmProvider,
  ) {}

  /**
   * 执行一次判定
   *
   * 多个问题在一次调用中完成，规则层可命中的问题不会进入模型请求。
   */
  async decide(request: DecisionRequest): Promise<DecisionResult> {
    const startedAt = Date.now()
    const { state, questions } = request
    const options: DecisionOptions = request.options ?? {}
    const threshold = options.lowConfidenceThreshold ?? DEFAULT_LOW_CONFIDENCE_THRESHOLD
    const allowLlm = options.allowLlm ?? true

    if (questions.length === 0) {
      return { answers: {}, elapsedMs: 0, degraded: false }
    }

    // 1. 规则层：只处理确定性足够高的判定
    const ruleAnswers = await this.rule.decide(state, questions, options)

    // 2. 挑出规则层未能给出足够置信答案的问题
    const pending = questions.filter((question) => {
      const answer = ruleAnswers[question.id]
      return !answer || answer.confidence < threshold
    })

    let degraded = false
    let degradedReason: string | undefined
    let llmAnswers: Record<string, DecisionAnswer> = {}

    // 3. 升级到 LLM：仅处理规则层不确定的部分
    if (allowLlm && pending.length > 0) {
      llmAnswers = await this.llm.decide(state, pending, options)
      if (Object.keys(llmAnswers).length === 0) {
        degraded = true
        degradedReason = '模型判定不可用或超时，沿用规则层结果'
        logger.agent.debug(
          `[DecisionService] 降级：${pending.map((q) => q.id).join(', ')}`,
        )
      }
    }

    // 4. 合并：规则层结果为基础，LLM 结果在置信度更高时覆盖
    const answers: Record<string, DecisionAnswer> = { ...ruleAnswers }
    for (const [questionId, answer] of Object.entries(llmAnswers)) {
      const existing = answers[questionId]
      if (!existing || answer.confidence > existing.confidence) {
        answers[questionId] = answer
      }
    }

    const elapsedMs = Date.now() - startedAt
    const llmUsed = Object.values(answers).some((answer) => answer.source === 'llm')
    logger.agent.debug(
      `[DecisionService] 判定完成：${Object.keys(answers).length}/${questions.length}，` +
        `${elapsedMs}ms，模型调用=${llmUsed ? '是' : '否'}${degraded ? '，已降级' : ''}`,
    )

    return { answers, elapsedMs, degraded, degradedReason }
  }

  /**
   * 单问题判定
   *
   * 面向「只问一个是非/选择」的调用方，省去自行拆包。
   */
  async decideOne(
    state: DecisionState,
    question: DecisionQuestion,
    options?: DecisionOptions,
  ): Promise<SingleDecision> {
    const threshold = options?.lowConfidenceThreshold ?? DEFAULT_LOW_CONFIDENCE_THRESHOLD
    const result = await this.decide({ state, questions: [question], options })
    const answer = result.answers[question.id]
    return {
      answer,
      lowConfidence: isLowConfidence(answer, threshold),
      degraded: result.degraded,
    }
  }
}

/** 默认单例：规则层与 LLM 层均为无状态实现，可全局复用 */
export const decisionService = new DecisionService()

/** 构造布尔问题 */
export function booleanQuestion(id: string, text: string): DecisionQuestion {
  return { id, kind: 'boolean', text }
}

/** 构造选择问题 */
export function choiceQuestion(
  id: string,
  text: string,
  options: Array<{ id: string; label: string; description?: string }>,
): DecisionQuestion {
  return { id, kind: 'choice', text, options }
}

/** 构造打分问题 */
export function scoreQuestion(
  id: string,
  text: string,
  range?: { min?: number; max?: number },
): DecisionQuestion {
  return {
    id,
    kind: 'score',
    text,
    min: range?.min,
    max: range?.max,
  }
}
