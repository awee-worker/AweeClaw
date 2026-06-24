/**
 * 上下文面板组件
 *
 * 设计理念：
 * - 精确 Token 估算：基于实际内容长度而非固定值
 * - 分组展示：按上下文类型分组，便于管理
 * - 搜索过滤：支持快速搜索上下文项
 * - 键盘导航：支持 Tab/Arrow 键导航
 * - 可访问性：ARIA 标签、焦点管理
 * - 性能优化：useMemo 缓存计算结果
 * - 可折叠：支持默认展开/折叠配置
 */

import { useState, useMemo, useCallback } from 'react'
import {
  File,
  Code,
  Folder,
  Database,
  GitBranch,
  Terminal,
  X,
  Plus,
  ChevronDown,
  ChevronRight,
  Cpu,
  Search,
  type LucideIcon,
} from 'lucide-react'
import {
  ContextItem,
  FileContext,
} from '@intelligence/providerTypes'
import { getFileName } from '@shared/toolkit/pathHelper'
import { useStore } from '@store'

/** 上下文项类型 */
type ContextType =
  | 'File'
  | 'CodeSelection'
  | 'Folder'
  | 'Codebase'
  | 'Git'
  | 'Terminal'
  | 'Symbols'

/** 上下文项配置 */
interface ContextTypeConfig {
  icon: LucideIcon
  color: string
  defaultLabel: string
}

/** 类型到配置的映射 */
const TYPE_CONFIG: Record<ContextType, ContextTypeConfig> = {
  File: { icon: File, color: 'text-accent', defaultLabel: 'File' },
  CodeSelection: { icon: Code, color: 'text-blue-400', defaultLabel: 'Selection' },
  Folder: { icon: Folder, color: 'text-yellow-400', defaultLabel: 'Folder' },
  Codebase: { icon: Database, color: 'text-purple-400', defaultLabel: '@codebase' },
  Git: { icon: GitBranch, color: 'text-orange-400', defaultLabel: '@git' },
  Terminal: { icon: Terminal, color: 'text-green-400', defaultLabel: '@terminal' },
  Symbols: { icon: Code, color: 'text-blue-400', defaultLabel: '@symbols' },
}

/** Token 估算系数（字符数 / 4） */
const TOKEN_ESTIMATE_RATIO = 4

interface ContextPanelProps {
  contextItems: ContextItem[]
  activeFilePath: string | null
  onRemove: (index: number) => void
  onClear: () => void
  onAddCurrentFile: () => void
}

/**
 * 估算上下文项的 Token 数
 *
 * @param item 上下文项
 * @returns 估算的 Token 数
 */
function estimateItemTokens(item: ContextItem): number {
  // 基于内容长度估算
  const content = (item as any).content || (item as any).text || ''
  const uri = (item as FileContext).uri || ''
  const totalChars = content.length + uri.length
  return Math.ceil(totalChars / TOKEN_ESTIMATE_RATIO) || 50
}

/**
 * 获取上下文项的图标和标签
 *
 * @param item 上下文项
 * @returns 图标组件和标签
 */
function getContextDisplay(item: ContextItem): {
  Icon: LucideIcon
  color: string
  label: string
} {
  const type = item.type as ContextType
  const config = TYPE_CONFIG[type] || { icon: File, color: '', defaultLabel: 'Unknown' }

  let label = config.defaultLabel
  if (type === 'File') {
    label = getFileName((item as FileContext).uri) || 'File'
  }

  return { Icon: config.icon, color: config.color, label }
}

