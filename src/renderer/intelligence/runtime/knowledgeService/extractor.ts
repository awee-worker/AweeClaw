import { z } from 'zod'
import { longTermMemoryService } from '../longTermMemoryService'
import { api } from '../../../adapters/electronBridge'
import { logger } from '@toolkit/LogEngine'
import { useStore } from '@store'
import { getLLMConfigForTask } from '../modelConfigService'
import {
  CORRECTION_PATTERNS,
  PREFERENCE_PATTERNS,
  EXTRACTION_RULES,
  CONVERSATION_EXTRACTION_PROMPT,
  normalizeConfidence,
} from './extractionRules'

const extractionSchema = z.object({
  entries: z.array(z.object({
    content: z.string().describe('A clear, standalone memory statement'),
    tags: z.array(z.string()).describe('1-3 relevant tags'),
    confidence: z.number().min(0).max(1).describe('Confidence level 0-1'),
  })).describe('Extracted memory entries'),
})

interface ConversationMessage {
  role: string
  content: string
}

class KnowledgeExtractor {
  private lastExtractionTime = 0

  extractFromMessagesByRules(messages: ConversationMessage[]): number {
    let added = 0

    for (const msg of messages) {
      if (msg.role !== 'user' || !msg.content) continue

      for (const pattern of CORRECTION_PATTERNS) {
        const match = msg.content.match(pattern.regex)
        if (match && match[1] && match[1].trim().length > 2) {
          const content = match[1].trim().slice(0, EXTRACTION_RULES.maxContentLength)
          longTermMemoryService.addEntry({
            content,
            source: 'self_correction',
            status: 'short_term',
            tags: [pattern.tag, 'user-stated'],
            confidence: EXTRACTION_RULES.correctionConfidence,
            verificationStatus: 'verified',
          }).then(async (entry) => {
            logger.agent.info(`[MemoryExtractor] Rule-based extraction (${pattern.tag}): ${content.slice(0, 80)}`)
            const searchResults = await longTermMemoryService.search({ query: content, limit: 3 })
            for (const result of searchResults) {
              if (result.entry.id !== entry.id && result.score > 3) {
                await longTermMemoryService.supersedeEntry(
                  result.entry.id,
                  content,
                  `User correction detected: "${content.slice(0, 60)}"`,
                  { source: 'self_correction', confidence: EXTRACTION_RULES.correctionConfidence },
                )
                break
              }
            }
          }).catch(() => {})
          added++
          break
        }
      }

      for (const pattern of PREFERENCE_PATTERNS) {
        const match = msg.content.match(pattern.regex)
        if (match && match[1] && match[1].trim().length > 2) {
          const content = match[1].trim().slice(0, EXTRACTION_RULES.maxContentLength)
          longTermMemoryService.addEntry({
            content,
            source: 'auto_extracted',
            status: 'short_term',
            tags: [pattern.tag, 'user-stated'],
            confidence: EXTRACTION_RULES.preferenceConfidence,
            verificationStatus: 'verified',
          }).then(() => {
            logger.agent.info(`[MemoryExtractor] Rule-based extraction (${pattern.tag}): ${content.slice(0, 80)}`)
          }).catch(() => {})
          added++
          break
        }
      }
    }

    return added
  }

  async extractFromMessages(messages: ConversationMessage[]): Promise<number> {
    const now = Date.now()
    if (now - this.lastExtractionTime < EXTRACTION_RULES.minExtractionIntervalMs) return 0

    if (messages.length < 2) return 0

    const ruleAdded = this.extractFromMessagesByRules(messages)

    const recentMessages = messages.slice(-EXTRACTION_RULES.maxConversationMessages)
    const hasSubstantialContent = recentMessages.some(
      m => m.role === 'assistant' && m.content && m.content.length > 50,
    )
    if (!hasSubstantialContent) {
      if (ruleAdded > 0) {
        this.lastExtractionTime = Date.now()
      }
      return ruleAdded
    }

    try {
      const store = useStore.getState()
      const config = await getLLMConfigForTask(store.llmConfig.provider, store.llmConfig.model)
      if (!config) return ruleAdded

      const conversationText = recentMessages
        .map(m => `[${m.role}]: ${m.content.slice(0, EXTRACTION_RULES.maxMessageSlice)}`)
        .join('\n\n')

      const res = await api.llm.generateObject({
        config,
        schema: extractionSchema,
        prompt: `${CONVERSATION_EXTRACTION_PROMPT}\n\nConversation:\n${conversationText}`,
        system: 'You extract structured memory from conversations. Extract both technical and personal preference information. Pay special attention to user corrections and explicitly stated rules. Quality over quantity.',
      })

      if (!res || res.error || !res.object) {
        if (ruleAdded > 0) this.lastExtractionTime = Date.now()
        return ruleAdded
      }

      const parsed = res.object
      const entries = Array.isArray(parsed.entries) ? parsed.entries : []
      if (entries.length === 0) {
        if (ruleAdded > 0) this.lastExtractionTime = Date.now()
        return ruleAdded
      }

      let llmAdded = 0
      for (const entry of entries) {
        if (!entry.content || typeof entry.content !== 'string') continue

        try {
          await longTermMemoryService.addEntry({
            content: entry.content.trim(),
            source: 'auto_extracted',
            status: 'short_term',
            tags: Array.isArray(entry.tags) ? entry.tags.slice(0, EXTRACTION_RULES.maxTagsPerEntry) : [],
            confidence: normalizeConfidence(entry.confidence),
          })
          llmAdded++
        } catch {
          // skip failed entry
        }
      }

      this.lastExtractionTime = Date.now()
      const total = ruleAdded + llmAdded
      if (total > 0) {
        logger.agent.info(`[MemoryExtractor] Extracted ${total} memory entries (rules: ${ruleAdded}, LLM: ${llmAdded})`)
      }
      return total
    } catch (err) {
      logger.agent.warn('[MemoryExtractor] Extraction failed:', err)
      if (ruleAdded > 0) this.lastExtractionTime = Date.now()
      return ruleAdded
    }
  }
}

export const knowledgeExtractor = new KnowledgeExtractor()
