import { api } from '../../../adapters/electronBridge'
import { logger } from '@toolkit/LogEngine'
import { useStore } from '@store'
import { joinPath } from '@shared/toolkit/pathHelper'
import { BRAND } from '@shared/brand'
import type { VectorIndexStats, IndexHealthReport } from '@intelligence/providerTypes'

interface VectorEntry {
  id: string
  vector: number[]
  updatedAt: number
}

interface VectorStore {
  version: number
  entries: VectorEntry[]
  lastRebuildAt: number
  lastIncrementalUpdateAt: number
}

const STORE_FILE = BRAND.paths.knowledgeVectors
const MAX_CACHE_SIZE = 500
const EMBEDDING_BATCH_SIZE = 20
// const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000
const AUTO_REINDEX_INTERVAL_MS = 30 * 60 * 1000

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

class VectorIndex {
  private cache: Map<string, number[]> = new Map()
  private entryTimestamps: Map<string, number> = new Map()
  private dirty = false
  private storeLoaded = false
  private lastRebuildAt = 0
  private lastIncrementalUpdateAt = 0
  private autoReindexTimer: ReturnType<typeof setInterval> | null = null

  async getVector(id: string): Promise<number[] | null> {
    return this.cache.get(id) ?? null
  }

  async indexEntries(entries: Array<{ id: string; content: string; updatedAt: number }>): Promise<number> {
    await this.ensureLoaded()

    const toIndex = entries.filter(e => {
      const cached = this.cache.get(e.id)
      if (!cached) return true
      const cachedTime = this.entryTimestamps.get(e.id) ?? 0
      return e.updatedAt > cachedTime
    })

    if (toIndex.length === 0) return 0

    const config = await this.getEmbeddingConfig()
    if (!config) {
      logger.agent.warn('[VectorIndex] No embedding config available')
      return 0
    }

    let indexed = 0
    for (let i = 0; i < toIndex.length; i += EMBEDDING_BATCH_SIZE) {
      const batch = toIndex.slice(i, i + EMBEDDING_BATCH_SIZE)
      try {
        const texts = batch.map(e => e.content.slice(0, 500))
        const result: any = await api.llm.embedMany({ texts, config })

        if (result?.embeddings && Array.isArray(result.embeddings)) {
          for (let j = 0; j < batch.length; j++) {
            const embedding = result.embeddings[j]
            if (embedding && Array.isArray(embedding)) {
              this.cache.set(batch[j].id, embedding)
              this.entryTimestamps.set(batch[j].id, batch[j].updatedAt)
              indexed++
            }
          }
        }
      } catch (err) {
        logger.agent.warn('[VectorIndex] Batch embedding failed:', err)
        for (const entry of batch) {
          try {
            const result: any = await api.llm.embedText({ text: entry.content.slice(0, 500), config })
            if (result?.embedding && Array.isArray(result.embedding)) {
              this.cache.set(entry.id, result.embedding)
              this.entryTimestamps.set(entry.id, entry.updatedAt)
              indexed++
            }
          } catch {
          }
        }
      }
    }

    if (indexed > 0) {
      this.dirty = true
      this.lastIncrementalUpdateAt = Date.now()
      logger.agent.info(`[VectorIndex] Indexed ${indexed} entries (incremental)`)
    }

    return indexed
  }

  async search(query: string, candidateIds: string[], topK: number = 10): Promise<Array<{ id: string; score: number }>> {
    await this.ensureLoaded()

    const config = await this.getEmbeddingConfig()
    if (!config) return []

    let queryVector: number[]
    try {
      const result: any = await api.llm.embedText({ text: query.slice(0, 500), config })
      if (!result?.embedding || !Array.isArray(result.embedding)) return []
      queryVector = result.embedding
    } catch (err) {
      logger.agent.warn('[VectorIndex] Query embedding failed:', err)
      return []
    }

    const results: Array<{ id: string; score: number }> = []
    for (const id of candidateIds) {
      const vector = this.cache.get(id)
      if (!vector) continue
      const score = cosineSimilarity(queryVector, vector)
      results.push({ id, score })
    }

    return results.sort((a, b) => b.score - a.score).slice(0, topK)
  }

  removeEntry(id: string): void {
    this.cache.delete(id)
    this.entryTimestamps.delete(id)
    this.dirty = true
  }

  async rebuildIndex(entries: Array<{ id: string; content: string; updatedAt: number }>): Promise<number> {
    this.cache.clear()
    this.entryTimestamps.clear()
    this.dirty = true

    const indexed = await this.indexEntries(entries)
    this.lastRebuildAt = Date.now()
    await this.persist()

    logger.agent.info(`[VectorIndex] Full rebuild completed: ${indexed} entries indexed`)
    return indexed
  }

