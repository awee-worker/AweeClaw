/**
 * useExecutionSession — 执行会话桥接 Hook
 *
 * 职责：
 * - 桥接 useTaskExecution / useThreadMessenger 与全局 executionSessionSlice
 * - 提供统一的会话启动/中止/查询接口
 * - 内部使用 p-limit 控制全局并发上限（默认 3）
 *
 * 使用方式：
 *   const { startTaskSession, startBatchSession, abortSession } = useExecutionSession()
 *   await startTaskSession(task, project, allTasks)
 *   await startBatchSession(tasks, project, allTasks)
 */
import { useCallback } from 'react'
import { useStore } from '@store'
import { useAgentActions, useThreadMessenger } from '@hooks/useAgent'
import { tasksApi, getApiErrorMessage } from '@renderer/adapters/taskProjectApi'
import type { TaskItem, TaskStatus, UpdateTaskInput } from '@renderer/components/explorer/panels/tasks/types'
import {
  buildTaskWithContextPrompt,
  buildBatchStartPrompt,
  buildBatchNextTaskPrompt,
  type ProjectContext,
} from '@renderer/components/explorer/panels/projects/projectExecutionContext'
import { MAX_CONCURRENT_SESSIONS } from '@renderer/state/slices/executionSessionSlice'
import { logger } from '@shared/toolkit/LogEngine'

// ============================================
// 并发控制（信号量）
// ============================================

let activeCount = 0
const pendingQueue: Array<() => void> = []

/**
 * 简易并发限制器（不依赖 p-limit 库，避免动态导入复杂性）
 * 限制全局最多 MAX_CONCURRENT_SESSIONS 个并发执行
 */
function concurrencyLimiter<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      activeCount++
      fn()
        .then(resolve)
        .catch(reject)
        .finally(() => {
          activeCount--
          // 从队列中取出下一个等待的任务
          const next = pendingQueue.shift()
          if (next) next()
        })
    }

    if (activeCount < MAX_CONCURRENT_SESSIONS) {
      run()
    } else {
      // 排队等待
      pendingQueue.push(run)
    }
  })
}

// ============================================
// Hook 定义
// ============================================

export interface UseExecutionSessionResult {
  /** 启动单任务执行会话 */
  startTaskSession: (task: TaskItem, project: ProjectContext, allTasks: TaskItem[]) => Promise<string | null>
  /** 启动批量执行会话 */
  startBatchSession: (tasks: TaskItem[], project: ProjectContext, allTasks: TaskItem[]) => Promise<string | null>
  /** 中止会话 */
  abortSession: (sessionId: string) => void
}

