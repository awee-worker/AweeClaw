import { longTermMemoryService } from './registerHandlers'
import { logger } from '@toolkit/LogEngine'
import type { SelfLearningRecord, BehavioralPattern, LearningResult, LearningEventType } from '@intelligence/providerTypes'

const MAX_RECORDS = 1000
const PATTERN_MIN_FREQUENCY = 3
const STORAGE_KEY = 'aweeclaw-proactive-learning-records'
const PERSIST_DEBOUNCE_MS = 5000

class ProactiveLearningService {
  private records: SelfLearningRecord[] = []
  private loaded = false
  private persistTimer: ReturnType<typeof setTimeout> | null = null

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored)
        if (Array.isArray(parsed)) {
          this.records = parsed.slice(-MAX_RECORDS)
          logger.agent.info(`[ProactiveLearning] Loaded ${this.records.length} records from storage`)
        }
      }
    } catch (err) {
      logger.agent.warn('[ProactiveLearning] Failed to load records from storage:', err)
    }
  }

  private schedulePersist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer)
    this.persistTimer = setTimeout(() => {
      this.doPersist()
    }, PERSIST_DEBOUNCE_MS)
  }

  private doPersist(): void {
    this.persistTimer = null
    try {
      const toStore = this.records.slice(-MAX_RECORDS)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore))
    } catch (err) {
      logger.agent.warn('[ProactiveLearning] Failed to persist records:', err)
    }
  }

  async recordEvent(eventType: LearningEventType, context: string, outcome?: string, metadata?: Record<string, unknown>): Promise<void> {
    await this.ensureLoaded()

    const record: SelfLearningRecord = {
      id: crypto.randomUUID(),
      eventType,
      context: context.slice(0, 500),
      outcome: outcome?.slice(0, 300),
      timestamp: Date.now(),
      metadata,
    }

    this.records.push(record)
    if (this.records.length > MAX_RECORDS) {
      this.records = this.records.slice(-MAX_RECORDS)
    }

    this.schedulePersist()
  }

  async analyzePatterns(): Promise<LearningResult> {
    await this.ensureLoaded()

    const result: LearningResult = {
      patterns: [],
      newMemoryIds: [],
      reinforcedIds: [],
    }

    if (this.records.length < PATTERN_MIN_FREQUENCY) return result

    const eventTypePatterns = this.analyzeByEventType()
    result.patterns.push(...eventTypePatterns)

    const contextPatterns = this.analyzeByContext()
    result.patterns.push(...contextPatterns)

    const errorPatterns = this.analyzeErrorPatterns()
    result.patterns.push(...errorPatterns)

    for (const pattern of result.patterns) {
      if (pattern.frequency < PATTERN_MIN_FREQUENCY) continue
      if (pattern.confidence < 0.6) continue

      const existingMemory = await longTermMemoryService.search({
        query: pattern.pattern,
        limit: 1,
      })

      if (existingMemory.length > 0 && existingMemory[0].score > 3) {
        const entry = existingMemory[0].entry
        await longTermMemoryService.updateEntry(entry.id, {
          confidence: Math.min(1, entry.confidence + 0.05),
        })
        result.reinforcedIds.push(entry.id)
      } else {
        try {
          const entry = await longTermMemoryService.addEntry({
            content: pattern.pattern,
            source: 'self_reflection',
            status: 'short_term',
            confidence: pattern.confidence,
            tags: [...pattern.tags, 'behavioral-pattern'],
            verificationStatus: 'unverified',
          })
          result.newMemoryIds.push(entry.id)
        } catch {
        }
      }
    }

    if (result.patterns.length > 0) {
      logger.agent.info(
        `[ProactiveLearning] Found ${result.patterns.length} patterns, ${result.newMemoryIds.length} new memories, ${result.reinforcedIds.length} reinforced`
      )
    }

    return result
  }

  private analyzeByEventType(): BehavioralPattern[] {
    const patterns: BehavioralPattern[] = []
    const groups = new Map<LearningEventType, SelfLearningRecord[]>()

    for (const record of this.records) {
      const group = groups.get(record.eventType) ?? []
      group.push(record)
      groups.set(record.eventType, group)
    }

    for (const [eventType, records] of groups) {
      if (records.length < PATTERN_MIN_FREQUENCY) continue

      const contexts = records.map(r => r.context)
      const commonWords = this.findCommonWords(contexts)

      for (const word of commonWords) {
        const matchingRecords = records.filter(r => r.context.toLowerCase().includes(word.toLowerCase()))
        if (matchingRecords.length < PATTERN_MIN_FREQUENCY) continue

        patterns.push({
          pattern: `[${eventType}] Frequently involves: ${word}`,
          frequency: matchingRecords.length,
          confidence: Math.min(0.9, matchingRecords.length / records.length + 0.3),
          firstSeenAt: matchingRecords[0].timestamp,
          lastSeenAt: matchingRecords[matchingRecords.length - 1].timestamp,
          examples: matchingRecords.slice(0, 3).map(r => r.context.slice(0, 100)),
          tags: [eventType, 'frequency-pattern'],
        })
      }
    }

    return patterns
  }

  private analyzeByContext(): BehavioralPattern[] {
    const patterns: BehavioralPattern[] = []
    const recentRecords = this.records.slice(-200)
    const contextGroups = new Map<string, SelfLearningRecord[]>()

    for (const record of recentRecords) {
      const keyWords = record.context.toLowerCase().split(/\s+/).filter(w => w.length > 4)
      for (const word of keyWords) {
        const group = contextGroups.get(word) ?? []
        group.push(record)
        contextGroups.set(word, group)
      }
    }

    for (const [word, records] of contextGroups) {
      if (records.length < PATTERN_MIN_FREQUENCY) continue

      const eventTypes = new Set(records.map(r => r.eventType))
      if (eventTypes.size <= 1) continue

      patterns.push({
        pattern: `Context "${word}" triggers multiple behaviors: ${[...eventTypes].join(', ')}`,
        frequency: records.length,
        confidence: Math.min(0.85, 0.4 + eventTypes.size * 0.15),
        firstSeenAt: records[0].timestamp,
        lastSeenAt: records[records.length - 1].timestamp,
        examples: records.slice(0, 3).map(r => `[${r.eventType}] ${r.context.slice(0, 80)}`),
        tags: ['context-pattern', ...eventTypes],
      })
    }

    return patterns.slice(0, 10)
  }

  private analyzeErrorPatterns(): BehavioralPattern[] {
    const patterns: BehavioralPattern[] = []
    const errorRecords = this.records.filter(r => r.eventType === 'error_encountered')

    if (errorRecords.length < 2) return patterns

    const errorGroups = new Map<string, SelfLearningRecord[]>()
    for (const record of errorRecords) {
      const key = this.extractErrorKey(record.context)
      const group = errorGroups.get(key) ?? []
      group.push(record)
      errorGroups.set(key, group)
    }

    for (const [errorKey, records] of errorGroups) {
      if (records.length < 2) continue

      const resolvedRecords = records.filter(r => r.outcome && !r.outcome.toLowerCase().includes('fail'))
      if (resolvedRecords.length === 0) continue

      const resolution = resolvedRecords[0].outcome ?? 'unknown resolution'
      patterns.push({
        pattern: `Error "${errorKey}" resolved by: ${resolution.slice(0, 100)}`,
        frequency: records.length,
        confidence: Math.min(0.9, 0.5 + (resolvedRecords.length / records.length) * 0.4),
        firstSeenAt: records[0].timestamp,
        lastSeenAt: records[records.length - 1].timestamp,
        examples: records.slice(0, 3).map(r => r.context.slice(0, 80)),
        tags: ['error-pattern', 'error-solution'],
      })
    }

    return patterns
  }

  private findCommonWords(contexts: string[]): string[] {
    const wordFreq = new Map<string, number>()
    for (const context of contexts) {
      const words = context.toLowerCase().split(/\s+/).filter(w => w.length > 3)
      const unique = new Set(words)
      for (const word of unique) {
        wordFreq.set(word, (wordFreq.get(word) ?? 0) + 1)
      }
    }

    return [...wordFreq.entries()]
      .filter(([, freq]) => freq >= PATTERN_MIN_FREQUENCY)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([word]) => word)
  }

  private extractErrorKey(context: string): string {
    const lower = context.toLowerCase()
    const errorMatch = lower.match(/(?:error|exception|failed|failure)[:\s]+([^\n,.]{3,50})/)
    return errorMatch ? errorMatch[1].trim() : lower.slice(0, 50)
  }

  async getRecentRecords(limit: number = 50): Promise<SelfLearningRecord[]> {
    await this.ensureLoaded()
    return this.records.slice(-limit)
  }

  async clearRecords(): Promise<void> {
    this.records = []
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {}
  }
}

export const proactiveLearningService = new ProactiveLearningService()
