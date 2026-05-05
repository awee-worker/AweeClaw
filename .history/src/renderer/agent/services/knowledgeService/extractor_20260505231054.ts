import { z } from 'zod'
import { knowledgeService } from './index'
import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import { useStore } from '@store'
import { getLLMConfigForTask } from '../llmConfigService'
import type { KnowledgeCategory } from './types'

const extractionSchema = z.object({
  entries: z.array(z.object({
    content: z.string().describe('A clear, standalone knowledge statement'),
    category: z.enum([
      'concept', 'decision', 'preference', 'faq', 'reference',
      'glossary', 'best-practice', 'error-solution', 'api', 'pattern',
    ]).describe('Category of the knowledge'),
    tags: z.array(z.string()).describe('1-3 relevant tags'),
    confidence: z.number().min(0).max(1).describe('Confidence level 0-1'),
  })).describe('Extracted knowledge entries'),
})

interface ConversationMessage {
  role: string
  content: string
}

class KnowledgeExtractor {
  private lastExtractionTime = 0
  private readonly MIN_INTERVAL_MS = 30_000
  private readonly MAX_MESSAGES = 20

  async extractFromMessages(messages: ConversationMessage[]): Promise<number> {
    const now = Date.now()
    if (now - this.lastExtractionTime < this.MIN_INTERVAL_MS) return 0

    if (messages.length < 4) return 0

    const recentMessages = messages.slice(-this.MAX_MESSAGES)
    const hasSubstantialContent = recentMessages.some(
      m => m.role === 'assistant' && m.content && m.content.length > 200
    )
    if (!hasSubstantialContent) return 0

    try {
      const store = useStore.getState()
      const config = await getLLMConfigForTask(store.llmConfig.provider, store.llmConfig.model)
      if (!config) return 0

      const conversationText = recentMessages
        .map(m => `[${m.role}]: ${m.content.slice(0, 500)}`)
        .join('\n\n')

      const prompt = `Analyze the following conversation and extract any valuable, project-specific knowledge that should be persisted for future sessions.

Focus on extracting:
- Architectural decisions (e.g., "Using X for state management")
- User preferences (e.g., "Prefers functional components")
- Error solutions discovered (e.g., "Fix X by doing Y")
- Project conventions (e.g., "All API calls go through services/")
- Important technical facts (e.g., "Database uses PostgreSQL 15")

Rules:
- Only extract genuinely useful, project-specific knowledge
- Each entry must be a clear, standalone statement
- Skip generic advice or obvious information
- Skip information already commonly known
- Maximum 3 entries per conversation

Conversation:
${conversationText}`

      const res = await api.llm.generateObject({
        config,
        schema: extractionSchema,
        prompt,
        system: 'You extract structured knowledge from conversations. Only extract genuinely valuable, project-specific information. Quality over quantity.',
      })

      if (!res || typeof res !== 'object') return 0

      const parsed = res as any
      const entries = Array.isArray(parsed.entries) ? parsed.entries : []
      if (entries.length === 0) return 0

      let added = 0
      for (const entry of entries) {
        if (!entry.content || typeof entry.content !== 'string') continue
        if (!entry.category) continue

        try {
          await knowledgeService.addEntry({
            content: entry.content.trim(),
            layer: 'conversation',
            category: entry.category as KnowledgeCategory,
            tags: Array.isArray(entry.tags) ? entry.tags.slice(0, 3) : [],
            source: 'auto_extracted',
            confidence: typeof entry.confidence === 'number' ? entry.confidence : 0.7,
          })
          added++
        } catch {
          // skip duplicates or invalid entries
        }
      }

      this.lastExtractionTime = Date.now()
      if (added > 0) {
        logger.agent.info(`[KnowledgeExtractor] Extracted ${added} knowledge entries from conversation`)
      }
      return added
    } catch (err) {
      logger.agent.warn('[KnowledgeExtractor] Extraction failed:', err)
      return 0
    }
  }
}

export const knowledgeExtractor = new KnowledgeExtractor()
