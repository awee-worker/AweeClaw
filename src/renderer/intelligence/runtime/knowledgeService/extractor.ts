import { z } from 'zod'
import { longTermMemoryService } from '../longTermMemoryService'
import { api } from '../../../adapters/electronBridge'
import { logger } from '@toolkit/LogEngine'
import { useStore } from '@store'
import { getLLMConfigForTask } from '../modelConfigService'

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

const CORRECTION_PATTERNS: Array<{ regex: RegExp; tag: string }> = [
  { regex: /(?:我之前说过|我早就说过|我已经告诉过你|我刚才说了|我不是说了|我前面说过)[：:，,]?\s*(.+)/i, tag: 'correction' },
  { regex: /(?:不对|错了|不是这样|你搞错了|你理解错了|说错了)[：:，,]?\s*(.+)/i, tag: 'correction' },
  { regex: /(?:记住|记住了吗|别忘了|记住这个|记住：)[：:，,]?\s*(.+)/i, tag: 'explicit' },
  { regex: /(?:记住|remember|note|keep in mind|don'?t forget|important)[:\s]+(.+)/i, tag: 'explicit' },
  { regex: /(?:I (?:already |previously )?told you|I said (?:before|earlier)|that'?s wrong|you'?re wrong|not like that|incorrect)[:\s,]+(.+)/i, tag: 'correction' },
]

const PREFERENCE_PATTERNS: Array<{ regex: RegExp; tag: string }> = [
  { regex: /(?:我喜欢|我偏好|我习惯|我倾向于|我更喜欢|我一般|我通常|我喜欢用|我用的是)[：:，,]?\s*(.+)/i, tag: 'preference' },
  { regex: /(?:I prefer|I like|I usually|I always|I tend to|my preference|I'd rather)[:\s]+(.+)/i, tag: 'preference' },
  { regex: /(?:不要|别|千万别|绝对不要|永远不要|不要用)[：:，,]?\s*(.+)/i, tag: 'preference' },
  { regex: /(?:never|don'?t|avoid|always use|must not)[:\s]+(.+)/i, tag: 'preference' },
]

class KnowledgeExtractor {
  private lastExtractionTime = 0
  private readonly MIN_INTERVAL_MS = 15_000
  private readonly MAX_MESSAGES = 30

  extractFromMessagesByRules(messages: ConversationMessage[]): number {
    let added = 0

    for (const msg of messages) {
      if (msg.role !== 'user' || !msg.content) continue

      for (const pattern of CORRECTION_PATTERNS) {
        const match = msg.content.match(pattern.regex)
        if (match && match[1] && match[1].trim().length > 2) {
          const content = match[1].trim().slice(0, 300)
          longTermMemoryService.addEntry({
            content,
            source: 'self_correction',
            status: 'short_term',
            tags: [pattern.tag, 'user-stated'],
            confidence: 0.9,
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
                  { source: 'self_correction', confidence: 0.9 }
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
          const content = match[1].trim().slice(0, 300)
          longTermMemoryService.addEntry({
            content,
            source: 'auto_extracted',
            status: 'short_term',
            tags: [pattern.tag, 'user-stated'],
            confidence: 0.85,
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
    if (now - this.lastExtractionTime < this.MIN_INTERVAL_MS) return 0

    if (messages.length < 2) return 0

    const ruleAdded = this.extractFromMessagesByRules(messages)

    const recentMessages = messages.slice(-this.MAX_MESSAGES)
    const hasSubstantialContent = recentMessages.some(
      m => m.role === 'assistant' && m.content && m.content.length > 50
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
        .map(m => `[${m.role}]: ${m.content.slice(0, 800)}`)
        .join('\n\n')

      const prompt = `Analyze the following conversation and extract any valuable information that should be remembered for future sessions.

Focus on extracting:
- User preferences and habits (e.g., "Prefers functional components", "Likes dark theme")
- User-defined rules and conventions (e.g., "1=4, 2=8, 3=16, 4=4 because user defined 1=4")
- Architectural decisions (e.g., "Using X for state management")
- Error solutions discovered (e.g., "Fix X by doing Y")
- Project conventions (e.g., "All API calls go through services/")
- Important technical facts (e.g., "Database uses PostgreSQL 15")
- User corrections and clarifications (e.g., "User corrected: the API uses POST not GET")
- Personal reasoning patterns (e.g., "User follows TDD approach")

Rules:
- Extract genuinely useful information, including both technical and personal preference data
- Each entry must be a clear, standalone statement
- Skip generic advice or obvious information
- Skip information already commonly known
- Pay special attention to user corrections - if the user corrects the assistant, extract the corrected fact
- Maximum 5 entries per conversation

Conversation:
${conversationText}`

      const res = await api.llm.generateObject({
        config,
        schema: extractionSchema,
        prompt,
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
            tags: Array.isArray(entry.tags) ? entry.tags.slice(0, 3) : [],
            confidence: typeof entry.confidence === 'number' ? entry.confidence : 0.7,
          })
          llmAdded++
        } catch {
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
