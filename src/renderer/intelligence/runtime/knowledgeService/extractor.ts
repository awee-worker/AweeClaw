import { z } from 'zod'
import { longTermMemoryService } from '../longTermMemoryService'
import { api } from '../../../adapters/electronBridge'
import { logger } from '@toolkit/LogEngine'
import { useStore } from '@store'
import { useSceneModeStore } from '@/renderer/modes/sceneModeStore'
import { getLLMConfigForTask } from '../modelConfigService'
import {
  CORRECTION_PATTERNS,
  PREFERENCE_PATTERNS,
  EXTRACTION_RULES,
  CONVERSATION_EXTRACTION_PROMPT,
  normalizeConfidence,
} from './extractionRules'
import { evaluateMemoryValue, extractSalientSentence } from './memoryValuation'

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
        if (!match || !match[1]) continue

        const content = extractSalientSentence(match[1]).slice(0, EXTRACTION_RULES.maxContentLength)
        const verdict = evaluateMemoryValue(content, { explicit: pattern.tag === 'explicit' })
        if (!verdict.keep) {
          logger.agent.debug(`[MemoryExtractor] 跳过低价值内容（${verdict.reason}）: ${content.slice(0, 60)}`)
          continue
        }

        longTermMemoryService.addEntry({
          content,
          source: 'self_correction',
          status: 'short_term',
          tags: [pattern.tag, 'user-stated'],
          confidence: verdict.score,
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

      for (const pattern of PREFERENCE_PATTERNS) {
        const match = msg.content.match(pattern.regex)
        if (!match || !match[1]) continue

        const content = extractSalientSentence(match[1]).slice(0, EXTRACTION_RULES.maxContentLength)
        const verdict = evaluateMemoryValue(content, { explicit: pattern.tag === 'explicit' })
        if (!verdict.keep) {
          logger.agent.debug(`[MemoryExtractor] 跳过低价值偏好（${verdict.reason}）: ${content.slice(0, 60)}`)
          continue
        }

        longTermMemoryService.addEntry({
          content,
          source: 'auto_extracted',
          status: 'short_term',
          tags: [pattern.tag, 'user-stated'],
          confidence: verdict.score,
          verificationStatus: 'verified',
        }).then(() => {
          logger.agent.info(`[MemoryExtractor] Rule-based extraction (${pattern.tag}): ${content.slice(0, 80)}`)
        }).catch(() => {})
        added++
        break
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

      const sceneConstraint = buildSceneConstraint()

      const res = await api.llm.generateObject({
        config,
        schema: extractionSchema,
        prompt: `${CONVERSATION_EXTRACTION_PROMPT}\n\n${sceneConstraint ? `${sceneConstraint}\n\n` : ''}Conversation:\n${conversationText}`,
        system: 'You extract durable memory from conversations. Capture only what stays useful across future sessions. Quality over quantity.',
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
        if (llmAdded >= EXTRACTION_RULES.maxEntriesPerExtraction) break
        if (!entry.content || typeof entry.content !== 'string') continue

        const content = extractSalientSentence(entry.content)
        const verdict = evaluateMemoryValue(content)
        if (!verdict.keep) {
          logger.agent.debug(`[MemoryExtractor] 跳过低价值条目（${verdict.reason}）: ${content.slice(0, 60)}`)
          continue
        }

        try {
          await longTermMemoryService.addEntry({
            content,
            source: 'auto_extracted',
            status: 'short_term',
            tags: Array.isArray(entry.tags) ? entry.tags.slice(0, EXTRACTION_RULES.maxTagsPerEntry) : [],
            confidence: normalizeConfidence(entry.confidence) * verdict.score,
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

/**
 * 构造当前场景的抽取约束。
 *
 * 抽取此前不感知场景模式，「工作模式不写生活内容」这类边界只写在人设提示里，
 * 对抽取阶段不生效。这里把边界提升为抽取的硬约束。
 */
function buildSceneConstraint(): string {
  try {
    const profile = useSceneModeStore.getState().getActiveProfile()
    const boundary = extractBoundary(profile.personaPrompt)
    const lines = [
      `当前使用场景：${profile.displayNameZh}`,
      `本场景的记忆域：${profile.memoryDomainTag}`,
    ]
    if (boundary) lines.push(`场景边界约束：${boundary}`)
    lines.push('只提取符合当前场景边界、且跨会话仍有价值的信息；不符合边界的内容直接忽略。')
    return lines.join('\n')
  } catch {
    return ''
  }
}

/** 从人设提示词中抽取【边界】段 */
function extractBoundary(personaPrompt: string): string {
  const match = personaPrompt.match(/【边界】([\s\S]*?)(?=\n【|$)/)
  if (!match) return ''
  return match[1].replace(/^[\s:：]*/, '').trim().replace(/\n+/g, '；')
}
