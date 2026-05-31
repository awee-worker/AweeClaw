import { logger } from '@toolkit/LogEngine'
import { longTermMemoryService } from '../runtime/longTermMemoryService'
import { knowledgeService } from '../runtime/knowledgeService'
import type { MemorySearchResult, MemoryRetrievalContext } from '@intelligence/providerTypes'
import type { KnowledgeSearchResult, KnowledgeCategory } from '@intelligence/providerTypes'

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

const RRF_K = 60

const LAYER_WEIGHTS: Record<MemoryLayer, number> = {
  working: 1.2,
  short_term: 1.0,
  long_term: 1.1,
  project_knowledge: 0.9,
}

interface RankedItem {
  id: string
  result: UnifiedMemoryResult
}

class MemoryFusionEngine {
  private forgettingConfig: ForgettingCurveConfig = DEFAULT_FORGETTING_CONFIG
  private workingMemory = new Map<string, { content: string; timestamp: number; accessCount: number }>()
  private maxWorkingMemory = 20
  private workingMemoryTTL = 30 * 60 * 1000
  private workingMemoryMaxTokens = 4000
  private workingMemoryUsedTokens = 0

  async search(params: UnifiedSearchParams): Promise<UnifiedMemoryResult[]> {
    const { query, layers, maxTokens = 3000, limit = 20, minConfidence = 0.3, context } = params
    const activeLayers = layers || ['working', 'short_term', 'long_term', 'project_knowledge']

    const rankedLists: RankedItem[][] = []

    if (activeLayers.includes('working')) {
      const workingResults = this.searchWorkingMemory(query)
      rankedLists.push(workingResults.map(r => ({ id: r.id, result: r })))
    }

    if (activeLayers.includes('short_term') || activeLayers.includes('long_term')) {
      const memoryResults = await this.searchMemoryLayer(query, activeLayers, context)
      rankedLists.push(memoryResults.map(r => ({ id: r.id, result: r })))
    }

    if (activeLayers.includes('project_knowledge')) {
      const knowledgeResults = await this.searchKnowledgeLayer(query)
      rankedLists.push(knowledgeResults.map(r => ({ id: r.id, result: r })))
    }

    const fused = this.reciprocalRankFusion(rankedLists)

    const filtered = fused
      .filter(r => r.confidence >= minConfidence)

    const tokenLimited = this.applyTokenBudget(filtered, maxTokens)
    return tokenLimited.slice(0, limit)
  }

  private reciprocalRankFusion(rankedLists: RankedItem[][]): UnifiedMemoryResult[] {
    const rrfScores = new Map<string, number>()
    const resultMap = new Map<string, UnifiedMemoryResult>()

    for (const list of rankedLists) {
      for (let rank = 0; rank < list.length; rank++) {
        const { id, result } = list[rank]
        const layerWeight = LAYER_WEIGHTS[result.layer]
        const rrfContribution = layerWeight / (RRF_K + rank + 1)

        const existing = rrfScores.get(id)
        if (existing !== undefined) {
          rrfScores.set(id, existing + rrfContribution)
        } else {
          rrfScores.set(id, rrfContribution)
          resultMap.set(id, result)
        }
      }
    }

    const fused: UnifiedMemoryResult[] = []
    for (const [id, score] of rrfScores) {
      const result = resultMap.get(id)
      if (!result) continue
      fused.push({ ...result, score })
    }

    return fused.sort((a, b) => b.score - a.score)
  }

  addToWorkingMemory(key: string, content: string): void {
    const tokens = this.estimateTokens(content)

    this.workingMemory.set(key, {
      content,
      timestamp: Date.now(),
      accessCount: 1,
    })
    this.workingMemoryUsedTokens += tokens

    this.evictWorkingMemory()
  }

