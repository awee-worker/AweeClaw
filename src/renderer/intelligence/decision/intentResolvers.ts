/**
 * 意图判定统一出口
 *
 * 定位：把散落在各调用方的关键词判定收口到决策层，使「场景工具意图」
 * 「Git 工具意图」「视觉分析意图」这类判断拥有统一的来源、置信度与扩展点。
 *
 * 为什么默认走同步规则层：
 * 这些判定位于提示词构建与工具加载的主链路上，每轮对话都会执行。若在此
 * 引入模型调用，延迟与成本会直接叠加到每一轮请求上，收益不成正比。
 * 因此出口默认只做规则判定；确需语义兜底的调用方可使用 Async 版本，
 * 由决策层按需升级到 LLM（仅在规则层拿不准时发生）。
 *
 * 置信度语义（用于识别「拿不准」，不作概率使用）：
 * - 0.92：命中意图词表，判定为真
 * - 0.90：命中明确排除信号（开发类意图、既有关键词判定器的硬否定）
 * - 0.75：无任何信号，判定为假，但该结论来自「没有证据」而非「有反证」
 * - 0.60：消息过短（如「继续」「好的」），无法从文本本身判断，需结合历史
 */

import { logger } from '@toolkit/LogEngine'
import { isSceneToolsIntent, isSceneToolsIntentFromMessages } from '@intelligence/utils/sceneToolsIntent'
import { isGitToolsIntent, isGitToolsIntentFromMessages } from '@intelligence/utils/gitToolsIntent'
import { needsVisualAnalysis } from '@intelligence/utils/imageIntentDetector'
import {
  booleanQuestion,
  decisionService,
  DEFAULT_LOW_CONFIDENCE_THRESHOLD,
} from './DecisionService'
import {
  QUESTION_SCENE_TOOLS_INTENT,
  QUESTION_VISUAL_ANALYSIS_INTENT,
} from './RuleProvider'
import { hasDevelopmentIntent } from './toolPreselector'
import { isLowConfidence, type DecisionState } from './types'

/** 统一出口的判定结果 */
export interface IntentResolution {
  /** 判定结论 */
  value: boolean
  /** 置信度 0~1 */
  confidence: number
  /** 判定来源：rule 为本地规则，llm 为模型判定 */
  source: 'rule' | 'llm'
  /** 判定理由，用于审计与排查 */
  rationale: string
  /** 是否低于置信度门禁：调用方可据此转人工或采集待校准样本 */
  lowConfidence: boolean
}

/** 消息过短的阈值：短衔接语无法从自身文本判断意图 */
const SHORT_MESSAGE_LENGTH = 4

function resolution(
  value: boolean,
  confidence: number,
  rationale: string,
  source: IntentResolution['source'] = 'rule',
  threshold = DEFAULT_LOW_CONFIDENCE_THRESHOLD,
): IntentResolution {
  return {
    value,
    confidence,
    source,
    rationale,
    lowConfidence: confidence < threshold,
  }
}

/**
 * 场景工具意图判定（同步，仅规则）
 *
 * 与既有判定器的关系：真值沿用 `isSceneToolsIntent`，本出口只补充置信度与理由。
 * 之所以不在出口内重写判定逻辑，是为了保证迁移期间行为完全一致。
 */
export function resolveSceneToolsIntent(state: DecisionState): IntentResolution {
  const text = typeof state.userMessage === 'string' ? state.userMessage : ''
  const history = Array.isArray(state.history)
    ? state.history.filter((item): item is string => typeof item === 'string')
    : undefined

  if (isSceneToolsIntent(text, history)) {
    return resolution(true, 0.92, '命中场景工具意图词表')
  }

  // 明确排除：文本带有开发类意图，此时「否」有反证支撑
  if (hasDevelopmentIntent(text)) {
    return resolution(false, 0.9, '命中开发类意图，排除场景工具')
  }

  // 无信号：短衔接语的否定结论最不可靠，需结合历史
  if (text.trim().length > 0 && text.trim().length < SHORT_MESSAGE_LENGTH) {
    return resolution(false, 0.6, '消息过短且无意图信号，判定依据不足')
  }

  return resolution(false, 0.75, '未命中任何意图信号')
}

/** 从 LLM 消息数组推导场景工具意图（同步，仅规则） */
export function resolveSceneToolsIntentFromMessages(
  messages?: Array<{ role?: string; content?: unknown }>,
): IntentResolution {
  if (isSceneToolsIntentFromMessages(messages)) {
    return resolution(true, 0.92, '消息序列命中场景工具意图词表')
  }
  const lastUser = findLastUserText(messages)
  if (hasDevelopmentIntent(lastUser)) {
    return resolution(false, 0.9, '最后一条用户消息命中开发类意图')
  }
  if (lastUser.trim().length > 0 && lastUser.trim().length < SHORT_MESSAGE_LENGTH) {
    return resolution(false, 0.6, '最后一条用户消息过短，判定依据不足')
  }
  return resolution(false, 0.75, '消息序列未命中任何意图信号')
}

/**
 * Git 工具意图判定（同步，仅规则）
 *
 * git_* 工具默认不暴露：工作区并非都是 Git 仓库，AI 自行「探路」会稳定失败。
 * 只有用户在消息里明确要求版本控制操作时，才把 git_* 下发给 LLM。
 */
