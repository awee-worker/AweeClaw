/**
 * LLM 决策层
 *
 * 定位：处理规则层无法判定的语义类问题。
 *
 * 与「让模型自由回答」的区别：
 * - 输出空间封闭：答案只能落在问题声明的取值范围内（布尔 / 枚举 / 数值区间）
 * - 强制结构化：schema 由问题定义编译而来，模型无法返回结构外的内容
 * - 携带置信度：模型需自报把握程度，供上层做门禁
 *
 * 置信度说明：此处置信度为模型自报值，未经频率校准，
 * 因此仅用于「明显拿不准」的识别，不作为概率使用。
 */

import type { LLMConfig } from '@shared/protocols/modelGateway'
import { logger } from '@toolkit/LogEngine'
import { api } from '../../adapters/electronBridge'
import { useStore } from '@store'
import type {
  DecisionAnswer,
  DecisionOptions,
  DecisionProvider,
  DecisionQuestion,
  DecisionState,
  DecisionValue,
} from './types'

/** 默认超时（毫秒）：决策属轻量判定，超时即降级，不阻塞主流程 */
const DEFAULT_TIMEOUT_MS = 12000

/** 模型结构化输出的返回形态 */
interface StructuredCallResult {
  object?: unknown
  error?: string
}

/** 依赖注入：便于单测替换，避免模块顶层强依赖 IPC 与 Store */
export interface LlmDecisionDeps {
  generateObject: (params: {
    config: LLMConfig
    schema: unknown
    system: string
    prompt: string
  }) => Promise<StructuredCallResult>
  /** 解析当前可用模型配置；返回 null 表示不可用（离线 / 未配置） */
  resolveConfig: () => LLMConfig | null
}

const defaultDeps: LlmDecisionDeps = {
  generateObject: (params) => api.llm.generateObject(params),
  resolveConfig: () => {
    const store = useStore.getState()
    return (store.llmConfig as LLMConfig) ?? null
  },
}

/**
 * 将单个问题编译为 JSON Schema 片段
 *
 * 采用「问题 id 作为属性名」的扁平结构而非数组，
 * 好处是模型必须为每个问题作答，缺项可由 schema 的 required 直接暴露。
 */
function compileQuestionSchema(question: DecisionQuestion): Record<string, unknown> {
  let valueSchema: Record<string, unknown>

  switch (question.kind) {
    case 'boolean':
      valueSchema = { type: 'boolean' }
      break
    case 'choice':
      valueSchema = {
        type: 'string',
        enum: question.options.map((option) => option.id),
      }
      break
    case 'score':
      valueSchema = {
        type: 'number',
        minimum: question.min ?? 0,
        maximum: question.max ?? 100,
      }
      break
  }

  return {
    type: 'object',
    properties: {
      value: valueSchema,
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      rationale: { type: 'string' },
    },
    required: ['value', 'confidence'],
    additionalProperties: false,
  }
}

