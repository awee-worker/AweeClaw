/**
 * useTaskExecution — AI 执行任务 Hook（回调驱动，不强制切换视图）
 *
 * 职责：
 * - 将任务关联到对话线程（threadId）
 * - 注入任务上下文作为首条用户消息发给 AI
 * - 支持两种模式：新建对话执行 / 恢复已有对话（AI 接力）
 * - 支持项目上下文注入（让 AI 了解整个项目需求）
 * - 支持批量执行（一键执行全部任务，AI 按顺序依次执行）
 * - 执行后通过回调通知调用方，由调用方决定如何呈现（不强制切到聊天界面）
 *
 * 调用链：
 *   useTaskExecution.run(task)
 *     ├─ 无 threadId → createThread({activate:false}) → Agent.send(ctx, {threadId})
 *     └─ 有 threadId → ensureThreadLoaded(threadId) → Agent.send(resume, {threadId})
 *
 *   useTaskExecution.runBatch(tasks)
 *     └─ createThread({activate:false}) → Agent.send(batchPrompt, {threadId})
 *
 * 与旧版本的区别：
 * - 移除 switchToChatView（不再强制切到主聊天界面）
 * - 改为 onThreadReady 回调，调用方决定呈现方式
 * - 使用 Agent.send 的 executionOptions.threadId 定向发送，不污染 currentThreadId
 * - createThread 传 activate:false，不切换主聊天线程
 * - 新增 projectContext 选项：注入项目名称、目标、描述、全部任务列表
 * - 新增 runBatch 方法：一键批量执行，AI 在同一对话中依次完成所有任务
 *
 * 依赖：
 * - useAgentActions: createThread（不激活）/ ensureThreadLoaded（不切 currentThreadId）
 * - useThreadMessenger: sendToThread（定向发送）
 * - tasksApi: update（回写 threadId + 状态）
 * - projectExecutionContext: 构建含项目上下文的提示词
 */
import { useCallback, useState } from 'react'
import { useStore } from '@store'
import { useAgentActions, useThreadMessenger } from '@hooks/useAgent'
import { tasksApi, getApiErrorMessage } from '@renderer/adapters/taskProjectApi'
import type { TaskItem, TaskStatus, UpdateTaskInput } from './types'
import {
  buildTaskWithContextPrompt,
  buildResumeWithContextMessage,
  buildBatchStartPrompt,
  buildBatchNextTaskPrompt,
  type ProjectContext,
} from '../projects/projectExecutionContext'

/** 无项目上下文时的降级提示词（向后兼容 TaskWorkspace 旧入口） */
function buildStandaloneTaskMessage(task: TaskItem, isZh: boolean): string {
  const parts: string[] = []

  parts.push(
    isZh
      ? `请帮我执行以下任务：`
      : `Please help me execute the following task:`,
  )
  parts.push('')
  parts.push(`## ${task.title}`)

  if (task.description) {
    parts.push('')
    parts.push(task.description)
  }

  const meta: string[] = []
  if (task.priority) {
    const priorityLabel: Record<string, [string, string]> = {
      LOW: ['Low', '低'],
      MEDIUM: ['Medium', '中'],
      HIGH: ['High', '高'],
      URGENT: ['Urgent', '紧急'],
    }
    const label = priorityLabel[task.priority]
    meta.push(isZh ? `优先级：${label?.[1] ?? task.priority}` : `Priority: ${label?.[0] ?? task.priority}`)
  }
  if (task.dueAt) {
    const dueStr = new Date(task.dueAt).toLocaleString(isZh ? 'zh-CN' : 'en-US')
    meta.push(isZh ? `截止时间：${dueStr}` : `Due: ${dueStr}`)
  }
  if (task.estimatedMin != null && task.estimatedMin > 0) {
    meta.push(isZh ? `预估耗时：${task.estimatedMin}分钟` : `Estimated: ${task.estimatedMin}min`)
  }
  if (task.tags.length > 0) {
    meta.push(isZh ? `标签：${task.tags.join('、')}` : `Tags: ${task.tags.join(', ')}`)
  }

  if (meta.length > 0) {
    parts.push('')
    parts.push(meta.join(' · '))
  }

  parts.push('')
  parts.push(
    isZh
      ? '请开始执行，完成后告诉我结果。'
      : 'Please start working on this and report the result when done.',
  )

  return parts.join('\n')
}

