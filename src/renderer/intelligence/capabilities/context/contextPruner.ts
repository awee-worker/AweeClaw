/**
 * 历史消息相关性裁剪
 *
 * 与压缩器的分工：
 * - ContextCompressor 处理「单条消息过长」（工具结果截断、消息折叠、结构化摘要）
 * - 本模块处理「回合数过多且多数与当前请求无关」
 *
 * 策略（保守优先）：
 * 1. 最近若干条消息无条件保留——它们承载当前任务的即时状态
 * 2. 所有 user 消息保留——用户意图不可再生，丢弃后无法恢复
 * 3. 工具调用与工具结果成对保留——拆散会使下游拼不出合法的消息序列，
 *    表现为模型收到「没有对应调用」的结果而反复追问
 * 4. 其余消息按与当前请求的关键词重叠度筛选
 * 5. 安全阀：丢弃比例过高、或 Token 减少不足时整体放弃裁剪
 *
 * 默认关闭，由调用方显式开启：裁剪会改变模型可见的历史，
 * 在评测基线（decision/eval）给出结论前不应默认启用。
 */

import { logger } from '@toolkit/LogEngine'
import { countTokens } from '@shared/toolkit/tokenEstimator'

/** 可裁剪消息的最小结构约束 */
export interface PrunableMessage {
  role?: string
  content?: unknown
  tool_calls?: unknown
  tool_call_id?: string
}

export interface PruneOptions {
  /** 尾部无条件保留的消息条数 */
  keepRecent?: number
  /** 少于该条数则不裁剪（收益不足） */
  minMessages?: number
  /** 丢弃比例上限，超过则放弃裁剪 */
  maxDropRatio?: number
  /** 最小 Token 减少比例，低于该值放弃裁剪 */
  minTokenReduction?: number
  /** 关键词命中数达到该值即视为相关 */
  minKeywordHits?: number
}

export interface PruneStats {
  baselineMessages: number
  keptMessages: number
  removedMessages: number
  baselineTokens: number
  prunedTokens: number
  droppedRatio: number
  /** 是否因安全阀取消裁剪 */
  skipped: boolean
  skipReason?: string
}

export interface PruneResult<T> {
  messages: T[]
  stats: PruneStats
}

/** 默认参数：偏保守，宁可少裁也不多裁 */
export const DEFAULT_PRUNE_OPTIONS: Required<PruneOptions> = {
  keepRecent: 8,
  minMessages: 12,
  maxDropRatio: 0.7,
  minTokenReduction: 0.15,
  minKeywordHits: 1,
}

/**
 * 约定回执信号
 *
 * 用户在对话中确立的约束（「导出要带表头」「金额一律用不含税口径」）通常由助手
 * 以「已记录」这类回执确认。这类消息自身不含当前请求的关键词，纯按关键词重叠度
 * 筛选必然被裁掉；但它们承载的是不可再生的用户约定，丢了后续回合就失去上下文。
 */
const ACKNOWLEDGEMENT_SIGNALS: string[] = [
  '已记录', '已保存', '已设置', '已登记', '已确认', '已列入', '记下了',
]

/**
 * 主链路裁剪开关
 *
 * 默认关闭。裁剪会改变模型可见的历史，属于高影响改动：
 * 已通过离线评测（关键消息保留率 100%、Token 减少 40.23%），
 * 但仍需在真实流量上灰度验证后再开启。
 *
 * 接入点在 MessageAssembler.assemble —— 主链路组装 LLM 消息的唯一咽喉点，
 * 位于上下文压缩之后、消息转换之前。
 */
let mainChainPruningEnabled = false

/** 开启/关闭主链路历史裁剪（设置项或灰度开关调用） */
export function setMainChainPruningEnabled(enabled: boolean): void {
  mainChainPruningEnabled = enabled
}

/** 主链路历史裁剪是否已启用 */
export function isMainChainPruningEnabled(): boolean {
  return mainChainPruningEnabled
}

/**
 * 裁剪历史消息
 *
 * 返回的 messages 为入参消息的子序列（保持原相对顺序），
 * 因此不会引入原会话中不存在的消息。
 */
