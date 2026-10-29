/**
 * 上下文按需检索器
 *
 * 职责：
 * - 根据当前用户消息，精准检索相关知识库条目和长期记忆
 * - 替代"全量加载 + 截断"模式，显著降低常驻上下文 token 消耗
 * - starred 知识 / verified 记忆始终保留（高频重要信息不依赖检索命中）
 * - 无 query（首次对话）时降级为 starred + verified + 最近条目
 *
 * 设计原则：
 * - 单一职责：只负责"检索哪些 entries"，不负责格式化（格式化由 PromptComposer 负责）
 * - 渐进增强：向量检索失败时自动降级为关键词检索（semanticSearch 内部已实现）
 * - 可观测：输出检索命中数与降级情况日志
 * - 健壮性：任何检索异常均兜底为全量 enabled，绝不阻断主流程
 */

import { logger } from '@toolkit/LogEngine'
import { knowledgeService } from './knowledgeService'
import { longTermMemoryService } from './longTermMemoryService'
import type {
  KnowledgeEntry,
  MemoryEntry,
} from '@intelligence/providerTypes'

/** 默认检索条数（非 starred / 非 verified 部分） */
const DEFAULT_KNOWLEDGE_LIMIT = 8
const DEFAULT_MEMORY_LIMIT = 8
/**
 * 未被检索命中时仍强制保留的 verified 记忆条数上限。
 *
 * 这类记忆是历史会话里确认过的事实，属于「用户可能期待 AI 记得」的部分；
 * 但它们与当前问题未必相关，条数越多，越容易把模型带偏到旧对象上。
 */
const MAX_VERIFIED_MEMORIES = 3

export interface ContextRetrievalRequest {
  /** 当前用户消息（用于语义检索），首次对话时可能为空 */
  query?: string | null
  /** 当前活动文件路径（用于记忆的上下文加权） */
  activeFile?: string | null
  /** 知识库检索条数上限（不含 starred） */
  knowledgeLimit?: number
  /** 长期记忆检索条数上限（不含 verified） */
  memoryLimit?: number
}

export interface ContextRetrievalResult {
  /** 注入上下文的知识条目（starred + 检索命中） */
  knowledgeEntries: KnowledgeEntry[]
  /** 注入上下文的长期记忆（verified + 检索命中） */
  longTermMemories: MemoryEntry[]
  /**
   * 记忆 id → 同主题下被折叠掉的更早条目数。
   * 折叠只影响本次注入，库里的旧条目保持不动。
   */
  memoryFoldCount: Record<string, number>
  /** 检索模式：'retrieval' 按 query 检索 / 'fallback' 无 query 或异常降级 */
  mode: 'retrieval' | 'fallback'
}

class ContextRetriever {
  /**
   * 按需检索知识与记忆
   *
   * 策略：
   * 1. 有 query：starred 知识 + verified 记忆始终保留，其余按 query 检索 top-k
   * 2. 无 query：降级返回 starred + verified + 最近条目（按 updatedAt 倒序）
   * 3. 检索异常：兜底全量 enabled，保证可用性
   */
  async retrieve(req: ContextRetrievalRequest = {}): Promise<ContextRetrievalResult> {
    const {
      query,
      activeFile = null,
      knowledgeLimit = DEFAULT_KNOWLEDGE_LIMIT,
      memoryLimit = DEFAULT_MEMORY_LIMIT,
    } = req

    const hasQuery = typeof query === 'string' && query.trim().length > 0

    try {
      if (hasQuery) {
        const [knowledgeEntries, memoryResult] = await Promise.all([
          this.retrieveKnowledge(query.trim(), knowledgeLimit),
          this.retrieveMemory(query.trim(), activeFile, memoryLimit),
        ])

        logger.agent.info(
          `[ContextRetriever] retrieval mode: knowledge=${knowledgeEntries.length}, memory=${memoryResult.entries.length}`,
        )

        return {
          knowledgeEntries,
          longTermMemories: memoryResult.entries,
          memoryFoldCount: memoryResult.foldCount,
          mode: 'retrieval',
        }
      }

      // 无 query 降级
      const [knowledgeEntries, longTermMemories] = await Promise.all([
        this.fallbackKnowledge(knowledgeLimit),
        this.fallbackMemory(memoryLimit),
      ])

      logger.agent.info(
        `[ContextRetriever] fallback mode (no query): knowledge=${knowledgeEntries.length}, memory=${longTermMemories.length}`,
      )

      return { knowledgeEntries, longTermMemories, memoryFoldCount: {}, mode: 'fallback' }
    } catch (err) {
      // 兜底：检索整体失败时回退全量 enabled，绝不阻断主流程
      logger.agent.warn('[ContextRetriever] Retrieval failed, falling back to full enabled entries:', err)
      const [knowledgeEntries, longTermMemories] = await Promise.all([
        knowledgeService.getEnabledEntries(),
        longTermMemoryService.getEnabledEntries(),
      ])
      return { knowledgeEntries, longTermMemories, memoryFoldCount: {}, mode: 'fallback' }
    }
  }