/** 无项目上下文时的恢复消息（向后兼容） */
function buildStandaloneResumeMessage(task: TaskItem, isZh: boolean): string {
  return isZh
    ? `继续执行任务「${task.title}」，请基于之前的上下文继续。`
    : `Continue working on task "${task.title}". Please proceed based on the previous context.`
}

export interface UseTaskExecutionOptions {
  /** 任务更新后回调（回写 threadId / status 后通知调用方刷新） */
  onTaskUpdated?: (taskId: string, patch: Partial<TaskItem>) => void
  /**
   * 线程准备好后回调（已创建/已加载，已回写 threadId），由调用方决定如何呈现
   * - 项目执行 Tab：不切换视图，由内嵌视图加载该 threadId
   * - 任务面板旧入口：可在此切换到聊天面板
   */
  onThreadReady?: (task: TaskItem, threadId: string) => void
  /** 发送完成/失败后的回调 */
  onSettled?: (task: TaskItem, error: string | null) => void

  // ─── 项目上下文（可选，项目执行 Tab 传入） ──────────
  /** 项目上下文信息（名称、目标、描述等），注入到提示词让 AI 了解项目全局 */
  projectContext?: ProjectContext
  /** 全部任务列表（注入到提示词，让 AI 了解整体范围和任务间依赖） */
  allTasks?: TaskItem[]
  /**
   * 批量执行线程就绪回调
   * - 与 onThreadReady 的区别：批量执行没有单个 task，用 batchId 标识
   */
  onBatchThreadReady?: (batchId: string, threadId: string, tasks: TaskItem[]) => void
  /** 批量执行完成/失败后的回调 */
  onBatchSettled?: (batchId: string, error: string | null) => void
  /**
   * 批量执行中某个任务开始执行时回调
   * - 用于从 batchExecutingIds 移除该任务（变为"执行中"）
   */
  onBatchTaskStart?: (batchId: string, taskId: string, taskIndex: number, total: number) => void
  /**
   * 批量执行中某个任务执行完成时回调
   * - 用于更新任务状态（变为"已执行"）
   */
  onBatchTaskComplete?: (batchId: string, taskId: string, taskIndex: number, total: number) => void
}

export interface UseTaskExecutionResult {
  /** 当前正在执行的 taskId（用于 UI 显示 loading） */
  runningTaskId: string | null
  /** 执行任务（新建或恢复对话） */
  run: (task: TaskItem) => Promise<void>
  /** 当前正在批量执行的 batchId（用于 UI 显示批量执行状态） */
  runningBatchId: string | null
  /** 批量执行任务列表总数 */
  batchTotalCount: number
  /** 一键批量执行（创建一个线程，AI 按顺序依次执行所有任务） */
  runBatch: (tasks: TaskItem[]) => Promise<void>
  /** 错误信息 */
  error: string | null
  /** 清除错误 */
  clearError: () => void
}