export function pruneHistory<T extends PrunableMessage>(
  messages: T[],
  request: string,
  options: PruneOptions = {},
): PruneResult<T> {
  const config = { ...DEFAULT_PRUNE_OPTIONS, ...options }
  const baselineTokens = measureMessages(messages)

  const keepAll = (reason: string, extra?: Partial<PruneStats>): PruneResult<T> => ({
    messages,
    stats: {
      baselineMessages: messages.length,
      keptMessages: messages.length,
      removedMessages: 0,
      baselineTokens,
      prunedTokens: baselineTokens,
      droppedRatio: 0,
      skipped: true,
      skipReason: reason,
      ...extra,
    },
  })

  if (messages.length < config.minMessages) {
    return keepAll('消息条数未达裁剪下限')
  }
  if (!request.trim()) {
    return keepAll('缺少当前请求，无法判断相关性')
  }

  // 按「可裁剪单元」分组：assistant 携带的工具调用与其结果必须同进同出
  const units = groupIntoToolUnits(messages)
  const requestKeywords = extractKeywords(request)
  const keepRecentFrom = Math.max(0, units.length - countTrailingUnits(units, config.keepRecent))

  const decided = units.map((unit, index) => {
    const indices = unit.map((item) => item.index)
    // 1. 尾部窗口：无条件保留
    if (index >= keepRecentFrom) return { indices, keep: true }
    // 2. 用户消息：无条件保留
    if (unit.some((item) => item.message.role === 'user')) return { indices, keep: true }
    // 3. 约定回执：助手对用户约束的确认，承载不可再生的上下文
    if (unit.some((item) => isAcknowledgement(item.message))) return { indices, keep: true }
    // 4. 含工具调用的单元：与请求相关性难以从文本判断，保留以避免上下文断裂
    if (unit.some((item) => hasToolActivity(item.message))) return { indices, keep: true }
    // 5. 其余按关键词重叠度筛选
    const hits = countKeywordHits(unit, requestKeywords)
    return { indices, keep: hits >= config.minKeywordHits }
  })

  const kept = new Set<number>()
  for (const decision of decided) {
    if (decision.keep) decision.indices.forEach((index) => kept.add(index))
  }

  const keptMessages = messages.filter((_, index) => kept.has(index))
  const removedMessages = messages.length - keptMessages.length
  const droppedRatio = messages.length > 0 ? removedMessages / messages.length : 0
  const prunedTokens = measureMessages(keptMessages)

  if (removedMessages === 0) {
    return keepAll('未找到可裁剪的消息')
  }
  if (droppedRatio > config.maxDropRatio) {
    return keepAll(`丢弃比例过高（${formatPercent(droppedRatio)}）`)
  }
  const tokenReduction = baselineTokens > 0 ? (baselineTokens - prunedTokens) / baselineTokens : 0
  if (tokenReduction < config.minTokenReduction) {
    return keepAll(`Token 减少不足（${formatPercent(tokenReduction)}）`)
  }

  logger.agent.debug(
    `[ContextPruner] 消息 ${messages.length} → ${keptMessages.length}，` +
      `Token ${baselineTokens} → ${prunedTokens}（-${formatPercent(tokenReduction)}）`,
  )

  return {
    messages: keptMessages,
    stats: {
      baselineMessages: messages.length,
      keptMessages: keptMessages.length,
      removedMessages,
      baselineTokens,
      prunedTokens,
      droppedRatio: round4(droppedRatio),
      skipped: false,
    },
  }
}

/** 带下标的单元内消息 */
interface IndexedMessage<T> {
  message: T
  index: number
}

/**
 * 把消息切成不可分割的单元
 *
 * 工具调用（assistant.tool_calls）与其对应的 tool 结果消息必须落在同一单元，
 * 否则裁剪后会出现孤立结果，模型无法把它关联回任何调用。
 */
