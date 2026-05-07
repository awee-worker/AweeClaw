import { logger } from '@utils/Logger'
import { longTermMemoryService } from '../services/longTermMemoryService'
import { knowledgeService } from '../services/knowledgeService'
import type { MemoryEntry, MemorySearchResult, MemoryRetrievalContext } from '../services/longTermMemoryService/types'
import type { KnowledgeEntry, KnowledgeSearchResult, KnowledgeCategory } from '../services/knowledgeService/types'

export type MemoryLayer = 'working' | 'short_term' | 'long_term' | 'project_knowledge'

export interface UnifiedMemoryResult {
  id: string
  content: string
  layer: MemoryLayer
  source: 'memory' | 'knowledge'
  score: number
  confidence: number
  tags: string[]
  createdAt: number
  lastAccessedAt: number
  accessCount: number
  metadata: Record<string, unknown>
}

export interface UnifiedSearchParams {
  query: string
  layers?: MemoryLayer[]
  maxTokens?: number
  limit?: number
  minConfidence?: number
  context?: MemoryRetrievalContext
}

export interface ForgettingCurveConfig {
  enabled: boolean
  reviewIntervalDays: number[]
  decayRate: number
  minimumConfidence: number
  autoForgetThreshold: number
}

const DEFAULT_FORGETTING_CONFIG: ForgettingCurveConfig = {
  enabled: true,
  reviewIntervalDays: [1, 3, 7, 14, 30],
  decayRate: 0.85,
  minimumConfidence: 0.2,
  autoForgetThreshold: 0.15,
}

class MemoryFusionEngine {
  private forgettingConfig: ForgettingCurveConfig = DEFAULT_FORGETTING_CONFIG
  private workingMemory = new Map<string, { content: string; timestamp: number; accessCount: number }>()
  private maxWorkingMemory = 20
  private workingMemoryTTL = 30 * 60 * 1000

  async search(params: UnifiedSearchParams): Promise<UnifiedMemoryResult[]> {
    const { query, layers, maxTokens = 3000, limit = 20, minConfidence = 0.3, context } = params
    const activeLayers = layers || ['working', 'short_term', 'long_term', 'project_knowledge']
    const results: UnifiedMemoryResult[] = []

    if (activeLayers.includes('working')) {
      const workingResults = this.searchWorkingMemory(query)
      results.push(...workingResults)
    }

    if (activeLayers.includes('short_term') || activeLayers.includes('long_term')) {
      const memoryResults = await this.searchMemoryLayer(query, activeLayers, context)
      results.push(...memoryResults)
    }

    if (activeLayers.includes('project_knowledge')) {
      const knowledgeResults = await this.searchKnowledgeLayer(query)
      results.push(...knowledgeResults)
    }

    const deduplicated = this.deduplicateResults(results)

    const filtered = deduplicated
      .filter(r => r.confidence >= minConfidence)
      .sort((a, b) => b.score - a.score)

    const tokenLimited = this.applyTokenBudget(filtered, maxTokens)
    return tokenLimited.slice(0, limit)
  }

  addToWorkingMemory(key: string, content: string): void {
    this.workingMemory.set(key, {
      content,
      timestamp: Date.now(),
      accessCount: 1,
    })
    this.trimWorkingMemory()
  }

  getFromWorkingMemory(key: string): string | undefined {
    const entry = this.workingMemory.get(key)
    if (!entry) return undefined

    if (Date.now() - entry.timestamp > this.workingMemoryTTL) {
      this.workingMemory.delete(key)
      return undefined
    }

    entry.accessCount++
    entry.timestamp = Date.now()
    return entry.content
  }

  async store(content: string, options?: {
    layer?: 'short_term' | 'long_term' | 'project_knowledge'
    tags?: string[]
    confidence?: number
    source?: string
  }): Promise<string> {
    const layer = options?.layer || 'short_term'
    const tags = options?.tags || []
    const confidence = options?.confidence || 0.7

    if (layer === 'project_knowledge') {
      const entry = await knowledgeService.addEntry({
        content,
        tags,
        confidence,
        source: options?.source as any || 'user',
        category: this.inferCategory(content),
      })
      return entry.id
    }

    const entry = await longTermMemoryService.addEntry({
      content,
      tags,
      confidence,
      status: layer,
      source: 'user',
    })
    return entry.id
  }

