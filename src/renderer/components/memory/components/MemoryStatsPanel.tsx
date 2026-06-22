/**
 * 记忆统计面板
 * 展示记忆总数、分类分布、层级分布、增长趋势、热门标签
 */
import { useEffect, useMemo } from 'react'
import {
  Brain,
  TrendingUp,
  Tags,
  Activity,
  Layers,
  Database,
  Clock,
  Sparkles,
} from 'lucide-react'
import { useMemoryStore } from '../store'
import { CATEGORY_META, TIER_META, type MemoryCategory, type MemoryTier } from '../types'
import { LoadingState } from './shared'

export function MemoryStatsPanel() {
  const { overview, forgettingStats, fetchOverview, fetchForgettingStats } = useMemoryStore()

  useEffect(() => {
    fetchOverview()
    fetchForgettingStats()
  }, [fetchOverview, fetchForgettingStats])

  const totalMemories = overview?.total ?? 0
  const activeMemories = overview?.active ?? 0
  const forgottenMemories = overview?.forgotten ?? 0
  const activeRate = totalMemories > 0 ? Math.round((activeMemories / totalMemories) * 100) : 0

  // 增长趋势数据
  const recentGrowth = useMemo(() => overview?.recentGrowth ?? [], [overview])
  const maxGrowth = useMemo(
    () => Math.max(1, ...recentGrowth.map((g) => g.count)),
    [recentGrowth],
  )

  if (!overview && !forgettingStats) {
    return <LoadingState message="加载统计数据..." />
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto no-scrollbar p-4 space-y-4">
      {/* 顶部指标卡片 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          icon={<Database className="w-4 h-4" />}
          label="记忆总数"
          value={totalMemories}
          color="#3B82F6"
        />
        <StatCard
          icon={<Activity className="w-4 h-4" />}
          label="活跃记忆"
          value={activeMemories}
          subtitle={`占比 ${activeRate}%`}
          color="#10B981"
        />
        <StatCard
          icon={<Brain className="w-4 h-4" />}
          label="已遗忘"
          value={forgottenMemories}
          color="#6B7280"
        />
        <StatCard
          icon={<Sparkles className="w-4 h-4" />}
          label="今日巩固"
          value={forgettingStats?.promotedToday ?? 0}
          subtitle={`遗忘 ${forgettingStats?.forgottenToday ?? 0}`}
          color="#F59E0B"
        />
      </div>

      {/* 分类分布 */}
      <SectionCard
        title="分类分布"
        icon={<Layers className="w-4 h-4" />}
      >
        {overview?.byCategory && overview.byCategory.length > 0 ? (
          <div className="space-y-2">
            {overview.byCategory
              .sort((a, b) => b.count - a.count)
              .map((item) => {
                const meta = CATEGORY_META[item.category as MemoryCategory]
                const percentage = totalMemories > 0 ? (item.count / totalMemories) * 100 : 0
                return (
                  <div key={item.category} className="flex items-center gap-3">
                    <div className="flex items-center gap-2 w-24 shrink-0">
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: meta?.color ?? '#6B7280' }}
                      />
                      <span className="text-xs text-text-secondary">{meta?.label ?? item.category}</span>
                    </div>
                    <div className="flex-1 h-2 bg-surface-hover rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${percentage}%`,
                          backgroundColor: meta?.color ?? '#6B7280',
                        }}
                      />
                    </div>
                    <div className="flex items-center gap-2 w-20 justify-end shrink-0">
                      <span className="text-xs font-mono text-text-primary">{item.count}</span>
                      <span className="text-[10px] text-text-muted">
                        {percentage.toFixed(0)}%
                      </span>
                    </div>
                  </div>
                )
              })}
          </div>
        ) : (
          <EmptyHint text="暂无分类数据" />
        )}
      </SectionCard>

      {/* 层级分布 */}
      <SectionCard title="层级分布" icon={<Brain className="w-4 h-4" />}>
        {overview?.byTier && overview.byTier.length > 0 ? (
          <div className="grid grid-cols-2 gap-3">
            {overview.byTier.map((item) => {
              const meta = TIER_META[item.tier as MemoryTier]
              const percentage = totalMemories > 0 ? (item.count / totalMemories) * 100 : 0
              return (
                <div
                  key={item.tier}
                  className="p-3 rounded-lg border border-border/30 bg-surface-hover/20"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span
                      className="text-xs font-medium px-2 py-0.5 rounded"
                      style={{
                        backgroundColor: `${meta?.color ?? '#6B7280'}20`,
                        color: meta?.color ?? '#6B7280',
                      }}
                    >
                      {meta?.label ?? item.tier}
                    </span>
                    <span className="text-xs font-mono text-text-primary">{item.count}</span>
                  </div>
                  <div className="text-[10px] text-text-muted mb-1">
                    平均保留值: {((item.avgRetention ?? 0) * 100).toFixed(0)}%
                  </div>
                  <div className="h-1.5 bg-surface-hover rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${percentage}%`,
                        backgroundColor: meta?.color ?? '#6B7280',
                      }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <EmptyHint text="暂无层级数据" />
        )}
      </SectionCard>

      {/* 增长趋势 */}
      <SectionCard title="近 14 天增长趋势" icon={<TrendingUp className="w-4 h-4" />}>
        {recentGrowth.length > 0 ? (
          <div className="flex items-end justify-between gap-1 h-32 px-1">
            {recentGrowth.map((g, i) => {
              const height = maxGrowth > 0 ? (g.count / maxGrowth) * 100 : 0
              return (
                <div
                  key={i}
                  className="flex-1 flex flex-col items-center gap-1 group"
                  title={`${g.date}: ${g.count} 条`}
                >
                  <span className="text-[10px] text-text-muted opacity-0 group-hover:opacity-100 transition-opacity">
                    {g.count}
                  </span>
                  <div className="w-full flex-1 flex items-end">
                    <div
                      className="w-full rounded-t transition-all duration-500 hover:bg-accent/80"
                      style={{
                        height: `${Math.max(2, height)}%`,
                        backgroundColor: 'rgba(59, 130, 246, 0.5)',
                      }}
                    />
                  </div>
                  <span className="text-[9px] text-text-muted">
                    {g.date.slice(5)}
                  </span>
                </div>
              )
            })}
          </div>
        ) : (
          <EmptyHint text="暂无增长数据" />
        )}
      </SectionCard>

      {/* 热门标签 */}
      <SectionCard title="热门标签" icon={<Tags className="w-4 h-4" />}>
        {overview?.topTags && overview.topTags.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {overview.topTags.map((tag) => {
              const size = Math.max(0.75, Math.min(1.4, 0.75 + tag.count / 20))
              return (
                <span
                  key={tag.tag}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-surface-hover/50 border border-border/40 hover:border-accent/40 transition-colors cursor-default"
                  style={{ fontSize: `${size}rem` }}
                >
                  <span className="text-text-muted">#</span>
                  <span className="text-text-primary">{tag.tag}</span>
                  <span className="text-[10px] text-text-muted font-mono">{tag.count}</span>
                </span>
              )
            })}
          </div>
        ) : (
          <EmptyHint text="暂无标签数据" />
        )}
      </SectionCard>

      {/* 遗忘引擎状态 */}
      {forgettingStats && (
        <SectionCard title="遗忘引擎状态" icon={<Clock className="w-4 h-4" />}>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="flex items-center justify-between p-2 bg-surface-hover/20 rounded">
              <span className="text-text-muted">总记忆</span>
              <span className="font-mono text-text-primary">{forgettingStats.total}</span>
            </div>
            <div className="flex items-center justify-between p-2 bg-surface-hover/20 rounded">
              <span className="text-text-muted">活跃</span>
              <span className="font-mono text-green-500">{forgettingStats.active}</span>
            </div>
            <div className="flex items-center justify-between p-2 bg-surface-hover/20 rounded">
              <span className="text-text-muted">已遗忘</span>
              <span className="font-mono text-text-muted">{forgettingStats.forgotten}</span>
            </div>
            <div className="flex items-center justify-between p-2 bg-surface-hover/20 rounded">
              <span className="text-text-muted">已过期</span>
              <span className="font-mono text-red-500">{forgettingStats.expired}</span>
            </div>
          </div>
        </SectionCard>
      )}
    </div>
  )
}

// ============ 辅助组件 ============

function StatCard({
  icon,
  label,
  value,
  subtitle,
  color,
}: {
  icon: React.ReactNode
  label: string
  value: number
  subtitle?: string
  color: string
}) {
  return (
    <div className="p-3 rounded-lg border border-border/30 bg-surface/30">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-text-muted">{label}</span>
        <span style={{ color }}>{icon}</span>
      </div>
      <div className="text-2xl font-semibold text-text-primary font-mono">{value}</div>
      {subtitle && <div className="text-[10px] text-text-muted mt-0.5">{subtitle}</div>}
    </div>
  )
}

function SectionCard({
  title,
  icon,
  children,
}: {
  title: string
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-border/30 bg-surface/20 p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-accent">{icon}</span>
        <h3 className="text-sm font-medium text-text-primary">{title}</h3>
      </div>
      {children}
    </div>
  )
}

function EmptyHint({ text }: { text: string }) {
  return <div className="text-xs text-text-muted text-center py-4">{text}</div>
}
