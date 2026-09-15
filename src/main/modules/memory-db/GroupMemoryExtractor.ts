/**
 * 群组记忆提取器（P1-3）
 *
 * 从群聊对话中提取结构化长期记忆。
 * 使用 LLM 从用户消息和助手回复中提炼可复用的信息。
 *
 * 源项目参考：server.py → _extract_group_memories()
 *
 * @module GroupMemoryExtractor
 */

import { logger } from '@shared/toolkit/LogEngine'
import type { GroupMemoryRow } from './MemoryDb'

// ============================================
// 类型定义
// ============================================

/** 提取的记忆结构 */
export interface ExtractedMemory {
  memory_type: 'fact' | 'decision' | 'preference' | 'todo' | 'constraint' | 'glossary'
  content: string
  summary: string
  importance: number // 0 ~ 1
}

/** 提取请求 */
export interface ExtractRequest {
  groupId: string
  conversationId: string
  sourceChatId: string
  userMessage: string
  assistantMessage: string
}

/** LLM 调用接口 */
export interface LLMCaller {
  generate(params: {
    messages: Array<{ role: string; content: string }>
    temperature?: number
    maxTokens?: number
  }): Promise<{ text: string }>
}

// ============================================
// 常量
// ============================================

/** 提取提示词 */
const EXTRACTION_PROMPT = `你是一个结构化记忆提取器。只提取后续同组对话可复用的长期信息，不要总结整段聊天，不要保留闲聊、猜测、情绪宣泄、不确定信息和重复信息。

只允许 memory_type 为以下类型：
- fact: 事实性信息（如用户说"我的项目使用 React"）
- decision: 决策性信息（如"我们决定采用 PostgreSQL"）
- preference: 偏好信息（如"我喜欢用 TypeScript"）
- todo: 待办事项（如"后续需要实现登录功能"）
- constraint: 约束条件（如"不能使用外部 API"）
- glossary: 术语定义（如"PMF 指的是 Product-Market Fit"）

返回 JSON 数组，每项字段必须包含：
- memory_type: 上述类型之一
- content: 完整的记忆内容
- summary: 简短摘要（不超过 50 字）
- importance: 重要性，取 0 到 1 之间的值

若没有可提取的记忆，返回空数组 []。

示例输出：
[
  {
    "memory_type": "fact",
    "content": "用户的项目使用 React 18 + TypeScript + Vite 技术栈",
    "summary": "项目技术栈：React 18 + TS + Vite",
    "importance": 0.8
  }
]`

/** 关键词 fallback 规则 */
const FALLBACK_KEYWORDS: Array<{
  keywords: string[]
  type: ExtractedMemory['memory_type']
  importance: number
}> = [
  { keywords: ['决定', '采用', '使用', '选择', 'choose', 'decide', 'use', 'select'], type: 'decision', importance: 0.82 },
  { keywords: ['偏好', '喜欢', '习惯', 'prefer', 'like', 'habit'], type: 'preference', importance: 0.72 },
  { keywords: ['限制', '必须', '不能', '禁止', 'constraint', 'must', 'cannot', "can't", 'forbidden'], type: 'constraint', importance: 0.78 },
  { keywords: ['todo', '待办', '后续', '需要', '计划', 'next', 'plan', 'need'], type: 'todo', importance: 0.68 },
  { keywords: ['是', '指', '定义', '含义', 'means', 'definition', 'refers to'], type: 'glossary', importance: 0.65 },
]

// ============================================
// 提取器类
// ============================================

export class GroupMemoryExtractor {
  private llmCaller: LLMCaller | null = null

  /** 设置 LLM 调用器 */
  setLLMCaller(caller: LLMCaller): void {
    this.llmCaller = caller
  }

