import { backendApi, isAuthenticated } from '../../../adapters/backendApi'
import { logger } from '@toolkit/LogEngine'
import { StorageService } from '@shared/toolkit/StorageService'
import {
  projectKnowledgeGraph,
  type KnowledgeEntity,
  type KnowledgeRelation,
  type EntityType,
  type RelationType,
} from '../../cognitive/ProjectKnowledgeGraph'
import { useStore } from '@store'

function isGraphSyncAllowed(): boolean {
  try {
    const privacy = useStore.getState().privacySettings
    if (!privacy) return true
    return privacy.knowledgeSyncMode !== 'local-only'
  } catch {
    return true
  }
}

interface ServerGraphEntity {
  id: string
  userId: string
  name: string
  type: string
  properties: Record<string, unknown> | null
  entryId: string | null
  createdAt: string
  updatedAt: string
}

interface ServerGraphRelation {
  id: string
  sourceId: string
  targetId: string
  type: string
  properties: Record<string, unknown> | null
  createdAt: string
}

interface GraphSyncMeta {
  lastSyncAt: string | null
  serverEntityIdMap: Record<string, string>
  serverRelationIdMap: Record<string, string>
}

const GRAPH_SYNC_DB_NAME = 'aweeclaw_graph_sync'
const GRAPH_SYNC_STORE = 'sync_meta'
const GRAPH_SYNC_KEY = 'knowledge_graph_sync_meta'
const GRAPH_SYNC_INTERVAL_MS = 10 * 60 * 1000

class BidirectionalIdMap {
  private localToServer = new Map<string, string>()
  private serverToLocal = new Map<string, string>()

  get size(): number {
    return this.localToServer.size
  }

  set(localId: string, serverId: string): void {
    const oldServerId = this.localToServer.get(localId)
    if (oldServerId) {
      this.serverToLocal.delete(oldServerId)
    }
    this.localToServer.set(localId, serverId)
    this.serverToLocal.set(serverId, localId)
  }

  delete(localId: string): void {
    const serverId = this.localToServer.get(localId)
    if (serverId) {
      this.serverToLocal.delete(serverId)
    }
    this.localToServer.delete(localId)
  }

  getServerId(localId: string): string | undefined {
    return this.localToServer.get(localId)
  }

  getLocalId(serverId: string): string | undefined {
    return this.serverToLocal.get(serverId)
  }

  hasLocalId(localId: string): boolean {
    return this.localToServer.has(localId)
  }

  hasServerId(serverId: string): boolean {
    return this.serverToLocal.has(serverId)
  }

  entries(): IterableIterator<[string, string]> {
    return this.localToServer.entries()
  }

  toObject(): Record<string, string> {
    const obj: Record<string, string> = {}
    for (const [k, v] of this.localToServer.entries()) {
      obj[k] = v
    }
    return obj
  }

  static fromObject(data: Record<string, string>): BidirectionalIdMap {
    const map = new BidirectionalIdMap()
    for (const [localId, serverId] of Object.entries(data)) {
      map.set(localId, serverId)
    }
    return map
  }
}

class IndexedDBStorage {
  private db: IDBDatabase | null = null
  private initPromise: Promise<IDBDatabase> | null = null

  private async getDB(): Promise<IDBDatabase> {
    if (this.db) return this.db

    if (this.initPromise) return this.initPromise

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(GRAPH_SYNC_DB_NAME, 1)

      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(GRAPH_SYNC_STORE)) {
          db.createObjectStore(GRAPH_SYNC_STORE)
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

  async get<T>(key: string): Promise<T | null> {
    try {
      const db = await this.getDB()
      return new Promise((resolve, reject) => {
        const tx = db.transaction(GRAPH_SYNC_STORE, 'readonly')
        const store = tx.objectStore(GRAPH_SYNC_STORE)
        const request = store.get(key)

        request.onsuccess = () => {
          resolve(request.result ?? null)
        }

        request.onerror = () => {
          reject(request.error)
        }
      })
    } catch {
      return null
    }
  }

  async set(key: string, value: unknown): Promise<void> {
    try {
      const db = await this.getDB()
      return new Promise((resolve, reject) => {
        const tx = db.transaction(GRAPH_SYNC_STORE, 'readwrite')
        const store = tx.objectStore(GRAPH_SYNC_STORE)
        const request = store.put(value, key)

        request.onsuccess = () => {
          resolve()
        }

        request.onerror = () => {
          reject(request.error)
        }
      })
    } catch (err) {
      logger.agent.warn('[IndexedDBStorage] Failed to set:', err)
    }
  }
}

class KnowledgeGraphSyncService {
  private syncTimer: ReturnType<typeof setInterval> | null = null
  private isSyncing = false
  private storage = new IndexedDBStorage()
  private entityMap = new BidirectionalIdMap()
  private relationMap = new BidirectionalIdMap()
  private mapsInitialized = false