  getFromWorkingMemory(key: string): string | undefined {
    const entry = this.workingMemory.get(key)
    if (!entry) return undefined

    if (Date.now() - entry.timestamp > this.workingMemoryTTL) {
      this.removeWorkingMemoryEntry(key)
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
    halfLifeExtended: number
  }> {
    if (!this.forgettingConfig.enabled) {
      return { decayed: 0, forgotten: 0, promoted: 0, halfLifeExtended: 0 }
    }

    let decayed = 0
    let forgotten = 0
    let promoted = 0
    let halfLifeExtended = 0

    const entries = await longTermMemoryService.getEntries()
    const now = Date.now()

    for (const entry of entries) {
      if (entry.status === 'forgotten') continue

      const daysSinceLastRecall = (now - entry.lastRecalledAt) / 86_400_000
      const retention = this.computeRetention(entry, daysSinceLastRecall)
      const effectiveConfidence = entry.confidence * retention

      if (effectiveConfidence < this.forgettingConfig.autoForgetThreshold) {
        await longTermMemoryService.forget(entry.id)
        forgotten++
      } else if (effectiveConfidence < this.forgettingConfig.minimumConfidence) {
        await longTermMemoryService.updateEntry(entry.id, {
          confidence: effectiveConfidence,
        })
        decayed++
      }

      if (entry.recallCount > 0 && daysSinceLastRecall < 1) {
        const extensionFactor = 1 + Math.min(entry.recallCount * 0.3, 2.0)
        const newHalfLife = Math.min(entry.halfLifeDays * extensionFactor, 365)
        if (newHalfLife > entry.halfLifeDays * 1.1) {
          await longTermMemoryService.updateEntry(entry.id, {
            confidence: Math.min(1, entry.confidence + 0.02),
          })
          halfLifeExtended++
        }
      }

      if (entry.status === 'short_term' && this.shouldPromote(entry)) {
        await longTermMemoryService.promoteToLongTerm(entry.id)
        promoted++
      }
    }

    this.cleanWorkingMemory()

    if (decayed > 0 || forgotten > 0 || promoted > 0 || halfLifeExtended > 0) {
      logger.agent.info(
        `[MemoryFusion] Ebbinghaus curve: ${decayed} decayed, ${forgotten} forgotten, ${promoted} promoted, ${halfLifeExtended} half-life extended`
      )
    }

    return { decayed, forgotten, promoted, halfLifeExtended }
  }

  private computeRetention(entry: { halfLifeDays: number; recallCount: number }, daysSinceLastRecall: number): number {
    const lambda = Math.log(2) / entry.halfLifeDays
    const baseRetention = Math.exp(-lambda * daysSinceLastRecall)

    const repetitionBonus = Math.min(entry.recallCount * 0.4, 3)
    const effectiveRetention = 1 - (1 - baseRetention) / (1 + repetitionBonus)

    return Math.max(0, Math.min(1, effectiveRetention))
  }

  private shouldPromote(entry: { recallCount: number; confidence: number; source: string; tags: string[] }): boolean {
    const isUserStated = entry.tags.includes('user-stated') || entry.source === 'user'

    if (isUserStated) {
      return entry.recallCount >= 1 && entry.confidence >= 0.6
    }

    return entry.recallCount >= 3 && entry.confidence >= 0.7
  }

  async getMemoriesNeedingReview(limit: number = 5): Promise<Array<{ id: string; content: string; retention: number }>> {
    const entries = await longTermMemoryService.getEntries()
    const now = Date.now()
    const candidates: Array<{ id: string; content: string; retention: number }> = []

    for (const entry of entries) {
      if (entry.status === 'forgotten' || !entry.enabled) continue

      const daysSinceLastRecall = (now - entry.lastRecalledAt) / 86_400_000
      const retention = this.computeRetention(entry, daysSinceLastRecall)

      if (retention < 0.5 && retention > 0.15) {
        candidates.push({ id: entry.id, content: entry.content, retention })
      }
    }

    return candidates.sort((a, b) => a.retention - b.retention).slice(0, limit)
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

  private applyTokenBudget(results: UnifiedMemoryResult[], maxTokens: number): UnifiedMemoryResult[] {
    const limited: UnifiedMemoryResult[] = []
    let usedTokens = 0

    for (const result of results) {
      const tokens = this.estimateTokens(result.content)
      if (usedTokens + tokens > maxTokens) break
      limited.push(result)
      usedTokens += tokens
    }

    return limited
  }

  private estimateTokens(text: string): number {
    const cjkChars = (text.match(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/g) || []).length
    const otherChars = text.length - cjkChars
    return Math.ceil(cjkChars / 1.5 + otherChars / 4)
  }

  private evictWorkingMemory(): void {
    this.cleanWorkingMemory()

    while (this.workingMemoryUsedTokens > this.workingMemoryMaxTokens && this.workingMemory.size > 0) {
      const entries = Array.from(this.workingMemory.entries())
        .map(([key, entry]) => ({
          key,
          entry,
          score: entry.accessCount * 0.4 + this.recencyScore(entry.timestamp) * 0.6,
        }))
        .sort((a, b) => a.score - b.score)

      const [victim] = entries
      if (victim) {
        this.removeWorkingMemoryEntry(victim.key)
      } else {
        break
      }
    }

    if (this.workingMemory.size > this.maxWorkingMemory * 2) {
      const entries = Array.from(this.workingMemory.entries())
        .sort(([, a], [, b]) => a.timestamp - b.timestamp)

      while (this.workingMemory.size > this.maxWorkingMemory) {
        const [key] = entries.shift()!
        this.removeWorkingMemoryEntry(key)
      }
    }
  }

  private recencyScore(timestamp: number): number {
    const ageMs = Date.now() - timestamp
    return Math.max(0, 1 - ageMs / this.workingMemoryTTL)
  }

  private removeWorkingMemoryEntry(key: string): void {
    const entry = this.workingMemory.get(key)
    if (entry) {
      this.workingMemoryUsedTokens -= this.estimateTokens(entry.content)
      this.workingMemory.delete(key)
    }
  }

  private cleanWorkingMemory(): void {
    const now = Date.now()
    for (const [key, entry] of this.workingMemory) {
      if (now - entry.timestamp > this.workingMemoryTTL) {
        this.removeWorkingMemoryEntry(key)
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
