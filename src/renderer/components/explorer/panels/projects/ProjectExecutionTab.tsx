/**
 * ProjectExecutionTab — 项目执行 Tab 容器（主窗口）
 *
 * 职责：
 * - 展示项目下所有任务（带执行按钮）
 * - 点击任务 / 一键执行 → 启动会话 → 通过 IPC 打开独立执行窗口
 * - 执行状态从全局 executionSessionStore 读取（显示执行中/排队中徽章）
 * - 不再在主窗口内嵌 AI 执行聊天界面（已移至独立执行窗口）
 *
 * 布局：
 * ┌────────────────────────────────────────────┐
 * │  头部：可执行任务 + 一键执行按钮              │
 * │  任务列表（占满全宽）                        │
 * │  ...                                       │
 * │  已完成任务（折叠区）                        │
 * └────────────────────────────────────────────┘
 *
 * 多并发支持：
 * - 可同时启动多个任务执行（不同 threadId 并发）
 * - 点击已执行的任务 → 聚焦已打开的执行窗口
 */
import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import {
  Play, Loader2, Circle, CheckCircle2, AlertCircle,
  Activity, MessageSquare, Layers, Clock, Maximize2, RotateCcw,
} from 'lucide-react'
import { tasksApi, projectsApi } from '@renderer/adapters/taskProjectApi'
import { api } from '@renderer/adapters/electronBridge'
import { localAttachmentsService } from '@renderer/adapters/localAttachmentsService'
import type { TaskItem, TaskStatus } from '../tasks/types'
import { TASK_STATUS_CONFIG, TASK_PRIORITY_CONFIG } from '../tasks/taskConstants'
import { useStore } from '@store'
import { useAgentActions } from '@hooks/useAgent'
import { logger } from '@shared/toolkit/LogEngine'
import type { ProjectContext, ProjectAttachmentRef } from './projectExecutionContext'
import {
  buildTaskWithContextPrompt,
  buildBatchStartPrompt,
} from './projectExecutionContext'

interface ProjectExecutionTabProps {
  projectId: string
  /** 项目上下文（名称、描述、目标等），注入到 AI 提示词 */
  project: ProjectContext
  tasks: TaskItem[]
  loading: boolean
  isZh: boolean
  onTasksChange: () => void
  /** 项目状态变更回调（任务执行时自动将 PLANNING → ACTIVE，触发父组件刷新项目列表） */
  onProjectChange?: () => void
  /** 从任务 Tab 传入的待执行任务 ID（触发自动执行） */
  pendingExecutionTaskId?: string | null
  /** 待执行任务已被消费（执行已启动），清除父组件状态 */
  onPendingExecutionConsumed?: () => void
}

