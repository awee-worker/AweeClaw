import { api } from '../../../adapters/electronBridge'
import { logger } from '@toolkit/LogEngine'
import { useStore } from '@store'
import { joinPath } from '@shared/toolkit/pathHelper'
import { BRAND } from '@shared/brand'
import { reflectiveDreamingService } from './reflectiveDreamingService'
import { computeImportance } from '../knowledgeService/scoring'
import {
  type MemoryEntry,
  type MemoryEntryInput,
  type MemorySearchParams,
  type MemorySearchResult,
  type MemoryStore,
  type MemorySource,
  type MemoryStatus,
  type MemoryRetrievalContext,
  type TaskType,
} from '@intelligence/providerTypes'

const CURRENT_VERSION = 1
const MAX_SHORT_TERM = 500
const MAX_LONG_TERM = 200
const FILE_PATH = BRAND.paths.memoryStore
const OLD_KNOWLEDGE_CONV_FILE = BRAND.paths.knowledgeConversation

class LongTermMemoryService {
  private cache: MemoryStore | null = null

  async getEntries(status?: MemoryStatus): Promise<MemoryEntry[]> {
    const store = await this.loadStore()
    if (status === 'short_term') return store.shortTerm
    if (status === 'long_term') return store.longTerm
    if (status === 'forgotten') return store.forgotten
    return [...store.shortTerm, ...store.longTerm]
  }

  async getEnabledEntries(): Promise<MemoryEntry[]> {
    const all = await this.getEntries()
    return all.filter(e => e.enabled)
  }

  async getEntry(id: string): Promise<MemoryEntry | null> {
    const all = await this.getEntries()
    return all.find(e => e.id === id) ?? null
  }

  async addEntry(input: MemoryEntryInput): Promise<MemoryEntry> {
    const content = input.content.trim()
    if (!content) throw new Error('Content cannot be empty')

    const store = await this.loadStore()
    const status = input.status ?? 'short_term'
    const list = this.getList(store, status)

    const exactMatch = list.find(e => e.content.trim() === content)
    if (exactMatch) return exactMatch

    const normalizedContent = this.normalizeForDedup(content)
    const nearDuplicate = [...store.shortTerm, ...store.longTerm].find(e => {
      if (!e.enabled || e.verificationStatus === 'superseded') return false
      const normalized = this.normalizeForDedup(e.content.trim())
      if (normalized === normalizedContent) return true
      return this.computeSimilarity(normalized, normalizedContent) > 0.9
    })

    if (nearDuplicate) {
      const mergedTags = [...new Set([...nearDuplicate.tags, ...(input.tags ?? [])])]
      const mergedConfidence = Math.max(nearDuplicate.confidence, input.confidence ?? 0.7)
      await this.updateEntry(nearDuplicate.id, {
        tags: mergedTags,
        confidence: mergedConfidence,
      })
      logger.agent.info(`[LongTermMemory] Merged near-duplicate into existing entry: ${nearDuplicate.id}`)
      return { ...nearDuplicate, tags: mergedTags, confidence: mergedConfidence }
    }

    const now = Date.now()
    const entry: MemoryEntry = {
      id: crypto.randomUUID(),
      content,
      source: input.source ?? 'auto_extracted',
      status,
      confidence: input.confidence ?? 0.7,
      recallCount: 0,
      uniqueQueryCount: 0,
      lastRecalledAt: now,
      halfLifeDays: 14,
      tags: input.tags ?? [],
      enabled: input.enabled ?? true,
      createdAt: now,
      updatedAt: now,
      originalSessionId: input.originalSessionId,
      correctionChain: input.correctionChain,
      derivedFrom: input.derivedFrom,
      verificationStatus: input.verificationStatus ?? 'unverified',
    }

    if (input.supersedeId) {
      const superseded = this.findById(store, input.supersedeId)
      if (superseded) {
        superseded.correctionChain = {
          supersededBy: entry.id,
          supersededAt: now,
          reason: input.supersedeReason ?? 'corrected',
        }
        superseded.verificationStatus = 'superseded'
        superseded.enabled = false
        superseded.updatedAt = now
        entry.derivedFrom = [input.supersedeId]
        entry.verificationStatus = 'verified'
        entry.source = input.source ?? 'self_correction'
        logger.agent.info(`[LongTermMemory] Superseded entry ${input.supersedeId} with ${entry.id}`)
      }
    }

    list.unshift(entry)
    this.trimList(list, status === 'short_term' ? MAX_SHORT_TERM : MAX_LONG_TERM)

    await this.saveStore(store)
    logger.agent.info('[LongTermMemory] Added entry:', entry.id, 'status:', status)
    return entry
  }

