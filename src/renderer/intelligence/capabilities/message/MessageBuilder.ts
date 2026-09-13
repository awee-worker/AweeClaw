/**
 * 消息构建器 — LLM 请求消息组装
 */

import { logger } from '@toolkit/LogEngine'
import type { ChatMessage, MessageContent, TodoItem } from '@intelligence/providerTypes'
import type { LLMMessage } from '@intelligence/providerTypes'
import type { CompressionLevel } from '../context/compressionUtils'
import type { StructuredSummary } from '../context/contextTypes'
import { prepareMessages, estimateMessagesTokens } from '../context/ContextCompressor'
import { buildLLMApiMessages } from './MessageAdapter'
import { countTokens } from '@shared/toolkit/tokenEstimator'

export interface RuntimeStateContext {
  handoffContext?: string
  todos?: TodoItem[]
  pendingObjective?: string
  pendingSteps?: string[]
  /** 会话结构化摘要：压缩/交接后保留的长期上下文，防止裁剪后 AI“失忆” */
  contextSummary?: StructuredSummary | null
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

  assembleUserMessage(
    rawMessage: MessageContent,
    contextContent: string
  ): UserMessageContent {
    if (!contextContent) {
      const estimatedTokens = this.estimateMessageTokens(rawMessage)
      return {
        raw: rawMessage,
        context: '',
        combined: rawMessage,
        estimatedTokens,
      }
    }

    const contextPart = {
      type: 'text' as const,
      text: `## Referenced Context\n${contextContent}\n\n## User Request\n`,
    }

    const combined: MessageContent = typeof rawMessage === 'string'
      ? [contextPart, { type: 'text' as const, text: rawMessage }]
      : [contextPart, ...rawMessage]

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

    const lastMsg = compressedMessages[compressedMessages.length - 1]
    const messagesToConvert = lastMsg?.role === 'user'
      ? compressedMessages.slice(0, -1)
      : compressedMessages

    const llmMessages = buildLLMApiMessages(messagesToConvert, systemPrompt)
    // 摘要仅在确实发生压缩（L2+）时注入，避免低等级/新话题把陈旧摘要混入上下文
    const runtimeStateMessage = this.buildRuntimeStateMessage(runtimeState, compressionLevel >= 2)
    if (runtimeStateMessage) {
      llmMessages.push(runtimeStateMessage)
    }

    llmMessages.push({
      role: 'user',
      content: userMessage.combined,
    })

    const historyTokens = this.compressor.estimateTokens(compressedMessages)
    const systemPromptTokens = countTokens(systemPrompt)
    const runtimeTokens = runtimeStateMessage ? countTokens(String(runtimeStateMessage.content || '')) : 0
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

  private buildRuntimeStateMessage(runtimeState?: RuntimeStateContext, injectSummary = false): LLMMessage | null {
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
      summaryLines.push('Treat this as background context from earlier turns. Continue naturally and do not redo completed work unless the user asks.')
      sections.push(summaryLines.join('\n'))
    }

    if (runtimeState.pendingObjective || (runtimeState.pendingSteps && runtimeState.pendingSteps.length > 0)) {
      const objective = runtimeState.pendingObjective?.trim() || 'None'
      const steps = runtimeState.pendingSteps?.slice(0, 8).map(step => `- ${step}`).join('\n') || '- None'
      sections.push(`## Runtime Task State\n\n**Pending Objective**: ${objective}\n\n**Pending Steps**:\n${steps}`)
    }

    if (runtimeState.todos && runtimeState.todos.length > 0) {
      const todoLines = runtimeState.todos
        .slice(0, 12)
        .map(todo => `- [${todo.status}] ${todo.status === 'in_progress' ? todo.activeForm : todo.content}`)
        .join('\n')
      sections.push(`## Runtime Task List\n\nThis is application state, not a fresh user request.\n${todoLines}`)
    }

    if (sections.length === 0) {
      return null
    }

    return {
      role: 'assistant',
      content: `Application runtime state snapshot.\nTreat this as resume context only.\n\n${sections.join('\n\n')}`,
    }
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
