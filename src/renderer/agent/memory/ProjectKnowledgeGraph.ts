import { logger } from '@utils/Logger'

export interface KnowledgeEntity {
  id: string
  name: string
  type: EntityType
  properties: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

export interface KnowledgeRelation {
  id: string
  sourceId: string
  targetId: string
  type: RelationType
  properties: Record<string, unknown>
  createdAt: number
}

export type EntityType =
  | 'file'
  | 'module'
  | 'function'
  | 'class'
  | 'interface'
  | 'component'
  | 'api_endpoint'
  | 'database_table'
  | 'config'
  | 'dependency'
  | 'concept'

export type RelationType =  | 'imports'
  | 'exports'
  | 'calls'
  | 'implements'
  | 'extends'
  | 'depends_on'
  | 'contains'
  | 'references'
  | 'related_to'

interface GraphQueryResult {
  entities: KnowledgeEntity[]
  relations: KnowledgeRelation[]
  paths: KnowledgeEntity[][]
}

export class ProjectKnowledgeGraph {
  private entities = new Map<string, KnowledgeEntity>()
  private relations = new Map<string, KnowledgeRelation>()
  private nameIndex = new Map<string, Set<string>>()
  private typeIndex = new Map<string, Set<string>>()
  private initialized = false

  async init(data?: string): Promise<void> {
    if (this.initialized) return

    if (data) {
      try {
        const parsed = JSON.parse(data)
        this.loadFromJSON(parsed)
      } catch {
        logger.agent.warn('[KnowledgeGraph] Failed to parse stored data')
      }
    }

    this.initialized = true
    logger.agent.info(`[KnowledgeGraph] Initialized with ${this.entities.size} entities, ${this.relations.size} relations`)
  }

  serialize(): string {
    return JSON.stringify({
      version: 1,
      entities: Array.from(this.entities.values()),
      relations: Array.from(this.relations.values()),
    }, null, 2)
  }

  addEntity(entity: Omit<KnowledgeEntity, 'id' | 'createdAt' | 'updatedAt'>): KnowledgeEntity {
    const existing = this.findEntityByName(entity.name, entity.type)
    if (existing) {
      existing.properties = { ...existing.properties, ...entity.properties }
      existing.updatedAt = Date.now()
      return existing
    }

    const newEntity: KnowledgeEntity = {
      ...entity,
      id: `entity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    this.entities.set(newEntity.id, newEntity)
    this.indexEntity(newEntity)

    return newEntity
  }

  addRelation(relation: Omit<KnowledgeRelation, 'id' | 'createdAt'>): KnowledgeRelation | null {
    if (!this.entities.has(relation.sourceId) || !this.entities.has(relation.targetId)) {
      return null
    }

    const existing = this.findRelation(relation.sourceId, relation.targetId, relation.type)
    if (existing) return existing

    const newRelation: KnowledgeRelation = {
      ...relation,
      id: `rel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
    }

    this.relations.set(newRelation.id, newRelation)
    return newRelation
  }

  removeEntity(entityId: string): boolean {
    const entity = this.entities.get(entityId)
    if (!entity) return false

    this.entities.delete(entityId)
    this.removeFromIndex(entity)

    for (const [relId, rel] of this.relations) {
      if (rel.sourceId === entityId || rel.targetId === entityId) {
        this.relations.delete(relId)
      }
    }

    return true
  }

  getEntity(id: string): KnowledgeEntity | undefined {
    return this.entities.get(id)
  }

  getEntitiesByType(type: EntityType): KnowledgeEntity[] {
    const ids = this.typeIndex.get(type)
    if (!ids) return []
    return Array.from(ids).map(id => this.entities.get(id)).filter((e): e is KnowledgeEntity => !!e)
  }

  getRelations(entityId: string, direction: 'outgoing' | 'incoming' | 'both' = 'both'): KnowledgeRelation[] {
    return Array.from(this.relations.values()).filter(r => {
      if (direction === 'outgoing') return r.sourceId === entityId
      if (direction === 'incoming') return r.targetId === entityId
      return r.sourceId === entityId || r.targetId === entityId
    })
  }

  getNeighbors(entityId: string, depth: number = 1): GraphQueryResult {
    const visited = new Set<string>()
    const resultEntities: KnowledgeEntity[] = []
    const resultRelations: KnowledgeRelation[] = []

    const traverse = (id: string, currentDepth: number): void => {
      if (currentDepth > depth || visited.has(id)) return
      visited.add(id)

      const entity = this.entities.get(id)
      if (!entity) return
      resultEntities.push(entity)

      const rels = this.getRelations(id)
      for (const rel of rels) {
        resultRelations.push(rel)
        const neighborId = rel.sourceId === id ? rel.targetId : rel.sourceId
        traverse(neighborId, currentDepth + 1)
      }
    }

    traverse(entityId, 0)

    return {
      entities: resultEntities,
      relations: resultRelations,
      paths: [],
    }
  }

  findPath(fromId: string, toId: string, maxDepth: number = 5): KnowledgeEntity[] {
    const queue: Array<{ id: string; path: KnowledgeEntity[] }> = [
      { id: fromId, path: [this.entities.get(fromId)!].filter(Boolean) },
    ]
    const visited = new Set<string>([fromId])

    while (queue.length > 0) {
      const { id, path } = queue.shift()!

      if (id === toId) return path

      if (path.length >= maxDepth) continue

      const rels = this.getRelations(id)
      for (const rel of rels) {
        const neighborId = rel.sourceId === id ? rel.targetId : rel.sourceId
        if (visited.has(neighborId)) continue

        visited.add(neighborId)
        const neighbor = this.entities.get(neighborId)
        if (neighbor) {
          queue.push({ id: neighborId, path: [...path, neighbor] })
        }
      }
    }

    return []
  }

