/**
 * ExecutionSessionSlice — 全局执行会话管理
 *
 * 职责：
 * - 管理所有 AI 执行会话的生命周期（注册/更新/移除）
 * - 跨项目、跨组件追踪活跃的执行会话（切换项目时状态不丢失）
 * - 提供会话聚焦切换（用户可同时查看多个会话的执行情况）
 * - 全局并发控制（p-limit 信号量，默认最大并发 3）
 *
 * 设计原则：
 * - 会话状态集中在全局 store，不依赖组件生命周期
 * - 底层 Agent.send 已支持不同 threadId 并发，本 slice 仅管理 UI 层状态
 * - 向后兼容：TaskWorkspace 旧入口不使用本 slice
 */
import type { StateCreator } from 'zustand'

// ============================================
// 类型定义
// ============================================

/** 执行会话类型 */
export type ExecutionSessionKind = 'task' | 'batch'

/** 执行会话状态 */
export type ExecutionSessionStatus = 'queued' | 'running' | 'completed' | 'failed' | 'aborted'

/** 单个执行会话 */
export interface ExecutionSession {
  /** 会话唯一 ID（UUID） */
  id: string
  /** 会话类型：单任务 / 批量 */
  kind: ExecutionSessionKind
  /** 关联项目 ID */
  projectId: string
  /** 关联项目名称（UI 显示） */
  projectName: string
  /** 关联 AI 线程 ID（Agent.send 的 threadId） */
  threadId: string
  /** 关联任务 ID 列表（单任务为 1 个，批量为多个） */
  taskIds: string[]
  /** 当前执行中的任务 ID（批量模式逐个推进，单任务模式为 taskIds[0]） */
  currentTaskId: string | null

  /** 生命周期状态 */
  status: ExecutionSessionStatus
  /** 注册时间（排队时间） */
  queuedAt: number
  /** 开始执行时间 */
  startedAt: number | null
  /** 结束时间 */
  finishedAt: number | null

  /** 批量模式：任务总数 */
  batchTotal?: number
  /** 批量模式：已完成任务数 */
  batchCompleted?: number

  /** 错误信息（status=failed 时） */
  error: string | null
}

/** 创建会话的输入参数 */
export type CreateSessionInput = Omit<ExecutionSession, 'id' | 'queuedAt' | 'status' | 'startedAt' | 'finishedAt' | 'error'> & {
  /** 初始状态（默认 queued） */
  initialStatus?: ExecutionSessionStatus
  /** 开始时间（默认 null，running 时自动设置） */
  startedAt?: number | null
  /** 结束时间（默认 null，完成时自动设置） */
  finishedAt?: number | null
  /** 错误信息（默认 null） */
  error?: string | null
}

// ============================================
// 并发控制
// ============================================

/** 全局最大并发会话数 */
export const MAX_CONCURRENT_SESSIONS = 3

// ============================================
// Slice 定义
// ============================================

export interface ExecutionSessionSlice {
  /** 所有执行会话（按 id 索引） */
  executionSessions: Record<string, ExecutionSession>
  /** 会话 ID 列表（按注册时间排序） */
  executionSessionOrder: string[]
  /** 当前聚焦查看的会话 ID */
  activeSessionId: string | null

  // ─── 会话操作 ───────────────────────────────

  /** 注册新会话（返回会话 ID） */
  registerSession: (input: CreateSessionInput) => string
  /** 更新会话字段 */
  updateSession: (id: string, patch: Partial<ExecutionSession>) => void
  /** 移除会话（仅 completed/failed/aborted 可移除） */
  removeSession: (id: string) => void
  /** 清除所有已完成的会话 */
  clearFinishedSessions: () => void
  /** 清除指定项目的所有会话 */
  clearProjectSessions: (projectId: string) => void

  // ─── 聚焦操作 ───────────────────────────────

  /** 设置聚焦会话 */
  setActiveSession: (id: string | null) => void

  // ─── 查询操作 ───────────────────────────────

  /** 获取指定项目的活跃会话（running + queued） */
  selectActiveSessionsByProject: (projectId: string) => ExecutionSession[]
  /** 获取指定项目的所有会话 */
  selectSessionsByProject: (projectId: string) => ExecutionSession[]
  /** 获取全局活跃会话数 */
  selectActiveCount: () => number
  /** 获取正在运行的任务 ID 集合（指定项目） */
  selectRunningTaskIds: (projectId: string) => Set<string>
  /** 获取排队中的任务 ID 集合（指定项目） */
  selectQueuedTaskIds: (projectId: string) => Set<string>
}

// ============================================
// Slice 实现
// ============================================

export const createExecutionSessionSlice: StateCreator<
  ExecutionSessionSlice,
  [],
  [],
  ExecutionSessionSlice
