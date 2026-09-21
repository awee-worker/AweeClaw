/**
 * 不可信内容信号汇总
 *
 * 从会话历史中提取本轮上下文的不可信来源，供两处消费：
 * - 系统提示词：决定是否注入信任边界声明
 * - 审批卡片与审计记录：决定是否升级确认等级并展示来源
 *
 * 判定完全基于工具结果上已记录的来源标签，不做内容语义分析。
 */

import { isToolResultMessage, type ChatMessage, type ToolResultMessage } from '@intelligence/providerTypes'
import type {
  ToolOrigin,
  UntrustedContextSignal,
  UntrustedSourceSummary,
} from '@intelligence/types/trustTypes'
import { EMPTY_UNTRUSTED_SIGNAL } from '@intelligence/types/trustTypes'

/** 展示用来源条数上限，避免确认卡片被长列表淹没 */
const MAX_DISPLAYED_SOURCES = 5

export interface CollectUntrustedOptions {
  /**
   * 只统计最近一条用户消息之后的工具结果
   *
   * 审批门禁必须用这个口径：它判定的是「本轮是否消费过外部内容」。
   * 若把整个会话历史都算进来，某轮读到的外部内容会让此后每一轮的高权限操作
   * 都多一次确认，确认随即变成噪音。
   *
   * 提示词不传此项：信任边界声明要覆盖上下文里所有带标签的内容，含历史轮次。
   */
  currentTurnOnly?: boolean
}

/** 最近一条用户消息之后的起点；没有用户消息时从头开始 */
function resolveTurnStart(messages: readonly ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return i + 1
  }
  return 0
}

/**
 * 最近一轮上下文的不可信信号。
 *
 * 记忆写入等旁路动作发生在工具执行过程中，拿不到本轮的消息数组，
 * 只能依赖主循环在每轮开始时把信号放进来。信号随轮次覆盖，
 * 不做跨轮累积 —— 上一轮的外部内容不该影响这一轮的判定。
 */
let lastUntrustedSignal: UntrustedContextSignal = EMPTY_UNTRUSTED_SIGNAL

/** 记录本轮上下文的不可信信号（由主循环在每轮开始时调用） */
export function rememberUntrustedSignal(signal: UntrustedContextSignal): void {
  lastUntrustedSignal = signal ?? EMPTY_UNTRUSTED_SIGNAL
}

/** 读取本轮上下文的不可信信号（供记忆写入等旁路动作使用） */
export function getLastUntrustedSignal(): UntrustedContextSignal {
  return lastUntrustedSignal
}

/** 清空信号（会话结束或切换会话时调用） */
export function clearUntrustedSignal(): void {
  lastUntrustedSignal = EMPTY_UNTRUSTED_SIGNAL
}

/**
 * 汇总消息历史中的不可信来源
 *
 * 按「工具名 + 来源定位」去重；超过展示上限时截断。
 */
export function collectUntrustedSignal(
  messages: readonly ChatMessage[] | undefined | null,
  options?: CollectUntrustedOptions,
): UntrustedContextSignal {
  if (!messages || messages.length === 0) return EMPTY_UNTRUSTED_SIGNAL

  const start = options?.currentTurnOnly ? resolveTurnStart(messages) : 0
  const sources: UntrustedSourceSummary[] = []
  const seen = new Set<string>()

  for (let i = start; i < messages.length; i++) {
    const msg = messages[i]
    if (!isToolResultMessage(msg)) continue

    const origin: ToolOrigin | undefined = (msg as ToolResultMessage).origin
    if (origin?.trust !== 'untrusted') continue

    const key = `${origin.toolName}|${origin.locator ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)

    sources.push({
      toolName: origin.toolName,
      channel: origin.channel,
      locator: origin.locator,
    })

    if (sources.length >= MAX_DISPLAYED_SOURCES) break
  }

  return sources.length > 0 ? { present: true, sources } : EMPTY_UNTRUSTED_SIGNAL
}
