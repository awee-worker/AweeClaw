import { longTermMemoryService } from './registerHandlers'
import { api } from '../../../adapters/electronBridge'
import { logger } from '@toolkit/LogEngine'
import { useStore } from '@store'
import { getLLMConfigForTask } from '../modelConfigService'
import type { MemoryEntry, ReflectionInsight, ReflectionResult } from '@intelligence/providerTypes'

const REFLECTION_SCHEMA = {
  type: 'object' as const,
  properties: {
    insights: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          content: { type: 'string' as const, description: 'A synthesized insight derived from the memory entries' },
          type: { type: 'string' as const, enum: ['synthesis', 'contradiction', 'pattern', 'refinement'], description: 'The type of insight' },
          confidence: { type: 'number' as const, description: 'Confidence level 0-1' },
          tags: { type: 'array' as const, items: { type: 'string' as const }, description: 'Relevant tags' },
          sourceIndices: { type: 'array' as const, items: { type: 'number' as const }, description: 'Indices of source entries in the input' },
        },
        required: ['content', 'type', 'confidence', 'tags', 'sourceIndices'],
      },
    },
    contradictions: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          indexA: { type: 'number' as const, description: 'Index of first contradictory entry' },
          indexB: { type: 'number' as const, description: 'Index of second contradictory entry' },
          reason: { type: 'string' as const, description: 'Why these entries contradict' },
          resolution: { type: 'string' as const, description: 'Suggested resolution or which entry is more likely correct' },
        },
        required: ['indexA', 'indexB', 'reason', 'resolution'],
      },
    },
  },
  required: ['insights', 'contradictions'],
}

class ReflectiveDreamingService {
  async reflect(entries: MemoryEntry[]): Promise<ReflectionResult> {
    const result: ReflectionResult = {
      insights: [],
      contradictions: [],
      supersededIds: [],
      newEntryIds: [],
      timestamp: Date.now(),
    }

    if (entries.length < 3) return result

    const localInsights = this.localReflection(entries)
    result.insights.push(...localInsights)

    const llmInsights = await this.llmReflection(entries)
    if (llmInsights) {
      result.insights.push(...llmInsights.insights)
      result.contradictions.push(...llmInsights.contradictions)
    }

    await this.applyReflections(result, entries)

    return result
  }

  private localReflection(entries: MemoryEntry[]): ReflectionInsight[] {
    const insights: ReflectionInsight[] = []

    const tagGroups = new Map<string, MemoryEntry[]>()
    for (const entry of entries) {
      for (const tag of entry.tags) {
        const group = tagGroups.get(tag) ?? []
        group.push(entry)
        tagGroups.set(tag, group)
      }
    }

    for (const [tag, group] of tagGroups) {
      if (group.length < 3) continue

      const highConf = group.filter(e => e.confidence >= 0.8)
      if (highConf.length >= 2) {
        const contents = highConf.map(e => e.content).join('; ')
        if (contents.length <= 300) {
          insights.push({
            content: `[Pattern] ${contents}`,
            sourceIds: highConf.map(e => e.id),
            type: 'pattern',
            confidence: Math.min(1, Math.max(...highConf.map(e => e.confidence)) + 0.05),
            tags: [tag, 'pattern-detected'],
          })
        }
      }
    }

    const lowConfOld = entries.filter(e => {
      const ageDays = (Date.now() - e.createdAt) / 86_400_000
      return ageDays > 14 && e.confidence < 0.5 && e.recallCount === 0
    })

    for (const entry of lowConfOld.slice(0, 5)) {
      insights.push({
        content: `[Refinement] Low-confidence stale entry may need review: "${entry.content.slice(0, 80)}"`,
        sourceIds: [entry.id],
        type: 'refinement',
        confidence: 0.6,
        tags: [...entry.tags, 'needs-review'],
      })
    }

    return insights
  }

