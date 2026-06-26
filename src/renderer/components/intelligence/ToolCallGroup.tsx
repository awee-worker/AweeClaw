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
  AlertTriangle,
  type LucideIcon,
} from 'lucide-react'
import type { ToolCall } from '@intelligence/providerTypes'
import ToolCallCard from './ToolCallCard'
import FileChangeCard from './FileChangeCard'
import { MemoryApprovalInline } from './MemoryApprovalInline'
import { needsDiffPreview } from '@configuration/toolDefinitions'
import BatchApprovalPanel from './toolCallCard/BatchApprovalPanel'

/** 工具状态分组 */
type ToolGroupStatus = 'pending' | 'awaiting' | 'success' | 'error'

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

  // 涉及文件变更的工具渲染为差异预览卡片
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

  // 记忆类工具采用紧凑的内联展示
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

  // 通用工具调用展示为标准卡片
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
 * 状态归属：
 * - pending / running → 进行中
 * - awaiting          → 待批准（等待用户确认，尚未执行）
 * - rejected          → 已拒绝（归入失败组）
 * - error             → 失败
 * - success           → 已完成
 *
 * @param tools 工具调用列表
 * @returns 分组列表（顺序：进行中 → 待批准 → 失败 → 已完成）
 */
function groupToolsByStatus(tools: ToolCall[]): ToolGroup[] {
  const groups: Record<ToolGroupStatus, ToolCall[]> = {
    pending: [],
    awaiting: [],
    success: [],
    error: [],
  }

  for (const tc of tools) {
    if (tc.status === 'pending' || tc.status === 'running') {
      groups.pending.push(tc)
    } else if (tc.status === 'awaiting') {
      // 等待用户批准的工具单独成组，不混入“已完成”
      groups.awaiting.push(tc)
    } else if (tc.status === 'success') {
      groups.success.push(tc)
    } else if (tc.status === 'error' || tc.status === 'rejected') {
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

  if (groups.awaiting.length > 0) {
    result.push({
      status: 'awaiting',
      label: '待批准',
      icon: AlertTriangle,
      color: 'text-amber-400',
      tools: groups.awaiting,
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
  /** 单个待批准工具 id（向后兼容） */
  pendingToolId?: string
  /** 所有待批准工具 id 集合（支持批量批准） */
  pendingToolIds?: string[]
  onApproveTool?: () => void
  onRejectTool?: () => void
  onOpenDiff?: (path: string, oldContent: string, newContent: string) => void
  messageId?: string
}

function ToolCallGroup({
  toolCalls,
  pendingToolId,
  pendingToolIds,
  onApproveTool,
  onRejectTool,
  onOpenDiff,
  messageId,
}: ToolCallGroupProps) {
  /**
   * 统一的待批准 id 集合
   *
   * 优先使用 pendingToolIds（数组），回退到 pendingToolId（单个）。
   * 当有多个待批准工具时，渲染批量批准面板，不再在各卡片单独显示批准按钮。
   */
  const approvalIdSet = useMemo(() => {
    const ids = new Set<string>()
    if (pendingToolIds && pendingToolIds.length > 0) {
      for (const id of pendingToolIds) ids.add(id)
    }
    if (pendingToolId) ids.add(pendingToolId)
    return ids
  }, [pendingToolIds, pendingToolId])

  // 是否使用批量批准模式（多个待批准工具）
  const useBatchApproval = approvalIdSet.size > 1

  // 批量模式下，单卡片不显示批准按钮（由批量面板统一处理）
  const cardPendingId = useBatchApproval ? undefined : pendingToolId

  const opts: ToolCallCardOptions = {
    pendingToolId: cardPendingId,
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

  /**
   * 判断分组是否包含等待用户批准的工具
   *
   * 设计原则：需要用户操作（批准/拒绝）的工具卡片必须始终可见，不可被折叠隐藏。
   */
  const groupHasApproval = useCallback(
    (group: ToolGroup) => group.tools.some((tc) => approvalIdSet.has(tc.id)),
    [approvalIdSet],
  )

  // 收集所有待批准的工具（用于批量批准面板）
  const pendingApprovalTools = useMemo(
    () => toolCalls.filter((tc) => approvalIdSet.has(tc.id)),
    [toolCalls, approvalIdSet],
  )

  return (
    <div className="my-2 space-y-2">
      {groups.map((group) => {
        const hasApproval = groupHasApproval(group)
        const isAwaitingGroup = group.status === 'awaiting'
        // 待批准组强制展开，不受折叠状态影响
        const isCollapsed = !hasApproval && collapsedGroups.has(group.status)
        const Icon = group.icon
        const isPendingGroup = group.status === 'pending'

        return (
          <div key={group.status}>
            {/* 分组标题（仅多工具时显示） */}
            {group.tools.length > 1 && (
              <button
                onClick={() => !hasApproval && toggleGroup(group.status)}
                disabled={hasApproval}
                className={`flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium transition-colors ${
                  hasApproval
                    ? 'text-text-primary cursor-default'
                    : 'text-text-muted hover:text-text-primary cursor-pointer'
                }`}
                aria-expanded={!isCollapsed}
                aria-label={`${group.label} (${group.tools.length})`}
                title={
                  hasApproval
                    ? '当前有工具等待批准，无法折叠'
                    : undefined
                }
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
                {/* 仅在非 awaiting 组显示“待批准”徽标，避免与 awaiting 组标题重复 */}
                {hasApproval && !isAwaitingGroup && (
                  <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400">
                    待批准
                  </span>
                )}
              </button>
            )}

            {/* 工具卡片列表：包含待批准工具时强制渲染；多工具分组项向右缩进 */}
            {(!isCollapsed || group.tools.length === 1 || hasApproval) && (
              <div className={`space-y-2 ${group.tools.length > 1 ? 'pl-5' : ''}`}>
                {group.tools.map((tc) => (
                  <div key={tc.id}>{renderToolCallCard(tc, opts)}</div>
                ))}
              </div>
            )}
          </div>
        )
      })}

      {/* 批量批准面板：多个工具待批准时，汇总到一个统一面板；与分组项对齐缩进 */}
      {useBatchApproval && pendingApprovalTools.length > 1 && (
        <div className="pl-5">
          <BatchApprovalPanel
            toolCalls={pendingApprovalTools}
            onApproveAll={onApproveTool || (() => {})}
            onRejectAll={onRejectTool || (() => {})}
          />
        </div>
      )}
    </div>
  )
}

export default memo(ToolCallGroup)