  /**
   * 从对话中提取记忆
   */
  async extract(request: ExtractRequest): Promise<ExtractedMemory[]> {
    const { userMessage, assistantMessage } = request

    if (!userMessage.trim() || !assistantMessage.trim()) {
      return []
    }

    // 优先使用 LLM 提取
    if (this.llmCaller) {
      try {
        const memories = await this.extractWithLLM(userMessage, assistantMessage)
        if (memories.length > 0) {
          logger.agent.info(`[GroupMemoryExtractor] LLM extracted ${memories.length} memories`)
          return this.mergeMemories(memories)
        }
      } catch (err) {
        logger.agent.warn('[GroupMemoryExtractor] LLM extraction failed, falling back to keywords:', err)
      }
    }

    // Fallback: 关键词提取
    const memories = this.extractWithKeywords(userMessage, assistantMessage)
    if (memories.length > 0) {
      logger.agent.info(`[GroupMemoryExtractor] Keyword extracted ${memories.length} memories`)
    }
    return memories
  }

  /**
   * 使用 LLM 提取记忆
   */
  private async extractWithLLM(userMessage: string, assistantMessage: string): Promise<ExtractedMemory[]> {
    if (!this.llmCaller) return []

    const exampleInput = `用户消息:\n${userMessage}\n\n助手回复:\n${assistantMessage}`

    try {
      const result = await this.llmCaller.generate({
        messages: [
          { role: 'system', content: EXTRACTION_PROMPT },
          { role: 'user', content: exampleInput },
        ],
        temperature: 0.3,
        maxTokens: 1000,
      })

      const text = result.text.trim()

      // 尝试解析 JSON
      const jsonMatch = text.match(/\[[\s\S]*\]/)
      if (!jsonMatch) {
        logger.agent.warn('[GroupMemoryExtractor] No JSON array found in LLM response')
        return []
      }

      const parsed = JSON.parse(jsonMatch[0])
      if (!Array.isArray(parsed)) {
        return []
      }

      // 验证并过滤
      return parsed.filter((item: any) => {
        if (!item.memory_type || !item.content) return false
        const validTypes = ['fact', 'decision', 'preference', 'todo', 'constraint', 'glossary']
        if (!validTypes.includes(item.memory_type)) return false
        if (typeof item.importance !== 'number' || item.importance < 0 || item.importance > 1) return false
        return true
      }).map((item: any) => ({
        memory_type: item.memory_type,
        content: String(item.content).trim(),
        summary: String(item.summary || item.content).trim().slice(0, 200),
        importance: Math.max(0, Math.min(1, item.importance)),
      }))
    } catch (err) {
      logger.agent.error('[GroupMemoryExtractor] LLM extraction error:', err)
      return []
    }
  }

  /**
   * 使用关键词提取记忆（Fallback）
   */
  private extractWithKeywords(userMessage: string, assistantMessage: string): ExtractedMemory[] {
    const combined = `${userMessage}\n${assistantMessage}`
    const results: ExtractedMemory[] = []

    for (const rule of FALLBACK_KEYWORDS) {
      const hasKeyword = rule.keywords.some(kw => combined.toLowerCase().includes(kw.toLowerCase()))
      if (hasKeyword) {
        results.push({
          memory_type: rule.type,
          summary: (assistantMessage || userMessage).slice(0, 120),
          content: assistantMessage || userMessage,
          importance: rule.importance,
        })
      }
    }

    return this.mergeMemories(results)
  }

  /**
   * 合并相似记忆（去重）
   */
  private mergeMemories(memories: ExtractedMemory[]): ExtractedMemory[] {
    if (memories.length <= 1) return memories

    const merged: ExtractedMemory[] = []
    const seen = new Set<string>()

    for (const memory of memories) {
      // 使用内容前 50 字符作为去重键
      const key = `${memory.memory_type}:${memory.content.slice(0, 50)}`
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(memory)
    }

    return merged
  }

  /**
   * 将提取的记忆转换为数据库行
   */
  toGroupMemoryRows(
    request: ExtractRequest,
    memories: ExtractedMemory[]
  ): Array<Omit<GroupMemoryRow, 'created_at' | 'updated_at' | 'last_used_at'>> {
    const now = Date.now()

    return memories.map((memory, index) => ({
      id: `${request.groupId}-${request.sourceChatId}-${now}-${index}`,
      group_id: request.groupId,
      source_chat_id: request.sourceChatId,
      memory_type: memory.memory_type,
      summary: memory.summary,
      content: memory.content,
      importance: memory.importance,
      status: 'active' as const,
    }))
  }
}