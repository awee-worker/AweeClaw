/**
 * 伪工具调用检测器
 *
 * 从文本流中识别并提取工具调用，采用状态机模式。
 */

import type { StreamEvent } from '../providerTypes'

interface PseudoToolPayload {
  name: string
  arguments: Record<string, unknown>
}

type DetectionMode = 'json-array' | 'xml-tag'

type DetectorState = 'idle' | 'probing' | 'capturing' | 'disabled'

interface ConsumeResult {
  visibleText: string
  events: StreamEvent[]
}

const TAG_OPEN = String.fromCharCode(60) + 'tool_call' + String.fromCharCode(62)
const TAG_CLOSE = String.fromCharCode(60) + '/tool_call' + String.fromCharCode(62)

function repairTruncatedJsonString(json: string): string {
  let result = json
  let inString = false
  let escape = false
  let lastQuoteIdx = -1

  for (let i = 0; i < result.length; i++) {
    const ch = result[i]
    if (escape) { escape = false; continue }
    if (ch === '\\' && inString) { escape = true; continue }
    if (ch === '"') {
      if (inString) { inString = false } else { inString = true; lastQuoteIdx = i }
    }
  }

  if (inString && lastQuoteIdx >= 0) {
    if (escape) result = result.slice(0, -1)
    result += '"'
  }
  return result
}

function extractFirstJsonObject(text: string): string | null {
  const startIdx = text.indexOf('{')
  if (startIdx === -1) return null
  let depth = 0
  let inString = false
  let escape = false
  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i]
    if (escape) { escape = false; continue }
    if (ch === '\\' && inString) { escape = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === '{') depth++
    else if (ch === '}') { depth--; if (depth === 0) return text.slice(startIdx, i + 1) }
  }
  return null
}

class PayloadParser {
  detectStart(text: string): DetectionMode | null {
    const trimmed = text.trimStart()
    if (!trimmed) return null
    if (trimmed.startsWith(TAG_OPEN)) return 'xml-tag'
    if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) return null
    const probe = trimmed.slice(0, 256)
    if (/"name"\s*:/.test(probe) && /"parameters"\s*:/.test(probe)) return 'json-array'
    return null
  }

  parse(text: string): PseudoToolPayload | null {
    const trimmed = text.trim()
    if (!trimmed) return null
    const payloadText = this.extractPayload(trimmed)
    try {
      const parsed = JSON.parse(payloadText) as unknown
      const candidate = Array.isArray(parsed) ? parsed[0] : parsed
      if (!candidate || typeof candidate !== 'object') return null
      const obj = candidate as Record<string, unknown>
      const name = obj.name
      const parameters = obj.parameters
      if (typeof name !== 'string' || !parameters || typeof parameters !== 'object' || Array.isArray(parameters)) return null
      return { name, arguments: parameters as Record<string, unknown> }
    } catch { return null }
  }

  extractName(text: string): string | null {
    const match = text.match(/"name"\s*:\s*"([^"]+)"/)
    return match?.[1] ?? null
  }

  findParamsStart(text: string): number {
    const keyMatch = /"parameters"\s*:/.exec(text)
    if (!keyMatch) return -1
    return text.indexOf('{', keyMatch.index + keyMatch[0].length)
  }

  findObjectEnd(text: string, startIndex: number): number {
    if (startIndex < 0 || text[startIndex] !== '{') return -1
    let depth = 0
    let inString = false
    let escaped = false
    for (let i = startIndex; i < text.length; i++) {
      const ch = text[i]
      if (inString) {
        if (escaped) { escaped = false; continue }
        if (ch === '\\') { escaped = true; continue }
        if (ch === '"') inString = false
        continue
      }
      if (ch === '"') { inString = true; continue }
      if (ch === '{') { depth++; continue }
      if (ch === '}') { depth--; if (depth === 0) return i }
    }
    return -1
  }

  private extractPayload(trimmed: string): string {
    if (trimmed.startsWith(TAG_OPEN) && trimmed.endsWith(TAG_CLOSE)) {
      return trimmed.slice(TAG_OPEN.length, trimmed.length - TAG_CLOSE.length).trim()
    }
    return trimmed
  }
}

function generateToolCallId(): string {
  return globalThis.crypto?.randomUUID?.() ?? 'compat-tool-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)
}

export class PseudoToolDetector {
  private state: DetectorState = 'idle'
  private probeBuffer = ''
  private captureBuffer = ''
  private toolCallId: string | null = null
  private toolName: string | null = null
  private emittedArgChars = 0
  private started = false
  private completed = false
  private readonly parser = new PayloadParser()

  constructor(private readonly enabled: boolean) {}