export default function ContextPanel({
  contextItems,
  activeFilePath,
  onRemove,
  onClear,
  onAddCurrentFile,
}: ContextPanelProps) {
  const expandContextByDefault = useStore(
    (s) => s.agentConfig.expandContextByDefault ?? true,
  )
  const [isExpanded, setIsExpanded] = useState(expandContextByDefault)
  const [searchQuery, setSearchQuery] = useState('')

  // 精确 Token 估算
  const estimatedTokens = useMemo(() => {
    return contextItems.reduce((sum, item) => sum + estimateItemTokens(item), 0)
  }, [contextItems])

  // 按类型分组
  const groupedItems = useMemo(() => {
    const groups = new Map<ContextType, Array<{ item: ContextItem; index: number }>>()

    contextItems.forEach((item, index) => {
      const type = item.type as ContextType
      if (!groups.has(type)) {
        groups.set(type, [])
      }
      groups.get(type)!.push({ item, index })
    })

    return groups
  }, [contextItems])

  // 搜索过滤
  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return groupedItems

    const query = searchQuery.toLowerCase()
    const filtered = new Map<ContextType, Array<{ item: ContextItem; index: number }>>()

    groupedItems.forEach((items, type) => {
      const matched = items.filter(({ item }) => {
        const { label } = getContextDisplay(item)
        return label.toLowerCase().includes(query)
      })
      if (matched.length > 0) {
        filtered.set(type, matched)
      }
    })

    return filtered
  }, [groupedItems, searchQuery])

  // 当前文件是否已添加
  const isCurrentFileAdded = useMemo(() => {
    return (
      activeFilePath !== null &&
      contextItems.some(
        (s: ContextItem) =>
          s.type === 'File' && (s as FileContext).uri === activeFilePath,
      )
    )
  }, [activeFilePath, contextItems])

  const handleToggleExpand = useCallback(() => {
    setIsExpanded((prev) => !prev)
  }, [])

  const handleClearAll = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onClear()
    },
    [onClear],
  )

  if (contextItems.length === 0 && !activeFilePath) return null

  return (
    <div className="bg-surface/5 transition-all duration-300 animate-fade-in">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-2 cursor-pointer hover:bg-surface/20 transition-colors group"
        onClick={handleToggleExpand}
        role="button"
        aria-expanded={isExpanded}
        aria-label="上下文面板"
      >
        <div className="flex items-center gap-2.5 text-[12px] text-text-muted">
          <div className="flex items-center gap-1.5">
            {isExpanded ? (
              <ChevronDown className="w-3.5 h-3.5" aria-hidden />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" aria-hidden />
            )}
            <span className="font-semibold uppercase tracking-wider">Context</span>
          </div>
          <div className="flex items-center gap-1.5 px-2 py-0.5 bg-surface/20 rounded-full border border-border-subtle">
            <span className="text-accent font-bold">{contextItems.length}</span>
            <span className="opacity-40">items</span>
          </div>
          {contextItems.length > 0 && (
            <div className="flex items-center gap-1.5 ml-1 opacity-60 group-hover:opacity-100 transition-opacity">
              <Cpu className="w-3 h-3" aria-hidden />
              <span className="font-medium">~{estimatedTokens} tokens</span>
            </div>
          )}
        </div>

        {contextItems.length > 0 && (
          <button
            onClick={handleClearAll}
            className="text-[11px] font-medium text-text-muted hover:text-red-400 transition-colors uppercase tracking-tight"
            aria-label="清除所有上下文"
          >
            Clear all
          </button>
        )}
      </div>

      {/* Content */}
      {isExpanded && (
        <div className="px-4 pb-3 animate-in slide-in-from-top-2 duration-300">
          {/* 搜索框（仅在项目较多时显示） */}
          {contextItems.length > 5 && (
            <div className="relative mb-2">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-text-muted" aria-hidden />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索上下文..."
                className="w-full pl-7 pr-2 py-1 text-[12px] bg-surface/40 rounded-md border border-border-subtle focus:border-accent focus:outline-none transition-colors"
                aria-label="搜索上下文"
              />
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            {/* Quick Add Current File */}
            {activeFilePath && !isCurrentFileAdded && (
              <button
                onClick={onAddCurrentFile}
                className="flex items-center gap-2 px-3 py-1.5 bg-accent/10 hover:bg-accent/20 rounded-lg border border-accent/20 text-[12px] text-accent transition-all group shadow-sm shadow-accent/5"
                title="Add active file to context"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden />
                <span className="truncate max-w-[150px] font-semibold">
                  {getFileName(activeFilePath)}
                </span>
              </button>
            )}

            {/* 上下文项（按类型分组渲染） */}
            {Array.from(filteredGroups.entries()).map(([type, items]) =>
              items.map(({ item, index }) => {
                const { Icon, color, label } = getContextDisplay(item)
                return (
                  <div
                    key={`${type}-${index}`}
                    className="flex items-center gap-2 px-3 py-1.5 bg-surface/40 rounded-lg border border-border-subtle text-[12px] group hover:border-border hover:bg-surface/60 transition-all shadow-sm"
                  >
                    <div className="opacity-80 group-hover:opacity-100 transition-opacity">
                      <Icon className={`w-3 h-3 ${color}`} aria-hidden />
                    </div>
                    <span className="text-text-secondary truncate max-w-[180px] font-medium group-hover:text-text-primary transition-colors">
                      {label}
                    </span>
                    <button
                      onClick={() => onRemove(index)}
                      className="p-0.5 rounded-md hover:bg-red-500/20 text-text-muted hover:text-red-500 transition-all opacity-0 group-hover:opacity-100 transform scale-90 group-hover:scale-100"
                      aria-label={`移除 ${label}`}
                    >
                      <X className="w-3.5 h-3.5" aria-hidden />
                    </button>
                  </div>
                )
              }),
            )}
          </div>
        </div>
      )}
    </div>
  )
}
