/**
 * 记忆系统状态管理
 * 使用 Zustand 管理记忆列表、筛选、详情、加载状态等
 */
import { create } from 'zustand'
import { logger } from '@shared/toolkit/LogEngine'
import { memoryApi, isApiError } from './api'
import type {
  AgentMemory,
  CategoryConfig,
  ForgettingStats,
  MemoryCategory,
  MemoryFeedback,
  MemoryFeedbackType,
  MemoryFilter,
  MemoryOverview,
  MemoryRelation,
  MemoryRelationType,
  MemorySortField,
  MemoryTier,
  MemoryViewMode,
  SpatialContext,
  SpatialMemory,
  TimelineItem,
  VisualizationData,
} from './types'

interface MemoryState {
  // ============ 数据 ============
  memories: AgentMemory[]
  total: number
  currentMemory: AgentMemory | null
  categories: CategoryConfig[]
  overview: MemoryOverview | null
  forgettingStats: ForgettingStats | null
  visualizationData: VisualizationData | null
  timeline: TimelineItem[]

  // ============ UI 状态 ============
  viewMode: MemoryViewMode
  loading: boolean
  loadingDetail: boolean
  loadingMore: boolean
  error: string | null
  selectedMemoryIds: Set<string>
  showDetailPanel: boolean

  // ============ 筛选与排序 ============
  filter: MemoryFilter
  sortBy: MemorySortField
  sortOrder: 'asc' | 'desc'
  page: number
  pageSize: number

  // ============ 详情面板相关 ============
  relations: MemoryRelation[]
  feedbacks: MemoryFeedback[]
  spatialMemory: SpatialMemory | null

  // ============ Actions ============
  setViewMode: (mode: MemoryViewMode) => void
  setFilter: (filter: Partial<MemoryFilter>) => void
  resetFilter: () => void
  setSortBy: (field: MemorySortField) => void
  setSortOrder: (order: 'asc' | 'desc') => void
  setPage: (page: number) => void
  setPageSize: (size: number) => void
  toggleSelect: (id: string) => void
  selectAll: () => void
  clearSelection: () => void
  setShowDetailPanel: (show: boolean) => void

  // ============ 数据加载 ============
  fetchMemories: (reset?: boolean) => Promise<void>
  fetchMore: () => Promise<void>
  fetchMemoryDetail: (id: string) => Promise<void>
  fetchCategories: () => Promise<void>
  fetchOverview: () => Promise<void>
  fetchForgettingStats: () => Promise<void>
  fetchVisualizationData: (options?: {
    limit?: number
    category?: MemoryCategory
    tier?: MemoryTier
    minImportance?: number
  }) => Promise<void>
  fetchTimeline: (options?: { limit?: number; category?: MemoryCategory }) => Promise<void>

  // ============ 数据操作 ============
  updateMemory: (
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
  ) => Promise<boolean>
  deleteMemory: (id: string, hard?: boolean) => Promise<boolean>
  restoreMemory: (id: string) => Promise<boolean>
  classifyMemory: (memoryId: string, force?: boolean) => Promise<boolean>
  setManualClassification: (
    memoryId: string,
    category: MemoryCategory,
    subcategory?: string,
  ) => Promise<boolean>
  reviewMemory: (memoryId: string) => Promise<boolean>
  attachSpatialContext: (memoryId: string, context: SpatialContext) => Promise<boolean>
  createRelation: (
    sourceMemoryId: string,
    targetMemoryId: string,
    relationType: MemoryRelationType,
    weight?: number,
  ) => Promise<boolean>
  deleteRelation: (relationId: string) => Promise<boolean>
  createFeedback: (
    memoryId: string,
    feedbackType: MemoryFeedbackType,
    comment?: string,
  ) => Promise<boolean>

  // ============ 内部 ============
  clearError: () => void
  reset: () => void
}

const defaultFilter: MemoryFilter = {
  enabledOnly: true,
}

