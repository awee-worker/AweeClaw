/**
 * Agent 执行准备服务
 *
 * 将执行准备流程拆分为多个专职阶段，按顺序串联执行。
 * 每个阶段只关注自身职责，阶段间通过执行上下文传递数据。
 */

import { logger } from '@toolkit/LogEngine'
import type { WorkMode } from '@protocols/workModeProtocol'
import type {
  MessageContent,
  ContextItem,
  ChatMessage,
  LLMMessage,
} from '@intelligence/providerTypes'
import { modeRegistry } from '../capabilities/mode/WorkModeRegistry'
import { createBudgetController } from '../capabilities/budget/TokenQuotaManager'
import type {
  TokenBudgetController,
  BudgetReconciliation,
} from '../capabilities/budget/TokenQuotaManager'
import { ContextAssembler } from '../capabilities/context/ContextBuilder'
import type { ContextAssemblyConfig } from '../capabilities/context/ContextBuilder'
import {
  MessageAssembler,
  type RuntimeStateContext,
} from '../capabilities/message/MessageBuilder'
import type { CompressionLevel } from '../capabilities/context/compressionUtils'
import { countTokens } from '@shared/toolkit/tokenEstimator'
import { useAgentStore } from '../state/IntelligenceStore'

/* ------------------------------------------------------------------ */
/* 值对象                                                            */
/* ------------------------------------------------------------------ */

/** 执行配置 */
export interface ExecutionConfig {
  mode: WorkMode
  workspacePath: string | null
  threadId?: string
  assistantId?: string
  requestId?: string
  planTaskId?: string
  contextLimit?: number
  planContext?: {
    planId?: string
    taskId?: string
    requirementsContent?: string
    dependencySummary?: Array<{
      taskId: string
      title: string
      summary: string
      status: 'completed' | 'failed' | 'skipped'
    }>
    taskObjective?: string
  }
}

/** 执行准备结果 */
export interface ExecutionPreparation {
  messages: LLMMessage[]
  compressionLevel: CompressionLevel
  estimatedTokens: number
  budgetController: TokenBudgetController
  compressionStats: {
    truncatedToolCalls: number
    clearedToolResults: number
    removedMessages: number
  }
}

/** 阶段间传递的执行上下文 */
interface PipelineContext {
  config: ExecutionConfig
  systemPrompt: string
  userMessage: MessageContent
  contextItems: ContextItem[]
  messageHistory: ChatMessage[]
  modeDescriptor: ReturnType<typeof modeRegistry.getOrDefault>
  budgetController: TokenBudgetController
  contextLimit: number
  contextResult?: Awaited<ReturnType<ContextAssembler['assemble']>>
  userMessageContent?: ReturnType<MessageAssembler['assembleUserMessage']>
  runtimeState?: RuntimeStateContext
  systemPromptTokens?: number
  contextTokens?: number
  userMessageTokens?: number
  compressionLevel?: CompressionLevel
  messageResult?: ReturnType<MessageAssembler['assemble']>
}

/** 执行阶段接口 */
interface ExecutionStage {
  name: string
  run(ctx: PipelineContext): Promise<void> | void
}

/* ------------------------------------------------------------------ */
/* 阶段实现                                                          */
/* ------------------------------------------------------------------ */

/** 解析工作模式与预算控制器 */
class ModeResolutionStage implements ExecutionStage {
  name = 'ModeResolution'

  run(ctx: PipelineContext) {
    ctx.modeDescriptor = modeRegistry.getOrDefault(ctx.config.mode)
    ctx.contextLimit = ctx.config.contextLimit ?? 128_000
    ctx.budgetController = createBudgetController(
      ctx.config.mode,
      ctx.modeDescriptor,
      ctx.contextLimit,
    )
    logger.agent.info(`[AgentExecutor] mode=${ctx.modeDescriptor.displayName}`)
  }
}

/** 组装上下文 */
class ContextAssemblyStage implements ExecutionStage {
  name = 'ContextAssembly'

  constructor(private readonly assembler: ContextAssembler) {}

  async run(ctx: PipelineContext) {
    const cfg: ContextAssemblyConfig = {
      mode: ctx.config.mode,
      modeDescriptor: ctx.modeDescriptor,
      contextItems: ctx.contextItems,
      userQuery: extractUserQuery(ctx.userMessage),
      assistantId: ctx.config.assistantId,
      threadId: ctx.config.threadId,
      workspacePath: ctx.config.workspacePath,
      planContext: ctx.config.planContext,
    }
    ctx.contextResult = await this.assembler.assemble(cfg)
  }
}

/** 组装用户消息并注入运行时状态 */
class UserMessageStage implements ExecutionStage {
  name = 'UserMessageAssembly'

  constructor(private readonly assembler: MessageAssembler) {}

  run(ctx: PipelineContext) {
    ctx.userMessageContent = this.assembler.assembleUserMessage(
      ctx.userMessage,
      ctx.contextResult!.content,
    )

    ctx.runtimeState = resolveRuntimeState(ctx.config.threadId)
    if (hasRuntimeState(ctx.runtimeState)) {
      logger.agent.info('[AgentExecutor] runtime state injected')
    }

    ctx.systemPromptTokens = countTokens(ctx.systemPrompt)
    ctx.contextTokens = ctx.contextResult!.totalTokens
    ctx.userMessageTokens = ctx.userMessageContent.estimatedTokens
  }
}

/** 预算驱动的压缩迭代 */
class CompressionIterationStage implements ExecutionStage {
  name = 'CompressionIteration'

  constructor(private readonly assembler: MessageAssembler) {}

