/**
 * 长期记忆服务（SQLite 存储）
 *
 * v3.0 重构：从 JSON 文件存储迁移到本地 SQLite 数据库。
 *  - 所有记忆读写均通过 memoryDb IPC 与主进程 SQLite 交互
 *  - 删除原 JSON 文件读写代码（loadStore/saveStore/createEmptyStore）
 *  - 保留全部业务逻辑：搜索、遗忘、dreaming、去重、纠错链等
 *  - 支持从旧 JSON store 一次性迁移到 SQLite
 *
 * 数据流：
 *   渲染进程 → api.memoryDb.* → IPC → MemoryDb (主进程) → SQLite
 */

import { api } from '../../../adapters/electronBridge'
import { logger } from '@toolkit/LogEngine'
import { useStore } from '@store'
import { useSceneModeStore } from '@/renderer/modes/sceneModeStore'
import { joinPath } from '@shared/toolkit/pathHelper'
import { BRAND } from '@shared/brand'
import { reflectiveDreamingService } from './reflectiveDreamingService'
import { computeImportance } from '../knowledgeService/scoring'
import {
  type MemoryEntry,
  type MemoryEntryInput,
  type MemorySearchParams,
  type MemorySearchResult,
  type MemorySource,
  type MemoryStatus,
  type MemoryRetrievalContext,
  type TaskType,
} from '@intelligence/providerTypes'
import { ruleBasedClassify } from '../memoryClassifier'

// 旧 JSON 文件路径（仅用于一次性迁移）
const OLD_FILE_PATH = BRAND.paths.memoryStore
const OLD_KNOWLEDGE_CONV_FILE = BRAND.paths.knowledgeConversation

// SQLite 字段到 MemoryEntry 的映射辅助类型
interface MemoryRow {
  id: string
  user_id: string | null
  conversation_id: string | null
  type: string
  content: string
  summary: string | null
  importance: number
  access_count: number
  last_accessed_at: number | null
  expires_at: number | null
  created_at: number
  updated_at: number
  category: string | null
  subcategory: string | null
  tier: string
  classification_confidence: number
  classified_by: string | null
  classified_at: number | null
  content_hash: string | null
  retention_score: number
  last_reviewed_at: number | null
  review_count: number
  spatial_context: string | null
  tags: string
  enabled: number
  source: string | null
  version: number
  sync_status: string
  remote_id: string | null
  last_synced_at: number | null
}

class LongTermMemoryService {
  private initialized = false

  /** 确保数据库已初始化（幂等） */
  private async ensureDb(): Promise<void> {
    if (this.initialized) return
    const result = await api.memoryDb.initialize()
    if (!result.success) {
      logger.agent.error('[LongTermMemory] SQLite 初始化失败:', result.error)
      throw new Error(`Memory DB 初始化失败: ${result.error}`)
    }
    this.initialized = true
    logger.agent.info('[LongTermMemory] SQLite 已就绪:', result.dbPath)
  }

  /** 将 SQLite 行转换为 MemoryEntry */
  private rowToEntry(row: MemoryRow): MemoryEntry {
    const now = Date.now()
    return {
      id: row.id,
      content: row.content,
      source: this.parseSource(row.source),
      status: this.parseStatus(row.tier),
      confidence: row.importance,
      recallCount: row.access_count,
      uniqueQueryCount: row.review_count,
      lastRecalledAt: row.last_accessed_at ?? now,
      halfLifeDays: 14,
      tags: this.parseTags(row.tags),
      enabled: row.enabled === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      promotedAt: row.classified_at ?? undefined,
      expiresAt: row.expires_at ?? undefined,
      originalSessionId: row.conversation_id ?? undefined,
      verificationStatus: this.parseVerification(row.sync_status),
    }
  }

  private parseSource(s: string | null): MemorySource {
    const valid: MemorySource[] = ['auto_extracted', 'user', 'dreaming_light', 'dreaming_deep', 'dreaming_rem', 'self_reflection', 'self_correction']
    return (s && valid.includes(s as MemorySource)) ? s as MemorySource : 'auto_extracted'
  }

  private parseStatus(tier: string): MemoryStatus {
    if (tier === 'long_term') return 'long_term'
    if (tier === 'forgotten') return 'forgotten'
    return 'short_term'
  }

  private parseVerification(sync: string): 'unverified' | 'verified' | 'contradicted' | 'superseded' {
    if (sync === 'verified') return 'verified'
    if (sync === 'contradicted') return 'contradicted'
    if (sync === 'superseded') return 'superseded'
    return 'unverified'
  }

