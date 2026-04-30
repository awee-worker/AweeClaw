/**
 * 上下文构建器
 * 负责构建发送给 LLM 的上下文内容
 *
 * 已改造为使用 ContextPipeline 管道系统。
 * 原有的 processContextItem 逻辑已迁移到 ContextPipeline.ts 中的各个 Provider。
 * 此文件保留 buildContextContent 和 buildUserContent 作为向后兼容入口。
 */

import { buildContextContentViaPipeline } from './ContextPipeline'
import type { MessageContent, TextContent } from '../types'

/**
 * 构建上下文内容（向后兼容入口）
 * 实际逻辑已迁移到 ContextPipeline
 */
export async function buildContextContent(
  contextItems: import('../types').ContextItem[],
  userQuery?: string,
  assistantId?: string,
  threadId?: string
): Promise<string> {
  return buildContextContentViaPipeline(contextItems, userQuery, assistantId, threadId)
}

/**
 * 构建用户消息内容（包含上下文）
 */
export function buildUserContent(
  message: MessageContent,
  contextContent: string
): MessageContent {
  if (!contextContent) return message

  const contextPart: TextContent = {
    type: 'text',
    text: `## Referenced Context\n${contextContent}\n\n## User Request\n`
  }

  if (typeof message === 'string') {
    return [contextPart, { type: 'text', text: message }]
  }
  return [contextPart, ...message]
}