  async updateEntry(
    id: string,
    updates: Partial<Pick<MemoryEntry, 'content' | 'tags' | 'enabled' | 'confidence' | 'status' | 'verificationStatus'>>
  ): Promise<boolean> {
    const store = await this.loadStore()
    const entry = this.findById(store, id)
    if (!entry) return false

    if (updates.content !== undefined) entry.content = updates.content.trim()
    if (updates.tags !== undefined) entry.tags = updates.tags
    if (updates.enabled !== undefined) entry.enabled = updates.enabled
    if (updates.confidence !== undefined) entry.confidence = Math.min(1, Math.max(0, updates.confidence))
    if (updates.verificationStatus !== undefined) entry.verificationStatus = updates.verificationStatus

    if (updates.status !== undefined && updates.status !== entry.status) {
      const oldList = this.getList(store, entry.status)
      const idx = oldList.findIndex(e => e.id === id)
      if (idx !== -1) {
        oldList.splice(idx, 1)
        entry.status = updates.status
        entry.updatedAt = Date.now()
        const newList = this.getList(store, updates.status)
        newList.push(entry)
        await this.saveStore(store)
        return true
      }
    } else {
      entry.updatedAt = Date.now()
    }

    await this.saveStore(store)
    return true
  }

  async deleteEntry(id: string): Promise<boolean> {
    const store = await this.loadStore()
    for (const list of [store.shortTerm, store.longTerm, store.forgotten]) {
      const idx = list.findIndex(e => e.id === id)
      if (idx !== -1) {
        list.splice(idx, 1)
        await this.saveStore(store)
        return true
      }
    }
    return false
  }

  async recordRecall(id: string, query: string): Promise<void> {
    const store = await this.loadStore()
    const entry = this.findById(store, id)
    if (!entry) return

    entry.recallCount++
    entry.lastRecalledAt = Date.now()

    const q = query.toLowerCase().trim()
    if (q && !entry.tags.some(t => t.toLowerCase() === q)) {
      const existingQueries = new Set(
        Array.from({ length: entry.uniqueQueryCount }, (_, i) => `q${i}`)
      )
      if (!existingQueries.has(q)) {
        entry.uniqueQueryCount++
      }
    }

    await this.saveStore(store)
  }

  async recordBulkRecall(ids: string[]): Promise<void> {
    if (ids.length === 0) return
    const store = await this.loadStore()
    const now = Date.now()
    let changed = false

    for (const id of ids) {
      const entry = this.findById(store, id)
      if (!entry) continue
      entry.recallCount++
      entry.lastRecalledAt = now
      changed = true
    }

    if (changed) await this.saveStore(store)
  }