  private parseTags(raw: string): string[] {
    try {
      const arr = JSON.parse(raw)
      return Array.isArray(arr) ? arr.filter(t => typeof t === 'string') : []
    } catch {
      return []
    }
  }

  /** 将 MemoryEntry 转换为 SQLite 行数据 */
  private entryToRow(entry: MemoryEntry): Record<string, any> {
    // 写入时自动分类（规则引擎，零延迟）
    const classification = ruleBasedClassify(entry.content)
    return {
      id: entry.id,
      user_id: null,
      conversation_id: entry.originalSessionId ?? null,
      type: entry.status === 'long_term' ? 'LONG_TERM' : 'SHORT_TERM',
      content: entry.content,
      summary: null,
      importance: entry.confidence,
      access_count: entry.recallCount,
      last_accessed_at: entry.lastRecalledAt,
      expires_at: entry.expiresAt ?? null,
      created_at: entry.createdAt,
      updated_at: entry.updatedAt,
      category: classification.category,
      subcategory: classification.subcategory,
      tier: entry.status === 'long_term' ? 'long_term' : (entry.status === 'forgotten' ? 'forgotten' : 'short_term'),
      classification_confidence: classification.confidence,
      classified_by: classification.classifiedBy,
      classified_at: entry.createdAt,
      content_hash: null,
      retention_score: 1.0,
      last_reviewed_at: null,
      review_count: entry.uniqueQueryCount,
      spatial_context: null,
      tags: JSON.stringify(entry.tags ?? []),
      enabled: entry.enabled ? 1 : 0,
      source: entry.source,
      version: 1,
      sync_status: entry.verificationStatus ?? 'unverified',
      remote_id: null,
      last_synced_at: null,
    }
  }

  async getEntries(status?: MemoryStatus): Promise<MemoryEntry[]> {
    await this.ensureDb()
    const result = await api.memoryDb.queryEntries({
      tier: status,
      limit: 10000,
    })
    return result.items.map((r: MemoryRow) => this.rowToEntry(r))
  }

  async getEnabledEntries(): Promise<MemoryEntry[]> {
    const all = await this.getEntries()
    return all.filter(e => e.enabled)
  }

  async getEntry(id: string): Promise<MemoryEntry | null> {
    await this.ensureDb()
    const row = await api.memoryDb.getEntryById(id)
    return row ? this.rowToEntry(row as MemoryRow) : null
  }

