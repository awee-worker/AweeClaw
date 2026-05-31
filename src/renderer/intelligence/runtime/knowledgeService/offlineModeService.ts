import { logger } from '@toolkit/LogEngine'
import { useStore } from '@store'
import { localGraphStore } from './localGraphStore'
import { localVectorIndex } from './localVectorIndex'
import { knowledgeService } from './index'

const OFFLINE_QUEUE_DB_NAME = 'aweeclaw_offline_queue'
const OFFLINE_QUEUE_DB_VERSION = 1
const OFFLINE_QUEUE_STORE = 'pending_ops'

interface OfflineOperation {
  id: string
  type: 'add_entry' | 'update_entry' | 'delete_entry' | 'sync_graph' | 'sync_vector'
  payload: Record<string, unknown>
  createdAt: number
  retryCount: number
  lastError?: string
}

interface OfflineStatus {
  isOnline: boolean
  isOfflineMode: boolean
  pendingOperations: number
  lastOnlineAt: string | null
  cacheSize: number
}

type OnlineChangeListener = (online: boolean) => void

class OfflineModeService {
  private db: IDBDatabase | null = null
  private initPromise: Promise<IDBDatabase> | null = null
  private onlineListeners: Set<OnlineChangeListener> = new Set()
  private isOnline = navigator.onLine
  private lastOnlineAt: string | null = navigator.onLine ? new Date().toISOString() : null
  private processingQueue = false

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.handleOnline())
      window.addEventListener('offline', () => this.handleOffline())
    }
  }

  private async getDB(): Promise<IDBDatabase> {
    if (this.db) return this.db
    if (this.initPromise) return this.initPromise

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(OFFLINE_QUEUE_DB_NAME, OFFLINE_QUEUE_DB_VERSION)

      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(OFFLINE_QUEUE_STORE)) {
          const store = db.createObjectStore(OFFLINE_QUEUE_STORE, { keyPath: 'id' })
          store.createIndex('type', 'type', { unique: false })
          store.createIndex('createdAt', 'createdAt', { unique: false })
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

  private handleOnline(): void {
    this.isOnline = true
    this.lastOnlineAt = new Date().toISOString()
    logger.agent.info('[OfflineMode] Back online, processing pending queue')
    this.processQueue()
    this.onlineListeners.forEach(fn => fn(true))
  }

  private handleOffline(): void {
    this.isOnline = false
    logger.agent.info('[OfflineMode] Gone offline')
    this.onlineListeners.forEach(fn => fn(false))
  }

  onOnlineChange(listener: OnlineChangeListener): () => void {
    this.onlineListeners.add(listener)
    return () => this.onlineListeners.delete(listener)
  }

  getOnlineStatus(): boolean {
    const privacy = useStore.getState().privacySettings
    if (privacy?.enableOfflineMode) return false
    return this.isOnline
  }

  async getStatus(): Promise<OfflineStatus> {
    const privacy = useStore.getState().privacySettings
    const pendingOps = await this.getPendingCount()
    const graphEntities = await localGraphStore.getEntities()
    const vectorStats = await localVectorIndex.getStats()

    return {
      isOnline: this.isOnline,
      isOfflineMode: privacy?.enableOfflineMode ?? false,
      pendingOperations: pendingOps,
      lastOnlineAt: this.lastOnlineAt,
      cacheSize: graphEntities.length + vectorStats.totalDocs,
    }
  }

  async enqueue(
    type: OfflineOperation['type'],
    payload: Record<string, unknown>,
  ): Promise<string> {
    if (this.isOnline && !useStore.getState().privacySettings?.enableOfflineMode) {
      return ''
    }

    const op: OfflineOperation = {
      id: `op-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      payload,
      createdAt: Date.now(),
      retryCount: 0,
    }

    const db = await this.getDB()
    const tx = db.transaction(OFFLINE_QUEUE_STORE, 'readwrite')
    tx.objectStore(OFFLINE_QUEUE_STORE).add(op)

    logger.agent.debug(`[OfflineMode] Enqueued operation: ${type}`)
    return op.id
  }

  async processQueue(): Promise<{ processed: number; failed: number }> {
    if (this.processingQueue) return { processed: 0, failed: 0 }
    if (!this.isOnline) return { processed: 0, failed: 0 }

    const privacy = useStore.getState().privacySettings
    if (privacy?.enableOfflineMode) return { processed: 0, failed: 0 }

    this.processingQueue = true
    let processed = 0
    let failed = 0

    try {
      const ops = await this.getPendingOperations()

      for (const op of ops) {
        try {
          await this.executeOperation(op)
          await this.removeOperation(op.id)
          processed++
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err)
          op.retryCount++
          op.lastError = errorMsg

          if (op.retryCount >= 3) {
            await this.removeOperation(op.id)
            failed++
            logger.agent.warn(`[OfflineMode] Operation ${op.id} failed after 3 retries:`, errorMsg)
          } else {
            await this.updateOperation(op)
          }
        }
      }
    } finally {
      this.processingQueue = false
    }

    if (processed > 0 || failed > 0) {
      logger.agent.info(`[OfflineMode] Queue processed: ${processed} ok, ${failed} failed`)
    }

    return { processed, failed }
  }

  private async executeOperation(op: OfflineOperation): Promise<void> {
    switch (op.type) {
      case 'add_entry':
        await knowledgeService.addEntry(op.payload as any)
        break
      case 'update_entry':
        await knowledgeService.updateEntry(op.payload.id as string, op.payload as any)
        break
      case 'delete_entry':
        await knowledgeService.deleteEntry(op.payload.id as string)
        break
      case 'sync_graph':
        await localGraphStore.syncToInMemoryGraph()
        break
      case 'sync_vector':
        break
      default:
        logger.agent.warn(`[OfflineMode] Unknown operation type: ${op.type}`)
    }
  }

  private async getPendingOperations(): Promise<OfflineOperation[]> {
    const db = await this.getDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(OFFLINE_QUEUE_STORE, 'readonly')
      const request = tx.objectStore(OFFLINE_QUEUE_STORE).getAll()

      request.onsuccess = () => {
        const ops = (request.result ?? []) as OfflineOperation[]
        ops.sort((a, b) => a.createdAt - b.createdAt)
        resolve(ops)
      }
      request.onerror = () => reject(request.error)
    })
  }

  private async getPendingCount(): Promise<number> {
    const db = await this.getDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(OFFLINE_QUEUE_STORE, 'readonly')
      const request = tx.objectStore(OFFLINE_QUEUE_STORE).count()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  private async removeOperation(id: string): Promise<void> {
    const db = await this.getDB()
    const tx = db.transaction(OFFLINE_QUEUE_STORE, 'readwrite')
    tx.objectStore(OFFLINE_QUEUE_STORE).delete(id)
  }

  private async updateOperation(op: OfflineOperation): Promise<void> {
    const db = await this.getDB()
    const tx = db.transaction(OFFLINE_QUEUE_STORE, 'readwrite')
    tx.objectStore(OFFLINE_QUEUE_STORE).put(op)
  }

  async preCacheForOffline(): Promise<void> {
    logger.agent.info('[OfflineMode] Pre-caching data for offline use')

    try {
      const entries = await knowledgeService.getEntries()
      logger.agent.info(`[OfflineMode] Cached ${entries.length} knowledge entries`)

      const graphEntities = await localGraphStore.getEntities()
      const graphRelations = await localGraphStore.getRelations()
      logger.agent.info(`[OfflineMode] Cached ${graphEntities.length} entities, ${graphRelations.length} relations`)

      for (const entry of entries) {
        await localVectorIndex.indexEntry(entry.id, entry.title, entry.content, entry.tags)
      }

      logger.agent.info('[OfflineMode] Pre-cache complete')
    } catch (err) {
      logger.agent.warn('[OfflineMode] Pre-cache failed:', err)
    }
  }

  async clearQueue(): Promise<void> {
    const db = await this.getDB()
    const tx = db.transaction(OFFLINE_QUEUE_STORE, 'readwrite')
    tx.objectStore(OFFLINE_QUEUE_STORE).clear()
    logger.agent.info('[OfflineMode] Queue cleared')
  }
}

export const offlineModeService = new OfflineModeService()