  async search(params: MemorySearchParams): Promise<MemorySearchResult[]> {
    const entries = await this.getEntries(params.status)
    const query = params.query.toLowerCase()

    const results: MemorySearchResult[] = entries
      .filter(e => e.enabled && e.verificationStatus !== 'superseded')
      .map(entry => {
        let score = 0
        const contentLower = entry.content.toLowerCase()

        if (contentLower.includes(query)) score += 5
        for (const word of query.split(/\s+/)) {
          if (word.length < 2) continue
          if (contentLower.includes(word)) score += 2
        }
        for (const tag of entry.tags) {
          if (tag.toLowerCase().includes(query)) score += 2
          if (query.includes(tag.toLowerCase())) score += 1
        }

        score += entry.confidence * 2
        score += Math.min(entry.recallCount * 0.5, 5)
        const recencyBoost = Math.max(0, 1 - (Date.now() - entry.lastRecalledAt) / (entry.halfLifeDays * 86_400_000))
        score += recencyBoost * 2

        if (entry.status === 'long_term') score += 3

        if (entry.verificationStatus === 'verified') score += 1.5
        if (entry.verificationStatus === 'contradicted') score -= 2
        if (entry.source === 'self_correction') score += 0.5

        const importance = computeImportance({
          source: entry.source,
          verificationStatus: entry.verificationStatus ?? 'unverified',
          recallCount: entry.recallCount,
          derivedFromCount: entry.derivedFrom?.length ?? 0,
          tagsCount: entry.tags.length,
          createdAtMs: entry.createdAt,
          lastRecalledAtMs: entry.lastRecalledAt,
          content: entry.content,
          confidence: entry.confidence,
        })
        score += importance * 3

        return { entry, score }
      })
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)