  consume(chunk: string): ConsumeResult {
    if (!this.enabled || !chunk || this.state === 'disabled') {
      return { visibleText: chunk, events: [] }
    }
    if (this.state === 'capturing') return this.captureChunk(chunk)
    return this.probe(chunk)
  }

  hasCaptured(): boolean { return this.started }

  finalize(): ConsumeResult {
    if (this.state === 'probing' || this.state === 'idle') {
      const visibleText = this.probeBuffer
      this.probeBuffer = ''
      return { visibleText, events: [] }
    }
    return { visibleText: '', events: [] }
  }

  private probe(chunk: string): ConsumeResult {
    this.probeBuffer += chunk
    const trimmed = this.probeBuffer.trimStart()
    if (trimmed) {
      const firstChar = trimmed[0]
      if (firstChar !== '[' && firstChar !== '{' && firstChar !== '<') {
        return this.disableAndFlush()
      }
    }
    const detected = this.parser.detectStart(this.probeBuffer)
    if (!detected) {
      if (this.isNonToolXml(trimmed)) return this.disableAndFlush()
      if (trimmed && this.probeBuffer.length >= 256) return this.disableAndFlush()
      return { visibleText: '', events: [] }
    }
    this.state = 'capturing'
    this.captureBuffer = this.probeBuffer
    this.probeBuffer = ''
    return this.captureChunk('')
  }

  private captureChunk(chunk: string): ConsumeResult {
    if (chunk) this.captureBuffer += chunk
    const events: StreamEvent[] = []
    const name = this.parser.extractName(this.captureBuffer)
    if (!this.started && name) {
      this.toolCallId = generateToolCallId()
      this.toolName = name
      this.started = true
      events.push({ type: 'tool-call-start', id: this.toolCallId, name })
    }
    this.emitArgDeltas(events)
    if (!this.completed) {
      const parsed = this.parser.parse(this.captureBuffer)
      if (parsed && this.toolCallId) {
        this.completed = true
        events.push({ type: 'tool-call-delta-end', id: this.toolCallId })
        events.push({ type: 'tool-call-available', id: this.toolCallId, name: parsed.name, arguments: parsed.arguments })
      }
    }
    return { visibleText: '', events }
  }

  private emitArgDeltas(events: StreamEvent[]): void {
    if (!this.started || !this.toolCallId) return
    const paramStart = this.parser.findParamsStart(this.captureBuffer)
    if (paramStart < 0) return
    const paramEnd = this.parser.findObjectEnd(this.captureBuffer, paramStart)
    const availableEnd = paramEnd >= 0 ? paramEnd + 1 : this.captureBuffer.length
    if (availableEnd <= paramStart + this.emittedArgChars) return
    const delta = this.captureBuffer.slice(paramStart + this.emittedArgChars, availableEnd)
    this.emittedArgChars += delta.length
    if (delta) {
      events.push({ type: 'tool-call-delta', id: this.toolCallId, name: this.toolName ?? undefined, argumentsDelta: delta })
    }
  }

  private disableAndFlush(): ConsumeResult {
    const visibleText = this.probeBuffer
    this.probeBuffer = ''
    this.state = 'disabled'
    return { visibleText, events: [] }
  }

  private isNonToolXml(trimmed: string): boolean {
    if (!trimmed.startsWith('<')) return false
    const prefix = trimmed.slice(0, Math.min(trimmed.length, TAG_OPEN.length))
    return !TAG_OPEN.startsWith(prefix)
  }
}

export function normalizeToolCallArguments(input: unknown): Record<string, unknown> {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    return input as Record<string, unknown>
  }
  if (typeof input !== 'string' || !input.trim()) return {}
  try {
    const parsed = JSON.parse(input) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch { /* ignore */ }
  return {}
}

export function repairToolCallInput(input: unknown): string | null {
  const inputText = typeof input === 'string' ? input : JSON.stringify(input)
  let fixed = inputText.trim()
  fixed = repairTruncatedJsonString(fixed)
  const openBraces = (fixed.match(/\{/g) || []).length
  const closeBraces = (fixed.match(/\}/g) || []).length
  if (openBraces > closeBraces) fixed += '}'.repeat(openBraces - closeBraces)
  const openBrackets = (fixed.match(/\[/g) || []).length
  const closeBrackets = (fixed.match(/\]/g) || []).length
  if (openBrackets > closeBrackets) fixed += ']'.repeat(openBrackets - closeBrackets)
  try { JSON.parse(fixed) } catch {
    const extracted = extractFirstJsonObject(fixed)
    if (extracted) fixed = extracted
  }
  try { JSON.parse(fixed); return fixed } catch { return null }
}