  startAutoReindex(getEntriesFn: () => Promise<Array<{ id: string; content: string; updatedAt: number }>>): void {
    this.stopAutoReindex()

    this.autoReindexTimer = setInterval(async () => {
      try {
        const entries = await getEntriesFn()
        const staleCount = entries.filter(e => {
          const cachedTime = this.entryTimestamps.get(e.id)
          return !cachedTime || e.updatedAt > cachedTime
        }).length

        if (staleCount > 0) {
          logger.agent.info(`[VectorIndex] Auto-reindex: ${staleCount} stale entries detected`)
          await this.indexEntries(entries)
          await this.persist()
        }
      } catch (err) {
        logger.agent.warn('[VectorIndex] Auto-reindex failed:', err)
      }
    }, AUTO_REINDEX_INTERVAL_MS)

    logger.agent.info('[VectorIndex] Auto-reindex started')
  }

  stopAutoReindex(): void {
    if (this.autoReindexTimer) {
      clearInterval(this.autoReindexTimer)
      this.autoReindexTimer = null
      logger.agent.info('[VectorIndex] Auto-reindex stopped')
    }
  }

  getStats(): VectorIndexStats {
    const totalVectors = this.cache.size
    return {
      totalVectors,
      lastRebuildAt: this.lastRebuildAt || null,
      lastIncrementalUpdateAt: this.lastIncrementalUpdateAt || null,
      indexSizeBytes: this.cache.size * 1536 * 4,
      embeddingProvider: null,
      isHealthy: totalVectors > 0,
    }
  }

  async healthCheck(entries: Array<{ id: string; updatedAt: number }>): Promise<IndexHealthReport> {
    await this.ensureLoaded()

    const issues: Array<{ severity: 'warning' | 'error'; message: string }> = []
    let staleEntries = 0

    for (const entry of entries) {
      const cachedTime = this.entryTimestamps.get(entry.id)
      if (!cachedTime) {
        staleEntries++
      } else if (entry.updatedAt > cachedTime) {
        staleEntries++
      }
    }

    const missingCount = entries.filter(e => !this.cache.has(e.id)).length
    const orphanedVectors = Array.from(this.cache.keys()).filter(id => !entries.some(e => e.id === id)).length

    if (staleEntries > entries.length * 0.3) {
      issues.push({ severity: 'warning', message: `${staleEntries} entries are stale (>${(entries.length * 0.3).toFixed(0)} threshold)` })
    }

    if (missingCount > entries.length * 0.5) {
      issues.push({ severity: 'warning', message: `${missingCount} entries missing from index` })
    }

    if (orphanedVectors > 50) {
      issues.push({ severity: 'warning', message: `${orphanedVectors} orphaned vectors in index` })
    }

    const config = await this.getEmbeddingConfig()
    if (!config) {
      issues.push({ severity: 'error', message: 'No embedding configuration available' })
    }

    const status = issues.some(i => i.severity === 'error')
      ? 'unhealthy'
      : issues.some(i => i.severity === 'warning')
        ? 'degraded'
        : 'healthy'

    return {
      status,
      totalEntries: entries.length,
      indexedEntries: this.cache.size,
      staleEntries,
      lastRebuildAt: this.lastRebuildAt || null,
      embeddingAvailable: !!config,
      issues,
    }
  }

  async persist(): Promise<void> {
    if (!this.dirty) return

    try {
      const { workspacePath } = useStore.getState()
      if (!workspacePath) return

      const store: VectorStore = {
        version: 1,
        entries: Array.from(this.cache.entries()).map(([id, vector]) => ({
          id,
          vector,
          updatedAt: this.entryTimestamps.get(id) ?? Date.now(),
        })),
        lastRebuildAt: this.lastRebuildAt,
        lastIncrementalUpdateAt: this.lastIncrementalUpdateAt,
      }

      if (store.entries.length > MAX_CACHE_SIZE) {
        const sorted = store.entries.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
        store.entries = sorted.slice(0, MAX_CACHE_SIZE)
      }

      const dirPath = joinPath(workspacePath, BRAND.paths.knowledge)
      await api.file.ensureDir(dirPath)

      const filePath = joinPath(workspacePath, STORE_FILE)
      await api.file.write(filePath, JSON.stringify(store))
      this.dirty = false
    } catch (err) {
      logger.agent.warn('[VectorIndex] Persist failed:', err)
    }
  }

  private async ensureLoaded(): Promise<void> {
    if (this.storeLoaded) return
    this.storeLoaded = true

    try {
      const { workspacePath } = useStore.getState()
      if (!workspacePath) return

      const filePath = joinPath(workspacePath, STORE_FILE)
      const content = await api.file.read(filePath)
      if (!content) return

      const store: VectorStore = JSON.parse(content)
      if (store.version !== 1) return

      for (const entry of store.entries) {
        this.cache.set(entry.id, entry.vector)
        this.entryTimestamps.set(entry.id, entry.updatedAt)
      }

      this.lastRebuildAt = store.lastRebuildAt ?? 0
      this.lastIncrementalUpdateAt = store.lastIncrementalUpdateAt ?? 0

      logger.agent.info(`[VectorIndex] Loaded ${store.entries.length} vectors from disk`)
    } catch {
    }
  }

  private async getEmbeddingConfig() {
    try {
      const { getLLMConfigForTask } = await import('../modelConfigService')
      const store = useStore.getState()
      return getLLMConfigForTask(store.llmConfig.provider, store.llmConfig.model)
    } catch {
      return null
    }
  }
}

export const vectorIndex = new VectorIndex()