  async applyForgettingCurve(): Promise<{
    decayed: number
    forgotten: number
    promoted: number
  }> {
    if (!this.forgettingConfig.enabled) {
      return { decayed: 0, forgotten: 0, promoted: 0 }
    }

    let decayed = 0
    let forgotten = 0
    let promoted = 0

    const entries = await longTermMemoryService.getEntries()
    const now = Date.now()

    for (const entry of entries) {
      if (entry.status === 'forgotten') continue

      const ageDays = (now - entry.createdAt) / 86_400_000
      const daysSinceLastRecall = (now - entry.lastRecalledAt) / 86_400_000

      const shouldReview = this.forgettingConfig.reviewIntervalDays.some(interval => {
        const diff = Math.abs(ageDays - interval)
        return diff < 0.5 && daysSinceLastRecall > interval * 0.8
      })

      if (shouldReview && entry.recallCount < 2) {
        const decayFactor = Math.pow(this.forgettingConfig.decayRate, daysSinceLastRecall / 7)
        const newConfidence = entry.confidence * decayFactor

        if (newConfidence < this.forgettingConfig.autoForgetThreshold) {
          await longTermMemoryService.forget(entry.id)
          forgotten++
        } else if (newConfidence < this.forgettingConfig.minimumConfidence) {
          await longTermMemoryService.updateEntry(entry.id, {
            confidence: newConfidence,
          })
          decayed++
        }
      }

      if (entry.status === 'short_term' && entry.recallCount >= 3 && entry.confidence >= 0.7) {
        await longTermMemoryService.promoteToLongTerm(entry.id)
        promoted++
      }
    }

    this.cleanWorkingMemory()

    if (decayed > 0 || forgotten > 0 || promoted > 0) {
      logger.agent.info(`[MemoryFusion] Forgetting curve applied: ${decayed} decayed, ${forgotten} forgotten, ${promoted} promoted`)
    }

    return { decayed, forgotten, promoted }
  }

  async buildUnifiedContextPrompt(query: string, maxTokens: number = 2000): Promise<string> {
    const results = await this.search({
      query,
      maxTokens,
      limit: 30,
    })

    if (results.length === 0) return ''

    const lines: string[] = []
    let estimatedTokens = 0

    for (const result of results) {
      const layerTag = result.layer === 'working' ? '[current]' :
        result.layer === 'short_term' ? '[recent]' :
          result.layer === 'long_term' ? '[remembered]' : '[knowledge]'
      const line = `${layerTag} ${result.content}`
      const lineTokens = Math.ceil(line.length / 4)

      if (estimatedTokens + lineTokens > maxTokens) break

      lines.push(line)
      estimatedTokens += lineTokens
    }

    if (lines.length === 0) return ''

    return `<unified_memory>
Context from memory and knowledge:

${lines.join('\n')}
</unified_memory>`
  }

  async getStats(): Promise<{
    working: number
    shortTerm: number
    longTerm: number
    knowledge: number
    forgotten: number
    avgConfidence: number
  }> {
    const [memoryEntries, knowledgeEntries] = await Promise.all([
      longTermMemoryService.getEntries(),
      knowledgeService.getEntries(),
    ])

    const shortTerm = memoryEntries.filter(e => e.status === 'short_term')
    const longTerm = memoryEntries.filter(e => e.status === 'long_term')
    const forgotten = memoryEntries.filter(e => e.status === 'forgotten')
    const activeEntries = [...shortTerm, ...longTerm]
    const avgConfidence = activeEntries.length > 0
      ? activeEntries.reduce((sum, e) => sum + e.confidence, 0) / activeEntries.length
      : 0

    return {
      working: this.workingMemory.size,
      shortTerm: shortTerm.length,
      longTerm: longTerm.length,
      knowledge: knowledgeEntries.filter(e => e.enabled).length,
      forgotten: forgotten.length,
      avgConfidence,
    }
  }

  updateForgettingConfig(config: Partial<ForgettingCurveConfig>): void {
    this.forgettingConfig = { ...this.forgettingConfig, ...config }
  }

  private searchWorkingMemory(query: string): UnifiedMemoryResult[] {
    const now = Date.now()
    const results: UnifiedMemoryResult[] = []

    for (const [key, entry] of this.workingMemory) {
      if (now - entry.timestamp > this.workingMemoryTTL) continue

      const contentLower = entry.content.toLowerCase()
      const queryLower = query.toLowerCase()
      let score = 0

      if (contentLower.includes(queryLower)) score += 5
      for (const word of queryLower.split(/\s+/)) {
        if (word.length >= 2 && contentLower.includes(word)) score += 2
      }

      if (score > 0) {
        results.push({
          id: `working:${key}`,
          content: entry.content,
          layer: 'working',
          source: 'memory',
          score: score + 3,
          confidence: 1.0,
          tags: [],
          createdAt: entry.timestamp,
          lastAccessedAt: entry.timestamp,
          accessCount: entry.accessCount,
          metadata: {},
        })
      }
    }

    return results
  }

