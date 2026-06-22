/**
 * 记忆卡片组件
 * 用于列表和网格视图的单条记忆展示
 */
import { useCallback } from 'react'
import { Check, EyeOff } from 'lucide-react'
import { useMemoryStore } from '../store'
import {
  CategoryBadge,
  TierBadge,
  ImportanceIndicator,
  RetentionIndicator,
  TagList,
  formatRelativeTime,
} from './shared'
import type { AgentMemory } from '../types'

interface MemoryCardProps {
  memory: AgentMemory
  selectable?: boolean
  compact?: boolean
}

export function MemoryCard({ memory, selectable = true, compact = false }: MemoryCardProps) {
  const { selectedMemoryIds, toggleSelect, fetchMemoryDetail, currentMemory } = useMemoryStore()
  const isSelected = selectedMemoryIds.has(memory.id)
  const isActive = currentMemory?.id === memory.id

  const handleClick = useCallback(() => {
    fetchMemoryDetail(memory.id)
  }, [fetchMemoryDetail, memory.id])

  const handleSelect = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      toggleSelect(memory.id)
    },
    [toggleSelect, memory.id],
  )

  return (
    <div
      onClick={handleClick}
      className={`group relative cursor-pointer rounded-lg border transition-all duration-200 ${
        isActive
          ? 'border-accent/40 bg-accent/5'
          : 'border-border/40 bg-surface/30 hover:border-border/60 hover:bg-surface-hover/30'
      } ${compact ? 'p-2.5' : 'p-3.5'}`}
    >
      {/* 选中复选框 */}
      {selectable && (
        <button
          onClick={handleSelect}
          className={`absolute top-2 right-2 w-4 h-4 rounded border flex items-center justify-center transition-all ${
            isSelected
              ? 'bg-accent border-accent opacity-100'
              : 'border-border/60 opacity-0 group-hover:opacity-100'
          }`}
        >
          {isSelected && (
            <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          )}
        </button>
      )}

      {/* 头部：分类 + 层级 + 重要性 */}
      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
        <CategoryBadge category={memory.category} size="xs" />
        <TierBadge tier={memory.tier} size="xs" />
        {!memory.enabled && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-500/10 text-gray-500 border border-gray-500/20 flex items-center gap-0.5">
            <EyeOff className="w-2.5 h-2.5" />
            已归档
          </span>
        )}
      </div>

      {/* 内容 */}
      <p
        className={`text-sm text-text-primary leading-relaxed mb-2 ${
          compact ? 'line-clamp-2' : 'line-clamp-3'
        }`}
      >
        {memory.content}
      </p>

      {/* 摘要（如果有） */}
      {memory.summary && !compact && (
        <p className="text-xs text-text-muted line-clamp-1 mb-2 italic">{memory.summary}</p>
      )}

      {/* 标签 */}
      {!compact && <TagList tags={memory.tags} max={4} size="xs" />}

      {/* 底部：重要性 + 保留值 + 时间 */}
      <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-border/20">
        <div className="flex items-center gap-3">
          <ImportanceIndicator importance={memory.importance} />
          {memory.retentionScore !== undefined && (
            <RetentionIndicator retentionScore={memory.retentionScore} />
          )}
        </div>
        <span className="text-[10px] text-text-muted whitespace-nowrap">
          {formatRelativeTime(memory.createdAt)}
        </span>
      </div>

      {/* 分类置信度（如果较低） */}
      {memory.classificationConfidence !== null &&
        memory.classificationConfidence !== undefined &&
        memory.classificationConfidence < 0.6 &&
        memory.classifiedBy !== 'manual' && (
          <div className="mt-1.5 text-[10px] text-amber-500 flex items-center gap-1">
            <span>分类置信度 {Math.round(memory.classificationConfidence * 100)}%</span>
          </div>
        )}
    </div>
  )
}

// ============ 列表项样式（更紧凑） ============

export function MemoryListItem({ memory }: { memory: AgentMemory }) {
  const { selectedMemoryIds, toggleSelect, fetchMemoryDetail, currentMemory } = useMemoryStore()
  const isSelected = selectedMemoryIds.has(memory.id)
  const isActive = currentMemory?.id === memory.id

  const handleClick = useCallback(() => {
    fetchMemoryDetail(memory.id)
  }, [fetchMemoryDetail, memory.id])

  const handleSelect = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      toggleSelect(memory.id)
    },
    [toggleSelect, memory.id],
  )

  return (
    <div
      onClick={handleClick}
      className={`group flex items-start gap-3 px-3 py-2.5 cursor-pointer border-b border-border/20 transition-colors ${
        isActive ? 'bg-accent/5' : 'hover:bg-surface-hover/30'
      }`}
    >
      {/* 复选框 */}
      <button
        onClick={handleSelect}
        className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center transition-all shrink-0 ${
          isSelected
            ? 'bg-accent border-accent'
            : 'border-border/60 opacity-0 group-hover:opacity-100'
        }`}
      >
        {isSelected && <Check className="w-2.5 h-2.5 text-white" />}
      </button>

      {/* 分类色条 */}
      <div
        className="w-0.5 self-stretch rounded-full shrink-0"
        style={{
          backgroundColor: memory.category
            ? // 使用 CATEGORY_META 中的颜色
              ({
                LIFE: '#10B981',
                WORK: '#3B82F6',
                PEOPLE: '#8B5CF6',
                KNOWLEDGE: '#F59E0B',
                PREFERENCE: '#EC4899',
                EVENT: '#EF4444',
                EMOTION: '#F97316',
                FINANCE: '#14B8A6',
                UNCATEGORIZED: '#6B7280',
              } as Record<string, string>)[memory.category] ?? '#6B7280'
            : '#6B7280',
        }}
      />

      {/* 内容区 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <CategoryBadge category={memory.category} size="xs" />
          <TierBadge tier={memory.tier} size="xs" />
          {!memory.enabled && <EyeOff className="w-3 h-3 text-gray-400" />}
        </div>
        <p className="text-sm text-text-primary line-clamp-2 leading-snug">{memory.content}</p>
        <div className="flex items-center gap-3 mt-1">
          <span className="text-[10px] text-text-muted">
            {formatRelativeTime(memory.createdAt)}
          </span>
          <ImportanceIndicator importance={memory.importance} />
          {memory.tags && memory.tags.length > 0 && (
            <span className="text-[10px] text-text-muted">#{memory.tags[0]}</span>
          )}
        </div>
      </div>
    </div>
  )
}