export const useMemoryStore = create<MemoryState>((set, get) => ({
  // ============ 初始数据 ============
  memories: [],
  total: 0,
  currentMemory: null,
  categories: [],
  overview: null,
  forgettingStats: null,
  visualizationData: null,
  timeline: [],

  // ============ 初始 UI 状态 ============
  viewMode: '3d',
  loading: false,
  loadingDetail: false,
  loadingMore: false,
  error: null,
  selectedMemoryIds: new Set(),
  showDetailPanel: false,

  // ============ 初始筛选 ============
  filter: { ...defaultFilter },
  sortBy: 'createdAt',
  sortOrder: 'desc',
  page: 1,
  pageSize: 20,

  // ============ 初始详情数据 ============
  relations: [],
  feedbacks: [],
  spatialMemory: null,

  // ============ UI Actions ============
  setViewMode: (mode) => set({ viewMode: mode }),
  setFilter: (filter) =>
    set((s) => ({ filter: { ...s.filter, ...filter }, page: 1 })),
  resetFilter: () => set({ filter: { ...defaultFilter }, page: 1 }),
  setSortBy: (field) => set({ sortBy: field, page: 1 }),
  setSortOrder: (order) => set({ sortOrder: order, page: 1 }),
  setPage: (page) => set({ page }),
  setPageSize: (size) => set({ pageSize: size, page: 1 }),
  toggleSelect: (id) =>
    set((s) => {
      const next = new Set(s.selectedMemoryIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { selectedMemoryIds: next }
    }),
  selectAll: () =>
    set((s) => ({ selectedMemoryIds: new Set(s.memories.map((m) => m.id)) })),
  clearSelection: () => set({ selectedMemoryIds: new Set() }),
  setShowDetailPanel: (show) => set({ showDetailPanel: show }),
  clearError: () => set({ error: null }),

  // ============ 数据加载 ============
  fetchMemories: async (reset = true) => {
    const { filter, sortBy, sortOrder, page, pageSize } = get()
    set({ loading: reset, loadingMore: !reset, error: null })

    try {
      // 全部筛选条件下沉到 SQL，分页准确
      const query: Parameters<typeof memoryApi.query.listAdvanced>[0] = {
        limit: pageSize,
        offset: (page - 1) * pageSize,
        sortBy,
        sortOrder,
        keyword: filter.keyword,
        categories: filter.categories && filter.categories.length > 0 ? filter.categories : undefined,
        tiers: filter.tiers && filter.tiers.length > 0 ? filter.tiers : undefined,
        tags: filter.tags && filter.tags.length > 0 ? filter.tags : undefined,
        dateFrom: filter.dateFrom ? new Date(filter.dateFrom).getTime() : undefined,
        dateTo: filter.dateTo ? new Date(filter.dateTo).getTime() : undefined,
        minImportance: filter.minImportance,
        maxImportance: filter.maxImportance,
      }

      const res = await memoryApi.query.listAdvanced(query)

      set((s) => ({
        memories: reset ? res.items : [...s.memories, ...res.items],
        total: res.total,
        loading: false,
        loadingMore: false,
      }))
    } catch (err) {
      logger.agent.error('fetchMemories failed', err)
      set({ loading: false, loadingMore: false, error: '加载记忆列表失败' })
    }
  },

  fetchMore: async () => {
    const { total, memories, page } = get()
    if (memories.length >= total) return
    set({ page: page + 1 })
    await get().fetchMemories(false)
  },

  fetchMemoryDetail: async (id) => {
    set({ loadingDetail: true, error: null })
    try {
      const [detailRes, relationsRes, feedbacksRes] = await Promise.all([
        memoryApi.query.detail(id),
        memoryApi.relation.list(id).catch(() => []),
        memoryApi.feedback.list(id).catch(() => []),
      ])

      if (isApiError(detailRes)) {
        set({ error: detailRes.error, loadingDetail: false })
        return
      }

      set({
        currentMemory: detailRes,
        spatialMemory: detailRes.spatialMemory ?? null,
        relations: relationsRes,
        feedbacks: feedbacksRes,
        loadingDetail: false,
        showDetailPanel: true,
      })
    } catch (err) {
      logger.agent.error('fetchMemoryDetail failed', err)
      set({ loadingDetail: false, error: '加载记忆详情失败' })
    }
  },

  fetchCategories: async () => {
    try {
      const data = await memoryApi.classification.getCategories()
      set({ categories: data })
    } catch (err) {
      logger.agent.error('fetchCategories failed', err)
    }
  },

  fetchOverview: async () => {
    try {
      const data = await memoryApi.visualization.getOverview()
      set({ overview: data })
    } catch (err) {
      logger.agent.error('fetchOverview failed', err)
    }
  },

  fetchForgettingStats: async () => {
    try {
      const data = await memoryApi.forgetting.getStats()
      set({ forgettingStats: data })
    } catch (err) {
      logger.agent.error('fetchForgettingStats failed', err)
    }
  },

  fetchVisualizationData: async (options) => {
    try {
      const data = await memoryApi.visualization.getVisualizationData(options)
      set({ visualizationData: data })
    } catch (err) {
      logger.agent.error('fetchVisualizationData failed', err)
    }
  },

  fetchTimeline: async (options) => {
    try {
      const data = await memoryApi.visualization.getTimeline(options)
      set({ timeline: data })
    } catch (err) {
      logger.agent.error('fetchTimeline failed', err)
    }
  },

  // ============ 数据操作 ============
  updateMemory: async (id, body) => {
    try {
      const res = await memoryApi.query.update(id, body)
      if (isApiError(res)) {
        set({ error: res.error })
        return false
      }
      set((s) => ({
        memories: s.memories.map((m) => (m.id === id ? { ...m, ...res } : m)),
        currentMemory: s.currentMemory?.id === id ? { ...s.currentMemory, ...res } : s.currentMemory,
      }))
      return true
    } catch (err) {
      logger.agent.error('updateMemory failed', err)
      set({ error: '更新记忆失败' })
      return false
    }
  },

  deleteMemory: async (id, hard = false) => {
    try {
      const res = await memoryApi.query.delete(id, hard)
      if (isApiError(res)) {
        set({ error: res.error })
        return false
      }
      set((s) => ({
        memories: s.memories.filter((m) => m.id !== id),
        selectedMemoryIds: (() => {
          const next = new Set(s.selectedMemoryIds)
          next.delete(id)
          return next
        })(),
        currentMemory: s.currentMemory?.id === id ? null : s.currentMemory,
        showDetailPanel: s.currentMemory?.id === id ? false : s.showDetailPanel,
      }))
      return true
    } catch (err) {
      logger.agent.error('deleteMemory failed', err)
      set({ error: '删除记忆失败' })
      return false
    }
  },

  restoreMemory: async (id) => {
    try {
      const res = await memoryApi.query.restore(id)
      if (isApiError(res)) {
        set({ error: res.error })
        return false
      }
      set((s) => ({
        memories: s.memories.map((m) =>
          m.id === id ? { ...m, enabled: true } : m,
        ),
      }))
      return true
    } catch (err) {
      logger.agent.error('restoreMemory failed', err)
      set({ error: '恢复记忆失败' })
      return false
    }
  },

  classifyMemory: async (memoryId, force = false) => {
    try {
      const res = await memoryApi.classification.classify(memoryId, { forceReclassify: force })
      set((s) => ({
        memories: s.memories.map((m) =>
          m.id === memoryId
            ? {
                ...m,
                category: res.category,
                subcategory: res.subcategory,
                classifiedBy: res.classifiedBy,
                classifiedAt: new Date().toISOString(),
                classificationConfidence: res.confidence,
              }
            : m,
        ),
        currentMemory:
          s.currentMemory?.id === memoryId
            ? {
                ...s.currentMemory,
                category: res.category,
                subcategory: res.subcategory,
                classifiedBy: res.classifiedBy,
                classifiedAt: new Date().toISOString(),
                classificationConfidence: res.confidence,
              }
            : s.currentMemory,
      }))
      return true
    } catch (err) {
      logger.agent.error('classifyMemory failed', err)
      set({ error: '分类失败' })
      return false
    }
  },

  setManualClassification: async (memoryId, category, subcategory) => {
    try {
      const res = await memoryApi.classification.setManual(memoryId, category, subcategory)
      if (isApiError(res)) {
        set({ error: res.error })
        return false
      }
      set((s) => ({
        memories: s.memories.map((m) => (m.id === memoryId ? { ...m, ...res } : m)),
        currentMemory:
          s.currentMemory?.id === memoryId ? { ...s.currentMemory, ...res } : s.currentMemory,
      }))
      return true
    } catch (err) {
      logger.agent.error('setManualClassification failed', err)
      set({ error: '设置分类失败' })
      return false
    }
  },

  reviewMemory: async (memoryId) => {
    try {
      await memoryApi.forgetting.review(memoryId)
      set((s) => ({
        memories: s.memories.map((m) =>
          m.id === memoryId
            ? {
                ...m,
                reviewCount: (m.reviewCount ?? 0) + 1,
                lastReviewedAt: new Date().toISOString(),
              }
            : m,
        ),
      }))
      return true
    } catch (err) {
      logger.agent.error('reviewMemory failed', err)
      return false
    }
  },

  attachSpatialContext: async (memoryId, context) => {
    try {
      const res = await memoryApi.spatial.attach(memoryId, context)
      if (isApiError(res)) {
        set({ error: res.error })
        return false
      }
      set({ spatialMemory: res })
      return true
    } catch (err) {
      logger.agent.error('attachSpatialContext failed', err)
      set({ error: '附加空间上下文失败' })
      return false
    }
  },

  createRelation: async (sourceMemoryId, targetMemoryId, relationType, weight) => {
    try {
      const res = await memoryApi.relation.create({
        sourceMemoryId,
        targetMemoryId,
        relationType,
        weight,
      })
      if (isApiError(res)) {
        set({ error: res.error })
        return false
      }
      set((s) => ({ relations: [res, ...s.relations] }))
      return true
    } catch (err) {
      logger.agent.error('createRelation failed', err)
      set({ error: '创建关联失败' })
      return false
    }
  },

  deleteRelation: async (relationId) => {
    try {
      const res = await memoryApi.relation.delete(relationId)
      if (isApiError(res)) {
        set({ error: res.error })
        return false
      }
      set((s) => ({ relations: s.relations.filter((r) => r.id !== relationId) }))
      return true
    } catch (err) {
      logger.agent.error('deleteRelation failed', err)
      return false
    }
  },

  createFeedback: async (memoryId, feedbackType, comment) => {
    try {
      const res = await memoryApi.feedback.create({ memoryId, feedbackType, comment })
      if (isApiError(res)) {
        set({ error: res.error })
        return false
      }
      set((s) => ({ feedbacks: [res, ...s.feedbacks] }))
      return true
    } catch (err) {
      logger.agent.error('createFeedback failed', err)
      set({ error: '创建反馈失败' })
      return false
    }
  },

  reset: () =>
    set({
      memories: [],
      total: 0,
      currentMemory: null,
      overview: null,
      forgettingStats: null,
      visualizationData: null,
      timeline: [],
      filter: { ...defaultFilter },
      page: 1,
      selectedMemoryIds: new Set(),
      showDetailPanel: false,
      error: null,
    }),
}))
