import { isAssistantMessage, isContextSnapshotPart, type ChatThread } from '@intelligence/providerTypes'

export type ContextIndicatorKind =
  | 'usage'
  | 'compressing'
  | 'handoff_ready'
  | 'switching'
  | 'switched'

export interface ContextIndicatorTransition {
  status: 'idle' | 'compressing' | 'switching'
  sourceThreadId?: string
  targetThreadId?: string
  startedAt?: number
}

const SWITCHING_STALE_MS = 10_000

function hasReadyHandoff(thread: ChatThread): boolean {
  return thread.handoff.status === 'ready' && !!thread.handoff.document && !isResumedFromHandoff(thread)
}

function hasHandoffSnapshotMessage(thread: ChatThread): boolean {
  return thread.messages.some(message =>
    isAssistantMessage(message) &&
    message.parts.some(part =>
      isContextSnapshotPart(part) &&
      part.snapshotKind === 'handoff' &&
      part.presentation !== 'source_marker'
    ),
  )
}

function isHandoffSnapshotAssistantMessage(thread: ChatThread['messages'][number]): boolean {
  return (
    isAssistantMessage(thread) &&
    thread.parts.some(part =>
      isContextSnapshotPart(part) &&
      part.snapshotKind === 'handoff' &&
      part.presentation !== 'source_marker'
    )
  )
}

function isResumedFromHandoff(thread: ChatThread): boolean {
  return Boolean(
    thread.handoffResume ||
    thread.handoffContext ||
    thread.pendingObjective ||
    (thread.pendingSteps && thread.pendingSteps.length > 0) ||
    hasHandoffSnapshotMessage(thread),
  )
}

function hasAssistantReplyAfterHandoff(thread: ChatThread): boolean {
  if (!isResumedFromHandoff(thread)) return false

  const handoffDigestIndex = thread.messages.findIndex(isHandoffSnapshotAssistantMessage)
  const postHandoffMessages = handoffDigestIndex >= 0
    ? thread.messages.slice(handoffDigestIndex + 1)
    : thread.messages

  return postHandoffMessages.some(message => isAssistantMessage(message) && !isHandoffSnapshotAssistantMessage(message))
}

function isCompressionActive(thread: ChatThread): boolean {
  return thread.isCompacting || (thread.compressionPhase !== 'idle' && thread.compressionPhase !== 'done')
}

function isSwitchingTransitionActive(
  transition: ContextIndicatorTransition | undefined,
  currentThreadId: string | null | undefined,
): boolean {
  if (transition?.status !== 'switching' || !currentThreadId) {
    return false
  }

  if (
    transition.sourceThreadId !== currentThreadId &&
    transition.targetThreadId !== currentThreadId
  ) {
    return false
  }

  if (!transition.startedAt) {
    return true
  }

  return Date.now() - transition.startedAt < SWITCHING_STALE_MS
}

export function resolveContextIndicatorKind(thread: ChatThread | null | undefined): ContextIndicatorKind {
  return resolveContextIndicatorKindForThread(thread)
}

export function resolveContextIndicatorKindForThread(
  thread: ChatThread | null | undefined,
  transition?: ContextIndicatorTransition,
  currentThreadId?: string | null,
): ContextIndicatorKind {
  if (!thread) return 'usage'

  if (isSwitchingTransitionActive(transition, currentThreadId)) {
    return 'switching'
  }

  if (
    transition?.status === 'compressing' &&
    currentThreadId &&
    transition.sourceThreadId === currentThreadId
  ) {
    return 'compressing'
  }

  if (thread.handoff.status === 'transitioning') {
    return 'switching'
  }

  if (isCompressionActive(thread)) {
    return 'compressing'
  }

  if (isResumedFromHandoff(thread) && !hasAssistantReplyAfterHandoff(thread)) {
    return 'switched'
  }

  if (hasReadyHandoff(thread)) {
    return 'handoff_ready'
  }

  return 'usage'
}

// ============================================================
// 上下文质量信号
// ============================================================

/**
 * 上下文质量信号
 *
 * 水位只回答「装不装得下」，这里回答「装进去的是不是有用」。
 * 四项指标各自暴露一类退化：关键约束被挤掉、压缩没有收益、
 * 外部内容占比过高、可回溯内容白白常驻。
 */
export interface ContextQualitySignal {
  /** 关键指令存活率：架构约束、用户约束、未决问题在压缩后是否仍在 */
  criticalRetentionRate: number
  /** 压缩前后信息增益比 */
  compressionGainRatio: number
  /** 不可信内容占比 */
  untrustedRatio: number
  /** 常驻内容中「可回溯却仍常驻」的比例（检索优先的改进空间） */
  residentAvoidableRatio: number
}

