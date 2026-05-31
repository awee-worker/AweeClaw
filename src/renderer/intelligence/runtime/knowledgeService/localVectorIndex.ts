import { logger } from '@toolkit/LogEngine'

const VECTOR_DB_NAME = 'aweeclaw_vector_index'
const VECTOR_DB_VERSION = 1
const VECTOR_STORE = 'vectors'
const IDF_STORE = 'idf_stats'

interface VectorEntry {
  id: string
  entryId: string
  tokens: string[]
  tfidfVector: number[]
  magnitude: number
  updatedAt: number
}

interface IDFStats {
  totalDocs: number
  termDocCounts: Map<string, number>
  lastUpdated: number
}

interface SearchResult {
  entryId: string
  score: number
  matchedTokens: string[]
}

class LocalVectorIndex {
  private db: IDBDatabase | null = null
  private initPromise: Promise<IDBDatabase> | null = null
  private idfStats: IDFStats = {
    totalDocs: 0,
    termDocCounts: new Map(),
    lastUpdated: 0,
  }

  private async getDB(): Promise<IDBDatabase> {
    if (this.db) return this.db
    if (this.initPromise) return this.initPromise

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(VECTOR_DB_NAME, VECTOR_DB_VERSION)

      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(VECTOR_STORE)) {
          const store = db.createObjectStore(VECTOR_STORE, { keyPath: 'id' })
          store.createIndex('entryId', 'entryId', { unique: false })
        }
        if (!db.objectStoreNames.contains(IDF_STORE)) {
          db.createObjectStore(IDF_STORE)
        }
      }

      request.onsuccess = () => {
        this.db = request.result
        resolve(this.db)
      }

      request.onerror = () => {
        this.initPromise = null
        reject(request.error)
      }
    })

    return this.initPromise
  }

  private tokenize(text: string): string[] {
    const normalized = text.toLowerCase().replace(/[^\w\u4e00-\u9fff]/g, ' ')
    const tokens: string[] = []

    const chineseChars = normalized.match(/[\u4e00-\u9fff]{2,}/g) ?? []
    for (const segment of chineseChars) {
      for (let i = 0; i < segment.length - 1; i++) {
        tokens.push(segment.slice(i, i + 2))
      }
      if (segment.length <= 4) tokens.push(segment)
    }

    const words = normalized.split(/\s+/).filter(w => w.length > 1)
    for (const word of words) {
      if (!/[\u4e00-\u9fff]/.test(word)) {
        tokens.push(word)
      }
    }

    return [...new Set(tokens)]
  }

  private computeTF(tokens: string[]): Map<string, number> {
    const tf = new Map<string, number>()
    const total = tokens.length || 1
    for (const token of tokens) {
      tf.set(token, (tf.get(token) ?? 0) + 1 / total)
    }
    return tf
  }

  private computeIDF(token: string): number {
    const docCount = this.idfStats.termDocCounts.get(token) ?? 0
    if (docCount === 0) return 0
    return Math.log((this.idfStats.totalDocs + 1) / (docCount + 1)) + 1
  }

  private computeTFIDFVector(tf: Map<string, number>, allTokens: string[]): { vector: number[]; magnitude: number } {
    const vector: number[] = []
    let sumSquares = 0

    for (const token of allTokens) {
      const tfVal = tf.get(token) ?? 0
      const idfVal = this.computeIDF(token)
      const tfidf = tfVal * idfVal
      vector.push(tfidf)
      sumSquares += tfidf * tfidf
    }

    const magnitude = Math.sqrt(sumSquares)
    return { vector, magnitude }
  }

  private cosineSimilarity(
    vecA: number[],
    magA: number,
    vecB: number[],
    magB: number,
  ): number {
    if (magA === 0 || magB === 0) return 0
    let dotProduct = 0
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i]
    }
    return dotProduct / (magA * magB)
  }

  async indexEntry(entryId: string, title: string, content: string, tags: string[] = []): Promise<void> {
    const text = `${title} ${content} ${tags.join(' ')}`
    const tokens = this.tokenize(text)
    const tf = this.computeTF(tokens)

    await this.rebuildIDF()

    const allTokens = Array.from(this.idfStats.termDocCounts.keys())
    const { vector, magnitude } = this.computeTFIDFVector(tf, allTokens)

    const entry: VectorEntry = {
      id: `vec-${entryId}`,
      entryId,
      tokens,
      tfidfVector: vector,
      magnitude,
      updatedAt: Date.now(),
    }

    const db = await this.getDB()
    const tx = db.transaction(VECTOR_STORE, 'readwrite')
    tx.objectStore(VECTOR_STORE).put(entry)

    await this.updateIDFStats(tokens)
    logger.agent.debug(`[VectorIndex] Indexed entry: ${entryId}, tokens: ${tokens.length}`)
  }

  async indexBatch(entries: Array<{ entryId: string; title: string; content: string; tags?: string[] }>): Promise<void> {
    for (const entry of entries) {
      await this.indexEntry(entry.entryId, entry.title, entry.content, entry.tags)
    }
    logger.agent.info(`[VectorIndex] Batch indexed ${entries.length} entries`)
  }

  async search(query: string, topK: number = 10, threshold: number = 0.1): Promise<SearchResult[]> {
    const queryTokens = this.tokenize(query)
    if (queryTokens.length === 0) return []

    const queryTF = this.computeTF(queryTokens)
    await this.rebuildIDF()

    const allTokens = Array.from(this.idfStats.termDocCounts.keys())
    const { vector: queryVec, magnitude: queryMag } = this.computeTFIDFVector(queryTF, allTokens)

    if (queryMag === 0) return []

    const db = await this.getDB()
    const entries = await new Promise<VectorEntry[]>((resolve, reject) => {
      const tx = db.transaction(VECTOR_STORE, 'readonly')
      const store = tx.objectStore(VECTOR_STORE)
      const request = store.getAll()

      request.onsuccess = () => resolve(request.result ?? [])
      request.onerror = () => reject(request.error)
    })

    const results: SearchResult[] = []

    for (const entry of entries) {
      if (entry.tfidfVector.length !== queryVec.length) continue

      const score = this.cosineSimilarity(queryVec, queryMag, entry.tfidfVector, entry.magnitude)
      if (score >= threshold) {
        const matchedTokens = queryTokens.filter(t => entry.tokens.includes(t))
        results.push({
          entryId: entry.entryId,
          score,
          matchedTokens,
        })
      }
    }

    results.sort((a, b) => b.score - a.score)
    return results.slice(0, topK)
  }

  async removeEntry(entryId: string): Promise<void> {
    const db = await this.getDB()
    const tx = db.transaction(VECTOR_STORE, 'readwrite')
    const store = tx.objectStore(VECTOR_STORE)
    const index = store.index('entryId')

    const entries = await new Promise<VectorEntry[]>((resolve, reject) => {
      const request = index.getAll(entryId)
      request.onsuccess = () => resolve(request.result ?? [])
      request.onerror = () => reject(request.error)
    })

    for (const entry of entries) {
      store.delete(entry.id)
    }
  }

  private async rebuildIDF(): Promise<void> {
    if (this.idfStats.lastUpdated > Date.now() - 60000) return

    const db = await this.getDB()
    const entries = await new Promise<VectorEntry[]>((resolve, reject) => {
      const tx = db.transaction(VECTOR_STORE, 'readonly')
      const request = tx.objectStore(VECTOR_STORE).getAll()
      request.onsuccess = () => resolve(request.result ?? [])
      request.onerror = () => reject(request.error)
    })

    this.idfStats.totalDocs = entries.length
    this.idfStats.termDocCounts = new Map()

    for (const entry of entries) {
      for (const token of new Set(entry.tokens)) {
        this.idfStats.termDocCounts.set(token, (this.idfStats.termDocCounts.get(token) ?? 0) + 1)
      }
    }

    this.idfStats.lastUpdated = Date.now()
  }

  private async updateIDFStats(newTokens: string[]): Promise<void> {
    this.idfStats.totalDocs++
    for (const token of new Set(newTokens)) {
      this.idfStats.termDocCounts.set(token, (this.idfStats.termDocCounts.get(token) ?? 0) + 1)
    }
  }

  async getStats(): Promise<{ totalDocs: number; uniqueTerms: number; lastUpdated: number }> {
    await this.rebuildIDF()
    return {
      totalDocs: this.idfStats.totalDocs,
      uniqueTerms: this.idfStats.termDocCounts.size,
      lastUpdated: this.idfStats.lastUpdated,
    }
  }

  async clear(): Promise<void> {
    const db = await this.getDB()
    const tx = db.transaction([VECTOR_STORE, IDF_STORE], 'readwrite')
    tx.objectStore(VECTOR_STORE).clear()
    tx.objectStore(IDF_STORE).clear()
    this.idfStats = { totalDocs: 0, termDocCounts: new Map(), lastUpdated: 0 }
    logger.agent.info('[VectorIndex] Index cleared')
  }
}

export const localVectorIndex = new LocalVectorIndex()
