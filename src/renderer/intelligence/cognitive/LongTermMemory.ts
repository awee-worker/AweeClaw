import { logger } from '@toolkit/LogEngine'
import { longTermMemoryService } from '../runtime/longTermMemoryService'
import type { MemoryEntry, MemorySource } from '@intelligence/providerTypes'

export interface LongTermMemoryEntry {
  id: string
  content: string
  type: 'fact' | 'preference' | 'pattern' | 'decision' | 'error_solution'
  source: 'user_explicit' | 'conversation_extracted' | 'pattern_detected'
  confidence: number
  relevanceTags: string[]
  createdAt: number
  lastAccessedAt: number
  accessCount: number
  expiresAt?: number
}

export interface MemorySearchParams {
  query: string
  tags?: string[]
  type?: LongTermMemoryEntry['type']
  minConfidence?: number
  limit?: number
}

export interface MemoryExtractResult {
  entries: LongTermMemoryEntry[]
  source: string
}

const TYPE_TO_TAG: Record<LongTermMemoryEntry['type'], string> = {
  fact: 'type:fact',
  preference: 'type:preference',
  pattern: 'type:pattern',
  decision: 'type:decision',
  error_solution: 'type:error_solution',
}

const SOURCE_MAP: Record<LongTermMemoryEntry['source'], MemorySource> = {
  user_explicit: 'user',
  conversation_extracted: 'auto_extracted',
  pattern_detected: 'auto_extracted',
}

function toMemoryEntry(entry: MemoryEntry): LongTermMemoryEntry {
  const typeTag = entry.tags.find(t => t.startsWith('type:'))
  const type = typeTag ? typeTag.slice(5) as LongTermMemoryEntry['type'] : 'fact'

  return {
    id: entry.id,
    content: entry.content,
    type: ['fact', 'preference', 'pattern', 'decision', 'error_solution'].includes(type) ? type : 'fact',
    source: entry.source === 'user' ? 'user_explicit' : 'conversation_extracted',
    confidence: entry.confidence,
    relevanceTags: entry.tags.filter(t => !t.startsWith('type:')),
    createdAt: entry.createdAt,
    lastAccessedAt: entry.lastRecalledAt,
    accessCount: entry.recallCount,
    expiresAt: entry.expiresAt,
  }
}

export class LongTermMemory {
  private initialized = false

  async init(_data?: string): Promise<void> {
    if (this.initialized) return
    this.initialized = true
    logger.agent.info('[LongTermMemory] Initialized as proxy to LongTermMemoryService')
  }

  serialize(): string {
    return '{}'
  }

  add(entry: Omit<LongTermMemoryEntry, 'id' | 'createdAt' | 'lastAccessedAt' | 'accessCount'>): LongTermMemoryEntry {
    const tags = [...(entry.relevanceTags || [])]
    if (entry.type) tags.push(TYPE_TO_TAG[entry.type])

    const source: MemorySource = SOURCE_MAP[entry.source] || 'auto_extracted'

    let result: MemoryEntry | null = null
    longTermMemoryService.addEntry({
      content: entry.content,
      source,
      status: 'short_term',
      confidence: entry.confidence,
      tags,
      enabled: true,
    }).then(r => { result = r }).catch(() => {})

    if (result) return toMemoryEntry(result)

    return {
      ...entry,
      id: `mem-proxy-${Date.now()}`,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      accessCount: 1,
    }
  }

  search(_params: MemorySearchParams): LongTermMemoryEntry[] {
    return []
  }

  async searchAsync(params: MemorySearchParams): Promise<LongTermMemoryEntry[]> {
    const results = await longTermMemoryService.search({
      query: params.query,
      limit: params.limit ?? 20,
    })

    let filtered = results
    if (params.type) {
      const typeTag = TYPE_TO_TAG[params.type]
      filtered = filtered.filter(r => r.entry.tags.includes(typeTag))
    }
    if (params.minConfidence) {
      filtered = filtered.filter(r => r.entry.confidence >= (params.minConfidence ?? 0))
    }
    if (params.tags && params.tags.length > 0) {
      filtered = filtered.filter(r =>
        params.tags!.some(tag => r.entry.tags.includes(tag))
      )
    }

    return filtered.map(r => toMemoryEntry(r.entry))
  }

