import { logger } from '@toolkit/LogEngine'
import {
  type EntityType,
  type RelationType,
} from '../../cognitive/ProjectKnowledgeGraph'

export interface ExtractedEntity {
  name: string
  type: EntityType
  properties: Record<string, unknown>
}

export interface ExtractedRelation {
  sourceName: string
  targetName: string
  type: RelationType
  properties: Record<string, unknown>
}

export interface GraphExtractionResult {
  entities: ExtractedEntity[]
  relations: ExtractedRelation[]
}

interface ExtractionPattern {
  regex: RegExp
  entityType: EntityType
  nameGroup: number
}

interface RelationPattern {
  regex: RegExp
  relationType: RelationType
  sourceGroup: number
  targetGroup: number
}

const ENTITY_PATTERNS: ExtractionPattern[] = [
  { regex: /类\s+[`"']?([A-Z][\w]+)[`"']?/g, entityType: 'class', nameGroup: 1 },
  { regex: /class\s+[`"']?([A-Z][\w]+)[`"']?/gi, entityType: 'class', nameGroup: 1 },
  { regex: /接口\s+[`"']?([A-Z][\w]+)[`"']?/g, entityType: 'interface', nameGroup: 1 },
  { regex: /interface\s+[`"']?([A-Z][\w]+)[`"']?/gi, entityType: 'interface', nameGroup: 1 },
  { regex: /函数\s+[`"']?([a-z][\w]*)[`"']?/g, entityType: 'function', nameGroup: 1 },
  { regex: /function\s+[`"']?([a-z][\w]*)[`"']?/gi, entityType: 'function', nameGroup: 1 },
  { regex: /方法\s+[`"']?([a-z][\w]*)[`"']?/g, entityType: 'function', nameGroup: 1 },
  { regex: /模块\s+[`"']?([\w@/\-]+)[`"']?/g, entityType: 'module', nameGroup: 1 },
  { regex: /module\s+[`"']?([\w@/\-]+)[`"']?/gi, entityType: 'module', nameGroup: 1 },
  { regex: /组件\s+[`"']?([A-Z][\w]*)[`"']?/g, entityType: 'component', nameGroup: 1 },
  { regex: /component\s+[`"']?([A-Z][\w]*)[`"']?/gi, entityType: 'component', nameGroup: 1 },
  { regex: /表\s+[`"']?(\w+)[`"']?/g, entityType: 'database_table', nameGroup: 1 },
  { regex: /table\s+[`"']?(\w+)[`"']?/gi, entityType: 'database_table', nameGroup: 1 },
  { regex: /API\s+[`"']?([/\w{}\-]+)[`"']?/gi, entityType: 'api_endpoint', nameGroup: 1 },
  { regex: /端点\s+[`"']?([/\w{}\-]+)[`"']?/g, entityType: 'api_endpoint', nameGroup: 1 },
  { regex: /配置\s+[`"']?([\w.\-]+)[`"']?/g, entityType: 'config', nameGroup: 1 },
  { regex: /依赖\s+[`"']?([\w@/\-]+)[`"']?/g, entityType: 'dependency', nameGroup: 1 },
  { regex: /dependency\s+[`"']?([\w@/\-]+)[`"']?/gi, entityType: 'dependency', nameGroup: 1 },
  { regex: /文件\s+[`"']?([\w./\-]+)[`"']?/g, entityType: 'file', nameGroup: 1 },
  { regex: /file\s+[`"']?([\w./\-]+)[`"']?/gi, entityType: 'file', nameGroup: 1 },
]

const RELATION_PATTERNS: RelationPattern[] = [
  { regex: /([A-Za-z][\w]*)\s+(?:导入|import)\s+([A-Za-z][\w]*)/gi, relationType: 'imports', sourceGroup: 1, targetGroup: 2 },
  { regex: /([A-Za-z][\w]*)\s+(?:导出|export)\s+([A-Za-z][\w]*)/gi, relationType: 'exports', sourceGroup: 1, targetGroup: 2 },
  { regex: /([A-Za-z][\w]*)\s+(?:调用|call)\s+([A-Za-z][\w]*)/gi, relationType: 'calls', sourceGroup: 1, targetGroup: 2 },
  { regex: /([A-Za-z][\w]*)\s+(?:实现|implement)\s+([A-Za-z][\w]*)/gi, relationType: 'implements', sourceGroup: 1, targetGroup: 2 },
  { regex: /([A-Za-z][\w]*)\s+(?:继承|extend)\s+([A-Za-z][\w]*)/gi, relationType: 'extends', sourceGroup: 1, targetGroup: 2 },
  { regex: /([A-Za-z][\w]*)\s+(?:依赖|depend\s+on)\s+([A-Za-z][\w]*)/gi, relationType: 'depends_on', sourceGroup: 1, targetGroup: 2 },
  { regex: /([A-Za-z][\w]*)\s+(?:包含|contain)\s+([A-Za-z][\w]*)/gi, relationType: 'contains', sourceGroup: 1, targetGroup: 2 },
  { regex: /([A-Za-z][\w]*)\s+(?:引用|reference)\s+([A-Za-z][\w]*)/gi, relationType: 'references', sourceGroup: 1, targetGroup: 2 },
  { regex: /([A-Za-z][\w]*)\s+(?:关联|related\s+to)\s+([A-Za-z][\w]*)/gi, relationType: 'related_to', sourceGroup: 1, targetGroup: 2 },
]

const CONCEPT_PATTERNS: Array<{ regex: RegExp; concept: string }> = [
  { regex: /React|Vue|Angular|Svelte|Next\.?js|Nuxt/i, concept: 'Frontend Framework' },
  { regex: /TypeScript|JavaScript|Python|Java|Go|Ruby|Rust|C\+\+|Kotlin|Swift/i, concept: 'Programming Language' },
  { regex: /PostgreSQL|MySQL|MongoDB|Redis|SQLite|Elasticsearch|DynamoDB/i, concept: 'Database' },
  { regex: /Docker|Kubernetes|AWS|GCP|Azure|Terraform|Ansible/i, concept: 'Infrastructure' },
  { regex: /REST|GraphQL|gRPC|WebSocket|MQTT/i, concept: 'API Protocol' },
  { regex: /Git|GitHub|GitLab|CI\/CD|Jenkins|GitHub\s+Actions/i, concept: 'DevOps' },
  { regex: /JWT|OAuth|SSO|SAML|RBAC|ABAC/i, concept: 'Authentication' },
  { regex: /微服务|单体|SOA|事件驱动|CQRS|DDD/i, concept: 'Architecture Pattern' },
  { regex: /测试|单元测试|集成测试|E2E|TDD|BDD/i, concept: 'Testing' },
  { regex: /缓存|消息队列|负载均衡|CDN|限流|熔断/i, concept: 'System Design' },
]

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
  'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
  'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
  'once', 'and', 'but', 'or', 'nor', 'not', 'so', 'yet', 'both',
  'either', 'neither', 'each', 'every', 'all', 'any', 'few', 'more',
  'most', 'other', 'some', 'such', 'no', 'only', 'own', 'same', 'than',
  'too', 'very', 'just', 'because', 'if', 'when', 'where', 'how',
  'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those',
  '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都',
  '一', '一个', '上', '也', '很', '到', '说', '要', '去', '你',
  '会', '着', '没有', '看', '好', '自己', '这',
])

class LocalGraphExtractor {
  extract(title: string, content: string, tags: string[] = []): GraphExtractionResult {
    const text = `${title}\n${content}`
    const entityMap = new Map<string, ExtractedEntity>()
    const relations: ExtractedRelation[] = []

    this.extractByPatterns(text, entityMap, relations)
    this.extractConcepts(text, entityMap)
    this.extractFromTags(tags, entityMap)
    this.inferRelationsFromContext(entityMap, relations)

    const deduplicatedRelations = this.deduplicateRelations(relations)

    return {
      entities: Array.from(entityMap.values()),
      relations: deduplicatedRelations,
    }
  }

  private extractByPatterns(
    text: string,
    entityMap: Map<string, ExtractedEntity>,
    relations: ExtractedRelation[],
  ): void {
    for (const pattern of ENTITY_PATTERNS) {
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags)
      let match: RegExpExecArray | null

      while ((match = regex.exec(text)) !== null) {
        const name = match[pattern.nameGroup]?.trim()
        if (!name || name.length < 2 || name.length > 60) continue
        if (STOP_WORDS.has(name.toLowerCase())) continue
        if (/^\d+$/.test(name)) continue

        const key = `${pattern.entityType}:${name.toLowerCase()}`
        if (!entityMap.has(key)) {
          entityMap.set(key, {
            name,
            type: pattern.entityType,
            properties: { extractedBy: 'rule' },
          })
        }
      }
    }

    for (const pattern of RELATION_PATTERNS) {
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags)
      let match: RegExpExecArray | null

      while ((match = regex.exec(text)) !== null) {
        const sourceName = match[pattern.sourceGroup]?.trim()
        const targetName = match[pattern.targetGroup]?.trim()
        if (!sourceName || !targetName) continue
        if (sourceName.toLowerCase() === targetName.toLowerCase()) continue

        relations.push({
          sourceName,
          targetName,
          type: pattern.relationType,
          properties: { extractedBy: 'rule' },
        })
      }
    }
  }

  private extractConcepts(
    text: string,
    entityMap: Map<string, ExtractedEntity>,
  ): void {
    for (const { regex, concept } of CONCEPT_PATTERNS) {
      if (regex.test(text)) {
        const key = `concept:${concept.toLowerCase()}`
        if (!entityMap.has(key)) {
          entityMap.set(key, {
            name: concept,
            type: 'concept',
            properties: { extractedBy: 'rule', isAutoDetected: true },
          })
        }
      }
    }
  }

  private extractFromTags(
    tags: string[],
    entityMap: Map<string, ExtractedEntity>,
  ): void {
    for (const tag of tags) {
      const trimmed = tag.trim()
      if (trimmed.length < 2 || trimmed.length > 40) continue
      if (STOP_WORDS.has(trimmed.toLowerCase())) continue

      const key = `concept:${trimmed.toLowerCase()}`
      if (!entityMap.has(key)) {
        entityMap.set(key, {
          name: trimmed,
          type: 'concept',
          properties: { extractedBy: 'tag', isAutoDetected: true },
        })
      }
    }
  }

  private inferRelationsFromContext(
    entityMap: Map<string, ExtractedEntity>,
    relations: ExtractedRelation[],
  ): void {
    const entities = Array.from(entityMap.values())
    const entityNames = new Map(entities.map(e => [e.name.toLowerCase(), e]))

    for (const entity of entities) {
      if (entity.type === 'class') {
        const ifaceKey = `interface:${entity.name.toLowerCase()}`
        const ifaceEntity = entityMap.get(ifaceKey)
        if (ifaceEntity) {
          relations.push({
            sourceName: entity.name,
            targetName: ifaceEntity.name,
            type: 'implements',
            properties: { extractedBy: 'inference', confidence: 0.6 },
          })
        }
      }

      if (entity.type === 'component') {
        const svcKey = `api_endpoint:${entity.name.toLowerCase()}`
        const svcEntity = entityMap.get(svcKey)
        if (svcEntity) {
          relations.push({
            sourceName: entity.name,
            targetName: svcEntity.name,
            type: 'depends_on',
            properties: { extractedBy: 'inference', confidence: 0.5 },
          })
        }
      }

      if (entity.type === 'module') {
        const modName = entity.name.toLowerCase()
        for (const other of entities) {
          if (other.name === entity.name && other.type === entity.type) continue
          if (other.name.toLowerCase().startsWith(modName + '/') || modName.startsWith(other.name.toLowerCase() + '/')) {
            relations.push({
              sourceName: entity.name,
              targetName: other.name,
              type: 'related_to',
              properties: { extractedBy: 'inference', confidence: 0.4 },
            })
          }
        }
      }
    }

    const conceptEntities = entities.filter(e => e.type === 'concept')
    const techEntities = entities.filter(e => e.type !== 'concept')
    for (const concept of conceptEntities) {
      for (const tech of techEntities.slice(0, 3)) {
        if (!relations.some(r =>
          (r.sourceName === concept.name && r.targetName === tech.name) ||
          (r.sourceName === tech.name && r.targetName === concept.name)
        )) {
          relations.push({
            sourceName: tech.name,
            targetName: concept.name,
            type: 'related_to',
            properties: { extractedBy: 'inference', confidence: 0.3 },
          })
        }
      }
    }
  }

  private deduplicateRelations(relations: ExtractedRelation[]): ExtractedRelation[] {
    const seen = new Set<string>()
    return relations.filter(r => {
      const key = `${r.sourceName.toLowerCase()}→${r.type}→${r.targetName.toLowerCase()}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }
}

export const localGraphExtractor = new LocalGraphExtractor()
