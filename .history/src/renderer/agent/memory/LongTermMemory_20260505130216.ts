import { logger } from '@utils/Logger'

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

interface MemoryStore {
  version: number
  entries: LongTermMemoryEntry[]
  lastCompactedAt: number
}

const MAX_ENTRIES = 500
const CONFIDENCE_THRESHOLD = 0.5
const DECAY_FACTOR = 0.95
const COMPACTION_INTERVAL = 86_400_000

export class LongTermMemory {
  private store: MemoryStore = { version: 1, entries: [], lastCompactedAt: 0 }
  private initialized = false

  async init(data?: string): Promise<void> {
    if (this.initialized) return

    if (data) {
      try {
        const parsed = JSON.parse(data)
        this.store = this.normalizeStore(parsed)
      } catch {
        this.store = { version: 1, entries: [], lastCompactedAt: 0 }
      }
    }

    this.initialized = true
    logger.agent.info(`[LongTermMemory] Initialized with ${this.store.entries.length} entries`)
  }

  serialize(): string {
    return JSON.stringify(this.store, null, 2)
  }

  add(entry: Omit<LongTermMemoryEntry, 'id' | 'createdAt' | 'lastAccessedAt' | 'accessCount'>): LongTermMemoryEntry {
    const existing = this.findSimilar(entry.content, entry.type)
    if (existing) {
      existing.confidence = Math.min(1, existing.confidence + 0.1)
      existing.lastAccessedAt = Date.now()
      existing.accessCount++
      return existing
    }

    const newEntry: LongTermMemoryEntry = {
      ...entry,
      id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      accessCount: 1,
    }

    this.store.entries.unshift(newEntry)

    if (this.store.entries.length > MAX_ENTRIES) {
      this.compact()
    }

    return newEntry
  }

  search(params: MemorySearchParams): LongTermMemoryEntry[] {
    const query = params.query.toLowerCase()
    const minConfidence = params.minConfidence ?? CONFIDENCE_THRESHOLD

    let results = this.store.entries.filter(entry => {
      if (params.type && entry.type !== params.type) return false
      if (entry.confidence < minConfidence) return false
      if (entry.expiresAt && entry.expiresAt < Date.now()) return false

      if (params.tags && params.tags.length > 0) {
        const hasTag = params.tags.some(tag => entry.relevanceTags.includes(tag))
        if (!hasTag) return false
      }

      return true
    })

    results = results.map(entry => {
      const contentMatch = entry.content.toLowerCase().includes(query) ? 2 : 0
      const tagMatch = entry.relevanceTags.some(tag => tag.toLowerCase().includes(query)) ? 1 : 0
      const recencyBoost = Math.max(0, 1 - (Date.now() - entry.lastAccessedAt) / (7 * 86_400_000))
      const accessBoost = Math.min(1, entry.accessCount / 10)
      const score = (contentMatch + tagMatch) * entry.confidence + recencyBoost * 0.3 + accessBoost * 0.2

      return { entry, score }
    })
      .sort((a, b) => b.score - a.score)
      .map(r => r.entry)

    if (params.limit) {
      results = results.slice(0, params.limit)
    }

    for (const entry of results) {
      entry.lastAccessedAt = Date.now()
      entry.accessCount++
    }

    return results
  }

  getRecent(count: number = 10): LongTermMemoryEntry[] {
    return this.store.entries
      .filter(e => !e.expiresAt || e.expiresAt > Date.now())
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, count)
  }

  getByType(type: LongTermMemoryEntry['type']): LongTermMemoryEntry[] {
    return this.store.entries.filter(e => e.type === type)
  }

  remove(id: string): boolean {
    const idx = this.store.entries.findIndex(e => e.id === id)
    if (idx === -1) return false
    this.store.entries.splice(idx, 1)
    return true
  }

  extractFromConversation(messages: Array<{ role: string; content: string }>): MemoryExtractResult {
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
          entries.push(this.add({
            content: match[1].trim(),
            type: pattern.type,
            source: 'conversation_extracted',
            confidence: pattern.confidence,
            relevanceTags: this.extractTags(match[1]),
          }))
        }
      }
    }

    return { entries, source: 'conversation' }
  }

  buildContextPrompt(query: string, maxTokens: number = 2000): string {
    const results = this.search({ query, limit: 20 })
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
    const now = Date.now()

    this.store.entries = this.store.entries.filter(entry => {
      if (entry.expiresAt && entry.expiresAt < now) return false
      if (entry.confidence < 0.2) return false
      return true
    })

    for (const entry of this.store.entries) {
      const ageInDays = (now - entry.createdAt) / 86_400_000
      if (ageInDays > 30 && entry.accessCount < 2) {
        entry.confidence *= DECAY_FACTOR
      }
    }

    this.store.entries.sort((a, b) => b.confidence - a.confidence)

    if (this.store.entries.length > MAX_ENTRIES) {
      this.store.entries = this.store.entries.slice(0, MAX_ENTRIES)
    }

    this.store.lastCompactedAt = now
    logger.agent.info(`[LongTermMemory] Compacted to ${this.store.entries.length} entries`)
  }

  getStats(): { total: number; byType: Record<string, number>; avgConfidence: number } {
    const byType: Record<string, number> = {}
    let totalConfidence = 0

    for (const entry of this.store.entries) {
      byType[entry.type] = (byType[entry.type] ?? 0) + 1
      totalConfidence += entry.confidence
    }

    return {
      total: this.store.entries.length,
      byType,
      avgConfidence: this.store.entries.length > 0 ? totalConfidence / this.store.entries.length : 0,
    }
  }

  private findSimilar(content: string, type: string): LongTermMemoryEntry | undefined {
    const normalized = content.toLowerCase().trim()
    return this.store.entries.find(e =>
      e.type === type && e.content.toLowerCase().trim() === normalized
    )
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

  private normalizeStore(raw: unknown): MemoryStore {
    if (!raw || typeof raw !== 'object') {
      return { version: 1, entries: [], lastCompactedAt: 0 }
    }

    const candidate = raw as Partial<MemoryStore>
    const entries = Array.isArray(candidate.entries)
      ? candidate.entries.filter((e: unknown) => this.isValidEntry(e))
      : []

    return {
      version: typeof candidate.version === 'number' ? candidate.version : 1,
      entries,
      lastCompactedAt: typeof candidate.lastCompactedAt === 'number' ? candidate.lastCompactedAt : 0,
    }
  }

  private isValidEntry(e: unknown): boolean {
    if (!e || typeof e !== 'object') return false
    const entry = e as Partial<LongTermMemoryEntry>
    return typeof entry.id === 'string' && typeof entry.content === 'string' && typeof entry.type === 'string'
  }
}

export const longTermMemory = new LongTermMemory()
