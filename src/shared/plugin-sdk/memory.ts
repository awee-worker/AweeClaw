/**
 * Memory Plugin SDK - 知识库与记忆插件接口
 *
 * 为 Agent 提供持久化记忆和知识库能力：
 * - 短期记忆：会话级上下文，会话结束后清除
 * - 长期记忆：跨会话持久化，支持检索和遗忘
 * - 知识库：结构化知识存储，支持向量检索
 *
 * 设计原则：
 * - Manifest-first：通过 manifest 声明记忆能力
 * - 可插拔：不同后端（本地 SQLite / 向量数据库 / 云端 API）通过插件实现
 * - 隔离性：每个 Agent 有独立的记忆空间
 *
 * @module plugin-sdk/memory
 */

import type { PluginManifest, PluginRuntime, PluginHealthResult } from './types'

// ============================================
// 记忆类型
// ============================================

/** 记忆条目 */
export interface MemoryEntry {
  /** 唯一标识 */
  id: string
  /** 关联的 Agent ID */
  agentId: string
  /** 记忆类型 */
  type: MemoryType
  /** 记忆内容 */
  content: string
  /** 元数据 */
  metadata?: Record<string, unknown>
  /** 重要性评分 (0-1)，影响遗忘策略 */
  importance?: number
  /** 访问次数 */
  accessCount: number
  /** 创建时间 */
  createdAt: number
  /** 最后访问时间 */
  lastAccessedAt: number
  /** 过期时间（0 表示永不过期） */
  expiresAt: number
}

/** 记忆类型 */
export type MemoryType =
  | 'short-term'    // 短期记忆（会话级）
  | 'long-term'     // 长期记忆（跨会话）
  | 'episodic'      // 情景记忆（事件序列）
  | 'semantic'      // 语义记忆（事实知识）
  | 'procedural'    // 过程记忆（操作技能）

/** 记忆查询条件 */
export interface MemoryQuery {
  /** Agent ID */
  agentId: string
  /** 记忆类型过滤 */
  type?: MemoryType
  /** 关键词搜索 */
  keyword?: string
  /** 向量相似度搜索文本 */
  similarityQuery?: string
  /** 时间范围 */
  timeRange?: {
    start: number
    end: number
  }
  /** 最低重要性 */
  minImportance?: number
  /** 返回数量限制 */
  limit?: number
  /** 偏移量 */
  offset?: number
}

/** 记忆查询结果 */
export interface MemoryQueryResult {
  entries: MemoryEntry[]
  total: number
  hasMore: boolean
}

/** 记忆存储选项 */
export interface MemoryStoreOptions {
  /** 自定义过期时间（毫秒） */
  ttl?: number
  /** 重要性评分 */
  importance?: number
  /** 自定义元数据 */
  metadata?: Record<string, unknown>
}

/** 记忆统计 */
export interface MemoryStats {
  /** 总条目数 */
  totalEntries: number
  /** 按类型统计 */
  byType: Record<MemoryType, number>
  /** 存储大小（字节） */
  storageSize: number
  /** 最早条目时间 */
  oldestEntry: number | null
  /** 最近条目时间 */
  newestEntry: number | null
}

// ============================================
// 知识库类型
// ============================================

/** 知识条目 */
export interface KnowledgeEntry {
  /** 唯一标识 */
  id: string
  /** 知识库 ID */
  knowledgeBaseId: string
  /** 标题 */
  title: string
  /** 内容 */
  content: string
  /** 向量嵌入（由 Memory 插件自动生成） */
  embedding?: number[]
  /** 标签 */
  tags: string[]
  /** 来源 */
  source?: string
  /** 元数据 */
  metadata?: Record<string, unknown>
  /** 创建时间 */
  createdAt: number
  /** 更新时间 */
  updatedAt: number
}

/** 知识库 */
export interface KnowledgeBase {
  /** 唯一标识 */
  id: string
  /** 名称 */
  name: string
  /** 描述 */
  description: string
  /** 关联的 Agent ID 列表 */
  agentIds: string[]
  /** 条目数量 */
  entryCount: number
  /** 创建时间 */
  createdAt: number
  /** 更新时间 */
  updatedAt: number
}

/** 知识库查询 */
export interface KnowledgeQuery {
  /** 知识库 ID */
  knowledgeBaseId: string
  /** 相似度搜索文本 */
  query: string
  /** 标签过滤 */
  tags?: string[]
  /** 返回数量限制 */
  limit?: number
  /** 最低相似度阈值 (0-1) */
  minScore?: number
}

/** 知识库查询结果 */
export interface KnowledgeQueryResult {
  entries: Array<KnowledgeEntry & { score: number }>
  total: number
}

// ============================================
// Memory 插件 Manifest
// ============================================

/** Memory 插件能力声明 */
export interface MemoryCapabilities {
  /** 支持的记忆类型 */
  memoryTypes: MemoryType[]
  /** 是否支持向量检索 */
  vectorSearch: boolean
  /** 是否支持知识库 */
  knowledgeBase: boolean
  /** 最大存储条目数 */
  maxEntries: number
  /** 嵌入模型（用于向量检索） */
  embeddingModel?: string
  /** 嵌入维度 */
  embeddingDimensions?: number
}

/** Memory 插件 Manifest */
export interface MemoryPluginManifest extends PluginManifest {
  type: 'memory'
  capabilities: PluginManifest['capabilities'] & {
    memory: MemoryCapabilities
  }
}

// ============================================
// Memory 插件运行时
// ============================================

/** Memory 插件运行时接口 */
export interface MemoryPluginRuntime extends PluginRuntime {
  readonly manifest: MemoryPluginManifest

  // ---- 记忆操作 ----

  /** 存储记忆 */
  store(
    agentId: string,
    type: MemoryType,
    content: string,
    options?: MemoryStoreOptions
  ): Promise<MemoryEntry>

  /** 查询记忆 */
  query(query: MemoryQuery): Promise<MemoryQueryResult>

  /** 获取单条记忆 */
  get(memoryId: string): Promise<MemoryEntry | null>

  /** 删除记忆 */
  delete(memoryId: string): Promise<boolean>

  /** 清除 Agent 的指定类型记忆 */
  clearByAgent(agentId: string, type?: MemoryType): Promise<number>

  /** 获取记忆统计 */
  getStats(agentId: string): Promise<MemoryStats>

  // ---- 知识库操作 ----

  /** 创建知识库 */
  createKnowledgeBase(name: string, description: string, agentIds?: string[]): Promise<KnowledgeBase>

  /** 删除知识库 */
  deleteKnowledgeBase(knowledgeBaseId: string): Promise<boolean>

  /** 添加知识条目 */
  addKnowledge(
    knowledgeBaseId: string,
    title: string,
    content: string,
    tags?: string[],
    source?: string
  ): Promise<KnowledgeEntry>

  /** 删除知识条目 */
  removeKnowledge(knowledgeBaseId: string, entryId: string): Promise<boolean>

  /** 搜索知识库 */
  searchKnowledge(query: KnowledgeQuery): Promise<KnowledgeQueryResult>

  /** 获取知识库列表 */
  listKnowledgeBases(agentId?: string): Promise<KnowledgeBase[]>

  // ---- 遗忘策略 ----

  /** 执行遗忘策略（根据时间、重要性、访问频率清理低价值记忆） */
  runForgetPolicy(agentId: string): Promise<number>

  // ---- 健康检查 ----

  healthCheck(): Promise<PluginHealthResult>
}

// ============================================
// Memory 插件工厂
// ============================================

/** Memory 插件工厂函数 */
export type MemoryPluginFactory = () => MemoryPluginRuntime