function groupIntoToolUnits<T extends PrunableMessage>(messages: T[]): Array<Array<IndexedMessage<T>>> {
  const units: Array<Array<IndexedMessage<T>>> = []
  let pending: Array<IndexedMessage<T>> | null = null

  messages.forEach((message, index) => {
    const indexed = { message, index }
    if (pending) {
      // tool 结果消息逐个归入当前单元，直到出现非 tool 角色
      if (message.role === 'tool') {
        pending.push(indexed)
        return
      }
      units.push(pending)
      pending = null
    }
    if (hasToolActivity(message)) {
      pending = [indexed]
      return
    }
    units.push([indexed])
  })

  if (pending) units.push(pending)
  return units
}

/** 尾部需要保留多少条消息：按消息条数换算成单元数，至少 1 个单元 */
function countTrailingUnits<T extends PrunableMessage>(
  units: Array<Array<IndexedMessage<T>>>,
  keepRecent: number,
): number {
  let count = 0
  for (let i = units.length - 1; i >= 0 && count < keepRecent; i--) {
    count += units[i].length
  }
  return Math.max(1, count)
}

/** 该消息是否为助手对用户约束的确认回执 */
function isAcknowledgement(message: PrunableMessage): boolean {
  if (message.role !== 'assistant') return false
  const text = extractMessageText(message)
  if (!text) return false
  return ACKNOWLEDGEMENT_SIGNALS.some((signal) => text.includes(signal))
}

/** 该消息是否涉及工具调用或工具结果 */
function hasToolActivity(message: PrunableMessage): boolean {
  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) return true
  if (typeof message.tool_call_id === 'string' && message.tool_call_id) return true
  if (message.role === 'tool') return true
  const parts = Array.isArray(message.content) ? message.content : []
  return parts.some((part) => {
    const type = (part as { type?: string })?.type
    return type === 'tool_call' || type === 'tool_result' || type === 'tool_use'
  })
}

/** 统计单元内消息与请求关键词的命中次数（单元内取最大值，避免长文本堆命中） */
function countKeywordHits<T extends PrunableMessage>(
  unit: Array<IndexedMessage<T>>,
  keywords: Set<string>,
): number {
  let max = 0
  for (const item of unit) {
    const text = extractMessageText(item.message)
    if (!text) continue
    let hits = 0
    for (const keyword of keywords) {
      if (text.includes(keyword)) hits++
    }
    if (hits > max) max = hits
  }
  return max
}

/**
 * 提取关键词
 *
 * 英文与数字按词提取，中文按二元片段提取。之所以不做分词，
 * 是为了零依赖、零延迟地跑在主链路上；二元片段足以覆盖「导出 / 接口 / 报表」
 * 这类领域词的匹配需求。
 */
export function extractKeywords(text: string): Set<string> {
  const keywords = new Set<string>()
  if (!text) return keywords
  const lower = text.toLowerCase()

  for (const match of lower.matchAll(/[a-z0-9_]{2,}/g)) {
    keywords.add(match[0])
  }
  for (const segment of lower.match(/[\u4e00-\u9fa5]+/g) ?? []) {
    for (let i = 0; i + 2 <= segment.length; i++) {
      keywords.add(segment.slice(i, i + 2))
    }
  }
  return keywords
}

/** 提取消息文本内容 */
export function extractMessageText(message: PrunableMessage): string {
  const content = message.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  const parts: string[] = []
  for (const part of content) {
    if (!part || typeof part !== 'object') continue
    const record = part as { type?: string; text?: string; name?: string; arguments?: unknown }
    if (record.type === 'text' && record.text) parts.push(record.text)
    else if (record.type === 'tool_call' || record.type === 'tool_use') {
      if (record.name) parts.push(record.name)
      if (record.arguments) parts.push(JSON.stringify(record.arguments))
    }
  }
  return parts.join(' ')
}

/** 批量估算消息 Token */
function measureMessages(messages: PrunableMessage[]): number {
  let total = 0
  for (const message of messages) {
    total += countTokens(typeof message.role === 'string' ? message.role : '')
    total += countTokens(extractMessageText(message))
    if (Array.isArray(message.tool_calls)) total += countTokens(JSON.stringify(message.tool_calls))
  }
  return total
}

function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000
}
