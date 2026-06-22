/**
 * 记忆系统 API 层
 *
 * v3.0 架构变更：
 *  - 记忆的 CRUD 操作（list/detail/update/delete/restore）优先走本地 SQLite
 *  - 分类、遗忘、可视化等计算密集型操作走后端
 *  - 云端同步（sync）提供手动拉取/推送能力
 *
 * 数据流向：
 *  渲染进程 → api.memoryDb.* → IPC → MemoryDb (主进程) → SQLite
 *  渲染进程 → backendApi → 后端 → PostgreSQL（分类/统计/同步）
 */
import { backendApi } from '@services/backendApi'
import { api } from '@renderer/adapters/electronBridge'
import { logger } from '@shared/toolkit/LogEngine'
import type {
  AgentMemory,
  CategoryConfig,
  ClassificationResult,
  ForgettingStats,
  MemoryFeedback,
  MemoryFeedbackType,
  MemoryListQuery,
  MemoryListResponse,
  MemoryOverview,
  MemoryRelation,
  MemoryRelationType,
  MemoryTier,
  MemoryCategory,
  SpatialContext,
  SpatialMemory,
  TimelineItem,
  VisualizationData,
} from './types'

const BASE = '/api/v1/agent/memory'

// ============ SQLite Row → AgentMemory 转换 ============

/**
 * 将 SQLite 行数据转换为前端 AgentMemory 类型
 * SQLite 存储为 snake_case + 时间戳（毫秒），前端需转为 camelCase + ISO 字符串
 */
function rowToAgentMemory(row: any): AgentMemory {
  return {
    id: row.id,
    userId: row.user_id ?? '',
    conversationId: row.conversation_id,
    type: row.type as any,
    content: row.content,
    summary: row.summary,
    importance: row.importance,
    accessCount: row.access_count,
    lastAccessedAt: row.last_accessed_at ? new Date(row.last_accessed_at).toISOString() : null,
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    embedding: [],
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    category: row.category as MemoryCategory | null,
    subcategory: row.subcategory,
    tier: row.tier as MemoryTier,
    tags: typeof row.tags === 'string' ? JSON.parse(row.tags || '[]') : (row.tags || []),
    enabled: row.enabled === 1,
    version: row.version,
    retentionScore: row.retention_score,
    reviewCount: row.review_count,
    lastReviewedAt: row.last_reviewed_at ? new Date(row.last_reviewed_at).toISOString() : null,
    classifiedBy: row.classified_by,
    classifiedAt: row.classified_at ? new Date(row.classified_at).toISOString() : null,
    classificationConfidence: row.classification_confidence,
  }
}

// ============ 记忆查询管理（本地 SQLite 优先） ============

