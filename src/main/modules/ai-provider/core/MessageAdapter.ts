/**
 * 消息转换器 - 将应用消息格式转换为 AI SDK ModelMessage 格式
 * 使用 AI SDK 6.0 的标准类型，不使用 any
 */

import type { ModelMessage, UserModelMessage, AssistantModelMessage, ToolModelMessage } from '@ai-sdk/provider-utils'
import type { LLMMessage, MessageContentPart } from '@protocols'
import type { ScenarioDomain } from '@configuration/defaultProfile'

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
        const imageItem = item as { type: 'image'; source: { type: string; url?: string; data?: string; media_type?: string }; referenceOnly?: boolean; localPath?: string }

        if (imageItem.referenceOnly) {
          const pathInfo = imageItem.localPath
            ? `[User uploaded image saved at: ${imageItem.localPath}]`
            : '[User uploaded an image (reference only)]'
          parts.push({ type: 'text', text: pathInfo })
        } else {
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

/* ------------------------------------------------------------------ */
/* 场景感知消息适配器                                                 */
/* ------------------------------------------------------------------ */

/** 场景消息处理策略 */
export interface ScenarioMessagePolicy {
  /** 场景类型 */
  domain: ScenarioDomain
  /** 是否对用户消息进行脱敏 */
  sanitizeUserInput: boolean
  /** 是否对工具结果进行截断 */
  truncateToolResults: boolean
  /** 工具结果最大字符数 */
  maxToolResultChars: number
  /** 是否在 system prompt 中注入合规提示 */
  injectCompliancePrompt: boolean
  /** 合规提示内容 */
  compliancePrompt: string
  /** 是否保留 reasoning_content */
  preserveReasoning: boolean
  /** 是否记录消息审计日志 */
  enableAudit: boolean
}

/** 场景消息策略预设 */
const SCENARIO_MESSAGE_POLICIES: Record<ScenarioDomain, ScenarioMessagePolicy> = {
  /** 法律场景：脱敏 + 截断 + 合规提示 + 审计 */
  legal: {
    domain: 'legal',
    sanitizeUserInput: true,
    truncateToolResults: true,
    maxToolResultChars: 12000,
    injectCompliancePrompt: true,
    compliancePrompt:
      'IMPORTANT: This is a legal advisory context. ' +
      'Provide precise, well-cited responses. ' +
      'Avoid speculation. Clearly distinguish between established law and interpretation. ' +
      'Confidential client information must not be exposed.',
    preserveReasoning: true,
    enableAudit: true,
  },

  /** 医疗场景：严格脱敏 + 强制截断 + 合规提示 + 审计 */
  medical: {
    domain: 'medical',
    sanitizeUserInput: true,
    truncateToolResults: true,
    maxToolResultChars: 10000,
    injectCompliancePrompt: true,
    compliancePrompt:
      'IMPORTANT: This is a medical decision support context. ' +
      'All responses must include appropriate disclaimers. ' +
      'Patient data must be de-identified. ' +
      'Recommendations must not replace professional medical judgment. ' +
      'Follow HIPAA compliance guidelines.',
    preserveReasoning: false,
    enableAudit: true,
  },

  /** 教育场景：轻量截断，无脱敏 */
  education: {
    domain: 'education',
    sanitizeUserInput: false,
    truncateToolResults: true,
    maxToolResultChars: 15000,
    injectCompliancePrompt: false,
    compliancePrompt: '',
    preserveReasoning: true,
    enableAudit: false,
  },

  /** 通用场景：无特殊处理 */
  general: {
    domain: 'general',
    sanitizeUserInput: false,
    truncateToolResults: false,
    maxToolResultChars: 10000,
    injectCompliancePrompt: false,
    compliancePrompt: '',
    preserveReasoning: true,
    enableAudit: false,
  },
}

/** 敏感信息正则模式 */
const SENSITIVE_DATA_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // 社会保障号
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '[SSN]' },
  // 信用卡号
  { pattern: /\b(?:\d[ -]*?){13,16}\b/g, replacement: '[CARD]' },
  // 邮箱
  { pattern: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, replacement: '[EMAIL]' },
  // 电话号码
  { pattern: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, replacement: '[PHONE]' },
  // 病历号
  { pattern: /\b(?:MRN|patient)[\s#:]*\d+\b/gi, replacement: '[MRN]' },
  // 案件号
  { pattern: /\b(?:case|docket)[\s#:]*[\w-]+\b/gi, replacement: '[CASE]' },
]

/**
 * 场景感知消息适配器
 *
 * 在标准 MessageConverter 基础上，增加场景策略：
 * - 用户输入脱敏（法律/医疗场景）
 * - 工具结果截断（避免上下文溢出）
 * - 合规提示注入（法律/医疗场景）
 * - reasoning_content 保留策略
 * - 审计日志记录
 */
export class ScenarioMessageAdapter {
  private readonly converter: MessageConverter
  private currentDomain: ScenarioDomain = 'general'

  constructor(converter: MessageConverter = new MessageConverter()) {
    this.converter = converter
  }

  /**
   * 设置当前场景
   */
  setScenario(domain: ScenarioDomain): void {
    this.currentDomain = domain
  }

  /**
   * 获取当前场景策略
   */
  getPolicy(): ScenarioMessagePolicy {
    return SCENARIO_MESSAGE_POLICIES[this.currentDomain]
  }

  /**
   * 场景感知的消息转换
   */
  convert(messages: LLMMessage[], systemPrompt?: string): ModelMessage[] {
    const policy = SCENARIO_MESSAGE_POLICIES[this.currentDomain]

    // 1. 应用场景策略处理消息
    const processedMessages = messages.map((msg) => this.applyScenarioPolicy(msg, policy))

    // 2. 注入合规提示
    const finalSystemPrompt = this.injectCompliance(systemPrompt, policy)

    // 3. 审计日志
    if (policy.enableAudit) {
      this.logAudit('convert_messages', {
        domain: policy.domain,
        inputCount: messages.length,
        outputCount: processedMessages.length,
        hasSystemPrompt: !!finalSystemPrompt,
      })
    }

    // 4. 委托给标准转换器
    return this.converter.convert(processedMessages, finalSystemPrompt)
  }

  /**
   * 应用场景策略到单条消息
   */
  private applyScenarioPolicy(msg: LLMMessage, policy: ScenarioMessagePolicy): LLMMessage {
    let processed = { ...msg }

    // 用户消息脱敏
    if (policy.sanitizeUserInput && msg.role === 'user') {
      processed = this.sanitizeMessage(processed)
    }

    // 工具结果截断
    if (policy.truncateToolResults && msg.role === 'tool') {
      processed = this.truncateToolResult(processed, policy.maxToolResultChars)
    }

    // reasoning_content 保留策略
    if (!policy.preserveReasoning && processed.reasoning_content) {
      delete processed.reasoning_content
    }

    return processed
  }

  /**
   * 脱敏消息内容
   */
  private sanitizeMessage(msg: LLMMessage): LLMMessage {
    if (typeof msg.content === 'string') {
      return {
        ...msg,
        content: this.sanitizeText(msg.content),
      }
    }
    return msg
  }

  /**
   * 脱敏文本
   */
  private sanitizeText(text: string): string {
    let result = text
    for (const { pattern, replacement } of SENSITIVE_DATA_PATTERNS) {
      result = result.replace(pattern, replacement)
    }
    return result
  }

  /**
   * 截断工具结果
   */
  private truncateToolResult(msg: LLMMessage, maxChars: number): LLMMessage {
    const content = typeof msg.content === 'string' ? msg.content : ''
    if (content.length <= maxChars) {
      return msg
    }

    return {
      ...msg,
      content:
        content.slice(0, maxChars) +
        `\n\n[Tool result truncated by scenario policy: ${content.length - maxChars} chars omitted]`,
    }
  }

  /**
   * 注入合规提示
   */
  private injectCompliance(
    systemPrompt: string | undefined,
    policy: ScenarioMessagePolicy,
  ): string | undefined {
    if (!policy.injectCompliancePrompt || !policy.compliancePrompt) {
      return systemPrompt
    }

    if (!systemPrompt) {
      return policy.compliancePrompt
    }

    return `${systemPrompt}\n\n---\n${policy.compliancePrompt}`
  }

  /**
   * 审计日志
   */
  private logAudit(action: string, details: Record<string, unknown>): void {
    console.log(`[MSG-AUDIT] [${action}]`, JSON.stringify(details))
  }

  /**
   * 获取基础转换器
   */
  getConverter(): MessageConverter {
    return this.converter
  }
}

/**
 * 创建场景感知消息适配器
 */
export function createScenarioMessageAdapter(
  converter?: MessageConverter,
): ScenarioMessageAdapter {
  return new ScenarioMessageAdapter(converter)
}
