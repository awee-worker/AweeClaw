/**
 * 消息构建器 — LLM 请求消息组装
 */

import { logger } from '@toolkit/LogEngine'
import type { ChatMessage, MessageContent, TodoItem, MountedTaskInfo } from '@intelligence/providerTypes'
import type { LLMMessage } from '@intelligence/providerTypes'
import type { CompressionLevel } from '../context/compressionUtils'
import type { StructuredSummary } from '../context/contextTypes'
import { prepareMessages, estimateMessagesTokens } from '../context/ContextCompressor'
import { pruneHistory, isMainChainPruningEnabled } from '../context/contextPruner'
import { buildLLMApiMessages } from './MessageAdapter'
import { countTokens } from '@shared/toolkit/tokenEstimator'

/** 从用户消息内容中抽出纯文本，供历史裁剪的相关性判定使用 */
function toPlainText(content: MessageContent): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((part) => part && typeof part === 'object' && (part as { type?: string }).type === 'text')
    .map((part) => (part as { text?: string }).text ?? '')
    .join(' ')
}

export interface RuntimeStateContext {
  handoffContext?: string
  todos?: TodoItem[]
  pendingObjective?: string
  pendingSteps?: string[]
  /** 会话结构化摘要：压缩（L2+）后保留的长期上下文，防止裁剪后 AI“失忆” */
  contextSummary?: StructuredSummary | null
  /**
   * 已挂载且已续跑的任务执行情况
   *
   * 会话被手动停止时附着的挂载只是一枚「书签」，只有用户点过「继续执行任务」
   * （`resumedAt` 被写入）才需要把执行情况带进上下文，否则用户在该会话里问
   * 无关问题时会被无关的任务快照干扰。
   */
  mountedTask?: MountedTaskInfo
}

export interface MessageAssemblyResult {
  messages: LLMMessage[]
  compressionLevel: CompressionLevel
  estimatedTokens: number
  compressionStats: {
    truncatedToolCalls: number
    clearedToolResults: number
    removedMessages: number
  }
}

export interface UserMessageContent {
  raw: MessageContent
  context: string
  combined: MessageContent
  estimatedTokens: number
}

export class MessageCompressor {
  compress(
    messages: ChatMessage[],
    level: CompressionLevel
  ): {
    messages: ChatMessage[]
    stats: {
      truncatedToolCalls: number
      clearedToolResults: number
      removedMessages: number
    }
  } {
    const result = prepareMessages(messages, level)

    logger.agent.debug(
      `[MessageCompressor] Compressed to L${level}: removed=${result.removedMessages}, truncated=${result.truncatedToolCalls}, cleared=${result.clearedToolResults}`
    )

    return {
      messages: result.messages,
      stats: {
        truncatedToolCalls: result.truncatedToolCalls,
        clearedToolResults: result.clearedToolResults,
        removedMessages: result.removedMessages,
      },
    }
  }

  estimateTokens(messages: ChatMessage[]): number {
    return estimateMessagesTokens(messages)
  }
}

export class MessageAssembler {
  private compressor: MessageCompressor

  constructor() {
    this.compressor = new MessageCompressor()
  }

  /**
   * 组装用户消息
   *
   * @param rawMessage   用户真正输入的内容（也是气泡与历史里保留的内容）
   * @param contextContent 引用的上下文（文件/代码库等）
   * @param agentContext  静默附加给模型的说明（断点续接 / 上下文衔接）。
   *                      它只在本次请求中前置拼接，不进入消息对象本身，
   *                      因此不会显示在用户气泡里，也不会随历史逐轮累积。
   */
  assembleUserMessage(
    rawMessage: MessageContent,
    contextContent: string,
    agentContext?: string
  ): UserMessageContent {
    const prefixParts: Array<{ type: 'text'; text: string }> = []

    if (agentContext) {
      prefixParts.push({ type: 'text', text: `${agentContext}\n\n` })
    }
    if (contextContent) {
      prefixParts.push({
        type: 'text',
        text: `## Referenced Context\n${contextContent}\n\n## User Request\n`,
      })
    }

    // 无前缀时直接复用入参对象，避免为纯文本请求白造一层数组
    const combined: MessageContent = prefixParts.length === 0
      ? rawMessage
      : [
          ...prefixParts,
          ...(typeof rawMessage === 'string' ? [{ type: 'text' as const, text: rawMessage }] : rawMessage),
        ]

    return {
      raw: rawMessage,
      context: contextContent,
      combined,
      estimatedTokens: this.estimateMessageTokens(combined),
    }
  }

