/**
 * Context Builder for LLM layer
 */
export interface ContextBuildOptions {
  maxTokens?: number
  includeSystemPrompt?: boolean
  includeHistory?: boolean
  includeTools?: boolean
}

export interface BuiltContext {
  systemPrompt?: string
  messages: Array<{ role: string; content: string }>
  tools?: Array<{ name: string; description: string }>
  totalTokens: number
}

export class ContextBuilder {
  private systemPrompt = ''
  private messages: Array<{ role: string; content: string }> = []
  private tools: Array<{ name: string; description: string }> = []

  setSystemPrompt(prompt: string): this {
    this.systemPrompt = prompt
    return this
  }

  addMessage(role: string, content: string): this {
    this.messages.push({ role, content })
    return this
  }

  addTool(name: string, description: string): this {
    this.tools.push({ name, description })
    return this
  }

  build(options?: ContextBuildOptions): BuiltContext {
    const result: BuiltContext = {
      messages: options?.includeSystemPrompt !== false && this.systemPrompt
        ? [{ role: 'system', content: this.systemPrompt }, ...this.messages]
        : [...this.messages],
      totalTokens: 0,
    }
    if (options?.includeTools !== false && this.tools.length > 0) {
      result.tools = [...this.tools]
    }
    return result
  }

  reset(): this {
    this.systemPrompt = ''
    this.messages = []
    this.tools = []
    return this
  }
}

/**
 * 构建用户消息内容
 *
 * 将用户消息与上下文（文件、代码片段等）合并为 LLM 可识别的内容结构。
 * 支持字符串、对象数组等多种输入形式，并按需拼接上下文。
 *
 * @param message 用户主消息内容（字符串或内容片段数组）
 * @param context 附加上下文（文件、代码片段等），将拼接在主消息之后
 * @returns 标准化的用户消息内容（字符串或内容片段数组）
 */
export function buildUserContent(
  message: string | Array<string | { type: 'text'; text: string } | { type: 'image'; url: string }>,
  context: string = '',
): string | Array<{ type: 'text'; text: string } | { type: 'image'; url: string }> {
  // 数组形式输入：保留多模态结构，附加文本上下文
  if (Array.isArray(message)) {
    const result: Array<{ type: 'text'; text: string } | { type: 'image'; url: string }> = []
    for (const part of message) {
      if (typeof part === 'string') {
        result.push({ type: 'text', text: part })
      } else {
        result.push(part)
      }
    }
    if (context) {
      result.push({ type: 'text', text: context })
    }
    return result
  }

  // 字符串形式输入：直接拼接上下文
  if (!context) return message
  return `${message}\n\n${context}`
}
