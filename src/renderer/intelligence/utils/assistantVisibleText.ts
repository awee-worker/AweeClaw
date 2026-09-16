/**
 * 助手消息「可见文本」提取
 *
 * 背景：助手消息的展示文本可能分散在三处，`content` 未必完整：
 * - `content`：流式文本（正常路径）
 * - `parts[].content`：文本 part（content 未同步时）
 * - `interactive.question` / `ask_user` 工具参数：提问正文（提问走工具时）
 *
 * 上下文压缩、会话交接等流程若只读取 `content`，就会漏掉「AI 最后问了什么」，
 * 导致用户对上一轮提问的简短确认（「要」「继续」）失去指向对象。
 */

import { getMessageText, type AssistantMessage, type ChatMessage } from '@intelligence/providerTypes'

/** 提取助手消息的可见文本（content → 文本 part → 交互式提问 → ask_user 提问） */
export function extractAssistantVisibleText(message: ChatMessage | undefined | null): string {
  if (!message || message.role !== 'assistant') return ''

  const assistant = message as AssistantMessage
  const fromContent = getMessageText(assistant.content).trim()
  if (fromContent) return fromContent

  const parts = (assistant.parts || []) as Array<{
    type?: string
    content?: unknown
    toolCall?: { name?: string; arguments?: unknown }
  }>

  const fromParts = parts
    .filter(part => part?.type === 'text' && typeof part.content === 'string')
    .map(part => part.content as string)
    .join('')
    .trim()
  if (fromParts) return fromParts

  const interactiveQuestion = (assistant as AssistantMessage & { interactive?: { question?: string } }).interactive?.question
  if (interactiveQuestion) return interactiveQuestion.trim()

  for (const part of parts) {
    if (part?.toolCall?.name !== 'ask_user') continue
    const args = part.toolCall.arguments as { question?: unknown } | undefined
    if (args && typeof args.question === 'string' && args.question.trim()) {
      return args.question.trim()
    }
  }

  return ''
}

/** 取线程中最后一条助手消息的可见文本 */
export function extractLastAssistantVisibleText(messages: ChatMessage[] | undefined | null): string {
  if (!messages?.length) return ''
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== 'assistant') continue
    const text = extractAssistantVisibleText(messages[i])
    if (text) return text
  }
  return ''
}
