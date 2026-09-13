import { logger } from '@toolkit/LogEngine'
import { useStore } from '@store'
import { useAgentStore, type ThreadBoundStore } from '../state/IntelligenceStore'
import { EventBus } from './EventDispatcher'
import { generateSummary } from '../contextModel'
import { LEVEL_NAMES, updateStats, type CompressionStats } from '../capabilities/context/ContextCompressor'
import { executeAutoHandoff } from '../runtime/sessionHandoffService'
import { prepareHandoffForThread, type PreparedHandoffResult } from '../runtime/handoffSessionTracker'
import { getMessageText, type ChatMessage, type ChatThread, type UserMessage } from '@intelligence/providerTypes'
import { getAgentConfig } from '@intelligence/utils/intelligenceConfig'
import type { TokenBudgetController } from '../capabilities/budget/TokenQuotaManager'
import type { StructuredSummary } from '@intelligence/providerTypes'
import type { ExecutionContext } from '@intelligence/providerTypes'
import type { LLMMessage, MessageContent, CompressionLevel } from '@intelligence/providerTypes'

export interface CompressionCheckResult {
  level: 0 | 1 | 2 | 3 | 4
  needsHandoff: boolean
}

/** 重度压缩（L3/L4）后的冷却期：冷却期内不重复触发摘要/交接，避免连续压缩 */
const COMPRESSION_COOLDOWN_MS = 60_000

/** 就地压缩（L2）动作节流：同一线程两次“就地清理/摘要”间的最小间隔。
 *  主循环每一轮 LLM 返回后都会做压缩检查，若无节流会导致“压缩一次后 AI 没回复
 *  多少内容又开始压缩”的频繁抖动（致命问题 #2）。 */
const COMPRESSION_ACTION_MIN_INTERVAL_MS = 15_000
const lastCompressionActionAt = new Map<string, number>()

function markCompressionAction(threadId: string): void {
  lastCompressionActionAt.set(threadId, Date.now())
}

/** 主循环内压缩时受保护的工具（结果不清理） */
const LOOP_PROTECTED_TOOLS = new Set(['ask_user', 'read_file', 'search_files'])

/**
 * 主循环内就地压缩 LLM 消息（LLMMessage[] 格式）
 *
 * 目的：当 AI 仍有多步工具调用要继续执行（hasPendingToolCalls=true）且上下文
 * 已达到 L2+ 时，将较早的低价值工具结果就地替换为占位符，确保下一轮 LLM 请求
 * 不会因上下文超限而报错/降质 —— 让"压缩后直接继续执行"真正生效。
 *
 * 原则：
 * - 只清理工具结果，不做参数截断（截断 write/edit 参数会破坏后续 AI 重试所需数据）
 * - 保护最近 keepTurns 轮内的全部消息（用户请求、工具调用、关键结果）
 * - 保护 ask_user / read_file / search_files 等对后续执行至关重要工具的结果
 * - 只影响当前循环后续的 LLM 请求，不改变线程 UI 展示的历史
 */
export function compressLlmMessagesInPlace(
  messages: LLMMessage[],
  level: CompressionLevel
): { cleared: number } {
  if (level < 2) return { cleared: 0 }

  const config = getAgentConfig()
  const keepTurns = level >= 3 ? config.deepCompressionTurns : config.keepRecentTurns

  // 保护范围：从末尾倒数 keepTurns 条用户消息之后的所有消息都不清理
  let userCount = 0
  let protectFromIdx = messages.length
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      userCount++
      if (userCount >= keepTurns) {
        protectFromIdx = i
        break
      }
    }
  }

  let cleared = 0
  for (let i = 0; i < protectFromIdx; i++) {
    const m = messages[i]
    if (m.role !== 'tool') continue

    const name = m.name || ''
    if (LOOP_PROTECTED_TOOLS.has(name)) continue

    const content = typeof m.content === 'string' ? m.content : ''
    if (content.length > 100) {
      ;(m as { content: MessageContent | null }).content = '[Cleared]'
      cleared++
    }
  }

  if (cleared > 0) {
    logger.agent.info(
      `[Compression] 主循环内压缩生效: cleared=${cleared} 条工具结果 (L${level}, 保护最近 ${keepTurns} 轮)`
    )
  }

  return { cleared }
}

function isSummaryStale(summary: StructuredSummary | null | undefined, userTurns: number, minDelta = 2): boolean {
  if (!summary) return true
  return userTurns >= (summary.turnRange?.[1] ?? 0) + minDelta
}