  /**
   * 检索知识库：starred 始终保留 + 非-starred 按 query 语义检索 top-k
   *
   * semanticSearch 内部已融合关键词 + 向量检索，向量失败自动降级关键词，
   * 因此本方法无需额外处理向量不可用的情况。
   */
  private async retrieveKnowledge(query: string, limit: number): Promise<KnowledgeEntry[]> {
    const results = await knowledgeService.semanticSearch({ query, limit })
    const retrieved = results.map(r => r.entry)
    const retrievedIds = new Set(retrieved.map(e => e.id))

    // 补全未被检索命中的 starred 条目（starred 始终保留，不依赖检索）
    const all = await knowledgeService.getEnabledEntries()
    const missedStarred = all.filter(e => e.starred && !retrievedIds.has(e.id))

    return [...missedStarred, ...retrieved]
  }

  /**
   * 检索长期记忆：verified 限量保留 + 其余按 query 上下文感知检索 top-k
   *
   * contextAwareSearch 基于 query + currentFile + taskType 做上下文加权检索，
   * 内部使用关键词打分（无向量依赖），保证稳定性。
   *
   * verified 记忆曾经是无条件全量补全，结果是不论用户这一轮问什么，历史会话
   * 确认过的事实都会先进上下文；用户一句笼统的「调一下按钮样式」，模型就会
   * 照着记忆里那个按钮去改。现在改为限额保留：用户显式交代的偏好优先，
   * 其余按最近更新时间截断，避免历史内容挤占当前会话的注意力。
   */
  private async retrieveMemory(
    query: string,
    currentFile: string | null,
    limit: number,
  ): Promise<{ entries: MemoryEntry[]; foldCount: Record<string, number> }> {
    const results = await longTermMemoryService.contextAwareSearch(
      { query, currentFile: currentFile ?? undefined },
      limit,
    )
    const retrieved = results.map(r => r.entry)
    const retrievedIds = new Set(retrieved.map(e => e.id))

    // 同主题折叠的条数随注入结果一起带出，供提示词说明「该主题另有更早记录」
    const foldCount: Record<string, number> = {}
    for (const result of results) {
      if (result.supersededCount && result.supersededCount > 0) {
        foldCount[result.entry.id] = result.supersededCount
      }
    }

    const all = await longTermMemoryService.getEnabledEntries()
    const missedVerified = all
      .filter(e => e.verificationStatus === 'verified' && !retrievedIds.has(e.id))
      // 用户明确交代的事实（source=user）优先，其次是内容较新写下的。
      // 这里按 createdAt 而不是 updatedAt：召回会刷新 updatedAt，
      // 用更新时间排序等于让「最常被引用」的旧记忆长期占位。
      .sort((a, b) => {
        const userFirst = Number(b.source === 'user') - Number(a.source === 'user')
        return userFirst !== 0 ? userFirst : b.createdAt - a.createdAt
      })
      .slice(0, MAX_VERIFIED_MEMORIES)

    return { entries: [...missedVerified, ...retrieved], foldCount }
  }

  /**
   * 无 query 降级：starred + 最近 N 条知识（按 updatedAt 倒序）
   */
  private async fallbackKnowledge(limit: number): Promise<KnowledgeEntry[]> {
    const all = await knowledgeService.getEnabledEntries()
    if (all.length === 0) return []

    const starred = all.filter(e => e.starred)
    const starredIds = new Set(starred.map(e => e.id))
    const recent = all
      .filter(e => !starredIds.has(e.id))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit)

    return [...starred, ...recent]
  }

  /**
   * 无 query 降级：verified（限额）+ 最近 N 条记忆（按 updatedAt 倒序）
   */
  private async fallbackMemory(limit: number): Promise<MemoryEntry[]> {
    const all = await longTermMemoryService.getEnabledEntries()
    if (all.length === 0) return []

    const verified = all
      .filter(e => e.verificationStatus === 'verified')
      .sort((a, b) => {
        const userFirst = Number(b.source === 'user') - Number(a.source === 'user')
        return userFirst !== 0 ? userFirst : b.updatedAt - a.updatedAt
      })
      .slice(0, MAX_VERIFIED_MEMORIES)
    const verifiedIds = new Set(verified.map(e => e.id))
    const recent = all
      .filter(e => !verifiedIds.has(e.id))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit)

    return [...verified, ...recent]
  }
}

export const contextRetriever = new ContextRetriever()
