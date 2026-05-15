import { Tiktoken, getEncoding } from 'js-tiktoken'

export interface TokenBudget {
  used: number
  total: number
  remaining: number
  utilizationRatio: number
}

export interface ContentPart {
  type: string
  text?: string
  source?: unknown
}

export interface ChatMessage {
  role: string
  content?: string | ContentPart[]
  name?: string
  tool_calls?: Array<{ id: string; name: string; arguments: unknown }>
  tool_call_id?: string
}

const IMAGE_TOKEN_COST = 1600
const MESSAGE_OVERHEAD = 4
const CONVERSATION_BOOKEND = 3
const TOOL_CALL_OVERHEAD = 3
const CHARS_PER_TOKEN_LATIN = 4
const CHARS_PER_TOKEN_CJK = 1.5

let encoderInstance: Tiktoken | null = null

function resolveEncoder(): Tiktoken {
  if (!encoderInstance) {
    encoderInstance = getEncoding('cl100k_base')
  }
  return encoderInstance
}

export function freeEncoder(): void {
  encoderInstance = null
}

function fallbackEstimate(text: string): number {
  if (!text) return 0
  const cjkCount = (text.match(/[\u4e00-\u9fa5\u3040-\u309f\u30a0-\u30ff]/g) || []).length
  const latinCount = text.length - cjkCount
  return Math.ceil(cjkCount / CHARS_PER_TOKEN_CJK + latinCount / CHARS_PER_TOKEN_LATIN)
}

export function countTokens(text: string): number {
  if (!text) return 0
  try {
    return resolveEncoder().encode(text).length
  } catch {
    return fallbackEstimate(text)
  }
}

export function countContentTokens(content: string | ContentPart[]): number {
  if (typeof content === 'string') return countTokens(content)

  let total = 0
  for (const part of content) {
    switch (part.type) {
      case 'text':
        total += part.text ? countTokens(part.text) : 0
        break
      case 'image':
        total += IMAGE_TOKEN_COST
        break
      case 'tool_use':
      case 'tool_result':
        total += countTokens(JSON.stringify(part))
        break
      default:
        total += countTokens(JSON.stringify(part))
    }
  }
  return total
}

export function countMessagesTokens(messages: ChatMessage[]): number {
  let total = CONVERSATION_BOOKEND

  for (const msg of messages) {
    total += MESSAGE_OVERHEAD
    total += countTokens(msg.role)
    if (msg.content) total += countContentTokens(msg.content)
    if (msg.name) total += countTokens(msg.name)
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        total += countTokens(tc.name)
        total += countTokens(JSON.stringify(tc.arguments))
        total += TOOL_CALL_OVERHEAD
      }
    }
    if (msg.tool_call_id) total += countTokens(msg.tool_call_id)
  }

  return total
}

export function computeTokenBudget(messages: ChatMessage[], contextLimit: number): TokenBudget {
  const used = countMessagesTokens(messages)
  return {
    used,
    total: contextLimit,
    remaining: Math.max(0, contextLimit - used),
    utilizationRatio: contextLimit > 0 ? used / contextLimit : 0,
  }
}

export function estimateTokensForText(text: string): number {
  return fallbackEstimate(text)
}
