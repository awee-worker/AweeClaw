/**
 * 决策层类型契约
 *
 * 职责：
 * - 把散落在各处的关键词 / 正则判断统一为可度量的决策问题
 * - 决策结果携带置信度，供上层做门禁（低置信度转人工）与降级
 * - 与具体判定实现解耦：规则、本地模型、LLM 均可作为底层提供者
 *
 * 问题类型（输出空间封闭，避免自由文本带来的格式漂移）：
 * - boolean：是 / 否
 * - choice ：多选一
 * - score  ：区间打分
 */

/** 决策问题类型 */
export type DecisionQuestionKind = 'boolean' | 'choice' | 'score'

/** 决策来源，用于可解释性与问题定位 */
export type DecisionSource = 'rule' | 'llm'

/** 布尔问题：是 / 否 */
export interface BooleanQuestion {
  id: string
  kind: 'boolean'
  /** 问题描述，需为可直接判定的疑问句 */
  text: string
}

/** 选项定义 */
export interface ChoiceOption {
  id: string
  label: string
  description?: string
}

/** 选择问题：多选一 */
export interface ChoiceQuestion {
  id: string
  kind: 'choice'
  text: string
  options: ChoiceOption[]
}

/** 打分问题：区间打分 */
export interface ScoreQuestion {
  id: string
  kind: 'score'
  text: string
  /** 下限，缺省 0 */
  min?: number
  /** 上限，缺省 100 */
  max?: number
}

export type DecisionQuestion = BooleanQuestion | ChoiceQuestion | ScoreQuestion

/** 问题对应的答案取值类型 */
export type DecisionValue = boolean | string | number

/** 单条决策答案 */
export interface DecisionAnswer {
  questionId: string
  /** 答案取值：boolean 问题为布尔值，choice 问题为选项 id，score 问题为数值 */
  value: DecisionValue
  /**
   * 置信度，0 ~ 1
   *
   * 说明：规则层与 LLM 层给出的置信度均为启发式估计，未做频率校准，
   * 因此阈值设置偏保守；仅在「明显拿不准」时用于触发升级或转人工。
   */
  confidence: number
  source: DecisionSource
  /** 判定理由，用于审计与问题排查（可选） */
  rationale?: string
}

/** 决策调用的补充上下文 */
export interface DecisionState {
  /** 用户最新消息文本 */
  userMessage?: string
  /** 此前若干条用户消息，供多轮衔接判定使用 */
  history?: string[]
  /** 其他自定义字段，由各决策场景自行约定 */
  [key: string]: unknown
}

/** 单个决策请求的选项 */
export interface DecisionOptions {
  /** 整体超时（毫秒），超时后按已拿到的结果或降级返回 */
  timeoutMs?: number
  /** 低于该置信度视为「不确定」，由上层决定是否转人工 */
  lowConfidenceThreshold?: number
  /** 是否允许升级到 LLM 判定 */
  allowLlm?: boolean
}

/** 决策结果汇总 */
export interface DecisionResult {
  /** 按问题 id 索引的答案 */
  answers: Record<string, DecisionAnswer>
  /** 耗时（毫秒） */
  elapsedMs: number
  /** 是否发生了降级（规则层未能判定且 LLM 不可用 / 超时） */
  degraded: boolean
  /** 降级或异常说明（可选） */
  degradedReason?: string
}

/** 决策提供者接口，规则层与 LLM 层共同实现 */
export interface DecisionProvider {
  readonly name: DecisionSource
  /**
   * 执行判定
   *
   * @returns 仅包含本层能给出答案的问题；无法判定时对应问题缺席（由上层继续升级）
   */
  decide(
    state: DecisionState,
    questions: DecisionQuestion[],
    options: DecisionOptions,
  ): Promise<Record<string, DecisionAnswer>>
}

/** 判断答案是否低于置信度门禁 */
export function isLowConfidence(
  answer: DecisionAnswer | undefined,
  threshold: number,
): boolean {
  if (!answer) return true
  return answer.confidence < threshold
}

/** 读取布尔型答案，缺失或类型不符时返回 undefined */
export function readBooleanAnswer(
  result: DecisionResult,
  questionId: string,
): boolean | undefined {
  const answer = result.answers[questionId]
  if (!answer) return undefined
  return typeof answer.value === 'boolean' ? answer.value : undefined
}

/** 读取选择型答案，缺失或类型不符时返回 undefined */
export function readChoiceAnswer(
  result: DecisionResult,
  questionId: string,
): string | undefined {
  const answer = result.answers[questionId]
  if (!answer) return undefined
  return typeof answer.value === 'string' ? answer.value : undefined
}

/** 读取打分型答案，缺失或类型不符时返回 undefined */
export function readScoreAnswer(
  result: DecisionResult,
  questionId: string,
): number | undefined {
  const answer = result.answers[questionId]
  if (!answer) return undefined
  return typeof answer.value === 'number' ? answer.value : undefined
}
