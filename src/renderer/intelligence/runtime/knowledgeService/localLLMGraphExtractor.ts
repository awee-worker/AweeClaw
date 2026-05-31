import { api } from '../../../adapters/electronBridge'
import { logger } from '@toolkit/LogEngine'
import { getLLMConfigForTask } from '../modelConfigService'
import { useStore } from '@store'
import type { GraphExtractionResult, ExtractedEntity, ExtractedRelation } from './localGraphExtractor'
import { localGraphExtractor } from './localGraphExtractor'

const EXTRACTION_SYSTEM_PROMPT = `You are a knowledge graph extraction expert. Given a knowledge entry's title, content, and tags, extract entities and relationships.

Output a JSON object with this exact structure:
{
  "entities": [
    {"name": "entity name", "type": "one of: class|interface|function|module|component|api_endpoint|database_table|config|dependency|concept|file", "properties": {}}
  ],
  "relations": [
    {"sourceName": "source entity name", "targetName": "target entity name", "type": "one of: imports|exports|calls|implements|extends|depends_on|contains|references|related_to", "properties": {}}
  ]
}

Rules:
- Extract ONLY entities explicitly mentioned in the text
- Use precise names as they appear (e.g., class names with exact casing)
- Each relation must reference entity names from the entities list
- Do NOT invent entities or relations not supported by the text
- Keep properties minimal - only add well-known attributes
- For Chinese content, extract Chinese entity names as-is
- Maximum 15 entities and 20 relations per entry`

const MAX_CONTENT_LENGTH = 3000

interface LLMExtractionResponse {
  entities: Array<{ name: string; type: string; properties?: Record<string, unknown> }>
  relations: Array<{ sourceName: string; targetName: string; type: string; properties?: Record<string, unknown> }>
}

class LocalLLMGraphExtractor {
  async extract(title: string, content: string, tags: string[] = []): Promise<GraphExtractionResult> {
    const ruleResult = localGraphExtractor.extract(title, content, tags)

    try {
      const llmResult = await this.extractWithLLM(title, content, tags)
      if (llmResult) {
        return this.mergeResults(ruleResult, llmResult)
      }
    } catch (err) {
      logger.agent.warn('[LLMGraphExtractor] LLM extraction failed, using rule-based result:', err)
    }

    return ruleResult
  }

  private async extractWithLLM(title: string, content: string, tags: string[]): Promise<GraphExtractionResult | null> {
    const store = useStore.getState()
    const privacy = store.privacySettings

    if (privacy?.knowledgeSyncMode === 'local-only' && !store.llmConfig.apiKey) {
      logger.agent.debug('[LLMGraphExtractor] No API key configured, skipping LLM extraction')
      return null
    }

    const config = await getLLMConfigForTask(store.llmConfig.provider, store.llmConfig.model)
    if (!config) {
      logger.agent.debug('[LLMGraphExtractor] No LLM config available')
      return null
    }

    const truncatedContent = content.length > MAX_CONTENT_LENGTH
      ? content.slice(0, MAX_CONTENT_LENGTH) + '\n...[truncated]'
      : content

    const prompt = `Title: ${title}
Tags: ${tags.join(', ') || 'none'}

Content:
${truncatedContent}

Extract all entities and relationships from this knowledge entry.`

    try {
      const res = await api.llm.generateObject({
        config,
        schema: {
          type: 'object',
          properties: {
            entities: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  type: { type: 'string' },
                  properties: { type: 'object' },
                },
                required: ['name', 'type'],
              },
            },
            relations: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  sourceName: { type: 'string' },
                  targetName: { type: 'string' },
                  type: { type: 'string' },
                  properties: { type: 'object' },
                },
                required: ['sourceName', 'targetName', 'type'],
              },
            },
          },
          required: ['entities', 'relations'],
        },
        prompt,
        system: EXTRACTION_SYSTEM_PROMPT,
      })

      if (!res || typeof res !== 'object') return null

      const raw = res as { object?: unknown; usage?: unknown; error?: string }
      const data = (raw.object ?? raw) as unknown as LLMExtractionResponse
      if (!Array.isArray(data.entities) || !Array.isArray(data.relations)) return null

      const validEntityTypes = new Set([
        'class', 'interface', 'function', 'module', 'component',
        'api_endpoint', 'database_table', 'config', 'dependency', 'concept', 'file',
      ])
      const validRelationTypes = new Set([
        'imports', 'exports', 'calls', 'implements', 'extends',
        'depends_on', 'contains', 'references', 'related_to',
      ])

      const entities: ExtractedEntity[] = data.entities
        .filter(e => e.name && validEntityTypes.has(e.type))
        .map(e => ({
          name: e.name.trim(),
          type: e.type as ExtractedEntity['type'],
          properties: { ...e.properties, extractedBy: 'llm' },
        }))

      const entityNames = new Set(entities.map(e => e.name.toLowerCase()))

      const relations: ExtractedRelation[] = data.relations
        .filter(r =>
          r.sourceName && r.targetName && validRelationTypes.has(r.type) &&
          entityNames.has(r.sourceName.toLowerCase()) &&
          entityNames.has(r.targetName.toLowerCase()),
        )
        .map(r => ({
          sourceName: r.sourceName.trim(),
          targetName: r.targetName.trim(),
          type: r.type as ExtractedRelation['type'],
          properties: { ...r.properties, extractedBy: 'llm' },
        }))

      logger.agent.info(
        `[LLMGraphExtractor] Extracted ${entities.length} entities, ${relations.length} relations via LLM`,
      )

      return { entities, relations }
    } catch (err) {
      logger.agent.warn('[LLMGraphExtractor] LLM call failed:', err)
      return null
    }
  }

  private mergeResults(ruleResult: GraphExtractionResult, llmResult: GraphExtractionResult): GraphExtractionResult {
    const entityMap = new Map<string, ExtractedEntity>()
    const relationSet = new Set<string>()
    const relations: ExtractedRelation[] = []

    for (const e of ruleResult.entities) {
      entityMap.set(`${e.type}:${e.name.toLowerCase()}`, e)
    }
    for (const e of llmResult.entities) {
      const key = `${e.type}:${e.name.toLowerCase()}`
      if (!entityMap.has(key)) {
        entityMap.set(key, e)
      } else {
        const existing = entityMap.get(key)!
        entityMap.set(key, {
          ...existing,
          properties: { ...existing.properties, ...e.properties, sources: ['rule', 'llm'] },
        })
      }
    }

    const addRelation = (r: ExtractedRelation) => {
      const key = `${r.sourceName.toLowerCase()}→${r.type}→${r.targetName.toLowerCase()}`
      if (!relationSet.has(key)) {
        relationSet.add(key)
        relations.push(r)
      }
    }

    for (const r of ruleResult.relations) addRelation(r)
    for (const r of llmResult.relations) addRelation(r)

    return {
      entities: Array.from(entityMap.values()),
      relations,
    }
  }
}

export const localLLMGraphExtractor = new LocalLLMGraphExtractor()
