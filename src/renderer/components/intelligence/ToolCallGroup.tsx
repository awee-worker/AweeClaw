/**
 * 工具调用组组件
 *
 * 设计理念：
 * - 分组渲染：按工具状态分组（进行中、已完成、失败）
 * - 状态统计：显示工具执行统计
 * - 折叠/展开：已完成的工具默认折叠
 * - 类型分发：统一入口渲染不同类型工具卡片
 * - 性能优化：memo 组件
 */

import { memo, useState, useMemo, useCallback } from 'react'
import type { ReactNode } from 'react'
import {
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Loader2,
  type LucideIcon,
} from 'lucide-react'
import type { ToolCall } from '@intelligence/providerTypes'
import ToolCallCard from './ToolCallCard'
import FileChangeCard from './FileChangeCard'
import { MemoryApprovalInline } from './MemoryApprovalInline'
import { needsDiffPreview } from '@configuration/toolDefinitions'

/** 工具状态分组 */
type ToolGroupStatus = 'pending' | 'success' | 'error'

/** 工具分组信息 */
interface ToolGroup {
  status: ToolGroupStatus
  label: string
  icon: LucideIcon
  color: string
  tools: ToolCall[]
}

/** 工具调用卡片渲染选项 */
export interface ToolCallCardOptions {
  pendingToolId?: string
  onApproveTool?: () => void
  onRejectTool?: () => void
  onOpenDiff?: (path: string, oldContent: string, newContent: string) => void
  messageId?: string
}

/**
 * 渲染单个工具调用卡片的统一入口
 *
 * 被 RenderPart（单个工具）和 ToolCallGroup（批量工具）共用，
 * 确保新增工具类型只需要改这一处。
 *
 * @param tc 工具调用
 * @param opts 渲染选项
 * @returns React 节点
 */
export function renderToolCallCard(
  tc: ToolCall,
  opts: ToolCallCardOptions,
): ReactNode {
  const isPending = tc.id === opts.pendingToolId

  // 需要 Diff 预览的工具使用 FileChangeCard
  if (needsDiffPreview(tc.name)) {
    return (
      <FileChangeCard
        key={tc.id}
        toolCall={tc}
        isAwaitingApproval={isPending}
        onApprove={isPending ? opts.onApproveTool : undefined}
        onReject={isPending ? opts.onRejectTool : undefined}
        onOpenInEditor={opts.onOpenDiff}
        messageId={opts.messageId}
      />
    )
  }

  // AI 记忆提议使用极简内联渲染
  if (tc.name === 'remember') {
    return (
      <MemoryApprovalInline
        key={tc.id}
        content={
          typeof tc.arguments.content === 'string' ? tc.arguments.content : ''
        }
        isAwaitingApproval={isPending}
        isSuccess={tc.status === 'success'}
        messageId={opts.messageId || ''}
        toolCallId={tc.id}
        args={tc.arguments}
      />
    )
  }

  // 以下工具由其他组件独立渲染，跳过原始工具卡片
  if (tc.name === 'ask_user' || tc.name === 'ask_form' || tc.name === 'todo_write') {
    return null
  }

  // 其他工具使用 ToolCallCard
  return (
    <ToolCallCard
      key={tc.id}
      toolCall={tc}
      isAwaitingApproval={isPending}
      onApprove={isPending ? opts.onApproveTool : undefined}
      onReject={isPending ? opts.onRejectTool : undefined}
    />
  )
}

/**
 * 获取工具状态分组
 *
 * @param tools 工具调用列表
 * @returns 分组列表
 */
function groupToolsByStatus(tools: ToolCall[]): ToolGroup[] {
  const groups: Record<ToolGroupStatus, ToolCall[]> = {
    pending: [],
    success: [],
    error: [],
  }

  for (const tc of tools) {
    if (tc.status === 'pending' || tc.status === 'running') {
      groups.pending.push(tc)
    } else if (tc.status === 'success') {
      groups.success.push(tc)
    } else if (tc.status === 'error') {
      groups.error.push(tc)
    } else {
      // 未知状态归入已完成
      groups.success.push(tc)
    }
  }

  const result: ToolGroup[] = []

  if (groups.pending.length > 0) {
    result.push({
      status: 'pending',
      label: '进行中',
      icon: Loader2,
      color: 'text-accent',
      tools: groups.pending,
    })
  }

  if (groups.error.length > 0) {
    result.push({
      status: 'error',
      label: '失败',
      icon: XCircle,
      color: 'text-red-400',
      tools: groups.error,
    })
  }

  if (groups.success.length > 0) {
    result.push({
      status: 'success',
      label: '已完成',
      icon: CheckCircle2,
      color: 'text-green-400',
      tools: groups.success,
    })
  }

  return result
}

interface ToolCallGroupProps {
  toolCalls: ToolCall[]
  pendingToolId?: string
  onApproveTool?: () => void
  onRejectTool?: () => void
  onOpenDiff?: (path: string, oldContent: string, newContent: string) => void
  messageId?: string
}

function ToolCallGroup({
  toolCalls,
  pendingToolId,
  onApproveTool,
  onRejectTool,
  onOpenDiff,
  messageId,
}: ToolCallGroupProps) {
  const opts: ToolCallCardOptions = {
    pendingToolId,
    onApproveTool,
    onRejectTool,
    onOpenDiff,
    messageId,
  }

  // 按状态分组
  const groups = useMemo(() => groupToolsByStatus(toolCalls), [toolCalls])

  // 已完成组默认折叠
  const [collapsedGroups, setCollapsedGroups] = useState<Set<ToolGroupStatus>>(
    new Set(['success']),
  )

  const toggleGroup = useCallback((status: ToolGroupStatus) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(status)) {
        next.delete(status)
      } else {
        next.add(status)
      }
      return next
    })
  }, [])

  return (
    <div className="my-2 space-y-2">
      {groups.map((group) => {
        const isCollapsed = collapsedGroups.has(group.status)
        const Icon = group.icon
        const isPendingGroup = group.status === 'pending'

        return (
          <div key={group.status}>
            {/* 分组标题（仅多工具时显示） */}
            {group.tools.length > 1 && (
              <button
                onClick={() => toggleGroup(group.status)}
                className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium text-text-muted hover:text-text-primary transition-colors"
                aria-expanded={!isCollapsed}
                aria-label={`${group.label} (${group.tools.length})`}
              >
                {isCollapsed ? (
                  <ChevronRight className="w-3 h-3" aria-hidden />
                ) : (
                  <ChevronDown className="w-3 h-3" aria-hidden />
                )}
                <Icon
                  className={`w-3 h-3 ${group.color} ${
                    isPendingGroup ? 'animate-spin' : ''
                  }`}
                  aria-hidden
                />
                <span>
                  {group.label} ({group.tools.length})
                </span>
              </button>
            )}

            {/* 工具卡片列表 */}
            {(!isCollapsed || group.tools.length === 1) && (
              <div className="space-y-2">
                {group.tools.map((tc) => (
                  <div key={tc.id}>{renderToolCallCard(tc, opts)}</div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default memo(ToolCallGroup)