  search(query: string, limit: number = 20): KnowledgeEntity[] {
    const lowerQuery = query.toLowerCase()
    const results: Array<{ entity: KnowledgeEntity; score: number }> = []

    for (const entity of this.entities.values()) {
      let score = 0

      if (entity.name.toLowerCase().includes(lowerQuery)) score += 3
      if (entity.name.toLowerCase() === lowerQuery) score += 5

      for (const value of Object.values(entity.properties)) {
        if (typeof value === 'string' && value.toLowerCase().includes(lowerQuery)) {
          score += 1
        }
      }

      if (score > 0) {
        results.push({ entity, score })
      }
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(r => r.entity)
  }

  buildContextPrompt(entityId: string, depth: number = 2, maxTokens: number = 1500): string {
    const neighbors = this.getNeighbors(entityId, depth)
    if (neighbors.entities.length === 0) return ''

    const lines: string[] = []
    let estimatedTokens = 0

    for (const entity of neighbors.entities) {
      const rels = neighbors.relations.filter(r => r.sourceId === entity.id || r.targetId === entity.id)
      const relDescriptions = rels.map(r => {
        const source = this.entities.get(r.sourceId)?.name ?? 'unknown'
        const target = this.entities.get(r.targetId)?.name ?? 'unknown'
        return `${source} --${r.type}--> ${target}`
      })

      const line = `[${entity.type}] ${entity.name}${relDescriptions.length > 0 ? ` | Relations: ${relDescriptions.join(', ')}` : ''}`
      const estimatedLineTokens = Math.ceil(line.length / 4)

      if (estimatedTokens + estimatedLineTokens > maxTokens) break

      lines.push(line)
      estimatedTokens += estimatedLineTokens
    }

    if (lines.length === 0) return ''

    return `<project_knowledge>
Project structure and relationships:

${lines.join('\n')}
</project_knowledge>`
  }

  getStats(): { entityCount: number; relationCount: number; entityTypes: Record<string, number>; relationTypes: Record<string, number> } {
    const entityTypes: Record<string, number> = {}
    const relationTypes: Record<string, number> = {}

    for (const entity of this.entities.values()) {
      entityTypes[entity.type] = (entityTypes[entity.type] ?? 0) + 1
    }
    for (const rel of this.relations.values()) {
      relationTypes[rel.type] = (relationTypes[rel.type] ?? 0) + 1
    }

    return {
      entityCount: this.entities.size,
      relationCount: this.relations.size,
      entityTypes,
      relationTypes,
    }
  }

  clear(): void {
    this.entities.clear()
    this.relations.clear()
    this.nameIndex.clear()
    this.typeIndex.clear()
  }

  private indexEntity(entity: KnowledgeEntity): void {
    const nameKey = entity.name.toLowerCase()
    let nameSet = this.nameIndex.get(nameKey)
    if (!nameSet) {
      nameSet = new Set()
      this.nameIndex.set(nameKey, nameSet)
    }
    nameSet.add(entity.id)

    let typeSet = this.typeIndex.get(entity.type)
    if (!typeSet) {
      typeSet = new Set()
      this.typeIndex.set(entity.type, typeSet)
    }
    typeSet.add(entity.id)
  }

  private removeFromIndex(entity: KnowledgeEntity): void {
    const nameKey = entity.name.toLowerCase()
    const nameSet = this.nameIndex.get(nameKey)
    if (nameSet) {
      nameSet.delete(entity.id)
      if (nameSet.size === 0) this.nameIndex.delete(nameKey)
    }

    const typeSet = this.typeIndex.get(entity.type)
    if (typeSet) {
      typeSet.delete(entity.id)
      if (typeSet.size === 0) this.typeIndex.delete(entity.type)
    }
  }

  private findEntityByName(name: string, type: string): KnowledgeEntity | undefined {
    const ids = this.nameIndex.get(name.toLowerCase())
    if (!ids) return undefined
    for (const id of ids) {
      const entity = this.entities.get(id)
      if (entity && entity.type === type) return entity
    }
    return undefined
  }

  private findRelation(sourceId: string, targetId: string, type: string): KnowledgeRelation | undefined {
    for (const rel of this.relations.values()) {
      if (rel.sourceId === sourceId && rel.targetId === targetId && rel.type === type) {
        return rel
      }
    }
    return undefined
  }

  private loadFromJSON(data: { entities?: unknown[]; relations?: unknown[] }): void {
    if (Array.isArray(data.entities)) {
      for (const raw of data.entities) {
        if (!raw || typeof raw !== 'object') continue
        const e = raw as KnowledgeEntity
        if (e.id && e.name && e.type) {
          this.entities.set(e.id, e)
          this.indexEntity(e)
        }
      }
    }

    if (Array.isArray(data.relations)) {
      for (const raw of data.relations) {
        if (!raw || typeof raw !== 'object') continue
        const r = raw as KnowledgeRelation
        if (r.id && r.sourceId && r.targetId && r.type) {
          this.relations.set(r.id, r)
        }
      }
    }
  }
}

export const projectKnowledgeGraph = new ProjectKnowledgeGraph()
