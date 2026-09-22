/**
 * 助手消息内容视图
 * 将 Part 序列分组渲染：连续的工具调用合并为工具组，todo_write 渲染为任务列表，其他 Part 单独渲染
 * 分组规则（含流式预览工具的落位）见 ./assistantGrouping
 */
import React, { useMemo, useRef } from 'react'
import type { AssistantPart, ToolCall, TodoItem } from '@intelligence/providerTypes'
import { useAgentStore } from '@intelligence/state/IntelligenceStore'
import { CommitProbe } from '@intelligence/diagnostics/CommitProbe'
import { buildAssistantGroups, toolGroupKey } from './assistantGrouping'
import { reuseToolCallsIfUnchanged } from './toolCallsArrayReuse'
import ToolCallGroup from '../../ToolCallGroup'
import { TodoListPanel } from '../../TodoListPanel'
import { renderPart } from '../parts/PartRendererRegistry'
import type { PartRenderContext, AssistantGroupItem } from '../types'

interface AssistantMessageContentViewProps extends PartRenderContext {
  parts: AssistantPart[]
  /**
   * 是否隐藏 todo 列表（todo_write 工具调用的渲染）
   *
   * 用于项目执行等场景：左侧已有项目任务列表，
   * AI 的 todo 列表与项目任务列表高度重叠，重复显示会造成混淆。
   * - true：跳过 todo_list 分组的渲染（todo_write 仍会执行，只是不显示）
   * - false / undefined：正常渲染 todo 列表（默认行为）
   */
  hideTodoList?: boolean
  /**
   * 流式预览中的工具调用（尚未正式写入消息 parts）
   *
   * 工具在流式阶段先以 preview 形式出现（tool_call_start / tool_call_available），
   * 正式执行时才通过 addToolCallPart 写入 parts。预览工具并入末尾的工具组渲染，
   * 让「预览组」与「正式组」是同一个分组：工具正式化时在同组同位置更新，
   * 卡片 DOM 复用，不再闪动。若末尾不是工具组（中间隔着思考或正文），
   * 则另起一组，避免新调用被塞到已有内容之前造成顺序颠倒。
   */
  previewToolCalls?: ToolCall[]
}

/**
 * 合并任务快照与最新状态：保持快照的任务结构和顺序，
 * 但若某任务在最新状态中已完成，则同步更新为 completed。
 * 这样每个任务列表仍体现各自调用时刻的任务进度（pending/in_progress），
 * 但已完成任务不会错误地停留在 in_progress。
 */
function mergeTodoStatus(snapshot: TodoItem[], live?: TodoItem[]): TodoItem[] {
  if (!live || live.length === 0) return snapshot
  const completedContents = new Set(
    live.filter(t => t.status === 'completed').map(t => t.content.trim())
  )
  if (completedContents.size === 0) return snapshot
  return snapshot.map(t =>
    completedContents.has(t.content.trim()) ? { ...t, status: 'completed' as const } : t
  )
}

function AssistantMessageContentViewBase({ parts, hideTodoList, previewToolCalls, ...ctx }: AssistantMessageContentViewProps) {
  /** 订阅当前线程的最新任务列表，用于同步更新历史任务列表中已完成任务的状态 */
  const liveTodos = useAgentStore(s => {
    const threadId = s.currentThreadId
    return threadId ? s.threads[threadId]?.todos : undefined
  })

  /**
   * 上一轮的分组结果，用于回收工具组数组的引用。
   *
   * 渲染期写 ref 是有意为之：这里维护的就是「上一次渲染的产物」，语义与
   * useMemo 的缓存相同；且整个回收过程幂等，重复执行只会得到同一批引用。
   */
  const previousGroupsRef = useRef<AssistantGroupItem[]>([])

  /**
   * 分组：Part 序列 → 渲染单元（连续工具调用合成一组，todo_write 抽为任务列表组）。
   * 分组规则与流式预览工具的落位见 ./assistantGrouping，这里只在此基础上做一次引用回收。
   */
  const groups = useMemo(() => {
    const result = buildAssistantGroups(parts, previewToolCalls)

    // 引用回收：元素逐个相同的工具组沿用上一轮的数组，保住 ToolCallGroup 的 memo。
    // 按组内首个工具 id 对齐：分组顺序由 parts 顺序决定，同一个工具组在预览与正式
    // 两个阶段的锚点工具不会变；若按下标对齐，文本缓冲区 flush 造成的下标位移会让
    // 回收全部落空，白白重建一遍数组引用并把 ToolCallGroup 的重渲染带出来。
    const previousToolCalls = new Map<string, ToolCall[]>()
    for (const group of previousGroupsRef.current) {
      if (group.type !== 'tool_group') continue
      const anchor = group.toolCalls[0]?.id
      if (anchor) previousToolCalls.set(anchor, group.toolCalls)
    }
    for (let i = 0; i < result.length; i++) {
      const group = result[i]
      if (group.type !== 'tool_group') continue
      const anchor = group.toolCalls[0]?.id
      if (!anchor) continue
      const reused = reuseToolCallsIfUnchanged(previousToolCalls.get(anchor), group.toolCalls)
      if (reused !== group.toolCalls) {
        result[i] = { ...group, toolCalls: reused }
      }
    }

    previousGroupsRef.current = result
    return result
  }, [parts, previewToolCalls])

  return (
    <CommitProbe scope="assistant-content">
      {groups.map((group) => {
        // 任务列表：在 AI 调用 todo_write 的位置嵌入渲染
        // 合并快照与最新状态：已完成任务同步更新为 completed，避免历史列表停留在 in_progress
        // hideTodoList=true 时跳过渲染（项目执行场景：左侧已有项目任务列表）
        if (group.type === 'todo_list') {
          if (hideTodoList) return null
          const todos = mergeTodoStatus(group.todos, liveTodos)
          if (todos.length === 0) return null
          return (
            <div key={`wrap-todo-${group.index}`} className="w-full">
              <TodoListPanel todos={todos} isStreaming={!!ctx.isStreaming} embedded />
            </div>
          )
        }

        if (group.type === 'part') {
          return (
            <div key={`wrap-part-${group.index}`} className="w-full">
              {renderPart(group.part, ctx)}
            </div>
          )
        }

        // 工具调用统一走 ToolCallGroup 渲染（含单工具）：
        // 关键：单个工具调用不再走 renderPart 普通路径，避免
        // 「单工具卡片 → 多工具分组」切换时 key/组件树变化导致整组卸载重建闪动。
        // ToolCallGroup 内部对单工具不显示分组头，视觉与普通卡片一致。
        //
        // key 用 toolGroupKey（组内首个工具的 id）而非 group.startIndex：
        // 预览阶段按 parts.length 落位、正式化时文本缓冲区先 flush 再写入，下标会位移，
        // 用下标作 key 会把「预览 → 正式」判定成换了元素，整组卡片卸载重建并闪一下。
        // 详见 ./assistantGrouping 中 toolGroupKey 的说明。
        return (
          <div key={`wrap-group-${toolGroupKey(group)}`} className="w-full">
            <ToolCallGroup
              toolCalls={group.toolCalls}
              pendingToolId={ctx.pendingToolId}
              pendingToolIds={ctx.pendingToolIds}
              onApproveTool={ctx.onApproveTool}
              onRejectTool={ctx.onRejectTool}
              onOpenDiff={ctx.onOpenDiff}
              messageId={ctx.messageId}
            />
          </div>
        )
      })}
    </CommitProbe>
  )
}

export const AssistantMessageContentView = React.memo(AssistantMessageContentViewBase)
AssistantMessageContentView.displayName = 'AssistantMessageContentView'