  private async ensureMapsInitialized(): Promise<void> {
    if (this.mapsInitialized) return

    const meta = await this.loadSyncMeta()
    this.entityMap = BidirectionalIdMap.fromObject(meta.serverEntityIdMap)
    this.relationMap = BidirectionalIdMap.fromObject(meta.serverRelationIdMap)
    this.mapsInitialized = true
  }

  startAutoSync(): void {
    if (this.syncTimer) return
    if (!isGraphSyncAllowed()) {
      logger.agent.info('[GraphSync] Sync disabled by privacy settings (local-only mode)')
      return
    }
    this.syncTimer = setInterval(() => {
      if (!isGraphSyncAllowed()) return
      this.syncToServer().catch((err) => {
        logger.agent.warn('[GraphSync] Auto sync failed:', err)
      })
    }, GRAPH_SYNC_INTERVAL_MS)
    logger.agent.info('[GraphSync] Auto sync started')
  }

  stopAutoSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer)
      this.syncTimer = null
      logger.agent.info('[GraphSync] Auto sync stopped')
    }
  }

  async syncToServer(): Promise<{ syncedEntities: number; syncedRelations: number } | null> {
    if (this.isSyncing) return null
    if (!isAuthenticated()) return null
    if (!isGraphSyncAllowed()) {
      logger.agent.debug('[GraphSync] Sync skipped - privacy settings: local-only mode')
      return null
    }

    this.isSyncing = true
    try {
      await this.ensureMapsInitialized()
      const stats = projectKnowledgeGraph.getStats()

      let syncedEntities = 0
      let syncedRelations = 0

      const serverEntities = await backendApi.get<ServerGraphEntity[]>(
        '/api/v1/knowledge/graph/entities',
      )

      const localEntities = this.getLocalEntitiesAsArray()

      for (const serverEntity of serverEntities ?? []) {
        if (!this.entityMap.hasServerId(serverEntity.id)) {
          const localEntity = projectKnowledgeGraph.addEntity({
            name: serverEntity.name,
            type: serverEntity.type as EntityType,
            properties: serverEntity.properties ?? {},
          })
          this.entityMap.set(localEntity.id, serverEntity.id)
        }
      }

      for (const localEntity of localEntities) {
        const serverId = this.entityMap.getServerId(localEntity.id)
        if (!serverId) {
          try {
            const result = await backendApi.post<ServerGraphEntity>(
              '/api/v1/knowledge/graph/entities',
              {
                name: localEntity.name,
                type: localEntity.type,
                properties: localEntity.properties,
              },
            )
            this.entityMap.set(localEntity.id, result.id)
            syncedEntities++
          } catch (err) {
            logger.agent.warn(`[GraphSync] Failed to push entity "${localEntity.name}":`, err)
          }
        }
      }

      const serverRelations = await backendApi.get<ServerGraphRelation[]>(
        '/api/v1/knowledge/graph/relations',
      )

      for (const serverRelation of serverRelations ?? []) {
        if (!this.relationMap.hasServerId(serverRelation.id)) {
          const localSourceId = this.entityMap.getLocalId(serverRelation.sourceId)
          const localTargetId = this.entityMap.getLocalId(serverRelation.targetId)
          if (localSourceId && localTargetId) {
            const localRel = projectKnowledgeGraph.addRelation({
              sourceId: localSourceId,
              targetId: localTargetId,
              type: serverRelation.type as RelationType,
              properties: serverRelation.properties ?? {},
            })
            if (localRel) {
              this.relationMap.set(localRel.id, serverRelation.id)
            }
          }
        }
      }

      const localRelations = this.getLocalRelationsAsArray()
      for (const localRel of localRelations) {
        const serverId = this.relationMap.getServerId(localRel.id)
        if (!serverId) {
          const serverSourceId = this.entityMap.getServerId(localRel.sourceId)
          const serverTargetId = this.entityMap.getServerId(localRel.targetId)
          if (!serverSourceId || !serverTargetId) continue

          try {
            const result = await backendApi.post<ServerGraphRelation>(
              '/api/v1/knowledge/graph/relations',
              {
                sourceId: serverSourceId,
                targetId: serverTargetId,
                type: localRel.type,
                properties: localRel.properties,
              },
            )
            this.relationMap.set(localRel.id, result.id)
            syncedRelations++
          } catch (err) {
            logger.agent.warn(`[GraphSync] Failed to push relation:`, err)
          }
        }
      }

      await this.persistSyncMeta()

      logger.agent.info(
        `[GraphSync] Sync completed: entities=${syncedEntities}, relations=${syncedRelations}, total_entities=${stats.entityCount}, total_relations=${stats.relationCount}`,
      )

      return { syncedEntities, syncedRelations }
    } catch (err) {
      logger.agent.warn('[GraphSync] Sync failed:', err)
      return null
    } finally {
      this.isSyncing = false
    }
  }

  async pullFromServer(): Promise<number> {
    if (!isAuthenticated()) return 0

    try {
      await this.ensureMapsInitialized()

      const serverEntities = await backendApi.get<ServerGraphEntity[]>(
        '/api/v1/knowledge/graph/entities',
      )

      if (!serverEntities || serverEntities.length === 0) return 0

      let pulled = 0
      for (const serverEntity of serverEntities) {
        if (!this.entityMap.hasServerId(serverEntity.id)) {
          const localEntity = projectKnowledgeGraph.addEntity({
            name: serverEntity.name,
            type: serverEntity.type as EntityType,
            properties: serverEntity.properties ?? {},
          })
          this.entityMap.set(localEntity.id, serverEntity.id)
          pulled++
        }
      }

      const serverRelations = await backendApi.get<ServerGraphRelation[]>(
        '/api/v1/knowledge/graph/relations',
      )

      for (const serverRelation of serverRelations ?? []) {
        if (!this.relationMap.hasServerId(serverRelation.id)) {
          const localSourceId = this.entityMap.getLocalId(serverRelation.sourceId)
          const localTargetId = this.entityMap.getLocalId(serverRelation.targetId)
          if (localSourceId && localTargetId) {
            const localRel = projectKnowledgeGraph.addRelation({
              sourceId: localSourceId,
              targetId: localTargetId,
              type: serverRelation.type as RelationType,
              properties: serverRelation.properties ?? {},
            })
            if (localRel) {
              this.relationMap.set(localRel.id, serverRelation.id)
              pulled++
            }
          }
        }
      }

      if (pulled > 0) {
        await this.persistSyncMeta()
      }

      logger.agent.info(`[GraphSync] Pulled ${pulled} items from server`)
      return pulled
    } catch (err) {
      logger.agent.warn('[GraphSync] Pull failed:', err)
      return 0
    }
  }

  async extractGraphForEntry(entryId: string): Promise<boolean> {
    if (!isAuthenticated()) return false

    try {
      await this.ensureMapsInitialized()
      const serverEntryId = this.entityMap.getServerId(entryId)

      const result = await backendApi.post<{
        entities: ServerGraphEntity[]
        relations: ServerGraphRelation[]
      }>('/api/v1/knowledge/graph/extract', {
        entryId: serverEntryId || entryId,
      })

      if (!result) return false

      for (const serverEntity of result.entities ?? []) {
        const localEntity = projectKnowledgeGraph.addEntity({
          name: serverEntity.name,
          type: serverEntity.type as EntityType,
          properties: serverEntity.properties ?? {},
        })
        this.entityMap.set(localEntity.id, serverEntity.id)
      }

      for (const serverRelation of result.relations ?? []) {
        const localSourceId = this.entityMap.getLocalId(serverRelation.sourceId)
        const localTargetId = this.entityMap.getLocalId(serverRelation.targetId)
        if (localSourceId && localTargetId) {
          const localRel = projectKnowledgeGraph.addRelation({
            sourceId: localSourceId,
            targetId: localTargetId,
            type: serverRelation.type as RelationType,
            properties: serverRelation.properties ?? {},
          })
          if (localRel) {
            this.relationMap.set(localRel.id, serverRelation.id)
          }
        }
      }

      await this.persistSyncMeta()
      return true
    } catch (err) {
      logger.agent.warn('[GraphSync] Extract graph failed:', err)
      return false
    }
  }

  async getGraphStats(): Promise<{
    entityCount: number
    relationCount: number
    entitiesByType: Record<string, number>
    relationsByType: Record<string, number>
  } | null> {
    if (!isAuthenticated()) return null

    try {
      return await backendApi.get('/api/v1/knowledge/graph/stats')
    } catch (err) {
      logger.agent.warn('[GraphSync] Get stats failed:', err)
      return null
    }
  }

  async getSyncStatus(): Promise<{ isSyncing: boolean; lastSyncAt: string | null }> {
    const meta = await this.loadSyncMeta()
    return { isSyncing: this.isSyncing, lastSyncAt: meta.lastSyncAt }
  }

  private getLocalEntitiesAsArray(): KnowledgeEntity[] {
    const stats = projectKnowledgeGraph.getStats()
    if (stats.entityCount === 0) return []
    const results: KnowledgeEntity[] = []
    for (const type of ['file', 'module', 'function', 'class', 'interface', 'component', 'api_endpoint', 'database_table', 'config', 'dependency', 'concept'] as EntityType[]) {
      const entities = projectKnowledgeGraph.getEntitiesByType(type)
      results.push(...entities)
    }
    return results
  }

  private getLocalRelationsAsArray(): KnowledgeRelation[] {
    const entities = this.getLocalEntitiesAsArray()
    const seen = new Set<string>()
    const results: KnowledgeRelation[] = []
    for (const entity of entities) {
      const rels = projectKnowledgeGraph.getRelations(entity.id)
      for (const rel of rels) {
        if (!seen.has(rel.id)) {
          seen.add(rel.id)
          results.push(rel)
        }
      }
    }
    return results
  }

  private async loadSyncMeta(): Promise<GraphSyncMeta> {
    try {
      const raw = await this.storage.get<string>(GRAPH_SYNC_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        return {
          lastSyncAt: parsed.lastSyncAt ?? null,
          serverEntityIdMap: parsed.serverEntityIdMap ?? {},
          serverRelationIdMap: parsed.serverRelationIdMap ?? {},
        }
      }
    } catch {
      // fall through
    }

    try {
      const raw = StorageService.get<any>(GRAPH_SYNC_KEY)
      if (raw) {
        const parsed = raw
        const meta: GraphSyncMeta = {
          lastSyncAt: parsed.lastSyncAt ?? null,
          serverEntityIdMap: parsed.serverEntityIdMap ?? {},
          serverRelationIdMap: parsed.serverRelationIdMap ?? {},
        }
        await this.storage.set(GRAPH_SYNC_KEY, JSON.stringify(meta))
        StorageService.remove(GRAPH_SYNC_KEY)
        return meta
      }
    } catch {
      // fall through
    }

    return { lastSyncAt: null, serverEntityIdMap: {}, serverRelationIdMap: {} }
  }

  private async persistSyncMeta(): Promise<void> {
    const meta: GraphSyncMeta = {
      lastSyncAt: new Date().toISOString(),
      serverEntityIdMap: this.entityMap.toObject(),
      serverRelationIdMap: this.relationMap.toObject(),
    }
    await this.storage.set(GRAPH_SYNC_KEY, JSON.stringify(meta))
  }
}

export const knowledgeGraphSyncService = new KnowledgeGraphSyncService()
