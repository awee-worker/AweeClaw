import { backendApi, isAuthenticated } from '../../../adapters/backendApi'
import { logger } from '@toolkit/LogEngine'
import {
  projectKnowledgeGraph,
  type KnowledgeEntity,
  type KnowledgeRelation,
  type EntityType,
  type RelationType,
} from '../../cognitive/ProjectKnowledgeGraph'

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

const GRAPH_SYNC_META_KEY = 'knowledge_graph_sync_meta'
const GRAPH_SYNC_INTERVAL_MS = 10 * 60 * 1000

class KnowledgeGraphSyncService {
  private syncTimer: ReturnType<typeof setInterval> | null = null
  private isSyncing = false

  startAutoSync(): void {
    if (this.syncTimer) return
    this.syncTimer = setInterval(() => {
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

    this.isSyncing = true
    try {
      const meta = this.loadSyncMeta()
      const stats = projectKnowledgeGraph.getStats()

      let syncedEntities = 0
      let syncedRelations = 0

      const serverEntities = await backendApi.get<ServerGraphEntity[]>(
        '/api/v1/knowledge/graph/entities',
      )

      const localEntities = this.getLocalEntitiesAsArray()
      const reverseEntityMap = new Map<string, string>()
      for (const [localId, serverId] of Object.entries(meta.serverEntityIdMap)) {
        reverseEntityMap.set(serverId, localId)
      }

      for (const serverEntity of serverEntities ?? []) {
        const existingLocalId = reverseEntityMap.get(serverEntity.id)
        if (!existingLocalId) {
          const localEntity = projectKnowledgeGraph.addEntity({
            name: serverEntity.name,
            type: serverEntity.type as EntityType,
            properties: serverEntity.properties ?? {},
          })
          meta.serverEntityIdMap[localEntity.id] = serverEntity.id
        }
      }

      for (const localEntity of localEntities) {
        const serverId = meta.serverEntityIdMap[localEntity.id]
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
            meta.serverEntityIdMap[localEntity.id] = result.id
            syncedEntities++
          } catch (err) {
            logger.agent.warn(`[GraphSync] Failed to push entity "${localEntity.name}":`, err)
          }
        }
      }

      const serverRelations = await backendApi.get<ServerGraphRelation[]>(
        '/api/v1/knowledge/graph/relations',
      )

      const reverseRelationMap = new Map<string, string>()
      for (const [localId, serverId] of Object.entries(meta.serverRelationIdMap)) {
        reverseRelationMap.set(serverId, localId)
      }

      for (const serverRelation of serverRelations ?? []) {
        const existingLocalId = reverseRelationMap.get(serverRelation.id)
        if (!existingLocalId) {
          const localSourceId = this.findLocalIdByServerId(serverRelation.sourceId, meta.serverEntityIdMap)
          const localTargetId = this.findLocalIdByServerId(serverRelation.targetId, meta.serverEntityIdMap)
          if (localSourceId && localTargetId) {
            const localRel = projectKnowledgeGraph.addRelation({
              sourceId: localSourceId,
              targetId: localTargetId,
              type: serverRelation.type as RelationType,
              properties: serverRelation.properties ?? {},
            })
            if (localRel) {
              meta.serverRelationIdMap[localRel.id] = serverRelation.id
            }
          }
        }
      }

      const localRelations = this.getLocalRelationsAsArray()
      for (const localRel of localRelations) {
        const serverId = meta.serverRelationIdMap[localRel.id]
        if (!serverId) {
          const serverSourceId = meta.serverEntityIdMap[localRel.sourceId]
          const serverTargetId = meta.serverEntityIdMap[localRel.targetId]
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
            meta.serverRelationIdMap[localRel.id] = result.id
            syncedRelations++
          } catch (err) {
            logger.agent.warn(`[GraphSync] Failed to push relation:`, err)
          }
        }
      }

      meta.lastSyncAt = new Date().toISOString()
      this.saveSyncMeta(meta)

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
      const serverEntities = await backendApi.get<ServerGraphEntity[]>(
        '/api/v1/knowledge/graph/entities',
      )

      if (!serverEntities || serverEntities.length === 0) return 0

      const meta = this.loadSyncMeta()
      const reverseEntityMap = new Map<string, string>()
      for (const [localId, serverId] of Object.entries(meta.serverEntityIdMap)) {
        reverseEntityMap.set(serverId, localId)
      }

      let pulled = 0
      for (const serverEntity of serverEntities) {
        const existingLocalId = reverseEntityMap.get(serverEntity.id)
        if (!existingLocalId) {
          const localEntity = projectKnowledgeGraph.addEntity({
            name: serverEntity.name,
            type: serverEntity.type as EntityType,
            properties: serverEntity.properties ?? {},
          })
          meta.serverEntityIdMap[localEntity.id] = serverEntity.id
          pulled++
        }
      }

      const serverRelations = await backendApi.get<ServerGraphRelation[]>(
        '/api/v1/knowledge/graph/relations',
      )

      const reverseRelationMap = new Map<string, string>()
      for (const [localId, serverId] of Object.entries(meta.serverRelationIdMap)) {
        reverseRelationMap.set(serverId, localId)
      }

      for (const serverRelation of serverRelations ?? []) {
        const existingLocalId = reverseRelationMap.get(serverRelation.id)
        if (!existingLocalId) {
          const localSourceId = this.findLocalIdByServerId(serverRelation.sourceId, meta.serverEntityIdMap)
          const localTargetId = this.findLocalIdByServerId(serverRelation.targetId, meta.serverEntityIdMap)
          if (localSourceId && localTargetId) {
            const localRel = projectKnowledgeGraph.addRelation({
              sourceId: localSourceId,
              targetId: localTargetId,
              type: serverRelation.type as RelationType,
              properties: serverRelation.properties ?? {},
            })
            if (localRel) {
              meta.serverRelationIdMap[localRel.id] = serverRelation.id
              pulled++
            }
          }
        }
      }

      if (pulled > 0) {
        this.saveSyncMeta(meta)
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
      const meta = this.loadSyncMeta()
      const serverEntryId = meta.serverEntityIdMap[entryId]

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
        meta.serverEntityIdMap[localEntity.id] = serverEntity.id
      }

      for (const serverRelation of result.relations ?? []) {
        const localSourceId = this.findLocalIdByServerId(serverRelation.sourceId, meta.serverEntityIdMap)
        const localTargetId = this.findLocalIdByServerId(serverRelation.targetId, meta.serverEntityIdMap)
        if (localSourceId && localTargetId) {
          const localRel = projectKnowledgeGraph.addRelation({
            sourceId: localSourceId,
            targetId: localTargetId,
            type: serverRelation.type as RelationType,
            properties: serverRelation.properties ?? {},
          })
          if (localRel) {
            meta.serverRelationIdMap[localRel.id] = serverRelation.id
          }
        }
      }

      this.saveSyncMeta(meta)
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

  getSyncStatus(): { isSyncing: boolean; lastSyncAt: string | null } {
    const meta = this.loadSyncMeta()
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

  private findLocalIdByServerId(
    serverId: string,
    serverEntityIdMap: Record<string, string>,
  ): string | null {
    for (const [localId, sid] of Object.entries(serverEntityIdMap)) {
      if (sid === serverId) return localId
    }
    return null
  }

  private loadSyncMeta(): GraphSyncMeta {
    try {
      const raw = localStorage.getItem(GRAPH_SYNC_META_KEY)
      if (raw) return JSON.parse(raw)
    } catch {}
    return { lastSyncAt: null, serverEntityIdMap: {}, serverRelationIdMap: {} }
  }

  private saveSyncMeta(meta: GraphSyncMeta): void {
    try {
      localStorage.setItem(GRAPH_SYNC_META_KEY, JSON.stringify(meta))
    } catch (err) {
      logger.agent.warn('[GraphSync] Failed to save sync meta:', err)
    }
  }
}

export const knowledgeGraphSyncService = new KnowledgeGraphSyncService()