function fetchLiveThread(threadId: string): ChatThread | null {
  return useAgentStore.getState().threads[threadId] || null
}

function collectRecentUserRequests(messages: ChatMessage[], limit = 5): string[] {
  return messages
    .filter((message): message is UserMessage => message.role === 'user')
    .map(message => getMessageText(message.content).trim())
    .filter(Boolean)
    .slice(-limit)
}

function assembleStructuredSummary(
  summaryResult: Awaited<ReturnType<typeof generateSummary>>,
  userTurns: number,
  userInstructions: string[] = []
): StructuredSummary {
  return {
    objective: summaryResult.objective,
    completedSteps: summaryResult.completedSteps,
    pendingSteps: summaryResult.pendingSteps,
    todos: summaryResult.todos,
    decisions: [],
    fileChanges: summaryResult.fileChanges,
    errorsAndFixes: [],
    userInstructions,
    generatedAt: Date.now(),
    turnRange: [0, userTurns],
  }
}

async function performAutoHandoffIfEligible(
  threadId: string,
  handoffResult: PreparedHandoffResult | null,
  autoHandoff: boolean
): Promise<boolean> {
  if (!handoffResult || !autoHandoff) {
    return false
  }

  return executeAutoHandoff(threadId, handoffResult.handoff.createdAt)
}

function publishCompressionWarning(
  usage: { input: number; output: number },
  contextLimit: number,
  ratio: number,
  budgetController?: TokenBudgetController
) {
  const estimatedRemainingTurns = budgetController
    ? budgetController.estimateRemainingTurns(usage.input, usage.output)
    : Math.floor((1 - ratio) * contextLimit / Math.max(1, usage.input + usage.output))

  EventBus.emit({
    type: 'context:warning',
    level: 3,
    message: `Context usage is high (${(ratio * 100).toFixed(1)}%). Estimated ${estimatedRemainingTurns} turns remaining.`,
  })
}

async function refreshSummarySnapshot(threadId: string, threadStore: ThreadBoundStore): Promise<void> {
  const thread = fetchLiveThread(threadId)
  if (!thread) return

  const userTurns = thread.messages.filter(message => message.role === 'user').length

  if (isSummaryStale(thread.contextSummary, userTurns)) {
    const recentUserRequests = collectRecentUserRequests(thread.messages)
    const summaryResult = await generateSummary(thread.messages, { type: 'detailed', todos: thread.todos })
    const structuredSummary = assembleStructuredSummary(summaryResult, userTurns, recentUserRequests)
    threadStore.setContextSummary(structuredSummary)
    EventBus.emit({ type: 'context:summary', summary: summaryResult.summary })
  }
}

async function refreshHandoffSnapshot(
  threadId: string,
  threadStore: ThreadBoundStore,
  context: ExecutionContext,
  autoHandoff: boolean
): Promise<boolean> {
  const thread = fetchLiveThread(threadId)
  if (!thread) return false

  const handoffWorkspace = context.workspacePath || useStore.getState().workspacePath || ''
  const handoffResult = await prepareHandoffForThread(thread.id, {
    threadStore,
    workspacePath: handoffWorkspace,
  })
  const didAutoHandoff = await performAutoHandoffIfEligible(thread.id, handoffResult, autoHandoff)

  if (handoffResult) {
    EventBus.emit({ type: 'context:handoff', document: handoffResult.handoff })
  }

  return didAutoHandoff
}

