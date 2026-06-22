/**
 * 记忆时间轴视图（v3.1 重构）
 *
 * 按月分页加载，支持几十万记忆数据无压力：
 * - 默认加载当前月数据
 * - 上一月/下一月按钮切换
 * - 月份快速跳转下拉
 * - 虚拟滚动：仅渲染可视区域内的 DOM
 *
 * 性能：created_at 索引范围查询 O(log n)，单月最多 1000 条
 */
import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { Clock, ChevronLeft, ChevronRight, Calendar } from 'lucide-react'
import { memoryApi } from '../api'
import { useMemoryStore } from '../store'
import { CATEGORY_META, type MemoryCategory, type TimelineItem } from '../types'
import { CategoryBadge, TierBadge, ImportanceIndicator, EmptyState, LoadingState } from './shared'

// 虚拟滚动参数
const ITEM_HEIGHT = 88 // 单条记忆卡片预估高度
const OVERSCAN = 5 // 上下额外渲染的条数

interface MonthData {
  items: TimelineItem[]
  monthTotal: number
  hasPrev: boolean
  hasNext: boolean
  year: number
  month: number
}

export function MemoryTimelineView() {
  const { fetchMemoryDetail, setShowDetailPanel } = useMemoryStore()
  const [selectedCategory, setSelectedCategory] = useState<MemoryCategory | 'ALL'>('ALL')
  const [monthData, setMonthData] = useState<MonthData | null>(null)
  const [months, setMonths] = useState<Array<{ year: number; month: number; count: number }>>([])
  const [loading, setLoading] = useState(true)

  // 虚拟滚动状态
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(600)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // 加载月份列表
  useEffect(() => {
    memoryApi.visualization.getTimelineMonths(
      selectedCategory === 'ALL' ? {} : { category: selectedCategory }
    ).then(setMonths).catch(() => setMonths([]))
  }, [selectedCategory])

  // 加载当前月数据
  const loadMonth = useCallback(async (year?: number, month?: number) => {
    setLoading(true)
    try {
      const data = await memoryApi.visualization.getTimelineByMonth({
        year,
        month,
        category: selectedCategory === 'ALL' ? undefined : selectedCategory,
        limit: 1000,
      })
      setMonthData(data)
      // 重置滚动位置
      setScrollTop(0)
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = 0
      }
    } catch (err) {
      console.error('加载时间轴失败:', err)
      setMonthData(null)
    } finally {
      setLoading(false)
    }
  }, [selectedCategory])

  // 初始加载
  useEffect(() => {
    loadMonth()
  }, [loadMonth])

  // 监听容器尺寸
  useEffect(() => {
    if (!scrollContainerRef.current) return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setViewportHeight(entry.contentRect.height)
      }
    })
    observer.observe(scrollContainerRef.current)
    return () => observer.disconnect()
  }, [])

  // 按日期分组
  const groupedTimeline = useMemo(() => {
    if (!monthData) return []

    const groups = new Map<string, TimelineItem[]>()
    monthData.items.forEach((item) => {
      const date = new Date(item.createdAt)
      const dateKey = formatDateKey(date)
      if (!groups.has(dateKey)) {
        groups.set(dateKey, [])
      }
      groups.get(dateKey)!.push(item)
    })

    return Array.from(groups.entries()).sort(([a], [b]) => b.localeCompare(a))
  }, [monthData])

  // 虚拟滚动计算
  const virtualItems = useMemo(() => {
    const result: Array<{
      type: 'group' | 'item'
      key: string
      dateKey?: string
      items?: TimelineItem[]
      item?: TimelineItem
      offsetTop: number
      height: number
    }> = []

    let offsetTop = 0
    for (const [dateKey, items] of groupedTimeline) {
      // 分组标题高度
      const groupHeaderHeight = 40
      result.push({
        type: 'group',
        key: `group-${dateKey}`,
        dateKey,
        items,
        offsetTop,
        height: groupHeaderHeight,
      })
      offsetTop += groupHeaderHeight

      // 每条记忆
      for (const item of items) {
        result.push({
          type: 'item',
          key: `item-${item.id}`,
          item,
          offsetTop,
          height: ITEM_HEIGHT,
        })
        offsetTop += ITEM_HEIGHT
      }
    }

    return result
  }, [groupedTimeline])

  // 计算可见范围
  const visibleRange = useMemo(() => {
    const startIndex = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - OVERSCAN)
    const endIndex = Math.min(
      virtualItems.length,
      Math.ceil((scrollTop + viewportHeight) / ITEM_HEIGHT) + OVERSCAN,
    )
    return { startIndex, endIndex }
  }, [scrollTop, viewportHeight, virtualItems.length])

  const totalHeight = virtualItems.length > 0
    ? virtualItems[virtualItems.length - 1].offsetTop + virtualItems[virtualItems.length - 1].height
    : 0

  const handleItemClick = useCallback((item: TimelineItem) => {
    fetchMemoryDetail(item.id)
    setShowDetailPanel(true)
  }, [fetchMemoryDetail, setShowDetailPanel])

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop)
  }, [])

  const handlePrevMonth = () => {
    if (!monthData || !monthData.hasPrev) return
    const prev = new Date(monthData.year, monthData.month - 1, 1)
    loadMonth(prev.getFullYear(), prev.getMonth() + 1)
  }

  const handleNextMonth = () => {
    if (!monthData || !monthData.hasNext) return
    const next = new Date(monthData.year, monthData.month, 1)
    loadMonth(next.getFullYear(), next.getMonth() + 1)
  }

  const handleMonthJump = (year: number, month: number) => {
    loadMonth(year, month)
  }

  const monthLabel = monthData
    ? `${monthData.year}年${monthData.month}月`
    : ''

  return (
    <div className="flex flex-col h-full">
      {/* 顶部工具栏：月份导航 */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border/30 bg-surface/20">
        <Calendar className="w-3.5 h-3.5 text-text-muted" />
        <span className="text-xs text-text-muted">时间轴</span>

        <div className="flex-1" />

        {/* 月份导航 */}
        <div className="flex items-center gap-1">
          <button
            onClick={handlePrevMonth}
            disabled={!monthData?.hasPrev}
            className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-surface-hover/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="上一月"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <MonthJumpButton
            label={monthLabel}
            months={months}
            onJump={handleMonthJump}
          />
          <button
            onClick={handleNextMonth}
            disabled={!monthData?.hasNext}
            className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-surface-hover/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="下一月"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <CategoryFilter value={selectedCategory} onChange={setSelectedCategory} />

        {monthData && (
          <span className="text-xs text-text-muted whitespace-nowrap">
            {monthData.monthTotal} 条
          </span>
        )}
      </div>

      {/* 时间轴内容 */}
      {loading ? (
        <LoadingState message="加载时间轴..." />
      ) : !monthData || monthData.items.length === 0 ? (
        <EmptyState
          icon={<Clock className="w-8 h-8" />}
          title={monthData ? `${monthLabel} 暂无记忆` : '暂无记忆'}
          description={monthData?.hasPrev ? '试试查看上一月' : '开始与 AI 助手对话，记忆将自动记录到时间轴'}
          action={monthData?.hasPrev ? (
            <button
              onClick={handlePrevMonth}
              className="mt-3 px-3 py-1.5 text-xs rounded bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
            >
              查看上一月
            </button>
          ) : undefined}
        />
      ) : (
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto no-scrollbar p-4"
        >
          <div className="relative max-w-3xl mx-auto" style={{ height: totalHeight }}>
            {/* 中轴线 */}
            <div className="absolute left-4 top-0 bottom-0 w-px bg-border/40" />

            {/* 虚拟滚动渲染 */}
            {virtualItems.slice(visibleRange.startIndex, visibleRange.endIndex).map((vi) => {
              if (vi.type === 'group' && vi.dateKey && vi.items) {
                return (
                  <div
                    key={vi.key}
                    className="absolute left-0 right-0"
                    style={{ top: vi.offsetTop, height: vi.height }}
                  >
                    <TimelineGroupHeader dateKey={vi.dateKey} count={vi.items.length} />
                  </div>
                )
              }
              if (vi.type === 'item' && vi.item) {
                return (
                  <div
                    key={vi.key}
                    className="absolute left-0 right-0"
                    style={{ top: vi.offsetTop, height: vi.height }}
                  >
                    <TimelineItemCard item={vi.item} onClick={() => handleItemClick(vi.item!)} />
                  </div>
                )
              }
              return null
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ============ 月份跳转按钮 ============
function MonthJumpButton({
  label,
  months,
  onJump,
}: {
  label: string
  months: Array<{ year: number; month: number; count: number }>
  onJump: (year: number, month: number) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="px-2 py-1 text-xs rounded text-text-primary hover:bg-surface-hover/50 transition-colors min-w-[100px] text-center"
      >
        {label || '选择月份'}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 z-20 max-h-60 overflow-y-auto bg-surface border border-border/40 rounded-lg shadow-xl py-1 min-w-[140px]">
            {months.length === 0 ? (
              <div className="px-3 py-2 text-xs text-text-muted">暂无记忆</div>
            ) : (
              months.map((m) => (
                <button
                  key={`${m.year}-${m.month}`}
                  onClick={() => {
                    onJump(m.year, m.month)
                    setOpen(false)
                  }}
                  className="w-full px-3 py-1.5 text-xs text-left text-text-primary hover:bg-surface-hover/50 transition-colors flex items-center justify-between"
                >
                  <span>{m.year}年{m.month}月</span>
                  <span className="text-text-muted">{m.count}</span>
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ============ 时间轴分组标题 ============
function TimelineGroupHeader({
  dateKey,
  count,
}: {
  dateKey: string
  count: number
}) {
  const dateLabel = formatDateLabel(dateKey)
  return (
    <div className="flex items-center gap-2 ml-10 h-10">
      <div className="absolute left-4 w-2 h-2 rounded-full bg-accent -translate-x-1/2 ring-4 ring-bg-base" />
      <span className="text-sm font-medium text-text-primary">{dateLabel}</span>
      <span className="text-xs text-text-muted">({count})</span>
    </div>
  )
}

// ============ 时间轴卡片 ============
function TimelineItemCard({
  item,
  onClick,
}: {
  item: TimelineItem
  onClick: () => void
}) {
  const meta = CATEGORY_META[item.category] ?? CATEGORY_META.UNCATEGORIZED
  const time = new Date(item.createdAt).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <div
      onClick={onClick}
      className="relative pl-6 pr-3 py-2.5 rounded-lg border border-border/30 bg-surface/40 hover:bg-surface-hover/30 hover:border-border/60 transition-all cursor-pointer group"
    >
      {/* 时间线连接点 */}
      <div
        className="absolute left-0 top-1/2 -translate-x-[18px] -translate-y-1/2 w-2 h-2 rounded-full ring-2 ring-bg-base"
        style={{ backgroundColor: meta.color }}
      />

      <div className="flex items-start gap-2">
        <span className="text-[10px] text-text-muted font-mono shrink-0 mt-0.5">{time}</span>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-text-primary line-clamp-2 group-hover:text-accent transition-colors">
            {item.content}
          </div>
          {item.summary && (
            <div className="text-[10px] text-text-muted mt-1 line-clamp-1">
              {item.summary}
            </div>
          )}
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            <CategoryBadge category={item.category} size="xs" />
            <TierBadge tier={item.tier} size="xs" />
            <ImportanceIndicator importance={item.importance} />
            {item.tags.slice(0, 2).map((tag) => (
              <span
                key={tag}
                className="text-[10px] px-1.5 py-0.5 rounded bg-surface-hover/50 text-text-muted"
              >
                #{tag}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ============ 分类筛选 ============
function CategoryFilter({
  value,
  onChange,
}: {
  value: MemoryCategory | 'ALL'
  onChange: (v: MemoryCategory | 'ALL') => void
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as MemoryCategory | 'ALL')}
      className="text-xs px-2 py-1 bg-surface border border-border/40 rounded focus:outline-none focus:ring-1 focus:ring-accent/40"
    >
      <option value="ALL">全部分类</option>
      {Object.entries(CATEGORY_META)
        .filter(([key]) => key !== 'UNCATEGORIZED')
        .map(([key, meta]) => (
          <option key={key} value={key}>
            {meta.label}
          </option>
        ))}
    </select>
  )
}

// ============ 工具函数 ============
function formatDateKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function formatDateLabel(dateKey: string): string {
  const date = new Date(dateKey)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  const isToday = formatDateKey(date) === formatDateKey(today)
  const isYesterday = formatDateKey(date) === formatDateKey(yesterday)

  if (isToday) return '今天'
  if (isYesterday) return '昨天'

  const month = date.getMonth() + 1
  const day = date.getDate()
  const year = date.getFullYear()
  const currentYear = today.getFullYear()

  if (year === currentYear) {
    return `${month}月${day}日`
  }
  return `${year}年${month}月${day}日`
}