  async addEntry(input: MemoryEntryInput): Promise<MemoryEntry> {
    const content = input.content.trim()
    if (!content) throw new Error('Content cannot be empty')

    await this.ensureDb()
    const status = input.status ?? 'short_term'

    // 检查精确匹配
    const all = await this.getEntries()
    const exactMatch = all.find(e => e.content.trim() === content)
    if (exactMatch) return exactMatch

    // 检查近似重复
    const normalizedContent = this.normalizeForDedup(content)
    const nearDuplicate = all.find(e => {
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
    const { memoryDomainTag } = useSceneModeStore.getState().getActiveProfile()
    const baseMemoryTags = input.tags ?? []
    // 自动注入当前场景模式记忆域 tag，避免跨域污染
    const tags = baseMemoryTags.some(t => t.startsWith('domain:'))
      ? baseMemoryTags
      : [...baseMemoryTags, memoryDomainTag]
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
      tags,
      enabled: input.enabled ?? true,
      createdAt: now,
      updatedAt: now,
      originalSessionId: input.originalSessionId,
      correctionChain: input.correctionChain,
      derivedFrom: input.derivedFrom,
      verificationStatus: input.verificationStatus ?? 'unverified',
    }

    if (input.supersedeId) {
      const superseded = await this.getEntry(input.supersedeId)
      if (superseded) {
        await api.memoryDb.updateEntry(input.supersedeId, {
          enabled: 0,
          verification_status: 'superseded',
          updated_at: now,
        })
        entry.derivedFrom = [input.supersedeId]
        entry.verificationStatus = 'verified'
        entry.source = input.source ?? 'self_correction'
        logger.agent.info(`[LongTermMemory] Superseded entry ${input.supersedeId} with ${entry.id}`)
      }
    }

    await api.memoryDb.upsertEntry(this.entryToRow(entry))
    logger.agent.info('[LongTermMemory] Added entry:', entry.id, 'status:', status)
    return entry
  }

  async updateEntry(
    id: string,
    updates: Partial<Pick<MemoryEntry, 'content' | 'tags' | 'enabled' | 'confidence' | 'status' | 'verificationStatus'>>
  ): Promise<boolean> {
    await this.ensureDb()
    const entry = await this.getEntry(id)
    if (!entry) return false

    const now = Date.now()
    const rowUpdates: Record<string, any> = { updated_at: now }

    if (updates.content !== undefined) rowUpdates.content = updates.content.trim()
    if (updates.tags !== undefined) rowUpdates.tags = JSON.stringify(updates.tags)
    if (updates.enabled !== undefined) rowUpdates.enabled = updates.enabled ? 1 : 0
    if (updates.confidence !== undefined) rowUpdates.importance = Math.min(1, Math.max(0, updates.confidence))
    if (updates.verificationStatus !== undefined) rowUpdates.sync_status = updates.verificationStatus

    if (updates.status !== undefined && updates.status !== entry.status) {
      rowUpdates.tier = updates.status === 'long_term' ? 'long_term' : (updates.status === 'forgotten' ? 'forgotten' : 'short_term')
      rowUpdates.type = updates.status === 'long_term' ? 'LONG_TERM' : 'SHORT_TERM'
      if (updates.status === 'long_term') {
        rowUpdates.classified_at = now
      }
    }

    await api.memoryDb.updateEntry(id, rowUpdates)
    return true
  }

  async deleteEntry(id: string): Promise<boolean> {
    await this.ensureDb()
    const result = await api.memoryDb.deleteEntry(id)
    return result.success
  }

  async recordRecall(id: string, _query: string): Promise<void> {
    await this.ensureDb()
    const entry = await this.getEntry(id)
    if (!entry) return

    const now = Date.now()
    await api.memoryDb.updateEntry(id, {
      access_count: entry.recallCount + 1,
      last_accessed_at: now,
      updated_at: now,
    })
  }

  async recordBulkRecall(ids: string[]): Promise<void> {
    if (ids.length === 0) return
    await this.ensureDb()
    const now = Date.now()

    for (const id of ids) {
      const entry = await this.getEntry(id)
      if (!entry) continue
      await api.memoryDb.updateEntry(id, {
        access_count: entry.recallCount + 1,
        last_accessed_at: now,
        updated_at: now,
      })
    }
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
    return this.updateEntry(id, { status: 'long_term' })
  }

  async forget(id: string): Promise<boolean> {
    return this.updateEntry(id, { status: 'forgotten', enabled: false })
  }

  async supersedeEntry(oldId: string, newContent: string, reason: string, options?: { source?: MemorySource; tags?: string[]; confidence?: number }): Promise<MemoryEntry | null> {
    const oldEntry = await this.getEntry(oldId)
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
    await this.ensureDb()
    const now = Date.now()
    let promoted = 0
    let forgotten = 0

    const candidates = await this.getEntries('short_term')
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
        await this.updateEntry(entry.id, { status: 'long_term' })
        promoted++
      } else if (ageDays > 60 && entry.recallCount === 0 && entry.confidence < 0.6) {
        await this.updateEntry(entry.id, { status: 'forgotten', enabled: false })
        forgotten++
      }
    }

    if (promoted > 0 || forgotten > 0) {
      logger.agent.info(`[LongTermMemory] Deep promotion: ${promoted} promoted, ${forgotten} forgotten`)
    }