    return params.limit ? results.slice(0, params.limit) : results
  }

  async contextAwareSearch(context: MemoryRetrievalContext, limit: number = 10): Promise<MemorySearchResult[]> {
    const baseResults = await this.search({ query: context.query, limit: limit * 2 })

    const enrichedResults = baseResults.map(result => {
      let contextScore = result.score
      const entry = result.entry

      if (context.taskType) {
        const taskTagMap: Record<TaskType, string[]> = {
          coding: ['code', 'implementation', 'component', 'function'],
          debugging: ['error', 'bug', 'fix', 'debug', 'error_solution'],
          refactoring: ['refactor', 'improve', 'optimize', 'clean'],
          architecture: ['architecture', 'design', 'pattern', 'structure'],
          testing: ['test', 'spec', 'coverage', 'assertion'],
          documentation: ['doc', 'readme', 'comment', 'documentation'],
          general: [],
        }
        const taskTags = taskTagMap[context.taskType] ?? []
        const tagMatch = entry.tags.some(t => taskTags.some(tt => t.toLowerCase().includes(tt)))
        if (tagMatch) contextScore += 2
      }

      if (context.currentFile) {
        const fileName = context.currentFile.split('/').pop()?.toLowerCase() ?? ''
        const fileParts = fileName.replace(/\.[^.]+$/, '').split(/[-_.]/)
        const contentLower = entry.content.toLowerCase()
        const fileMatch = fileParts.some(part => part.length > 2 && contentLower.includes(part))
        if (fileMatch) contextScore += 1.5
      }

      if (context.errorContext) {
        const errorTags = ['error', 'fix', 'solution', 'debug', 'error_solution', 'correction']
        const hasErrorTag = entry.tags.some(t => errorTags.some(et => t.toLowerCase().includes(et)))
        if (hasErrorTag) contextScore += 3
      }

      if (context.recentTopics && context.recentTopics.length > 0) {
        const topicMatch = context.recentTopics.some(topic =>
          entry.content.toLowerCase().includes(topic.toLowerCase()) ||
          entry.tags.some(t => t.toLowerCase().includes(topic.toLowerCase()))
        )
        if (topicMatch) contextScore += 1
      }

      return { entry, score: contextScore }
    })

    return enrichedResults
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  }

  async promoteToLongTerm(id: string): Promise<boolean> {
    const store = await this.loadStore()
    const idx = store.shortTerm.findIndex(e => e.id === id)
    if (idx === -1) return false

    const entry = store.shortTerm.splice(idx, 1)[0]
    entry.status = 'long_term'
    entry.promotedAt = Date.now()
    entry.updatedAt = Date.now()
    store.longTerm.unshift(entry)
    this.trimList(store.longTerm, MAX_LONG_TERM)

    await this.saveStore(store)
    logger.agent.info('[LongTermMemory] Promoted to long_term:', id)
    return true
  }

  async forget(id: string): Promise<boolean> {
    const store = await this.loadStore()
    for (const [sourceList, ] of [
      [store.shortTerm, 'short_term'],
      [store.longTerm, 'long_term'],
    ] as const) {
      const idx = sourceList.findIndex(e => e.id === id)
      if (idx !== -1) {
        const entry = sourceList.splice(idx, 1)[0]
        entry.status = 'forgotten'
        entry.updatedAt = Date.now()
        store.forgotten.push(entry)
        await this.saveStore(store)
        return true
      }
    }
    return false
  }

  async supersedeEntry(oldId: string, newContent: string, reason: string, options?: { source?: MemorySource; tags?: string[]; confidence?: number }): Promise<MemoryEntry | null> {
    const store = await this.loadStore()
    const oldEntry = this.findById(store, oldId)
    if (!oldEntry) return null

    const newEntry = await this.addEntry({
      content: newContent,
      source: options?.source ?? 'self_correction',
      status: oldEntry.status === 'long_term' ? 'long_term' : 'short_term',
      confidence: options?.confidence ?? Math.min(1, oldEntry.confidence + 0.1),
      tags: options?.tags ?? oldEntry.tags,
      supersedeId: oldId,
      supersedeReason: reason,
    })

    return newEntry
  }

  async findContradictions(): Promise<Array<{ entryA: MemoryEntry; entryB: MemoryEntry; similarity: number }>> {
    const entries = await this.getEntries()
    const active = entries.filter(e => e.enabled && e.verificationStatus !== 'superseded')
    const contradictions: Array<{ entryA: MemoryEntry; entryB: MemoryEntry; similarity: number }> = []

    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const a = active[i]
        const b = active[j]
        const tagOverlap = a.tags.filter(t => b.tags.includes(t)).length
        if (tagOverlap < 1) continue

        const similarity = this.computeSimilarity(a.content, b.content)
        if (similarity > 0.4 && similarity < 0.8) {
          contradictions.push({ entryA: a, entryB: b, similarity })
        }
      }
    }

    return contradictions.sort((a, b) => b.similarity - a.similarity).slice(0, 20)
  }

  async getCorrectionChain(id: string): Promise<MemoryEntry[]> {
    const chain: MemoryEntry[] = []
    let currentId: string | undefined = id

    while (currentId) {
      const entry = await this.getEntry(currentId)
      if (!entry) break
      chain.push(entry)
      currentId = entry.correctionChain?.supersededBy
    }

    return chain
  }

  async runDeepPromotion(): Promise<{ promoted: number; forgotten: number }> {
    const store = await this.loadStore()
    const now = Date.now()
    let promoted = 0
    let forgotten = 0

    const candidates = [...store.shortTerm]
    for (const entry of candidates) {
      const ageDays = (now - entry.createdAt) / 86_400_000
      const recencyFactor = Math.pow(0.5, ageDays / 14)
      const score =
        (entry.recallCount / Math.max(1, ageDays)) * 0.3 +
        (entry.uniqueQueryCount / Math.max(1, ageDays)) * 0.2 +
        entry.confidence * 0.3 +
        recencyFactor * 0.2

      const isUserStated = entry.tags.includes('user-stated') || entry.source === 'user'
      const promoteThreshold = isUserStated ? 0.4 : 0.6
      const recallThreshold = isUserStated ? 1 : 2
      const uniqueQueryThreshold = isUserStated ? 0 : 1

      if (score >= promoteThreshold && entry.recallCount >= recallThreshold && entry.uniqueQueryCount >= uniqueQueryThreshold) {
        const idx = store.shortTerm.findIndex(e => e.id === entry.id)
        if (idx !== -1) {
          store.shortTerm.splice(idx, 1)
          entry.status = 'long_term'
          entry.promotedAt = now
          entry.updatedAt = now
          store.longTerm.unshift(entry)
          promoted++
        }
      } else if (ageDays > 60 && entry.recallCount === 0 && entry.confidence < 0.6) {
        const idx = store.shortTerm.findIndex(e => e.id === entry.id)
        if (idx !== -1) {
          store.shortTerm.splice(idx, 1)
          entry.status = 'forgotten'
          entry.updatedAt = now
          store.forgotten.push(entry)
          forgotten++
        }
      }
    }

    this.trimList(store.longTerm, MAX_LONG_TERM)

    if (promoted > 0 || forgotten > 0) {
      await this.saveStore(store)
      logger.agent.info(`[LongTermMemory] Deep promotion: ${promoted} promoted, ${forgotten} forgotten`)
    }

    return { promoted, forgotten }
  }

  async runLightDreaming(): Promise<{ merged: number; pruned: number }> {
    const store = await this.loadStore()
    let merged = 0
    let pruned = 0

    const duplicates = this.findDuplicates(store.shortTerm)
    for (const group of duplicates) {
      if (group.length < 2) continue
      const best = group.reduce((a, b) => (a.confidence >= b.confidence ? a : b))
      for (const entry of group) {
        if (entry.id === best.id) continue
        if (entry.recallCount > best.recallCount) {
          best.recallCount = entry.recallCount
        }
        if (entry.uniqueQueryCount > best.uniqueQueryCount) {
          best.uniqueQueryCount = entry.uniqueQueryCount
        }
        for (const tag of entry.tags) {
          if (!best.tags.includes(tag)) best.tags.push(tag)
        }
        const idx = store.shortTerm.findIndex(e => e.id === entry.id)
        if (idx !== -1) {
          store.shortTerm.splice(idx, 1)
          merged++
        }
      }
      best.updatedAt = Date.now()
    }

    const now = Date.now()
    const toPrune: number[] = []
    for (let i = store.shortTerm.length - 1; i >= 0; i--) {
      const entry = store.shortTerm[i]
      const ageDays = (now - entry.createdAt) / 86_400_000
      if (ageDays > 60 && entry.recallCount === 0 && entry.confidence < 0.5) {
        toPrune.push(i)
      }
    }
    for (const idx of toPrune) {
      const entry = store.shortTerm.splice(idx, 1)[0]
      entry.status = 'forgotten'
      entry.updatedAt = now
      store.forgotten.push(entry)
      pruned++
    }

    if (merged > 0 || pruned > 0) {
      this.trimList(store.shortTerm, MAX_SHORT_TERM)
      await this.saveStore(store)
      logger.agent.info(`[LongTermMemory] Light dreaming: ${merged} merged, ${pruned} pruned`)
    }

    return { merged, pruned }
  }

  async runRemDreaming(): Promise<{ consolidated: number; insights: number; contradictions: number }> {
    const store = await this.loadStore()
    const longTerm = store.longTerm
    if (longTerm.length < 2) return { consolidated: 0, insights: 0, contradictions: 0 }

    const now = Date.now()
    let consolidated = 0
    let insights = 0
    let contradictions = 0
    const toRemove = new Set<string>()

    const activeEntries = longTerm.filter(e => e.enabled && e.verificationStatus !== 'superseded')
    if (activeEntries.length >= 3) {
      try {
        const reflectionResult = await reflectiveDreamingService.reflect(activeEntries)
        insights = reflectionResult.insights.length
        contradictions = reflectionResult.contradictions.length
        for (const id of reflectionResult.supersededIds) {
          toRemove.add(id)
        }
        logger.agent.info(`[LongTermMemory] REM reflection: ${insights} insights, ${contradictions} contradictions`)
      } catch (err) {
        logger.agent.warn('[LongTermMemory] REM reflection failed:', err)
      }
    }

    const groups = this.findRelatedGroups(longTerm.filter(e => !toRemove.has(e.id)))
    for (const group of groups) {
      if (group.length < 2) continue

      const combinedContent = group
        .map(e => e.content)
        .join(' | ')
      if (combinedContent.length > 500) continue

      const bestConfidence = Math.max(...group.map(e => e.confidence))
      const totalRecall = group.reduce((sum, e) => sum + e.recallCount, 0)
      const allTags = [...new Set(group.flatMap(e => e.tags))]

      const consolidatedEntry: MemoryEntry = {
        id: crypto.randomUUID(),
        content: combinedContent,
        source: 'dreaming_rem',
        status: 'long_term',
        confidence: Math.min(1, bestConfidence + 0.1),
        recallCount: totalRecall,
        uniqueQueryCount: group.reduce((sum, e) => sum + e.uniqueQueryCount, 0),
        lastRecalledAt: Math.max(...group.map(e => e.lastRecalledAt)),
        halfLifeDays: 30,
        tags: allTags,
        enabled: true,
        createdAt: Math.min(...group.map(e => e.createdAt)),
        updatedAt: now,
        promotedAt: now,
        derivedFrom: group.map(e => e.id),
        verificationStatus: 'unverified',
      }

      for (const entry of group) {
        toRemove.add(entry.id)
      }

      store.longTerm.push(consolidatedEntry)
      consolidated++
    }

    if (toRemove.size > 0) {
      store.longTerm = store.longTerm.filter(e => !toRemove.has(e.id))
      this.trimList(store.longTerm, MAX_LONG_TERM)
      await this.saveStore(store)
      logger.agent.info(`[LongTermMemory] REM dreaming: ${consolidated} consolidated, ${insights} insights, ${contradictions} contradictions from ${toRemove.size} entries`)
    }

    return { consolidated, insights, contradictions }
  }

  async runDreamingPhase(phase: 'light' | 'rem' | 'deep'): Promise<Record<string, number>> {
    logger.agent.info(`[LongTermMemory] Starting ${phase} dreaming phase...`)

    switch (phase) {
      case 'light': {
        const result = await this.runLightDreaming()
        return { merged: result.merged, pruned: result.pruned }
      }
      case 'rem': {
        const result = await this.runRemDreaming()
        return { consolidated: result.consolidated, insights: result.insights, contradictions: result.contradictions }
      }
      case 'deep': {
        const result = await this.runDeepPromotion()
        return { promoted: result.promoted, forgotten: result.forgotten }
      }
    }
  }

  private findDuplicates(entries: MemoryEntry[]): MemoryEntry[][] {
    const groups: MemoryEntry[][] = []
    const assigned = new Set<string>()

    for (let i = 0; i < entries.length; i++) {
      if (assigned.has(entries[i].id)) continue
      const group: MemoryEntry[] = [entries[i]]
      assigned.add(entries[i].id)

      for (let j = i + 1; j < entries.length; j++) {
        if (assigned.has(entries[j].id)) continue
        if (this.computeSimilarity(entries[i].content, entries[j].content) > 0.8) {
          group.push(entries[j])
          assigned.add(entries[j].id)
        }
      }

      if (group.length > 1) groups.push(group)
    }

    return groups
  }

  private findRelatedGroups(entries: MemoryEntry[]): MemoryEntry[][] {
    const groups: MemoryEntry[][] = []
    const assigned = new Set<string>()

    for (let i = 0; i < entries.length; i++) {
      if (assigned.has(entries[i].id)) continue
      const group: MemoryEntry[] = [entries[i]]
      assigned.add(entries[i].id)

      for (let j = i + 1; j < entries.length; j++) {
        if (assigned.has(entries[j].id)) continue
        const tagOverlap = entries[j].tags.filter(t => entries[i].tags.includes(t)).length
        const contentSimilarity = this.computeSimilarity(entries[i].content, entries[j].content)
        if (tagOverlap >= 2 || contentSimilarity > 0.6) {
          group.push(entries[j])
          assigned.add(entries[j].id)
        }
      }

      if (group.length >= 2) groups.push(group)
    }

    return groups
  }

  private computeSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 2))
    const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 2))
    if (wordsA.size === 0 || wordsB.size === 0) return 0

    let intersection = 0
    for (const w of wordsA) {
      if (wordsB.has(w)) intersection++
    }

    const union = wordsA.size + wordsB.size - intersection
    return union === 0 ? 0 : intersection / union
  }

  private normalizeForDedup(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\w\s\u4e00-\u9fff]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  }

  buildMemoryPrompt(entries: MemoryEntry[], tokenBudget: number = 1000): string {
    const enabled = entries.filter(e => e.enabled && e.content.trim() && e.verificationStatus !== 'superseded')
    if (enabled.length === 0) return ''

    const verifiedFirst = [
      ...enabled.filter(e => e.verificationStatus === 'verified'),
      ...enabled.filter(e => e.verificationStatus !== 'verified'),
    ]
    const longTermFirst = [
      ...verifiedFirst.filter(e => e.status === 'long_term'),
      ...verifiedFirst.filter(e => e.status === 'short_term'),
    ]
    const lines: string[] = []
    let estimatedTokens = 0

    for (const entry of longTermFirst) {
      const line = `- ${entry.content}`
      const lineTokens = Math.ceil(line.length / 4)
      if (estimatedTokens + lineTokens > tokenBudget) break
      lines.push(line)
      estimatedTokens += lineTokens
    }

    if (lines.length === 0) return ''

    return `<memory>
Long-term memory about this project and user:

${lines.join('\n')}
</memory>`
  }

  async clearCache(): Promise<void> {
    this.cache = null
  }

  async migrateFromKnowledgeConversation(): Promise<number> {
    const { workspacePath } = useStore.getState()
    if (!workspacePath) return 0

    const store = await this.loadStore()
    if ((store as any).migratedFromConversation) return 0

    const oldFilePath = joinPath(workspacePath, OLD_KNOWLEDGE_CONV_FILE)
    const oldContent = await api.file.read(oldFilePath)
    if (!oldContent) return 0

    try {
      const oldStore = JSON.parse(oldContent)
      if (!oldStore || !Array.isArray(oldStore.entries)) return 0

      let migrated = 0
      for (const item of oldStore.entries) {
        if (!item.content || typeof item.content !== 'string') continue
        const exists = store.shortTerm.some(e => e.content.trim() === item.content.trim())
        if (exists) continue

        store.shortTerm.push({
          id: item.id || crypto.randomUUID(),
          content: item.content.trim(),
          source: 'auto_extracted',
          status: 'short_term',
          confidence: item.confidence ?? 0.7,
          recallCount: item.accessCount ?? 0,
          uniqueQueryCount: 0,
          lastRecalledAt: item.updatedAt ?? Date.now(),
          halfLifeDays: 14,
          tags: item.tags ?? [],
          enabled: item.enabled !== false,
          createdAt: item.createdAt ?? Date.now(),
          updatedAt: Date.now(),
        })
        migrated++
      }

      if (migrated > 0) {
        (store as any).migratedFromConversation = true
        this.trimList(store.shortTerm, MAX_SHORT_TERM)
        await this.saveStore(store)
        logger.agent.info(`[LongTermMemory] Migrated ${migrated} entries from knowledge conversation layer`)
      }

      return migrated
    } catch (err) {
      logger.agent.warn('[LongTermMemory] Failed to migrate conversation data:', err)
      return 0
    }
  }

  private getList(store: MemoryStore, status: MemoryStatus): MemoryEntry[] {
    if (status === 'short_term') return store.shortTerm
    if (status === 'long_term') return store.longTerm
    return store.forgotten
  }

  private findById(store: MemoryStore, id: string): MemoryEntry | null {
    for (const list of [store.shortTerm, store.longTerm, store.forgotten]) {
      const entry = list.find(e => e.id === id)
      if (entry) return entry
    }
    return null
  }

  private trimList(list: MemoryEntry[], max: number): void {
    if (list.length > max) {
      list.splice(max)
    }
  }

  private async loadStore(): Promise<MemoryStore> {
    if (this.cache) return this.cache

    const { workspacePath } = useStore.getState()
    if (!workspacePath) return this.createEmptyStore()

    const filePath = joinPath(workspacePath, FILE_PATH)
    const content = await api.file.read(filePath)
    if (!content) return this.createEmptyStore()

    try {
      const store = this.normalizeStore(JSON.parse(content))
      this.cache = store
      return store
    } catch {
      logger.agent.warn('[LongTermMemory] Failed to parse store')
      return this.createEmptyStore()
    }
  }

  private async saveStore(store: MemoryStore): Promise<void> {
    const { workspacePath } = useStore.getState()
    if (!workspacePath) return

    this.cache = store

    const dir = joinPath(workspacePath, BRAND.paths.memory)
    const filePath = joinPath(workspacePath, FILE_PATH)
    const content = JSON.stringify(store, null, 2)

    await api.file.ensureDir(dir)
    await api.file.write(filePath, content)
  }

  private createEmptyStore(): MemoryStore {
    return { version: CURRENT_VERSION, shortTerm: [], longTerm: [], forgotten: [] }
  }

  private normalizeStore(raw: unknown): MemoryStore {
    if (!raw || typeof raw !== 'object') return this.createEmptyStore()

    const c = raw as any
    return {
      version: typeof c.version === 'number' ? c.version : CURRENT_VERSION,
      shortTerm: this.normalizeEntries(c.shortTerm),
      longTerm: this.normalizeEntries(c.longTerm),
      forgotten: this.normalizeEntries(c.forgotten),
    }
  }

  private normalizeEntries(raw: unknown): MemoryEntry[] {
    if (!Array.isArray(raw)) return []
    return raw
      .map(item => this.normalizeEntry(item))
      .filter((e): e is MemoryEntry => e !== null)
  }

  private normalizeEntry(raw: unknown): MemoryEntry | null {
    if (!raw || typeof raw !== 'object') return null
    const c = raw as Partial<MemoryEntry>
    if (typeof c.content !== 'string' || !c.content.trim()) return null

    const now = Date.now()
    return {
      id: typeof c.id === 'string' && c.id ? c.id : crypto.randomUUID(),
      content: c.content.trim(),
      source: (['auto_extracted', 'user', 'dreaming_light', 'dreaming_deep', 'dreaming_rem'] as const).includes(c.source as any)
        ? c.source as MemorySource : 'auto_extracted',
      status: (['short_term', 'long_term', 'forgotten'] as const).includes(c.status as any)
        ? c.status as MemoryStatus : 'short_term',
      confidence: typeof c.confidence === 'number' ? Math.min(1, Math.max(0, c.confidence)) : 0.7,
      recallCount: typeof c.recallCount === 'number' ? c.recallCount : 0,
      uniqueQueryCount: typeof c.uniqueQueryCount === 'number' ? c.uniqueQueryCount : 0,
      lastRecalledAt: typeof c.lastRecalledAt === 'number' ? c.lastRecalledAt : now,
      halfLifeDays: typeof c.halfLifeDays === 'number' ? c.halfLifeDays : 14,
      tags: Array.isArray(c.tags) ? c.tags.filter((t: any) => typeof t === 'string') : [],
      enabled: c.enabled !== false,
      createdAt: typeof c.createdAt === 'number' ? c.createdAt : now,
      updatedAt: typeof c.updatedAt === 'number' ? c.updatedAt : now,
      promotedAt: typeof c.promotedAt === 'number' ? c.promotedAt : undefined,
      expiresAt: typeof c.expiresAt === 'number' ? c.expiresAt : undefined,
      originalSessionId: typeof c.originalSessionId === 'string' ? c.originalSessionId : undefined,
    }
  }
}

export const longTermMemoryService = new LongTermMemoryService()
