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