async function executeCompressionStrategy(
  calculatedLevel: CompressionCheckResult['level'],
  ratio: number,
  totalTokens: number,
  usage: { input: number; output: number },
  contextLimit: number,
  previousStats: CompressionStats | null,
  thread: ChatThread | null,
  threadId: string,
  threadStore: ThreadBoundStore,
  context: ExecutionContext,
  assistantId: string,
  enableLLMSummary: boolean,
  autoHandoff: boolean,
  budgetController?: TokenBudgetController,
  hasPendingToolCalls = false,
  messages?: LLMMessage[]
): Promise<CompressionCheckResult> {
  // 说明：autoHandoff / assistantId 参数保留以兼容调用方签名。
  // 自动上下文压缩完成后不再向 AI 发送交接消息（需求变更），AI 直接基于压缩后的上下文继续执行。
  void autoHandoff
  void assistantId

  // ===== 智能化对话轮次保护 =====
  // 系统提示 + 工具定义本身会占用大量 token（可能 30-50% contextLimit），
  // 如果仅凭 token 比例触发压缩，会导致短对话也被强制交接。
  // 保护规则：
  //   - 用户对话轮次 < 3 轮：最高只到 level 2（清理旧工具结果），不触发摘要/handoff
  //   - 用户对话轮次 < 5 轮：不触发 level 4 handoff（可以 level 3 摘要）
  //   - 用户对话轮次 >= 5 轮：正常触发所有级别
  const userTurnCount = thread?.messages.filter(m => m.role === 'user').length ?? 0
  const MIN_TURNS_FOR_SUMMARY = 3
  const MIN_TURNS_FOR_HANDOFF = 5

  let effectiveLevel = calculatedLevel
  if (userTurnCount < MIN_TURNS_FOR_SUMMARY && calculatedLevel >= 3) {
    effectiveLevel = 2 as CompressionCheckResult['level']
    logger.agent.info(
      `[Compression] 降级保护: 用户仅 ${userTurnCount} 轮对话，` +
      `level ${calculatedLevel} → ${effectiveLevel}（短对话不触发摘要/handoff）`
    )
  } else if (userTurnCount < MIN_TURNS_FOR_HANDOFF && calculatedLevel >= 4) {
    effectiveLevel = 3 as CompressionCheckResult['level']
    logger.agent.info(
      `[Compression] 降级保护: 用户仅 ${userTurnCount} 轮对话，` +
      `level ${calculatedLevel} → ${effectiveLevel}（短对话不触发 handoff）`
    )
  }

  // ===== 压缩冷却保护 =====
  // 上次刚执行过重度压缩（L3/L4）时，冷却期内不再重复触发摘要/交接，
  // 避免"压缩 → 继续执行 → 立刻又压缩"的循环。冷却期内最高只做轻量清理（L2）。
  const lastCompressedAt = previousStats?.lastUpdatedAt ?? 0
  const inCooldown = previousStats !== null && previousStats.level >= 3 &&
    Date.now() - lastCompressedAt < COMPRESSION_COOLDOWN_MS
  if (inCooldown && effectiveLevel >= 3) {
    logger.agent.info(
      `[Compression] 冷却期抑制: 上次 L${previousStats!.level} 压缩于 ${Date.now() - lastCompressedAt}ms 前，` +
      `level ${effectiveLevel} → 2（冷却期内仅轻量清理，避免连续重度压缩）`
    )
    effectiveLevel = 2 as CompressionCheckResult['level']
  }

  if (effectiveLevel === 3 && (!previousStats || previousStats.level < 3)) {
    publishCompressionWarning(usage, contextLimit, ratio, budgetController)
  }

  // ===== 主循环内压缩生效 =====
  // AI 仍有多步工具调用要继续执行，且上下文已达 L2+ 时，就地清理较早的低价值
  // 工具结果，确保下一轮 LLM 请求不因上下文超限而报错/降质。
  // 这是"压缩后不中断、直接继续执行"的关键：仅做统计/快照而不实际压缩，
  // 会让下一轮请求携带未压缩的超长上下文，最终仍会中断。
  // 节流：主循环每轮 LLM 返回都会执行本检查，15s 内的重复就地清理会被跳过，
  // 避免“压缩一次后没回多少内容又压缩”的频繁抖动（致命问题 #2）。
  if (effectiveLevel >= 2 && hasPendingToolCalls && messages && messages.length > 0) {
    const lastAction = lastCompressionActionAt.get(threadId) ?? 0
    const withinThrottle = Date.now() - lastAction < COMPRESSION_ACTION_MIN_INTERVAL_MS
    if (withinThrottle && effectiveLevel < 3) {
      logger.agent.info(
        `[Compression] 动作节流: 距上次就地压缩 ${Date.now() - lastAction}ms，本轮跳过 L${effectiveLevel} 就地清理`
      )
    } else {
      compressLlmMessagesInPlace(messages, effectiveLevel)
      markCompressionAction(threadId)
    }
  }

  if (effectiveLevel === 3 && enableLLMSummary && thread) {
    // 注意：L4 时跳过独立摘要（避免 L3 摘要 + L4 交接快照两次 LLM 调用）
    // L4 交接快照会 setContextSummary，摘要数据随后经 MessageBuilder 注入给 LLM
    threadStore.setCompressionPhase('summarizing')
    try {
      await refreshSummarySnapshot(threadId, threadStore)
      markCompressionAction(threadId)
    } catch {
      // Summary generation failed, not critical
    } finally {
      threadStore.setCompressionPhase('idle')
    }
  }

  if (effectiveLevel >= 4) {
    // 判断 AI 是否仍在执行中：本轮 LLM 返回后是否还有待执行的工具调用。
    // 注意：不能依赖 executionMeta.loopState —— 它在整个 agent 循环中恒为 'running'，
    // 且 'waiting_for_tools' 从未被任何代码设置，会导致 isAgentRunning 恒为 true，
    // 从而既跳过实际交接又返回 needsHandoff=true，使主循环在 AI 回复完成前被强制 break。
    const isAgentRunning = hasPendingToolCalls
    if (isAgentRunning) {
      logger.agent.info(
        `[Compression] AI 仍有待执行工具调用，压缩后直接继续执行，不中断主循环`
      )
    } else if (thread) {
      threadStore.setCompressionPhase('summarizing')
      try {
        // 自动上下文压缩后只生成交接快照（供 UI 展示与手动交接使用），
        // 不再自动发送“上下文交接”消息给 AI —— AI 直接基于注入的摘要继续执行。
        await refreshHandoffSnapshot(threadId, threadStore, context, false)
        // 自动压缩场景：快照仅归档供手动交接面板使用，不进入 'ready' 待交接态。
        // 否则状态栏会常驻"上下文已压缩"提示，让用户误以为需要手动点击继续。
        const liveThread = fetchLiveThread(threadId)
        if (liveThread && liveThread.handoff.status === 'ready') {
          threadStore.setHandoffState({ ...liveThread.handoff, status: 'idle' })
          logger.agent.info('[Compression] 自动压缩完成，handoff 快照已归档（不进入待交接态，AI 自动继续）')
        }
      } catch (e) {
        // 交接快照生成失败不影响主循环：记录日志后 AI 继续基于当前上下文执行，
        // 绝不让压缩流程的异常中断 AI 会话（需求变更：压缩不中断执行）。
        logger.agent.warn('[Compression] 交接快照生成失败，AI 继续执行:', e)
      } finally {
        threadStore.setCompressionPhase('idle')
      }
    }
  }
  // 不再弹“上下文已压缩”提示（需求变更）：压缩完成后 AI 直接基于压缩后的上下文继续执行

  EventBus.emit({ type: 'context:level', level: effectiveLevel, tokens: totalTokens, ratio })

  // 压缩后不再打断主循环：AI 直接基于压缩后的上下文继续执行
  return { level: effectiveLevel, needsHandoff: false }
}

