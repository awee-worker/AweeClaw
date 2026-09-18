/**
 * 助手消息内容视图
 * 将 Part 序列分组渲染：连续的工具调用合并为工具组，todo_write 渲染为任务列表，其他 Part 单独渲染
 */
import React, { useMemo, useRef } from 'react'
import type { AssistantPart, ToolCall, TodoItem } from '@intelligence/providerTypes'
import { isToolCallPart } from '@intelligence/providerTypes'
import { useAgentStore } from '@intelligence/state/IntelligenceStore'
import { CommitProbe } from '@intelligence/diagnostics/CommitProbe'
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
   * 正式执行时才通过 addToolCallPart 写入 parts。为避免「预览组」与「正式组」
   * 两套 UI 切换导致的分组栏闪动，预览工具合并进同一个工具组渲染：
   * 工具正式化时在同组同位置更新，卡片 DOM 复用，不再闪动。
   */
  previewToolCalls?: ToolCall[]
}

/** 从 todo_write 工具调用参数中安全提取任务列表 */
function extractTodos(args: Record<string, unknown>): TodoItem[] {
  const raw = args.todos
  if (!Array.isArray(raw)) return []
  return raw.filter((t): t is TodoItem =>
    t != null &&
    typeof t.content === 'string' &&
    typeof t.status === 'string' &&
    typeof t.activeForm === 'string'
  )
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
   * 将 Part 序列分组：
   * - 连续的工具调用合并为工具组
   * - todo_write 工具调用单独提取为任务列表组，在文本流中对应位置渲染任务列表
   * - 其他 Part 单独渲染
   */
  const groups = useMemo(() => {
    const result: AssistantGroupItem[] = []
    let currentToolCalls: ToolCall[] = []
    let startIndex = -1

    const flushToolGroup = () => {
      if (currentToolCalls.length > 0) {
        result.push({ type: 'tool_group', toolCalls: currentToolCalls, startIndex })
        currentToolCalls = []
      }
    }

    parts.forEach((part, index) => {
      if (isToolCallPart(part)) {
        // todo_write 单独作为任务列表组渲染，从工具组中分离
        if (part.toolCall.name === 'todo_write') {
          flushToolGroup()
          const todos = extractTodos(part.toolCall.arguments)
          result.push({ type: 'todo_list', todos, index })
          return
        }
        // 其他工具调用合并到工具组
        if (currentToolCalls.length === 0) startIndex = index
        currentToolCalls.push(part.toolCall)
      } else {
        flushToolGroup()
        result.push({ type: 'part', part, index })
      }
    })

    flushToolGroup()

    // 流式预览工具合并进最后一个工具组：
    // 预览工具是「当前正在流式输出/即将执行」的调用，追加到最后一个工具组，
    // 使预览与正式工具在同一 ToolCallGroup 内按序渲染。工具正式化时
    // （preview 移除 + parts 添加）在同组内更新，卡片 key=tc.id 复用，不闪动。
    if (previewToolCalls && previewToolCalls.length > 0) {
      const existingIds = new Set(result.flatMap(g =>
        g.type === 'tool_group' ? g.toolCalls.map(tc => tc.id) : []
      ))
      const freshPreviews = previewToolCalls.filter(tc => !existingIds.has(tc.id))
      if (freshPreviews.length > 0) {
        // 找到最后一个工具组（倒序查找），将预览工具追加其后
        let merged = false
        for (let i = result.length - 1; i >= 0; i--) {
          const g = result[i]
          if (g.type === 'tool_group') {
            result[i] = {
              type: 'tool_group',
              toolCalls: [...g.toolCalls, ...freshPreviews],
              startIndex: g.startIndex,
            }
            merged = true
            break
          }
        }
        // 没有任何工具组（纯文本或空 parts），为预览工具新建工具组
        if (!merged) {
          result.push({ type: 'tool_group', toolCalls: freshPreviews, startIndex: parts.length })
        }
      }
    }

    // 引用回收：元素逐个相同的工具组沿用上一轮的数组，保住 ToolCallGroup 的 memo。
    // 按 startIndex 对齐即可 —— 分组顺序由 parts 顺序决定，同一起点的组必然同源。
    const previousToolCalls = new Map<number, ToolCall[]>()
    for (const group of previousGroupsRef.current) {
      if (group.type === 'tool_group') previousToolCalls.set(group.startIndex, group.toolCalls)
    }
    for (let i = 0; i < result.length; i++) {
      const group = result[i]
      if (group.type !== 'tool_group') continue
      const reused = reuseToolCallsIfUnchanged(previousToolCalls.get(group.startIndex), group.toolCalls)
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
        return (
          <div key={`wrap-group-${group.startIndex}`} className="w-full">
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