> = (set, get) => ({
  executionSessions: {},
  executionSessionOrder: [],
  activeSessionId: null,

  // ─── 会话操作 ───────────────────────────────

  registerSession: (input) => {
    const id = `es-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const session: ExecutionSession = {
      ...input,
      id,
      status: input.initialStatus ?? 'queued',
      queuedAt: Date.now(),
      startedAt: input.initialStatus === 'running' ? Date.now() : null,
      finishedAt: null,
      error: null,
    }

    set((state) => ({
      executionSessions: { ...state.executionSessions, [id]: session },
      executionSessionOrder: [...state.executionSessionOrder, id],
      // 自动聚焦新会话
      activeSessionId: id,
    }))

    return id
  },

  updateSession: (id, patch) => {
    set((state) => {
      const session = state.executionSessions[id]
      if (!session) return state

      const updated: ExecutionSession = { ...session, ...patch }

      // 状态转换为 running 时设置 startedAt
      if (patch.status === 'running' && !session.startedAt) {
        updated.startedAt = Date.now()
      }

      // 状态转换为 completed/failed/aborted 时设置 finishedAt
      if (
        patch.status &&
        ['completed', 'failed', 'aborted'].includes(patch.status) &&
        !session.finishedAt
      ) {
        updated.finishedAt = Date.now()
      }

      return {
        executionSessions: { ...state.executionSessions, [id]: updated },
      }
    })
  },

  removeSession: (id) => {
    set((state) => {
      const session = state.executionSessions[id]
      // 仅允许移除已结束的会话
      if (!session || !['completed', 'failed', 'aborted'].includes(session.status)) {
        return state
      }

      const { [id]: _, ...restSessions } = state.executionSessions
      const newOrder = state.executionSessionOrder.filter((sid) => sid !== id)
      const newActiveId = state.activeSessionId === id
        ? (newOrder.length > 0 ? newOrder[newOrder.length - 1] : null)
        : state.activeSessionId

      return {
        executionSessions: restSessions,
        executionSessionOrder: newOrder,
        activeSessionId: newActiveId,
      }
    })
  },

  clearFinishedSessions: () => {
    set((state) => {
      const finishedStatuses: ExecutionSessionStatus[] = ['completed', 'failed', 'aborted']
      const newSessions: Record<string, ExecutionSession> = {}
      const newOrder: string[] = []

      for (const id of state.executionSessionOrder) {
        const session = state.executionSessions[id]
        if (session && !finishedStatuses.includes(session.status)) {
          newSessions[id] = session
          newOrder.push(id)
        }
      }

      const newActiveId = state.activeSessionId && newSessions[state.activeSessionId]
        ? state.activeSessionId
        : (newOrder.length > 0 ? newOrder[newOrder.length - 1] : null)

      return {
        executionSessions: newSessions,
        executionSessionOrder: newOrder,
        activeSessionId: newActiveId,
      }
    })
  },

  clearProjectSessions: (projectId) => {
    set((state) => {
      const newSessions: Record<string, ExecutionSession> = {}
      const newOrder: string[] = []

      for (const id of state.executionSessionOrder) {
        const session = state.executionSessions[id]
        // 保留不属于该项目的会话，或该项目中仍在运行的会话
        if (session && (session.projectId !== projectId || session.status === 'running' || session.status === 'queued')) {
          newSessions[id] = session
          newOrder.push(id)
        }
      }

      const newActiveId = state.activeSessionId && newSessions[state.activeSessionId]
        ? state.activeSessionId
        : (newOrder.length > 0 ? newOrder[newOrder.length - 1] : null)

      return {
        executionSessions: newSessions,
        executionSessionOrder: newOrder,
        activeSessionId: newActiveId,
      }
    })
  },

  // ─── 聚焦操作 ───────────────────────────────

  setActiveSession: (id) => {
    set({ activeSessionId: id })
  },

  // ─── 查询操作 ───────────────────────────────

  selectActiveSessionsByProject: (projectId) => {
    const state = get()
    const activeStatuses: ExecutionSessionStatus[] = ['running', 'queued']
    return state.executionSessionOrder
      .map((id) => state.executionSessions[id])
      .filter((s): s is ExecutionSession =>
        !!s && s.projectId === projectId && activeStatuses.includes(s.status),
      )
  },

  selectSessionsByProject: (projectId) => {
    const state = get()
    return state.executionSessionOrder
      .map((id) => state.executionSessions[id])
      .filter((s): s is ExecutionSession => !!s && s.projectId === projectId)
  },

  selectActiveCount: () => {
    const state = get()
    const activeStatuses: ExecutionSessionStatus[] = ['running', 'queued']
    return state.executionSessionOrder.filter((id) => {
      const s = state.executionSessions[id]
      return s && activeStatuses.includes(s.status)
    }).length
  },

  selectRunningTaskIds: (projectId) => {
    const state = get()
    const ids = new Set<string>()
    for (const id of state.executionSessionOrder) {
      const s = state.executionSessions[id]
      if (s && s.projectId === projectId && s.status === 'running') {
        // 单任务：加入 taskIds[0]；批量：加入 currentTaskId
        if (s.kind === 'batch' && s.currentTaskId) {
          ids.add(s.currentTaskId)
        } else {
          s.taskIds.forEach((tid) => ids.add(tid))
        }
      }
    }
    return ids
  },

  selectQueuedTaskIds: (projectId) => {
    const state = get()
    const ids = new Set<string>()
    for (const id of state.executionSessionOrder) {
      const s = state.executionSessions[id]
      if (s && s.projectId === projectId && s.status === 'queued') {
        s.taskIds.forEach((tid) => ids.add(tid))
      }
    }
    return ids
  },
})