export async function checkAndHandleCompression(
  usage: { input: number; output: number },
  contextLimit: number,
  threadStore: ThreadBoundStore,
  threadId: string,
  context: ExecutionContext,
  assistantId: string,
  enableLLMSummary: boolean,
  autoHandoff: boolean,
  budgetController?: TokenBudgetController,
  hasPendingToolCalls = false,
  messages?: LLMMessage[]
): Promise<CompressionCheckResult> {
  const thread = fetchLiveThread(threadId)
  const messageCount = thread?.messages.length || 0
  const previousStats = thread?.compressionStats || null
  const newStats = updateStats(
    { promptTokens: usage.input, completionTokens: usage.output },
    contextLimit,
    previousStats,
    messageCount
  )
  const reconciliation = budgetController?.reconcile(
    usage.input,
    usage.output,
    usage.input
  )
  const calculatedLevel = reconciliation?.calculatedLevel ?? newStats.level
  const ratio = reconciliation?.actualUsageRatio ?? newStats.ratio
  const totalTokens = reconciliation
    ? reconciliation.actualInputTokens + reconciliation.actualOutputTokens
    : newStats.inputTokens + newStats.outputTokens

  logger.agent.info(
    `[Compression] L${calculatedLevel} (${LEVEL_NAMES[calculatedLevel]}), ` +
    `ratio: ${(ratio * 100).toFixed(1)}%, ` +
    `tokens: ${totalTokens}/${contextLimit}`
  )

  threadStore.setCompressionStats(newStats)
  threadStore.setCompressionPhase('idle')

  return executeCompressionStrategy(
    calculatedLevel,
    ratio,
    totalTokens,
    usage,
    contextLimit,
    previousStats,
    thread,
    threadId,
    threadStore,
    context,
    assistantId,
    enableLLMSummary,
    autoHandoff,
    budgetController,
    hasPendingToolCalls,
    messages
  )
}
