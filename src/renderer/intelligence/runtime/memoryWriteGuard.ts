/**
 * 记忆写入准入
 *
 * 要拦的是这条链路：外部内容 → 长期记忆 → 跨会话持续生效。
 * 内容一旦沉淀为长期记忆，后续每一轮对话都会把它当作既有事实读回来，
 * 此时再做任何运行时检查都晚了。
 *
 * 判定只依赖两个结构化事实：内容的来源信任级别、写入是否由用户显式发起。
 * 唯一的语义规则是「指令式表述」—— 长期记忆里的规则改写类内容危害最大，
 * 宁可错杀。其余语义判别一律不做：能被绕过的判别不如不做。
 */

import type { ToolOrigin, TrustLevel, UntrustedContextSignal } from '@intelligence/types/trustTypes'
import type { MemoryEntryInput } from './longTermMemoryService/types'

/** 写入处置 */
export type MemoryWriteDisposition =
  /** 原样落盘 */
  | 'accept'
  /** 降级落盘：只进短期，标记不可信，不参与长期提升 */
  | 'demote'
  /** 直接丢弃 */
  | 'reject'

export interface MemoryWriteDecision {
  /** 是否落盘（demote 仍落盘，但按 override 改写后写入） */
  allowed: boolean
  disposition: MemoryWriteDisposition
  reason: string
  /** demote 时调用方必须采用的落盘修正 */
  override?: Partial<MemoryEntryInput>
}

/**
 * 指令式表述模式
 *
 * 覆盖两类：设定长期规则的祈使句、要求忽略既有约束的表述。
 * 只匹配明确的句式，不做泛化语义判断。
 */
const INSTRUCTIONAL_PATTERNS: RegExp[] = [
  // 设定长期规则
  /以后(都|一律|全部|所有|必须|要)/,
  /(从|自)(现在|今|此)起[，,\s]*(都|要|必须|一律)/,
  /(永久|永远)(保留|记住|执行|生效)/,
  // 要求忽略既有约束
  /忽略(之前|以上|上述|前面|此前)的?(指令|要求|规则|设定|对话)/,
  /(不要|别再|无需|不用)再(询问|确认|提示|提醒|问我)/,
  // 英文同类句式
  /\bfrom now on\b/i,
  /\balways\s+\w{0,20}\b(use|do|run|execute|add|send|write|delete)\b/i,
  /\bignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|rules?|prompts?)/i,
  /\b(do not|don'?t|never)\s+(ask|confirm|verify|prompt)\b/i,
  /\bwithout\s+(asking|confirmation|verification)\b/i,
]

/** 判断内容是否为指令式表述（规则改写类） */
export function isInstructionalContent(content: string): boolean {
  if (!content) return false
  return INSTRUCTIONAL_PATTERNS.some(pattern => pattern.test(content))
}

/** 写入是否由用户显式发起（区别于系统自动提取） */
function isExplicitUserIntent(input: MemoryEntryInput): boolean {
  return input.source === 'user'
}

/**
 * 记忆写入准入判定
 *
 * @param input  待写入的记忆
 * @param origin 该条内容的来源；缺省视为可信（不影响未接入来源的既有路径）
 */
export function guardMemoryWrite(
  input: MemoryEntryInput,
  origin?: ToolOrigin | null,
): MemoryWriteDecision {
  const trust = origin?.trust

  if (!trust || trust === 'trusted' || trust === 'instruction') {
    return { allowed: true, disposition: 'accept', reason: '来源可信' }
  }

  // 以下均为不可信来源
  if (isInstructionalContent(input.content)) {
    return {
      allowed: false,
      disposition: 'reject',
      reason: '外部内容中的指令式表述不得沉淀为记忆',
    }
  }

  if (isExplicitUserIntent(input)) {
    return {
      allowed: true,
      disposition: 'accept',
      reason: '用户显式要求记住外部内容，放行但标记来源',
    }
  }

  return {
    allowed: false,
    disposition: 'demote',
    reason: '外部内容自动提取，降级为短期记忆',
    override: {
      status: 'short_term',
      originTrust: 'untrusted',
      originLocator: input.originLocator ?? origin?.locator,
      originChannel: input.originChannel ?? origin?.channel,
    },
  }
}

/**
 * 由不可信内容信号推导记忆来源
 *
 * 供自动提取路径使用：本轮上下文里出现过不可信内容，则认为提取出的记忆
 * 可能受其影响，按不可信处理 —— 提取是批量动作，无法逐条分清来源，
 * 保守处理比逐条猜测可靠。
 */
export function buildMemoryOrigin(
  signal: UntrustedContextSignal,
  toolName: string,
): ToolOrigin {
  if (!signal.present) {
    return { toolName, channel: 'local_compute', trust: 'trusted' }
  }

  const first = signal.sources[0]
  return {
    toolName: first?.toolName ?? toolName,
    channel: first?.channel ?? 'external_service',
    trust: 'untrusted',
    locator: first?.locator,
  }
}

/**
 * 从记忆输入还原来源对象
 *
 * 写入侧在 input 上填的是扁平字段，判定函数要的是来源对象，
 * 在此转换一次，避免每个调用点各自拼装。
 */
export function originFromEntryInput(input: MemoryEntryInput): ToolOrigin | undefined {
  if (!input.originTrust) return undefined
  return {
    toolName: 'memory_write',
    channel: input.originChannel ?? 'external_service',
    trust: input.originTrust,
    locator: input.originLocator,
  }
}

/** 长期提升门槛：不可信来源的内容不参与长期记忆提升 */
export function isEligibleForPromotion(originTrust: TrustLevel | undefined): boolean {
  return originTrust !== 'untrusted'
}