export const memoryQueryApi = {
  /**
   * 获取记忆列表（从本地 SQLite 读取）
   *
   * v3.0 变更：不再调用后端 API，直接查询本地 SQLite 数据库
   * 云端数据通过手动/自动同步写入本地后即可查询
   */
  async list(query: MemoryListQuery = {}): Promise<MemoryListResponse> {
    // 确保数据库已初始化
    await api.memoryDb.initialize()

    const result = await api.memoryDb.queryEntries({
      limit: query.limit,
      offset: query.offset,
      category: query.category as string | undefined,
      tier: query.tier as string | undefined,
      type: query.type as string | undefined,
      keyword: query.keyword,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
      enabledOnly: true, // 默认只查启用的记忆
    })

    return {
      items: result.items.map(rowToAgentMemory),
      total: result.total,
      limit: query.limit ?? 20,
      offset: query.offset ?? 0,
      hasMore: (query.offset ?? 0) + result.items.length < result.total,
    }
  },

  /**
   * 获取记忆列表（高级筛选版，多分类/多层级/标签/日期全部下沉到 SQL）
   * v3.1 新增：替代 list() 用于 store.fetchMemories，分页准确
   */
  async listAdvanced(query: {
    limit?: number
    offset?: number
    categories?: string[]
    tiers?: string[]
    tags?: string[]
    dateFrom?: number
    dateTo?: number
    minImportance?: number
    maxImportance?: number
    keyword?: string
    sortBy?: string
    sortOrder?: 'asc' | 'desc'
  }): Promise<MemoryListResponse> {
    await api.memoryDb.initialize()

    const result = await api.memoryDb.queryEntries({
      limit: query.limit,
      offset: query.offset,
      categories: query.categories,
      tiers: query.tiers,
      tags: query.tags,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      minImportance: query.minImportance,
      maxImportance: query.maxImportance,
      keyword: query.keyword,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
      enabledOnly: true,
    })

    return {
      items: result.items.map(rowToAgentMemory),
      total: result.total,
      limit: query.limit ?? 20,
      offset: query.offset ?? 0,
      hasMore: (query.offset ?? 0) + result.items.length < result.total,
    }
  },

  /**
   * 获取记忆详情（从本地 SQLite 读取）
   */
  async detail(id: string): Promise<AgentMemory | { error: string }> {
    await api.memoryDb.initialize()
    const row = await api.memoryDb.getEntryById(id)
    if (!row) {
      return { error: '记忆不存在' }
    }
    return rowToAgentMemory(row)
  },

  /**
   * 更新记忆（写入本地 SQLite，标记为待同步）
   *
   * 修改后 sync_status 会变为 pending_push，下次同步时会推送到云端
   */
  async update(
    id: string,
    body: {
      content?: string
      summary?: string
      importance?: number
      category?: MemoryCategory
      subcategory?: string
      tier?: MemoryTier
      tags?: string[]
      enabled?: boolean
    },
  ): Promise<AgentMemory | { error: string }> {
    await api.memoryDb.initialize()

    // 转换为 SQLite 行格式（camelCase → snake_case）
    const updates: Record<string, any> = {}
    if (body.content !== undefined) updates.content = body.content
    if (body.summary !== undefined) updates.summary = body.summary
    if (body.importance !== undefined) updates.importance = body.importance
    if (body.category !== undefined) updates.category = body.category
    if (body.subcategory !== undefined) updates.subcategory = body.subcategory
    if (body.tier !== undefined) updates.tier = body.tier
    if (body.tags !== undefined) updates.tags = JSON.stringify(body.tags)
    if (body.enabled !== undefined) updates.enabled = body.enabled ? 1 : 0

    // 标记为待推送
    updates.sync_status = 'pending_push'
    updates.updated_at = Date.now()

    const result = await api.memoryDb.updateEntry(id, updates)
    if (!result.success) {
      return { error: result.error || '更新失败' }
    }

    // 返回更新后的记忆
    const row = await api.memoryDb.getEntryById(id)
    return row ? rowToAgentMemory(row) : { error: '记忆不存在' }
  },

  /**
   * 删除记忆（本地 SQLite）
   *
   * @param hard true=物理删除，false=软删除（标记 enabled=0）
   */
  async delete(id: string, hard = false): Promise<{ success: boolean; message: string } | { error: string }> {
    await api.memoryDb.initialize()

    if (hard) {
      const result = await api.memoryDb.deleteEntry(id)
      return result.success
        ? { success: true, message: '已永久删除' }
        : { error: result.error || '删除失败' }
    }

    // 软删除：标记为禁用，保留数据
    const result = await api.memoryDb.softDeleteEntry(id)
    return result.success
      ? { success: true, message: '已归档' }
      : { error: result.error || '归档失败' }
  },

  /**
   * 恢复已归档的记忆（设置 enabled=1）
   */
  async restore(id: string): Promise<{ success: boolean; message: string } | { error: string }> {
    await api.memoryDb.initialize()

    const result = await api.memoryDb.updateEntry(id, {
      enabled: 1,
      sync_status: 'pending_push',
      updated_at: Date.now(),
    })

    return result.success
      ? { success: true, message: '已恢复' }
      : { error: result.error || '恢复失败' }
  },
}

// ============ 分类管理 ============

export const memoryClassificationApi = {
  /** 获取所有分类配置 */
  async getCategories(): Promise<CategoryConfig[]> {
    return backendApi.get<CategoryConfig[]>(`${BASE}/classification/categories`)
  },

  /** 自动分类单条记忆 */
  async classify(
    memoryId: string,
    options: { forceReclassify?: boolean } = {},
  ): Promise<ClassificationResult> {
    return backendApi.post<ClassificationResult>(
      `${BASE}/classification/${memoryId}`,
      { forceReclassify: options.forceReclassify ?? false },
    )
  },

  /** 批量分类 */
  async batchClassify(
    options: { limit?: number; unclassifiedOnly?: boolean } = {},
  ): Promise<{ processed: number; results: ClassificationResult[] }> {
    const params = new URLSearchParams()
    if (options.limit) params.set('limit', String(options.limit))
    if (options.unclassifiedOnly) params.set('unclassifiedOnly', 'true')
    const qs = params.toString()
    return backendApi.post<{ processed: number; results: ClassificationResult[] }>(
      `${BASE}/classification/batch${qs ? `?${qs}` : ''}`,
    )
  },

  /** 手动设置分类 */
  async setManual(
    memoryId: string,
    category: MemoryCategory,
    subcategory?: string,
  ): Promise<AgentMemory | { error: string }> {
    return backendApi.put<AgentMemory>(`${BASE}/classification/${memoryId}`, {
      category,
      subcategory,
    })
  },
}

