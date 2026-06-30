/**
 * 助手消息内容视图
 * 将 Part 序列分组渲染：连续的工具调用合并为工具组，todo_write 渲染为任务列表，其他 Part 单独渲染
 */
import React, { useMemo } from 'react'
import type { AssistantPart, ToolCall, TodoItem } from '@intelligence/providerTypes'
import { isToolCallPart } from '@intelligence/providerTypes'
import { useAgentStore } from '@intelligence/state/IntelligenceStore'
import ToolCallGroup from '../../ToolCallGroup'
import { TodoListPanel } from '../../TodoListPanel'
import { renderPart } from '../parts/PartRendererRegistry'
import type { PartRenderContext, AssistantGroupItem } from '../types'

interface AssistantMessageContentViewProps extends PartRenderContext {
  parts: AssistantPart[]
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

function AssistantMessageContentViewBase({ parts, ...ctx }: AssistantMessageContentViewProps) {
  /** 订阅当前线程的最新任务列表，用于同步更新历史任务列表中已完成任务的状态 */
  const liveTodos = useAgentStore(s => {
    const threadId = s.currentThreadId
    return threadId ? s.threads[threadId]?.todos : undefined
  })

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

    return result
  }, [parts])

  return (
    <>
      {groups.map((group) => {
        // 任务列表：在 AI 调用 todo_write 的位置嵌入渲染
        // 合并快照与最新状态：已完成任务同步更新为 completed，避免历史列表停留在 in_progress
        if (group.type === 'todo_list') {
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

        // 单个工具调用走普通渲染路径
        if (group.toolCalls.length === 1) {
          return (
            <div key={`wrap-tool-${group.startIndex}`} className="w-full">
              {renderPart(parts[group.startIndex], ctx)}
            </div>
          )
        }

        // 多个工具调用合并为工具组
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
    </>
  )
}

export const AssistantMessageContentView = React.memo(AssistantMessageContentViewBase)
AssistantMessageContentView.displayName = 'AssistantMessageContentView'
