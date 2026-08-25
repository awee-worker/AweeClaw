import { logger } from '@toolkit/LogEngine'
import { useStore } from '@store'
import { useAgentStore, type ThreadBoundStore } from '../state/IntelligenceStore'
import { EventBus } from './EventDispatcher'
import { generateSummary } from '../contextModel'
import { LEVEL_NAMES, updateStats, type CompressionStats } from '../capabilities/context/ContextCompressor'
import { executeAutoHandoff } from '../runtime/sessionHandoffService'
import { prepareHandoffForThread, type PreparedHandoffResult } from '../runtime/handoffSessionTracker'
import { getMessageText, type ChatMessage, type ChatThread, type UserMessage } from '@intelligence/providerTypes'
import { pickLocalizedText } from '@intelligence/utils/intelligenceTextUtils'
import type { TokenBudgetController } from '../capabilities/budget/TokenQuotaManager'
import type { StructuredSummary } from '@intelligence/providerTypes'
import type { ExecutionContext } from '@intelligence/providerTypes'

export interface CompressionCheckResult {
  level: 0 | 1 | 2 | 3 | 4
  needsHandoff: boolean
}

function getLocalizedText(language: string, zh: string, en: string): string {
  return pickLocalizedText(zh, en, language as 'en' | 'zh')
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

function notifyContextLimitReached(threadStore: ThreadBoundStore, assistantId: string) {
  const { language } = useStore.getState()
  threadStore.addSystemAlertPart(assistantId, {
    alertType: 'warning',
    title: getLocalizedText(language, '上下文已满', 'Context Limit Reached'),
    message: getLocalizedText(language, '当前对话已达到上下文限制，请开始新会话继续。', 'Please start a new session to continue.'),
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
  hasPendingToolCalls = false
): Promise<CompressionCheckResult> {
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

  if (effectiveLevel === 3 && (!previousStats || previousStats.level < 3)) {
    publishCompressionWarning(usage, contextLimit, ratio, budgetController)
  }

  if (effectiveLevel >= 3 && enableLLMSummary && thread) {
    threadStore.setCompressionPhase('summarizing')
    try {
      await refreshSummarySnapshot(threadId, threadStore)
    } catch {
      // Summary generation failed, not critical
    } finally {
      threadStore.setCompressionPhase('idle')
    }
  }

  let didAutoHandoff = false
  if (effectiveLevel >= 4) {
    // 判断 AI 是否仍在执行中：本轮 LLM 返回后是否还有待执行的工具调用。
    // 注意：不能依赖 executionMeta.loopState —— 它在整个 agent 循环中恒为 'running'，
    // 且 'waiting_for_tools' 从未被任何代码设置，会导致 isAgentRunning 恒为 true，
    // 从而既跳过实际交接又返回 needsHandoff=true，使主循环在 AI 回复完成前被强制 break。
    const isAgentRunning = hasPendingToolCalls
    if (isAgentRunning) {
      logger.agent.info(
        `[Compression] 跳过 handoff: AI 仍有待执行工具调用，等待本轮执行完成后再交接`
      )
    } else {
      if (thread) {
        threadStore.setCompressionPhase('summarizing')
        try {
          didAutoHandoff = await refreshHandoffSnapshot(threadId, threadStore, context, autoHandoff)
        } finally {
          threadStore.setCompressionPhase('idle')
        }
      }
    }

    if (!didAutoHandoff && !isAgentRunning) {
      notifyContextLimitReached(threadStore, assistantId)
    }
  }

  EventBus.emit({ type: 'context:level', level: effectiveLevel, tokens: totalTokens, ratio })

  // needsHandoff 必须与实际交接行为一致：AI 仍在执行中时不中断主循环
  return { level: effectiveLevel, needsHandoff: effectiveLevel >= 4 && !hasPendingToolCalls }
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
  hasPendingToolCalls = false
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
    hasPendingToolCalls
  )
}
