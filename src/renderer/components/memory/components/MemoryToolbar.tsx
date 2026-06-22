/**
 * 记忆列表工具栏
 * 包含搜索、分类筛选、层级筛选、排序、视图切换、批量操作
 */
import { useState, useCallback } from 'react'
import {
  Search,
  SlidersHorizontal,
  LayoutList,
  LayoutGrid,
  Clock,
  Share2,
  Box,
  ChevronDown,
  X,
  Trash2,
  RefreshCw,
} from 'lucide-react'
import { useMemoryStore } from '../store'
import {
  CATEGORY_META,
  TIER_META,
  type MemoryCategory,
  type MemoryTier,
  type MemoryViewMode,
  type MemorySortField,
} from '../types'

const VIEW_MODES: Array<{ mode: MemoryViewMode; icon: typeof LayoutList; label: string }> = [
  { mode: 'list', icon: LayoutList, label: '列表' },
  { mode: 'grid', icon: LayoutGrid, label: '网格' },
  { mode: 'timeline', icon: Clock, label: '时间轴' },
  { mode: 'graph', icon: Share2, label: '图谱' },
  { mode: '3d', icon: Box, label: '3D' },
]

const SORT_FIELDS: Array<{ field: MemorySortField; label: string }> = [
  { field: 'createdAt', label: '创建时间' },
  { field: 'updatedAt', label: '更新时间' },
  { field: 'importance', label: '重要性' },
  { field: 'retentionScore', label: '保留值' },
  { field: 'lastReviewedAt', label: '复习时间' },
]