  assemble(
    messageHistory: ChatMessage[],
    userMessage: UserMessageContent,
    systemPrompt: string,
    compressionLevel: CompressionLevel,
    runtimeState?: RuntimeStateContext
  ): MessageAssemblyResult {
    const { messages: compressedMessages, stats } = this.compressor.compress(
      messageHistory,
      compressionLevel
    )

    // 历史裁剪（默认关闭）：按与当前请求的相关性筛掉无关回合。
    // 与上游压缩互补 —— 压缩管「单条消息过长」，裁剪管「回合过多且多数无关」。
    // 两者作用域不重叠：裁剪只在安全阀全部通过时才真正生效。
    let history = compressedMessages
    if (isMainChainPruningEnabled()) {
      const pruned = pruneHistory(compressedMessages, toPlainText(userMessage.raw))
      if (!pruned.stats.skipped) {
        history = pruned.messages
        stats.removedMessages += pruned.stats.removedMessages
        logger.agent.info(
          `[MessageAssembler] 历史裁剪 ${compressedMessages.length} → ${history.length} 条`
        )
      }
    }

    const lastMsg = history[history.length - 1]
    const messagesToConvert = lastMsg?.role === 'user'
      ? history.slice(0, -1)
      : history

    const llmMessages = buildLLMApiMessages(messagesToConvert, systemPrompt)

    // 运行时状态（待办 / 续跑情况 / 会话摘要）跟随本轮用户消息一起发送，而不是单独
    // 插一条 assistant 消息。插成 assistant 时，模型的「上一轮回复」会变成这份应用
    // 状态快照 —— 历史里真正的回复被顶到更早的位置，模型于是不知道自己刚才说了什么，
    // 整段会话失去连贯性（陈旧待办还会把话题带回早已完成的任务）。
    // 摘要同样仅在确实发生压缩（L2+）时注入，避免低等级/新话题把陈旧摘要混入上下文。
    const runtimeStateText = this.buildRuntimeStateText(runtimeState, compressionLevel >= 2)
    const userMessageContent: MessageContent = runtimeStateText
      ? [
          { type: 'text', text: `${runtimeStateText}\n\n` },
          ...(typeof userMessage.combined === 'string'
            ? [{ type: 'text' as const, text: userMessage.combined }]
            : userMessage.combined),
        ]
      : userMessage.combined

    llmMessages.push({
      role: 'user',
      content: userMessageContent,
    })

    const historyTokens = this.compressor.estimateTokens(history)
    const systemPromptTokens = countTokens(systemPrompt)
    const runtimeTokens = runtimeStateText ? countTokens(runtimeStateText) : 0
    const estimatedTokens = historyTokens + systemPromptTokens + runtimeTokens + userMessage.estimatedTokens

    logger.agent.info(
      `[MessageAssembler] Assembled ${llmMessages.length} messages, L${compressionLevel}, ~${estimatedTokens} tokens`
    )

    return {
      messages: llmMessages,
      compressionLevel,
      estimatedTokens,
      compressionStats: stats,
    }
  }

