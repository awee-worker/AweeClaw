/**
 * 消息转换器 - 将应用消息格式转换为 AI SDK ModelMessage 格式
 * 使用 AI SDK 6.0 的标准类型，不使用 any
 */

import type { ModelMessage, UserModelMessage, AssistantModelMessage, ToolModelMessage } from '@ai-sdk/provider-utils'
import type { LLMMessage, MessageContentPart } from '@protocols'

export class MessageConverter {
  /**
   * 转换消息列表
   */
  convert(messages: LLMMessage[], systemPrompt?: string): ModelMessage[] {
    const result: ModelMessage[] = []

    // 添加 system prompt
    if (systemPrompt) {
      result.push({
        role: 'system',
        content: systemPrompt,
      })
    }

    // 转换消息
    for (const msg of messages) {
      const converted = this.convertMessage(msg)
      if (converted) {
        result.push(converted)
      }
    }

    return result
  }

  /**
   * 转换单条消息
   */
  private convertMessage(msg: LLMMessage): ModelMessage | null {
    switch (msg.role) {
      case 'system':
        return this.convertSystemMessage(msg)
      case 'user':
        return this.convertUserMessage(msg)
      case 'assistant':
        return this.convertAssistantMessage(msg)
      case 'tool':
        return this.convertToolMessage(msg)
      default:
        return null
    }
  }

  /**
   * 转换 system 消息
   */
  private convertSystemMessage(msg: LLMMessage): ModelMessage {
    return {
      role: 'system',
      content: typeof msg.content === 'string' ? msg.content : '',
    }
  }

  /**
   * 转换 user 消息
   */
  private convertUserMessage(msg: LLMMessage): UserModelMessage | null {
    if (typeof msg.content === 'string') {
      return msg.content.trim() ? { role: 'user', content: msg.content } : null
    }

    // 多模态内容
    const parts = this.convertUserContentParts(msg.content as MessageContentPart[])
    return parts.length > 0 ? { role: 'user', content: parts } : null
  }

  /**
   * 转换 user 消息的多模态内容
   * 改进：添加 mediaType 支持，更符合 AI SDK 规范
   */
  private convertUserContentParts(
    content: MessageContentPart[]
  ): Array<{ type: 'text'; text: string } | { type: 'image'; image: string | URL; mediaType?: string }> {
    const parts: Array<{ type: 'text'; text: string } | { type: 'image'; image: string | URL; mediaType?: string }> = []

    for (const item of content) {
      if (item.type === 'text' && 'text' in item) {
        parts.push({ type: 'text', text: item.text })
      } else if (item.type === 'image' && 'source' in item) {
        const result = this.convertImageSource(
          item.source as { type: string; url?: string; data?: string; media_type?: string }
        )
        if (result) {
          parts.push({
            type: 'image',
            image: result.image,
            ...(result.mediaType && { mediaType: result.mediaType }),
          })
        }
      } else if (item.type === 'file' && 'data' in item) {
        const fileItem = item as { type: 'file'; name: string; media_type: string; data: string }
        const textContent = this.convertFileContent(fileItem)
        if (textContent) {
          parts.push({ type: 'text', text: textContent })
        }
      }
    }

    return parts
  }

  private TEXT_MIME_TYPES = new Set([
    'text/plain', 'text/csv', 'text/html', 'text/xml', 'text/markdown',
    'application/json', 'application/xml', 'application/javascript',
    'application/x-yaml', 'text/yaml',
  ])

  private convertFileContent(file: { name: string; media_type: string; data: string }): string | null {
    try {
      if (this.TEXT_MIME_TYPES.has(file.media_type) || file.media_type.startsWith('text/')) {
        const decoded = Buffer.from(file.data, 'base64').toString('utf-8')
        const truncated = decoded.length > 50000
          ? decoded.slice(0, 50000) + '\n...(file truncated)'
          : decoded
        return `[User uploaded file: ${file.name}]\n\`\`\`\n${truncated}\n\`\`\``
      }

      return `[User uploaded file: ${file.name} (${file.media_type}). The file has been saved to the workspace uploads directory. Check the user message for the exact file path.]`
    } catch {
      return `[User uploaded file: ${file.name} (${file.media_type})]`
    }
  }

  /**
   * 转换图片源
   * 改进：返回 mediaType 以便 AI SDK 更好地处理
   */
  private convertImageSource(source: {
    type: string
    url?: string
    data?: string
    media_type?: string
  }): { image: string | URL; mediaType?: string } | null {
    if (source.type === 'url' && source.url) {
      return {
        image: source.url,
        mediaType: source.media_type,
      }
    }
    if (source.type === 'base64' && source.data) {
      const mediaType = source.media_type || 'image/png' // 默认 PNG
      // 直接传递纯 base64 字符串，不要拼成 data: URL
      // AI SDK 内部的 downloadAssets 会将 data: URL 字符串解析为 URL 对象并用 fetch 下载
      // 而 Electron 打包后 Node.js 原生 fetch 不支持 data: scheme，导致报错
      return {
        image: source.data,
        mediaType,
      }
    }
    return null
  }

  /**
   * 清理 tool call ID，确保符合 Claude API 的格式要求
   * Claude 要求 tool_use.id 匹配 [a-zA-Z0-9_-]+
   */
  private sanitizeToolCallId(id: string): string {
    return id.replace(/[^a-zA-Z0-9_-]/g, '_')
  }

  /**
   * 转换 assistant 消息
   */
  private convertAssistantMessage(msg: LLMMessage): AssistantModelMessage | null {
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      return this.convertAssistantWithToolCalls(msg)
    }

    const content = typeof msg.content === 'string' ? msg.content : ''

    if (!content.trim() && !msg.reasoning_content) return null

    const result: AssistantModelMessage = { role: 'assistant', content: content || ' ' }
    if (msg.reasoning_content) {
      result.providerOptions = {
        openaiCompatible: { reasoning_content: msg.reasoning_content },
      }
    }
    return result
  }

  /**
   * 转换带工具调用的 assistant 消息
   */
  private convertAssistantWithToolCalls(msg: LLMMessage): AssistantModelMessage {
    const content: Array<
      { type: 'text'; text: string } | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }
    > = []

    if (msg.content && typeof msg.content === 'string' && msg.content.trim()) {
      content.push({ type: 'text', text: msg.content })
    } else if (msg.reasoning_content) {
      content.push({ type: 'text', text: ' ' })
    }

    if (msg.tool_calls) {
      for (const toolCall of msg.tool_calls) {
        let parsedInput: unknown
        try {
          parsedInput = JSON.parse(toolCall.function.arguments)
        } catch {
          parsedInput = {}
        }
        content.push({
          type: 'tool-call',
          toolCallId: this.sanitizeToolCallId(toolCall.id),
          toolName: toolCall.function.name,
          input: parsedInput,
        })
      }
    }

    const result: AssistantModelMessage = { role: 'assistant', content }
    if (msg.reasoning_content) {
      result.providerOptions = {
        openaiCompatible: { reasoning_content: msg.reasoning_content },
      }
    }
    return result
  }

  /**
   * 转换 tool 消息
   */
  private convertToolMessage(msg: LLMMessage): ToolModelMessage | null {
    if (!msg.tool_call_id) return null

    // 将内容转换为 ToolResultOutput 格式
    const content = msg.content || ''
    const output =
      typeof content === 'string'
        ? { type: 'text' as const, value: content }
        : { type: 'json' as const, value: JSON.parse(JSON.stringify(content)) }

    return {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: this.sanitizeToolCallId(msg.tool_call_id),
          toolName: msg.name || 'unknown',
          output,
        },
      ],
    }
  }
}
