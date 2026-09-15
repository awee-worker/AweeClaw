/**
 * 群组记忆管理器（P1-3）
 *
 * 生命周期编排：协调记忆提取、存储和检索。
 * 在群聊对话结束后自动提取长期记忆，在对话前注入相关记忆上下文。
 *
 * @module GroupMemoryManager
 */

import { logger } from '@shared/toolkit/LogEngine'
import { MemoryDb } from './MemoryDb'
import { GroupMemoryExtractor, type ExtractRequest, type LLMCaller } from './GroupMemoryExtractor'
import type { GroupMemoryRow } from './MemoryDb'

// ============================================
// 类型定义
// ============================================

/** 群组记忆配置 */
export interface GroupMemoryConfig {
  /** 是否启用群组记忆 */
  enabled: boolean
  /** 每次提取的最大记忆数 */
  maxMemoriesPerExtract: number
  /** 注入上下文的最大记忆数 */
  maxContextMemories: number
  /** 最小重要性阈值 */
  minImportance: number
}

/** 记忆注入结果 */
export interface MemoryContextResult {
  enabled: boolean
  groupId: string
  groupName: string
  memories: GroupMemoryRow[]
  prompt: string
}

// ============================================
// 默认配置
// ============================================

const DEFAULT_CONFIG: GroupMemoryConfig = {
  enabled: false,
  maxMemoriesPerExtract: 5,
  maxContextMemories: 6,
  minImportance: 0.3,
}

// ============================================
// 管理器类
// ============================================

export class GroupMemoryManager {
  private static instance: GroupMemoryManager | null = null

  private db: MemoryDb
  private extractor: GroupMemoryExtractor
  private config: GroupMemoryConfig = { ...DEFAULT_CONFIG }

  private constructor() {
    this.db = MemoryDb.getInstance()
    this.extractor = new GroupMemoryExtractor()
  }

  static getInstance(): GroupMemoryManager {
    if (!GroupMemoryManager.instance) {
      GroupMemoryManager.instance = new GroupMemoryManager()
    }
    return GroupMemoryManager.instance
  }

  // ============================================
  // 配置
  // ============================================

  /** 更新配置 */
  updateConfig(config: Partial<GroupMemoryConfig>): void {
    this.config = { ...this.config, ...config }
    logger.agent.info('[GroupMemoryManager] Config updated:', this.config)
  }

  /** 获取配置 */
  getConfig(): GroupMemoryConfig {
    return { ...this.config }
  }

  /** 设置 LLM 调用器 */
  setLLMCaller(caller: LLMCaller): void {
    this.extractor.setLLMCaller(caller)
  }

  // ============================================
  // 记忆提取
  // ============================================

  /**
   * 从群聊对话中提取记忆
   *
   * 通常在群聊对话结束后调用，提取可复用的长期信息。
   */
  async extractMemories(request: ExtractRequest): Promise<number> {
    if (!this.config.enabled) {
      logger.agent.debug('[GroupMemoryManager] Group memory disabled, skipping extraction')
      return 0
    }

    try {
      const memories = await this.extractor.extract(request)

      if (memories.length === 0) {
        return 0
      }

      // 过滤低重要性记忆
      const filtered = memories.filter(m => m.importance >= this.config.minImportance)

      // 限制数量
      const limited = filtered.slice(0, this.config.maxMemoriesPerExtract)

      // 转换为数据库行
      const rows = this.extractor.toGroupMemoryRows(request, limited)

      // 存入数据库
      this.db.batchUpsertGroupMemories(rows)

      logger.agent.info(`[GroupMemoryManager] Extracted and stored ${rows.length} memories for group ${request.groupId}`)
      return rows.length
    } catch (err) {
      logger.agent.error('[GroupMemoryManager] Failed to extract memories:', err)
      return 0
    }
  }

  // ============================================
  // 记忆检索与注入
  // ============================================