  /**
   * 组装运行时状态说明（待办 / 续跑情况 / 会话摘要）
   *
   * 返回纯文本，由调用方拼进本轮用户消息。刻意不返回 assistant 消息：
   * 应用状态不是模型说过的话，把它伪装成一轮 assistant 会让模型误以为那是
   * 自己刚给出的回复，从而「忘掉」真正的上一轮回复。
   */
  private buildRuntimeStateText(runtimeState?: RuntimeStateContext, injectSummary = false): string | null {
    if (!runtimeState) return null

    const sections: string[] = []

    if (runtimeState.handoffContext?.trim()) {
      sections.push(runtimeState.handoffContext.trim())
    }

    // 会话背景摘要：压缩（L2+）会把较早历史折叠为结构化摘要。
    // 若裁剪后不再把摘要注入 LLM，AI 会“失忆”，导致用户说“继续”时
    // AI 不知道要续接什么（致命问题 #1/#2）。仅在实际发生压缩（injectSummary）时注入。
    const summary = injectSummary ? runtimeState.contextSummary : null
    if (summary && (summary.objective || (summary.completedSteps?.length ?? 0) > 0 || (summary.pendingSteps?.length ?? 0) > 0)) {
      const summaryLines: string[] = ['## Conversation Background (structured summary of earlier history)']
      if (summary.objective?.trim()) {
        summaryLines.push(`**Objective**: ${summary.objective.trim()}`)
      }
      if (summary.completedSteps?.length) {
        summaryLines.push(`**Completed**:\n${summary.completedSteps.slice(-8).map(s => `- ${s}`).join('\n')}`)
      }
      if (summary.pendingSteps?.length) {
        summaryLines.push(`**Still Pending**:\n${summary.pendingSteps.slice(-8).map(s => `- ${s}`).join('\n')}`)
      }
      if (summary.todos?.length) {
        summaryLines.push(`**Task List**:\n${summary.todos.slice(-8).map(todo => `- [${todo.status}] ${todo.status === 'in_progress' ? todo.activeForm : todo.content}`).join('\n')}`)
      }
      // 用户纠正过的方向与已修好的错误：折叠后若不带上，模型会重新提出
      // 已被否掉的方案，或重犯已经修过的问题。
      if (summary.decisions?.length) {
        const decisionLines = summary.decisions
          .slice(-6)
          .map(decision => `- [${decision.type}] ${decision.description}`)
        summaryLines.push(`**Decisions & Corrections**:\n${decisionLines.join('\n')}`)
      }
      if (summary.errorsAndFixes?.length) {
        const fixedLines = summary.errorsAndFixes
          .slice(-4)
          .map(entry => `- ${entry.error} → resolved by ${entry.fix}`)
        summaryLines.push(`**Errors Already Fixed**:\n${fixedLines.join('\n')}`)
      }
      summaryLines.push('Treat this as background context from earlier turns. Continue naturally and do not redo completed work unless the user asks.')
      sections.push(summaryLines.join('\n'))
    }

    if (runtimeState.pendingObjective || (runtimeState.pendingSteps && runtimeState.pendingSteps.length > 0)) {
      const objective = runtimeState.pendingObjective?.trim() || 'None'
      const steps = runtimeState.pendingSteps?.slice(0, 8).map(step => `- ${step}`).join('\n') || '- None'
      sections.push(`## Runtime Task State\n\n**Pending Objective**: ${objective}\n\n**Pending Steps**:\n${steps}`)
    }

    // 挂载任务的续跑上下文：只在用户点过「继续执行任务」后注入，
    // 带上停止时整理的执行情况，避免模型重新做已完成的工作。
    const mounted = runtimeState.mountedTask
    if (mounted?.resumedAt) {
      const mountedLines = ['## Resumed Task (mounted when the session was stopped)']
      mountedLines.push(mounted.summary.trim())
      if (mounted.pendingSteps.length > 0) {
        mountedLines.push(
          '\nContinue from here: finish the remaining steps and do not redo completed work.',
        )
      } else {
        mountedLines.push('\nIf nothing is left, verify the result and wrap up.')
      }
      sections.push(mountedLines.join('\n'))
    }

    // 只带未完成的待办：已完成的清单是过期噪音，注入后会把模型拉回早已结束的
    // 任务上（历史里 todo_write 的结果已经记录过这些条目，无需重复提醒）。
    const openTodos = (runtimeState.todos || []).filter(todo => todo.status !== 'completed')
    if (openTodos.length > 0) {
      const todoLines = openTodos
        .slice(0, 12)
        .map(todo => `- [${todo.status}] ${todo.status === 'in_progress' ? todo.activeForm : todo.content}`)
        .join('\n')
      sections.push(`## Open Task List\n\nThis is application state, not a fresh user request.\n${todoLines}`)
    }

    if (sections.length === 0) {
      return null
    }

    return [
      '## Application Runtime State (attached to this request, not a previous assistant reply)',
      'Treat it as background state only — answer the user request that follows.',
      '',
      sections.join('\n\n'),
    ].join('\n')
  }

  private estimateMessageTokens(content: MessageContent): number {
    if (typeof content === 'string') {
      return countTokens(content)
    }

    let total = 0
    for (const part of content) {
      if (part.type === 'text' && part.text) {
        total += countTokens(part.text)
      } else if (part.type === 'image') {
        total += 1600
      }
    }
    return total
  }
}