  private async llmReflection(entries: MemoryEntry[]): Promise<{
    insights: ReflectionInsight[]
    contradictions: Array<{ entryAId: string; entryBId: string; reason: string }>
  } | null> {
    try {
      const store = useStore.getState()
      const config = await getLLMConfigForTask(store.llmConfig.provider, store.llmConfig.model)
      if (!config) return null

      const entrySummaries = entries.slice(0, 30).map((e, i) =>
        `[${i}] (${e.confidence.toFixed(2)}, ${e.source}, tags: ${e.tags.join(',')}) ${e.content}`
      )

      const prompt = `You are a reflective AI examining its own memory. Analyze these memory entries and produce insights.

Memory entries:
${entrySummaries.join('\n')}

Your tasks:
1. SYNTHESIS: Combine related entries into higher-level insights that capture the essence of multiple entries
2. CONTRADICTION: Identify pairs of entries that contradict each other, and suggest which is more likely correct
3. PATTERN: Detect recurring patterns or themes across entries
4. REFINEMENT: Suggest improvements to vague or low-confidence entries

Rules:
- Each insight must be a clear, standalone statement
- Only produce genuinely valuable insights, not trivial observations
- Maximum 5 insights total
- For contradictions, provide a clear resolution suggestion
- Do not repeat information already present in the entries`

      const res = await api.llm.generateObject({
        config,
        schema: REFLECTION_SCHEMA,
        prompt,
        system: 'You are an AI performing self-reflection on its memory. You synthesize insights, detect contradictions, and identify patterns. Be concise and insightful.',
      })

      if (!res || res.error || !res.object) return null

      const parsed = res.object
      const insights: ReflectionInsight[] = []
      const contradictions: Array<{ entryAId: string; entryBId: string; reason: string }> = []

      if (Array.isArray(parsed.insights)) {
        for (const raw of parsed.insights.slice(0, 5)) {
          if (!raw.content || typeof raw.content !== 'string') continue
          const sourceIds = Array.isArray(raw.sourceIndices)
            ? raw.sourceIndices.filter((i: number) => i >= 0 && i < entries.length).map((i: number) => entries[i].id)
            : []

          insights.push({
            content: raw.content.trim(),
            sourceIds,
            type: raw.type ?? 'synthesis',
            confidence: typeof raw.confidence === 'number' ? Math.min(1, raw.confidence) : 0.7,
            tags: Array.isArray(raw.tags) ? raw.tags.slice(0, 5) : ['reflection'],
          })
        }
      }

      if (Array.isArray(parsed.contradictions)) {
        for (const raw of parsed.contradictions.slice(0, 5)) {
          const idxA = raw.indexA
          const idxB = raw.indexB
          if (typeof idxA !== 'number' || typeof idxB !== 'number') continue
          if (idxA < 0 || idxA >= entries.length || idxB < 0 || idxB >= entries.length) continue

          contradictions.push({
            entryAId: entries[idxA].id,
            entryBId: entries[idxB].id,
            reason: raw.reason ?? 'Contradiction detected',
          })

          if (raw.resolution && raw.resolution.toLowerCase().includes('entry')) {
            const match = raw.resolution.match(/entry\s*(\d+)/i)
            if (match) {
              const resolvedIdx = parseInt(match[1])
              if (resolvedIdx === idxA || resolvedIdx === idxB) {
                const supersededIdx = resolvedIdx === idxA ? idxB : idxA
                const supersededEntry = entries[supersededIdx]
                const resolvedEntry = entries[resolvedIdx]
                if (supersededEntry.confidence < resolvedEntry.confidence) {
                  await longTermMemoryService.supersedeEntry(
                    supersededEntry.id,
                    resolvedEntry.content,
                    `LLM reflection: ${raw.reason}`,
                    { source: 'self_reflection', confidence: resolvedEntry.confidence }
                  )
                }
              }
            }
          }
        }
      }

      return { insights, contradictions }
    } catch (err) {
      logger.agent.warn('[ReflectiveDreaming] LLM reflection failed:', err)
      return null
    }
  }

  private async applyReflections(result: ReflectionResult, sourceEntries: MemoryEntry[]): Promise<void> {
    for (const insight of result.insights) {
      if (insight.type === 'synthesis' || insight.type === 'pattern') {
        try {
          const entry = await longTermMemoryService.addEntry({
            content: insight.content,
            source: 'self_reflection',
            status: 'short_term',
            confidence: insight.confidence,
            tags: insight.tags,
            derivedFrom: insight.sourceIds,
            verificationStatus: 'unverified',
          })
          result.newEntryIds.push(entry.id)
        } catch {
        }
      }
    }

    for (const contradiction of result.contradictions) {
      const entryA = sourceEntries.find(e => e.id === contradiction.entryAId)
      const entryB = sourceEntries.find(e => e.id === contradiction.entryBId)
      if (!entryA || !entryB) continue

      if (entryA.confidence < entryB.confidence - 0.2) {
        try {
          await longTermMemoryService.updateEntry(entryA.id, { verificationStatus: 'contradicted' })
          result.supersededIds.push(entryA.id)
        } catch {
        }
      } else if (entryB.confidence < entryA.confidence - 0.2) {
        try {
          await longTermMemoryService.updateEntry(entryB.id, { verificationStatus: 'contradicted' })
          result.supersededIds.push(entryB.id)
        } catch {
        }
      }
    }
  }
}

export const reflectiveDreamingService = new ReflectiveDreamingService()
