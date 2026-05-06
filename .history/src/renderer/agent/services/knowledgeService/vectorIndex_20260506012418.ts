import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import { useStore } from '@store'
import { joinPath } from '@shared/utils/pathUtils'

interface VectorEntry {
  id: string
  vector: number[]
  updatedAt: number
}

interface VectorStore {
  version: number
  entries: VectorEntry[]
  lastRebuildAt: number
}

const STORE_FILE = '.aweeclaw/knowledge/vectors.json'
const MAX_CACHE_SIZE = 500
const EMBEDDING_BATCH_SIZE = 20

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
  private dirty = false
  private storeLoaded = false

  async getVector(id: string): Promise<number[] | null> {
    return this.cache.get(id) ?? null
  }

  async indexEntries(entries: Array<{ id: string; content: string; updatedAt: number }>): Promise<number> {
    await this.ensureLoaded()

    const toIndex = entries.filter(e => {
      const cached = this.cache.get(e.id)
      return !cached
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
              indexed++
            }
          }
        }
      } catch (err) {
        logger.agent.warn('[VectorIndex] Batch embedding failed:', err)
        for (const entry of batch) {
          try {
            const result = await api.llm.embedText({ text: entry.content.slice(0, 500), config })
            if (result?.embedding && Array.isArray(result.embedding)) {
              this.cache.set(entry.id, result.embedding)
              indexed++
            }
          } catch {
          }
        }
      }
    }

    if (indexed > 0) {
      this.dirty = true
      logger.agent.info(`[VectorIndex] Indexed ${indexed} entries`)
    }

    return indexed
  }

  async search(query: string, candidateIds: string[], topK: number = 10): Promise<Array<{ id: string; score: number }>> {
    await this.ensureLoaded()

    const config = await this.getEmbeddingConfig()
    if (!config) return []

    let queryVector: number[]
    try {
      const result = await api.llm.embedText({ text: query.slice(0, 500), config })
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
    this.dirty = true
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
          updatedAt: Date.now(),
        })),
        lastRebuildAt: Date.now(),
      }

      if (store.entries.length > MAX_CACHE_SIZE) {
        store.entries = store.entries.slice(0, MAX_CACHE_SIZE)
      }

      const dirPath = joinPath(workspacePath, '.aweeclaw/knowledge')
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
      }

      logger.agent.info(`[VectorIndex] Loaded ${store.entries.length} vectors from disk`)
    } catch {
    }
  }

  private async getEmbeddingConfig() {
    try {
      const { getLLMConfigForTask } = await import('../llmConfigService')
      const store = useStore.getState()
      return getLLMConfigForTask(store.llmConfig.provider, store.llmConfig.model)
    } catch {
      return null
    }
  }
}

export const vectorIndex = new VectorIndex()