/** 将问题列表编译为完整 JSON Schema */
function compileSchema(questions: DecisionQuestion[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  for (const question of questions) {
    properties[question.id] = compileQuestionSchema(question)
  }
  return {
    type: 'object',
    properties,
    required: questions.map((question) => question.id),
    additionalProperties: false,
  }
}

/** 渲染问题描述文本，供模型阅读 */
function renderQuestions(questions: DecisionQuestion[]): string {
  const lines: string[] = []
  for (const question of questions) {
    lines.push(`- id: ${question.id}`)
    lines.push(`  question: ${question.text}`)
    if (question.kind === 'choice') {
      for (const option of question.options) {
        const suffix = option.description ? ` —— ${option.description}` : ''
        lines.push(`  option ${option.id}: ${option.label}${suffix}`)
      }
    }
    if (question.kind === 'score') {
      lines.push(`  range: ${question.min ?? 0} ~ ${question.max ?? 100}`)
    }
  }
  return lines.join('\n')
}

/** 渲染决策状态：仅携带可序列化字段，避免把闭包或大对象送入模型 */
function renderState(state: DecisionState): string {
  const parts: string[] = []
  if (state.userMessage) {
    parts.push(`用户消息：\n${state.userMessage}`)
  }
  if (Array.isArray(state.history) && state.history.length > 0) {
    parts.push(`近期用户消息：\n${state.history.slice(-5).join('\n')}`)
  }
  for (const [key, value] of Object.entries(state)) {
    if (key === 'userMessage' || key === 'history') continue
    if (value === undefined || value === null) continue
    try {
      parts.push(`${key}：${typeof value === 'string' ? value : JSON.stringify(value)}`)
    } catch {
      // 无法序列化的字段直接跳过
    }
  }
  return parts.join('\n\n')
}

/** 校验模型返回值是否符合问题声明 */
function normalizeAnswer(
  question: DecisionQuestion,
  raw: unknown,
): DecisionAnswer | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const record = raw as Record<string, unknown>
  const value = record.value
  const rawConfidence = typeof record.confidence === 'number' ? record.confidence : 0.5
  // 约束到合法区间，防止模型返回越界值
  const confidence = Math.min(1, Math.max(0, rawConfidence))
  const rationale =
    typeof record.rationale === 'string' && record.rationale.trim()
      ? record.rationale.trim()
      : undefined

  let normalized: DecisionValue | undefined
  switch (question.kind) {
    case 'boolean':
      if (typeof value === 'boolean') normalized = value
      break
    case 'choice':
      if (
        typeof value === 'string' &&
        question.options.some((option) => option.id === value)
      ) {
        normalized = value
      }
      break
    case 'score':
      if (typeof value === 'number') {
        const min = question.min ?? 0
        const max = question.max ?? 100
        normalized = Math.min(max, Math.max(min, value))
      }
      break
  }

  if (normalized === undefined) return undefined

  return {
    questionId: question.id,
    value: normalized,
    confidence,
    source: 'llm',
    rationale,
  }
}

/**
 * LLM 决策提供者
 */
export class LlmProvider implements DecisionProvider {
  readonly name = 'llm' as const

  constructor(private readonly deps: LlmDecisionDeps = defaultDeps) {}

  async decide(
    state: DecisionState,
    questions: DecisionQuestion[],
    options: DecisionOptions = {},
  ): Promise<Record<string, DecisionAnswer>> {
    if (questions.length === 0) return {}

    const config = this.deps.resolveConfig()
    if (!config) {
      logger.agent.debug('[LlmProvider] 无可用模型配置，跳过 LLM 判定')
      return {}
    }

    const system = [
      '你是一个判定器，只回答给定的问题，不做额外解释与扩展。',
      '每个问题的答案必须落在问题声明的取值范围内。',
      'confidence 表示你对本次判断的把握程度，取值 0 到 1，请如实填写。',
      '严格按给定 schema 输出。',
    ].join('\n')

    const prompt = [
      renderState(state),
      '',
      '需要判定的问题：',
      renderQuestions(questions),
    ].join('\n')

    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    let timer: ReturnType<typeof setTimeout> | undefined

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('LLM 判定超时')), timeoutMs)
      })

      const response = await Promise.race([
        this.deps.generateObject({
          config,
          schema: compileSchema(questions),
          system,
          prompt,
        }),
        timeoutPromise,
      ])

      if (response.error) {
        logger.agent.warn(`[LlmProvider] 判定失败：${response.error}`)
        return {}
      }

      const payload = response.object
      if (!payload || typeof payload !== 'object') return {}

      const record = payload as Record<string, unknown>
      const answers: Record<string, DecisionAnswer> = {}
      for (const question of questions) {
        const answer = normalizeAnswer(question, record[question.id])
        if (answer) answers[question.id] = answer
      }

      return answers
    } catch (error) {
      logger.agent.warn('[LlmProvider] 判定异常，按未判定处理', error)
      return {}
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
}

/** 默认实例：使用真实 IPC 与 Store 依赖 */
export const llmProvider = new LlmProvider()