export function useTaskExecution(
  options?: UseTaskExecutionOptions,
): UseTaskExecutionResult {
  const {
    onTaskUpdated, onThreadReady, onSettled,
    projectContext, allTasks, onBatchThreadReady, onBatchSettled,
    onBatchTaskStart, onBatchTaskComplete,
  } = options || {}
  const language = useStore(s => s.language)
  const isZh = language === 'zh'

  const agentActions = useAgentActions()
  const { sendToThread } = useThreadMessenger()

  const [runningTaskId, setRunningTaskId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [runningBatchId, setRunningBatchId] = useState<string | null>(null)
  const [batchTotalCount, setBatchTotalCount] = useState(0)

  const clearError = useCallback(() => setError(null), [])

  // ─── 单任务执行 ─────────────────────────────────────

  const run = useCallback(
    async (task: TaskItem) => {
      if (runningTaskId === task.id) return

      setRunningTaskId(task.id)
      setError(null)

      let threadId: string | null = null
      let runError: string | null = null

      try {
        const hasThread = !!task.threadId

        // 1. 准备对话线程（不切换 currentThreadId）
        if (hasThread) {
          // 恢复已有对话：加载线程到 store（不切 currentThreadId）
          threadId = task.threadId!
          await agentActions.ensureThreadLoaded(threadId)
        } else {
          // 创建新对话：不激活，不污染主聊天线程
          threadId = agentActions.createThread({ activate: false })
        }

        // 2. 回写任务 threadId + 状态（仅新对话需要回写 threadId）
        const patch: Partial<TaskItem> = { status: 'IN_PROGRESS' as TaskStatus }
        if (!hasThread && threadId) {
          patch.threadId = threadId
        }

        try {
          const updateInput: UpdateTaskInput = {
            status: patch.status,
            ...(patch.threadId !== undefined ? { threadId: patch.threadId } : {}),
          }
          const updated = await tasksApi.update(task.id, updateInput)
          onTaskUpdated?.(task.id, updated)
        } catch (e) {
          // 后端更新失败不阻塞对话，仅记录日志
          console.warn('[useTaskExecution] Failed to sync task to backend:', e)
        }

        // 3. 通知调用方线程已就绪（由调用方决定呈现方式）
        if (threadId) {
          onThreadReady?.(task, threadId)
        }

        // 4. 定向发送任务上下文消息给 AI
        //    - 新对话：静默注入（silent=true），不显示为用户消息气泡
        //    - 恢复对话：正常显示（用户可见的恢复指令）
        //    - 有项目上下文：注入项目背景 + 全部任务列表
        //    - 无项目上下文：降级为独立任务提示词（向后兼容 TaskWorkspace）
        const message = hasThread
          ? (projectContext
              ? buildResumeWithContextMessage(task, projectContext, isZh)
              : buildStandaloneResumeMessage(task, isZh))
          : (projectContext && allTasks
              ? buildTaskWithContextPrompt(task, projectContext, allTasks, isZh)
              : buildStandaloneTaskMessage(task, isZh))
        // 新对话的首条任务上下文使用静默注入（不显示为用户气泡）
        // 恢复对话的续接消息正常显示（用户可见）
        await sendToThread(message, threadId!, { silent: !hasThread })
      } catch (e) {
        runError = getApiErrorMessage(e, isZh ? '启动任务执行失败' : 'Failed to start task execution')
        setError(runError)
      } finally {
        setRunningTaskId(null)
        onSettled?.(task, runError)
      }
    },
    [runningTaskId, agentActions, sendToThread, isZh, onTaskUpdated, onThreadReady, onSettled, projectContext, allTasks],
  )

  // ─── 批量执行（一键执行，顺序逐个执行） ───────────────────
  //
  // 设计：创建一个共享线程，逐个发送任务提示词，await 等待每个任务
  //       完成后再发送下一个。严格保证 AI 按任务顺序执行。
  //
  // 执行流程：
  //   1. 创建共享线程（不激活，不污染主聊天）
  //   2. 批量更新所有任务状态为 IN_PROGRESS + 关联 threadId
  //   3. 通知调用方线程已就绪（onBatchThreadReady）
  //   4. 逐个执行任务：
  //      a. setRunningTaskId(task.id) → 左侧列表显示"执行中"
  //      b. onBatchTaskStart → 从 batchExecutingIds 移除该任务
  //      c. 发送任务提示词（静默注入）
  //      d. await sendToThread → 等待 AI 完成响应
  //      e. onBatchTaskComplete → 通知调用方该任务已完成
  //   5. 全部完成后清除状态
  //
  // 优势：
  //   - 严格按顺序执行（一次只处理一个任务）
  //   - runningTaskId 准确反映当前执行的任务
  //   - 前一任务的产出可作为后一任务的参考（同一线程）
  //   - 项目背景只在首个任务发送一次（节省 token）

  const runBatch = useCallback(
    async (tasks: TaskItem[]) => {
      if (tasks.length === 0) return
      if (runningBatchId) return // 防止重复触发

      const batchId = `batch-${Date.now()}`
      setRunningBatchId(batchId)
      setBatchTotalCount(tasks.length)
      setError(null)

      let threadId: string | null = null
      let batchError: string | null = null

      try {
        // 1. 创建共享线程（不激活，不污染主聊天）
        threadId = agentActions.createThread({ activate: false })

        // 2. 批量更新所有任务状态为 IN_PROGRESS + 关联 threadId
        //    并发更新，失败不阻塞（仅记录日志）
        await Promise.all(tasks.map(async (task) => {
          try {
            const updateInput: UpdateTaskInput = {
              status: 'IN_PROGRESS' as TaskStatus,
              threadId,
            }
            const updated = await tasksApi.update(task.id, updateInput)
            onTaskUpdated?.(task.id, updated)
          } catch (e) {
            console.warn(`[useTaskExecution] Failed to sync task ${task.id} to backend:`, e)
          }
        }))

        // 3. 通知调用方线程已就绪
        if (threadId) {
          onBatchThreadReady?.(batchId, threadId, tasks)
        }

        // 4. 逐个顺序执行任务
        for (let i = 0; i < tasks.length; i++) {
          const task = tasks[i]

          // 4a. 标记当前任务为执行中
          setRunningTaskId(task.id)

          // 4b. 通知调用方该任务开始执行（从 batchExecutingIds 移除）
          onBatchTaskStart?.(batchId, task.id, i, tasks.length)

          // 4c. 构建任务提示词
          //     - 首个任务：含完整项目背景 + 任务详情
          //     - 后续任务：仅任务详情（项目上下文已建立，节省 token）
          //     - 全部使用静默注入（不显示为用户消息气泡）
          const message = i === 0
            ? (projectContext
                ? buildBatchStartPrompt(projectContext, task, tasks.length, allTasks ?? tasks, isZh)
                : buildBatchStartPrompt(
                    { id: '', name: isZh ? '批量执行' : 'Batch Execution' },
                    task,
                    tasks.length,
                    tasks,
                    isZh,
                  ))
            : buildBatchNextTaskPrompt(task, i, tasks.length, isZh)

          // 4d. 发送任务并等待 AI 完成响应
          //     sendToThread 内部调用 Agent.send，Promise 在 AI 响应结束后 resolve
          try {
            await sendToThread(message, threadId!, { silent: true })
          } catch (taskErr) {
            // 单个任务执行失败：记录错误，继续执行下一个任务
            console.warn(`[useTaskExecution] Task ${task.id} (${i + 1}/${tasks.length}) failed:`, taskErr)
          }

          // 4e. 通知调用方该任务已完成（变为"已执行"状态）
          onBatchTaskComplete?.(batchId, task.id, i, tasks.length)
        }

        // 5. 全部完成，清除当前任务标记
        setRunningTaskId(null)
      } catch (e) {
        batchError = getApiErrorMessage(e, isZh ? '启动批量执行失败' : 'Failed to start batch execution')
        setError(batchError)
      } finally {
        setRunningBatchId(null)
        setRunningTaskId(null)
        onBatchSettled?.(batchId, batchError)
      }
    },
    [runningBatchId, agentActions, sendToThread, isZh, onTaskUpdated, onBatchThreadReady, onBatchSettled, onBatchTaskStart, onBatchTaskComplete, projectContext, allTasks],
  )

  return { runningTaskId, run, runningBatchId, batchTotalCount, runBatch, error, clearError }
}
