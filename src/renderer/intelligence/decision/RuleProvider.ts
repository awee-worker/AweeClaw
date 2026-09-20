/**
 * 规则决策层
 *
 * 定位：零成本、同步、可离线。只处理「确定性足够高」的判定，
 * 拿不准的问题一律缺席返回，交由上层升级到 LLM 判定。
 *
 * 分工原则：
 * - 安全类判定（危险命令）以规则为权威，命中即高置信，不依赖网络
 * - 语义类判定（意图识别）规则只处理明确写法，模糊表达交给 LLM
 *
 * 与既有关键词判断器的关系：
 * 既有的 sceneToolsIntent / imageIntentDetector 采用「命中即真、排除即假」
 * 的硬判定，缺少中间态。本层复用其词表与判定结果作为信号，
 * 但对外输出置信度，使「不确定」得以显式表达而非被硬判掩盖。
 */

import { isDangerousCommand, matchDangerousCommand } from '@shared/configuration/dangerousCommands'
import { assessCommandRisk } from './commandRisk'
import { isSceneToolsIntent } from '@intelligence/utils/sceneToolsIntent'
import { needsVisualAnalysis } from '@intelligence/utils/imageIntentDetector'
import type {
  DecisionAnswer,
  DecisionOptions,
  DecisionProvider,
  DecisionQuestion,
  DecisionState,
} from './types'

/** 内置问题 id 常量，供调用方与规则层共用，避免字符串散落 */
export const QUESTION_DANGEROUS_COMMAND = 'dangerous_command'
export const QUESTION_COMMAND_RISK = 'command_risk'
export const QUESTION_SCENE_TOOLS_INTENT = 'scene_tools_intent'
export const QUESTION_VISUAL_ANALYSIS_INTENT = 'visual_analysis_intent'

/** 单个问题的判定函数 */
export type RuleEvaluator = (
  state: DecisionState,
  question: DecisionQuestion,
) => DecisionAnswer | undefined

/** 从决策状态中取出用于判定文本：优先最新消息，其次最近历史 */
function resolveJudgeText(state: DecisionState): string {
  if (typeof state.userMessage === 'string' && state.userMessage.trim()) {
    return state.userMessage
  }
  const history = state.history
  if (Array.isArray(history) && history.length > 0) {
    return history[history.length - 1] || ''
  }
  return ''
}

/** 危险命令判定：正则锚定具体写法，命中确定性高 */
const dangerousCommandRule: RuleEvaluator = (state, question) => {
  if (question.kind !== 'boolean') return undefined
  const text = resolveJudgeText(state)
  if (!text) return undefined
  // 命令类判定只针对终端命令字段，避免把用户自然语言误当命令
  const command = typeof state.command === 'string' ? state.command : text
  const hit = isDangerousCommand(command)
  if (hit) {
    return {
      questionId: question.id,
      value: true,
      confidence: 0.98,
      source: 'rule',
      rationale: `命中危险模式：${matchDangerousCommand(command) ?? 'unknown'}`,
    }
  }
  // 未命中不代表安全，但正则覆盖的是「不可逆 / 提权 / 远程执行」的明确写法，
  // 未命中时可给较高置信的否定，作为安全底线之外的快速通道
  return {
    questionId: question.id,
    value: false,
    confidence: 0.9,
    source: 'rule',
    rationale: '未命中任何危险模式',
  }
}

/**
 * 场景工具意图判定
 *
 * 仅在既有判定器给出「是」时提供高置信答案；给出「否」时不参与，
 * 因为既有判定器的否定来自排除词硬匹配，存在「记一下这个项目的待办」
 * 这类同时含排除词与真实意图的表达，需要语义层判断。
 */
const sceneToolsIntentRule: RuleEvaluator = (state, question) => {
  if (question.kind !== 'boolean') return undefined
  const text = resolveJudgeText(state)
  if (!text) return undefined
  const history = Array.isArray(state.history)
    ? state.history.filter((item): item is string => typeof item === 'string')
    : undefined
  if (!isSceneToolsIntent(text, history)) return undefined
  return {
    questionId: question.id,
    value: true,
    confidence: 0.92,
    source: 'rule',
    rationale: '命中场景工具意图词表',
  }
}

/** 图片视觉分析意图判定：同样只承接明确命中的情况 */
const visualAnalysisIntentRule: RuleEvaluator = (state, question) => {
  if (question.kind !== 'boolean') return undefined
  const text = resolveJudgeText(state)
  if (!text) return undefined
  if (!needsVisualAnalysis(text)) return undefined
  return {
    questionId: question.id,
    value: true,
    confidence: 0.9,
    source: 'rule',
    rationale: '命中视觉分析意图词表',
  }
}

/**
 * 命令风险分级
 *
 * 与 dangerousCommandRule 的区别：那条只回答「是否命中危险模式」，
 * 本规则回答「是否值得让用户确认一次」，把灰区写法一并纳入。
 * 两者共存，调用方按需要的问题 id 取用。
 */
const commandRiskRule: RuleEvaluator = (state, question) => {
  if (question.kind !== 'choice') return undefined
  const text = resolveJudgeText(state)
  if (!text) return undefined
  // 与危险命令判定一致：只针对终端命令字段，避免把自然语言误当命令
  const command = typeof state.command === 'string' ? state.command : text
  const assessment = assessCommandRisk(command)
  return {
    questionId: question.id,
    value: assessment.level,
    confidence: assessment.confidence,
    source: 'rule',
    rationale: assessment.rationale,
  }
}

/** 规则注册表：问题 id → 判定函数 */
const BUILTIN_RULES: Record<string, RuleEvaluator> = {
  [QUESTION_DANGEROUS_COMMAND]: dangerousCommandRule,
  [QUESTION_COMMAND_RISK]: commandRiskRule,
  [QUESTION_SCENE_TOOLS_INTENT]: sceneToolsIntentRule,
  [QUESTION_VISUAL_ANALYSIS_INTENT]: visualAnalysisIntentRule,
}

/**
 * 规则决策提供者
 *
 * 可通过 register 扩展自定义规则，扩展后按问题 id 精确匹配。
 */
export class RuleProvider implements DecisionProvider {
  readonly name = 'rule' as const

  private readonly rules: Record<string, RuleEvaluator> = { ...BUILTIN_RULES }

  /** 注册（或覆盖）某个问题的规则判定函数 */
  register(questionId: string, evaluator: RuleEvaluator): void {
    this.rules[questionId] = evaluator
  }

  /** 是否已注册某个问题的规则 */
  has(questionId: string): boolean {
    return typeof this.rules[questionId] === 'function'
  }

  async decide(
    state: DecisionState,
    questions: DecisionQuestion[],
    _options: DecisionOptions = {},
  ): Promise<Record<string, DecisionAnswer>> {
    const answers: Record<string, DecisionAnswer> = {}

    for (const question of questions) {
      const evaluator = this.rules[question.id]
      if (!evaluator) continue
      try {
        const answer = evaluator(state, question)
        if (answer) answers[question.id] = answer
      } catch {
        // 规则异常不应阻断判定链路，交由上层升级处理
      }
    }

    return answers
  }
}

/** 单例：规则集无状态，全局复用即可 */
export const ruleProvider = new RuleProvider()