// ============ 遗忘引擎 ============

export const memoryForgettingApi = {
  /**
   * 获取遗忘引擎统计（从本地 SQLite 读取）
   * 返回各层级的记忆数量和平均保留分数
   */
  async getStats(): Promise<ForgettingStats> {
    await api.memoryDb.initialize()

    const stats = await api.memoryDb.getStats()
    const overview = await api.memoryDb.getOverview()

    // 过期记忆数需要后端计算（涉及遗忘引擎的复杂逻辑），本地暂不计算
    const expired = 0

    return {
      total: stats.total,
      active: stats.enabled,
      forgotten: stats.total - stats.enabled,
      expired,
      byTier: overview.byTier.map((t: any) => ({
        tier: t.tier as MemoryTier,
        count: t.count,
        avgRetention: t.avgRetention,
      })),
      promotedToday: 0, // 本地无法计算，需后端
      forgottenToday: 0, // 本地无法计算，需后端
    }
  },

  /** 手动触发遗忘引擎 */
  async runEngine(userId?: string): Promise<{ processed: number; forgotten: number; promoted: number }> {
    const qs = userId ? `?userId=${userId}` : ''
    return backendApi.post<{ processed: number; forgotten: number; promoted: number }>(
      `${BASE}/forgetting/run${qs}`,
    )
  },

  /** 记录复习 */
  async review(memoryId: string): Promise<{ success: boolean; message: string }> {
    return backendApi.post(`${BASE}/forgetting/${memoryId}/review`)
  },

  /** 清理过期记忆 */
  async cleanupExpired(): Promise<{ deleted: number }> {
    return backendApi.post<{ deleted: number }>(`${BASE}/forgetting/cleanup-expired`)
  },
}

// ============ 空间记忆 ============

export const memorySpatialApi = {
  /** 附加空间上下文 */
  async attach(
    memoryId: string,
    context: SpatialContext,
  ): Promise<SpatialMemory | { error: string }> {
    return backendApi.post<SpatialMemory>(`${BASE}/spatial/${memoryId}`, context)
  },

  /** 按位置查询 */
  async findByLocation(
    locationName: string,
    options: { limit?: number } = {},
  ): Promise<SpatialMemory[]> {
    const params = new URLSearchParams({ locationName })
    if (options.limit) params.set('limit', String(options.limit))
    return backendApi.get<SpatialMemory[]>(`${BASE}/spatial/by-location?${params.toString()}`)
  },

  /** 按场景查询 */
  async findByScene(
    sceneType: string,
    options: { limit?: number } = {},
  ): Promise<SpatialMemory[]> {
    const params = new URLSearchParams({ sceneType })
    if (options.limit) params.set('limit', String(options.limit))
    return backendApi.get<SpatialMemory[]>(`${BASE}/spatial/by-scene?${params.toString()}`)
  },

  /** 按设备查询 */
  async findByDevice(
    deviceName: string,
    options: { limit?: number } = {},
  ): Promise<SpatialMemory[]> {
    const params = new URLSearchParams({ deviceName })
    if (options.limit) params.set('limit', String(options.limit))
    return backendApi.get<SpatialMemory[]>(`${BASE}/spatial/by-device?${params.toString()}`)
  },

  /** 空间统计 */
  async getStats(): Promise<{
    totalLocations: number
    totalScenes: number
    topLocations: Array<{ locationName: string; count: number }>
    topScenes: Array<{ sceneType: string; count: number }>
  }> {
    return backendApi.get(`${BASE}/spatial/stats`)
  },
}

// ============ 可视化 ============

