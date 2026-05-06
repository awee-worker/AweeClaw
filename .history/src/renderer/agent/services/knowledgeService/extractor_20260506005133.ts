import { z } from 'zod'
import { longTermMemoryService } from '../longTermMemoryService'
import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import { useStore } from '@store'
import { getLLMConfigForTask } from '../llmConfigService'

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

      const prompt = `Analyze the following conversation and extract any valuable, project-specific information that should be remembered for future sessions.

Focus on extracting:
- User preferences (e.g., "Prefers functional components")
- Architectural decisions (e.g., "Using X for state management")
- Error solutions discovered (e.g., "Fix X by doing Y")
- Project conventions (e.g., "All API calls go through services/")
- Important technical facts (e.g., "Database uses PostgreSQL 15")

Rules:
- Only extract genuinely useful, project-specific information
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
        system: 'You extract structured memory from conversations. Only extract genuinely valuable, project-specific information. Quality over quantity.',
      })

      if (!res || res.error || !res.object) return 0

      const parsed = res.object
      const entries = Array.isArray(parsed.entries) ? parsed.entries : []
      if (entries.length === 0) return 0

      let added = 0
      for (const entry of entries) {
        if (!entry.content || typeof entry.content !== 'string') continue

        try {
          await longTermMemoryService.addEntry({
            content: entry.content.trim(),
            source: 'auto_extracted',
            status: 'short_term',
            tags: Array.isArray(entry.tags) ? entry.tags.slice(0, 3) : [],
            confidence: typeof entry.confidence === 'number' ? entry.confidence : 0.7,
          })
          added++
        } catch {
        }
      }

      this.lastExtractionTime = Date.now()
      if (added > 0) {
        logger.agent.info(`[MemoryExtractor] Extracted ${added} memory entries from conversation`)
      }
      return added
    } catch (err) {
      logger.agent.warn('[MemoryExtractor] Extraction failed:', err)
      return 0
    }
  }
}

export const knowledgeExtractor = new KnowledgeExtractor()