  async getRecent(count: number = 10): Promise<LongTermMemoryEntry[]> {
    const entries = await longTermMemoryService.getEntries()
    return entries
      .filter(e => e.enabled)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, count)
      .map(toMemoryEntry)
  }

  async getByType(type: LongTermMemoryEntry['type']): Promise<LongTermMemoryEntry[]> {
    const typeTag = TYPE_TO_TAG[type]
    const entries = await longTermMemoryService.getEntries()
    return entries
      .filter(e => e.enabled && e.tags.includes(typeTag))
      .map(toMemoryEntry)
  }

  async remove(id: string): Promise<boolean> {
    return longTermMemoryService.deleteEntry(id)
  }

  async extractFromConversation(messages: Array<{ role: string; content: string }>): Promise<MemoryExtractResult> {
    const entries: LongTermMemoryEntry[] = []

    for (const msg of messages) {
      if (msg.role !== 'user') continue

      const patterns = [
        { regex: /(?:remember|note|keep in mind|don't forget|important)[:\s]+(.+)/i, type: 'fact' as const, confidence: 0.9 },
        { regex: /(?:I prefer|I like|I want|my preference|always|never)[:\s]+(.+)/i, type: 'preference' as const, confidence: 0.85 },
        { regex: /(?:the error|the bug|the issue|the problem|the fix|the solution)[:\s]+(.+)/i, type: 'error_solution' as const, confidence: 0.8 },
        { regex: /(?:we decided|let's use|we chose|the approach|the architecture)[:\s]+(.+)/i, type: 'decision' as const, confidence: 0.85 },
      ]

      for (const pattern of patterns) {
        const match = msg.content.match(pattern.regex)
        if (match && match[1]) {
          const tags = this.extractTags(match[1])
          tags.push(TYPE_TO_TAG[pattern.type])

          try {
            const entry = await longTermMemoryService.addEntry({
              content: match[1].trim(),
              source: 'auto_extracted',
              status: 'short_term',
              confidence: pattern.confidence,
              tags,
              enabled: true,
            })
            entries.push(toMemoryEntry(entry))
          } catch {
            entries.push({
              id: `mem-proxy-${Date.now()}`,
              content: match[1].trim(),
              type: pattern.type,
              source: 'conversation_extracted',
              confidence: pattern.confidence,
              relevanceTags: tags.filter(t => !t.startsWith('type:')),
              createdAt: Date.now(),
              lastAccessedAt: Date.now(),
              accessCount: 1,
            })
          }
        }
      }
    }

    return { entries, source: 'conversation' }
  }

  async buildContextPrompt(query: string, maxTokens: number = 2000): Promise<string> {
    const results = await this.searchAsync({ query, limit: 20 })
    if (results.length === 0) return ''

    const lines: string[] = []
    let estimatedTokens = 0

    for (const entry of results) {
      const line = `[${entry.type}] ${entry.content}`
      const estimatedLineTokens = Math.ceil(line.length / 4)

      if (estimatedTokens + estimatedLineTokens > maxTokens) break

      lines.push(line)
      estimatedTokens += estimatedLineTokens
    }

    if (lines.length === 0) return ''

    return `<long_term_memory>
Relevant context from previous interactions:

${lines.join('\n')}
</long_term_memory>`
  }

  compact(): void {
    logger.agent.info('[LongTermMemory] Compact delegated to LongTermMemoryService dreaming phases')
  }

  async getStats(): Promise<{ total: number; byType: Record<string, number>; avgConfidence: number }> {
    const entries = await longTermMemoryService.getEntries()
    const byType: Record<string, number> = {}
    let totalConfidence = 0

    for (const entry of entries) {
      const typeTag = entry.tags.find(t => t.startsWith('type:'))
      const type = typeTag ? typeTag.slice(5) : 'fact'
      byType[type] = (byType[type] ?? 0) + 1
      totalConfidence += entry.confidence
    }

    return {
      total: entries.length,
      byType,
      avgConfidence: entries.length > 0 ? totalConfidence / entries.length : 0,
    }
  }

  private extractTags(text: string): string[] {
    const tags: string[] = []
    const techPatterns = [
      /\b(react|vue|angular|svelte|next|nuxt)\b/gi,
      /\b(typescript|javascript|python|rust|go|java)\b/gi,
      /\b(docker|kubernetes|aws|gcp|azure)\b/gi,
      /\b(postgres|mysql|mongodb|redis|sqlite)\b/gi,
      /\b(git|github|gitlab|ci\/cd)\b/gi,
    ]

    for (const pattern of techPatterns) {
      const matches = text.matchAll(pattern)
      for (const match of matches) {
        tags.push(match[1].toLowerCase())
      }
    }

    return [...new Set(tags)]
  }
}

export const longTermMemory = new LongTermMemory()