export const memoryVisualizationApi = {
  /**
   * 获取可视化数据（从本地 SQLite 读取）
   * 返回节点（记忆）和边（关联关系），用于 3D 图谱渲染
   */
  async getVisualizationData(options: {
    limit?: number
    category?: MemoryCategory
    tier?: MemoryTier
    minImportance?: number
  } = {}): Promise<VisualizationData> {
    await api.memoryDb.initialize()

    const data = await api.memoryDb.getVisualizationData({
      limit: options.limit,
      category: options.category as string | undefined,
      tier: options.tier as string | undefined,
      minImportance: options.minImportance,
    })

    // 转换为前端类型格式
    return {
      nodes: data.nodes.map((n: any) => ({
        id: n.id,
        label: n.label,
        category: n.category as MemoryCategory,
        tier: n.tier as MemoryTier,
        importance: n.importance,
        retentionScore: n.retentionScore,
        createdAt: new Date(n.createdAt).toISOString(),
      })),
      edges: data.edges.map((e: any) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: e.type as any,
        weight: e.weight,
      })),
      meta: data.meta,
    }
  },

  /**
   * 获取时间轴数据（从本地 SQLite 读取）
   */
  async getTimeline(options: { limit?: number; category?: MemoryCategory } = {}): Promise<TimelineItem[]> {
    await api.memoryDb.initialize()

    const rows = await api.memoryDb.getTimeline({
      limit: options.limit,
      category: options.category as string | undefined,
    })

    return rows.map((r: any) => ({
      id: r.id,
      content: r.content,
      summary: r.summary,
      category: (r.category ?? 'UNCATEGORIZED') as MemoryCategory,
      tier: r.tier as MemoryTier,
      importance: r.importance,
      createdAt: new Date(r.created_at).toISOString(),
      tags: [],
    }))
  },

  /**
   * 按月分页获取时间轴数据（v3.1 新增）
   * 性能：按 created_at 索引范围查询，几十万数据无压力
   */
  async getTimelineByMonth(options: {
    year?: number
    month?: number
    category?: MemoryCategory
    limit?: number
  } = {}): Promise<{
    items: TimelineItem[]
    monthTotal: number
    hasPrev: boolean
    hasNext: boolean
    year: number
    month: number
  }> {
    await api.memoryDb.initialize()

    const data = await api.memoryDb.getTimelineByMonth({
      year: options.year,
      month: options.month,
      category: options.category as string | undefined,
      limit: options.limit,
    })

    return {
      items: data.items.map((r: any) => ({
        id: r.id,
        content: r.content,
        summary: r.summary,
        category: (r.category ?? 'UNCATEGORIZED') as MemoryCategory,
        tier: r.tier as MemoryTier,
        importance: r.importance,
        createdAt: new Date(r.created_at).toISOString(),
        tags: [],
      })),
      monthTotal: data.monthTotal,
      hasPrev: data.hasPrev,
      hasNext: data.hasNext,
      year: data.year,
      month: data.month,
    }
  },

  /**
   * 获取所有有记忆的月份列表（用于时间轴快速跳转）
   */
  async getTimelineMonths(options: { category?: MemoryCategory } = {}): Promise<Array<{ year: number; month: number; count: number }>> {
    await api.memoryDb.initialize()
    return api.memoryDb.getTimelineMonths({
      category: options.category as string | undefined,
    })
  },

  /**
   * 获取概览统计（从本地 SQLite 读取）
   * 返回分类分布、层级分布、近期增长、热门标签
   */
  async getOverview(): Promise<MemoryOverview> {
    await api.memoryDb.initialize()

    const data = await api.memoryDb.getOverview()

    return {
      total: data.total,
      active: data.active,
      forgotten: data.forgotten,
      byCategory: data.byCategory.map((c: any) => ({
        category: c.category as MemoryCategory,
        count: c.count,
        avgImportance: c.avgImportance,
      })),
      byTier: data.byTier.map((t: any) => ({
        tier: t.tier as MemoryTier,
        count: t.count,
        avgRetention: t.avgRetention,
      })),
      recentGrowth: data.recentGrowth,
      topTags: data.topTags,
    }
  },

  /** 获取关联图谱 */
  async getRelationGraph(
    memoryId: string,
    depth = 1,
  ): Promise<{ nodes: AgentMemory[]; edges: MemoryRelation[] }> {
    return backendApi.get<{ nodes: AgentMemory[]; edges: MemoryRelation[] }>(
      `${BASE}/visualization/graph/${memoryId}?depth=${depth}`,
    )
  },
}