/** 质量信号计算输入 */
export interface ContextQualityInput {
  /** 压缩前标记为关键的消息 id */
  criticalIds: string[]
  /** 压缩后仍保留的关键消息 id */
  retainedCriticalIds: string[]
  /** 压缩前 token */
  beforeTokens: number
  /** 压缩后 token */
  afterTokens: number
  /** 上下文中的不可信来源内容 token */
  untrustedTokens: number
  /** 常驻内容总 token */
  residentTokens: number
  /** 常驻内容中可回溯部分的 token */
  residentAvoidableTokens: number
}

export function computeContextQualitySignal(input: ContextQualityInput): ContextQualitySignal {
  const retained = new Set(input.retainedCriticalIds)
  const criticalTotal = input.criticalIds.length
  const criticalKept = input.criticalIds.filter((id) => retained.has(id)).length

  return {
    criticalRetentionRate: criticalTotal > 0 ? round4(criticalKept / criticalTotal) : 1,
    compressionGainRatio:
      input.beforeTokens > 0
        ? round4((input.beforeTokens - input.afterTokens) / input.beforeTokens)
        : 0,
    untrustedRatio:
      input.afterTokens > 0 ? round4(input.untrustedTokens / input.afterTokens) : 0,
    residentAvoidableRatio:
      input.residentTokens > 0
        ? round4(input.residentAvoidableTokens / input.residentTokens)
        : 0,
  }
}

export type ContextQualityLevel = 'good' | 'fair' | 'poor'

/** 不可信内容占比警戒线 */
const UNTRUSTED_RATIO_WARN = 0.3

/** 可回溯内容常驻比例警戒线 */
const RESIDENT_AVOIDABLE_WARN = 0.5

/**
 * 质量等级
 *
 * 关键约束丢失与外部内容占比过高都会直接改变模型的判断依据，
 * 因此判为 poor；可回溯内容常驻只是效率问题，判为 fair。
 */
export function resolveContextQualityLevel(signal: ContextQualitySignal): ContextQualityLevel {
  if (signal.criticalRetentionRate < 1) return 'poor'
  if (signal.untrustedRatio > UNTRUSTED_RATIO_WARN) return 'poor'
  if (signal.residentAvoidableRatio > RESIDENT_AVOIDABLE_WARN) return 'fair'
  return 'good'
}

// ============================================================
// 关键指令识别
// ============================================================

/**
 * 关键指令识别规则
 *
 * 只收「丢了会改变行为」的表述：约束、决策、未决项。
 * 泛化的叙述性内容不入表，否则标记会失去筛选意义。
 */
const CRITICAL_PATTERNS: RegExp[] = [
  /(?:必须|务必|一定要|不得|不要|禁止|只能|不能|千万)/,
  /(?:架构|技术选型|约定|规范|统一用|一律用)/,
  /(?:待办|未决|尚未|还需|待确认|下一步|TODO)/i,
]

export interface CriticalMarkableMessage {
  id: string
  role: string
  text?: string
}

/** 标记关键消息，返回其 id 列表；压缩后用同样的规则校验留存 */
export function markCriticalMessages(messages: CriticalMarkableMessage[]): string[] {
  const ids: string[] = []
  for (const message of messages) {
    if (message.role === 'system') continue
    const text = message.text ?? ''
    if (!text) continue
    if (CRITICAL_PATTERNS.some((pattern) => pattern.test(text))) ids.push(message.id)
  }
  return ids
}

// ============================================================
// 检索优先
// ============================================================

/**
 * 可回溯工具
 *
 * 这些工具的结果可以凭标识重新取回，因此属于「可以只留线索」的内容。
 * 不可回溯的结果（命令输出、推理文本）一旦移出就只能丢失。
 */
export const RETRIEVABLE_TOOLS = new Set([
  'read_file',
  'read_multiple_files',
  'search_files',
  'list_directory',
  'codebase_search',
])

/**
 * 构建可回溯内容的占位标识
 *
 * 与泛化的「已清理」不同，这里保留工具名与取回线索，
 * 模型知道内容还在、用什么方式拿回来，需要时可以重新读取。
 */
export function buildRetrievalPlaceholder(toolName: string, locator?: string): string {
  const name = toolName || 'tool'
  return locator
    ? `[已移出上下文：${name} ${locator}，需要时重新读取]`
    : `[已移出上下文：${name} 的结果，需要时重新获取]`
}

export interface ResidentContentMessage {
  name?: string
  content?: string
  tokenCount?: number
}

/**
 * 统计常驻内容中可回溯部分的比例
 *
 * 用途：量化「检索优先」还有多少改进空间。数值越高，说明越多
 * 本可以按需取回的内容被长期占用在上下文里。
 */
export function computeResidentStats(messages: ResidentContentMessage[]): {
  residentTokens: number
  residentAvoidableTokens: number
} {
  let residentTokens = 0
  let residentAvoidableTokens = 0

  for (const message of messages) {
    const tokens = message.tokenCount ?? Math.ceil((message.content?.length ?? 0) / 3)
    residentTokens += tokens
    if (message.name && RETRIEVABLE_TOOLS.has(message.name)) {
      residentAvoidableTokens += tokens
    }
  }

  return { residentTokens, residentAvoidableTokens }
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000
}