export function MemoryToolbar() {
  const {
    filter,
    viewMode,
    sortBy,
    sortOrder,
    selectedMemoryIds,
    memories,
    setViewMode,
    setFilter,
    resetFilter,
    setSortBy,
    setSortOrder,
    clearSelection,
    fetchMemories,
    deleteMemory,
  } = useMemoryStore()

  const [showFilter, setShowFilter] = useState(false)
  const [showSort, setShowSort] = useState(false)
  const [keyword, setKeyword] = useState(filter.keyword ?? '')

  // 关键词搜索（防抖）
  const handleSearch = useCallback(
    (value: string) => {
      setKeyword(value)
      setFilter({ keyword: value || undefined })
      // store 更新后触发 fetch
      setTimeout(() => fetchMemories(true), 300)
    },
    [setFilter, fetchMemories],
  )

  // 切换分类筛选
  const toggleCategory = useCallback(
    (cat: MemoryCategory) => {
      const current = filter.categories ?? []
      const next = current.includes(cat)
        ? current.filter((c) => c !== cat)
        : [...current, cat]
      setFilter({ categories: next.length > 0 ? next : undefined })
      setTimeout(() => fetchMemories(true), 0)
    },
    [filter.categories, setFilter, fetchMemories],
  )

  // 切换层级筛选
  const toggleTier = useCallback(
    (tier: MemoryTier) => {
      const current = filter.tiers ?? []
      const next = current.includes(tier)
        ? current.filter((t) => t !== tier)
        : [...current, tier]
      setFilter({ tiers: next.length > 0 ? next : undefined })
      setTimeout(() => fetchMemories(true), 0)
    },
    [filter.tiers, setFilter, fetchMemories],
  )

  // 批量删除
  const handleBatchDelete = useCallback(async () => {
    if (!confirm(`确定要删除选中的 ${selectedMemoryIds.size} 条记忆吗？`)) return
    const ids = Array.from(selectedMemoryIds)
    await Promise.all(ids.map((id) => deleteMemory(id, false)))
    clearSelection()
  }, [selectedMemoryIds, deleteMemory, clearSelection])

  // 刷新
  const handleRefresh = useCallback(() => {
    fetchMemories(true)
  }, [fetchMemories])

  const hasActiveFilter =
    !!filter.keyword ||
    (filter.categories && filter.categories.length > 0) ||
    (filter.tiers && filter.tiers.length > 0) ||
    filter.minImportance !== undefined

  return (
    <div className="flex flex-col gap-2 px-4 py-3 border-b border-border/40 bg-surface/20">
      {/* 第一行：搜索 + 视图切换 + 操作 */}
      <div className="flex items-center gap-2">
        {/* 搜索框 */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            value={keyword}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="搜索记忆内容、摘要..."
            className="w-full pl-9 pr-3 py-1.5 text-sm bg-surface-hover/50 border border-border/40 rounded-lg focus:outline-none focus:ring-1 focus:ring-accent/40 focus:border-accent/40 text-text-primary placeholder:text-text-muted"
          />
          {keyword && (
            <button
              onClick={() => handleSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex-1" />

        {/* 筛选按钮 */}
        <button
          onClick={() => setShowFilter((v) => !v)}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
            showFilter || hasActiveFilter
              ? 'bg-accent/10 text-accent border-accent/30'
              : 'text-text-secondary hover:bg-surface-hover border-border/40'
          }`}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          筛选
          {hasActiveFilter && (
            <span className="w-1.5 h-1.5 rounded-full bg-accent" />
          )}
        </button>

        {/* 排序按钮 */}
        <div className="relative">
          <button
            onClick={() => setShowSort((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-border/40 text-text-secondary hover:bg-surface-hover transition-colors"
          >
            <span>{SORT_FIELDS.find((s) => s.field === sortBy)?.label ?? '排序'}</span>
            <ChevronDown className="w-3 h-3" />
          </button>
          {showSort && (
            <div className="absolute right-0 top-full mt-1 z-20 w-44 bg-surface border border-border/60 rounded-lg shadow-xl py-1">
              {SORT_FIELDS.map((s) => (
                <button
                  key={s.field}
                  onClick={() => {
                    setSortBy(s.field)
                    setShowSort(false)
                    fetchMemories(true)
                  }}
                  className={`w-full text-left px-3 py-1.5 text-xs hover:bg-surface-hover ${
                    sortBy === s.field ? 'text-accent font-medium' : 'text-text-secondary'
                  }`}
                >
                  {s.label}
                </button>
              ))}
              <div className="border-t border-border/40 my-1" />
              <button
                onClick={() => {
                  setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
                  setShowSort(false)
                  fetchMemories(true)
                }}
                className="w-full text-left px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-hover"
              >
                {sortOrder === 'asc' ? '↑ 升序' : '↓ 降序'}（点击切换）
              </button>
            </div>
          )}
        </div>

        {/* 视图切换 */}
        <div className="flex items-center bg-surface-hover/50 rounded-lg border border-border/40 p-0.5">
          {VIEW_MODES.map((v) => {
            const Icon = v.icon
            return (
              <button
                key={v.mode}
                onClick={() => setViewMode(v.mode)}
                title={v.label}
                className={`p-1.5 rounded-md transition-colors ${
                  viewMode === v.mode
                    ? 'bg-accent/15 text-accent'
                    : 'text-text-muted hover:text-text-primary'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
              </button>
            )
          })}
        </div>

        {/* 刷新 */}
        <button
          onClick={handleRefresh}
          title="刷新"
          className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 第二行：筛选面板（可折叠） */}
      {showFilter && (
        <div className="flex flex-wrap items-center gap-3 pt-2 pb-1 px-1">
          {/* 分类筛选 */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-text-muted">分类：</span>
            {Object.entries(CATEGORY_META).map(([key, meta]) => {
              const cat = key as MemoryCategory
              const active = filter.categories?.includes(cat) ?? false
              return (
                <button
                  key={key}
                  onClick={() => toggleCategory(cat)}
                  className={`text-xs px-2 py-0.5 rounded-full border transition-all ${
                    active
                      ? 'font-medium'
                      : 'text-text-secondary hover:text-text-primary border-border/40'
                  }`}
                  style={
                    active
                      ? {
                          backgroundColor: `${meta.color}20`,
                          color: meta.color,
                          borderColor: `${meta.color}40`,
                        }
                      : undefined
                  }
                >
                  {meta.label}
                </button>
              )
            })}
          </div>

          <div className="w-px h-4 bg-border/40" />

          {/* 层级筛选 */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-text-muted">层级：</span>
            {Object.entries(TIER_META).map(([key, meta]) => {
              const tier = key as MemoryTier
              const active = filter.tiers?.includes(tier) ?? false
              return (
                <button
                  key={key}
                  onClick={() => toggleTier(tier)}
                  className={`text-xs px-2 py-0.5 rounded border transition-all ${
                    active
                      ? 'font-medium'
                      : 'text-text-secondary hover:text-text-primary border-border/40'
                  }`}
                  style={
                    active
                      ? {
                          backgroundColor: `${meta.color}20`,
                          color: meta.color,
                          borderColor: `${meta.color}40`,
                        }
                      : undefined
                  }
                >
                  {meta.label}
                </button>
              )
            })}
          </div>

          {hasActiveFilter && (
            <button
              onClick={() => {
                resetFilter()
                setKeyword('')
                setTimeout(() => fetchMemories(true), 0)
              }}
              className="text-xs text-text-muted hover:text-red-500 transition-colors flex items-center gap-1"
            >
              <X className="w-3 h-3" />
              清除筛选
            </button>
          )}
        </div>
      )}

      {/* 第三行：批量操作栏（仅在有选中时显示） */}
      {selectedMemoryIds.size > 0 && (
        <div className="flex items-center gap-3 pt-2 pb-1 px-3 bg-accent/5 rounded-lg border border-accent/20">
          <span className="text-xs font-medium text-accent">
            已选中 {selectedMemoryIds.size} 项
          </span>
          <div className="flex-1" />
          <button
            onClick={handleBatchDelete}
            className="flex items-center gap-1 text-xs px-2 py-1 rounded text-red-500 hover:bg-red-500/10 transition-colors"
          >
            <Trash2 className="w-3 h-3" />
            批量删除
          </button>
          <button
            onClick={clearSelection}
            className="flex items-center gap-1 text-xs px-2 py-1 rounded text-text-muted hover:bg-surface-hover transition-colors"
          >
            <X className="w-3 h-3" />
            取消
          </button>
        </div>
      )}

      {/* 全选按钮（仅列表视图） */}
      {viewMode === 'list' && memories.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <button
            onClick={() => {
              if (selectedMemoryIds.size === memories.length) {
                clearSelection()
              } else {
                useMemoryStore.getState().selectAll()
              }
            }}
            className="flex items-center gap-1 hover:text-text-primary transition-colors"
          >
            <div
              className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${
                selectedMemoryIds.size === memories.length
                  ? 'bg-accent border-accent'
                  : 'border-border/60'
              }`}
            >
              {selectedMemoryIds.size === memories.length && (
                <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </div>
            全选
          </button>
          <span>共 {useMemoryStore.getState().total} 条记忆</span>
        </div>
      )}
    </div>
  )
}
