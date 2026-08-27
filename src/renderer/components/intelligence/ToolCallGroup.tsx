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
import { useStore } from '@store'
import { t } from '@renderer/i18n'
import { getFriendlyToolName } from '@intelligence/display/toolFriendlyName'

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

/** 各状态分组的视觉配置 */
const GROUP_VISUALS: Record<ToolGroupStatus, { label: string; icon: LucideIcon; color: string }> = {
  pending: { label: '进行中', icon: Loader2, color: 'text-accent' },
  awaiting: { label: '待批准', icon: AlertTriangle, color: 'text-status-warning' },
  error: { label: '失败', icon: XCircle, color: 'text-status-error' },
  success: { label: '已完成', icon: CheckCircle2, color: 'text-status-success' },
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
 * 分组策略（P1-D 顺序固定渲染）：
 * - 有待批准工具（事前审批场景）：按状态分组，卡片停留在待批准位置。
 * - 无待批准工具（批量执行场景）：单一组按调用原始顺序渲染，卡片位置固定，
 *   状态用卡片内图标表达 —— 工具完成时卡片不移动，彻底消除
 *   「从进行中组移到已完成组」导致的 DOM 重排抖动。
 *
 * @param tools 工具调用列表
 * @returns 分组列表（顺序：进行中 → 待批准 → 失败 → 已完成）
 */
function groupToolsByStatus(tools: ToolCall[]): ToolGroup[] {
  // 事前审批场景：保留状态分组
  if (tools.some((tc) => tc.status === 'awaiting')) {
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

    const order: ToolGroupStatus[] = ['pending', 'awaiting', 'error', 'success']
    return order
      .filter((s) => groups[s].length > 0)
      .map((s) => ({ status: s, ...GROUP_VISUALS[s], tools: groups[s] }))
  }

  // 批量执行场景：单一组按原始顺序渲染，卡片位置固定
  // 组状态取当前最高优先级状态：进行中 > 失败 > 已完成
  const hasRunning = tools.some((tc) => tc.status === 'pending' || tc.status === 'running')
  let status: ToolGroupStatus = 'success'
  if (hasRunning) {
    status = 'pending'
  } else if (tools.some((tc) => tc.status === 'error' || tc.status === 'rejected')) {
    status = 'error'
  }
  return [{ status, ...GROUP_VISUALS[status], tools }]
}

/**
 * 生成工具分组的操作摘要
 *
 * 收集分组内所有工具的友好名称（去重），最多展示 3 项，
 * 超出则以「等 N 项」收尾，让用户无需展开即可了解完成了哪些操作。
 *
 * @param tools 分组内的工具调用列表
 * @param language 当前界面语言
 * @returns 摘要文本，如 "读取文件、创建文件、执行命令" 或 "读取文件、创建文件 等 2 项"
 */
function buildGroupSummary(tools: ToolCall[], language: ReturnType<typeof useStore.getState>['language']): string {
  const seen = new Set<string>()
  const names: string[] = []
  for (const tc of tools) {
    const label = getFriendlyToolName(tc.name, language).label
    if (!seen.has(label)) {
      seen.add(label)
      names.push(label)
    }
  }
  const max = 3
  if (names.length <= max) {
    return names.join('、')
  }
  const rest = names.length - max
  return t('tool.groupSummaryMore', language as any, {
    shown: names.slice(0, max).join('、'),
    rest,
  })
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
  // 注意：选择器必须返回原始值（字符串），不能返回对象字面量。
  // 否则每次渲染都会产生新对象引用，Zustand 用 Object.is 比较会判定为变化，
  // 触发 forceStoreRerender → 重渲染 → 再次调用选择器 → 无限循环（Maximum update depth exceeded）。
  const language = useStore((state) => state.language)

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

  // P1-C 组级进度：批量执行时统计已完成/总数，显示在「进行中」组头
  const doneCount = useMemo(
    () => toolCalls.filter((tc) => tc.status === 'success').length,
    [toolCalls],
  )
  const totalCount = toolCalls.length

  // 默认展开所有分组，避免分组头闪烁和用户需要手动展开查看结果
  // 用户反馈：多个相同工具分组显示时分组头会闪烁，默认展开体验更好
  const [collapsedGroups, setCollapsedGroups] = useState<Set<ToolGroupStatus>>(
    new Set(),
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
    <div
      className="my-2 space-y-2"
      style={{ contain: 'layout style paint', willChange: 'transform' }}
    >
      {groups.map((group) => {
        const hasApproval = groupHasApproval(group)
        const isAwaitingGroup = group.status === 'awaiting'
        // 待批准组强制展开，不受折叠状态影响
        const isCollapsed = !hasApproval && collapsedGroups.has(group.status)
        const Icon = group.icon
        const isPendingGroup = group.status === 'pending'
        const showHeader = group.tools.length > 1

        return (
          <div
            // 关键：批量执行场景只有单一组，使用固定 key 而非 group.status，
            // 避免组状态变化（进行中 → 已完成）时整个分组容器卸载重建导致闪动。
            // 审批场景多组并存，按 status 分组本就是设计，保持 status key。
            key={groups.length === 1 ? 'group-main' : group.status}
            style={{ contain: 'layout style' }}
          >
            {/* 分组标题（仅多工具时显示）
                固定高度占位避免标题出现/消失时的高度跳变。
                使用 opacity 过渡让标题平滑出现/消失，而非瞬间弹出 */}
            <div
              style={{
                minHeight: showHeader ? 28 : 0,
                transition: 'min-height 0.2s ease',
              }}
            >
              {showHeader && (
                <button
                  onClick={() => !hasApproval && toggleGroup(group.status)}
                  disabled={hasApproval}
                  className={`flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium transition-colors ${
                    hasApproval
                      ? 'text-text-primary cursor-default'
                      : 'text-text-muted hover:text-text-primary cursor-pointer'
                  }`}
                  style={{ height: 28 }}
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
                    {/* P1-C 组级进度：进行中组显示已完成/总数，替代逐卡闪烁 */}
                    {isPendingGroup && totalCount > 1 && (
                      <span className="text-text-muted/70 font-normal ml-1">
                        · {doneCount}/{totalCount}
                      </span>
                    )}
                    {(group.status === 'success' || group.status === 'error') && (
                      <span className="text-text-muted/70 font-normal ml-1">
                        · {buildGroupSummary(group.tools, language)}
                      </span>
                    )}
                  </span>
                  {/* 仅在非 awaiting 组显示“待批准”徽标，避免与 awaiting 组标题重复 */}
                  {hasApproval && !isAwaitingGroup && (
                    <span className="ml-1 text-[12px] px-1.5 py-0.5 rounded bg-status-warning/15 text-status-warning">
                      待批准
                    </span>
                  )}
                </button>
              )}
            </div>

            {/* 工具卡片列表：包含待批准工具时强制渲染；多工具分组项向右缩进。
                每个卡片包裹层使用 layout containment 隔离内部 reflow，
                并添加淡入动画掩盖新增卡片时的瞬时高度跳变。 */}
            {(!isCollapsed || group.tools.length === 1 || hasApproval) && (
              <div className={`space-y-2 ${group.tools.length > 1 ? 'pl-5' : ''}`}>
                {group.tools.map((tc) => (
                  <div
                    key={tc.id}
                    style={{ contain: 'layout style' }}
                    className="tool-card-appear"
                  >
                    {renderToolCallCard(tc, opts)}
                  </div>
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