    return { promoted, forgotten }
  }

  async runLightDreaming(): Promise<{ merged: number; pruned: number }> {
    await this.ensureDb()
    let merged = 0
    let pruned = 0

    const shortTerm = await this.getEntries('short_term')
    const duplicates = this.findDuplicates(shortTerm)

    for (const group of duplicates) {
      if (group.length < 2) continue
      const best = group.reduce((a, b) => (a.confidence >= b.confidence ? a : b))

      for (const entry of group) {
        if (entry.id === best.id) continue
        // 合并 recallCount、uniqueQueryCount、tags 到 best
        const updates: Partial<MemoryEntry> = {}
        if (entry.recallCount > best.recallCount) {
          updates.recallCount = entry.recallCount
          best.recallCount = entry.recallCount
        }
        if (entry.uniqueQueryCount > best.uniqueQueryCount) {
          updates.uniqueQueryCount = entry.uniqueQueryCount
          best.uniqueQueryCount = entry.uniqueQueryCount
        }
        const newTags = [...new Set([...best.tags, ...entry.tags])]
        if (newTags.length > best.tags.length) {
          updates.tags = newTags
          best.tags = newTags
        }
        if (Object.keys(updates).length > 0) {
          await this.updateEntry(best.id, updates)
        }
        await this.deleteEntry(entry.id)
        merged++
      }
    }

    const now = Date.now()
    for (const entry of shortTerm) {
      const ageDays = (now - entry.createdAt) / 86_400_000
      if (ageDays > 60 && entry.recallCount === 0 && entry.confidence < 0.5) {
        await this.updateEntry(entry.id, { status: 'forgotten', enabled: false })
        pruned++
      }
    }

    if (merged > 0 || pruned > 0) {
      logger.agent.info(`[LongTermMemory] Light dreaming: ${merged} merged, ${pruned} pruned`)
    }

    return { merged, pruned }
  }

  async runRemDreaming(): Promise<{ consolidated: number; insights: number; contradictions: number }> {
    await this.ensureDb()
    const longTerm = await this.getEntries('long_term')
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

    const remaining = longTerm.filter(e => !toRemove.has(e.id))
    const groups = this.findRelatedGroups(remaining)

    for (const group of groups) {
      if (group.length < 2) continue

      const combinedContent = group.map(e => e.content).join(' | ')
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

      await api.memoryDb.upsertEntry(this.entryToRow(consolidatedEntry))
      consolidated++
    }

    for (const id of toRemove) {
      await this.deleteEntry(id)
    }

    if (toRemove.size > 0) {
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
    // SQLite 模式下无需缓存清理，保留方法以兼容调用方
  }

  /**
   * 从旧 JSON store 迁移数据到 SQLite（一次性）
   * 检测旧 JSON 文件是否存在，若存在则迁移并标记
   */
  async migrateFromJsonFile(): Promise<{ migrated: number; skipped: number }> {
    const { workspacePath } = useStore.getState()
    if (!workspacePath) return { migrated: 0, skipped: 0 }

    await this.ensureDb()

    // 检查是否已迁移过
    const migratedFlag = await api.memoryDb.getSyncState('json_migrated')
    if (migratedFlag === '1') {
      logger.agent.info('[LongTermMemory] 已从 JSON 迁移过，跳过')
      return { migrated: 0, skipped: 0 }
    }

    const filePath = joinPath(workspacePath, OLD_FILE_PATH)
    const content = await api.file.read(filePath)
    if (!content) {
      // 无旧文件，直接标记已迁移
      await api.memoryDb.setSyncState('json_migrated', '1')
      return { migrated: 0, skipped: 0 }
    }

    try {
      const store = JSON.parse(content)
      const result = await api.memoryDb.migrateFromJsonStore(store)
      if (result.success) {
        await api.memoryDb.setSyncState('json_migrated', '1')
        logger.agent.info(`[LongTermMemory] 从 JSON 迁移完成: ${result.migrated} 条`)
        return { migrated: result.migrated, skipped: result.skipped }
      }
      return { migrated: 0, skipped: 0 }
    } catch (err) {
      logger.agent.warn('[LongTermMemory] JSON 迁移失败:', err)
      return { migrated: 0, skipped: 0 }
    }
  }

  async migrateFromKnowledgeConversation(): Promise<number> {
    const { workspacePath } = useStore.getState()
    if (!workspacePath) return 0

    await this.ensureDb()

    const oldFilePath = joinPath(workspacePath, OLD_KNOWLEDGE_CONV_FILE)
    const oldContent = await api.file.read(oldFilePath)
    if (!oldContent) return 0

    try {
      const oldStore = JSON.parse(oldContent)
      if (!oldStore || !Array.isArray(oldStore.entries)) return 0

      let migrated = 0
      const existing = await this.getEntries()
      const existingContents = new Set(existing.map(e => e.content.trim()))

      for (const item of oldStore.entries) {
        if (!item.content || typeof item.content !== 'string') continue
        const content = item.content.trim()
        if (existingContents.has(content)) continue

        const now = Date.now()
        const entry: MemoryEntry = {
          id: item.id || crypto.randomUUID(),
          content,
          source: 'auto_extracted',
          status: 'short_term',
          confidence: item.confidence ?? 0.7,
          recallCount: item.accessCount ?? 0,
          uniqueQueryCount: 0,
          lastRecalledAt: item.updatedAt ?? now,
          halfLifeDays: 14,
          tags: item.tags ?? [],
          enabled: item.enabled !== false,
          createdAt: item.createdAt ?? now,
          updatedAt: now,
        }
        await api.memoryDb.upsertEntry(this.entryToRow(entry))
        migrated++
      }

      if (migrated > 0) {
        logger.agent.info(`[LongTermMemory] Migrated ${migrated} entries from knowledge conversation layer`)
      }

      return migrated
    } catch (err) {
      logger.agent.warn('[LongTermMemory] Failed to migrate conversation data:', err)
      return 0
    }
  }
}

export const longTermMemoryService = new LongTermMemoryService()
