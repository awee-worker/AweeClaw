/**
 * 记忆系统共享 UI 组件
 * 分类徽章、层级徽章、重要性指示器、空状态、加载状态等
 */
import { ReactNode } from 'react'
import {
  CATEGORY_META,
  TIER_META,
  RELATION_TYPE_META,
  type MemoryCategory,
  type MemoryTier,
  type MemoryRelationType,
} from '../types'

// ============ 分类徽章 ============

export function CategoryBadge({
  category,
  size = 'sm',
}: {
  category: MemoryCategory | null | undefined
  size?: 'xs' | 'sm' | 'md'
}) {
  if (!category) return null
  const meta = CATEGORY_META[category]
  if (!meta) return null

  const sizeClass =
    size === 'xs'
      ? 'text-[10px] px-1.5 py-0.5'
      : size === 'sm'
        ? 'text-xs px-2 py-0.5'
        : 'text-sm px-2.5 py-1'

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium ${sizeClass}`}
      style={{
        backgroundColor: `${meta.color}20`,
        color: meta.color,
        border: `1px solid ${meta.color}40`,
      }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ backgroundColor: meta.color }}
      />
      {meta.label}
    </span>
  )
}

// ============ 层级徽章 ============

export function TierBadge({
  tier,
  size = 'sm',
}: {
  tier: MemoryTier | null | undefined
  size?: 'xs' | 'sm' | 'md'
}) {
  if (!tier) return null
  const meta = TIER_META[tier]
  if (!meta) return null

  const sizeClass =
    size === 'xs'
      ? 'text-[10px] px-1.5 py-0.5'
      : size === 'sm'
        ? 'text-xs px-2 py-0.5'
        : 'text-sm px-2.5 py-1'

  return (
    <span
      className={`inline-flex items-center gap-1 rounded font-medium ${sizeClass}`}
      style={{
        backgroundColor: `${meta.color}20`,
        color: meta.color,
        border: `1px solid ${meta.color}40`,
      }}
      title={meta.description}
    >
      {meta.label}
    </span>
  )
}

// ============ 重要性指示器 ============

export function ImportanceIndicator({
  importance,
  showLabel = false,
}: {
  importance: number
  showLabel?: boolean
}) {
  const value = Math.max(0, Math.min(1, importance))
  const color =
    value >= 0.8 ? '#DC2626' : value >= 0.5 ? '#F59E0B' : value >= 0.2 ? '#3B82F6' : '#6B7280'
  const label = value >= 0.8 ? '高' : value >= 0.5 ? '中' : value >= 0.2 ? '低' : '极低'

  return (
    <div className="inline-flex items-center gap-1.5">
      <div className="flex items-center gap-0.5">
        {[0.25, 0.5, 0.75, 1].map((threshold) => (
          <span
            key={threshold}
            className="w-1 h-3 rounded-sm"
            style={{
              backgroundColor: value >= threshold ? color : `${color}30`,
            }}
          />
        ))}
      </div>
      {showLabel && (
        <span className="text-xs font-medium" style={{ color }}>
          {label}
        </span>
      )}
    </div>
  )
}

// ============ 保留值指示器 ============

export function RetentionIndicator({ retentionScore }: { retentionScore: number }) {
  const value = Math.max(0, Math.min(1, retentionScore))
  const percentage = Math.round(value * 100)
  const color =
    value >= 0.7 ? '#10B981' : value >= 0.3 ? '#F59E0B' : '#EF4444'

  return (
    <div className="inline-flex items-center gap-1.5" title={`保留值 ${percentage}%`}>
      <div className="w-12 h-1.5 rounded-full bg-surface-hover overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${percentage}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-[10px] font-mono text-text-muted">{percentage}%</span>
    </div>
  )
}

// ============ 关联类型徽章 ============

export function RelationTypeBadge({
  relationType,
  size = 'sm',
}: {
  relationType: MemoryRelationType
  size?: 'xs' | 'sm' | 'md'
}) {
  const meta = RELATION_TYPE_META[relationType]
  if (!meta) return null

  const sizeClass =
    size === 'xs'
      ? 'text-[10px] px-1.5 py-0.5'
      : size === 'sm'
        ? 'text-xs px-2 py-0.5'
        : 'text-sm px-2.5 py-1'

  return (
    <span
      className={`inline-flex items-center rounded ${sizeClass}`}
      style={{
        backgroundColor: `${meta.color}20`,
        color: meta.color,
      }}
    >
      {meta.label}
    </span>
  )
}

// ============ 空状态 ============

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      {icon && <div className="mb-4 text-text-muted opacity-50">{icon}</div>}
      <h3 className="text-base font-medium text-text-primary mb-1">{title}</h3>
      {description && (
        <p className="text-sm text-text-muted max-w-sm">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

// ============ 加载状态 ============

export function LoadingState({ message = '加载中...' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16">
      <div className="w-8 h-8 border-2 border-accent/30 border-t-accent rounded-full animate-spin mb-3" />
      <p className="text-sm text-text-muted">{message}</p>
    </div>
  )
}

// ============ 错误状态 ============

export function ErrorState({
  message,
  onRetry,
}: {
  message: string
  onRetry?: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center mb-3">
        <svg
          className="w-5 h-5 text-red-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
      </div>
      <p className="text-sm text-text-primary mb-3">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="px-3 py-1.5 text-xs font-medium text-accent border border-accent/30 rounded-lg hover:bg-accent/10 transition-colors"
        >
          重试
        </button>
      )}
    </div>
  )
}

// ============ 标签列表 ============

export function TagList({
  tags,
  max = 5,
  size = 'sm',
}: {
  tags?: string[] | null
  max?: number
  size?: 'xs' | 'sm'
}) {
  if (!tags || tags.length === 0) return null
  const visible = tags.slice(0, max)
  const remaining = tags.length - visible.length

  const sizeClass = size === 'xs' ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-0.5'

  return (
    <div className="flex flex-wrap items-center gap-1">
      {visible.map((tag) => (
        <span
          key={tag}
          className={`${sizeClass} rounded bg-surface-hover text-text-secondary border border-border/40`}
        >
          #{tag}
        </span>
      ))}
      {remaining > 0 && (
        <span className={`text-text-muted ${sizeClass}`}>+{remaining}</span>
      )}
    </div>
  )
}

// ============ 时间格式化 ============

export function formatRelativeTime(date: string | Date | null | undefined): string {
  if (!date) return ''
  const d = typeof date === 'string' ? new Date(date) : date
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  const months = Math.floor(days / 30)
  const years = Math.floor(days / 365)

  if (seconds < 60) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  if (hours < 24) return `${hours} 小时前`
  if (days < 7) return `${days} 天前`
  if (days < 30) return `${Math.floor(days / 7)} 周前`
  if (months < 12) return `${months} 个月前`
  return `${years} 年前`
}

export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return ''
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