  /**
   * 获取群组记忆上下文
   *
   * 在对话前调用，返回相关记忆和注入提示词。
   */
  getMemoryContext(groupId: string, groupName: string, queryText: string): MemoryContextResult {
    if (!this.config.enabled) {
      return {
        enabled: false,
        groupId,
        groupName,
        memories: [],
        prompt: '',
      }
    }

    try {
      const memories = this.db.fetchGroupMemories(groupId, queryText, this.config.maxContextMemories)

      if (memories.length === 0) {
        return {
          enabled: true,
          groupId,
          groupName,
          memories: [],
          prompt: '',
        }
      }

      const prompt = this.buildMemoryPrompt({ id: groupId, name: groupName }, memories)

      return {
        enabled: true,
        groupId,
        groupName,
        memories,
        prompt,
      }
    } catch (err) {
      logger.agent.error('[GroupMemoryManager] Failed to get memory context:', err)
      return {
        enabled: false,
        groupId,
        groupName,
        memories: [],
        prompt: '',
      }
    }
  }

  /**
   * 构建记忆注入提示词
   *
   * 参考源项目：_build_group_memory_prompt()
   */
  private buildMemoryPrompt(group: { id: string; name: string }, memories: GroupMemoryRow[]): string {
    if (memories.length === 0) return ''

    const header = [
      `当前对话分组: ${group.name || group.id}`,
      '以下是仅限当前分组可用的长期记忆，请只在相关时使用，不要臆测或扩展未确认的信息。',
      '如果记忆中包含具体值，请优先直接复述具体值，不要用"见记忆条目"或占位说明代替：',
    ]

    const lines: string[] = []
    for (let i = 0; i < memories.length; i++) {
      const memory = memories[i]
      const summary = (memory.summary ?? '').trim()
      const content = memory.content.trim()
      const memoryType = memory.memory_type

      if (summary && content && summary !== content) {
        lines.push(`${i + 1}. [${memoryType}] 摘要: ${summary}`)
        lines.push(`   具体内容: ${content}`)
      } else {
        lines.push(`${i + 1}. [${memoryType}] ${content || summary}`)
      }
    }

    return [...header, ...lines].join('\n')
  }

  // ============================================
  // 记忆管理
  // ============================================

  /** 获取群组记忆列表 */
  getGroupMemories(groupId: string, options?: {
    status?: string
    keyword?: string
    topK?: number
  }): GroupMemoryRow[] {
    return this.db.queryGroupMemories(groupId, options)
  }

  /** 标记记忆为 superseded */
  supersedeMemory(id: string): void {
    this.db.supersedeGroupMemory(id)
  }

  /** 清除指定群组的记忆 */
  clearGroupMemories(groupId: string): number {
    const count = this.db.clearGroupMemories(groupId)
    logger.agent.info(`[GroupMemoryManager] Cleared ${count} memories for group ${groupId}`)
    return count
  }

  /** 清除所有群组记忆 */
  clearAllGroupMemories(): number {
    const count = this.db.clearAllGroupMemories()
    logger.agent.info(`[GroupMemoryManager] Cleared all ${count} group memories`)
    return count
  }

  /** 删除指定来源的记忆 */
  deleteMemoriesBySource(sourceChatId: string): number {
    const count = this.db.deleteGroupMemoriesBySource(sourceChatId)
    logger.agent.info(`[GroupMemoryManager] Deleted ${count} memories from source ${sourceChatId}`)
    return count
  }

  /** 获取群组记忆统计 */
  getStats(groupId?: string): { total: number; active: number; superseded: number; byType: Record<string, number> } {
    return this.db.getGroupMemoryStats(groupId)
  }

  // ============================================
  // 生命周期
  // ============================================

  /** 初始化 */
  init(): void {
    logger.agent.info('[GroupMemoryManager] Initialized')
  }

  /** 清理 */
  cleanup(): void {
    GroupMemoryManager.instance = null
    logger.agent.info('[GroupMemoryManager] Cleaned up')
  }
}