export function useExecutionSession(): UseExecutionSessionResult {
  const agentActions = useAgentActions()
  const { sendToThread, abortThread } = useThreadMessenger()

  // 从 store 获取操作方法（不订阅状态变化，避免不必要的重渲染）
  const registerSession = useStore((s) => s.registerSession)
  const updateSession = useStore((s) => s.updateSession)
  const getSessions = useStore((s) => s.executionSessions)

  /** 检查会话是否已被中止（用于批量循环中及时退出） */
  const isSessionAborted = useCallback((sessionId: string): boolean => {
    const session = useStore.getState().executionSessions[sessionId]
    return !session || session.status === 'aborted'
  }, [])

  // ─── 启动单任务执行会话 ───────────────────────

  const startTaskSession = useCallback(
    async (task: TaskItem, project: ProjectContext, allTasks: TaskItem[]): Promise<string | null> => {
      try {
        // 1. 准备线程
        const hasThread = !!task.threadId
        let threadId: string

        if (hasThread) {
          threadId = task.threadId!
          await agentActions.ensureThreadLoaded(threadId)
        } else {
          threadId = agentActions.createThread({ activate: false })
        }

        // 2. 注册会话到 store
        const sessionId = registerSession({
          kind: 'task',
          projectId: project.id,
          projectName: project.name,
          threadId,
          taskIds: [task.id],
          currentTaskId: task.id,
          initialStatus: 'queued',
        })

        // 3. 更新任务状态 + threadId（后端同步）
        try {
          const updateInput: UpdateTaskInput = {
            status: 'IN_PROGRESS' as TaskStatus,
            ...(hasThread ? {} : { threadId }),
          }
          await tasksApi.update(task.id, updateInput)
        } catch (e) {
          logger.agent.warn('[useExecutionSession] Failed to sync task to backend:', e)
        }

        // 4. 调度执行（受并发限制）
        concurrencyLimiter(async () => {
          updateSession(sessionId, { status: 'running' })

          try {
            const message = hasThread
              ? `继续执行项目「${project.name}」的任务「${task.title}」，请基于之前的上下文继续。`
              : buildTaskWithContextPrompt(task, project, allTasks, true)
            await sendToThread(message, threadId, { silent: !hasThread })
            // 执行完成后检查是否被中止（abort 可能在 sendToThread resolve 后触发）
            if (isSessionAborted(sessionId)) return
            updateSession(sessionId, { status: 'completed' })
          } catch (e) {
            // 中止导致的异常 → 标记为 aborted（不覆盖已有的 aborted 状态）
            if (isSessionAborted(sessionId)) return
            const errMsg = getApiErrorMessage(e, '任务执行失败')
            updateSession(sessionId, { status: 'failed', error: errMsg })
          }
        })

        return sessionId
      } catch (e) {
        logger.agent.error('[useExecutionSession] startTaskSession failed:', e)
        return null
      }
    },
    [agentActions, sendToThread, registerSession, updateSession],
  )

  // ─── 启动批量执行会话 ───────────────────────

  const startBatchSession = useCallback(
    async (tasks: TaskItem[], project: ProjectContext, allTasks: TaskItem[]): Promise<string | null> => {
      if (tasks.length === 0) return null

      try {
        // 1. 创建共享线程
        const threadId = agentActions.createThread({ activate: false })

        // 2. 注册会话
        const sessionId = registerSession({
          kind: 'batch',
          projectId: project.id,
          projectName: project.name,
          threadId,
          taskIds: tasks.map((t) => t.id),
          currentTaskId: tasks[0]?.id ?? null,
          initialStatus: 'queued',
          batchTotal: tasks.length,
          batchCompleted: 0,
        })

        // 3. 批量更新任务状态
        await Promise.all(
          tasks.map(async (task) => {
            try {
              await tasksApi.update(task.id, {
                status: 'IN_PROGRESS' as TaskStatus,
                threadId,
              })
            } catch (e) {
              logger.agent.warn(`[useExecutionSession] Failed to sync task ${task.id}:`, e)
            }
          }),
        )

        // 4. 调度执行（顺序执行，受并发限制）
        concurrencyLimiter(async () => {
          updateSession(sessionId, { status: 'running' })

          for (let i = 0; i < tasks.length; i++) {
            // 每次循环前检查会话是否被中止 → 立即退出
            if (isSessionAborted(sessionId)) {
              logger.agent.info(`[useExecutionSession] Batch aborted at task ${i}/${tasks.length}`)
              return
            }

            const task = tasks[i]
            updateSession(sessionId, { currentTaskId: task.id, batchCompleted: i })

            try {
              const message = i === 0
                ? buildBatchStartPrompt(project, task, tasks.length, allTasks, true)
                : buildBatchNextTaskPrompt(task, i, tasks.length, true)
              await sendToThread(message, threadId, { silent: true })
            } catch (taskErr) {
              // 中止导致的异常 → 立即退出循环（不继续执行后续任务）
              if (isSessionAborted(sessionId)) {
                logger.agent.info(`[useExecutionSession] Batch aborted during task ${i + 1}/${tasks.length}`)
                return
              }
              logger.agent.warn(`[useExecutionSession] Task ${task.id} (${i + 1}/${tasks.length}) failed:`, taskErr)
            }
          }

          // 全部完成（再次检查中止状态）
          if (isSessionAborted(sessionId)) return
          updateSession(sessionId, { status: 'completed', batchCompleted: tasks.length })
        })

        return sessionId
      } catch (e) {
        logger.agent.error('[useExecutionSession] startBatchSession failed:', e)
        return null
      }
    },
    [agentActions, sendToThread, registerSession, updateSession],
  )

  // ─── 中止会话 ───────────────────────────────

  const abortSession = useCallback(
    (sessionId: string) => {
      const session = getSessions[sessionId]
      if (!session) return

      // 先更新会话状态为 aborted（批量循环通过 isSessionAborted 检测后立即退出）
      updateSession(sessionId, { status: 'aborted', finishedAt: Date.now() })
      // 再中止 AI 线程（中断正在进行的 LLM 请求 / 工具执行）
      abortThread(session.threadId)
    },
    [getSessions, abortThread, updateSession],
  )

  return {
    startTaskSession,
    startBatchSession,
    abortSession,
  }
}