// ============ 关联管理 ============

export const memoryRelationApi = {
  /** 创建关联 */
  async create(body: {
    sourceMemoryId: string
    targetMemoryId: string
    relationType: MemoryRelationType
    weight?: number
  }): Promise<MemoryRelation | { error: string }> {
    return backendApi.post<MemoryRelation>(`${BASE}/relations`, body)
  },

  /** 获取记忆的所有关联 */
  async list(memoryId: string, relationType?: MemoryRelationType): Promise<MemoryRelation[]> {
    const qs = relationType ? `?relationType=${relationType}` : ''
    return backendApi.get<MemoryRelation[]>(`${BASE}/relations/${memoryId}${qs}`)
  },

  /** 删除关联 */
  async delete(relationId: string): Promise<{ success: boolean; message: string } | { error: string }> {
    return backendApi.delete(`${BASE}/relations/${relationId}`)
  },
}

// ============ 反馈管理 ============

export const memoryFeedbackApi = {
  /** 创建反馈 */
  async create(body: {
    memoryId: string
    feedbackType: MemoryFeedbackType
    comment?: string
  }): Promise<MemoryFeedback | { error: string }> {
    return backendApi.post<MemoryFeedback>(`${BASE}/feedbacks`, body)
  },

  /** 获取记忆的反馈列表 */
  async list(memoryId: string, limit?: number): Promise<MemoryFeedback[]> {
    const qs = limit ? `?limit=${limit}` : ''
    return backendApi.get<MemoryFeedback[]>(`${BASE}/feedbacks/${memoryId}${qs}`)
  },

  /** 获取用户反馈统计 */
  async getStats(): Promise<Array<{ feedbackType: MemoryFeedbackType; count: number }>> {
    return backendApi.get(`${BASE}/feedbacks/stats/summary`)
  },
}

// ============ 云端同步管理 ============

/**
 * 云端同步 API
 *
 * 后端只做记忆的备份，客户端可设置是否同步至云端。
 * 同步至云端的好处：
 *  1. 跨设备使用记忆（PC + 移动端）
 *  2. 数据备份，防止本地丢失
 *  3. 长期积累的用户画像不会因重装而丢失
 */
export const memorySyncApi = {
  /**
   * 拉取云端所有记忆（用于手动同步到本地 SQLite）
   * 返回当前用户的所有云端记忆数据
   */
  async pullAll(userId: string): Promise<{ items: AgentMemory[]; total: number; lastSyncedAt?: number } | { error: string }> {
    return backendApi.get(`${BASE}/sync/pull?userId=${encodeURIComponent(userId)}&limit=10000`)
  },

  /**
   * 增量拉取：只获取上次同步后更新的记忆
   */
  async pullIncremental(userId: string, since: number): Promise<{ items: AgentMemory[]; total: number } | { error: string }> {
    return backendApi.get(`${BASE}/sync/pull?userId=${encodeURIComponent(userId)}&since=${since}&limit=10000`)
  },

  /**
   * 推送本地记忆到云端（备份）
   */
  async push(userId: string, entries: AgentMemory[]): Promise<{ pushed: number; failed: number } | { error: string }> {
    return backendApi.post(`${BASE}/sync/push?userId=${encodeURIComponent(userId)}`, { entries })
  },

  /**
   * 获取云端同步状态
   */
  async getSyncStatus(userId: string): Promise<{ lastSyncedAt: number; totalRemote: number; totalLocal: number } | { error: string }> {
    return backendApi.get(`${BASE}/sync/status?userId=${encodeURIComponent(userId)}`)
  },
}

// ============ 统一导出 ============

export const memoryApi = {
  query: memoryQueryApi,
  classification: memoryClassificationApi,
  forgetting: memoryForgettingApi,
  spatial: memorySpatialApi,
  visualization: memoryVisualizationApi,
  relation: memoryRelationApi,
  feedback: memoryFeedbackApi,
  sync: memorySyncApi,
}

// ============ 错误处理辅助 ============

export function isApiError<T>(res: T | { error: string }): res is { error: string } {
  return typeof res === 'object' && res !== null && 'error' in res && typeof (res as { error: string }).error === 'string'
}

export function safeCall<T>(promise: Promise<T>, fallback: T): Promise<T> {
  return promise.catch((err) => {
    logger.agent.error('Memory API call failed', err)
    return fallback
  })
}