  private async searchMemoryLayer(
    query: string,
    layers: MemoryLayer[],
    context?: MemoryRetrievalContext
  ): Promise<UnifiedMemoryResult[]> {
    let results: MemorySearchResult[] = []

    if (context) {
      results = await longTermMemoryService.contextAwareSearch(context, 30)
    } else {
      results = await longTermMemoryService.search({ query, limit: 30 })
    }

    return results
      .filter(r => {
        if (layers.includes('short_term') && r.entry.status === 'short_term') return true
        if (layers.includes('long_term') && r.entry.status === 'long_term') return true
        return false
      })
      .map(r => ({
        id: r.entry.id,
        content: r.entry.content,
        layer: r.entry.status as MemoryLayer,
        source: 'memory' as const,
        score: r.score,
        confidence: r.entry.confidence,
        tags: r.entry.tags,
        createdAt: r.entry.createdAt,
        lastAccessedAt: r.entry.lastRecalledAt,
        accessCount: r.entry.recallCount,
        metadata: {
          verificationStatus: r.entry.verificationStatus,
          source: r.entry.source,
        },
      }))
  }

  private async searchKnowledgeLayer(query: string): Promise<UnifiedMemoryResult[]> {
    const results: KnowledgeSearchResult[] = await knowledgeService.search({ query, limit: 20 })

    return results.map(r => ({
      id: r.entry.id,
      content: r.entry.content,
      layer: 'project_knowledge' as MemoryLayer,
      source: 'knowledge' as const,
      score: r.score * 0.8,
      confidence: r.entry.confidence,
      tags: r.entry.tags,
      createdAt: r.entry.createdAt,
      lastAccessedAt: r.entry.updatedAt,
      accessCount: r.entry.accessCount,
      metadata: {
        category: r.entry.category,
        starred: r.entry.starred,
        title: r.entry.title,
      },
    }))
  }

  private deduplicateResults(results: UnifiedMemoryResult[]): UnifiedMemoryResult[] {
    const contentMap = new Map<string, UnifiedMemoryResult>()

    const sorted = [...results].sort((a, b) => b.score - a.score)

    for (const result of sorted) {
      const normalizedContent = result.content.toLowerCase().trim()
      const existing = contentMap.get(normalizedContent)

      if (!existing) {
        contentMap.set(normalizedContent, result)
      } else {
        const layerPriority: Record<MemoryLayer, number> = {
          working: 4,
          short_term: 3,
          long_term: 2,
          project_knowledge: 1,
        }
        if (layerPriority[result.layer] > layerPriority[existing.layer]) {
          contentMap.set(normalizedContent, result)
        }
      }
    }

    return Array.from(contentMap.values())
  }

  private applyTokenBudget(results: UnifiedMemoryResult[], maxTokens: number): UnifiedMemoryResult[] {
    const limited: UnifiedMemoryResult[] = []
    let usedTokens = 0

    for (const result of results) {
      const tokens = Math.ceil(result.content.length / 4)
      if (usedTokens + tokens > maxTokens) break
      limited.push(result)
      usedTokens += tokens
    }

    return limited
  }

  private trimWorkingMemory(): void {
    if (this.workingMemory.size <= this.maxWorkingMemory) return

    const entries = Array.from(this.workingMemory.entries())
      .sort(([, a], [, b]) => a.timestamp - b.timestamp)

    while (this.workingMemory.size > this.maxWorkingMemory) {
      const [key] = entries.shift()!
      this.workingMemory.delete(key)
    }
  }

  private cleanWorkingMemory(): void {
    const now = Date.now()
    for (const [key, entry] of this.workingMemory) {
      if (now - entry.timestamp > this.workingMemoryTTL) {
        this.workingMemory.delete(key)
      }
    }
  }

  private inferCategory(content: string): KnowledgeCategory {
    const lower = content.toLowerCase()
    if (lower.includes('error') || lower.includes('bug') || lower.includes('fix')) return 'error-solution'
    if (lower.includes('prefer') || lower.includes('like') || lower.includes('always')) return 'best-practice'
    if (lower.includes('decided') || lower.includes('architecture') || lower.includes('approach')) return 'decision'
    return 'reference'
  }
}

export const memoryFusionEngine = new MemoryFusionEngine()
