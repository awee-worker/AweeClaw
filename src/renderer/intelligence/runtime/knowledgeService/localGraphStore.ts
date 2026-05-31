import { logger } from '@toolkit/LogEngine'
import {
  projectKnowledgeGraph,
  type EntityType,
  type RelationType,
} from '../../cognitive/ProjectKnowledgeGraph'
import { localGraphExtractor, type GraphExtractionResult } from './localGraphExtractor'

const LOCAL_GRAPH_DB_NAME = 'aweeclaw_local_graph'
const LOCAL_GRAPH_DB_VERSION = 1
const ENTITIES_STORE = 'entities'
const RELATIONS_STORE = 'relations'

export interface LocalGraphEntity {
  id: string
  name: string
  type: string
  properties: Record<string, unknown>
  entryId: string | null
  createdAt: number
  updatedAt: number
}

export interface LocalGraphRelation {
  id: string
  sourceId: string
  targetId: string
  type: string
  properties: Record<string, unknown>
  createdAt: number
}

class LocalGraphStore {
  private db: IDBDatabase | null = null
  private initPromise: Promise<IDBDatabase> | null = null

  private async getDB(): Promise<IDBDatabase> {
    if (this.db) return this.db
    if (this.initPromise) return this.initPromise

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(LOCAL_GRAPH_DB_NAME, LOCAL_GRAPH_DB_VERSION)

      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(ENTITIES_STORE)) {
          const entityStore = db.createObjectStore(ENTITIES_STORE, { keyPath: 'id' })
          entityStore.createIndex('type', 'type', { unique: false })
          entityStore.createIndex('entryId', 'entryId', { unique: false })
          entityStore.createIndex('name', 'name', { unique: false })
        }
        if (!db.objectStoreNames.contains(RELATIONS_STORE)) {
          const relStore = db.createObjectStore(RELATIONS_STORE, { keyPath: 'id' })
          relStore.createIndex('sourceId', 'sourceId', { unique: false })
          relStore.createIndex('targetId', 'targetId', { unique: false })
          relStore.createIndex('type', 'type', { unique: false })
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

  async getEntities(options?: { type?: string; limit?: number }): Promise<LocalGraphEntity[]> {
    const db = await this.getDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(ENTITIES_STORE, 'readonly')
      const store = tx.objectStore(ENTITIES_STORE)
      const request = store.getAll()

      request.onsuccess = () => {
        let results: LocalGraphEntity[] = request.result ?? []
        if (options?.type) {
          results = results.filter(e => e.type === options.type)
        }
        if (options?.limit) {
          results = results.slice(0, options.limit)
        }
        resolve(results)
      }

      request.onerror = () => reject(request.error)
    })
  }

  async getRelations(options?: { entityId?: string; limit?: number }): Promise<LocalGraphRelation[]> {
    const db = await this.getDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(RELATIONS_STORE, 'readonly')
      const store = tx.objectStore(RELATIONS_STORE)
      const request = store.getAll()

      request.onsuccess = () => {
        let results: LocalGraphRelation[] = request.result ?? []
        if (options?.entityId) {
          results = results.filter(r => r.sourceId === options.entityId || r.targetId === options.entityId)
        }
        if (options?.limit) {
          results = results.slice(0, options.limit)
        }
        resolve(results)
      }

      request.onerror = () => reject(request.error)
    })
  }

  async getStats(): Promise<{ entityCount: number; relationCount: number; entitiesByType: Record<string, number>; relationsByType: Record<string, number> }> {
    const [entities, relations] = await Promise.all([
      this.getEntities(),
      this.getRelations(),
    ])

    const entitiesByType: Record<string, number> = {}
    const relationsByType: Record<string, number> = {}

    for (const e of entities) {
      entitiesByType[e.type] = (entitiesByType[e.type] ?? 0) + 1
    }
    for (const r of relations) {
      relationsByType[r.type] = (relationsByType[r.type] ?? 0) + 1
    }

    return {
      entityCount: entities.length,
      relationCount: relations.length,
      entitiesByType,
      relationsByType,
    }
  }

  async addEntity(entity: LocalGraphEntity): Promise<void> {
    const db = await this.getDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(ENTITIES_STORE, 'readwrite')
      const store = tx.objectStore(ENTITIES_STORE)
      const request = store.put(entity)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async addRelation(relation: LocalGraphRelation): Promise<void> {
    const db = await this.getDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(RELATIONS_STORE, 'readwrite')
      const store = tx.objectStore(RELATIONS_STORE)
      const request = store.put(relation)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async addEntitiesBatch(entities: LocalGraphEntity[]): Promise<void> {
    const db = await this.getDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(ENTITIES_STORE, 'readwrite')
      const store = tx.objectStore(ENTITIES_STORE)

      for (const entity of entities) {
        store.put(entity)
      }

      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  async addRelationsBatch(relations: LocalGraphRelation[]): Promise<void> {
    const db = await this.getDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(RELATIONS_STORE, 'readwrite')
      const store = tx.objectStore(RELATIONS_STORE)

      for (const relation of relations) {
        store.put(relation)
      }

      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  async deleteEntitiesByEntryId(entryId: string): Promise<void> {
    const db = await this.getDB()
    const entities = await this.getEntities()
    const toDelete = entities.filter(e => e.entryId === entryId)
    const deleteIds = new Set(toDelete.map(e => e.id))

    const tx = db.transaction([ENTITIES_STORE, RELATIONS_STORE], 'readwrite')
    const entityStore = tx.objectStore(ENTITIES_STORE)
    const relStore = tx.objectStore(RELATIONS_STORE)

    for (const entity of toDelete) {
      entityStore.delete(entity.id)
    }

    const allRelations = await this.getRelations()
    for (const rel of allRelations) {
      if (deleteIds.has(rel.sourceId) || deleteIds.has(rel.targetId)) {
        relStore.delete(rel.id)
      }
    }

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  async clear(): Promise<void> {
    const db = await this.getDB()
    const tx = db.transaction([ENTITIES_STORE, RELATIONS_STORE], 'readwrite')
    tx.objectStore(ENTITIES_STORE).clear()
    tx.objectStore(RELATIONS_STORE).clear()

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  async extractAndStore(entryId: string, title: string, content: string, tags: string[] = []): Promise<GraphExtractionResult> {
    const result = localGraphExtractor.extract(title, content, tags)

    const entityNameToId = new Map<string, string>()
    const now = Date.now()

    const localEntities: LocalGraphEntity[] = result.entities.map(e => {
      const id = `local-e-${now}-${Math.random().toString(36).slice(2, 8)}`
      entityNameToId.set(e.name.toLowerCase(), id)
      return {
        id,
        name: e.name,
        type: e.type,
        properties: e.properties,
        entryId,
        createdAt: now,
        updatedAt: now,
      }
    })

    const localRelations: LocalGraphRelation[] = []
    for (const r of result.relations) {
      const sourceId = entityNameToId.get(r.sourceName.toLowerCase())
      const targetId = entityNameToId.get(r.targetName.toLowerCase())
      if (!sourceId || !targetId) continue

      localRelations.push({
        id: `local-r-${now}-${Math.random().toString(36).slice(2, 8)}`,
        sourceId,
        targetId,
        type: r.type,
        properties: r.properties,
        createdAt: now,
      })
    }

    await this.deleteEntitiesByEntryId(entryId)
    await this.addEntitiesBatch(localEntities)
    await this.addRelationsBatch(localRelations)

    this.syncToInMemoryGraph()

    logger.agent.info(
      `[LocalGraphStore] Extracted ${localEntities.length} entities, ${localRelations.length} relations for entry ${entryId}`,
    )

    return result
  }

  async syncToInMemoryGraph(): Promise<void> {
    projectKnowledgeGraph.clear()

    const [entities, relations] = await Promise.all([
      this.getEntities(),
      this.getRelations(),
    ])

    const entityIdMap = new Map<string, string>()

    for (const e of entities) {
      const localEntity = projectKnowledgeGraph.addEntity({
        name: e.name,
        type: e.type as EntityType,
        properties: e.properties,
      })
      entityIdMap.set(e.id, localEntity.id)
    }

    for (const r of relations) {
      const sourceId = entityIdMap.get(r.sourceId)
      const targetId = entityIdMap.get(r.targetId)
      if (!sourceId || !targetId) continue

      projectKnowledgeGraph.addRelation({
        sourceId,
        targetId,
        type: r.type as RelationType,
        properties: r.properties,
      })
    }
  }

  async exportData(): Promise<{ entities: LocalGraphEntity[]; relations: LocalGraphRelation[] }> {
    const [entities, relations] = await Promise.all([
      this.getEntities(),
      this.getRelations(),
    ])
    return { entities, relations }
  }

  async importData(data: { entities: LocalGraphEntity[]; relations: LocalGraphRelation[] }): Promise<void> {
    await this.clear()
    if (data.entities?.length) {
      await this.addEntitiesBatch(data.entities)
    }
    if (data.relations?.length) {
      await this.addRelationsBatch(data.relations)
    }
    await this.syncToInMemoryGraph()
  }
}

export const localGraphStore = new LocalGraphStore()