export function ProjectExecutionTab({
  project, tasks, loading, isZh, onTasksChange, onProjectChange,
  pendingExecutionTaskId, onPendingExecutionConsumed,
}: ProjectExecutionTabProps) {
  const [error, setError] = useState<string | null>(null)

  // ─── 全局执行会话 store ───────────────────────────────
  const agentActions = useAgentActions()

  // ─── sessionId → taskIds 映射（用于执行窗口回传 threadId 后更新任务）──
  const pendingTaskSessionsRef = useRef<Map<string, string[]>>(new Map())

  // 订阅原始状态（引用稳定：仅当底层数据变化才触发重渲染）
  const executionSessions = useStore((s) => s.executionSessions)
  const executionSessionOrder = useStore((s) => s.executionSessionOrder)

  // 派生：当前项目的运行中任务 ID 集合（useMemo 保证引用稳定）
  const runningTaskIds = useMemo(() => {
    const ids = new Set<string>()
    for (const id of executionSessionOrder) {
      const s = executionSessions[id]
      if (s && s.projectId === project.id && s.status === 'running') {
        if (s.kind === 'batch' && s.currentTaskId) {
          ids.add(s.currentTaskId)
        } else {
          s.taskIds.forEach((tid) => ids.add(tid))
        }
      }
    }
    return ids
  }, [executionSessions, executionSessionOrder, project.id])

  // 派生：排队中任务 ID 集合
  const queuedTaskIds = useMemo(() => {
    const ids = new Set<string>()
    for (const id of executionSessionOrder) {
      const s = executionSessions[id]
      if (s && s.projectId === project.id && s.status === 'queued') {
        s.taskIds.forEach((tid) => ids.add(tid))
      }
    }
    return ids
  }, [executionSessions, executionSessionOrder, project.id])

  // 派生：当前项目的所有会话（用于判断任务是否已执行）
  const projectSessions = useMemo(() => {
    return executionSessionOrder
      .map((id) => executionSessions[id])
      .filter((s): s is NonNullable<typeof s> => !!s && s.projectId === project.id)
  }, [executionSessions, executionSessionOrder, project.id])

  // ─── 加载项目附件 ──────────────────────────────────────
  const [attachments, setAttachments] = useState<ProjectAttachmentRef[]>([])

  useEffect(() => {
    let cancelled = false
    localAttachmentsService.list(project.id)
      .then(items => {
        if (cancelled) return
        setAttachments(items.map(a => ({
          fileName: a.fileName,
          localPath: a.localPath,
          fileSize: a.fileSize,
          mimeType: a.mimeType,
          hasText: a.hasText,
        })))
      })
      .catch(e => {
        console.warn('[ProjectExecutionTab] Failed to load attachments:', e)
      })
    return () => { cancelled = true }
  }, [project.id])

  // 合并附件到项目上下文
  const projectContextWithAttachments = useMemo<ProjectContext>(() => ({
    ...project,
    attachments,
  }), [project, attachments])

  // ─── 项目状态自动流转：PLANNING → ACTIVE ──────────────
  const ensureProjectActive = useCallback(async () => {
    if (project.status !== 'PLANNING') return
    try {
      await projectsApi.update(project.id, { status: 'ACTIVE' })
      onProjectChange?.()
    } catch (e) {
      logger.agent.warn('[ProjectExecutionTab] Failed to activate project:', e)
    }
  }, [project.id, project.status, onProjectChange])

  // ─── 点击任务：启动新会话或聚焦已有会话 ─────────────────
  const handleTaskClick = useCallback(async (task: TaskItem) => {
    setError(null)

    // 检查该任务是否已有活跃会话 → 聚焦执行窗口
    const existingSession = projectSessions.find(
      s => s.taskIds.includes(task.id) && (s.status === 'running' || s.status === 'queued'),
    )
    if (existingSession) {
      useStore.getState().setActiveSession(existingSession.id)
      // 聚焦执行窗口（若已最小化则恢复，若已有同项目 Tab 则激活）
      api.projectExecution.open({
        projectId: project.id,
        projectName: project.name,
        sessionId: existingSession.id,
        threadId: existingSession.threadId,
      })
      return
    }

    // 已有关联对话但无活跃会话 → 聚焦执行窗口展示已有对话
    if (task.threadId) {
      const completedSession = projectSessions.find(
        s => s.threadId === task.threadId && s.status === 'completed',
      )
      if (completedSession) {
        useStore.getState().setActiveSession(completedSession.id)
        api.projectExecution.open({
          projectId: project.id,
          projectName: project.name,
          sessionId: completedSession.id,
          threadId: task.threadId,
        })
        return
      }
      // 没有 session 但有 threadId → 注册只读 session 并打开执行窗口
      const sessionId = useStore.getState().registerSession({
        kind: 'task',
        projectId: project.id,
        projectName: project.name,
        threadId: task.threadId,
        taskIds: [task.id],
        currentTaskId: task.id,
        initialStatus: 'completed',
      })
      useStore.getState().setActiveSession(sessionId)
      api.projectExecution.open({
        projectId: project.id,
        projectName: project.name,
        sessionId,
        threadId: task.threadId,
      })
      return
    }

    // 启动新执行会话（支持并发）
    // 主窗口只负责：构建任务消息 + 打开执行窗口 + 更新任务状态
    // 线程创建和 AI 执行由执行窗口自己完成（避免跨进程 store 不一致）
    // 执行窗口创建线程后会通过 IPC 回传 threadId，主窗口再用它更新任务的 threadId
    ensureProjectActive()

    // 1. 构建任务消息（由执行窗口发送）
    const initialMessage = buildTaskWithContextPrompt(task, projectContextWithAttachments, tasks, true)

    // 2. 生成临时 sessionId（执行窗口用它标识 Tab）
    const sessionId = `exec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    // 2.5 记录 sessionId → taskId 映射（执行窗口回传 threadId 后用于更新任务）
    pendingTaskSessionsRef.current.set(sessionId, [task.id])

    // 3. 更新任务状态（threadId 待执行窗口回传后更新）
    try {
      await tasksApi.update(task.id, { status: 'IN_PROGRESS' })
    } catch (e) {
      logger.agent.warn('[ProjectExecutionTab] Failed to sync task to backend:', e)
    }

    // 4. 通过 IPC 打开执行窗口，传递任务消息
    //    threadId 传空字符串，执行窗口会自己创建线程
    api.projectExecution.open({
      projectId: project.id,
      projectName: project.name,
      sessionId,
      threadId: '', // 执行窗口自己创建
      initialMessage,
      silent: true,
      taskContext: {
        taskIds: [task.id],
        kind: 'task',
      },
    })

    // 5. 刷新任务列表
    onTasksChange()
  }, [projectSessions, agentActions, projectContextWithAttachments, tasks, project.id, project.name, ensureProjectActive, onTasksChange])

  // ─── 一键批量执行 ─────────────────────────────────────
  // overrideTasks 用于"重新执行"场景：传入重置后的任务列表，避免闭包中旧 tasks 的问题
  const handleBatchExecute = useCallback(async (overrideTasks?: TaskItem[]) => {
    setError(null)

    // 使用传入的任务列表，或从 store 读取（默认场景）
    const sourceTasks = overrideTasks ?? tasks
    const tasksToExecute = sourceTasks.filter(t =>
      t.status === 'TODO' || t.status === 'IN_PROGRESS' || t.status === 'BLOCKED',
    )

    if (tasksToExecute.length === 0) {
      setError(isZh ? '没有可执行的任务' : 'No tasks to execute')
      return
    }

    // 同时将项目状态从 PLANNING 自动流转为 ACTIVE
    ensureProjectActive()

    // 1. 生成临时 sessionId
    const sessionId = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    // 1.5 记录 sessionId → taskIds 映射（执行窗口回传 threadId 后用于更新所有任务）
    pendingTaskSessionsRef.current.set(
      sessionId,
      tasksToExecute.map((t) => t.id),
    )

    // 2. 只标记第一个任务为 IN_PROGRESS（后续任务由执行窗口推进时再标记）
    //    避免所有任务同时显示"进行中"——只有真正在执行的任务才应是 IN_PROGRESS
    if (tasksToExecute[0]) {
      try {
        await tasksApi.update(tasksToExecute[0].id, { status: 'IN_PROGRESS' })
      } catch (e) {
        logger.agent.warn(`[ProjectExecutionTab] Failed to sync first task:`, e)
      }
    }

    // 3. 构建批量执行的首条消息（由执行窗口发送）
    const initialMessage = buildBatchStartPrompt(
      projectContextWithAttachments,
      tasksToExecute[0],
      tasksToExecute.length,
      sourceTasks,
      true,
    )

    // 4. 通过 IPC 打开执行窗口
    api.projectExecution.open({
      projectId: project.id,
      projectName: project.name,
      sessionId,
      threadId: '', // 执行窗口自己创建
      initialMessage,
      silent: true,
      taskContext: {
        taskIds: tasksToExecute.map((t) => t.id),
        kind: 'batch',
      },
    })

    // 5. 刷新任务列表
    onTasksChange()
  }, [tasks, agentActions, projectContextWithAttachments, isZh, ensureProjectActive, project.id, project.name, onTasksChange])

  // ─── 重新执行全部任务 ─────────────────────────────────
  // 将所有已完成/已取消的任务重置为 TODO，然后直接触发批量执行
  // ⚠️ 不依赖 onTasksChange 异步刷新，而是在本地构建重置后的任务列表传给 handleBatchExecute
  //    避免闭包中旧 tasks（仍为 DONE/CANCELED）导致"没有可执行的任务"错误
  const handleReExecuteAll = useCallback(async () => {
    setError(null)

    const tasksToReset = tasks.filter(t => t.status === 'DONE' || t.status === 'CANCELED')
    if (tasksToReset.length === 0) {
      setError(isZh ? '没有可重新执行的任务' : 'No tasks to re-execute')
      return
    }

    // 1. 批量重置任务状态为 TODO，清除 threadId（新执行会分配新线程）
    await Promise.all(
      tasksToReset.map(async (t) => {
        try {
          await tasksApi.update(t.id, { status: 'TODO', threadId: null })
        } catch (e) {
          logger.agent.warn(`[ProjectExecutionTab] Failed to reset task ${t.id}:`, e)
        }
      }),
    )

    // 2. 在本地构建重置后的任务列表（不依赖异步 onTasksChange 刷新）
    //    将 DONE/CANCELED 任务重置为 TODO + 清除 threadId
    const resetTasks: TaskItem[] = tasks.map(t =>
      tasksToReset.some(r => r.id === t.id)
        ? { ...t, status: 'TODO' as TaskStatus, threadId: null }
        : t,
    )

    // 3. 直接调用 handleBatchExecute 传入重置后的任务列表
    //    避免 setTimeout + 闭包旧 tasks 的问题
    await handleBatchExecute(resetTasks)

    // 4. 刷新任务列表（UI 同步）
    onTasksChange()
  }, [tasks, isZh, onTasksChange, handleBatchExecute])

  // ─── 重新执行单个任务 ─────────────────────────────────
  // 重置单个任务状态为 TODO，清除 threadId，然后启动新执行
  const handleReExecuteTask = useCallback(async (task: TaskItem) => {
    setError(null)

    // 1. 重置任务状态为 TODO，清除 threadId
    try {
      await tasksApi.update(task.id, { status: 'TODO', threadId: null })
    } catch (e) {
      logger.agent.warn(`[ProjectExecutionTab] Failed to reset task ${task.id}:`, e)
      setError(isZh ? '重置任务失败' : 'Failed to reset task')
      return
    }

    // 2. 刷新任务列表
    onTasksChange()

    // 3. 获取更新后的任务并启动执行
    //    使用 setTimeout 确保 onTasksChange 完成后再读取最新任务列表
    setTimeout(() => {
      try {
        // 直接用原始 task 数据构建执行（状态已被后端更新）
        const resetTask: TaskItem = { ...task, status: 'TODO', threadId: null }
        handleTaskClick(resetTask)
      } catch (e) {
        logger.agent.error('[ProjectExecutionTab] Failed to start re-execution:', e)
      }
    }, 0)
  }, [isZh, onTasksChange, handleTaskClick])

  // ─── 窗口聚焦时刷新任务（执行窗口可能更新了任务状态）──────
  useEffect(() => {
    const handleFocus = () => onTasksChange()
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [onTasksChange])

  // ─── 监听执行窗口回传的 threadId，更新对应任务的 threadId ──
  // 执行窗口自己创建线程后通过 IPC 上报 (sessionId, threadId)，
  // 主窗口根据 pendingTaskSessionsRef 中的映射找到关联的 taskIds，
  // 批量更新它们的 threadId 字段，建立 task ↔ thread 关联。
  useEffect(() => {
    const unsub = api.projectExecution.onThreadIdReported(async ({ sessionId, threadId }) => {
      const taskIds = pendingTaskSessionsRef.current.get(sessionId)
      if (!taskIds || taskIds.length === 0) {
        logger.agent.warn('[ProjectExecutionTab] No tasks mapped to session:', sessionId)
        return
      }
      // 更新所有关联任务的 threadId
      await Promise.all(
        taskIds.map(async (taskId) => {
          try {
            await tasksApi.update(taskId, { threadId })
          } catch (e) {
            logger.agent.warn(`[ProjectExecutionTab] Failed to update task ${taskId} threadId:`, e)
          }
        }),
      )
      // 清理映射
      pendingTaskSessionsRef.current.delete(sessionId)
      // 刷新任务列表
      onTasksChange()
      logger.system.info(
        `[ProjectExecutionTab] Updated ${taskIds.length} task(s) threadId=${threadId} for session=${sessionId}`,
      )
    })
    return unsub
  }, [onTasksChange])

  // ─── 处理从任务 Tab 传入的待执行任务 ───────────────────
  const handleTaskClickRef = useRef(handleTaskClick)
  handleTaskClickRef.current = handleTaskClick

  useEffect(() => {
    if (!pendingExecutionTaskId) return
    if (loading) return

    const task = tasks.find(t => t.id === pendingExecutionTaskId)
    if (!task) {
      onPendingExecutionConsumed?.()
      return
    }

    void handleTaskClickRef.current(task)
    onPendingExecutionConsumed?.()
  }, [pendingExecutionTaskId, tasks, loading, onPendingExecutionConsumed])

  // ─── 任务分组 ─────────────────────────────────────────
  const { activeTasks, doneTasks } = useMemo(() => {
    const active = tasks.filter(t =>
      t.status === 'TODO' || t.status === 'IN_PROGRESS' || t.status === 'BLOCKED',
    )
    const done = tasks.filter(t => t.status === 'DONE' || t.status === 'CANCELED')
    return { activeTasks: active, doneTasks: done }
  }, [tasks])

  // 是否有活跃批量执行
  const hasActiveBatch = projectSessions.some(
    s => s.kind === 'batch' && (s.status === 'running' || s.status === 'queued'),
  )

  // 是否有任意活跃执行（用于显示「聚焦执行窗口」按钮）
  const hasAnyActiveSession = projectSessions.some(
    s => s.status === 'running' || s.status === 'queued',
  )

  // ─── 聚焦执行窗口 ─────────────────────────────────────
  const handleFocusExecutionWindow = useCallback(() => {
    const activeSession = projectSessions.find(
      s => s.status === 'running' || s.status === 'queued',
    )
    if (activeSession) {
      api.projectExecution.open({
        projectId: project.id,
        projectName: project.name,
        sessionId: activeSession.id,
        threadId: activeSession.threadId,
      })
    } else {
      // 无活跃会话，直接 restore（若窗口存在）
      api.projectExecution.restore()
    }
  }, [projectSessions, project.id, project.name])

  // ─── 渲染 ───────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* 头部：标题 + 一键执行 + 聚焦窗口按钮 */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-border/30 bg-surface/10">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-accent" />
            <span className="text-[14px] font-semibold text-text-primary">
              {isZh ? '项目执行' : 'Project Execution'}
            </span>
            <span className="text-[12px] text-text-muted">
              {activeTasks.length} {isZh ? '个可执行任务' : 'executable'}
            </span>
          </div>

          {/* 聚焦执行窗口按钮（有活跃会话时显示） */}
          {hasAnyActiveSession && (
            <button
              onClick={handleFocusExecutionWindow}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent/10 text-accent text-[12px] font-medium hover:bg-accent/20 transition-colors"
              title={isZh ? '聚焦执行窗口' : 'Focus execution window'}
            >
              <Maximize2 className="w-3.5 h-3.5" />
              {isZh ? '执行窗口' : 'Execution Window'}
            </button>
          )}
        </div>

        {/* 一键执行按钮 / 重新执行全部按钮 */}
        {activeTasks.length > 0 ? (
          <button
            onClick={() => handleBatchExecute()}
            disabled={hasActiveBatch}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-accent text-white text-[13px] font-medium hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {hasActiveBatch ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {isZh ? '批量执行中...' : 'Running...'}
              </>
            ) : (
              <>
                <Layers className="w-4 h-4" />
                {isZh ? `一键执行全部任务 (${activeTasks.length})` : `Run All Tasks (${activeTasks.length})`}
              </>
            )}
          </button>
        ) : doneTasks.length > 0 && !hasActiveBatch ? (
          // 所有任务都已完成/取消时，显示"重新执行全部"按钮
          <button
            onClick={handleReExecuteAll}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-surface-hover/60 text-text-primary text-[13px] font-medium hover:bg-surface-hover transition-colors border border-border/30"
          >
            <RotateCcw className="w-4 h-4" />
            {isZh ? `重新执行全部任务 (${doneTasks.length})` : `Re-run All Tasks (${doneTasks.length})`}
          </button>
        ) : null}
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="mx-4 mt-3 px-3 py-2 rounded-md bg-red-500/10 border border-red-500/30 flex items-start gap-2">
          <AlertCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" />
          <span className="text-[12px] text-red-500 flex-1 leading-snug">{error}</span>
          <button
            onClick={() => setError(null)}
            className="text-[12px] text-red-500/70 hover:text-red-500"
          >✕</button>
        </div>
      )}

      {/* 任务列表（占满全宽） */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-3">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 text-accent animate-spin" />
          </div>
        ) : activeTasks.length === 0 && doneTasks.length === 0 ? (
          <ProjectExecutionEmptyState
            isZh={isZh}
            taskCount={activeTasks.length}
            projectName={project.name}
          />
        ) : (
          <>
            {/* 可执行任务 */}
            {activeTasks.length > 0 && (
              <div className="mb-2 px-1 text-[12px] font-medium text-text-muted/70 uppercase tracking-wider">
                {isZh ? `待执行 (${activeTasks.length})` : `Active (${activeTasks.length})`}
              </div>
            )}
            <div className="grid grid-cols-1 gap-2">
              {activeTasks.map(task => {
                const executing = runningTaskIds.has(task.id)
                const queued = queuedTaskIds.has(task.id)
                const hasSession = projectSessions.some(
                  s => s.taskIds.includes(task.id) &&
                  (s.status === 'running' || s.status === 'queued' || s.status === 'completed'),
                )
                return (
                  <ExecutionTaskItem
                    key={task.id}
                    task={task}
                    isZh={isZh}
                    isActive={false}
                    isExecuting={executing}
                    isQueued={queued}
                    hasSession={hasSession}
                    onClick={() => handleTaskClick(task)}
                  />
                )
              })}
            </div>

            {/* 已完成任务（折叠区） */}
            {doneTasks.length > 0 && (
              <>
                <div className="mt-4 mb-2 px-1 text-[12px] font-medium text-text-muted/70 uppercase tracking-wider">
                  {isZh ? `已完成 (${doneTasks.length})` : `Done (${doneTasks.length})`}
                </div>
                <div className="grid grid-cols-1 gap-2 opacity-70">
                  {doneTasks.map(task => (
                    <ExecutionTaskItem
                      key={task.id}
                      task={task}
                      isZh={isZh}
                      isActive={false}
                      isExecuting={false}
                      isQueued={false}
                      hasSession={false}
                      onClick={() => handleTaskClick(task)}
                      onReExecute={() => handleReExecuteTask(task)}
                    />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ─── 任务列表项 ─────────────────────────────────────────

interface ExecutionTaskItemProps {
  task: TaskItem
  isZh: boolean
  /** 当前是否选中（右侧正在展示该任务的执行视图） */
  isActive: boolean
  /** 当前是否正在执行 */
  isExecuting: boolean
  /** 是否在排队等待执行 */
  isQueued: boolean
  /** 是否已有执行会话（用于显示"已执行"状态） */
  hasSession: boolean
  onClick: () => void
  /** 重新执行回调（已完成/已取消任务显示此按钮） */
  onReExecute?: () => void
}

function ExecutionTaskItem({
  task, isZh, isActive, isExecuting, isQueued, hasSession, onClick, onReExecute,
}: ExecutionTaskItemProps) {
  const statusConfig = TASK_STATUS_CONFIG[task.status]
  const priorityConfig = TASK_PRIORITY_CONFIG[task.priority]
  const isDone = task.status === 'DONE'
  const isCanceled = task.status === 'CANCELED'
  const hasThread = !!task.threadId
  const isExecuted = (hasSession || hasThread) && !isDone && !isCanceled && !isExecuting && !isQueued

  return (
    <div
      onClick={isExecuting ? undefined : onClick}
      className={`group p-3 rounded-lg cursor-pointer transition-all border ${
        isActive
          ? 'border-accent/40 bg-accent/5'
          : isExecuting
            ? 'border-accent/30 bg-accent/5'
            : isQueued
              ? 'border-border/30 bg-surface/20'
              : 'border-transparent hover:bg-surface-hover/40 hover:border-border/20'
      } ${isExecuting ? 'cursor-wait' : ''}`}
    >
      <div className="flex items-start gap-2.5">
        {/* 状态图标 */}
        <div className="flex-shrink-0 mt-0.5">
          {isExecuting ? (
            <Loader2 className="w-4 h-4 text-accent animate-spin" />
          ) : isQueued ? (
            <Clock className="w-4 h-4 text-text-muted" />
          ) : isDone ? (
            <CheckCircle2 className="w-4 h-4 text-green-500" />
          ) : isCanceled ? (
            <Circle className="w-4 h-4 text-text-muted" />
          ) : task.status === 'BLOCKED' ? (
            <AlertCircle className="w-4 h-4 text-red-500" />
          ) : isExecuted ? (
            <Circle className={`w-4 h-4 ${statusConfig.dotColor.replace('bg-', 'text-')} fill-current`} />
          ) : (
            <Circle className={`w-4 h-4 ${statusConfig.dotColor.replace('bg-', 'text-')}`} />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className={`text-[13px] truncate ${
            isDone ? 'line-through text-text-muted' : isCanceled ? 'text-text-muted' : 'text-text-primary'
          }`}>
            {task.title}
          </div>
          {task.description && (
            <p className="text-[12px] text-text-muted mt-1 line-clamp-2">{task.description}</p>
          )}
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {/* 优先级 */}
            <span className={`flex items-center gap-1 text-[12px] ${priorityConfig.color}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${priorityConfig.dotColor}`} />
              {isZh ? priorityConfig.labelZh : priorityConfig.label}
            </span>

            {/* 执行中徽章 */}
            {isExecuting && (
              <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-accent/15 text-accent text-[12px] font-medium">
                <Loader2 className="w-2.5 h-2.5 animate-spin" />
                {isZh ? '执行中' : 'Running'}
              </span>
            )}

            {/* 排队中徽章 */}
            {isQueued && (
              <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-surface-hover/60 text-text-muted text-[12px]">
                <Clock className="w-2.5 h-2.5" />
                {isZh ? '排队中' : 'Queued'}
              </span>
            )}

            {/* 已执行徽章 */}
            {isExecuted && (
              <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-surface-hover/60 text-text-muted text-[12px]" title={isZh ? '已执行过，点击查看' : 'Executed, click to view'}>
                <MessageSquare className="w-2.5 h-2.5" />
                {isZh ? '已执行' : 'Executed'}
              </span>
            )}
          </div>
        </div>

        {/* 右侧操作按钮 */}
        {!isExecuting && !isQueued && !isDone && !isCanceled && (
          <div className={`flex-shrink-0 p-1.5 rounded transition-opacity ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
            {hasThread || hasSession ? (
              <Maximize2 className="w-4 h-4 text-text-muted" />
            ) : (
              <Play className="w-4 h-4 text-accent" />
            )}
          </div>
        )}
        {/* 已完成/已取消任务的"重新执行"按钮 */}
        {(isDone || isCanceled) && onReExecute && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onReExecute()
            }}
            title={isZh ? '重新执行' : 'Re-execute'}
            className="flex-shrink-0 p-1.5 rounded hover:bg-accent/10 text-text-muted hover:text-accent transition-colors opacity-0 group-hover:opacity-100"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  )
}

// ─── 空状态 ─────────────────────────────────────────────

function ProjectExecutionEmptyState({
  isZh, taskCount, projectName,
}: {
  isZh: boolean
  taskCount: number
  projectName: string
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-text-muted py-16">
      <Activity className="w-14 h-14 mb-4 opacity-15" />
      <p className="text-[14px] font-medium text-text-primary/70">
        {isZh ? projectName : projectName}
      </p>
      <p className="text-[13px] mt-1">
        {taskCount > 0
          ? (isZh ? '点击任务或一键执行，将在独立窗口中打开执行界面' : 'Click a task or Run All to open execution window')
          : (isZh ? '暂无可执行的任务' : 'No executable tasks')}
      </p>
      {taskCount === 0 && (
        <p className="text-[12px] mt-1 text-text-muted/60">
          {isZh ? '在「任务」Tab 中添加任务' : 'Add tasks in the Tasks tab'}
        </p>
      )}
    </div>
  )
}