  run(ctx: PipelineContext) {
    const descriptor = ctx.modeDescriptor
    // 起点：初始压缩级别。若上下文未超限，直接以初始级别发送 —— 保留完整上下文
    // 让 AI 更懂用户意图，避免上一轮重度压缩的级别残留导致"未超限也过度裁剪"，
    // 使 AI 丢失关键上下文（失忆/幻觉）。
    // prevLevel（上一轮实际压缩级别）仅在预算超限时作为跳级起点，加速收敛到
    // 合适级别，同时防止"压缩→继续→立刻又压缩"的循环。
    const prevLevel = ctx.config.threadId
      ? (useAgentStore.getState().threads[ctx.config.threadId]?.compressionStats?.level ?? 0)
      : 0
    let level = descriptor.budgetProfile.initialCompressionLevel as CompressionLevel
    let result = this.assembler.assemble(
      ctx.messageHistory,
      ctx.userMessageContent!,
      ctx.systemPrompt,
      level,
      ctx.runtimeState,
    )

    const maxLevel = 4 as CompressionLevel
    while (level <= maxLevel) {
      const historyTokens = result.estimatedTokens - ctx.systemPromptTokens! - ctx.userMessageTokens!
      const estimate = ctx.budgetController.estimate(
        ctx.systemPromptTokens!,
        historyTokens,
        ctx.contextTokens!,
        ctx.userMessageTokens!,
      )

      if (!estimate.isExceeded || level >= maxLevel) {
        if (estimate.warning) logger.agent.warn(`[AgentExecutor] ${estimate.warning}`)
        break
      }

      // 超限：优先跳到上一轮压缩级别（若更高则直接沿用），加速收敛避免多次迭代
      const next = Math.max(level + 1, prevLevel) as CompressionLevel
      logger.agent.info(
        `[AgentExecutor] compression L${level} → L${next} ` +
          `(${(estimate.usageRatio * 100).toFixed(1)}% > ${(descriptor.budgetProfile.targetRatio * 100).toFixed(1)}% target)`,
      )
      level = next
      result = this.assembler.assemble(
        ctx.messageHistory,
        ctx.userMessageContent!,
        ctx.systemPrompt,
        level,
        ctx.runtimeState,
      )
    }

    ctx.compressionLevel = level
    ctx.messageResult = result
  }
}

/* ------------------------------------------------------------------ */
/* 辅助函数                                                          */
/* ------------------------------------------------------------------ */

/** 从用户消息中提取纯文本查询 */
function extractUserQuery(message: MessageContent): string {
  if (typeof message === 'string') return message
  return message
    .filter((p) => p.type === 'text')
    .map((p) => (p as { text: string }).text)
    .join('')
}

/** 从线程状态中解析运行时上下文 */
function resolveRuntimeState(threadId?: string): RuntimeStateContext | undefined {
  if (!threadId) return undefined
  const thread = useAgentStore.getState().threads[threadId]
  if (!thread) return undefined
  return {
    handoffContext: thread.handoffContext,
    todos: thread.todos,
    pendingObjective: thread.pendingObjective,
    pendingSteps: thread.pendingSteps,
    contextSummary: thread.contextSummary,
  }
}

/** 判断运行时上下文是否包含有效数据 */
function hasRuntimeState(state?: RuntimeStateContext): boolean {
  if (!state) return false
  return Boolean(
    state.handoffContext ||
      (state.todos && state.todos.length > 0) ||
      state.pendingObjective ||
      (state.pendingSteps && state.pendingSteps.length > 0) ||
      state.contextSummary,
  )
}

/* ------------------------------------------------------------------ */
/* 执行器                                                            */
/* ------------------------------------------------------------------ */

/**
 * Agent 执行器
 *
 * 通过阶段管道协调整个准备流程，并对外暴露预算对账能力。
 */
export class AgentExecutor {
  private readonly stages: ExecutionStage[]

  constructor() {
    const contextAssembler = new ContextAssembler()
    const messageAssembler = new MessageAssembler()

    this.stages = [
      new ModeResolutionStage(),
      new ContextAssemblyStage(contextAssembler),
      new UserMessageStage(messageAssembler),
      new CompressionIterationStage(messageAssembler),
    ]
  }

  /** 准备 LLM 请求 */
  async prepare(
    userMessage: MessageContent,
    contextItems: ContextItem[],
    messageHistory: ChatMessage[],
    systemPrompt: string,
    config: ExecutionConfig,
  ): Promise<ExecutionPreparation> {
    const startedAt = Date.now()

    const ctx: PipelineContext = {
      config,
      systemPrompt,
      userMessage,
      contextItems,
      messageHistory,
      modeDescriptor: undefined as unknown as PipelineContext['modeDescriptor'],
      budgetController: undefined as unknown as TokenBudgetController,
      contextLimit: 0,
    }

    for (const stage of this.stages) {
      await stage.run(ctx)
    }

    const elapsed = Date.now() - startedAt
    logger.agent.info(
      `[AgentExecutor] prepared in ${elapsed}ms: ${ctx.messageResult!.messages.length} msgs, ` +
        `L${ctx.compressionLevel}, ~${ctx.messageResult!.estimatedTokens} tokens`,
    )

    return {
      messages: ctx.messageResult!.messages,
      compressionLevel: ctx.messageResult!.compressionLevel,
      estimatedTokens: ctx.messageResult!.estimatedTokens,
      budgetController: ctx.budgetController,
      compressionStats: ctx.messageResult!.compressionStats,
    }
  }

  /** LLM 响应后的预算对账 */
  reconcile(
    budgetController: TokenBudgetController,
    actualInputTokens: number,
    actualOutputTokens: number,
    estimatedInputTokens: number,
  ): BudgetReconciliation {
    return budgetController.reconcile(actualInputTokens, actualOutputTokens, estimatedInputTokens)
  }
}

/** 单例 */
export const agentExecutor = new AgentExecutor()