export function resolveGitToolsIntent(state: DecisionState): IntentResolution {
  const text = typeof state.userMessage === 'string' ? state.userMessage : ''
  const history = Array.isArray(state.history)
    ? state.history.filter((item): item is string => typeof item === 'string')
    : undefined

  if (isGitToolsIntent(text, history)) {
    return resolution(true, 0.92, '命中 Git 操作意图词表')
  }

  if (text.trim().length > 0 && text.trim().length < SHORT_MESSAGE_LENGTH) {
    return resolution(false, 0.6, '消息过短且无 Git 意图信号，判定依据不足')
  }

  return resolution(false, 0.75, '未命中 Git 操作意图信号')
}

/** 从 LLM 消息数组推导 Git 工具意图（同步，仅规则） */
export function resolveGitToolsIntentFromMessages(
  messages?: Array<{ role?: string; content?: unknown }>,
): IntentResolution {
  if (isGitToolsIntentFromMessages(messages)) {
    return resolution(true, 0.92, '消息序列命中 Git 操作意图词表')
  }
  const lastUser = findLastUserText(messages)
  if (lastUser.trim().length > 0 && lastUser.trim().length < SHORT_MESSAGE_LENGTH) {
    return resolution(false, 0.6, '最后一条用户消息过短，判定依据不足')
  }
  return resolution(false, 0.75, '消息序列未命中 Git 操作意图信号')
}
/** 视觉分析意图判定（同步，仅规则） */

export function resolveVisualAnalysisIntent(state: DecisionState): IntentResolution {
  const text = typeof state.userMessage === 'string' ? state.userMessage : ''

  if (needsVisualAnalysis(text)) {
    return resolution(true, 0.9, '命中视觉分析意图词表')
  }

  if (text.trim().length > 0 && text.trim().length < SHORT_MESSAGE_LENGTH) {
    return resolution(false, 0.6, '消息过短且无视觉分析信号')
  }

  return resolution(false, 0.75, '未命中视觉分析意图信号')
}

/**
 * 场景工具意图判定（异步，规则层拿不准时可升级到 LLM）
 *
 * 供非关键路径使用（如后台分析、评测）。主链路请使用同步版本，
 * 避免每轮对话都挂上一次模型调用的风险。
 */
export async function resolveSceneToolsIntentAsync(
  state: DecisionState,
  options?: { allowLlm?: boolean; lowConfidenceThreshold?: number },
): Promise<IntentResolution> {
  const sync = resolveSceneToolsIntent(state)
  if (!sync.lowConfidence) return sync
  if (options?.allowLlm === false) return sync

  const threshold = options?.lowConfidenceThreshold ?? DEFAULT_LOW_CONFIDENCE_THRESHOLD
  const decided = await decisionService.decideOne(
    state,
    booleanQuestion(QUESTION_SCENE_TOOLS_INTENT, '这条消息是否在要求记录或查询用户的个人场景数据？'),
    { lowConfidenceThreshold: threshold },
  )

  const answer = decided.answer
  if (!answer || answer.source !== 'llm') {
    logger.agent.debug(
      `[IntentResolvers] 场景工具意图升级未获答案，沿用规则结论（${sync.confidence}）`,
    )
    return sync
  }

  const value = answer.value === true
  return {
    value,
    confidence: answer.confidence,
    source: 'llm',
    rationale: answer.rationale ?? '模型判定',
    lowConfidence: isLowConfidence(answer, threshold),
  }
}

/** 视觉分析意图判定（异步，规则层拿不准时可升级到 LLM） */
export async function resolveVisualAnalysisIntentAsync(
  state: DecisionState,
  options?: { allowLlm?: boolean; lowConfidenceThreshold?: number },
): Promise<IntentResolution> {
  const sync = resolveVisualAnalysisIntent(state)
  if (!sync.lowConfidence) return sync
  if (options?.allowLlm === false) return sync

  const threshold = options?.lowConfidenceThreshold ?? DEFAULT_LOW_CONFIDENCE_THRESHOLD
  const decided = await decisionService.decideOne(
    state,
    booleanQuestion(QUESTION_VISUAL_ANALYSIS_INTENT, '这条消息是否需要读取图片的像素内容（而非仅知道文件路径）？'),
    { lowConfidenceThreshold: threshold },
  )

  const answer = decided.answer
  if (!answer || answer.source !== 'llm') return sync

  return {
    value: answer.value === true,
    confidence: answer.confidence,
    source: 'llm',
    rationale: answer.rationale ?? '模型判定',
    lowConfidence: isLowConfidence(answer, threshold),
  }
}

/** 取消息序列中最后一条用户文本 */
function findLastUserText(messages?: Array<{ role?: string; content?: unknown }>): string {
  if (!messages || messages.length === 0) return ''
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg?.role !== 'user') continue
    const content = msg.content
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      const text = content
        .filter((part): part is { type: string; text?: string } =>
          !!part && typeof part === 'object' && (part as { type?: string }).type === 'text')
        .map((part) => part.text || '')
        .join('')
      if (text) return text
    }
  }
  return ''
}
