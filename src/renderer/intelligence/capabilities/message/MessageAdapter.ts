/**
 * 消息转换器
 * 将内部消息格式转换为 LLM API 格式
 */

import { ChatMessage, isUserMessage, isAssistantMessage, isToolResultMessage, ToolResultMessage } from '@intelligence/providerTypes'
import { logger } from '@shared/toolkit/LogEngine'
import type { LLMMessage } from '@intelligence/providerTypes'

/**
 * 解析助手消息的可见文本兜底值
 *
 * 用途：`content` 为空（历史流式残留 / 提问走 ask_user 工具）时，
 * 从文本 part 或交互式提问中还原「AI 实际说了什么」，
 * 避免整条助手消息在历史转换时被丢弃、导致下一轮上下文断裂。
 */
function resolveAssistantVisibleText(msg: ChatMessage): string {
  const assistantMsg = msg as unknown as {
    content?: unknown
    parts?: Array<{ type?: string; content?: unknown; toolCall?: { name?: string; arguments?: unknown } }>
    interactive?: { question?: string }
  }

  const fromParts = (assistantMsg.parts || [])
    .filter(part => part?.type === 'text' && typeof part.content === 'string')
    .map(part => part.content as string)
    .join('')
    .trim()
  if (fromParts) return fromParts

  const interactiveQuestion = assistantMsg.interactive?.question
  if (interactiveQuestion) return interactiveQuestion

  // ask_user 的提问正文只存在于工具调用参数中（无 tool result 时整条消息会被丢弃）
  for (const part of assistantMsg.parts || []) {
    const toolCall = part?.toolCall
    if (toolCall?.name !== 'ask_user') continue
    const args = toolCall.arguments as { question?: unknown } | undefined
    if (args && typeof args.question === 'string' && args.question) return args.question
  }

  return ''
}

/**
 * 从 ChatMessage[] 构建 LLM API 消息
 */
export function buildLLMApiMessages(
  messages: ChatMessage[],
  systemPrompt?: string
): LLMMessage[] {
  const result: LLMMessage[] = []

  if (systemPrompt) {
    result.push({ role: 'system', content: systemPrompt })
  }

  const toolResultMap = new Map<string, ChatMessage>()
  for (const msg of messages) {
    if (isToolResultMessage(msg) && msg.toolCallId) {
      toolResultMap.set(msg.toolCallId, msg)
    }
  }

  for (const msg of messages) {
    if (isUserMessage(msg)) {
      // 验证用户消息内容
      if (msg.content === undefined || msg.content === null) {
        logger.agent.warn('[MessageConverter] Skipping user message with invalid content:', { messageId: msg.id })
        continue
      }
      result.push({
        role: 'user',
        content: msg.content,
      })
    } else if (isAssistantMessage(msg)) {
      // 从 parts 中提取 toolCalls（如果 toolCalls 字段为空）
      let toolCalls = msg.toolCalls || []
      if (toolCalls.length === 0 && msg.parts) {
        toolCalls = msg.parts
          .filter((p): p is import('../../providerTypes').ToolCallPart => p.type === 'tool_call')
          .map(p => p.toolCall)
      }

      const validToolCalls = toolCalls.filter(tc => toolResultMap.has(tc.id))

      if (validToolCalls.length > 0) {
        const assistantMsg: LLMMessage = {
          role: 'assistant',
          content: msg.content || resolveAssistantVisibleText(msg) || (msg.reasoning ? ' ' : null),
          tool_calls: validToolCalls.map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments || {}),
            },
          })),
        }
        if (msg.reasoning) assistantMsg.reasoning_content = msg.reasoning
        result.push(assistantMsg)

        for (const tc of validToolCalls) {
          const toolResult = toolResultMap.get(tc.id)!
          if (isToolResultMessage(toolResult)) {
            // 处理压缩的工具结果
            const content = (toolResult as ToolResultMessage).compactedAt
              ? '[Old tool result content cleared]'
              : toolResult.content
            result.push({
              role: 'tool',
              content,
              tool_call_id: tc.id,
              name: toolResult.name,
            })
          }
        }
      } else {
        // ⚠️ content 为空（或只有 reasoning）时，历史里会把整条助手消息丢掉，
        // 导致「AI 问过什么」在下一轮凭空消失 —— 用户只回一句「要」时 AI 就
        // 不知道要做什么。这里补一层可见文本兜底：文本 part → ask_user 提问。
        const visibleText = msg.content || resolveAssistantVisibleText(msg)
        if (visibleText || msg.reasoning) {
          const assistantMsg: LLMMessage = {
            role: 'assistant',
            content: visibleText || ' ',
          }
          if (msg.reasoning) assistantMsg.reasoning_content = msg.reasoning
          result.push(assistantMsg)
        }
      }
    }
    // 注意：isToolResultMessage 在 for 循环中被静默跳过
    // 孤立的工具结果消息会在上下文压缩后出现，这里不需要处理
  }

  return result
}

/**
 * 验证消息序列是否符合 LLM API 要求
 */
export function validateLLMMessages(messages: LLMMessage[]): { valid: boolean; error?: string } {
  if (messages.length === 0) {
    return { valid: false, error: 'No messages' }
  }

  // 检查 tool 消息是否有对应的 tool_call
  const toolCallIds = new Set<string>()
  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        toolCallIds.add(tc.id)
      }
    }
  }

  for (const msg of messages) {
    if (msg.role === 'tool' && msg.tool_call_id) {
      if (!toolCallIds.has(msg.tool_call_id)) {
        return { valid: false, error: `Tool message has no matching tool_call: ${msg.tool_call_id}` }
      }
    }
  }

  return { valid: true }
}
