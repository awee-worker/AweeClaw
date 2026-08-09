/**
 * 项目执行窗口 preload API
 *
 * 供执行窗口渲染进程调用，封装与主进程的 IPC 通信。
 * 通过 contextBridge 暴露到 window.electronAPI.projectExecution
 *
 * 消费方：
 * - 执行窗口 ProjectExecutionWindowApp：窗口控制（最小化/关闭）、状态推送
 * - 主窗口 ProjectExecutionTab：请求打开执行窗口
 * - 主窗口 ExecutionStatusDock：接收执行窗口推送的状态
 * - 悬浮球 AvatarExecutionStatus：请求恢复执行窗口
 *
 * 频道：
 * - execution-window:open                主窗口 → 主进程：请求打开执行窗口
 * - execution-window:minimize            执行窗口 → 主进程：请求最小化到悬浮球
 * - execution-window:restore             悬浮球/主窗口 → 主进程：请求恢复执行窗口
 * - execution-window:close               执行窗口 → 主进程：请求关闭窗口
 * - execution-window:get-avatar-position 执行窗口 → 主进程：获取悬浮球位置（动画方向）
 * - execution-window:get-initial-message 执行窗口 → 主进程：获取初始任务消息（一次性消费）
 * - execution-window:report-thread-id    执行窗口 → 主进程：回传创建的 threadId
 * - execution-window:thread-id-reported  主进程 → 主窗口：转发 threadId 回传
 * - execution-window:status-update       执行窗口 → 主进程：推送执行状态
 * - execution-window:status-broadcast    主进程 → 主窗口：转发执行状态
 * - execution-window:new-tab             主进程 → 执行窗口：新增 Tab
 * - execution-window:start-minimize-anim 主进程 → 执行窗口：开始最小化动画
 * - execution-window:start-restore-anim  主进程 → 执行窗口：开始恢复动画
 */

import { ipcRenderer } from 'electron'
import { invoke, on } from '../ipcHelpers'

/** 打开执行窗口的参数 */
export interface OpenExecutionWindowParams {
  projectId: string
  projectName: string
  sessionId: string
  threadId: string
  /** 初始任务消息（执行窗口打开后自动发送给 AI 的首条消息） */
  initialMessage?: string
  /** 是否静默注入（不显示为用户消息气泡，但仍发送给 LLM） */
  silent?: boolean
  /** 任务执行上下文（批量执行时用于自动推进 + 同步任务状态） */
  taskContext?: {
    /** 按执行顺序排列的任务 ID 列表 */
    taskIds: string[]
    /** 执行模式：单任务 / 批量 */
    kind: 'task' | 'batch'
  }
}

/** 悬浮球位置 */
export interface AvatarPosition {
  x: number
  y: number
}

/** 执行状态摘要（执行窗口推送到主窗口/悬浮球） */
export interface ExecutionWindowStatus {
  /** 活跃会话数 */
  activeCount: number
  /** 运行中会话数 */
  runningCount: number
  /** 排队中会话数 */
  queuedCount: number
  /** 会话详情列表 */
  sessions: Array<{
    id: string
    projectName: string
    status: 'running' | 'queued' | 'completed' | 'failed' | 'aborted'
    kind: 'task' | 'batch'
    batchTotal?: number
    batchCompleted?: number
  }>
}

/** 统一 IPC 响应格式 */
interface IpcResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

/**
 * 创建项目执行窗口 API（preload 侧工厂）
 *
 * 在 preloadBridge.ts 中以 `projectExecution: createProjectExecutionApi()` 形式聚合。
 */
export function createProjectExecutionApi() {
  return {
    // --------------------------------------------
    // 窗口控制（执行窗口 → 主进程）
    // --------------------------------------------
    /** 最小化到悬浮球 */
    minimize: () => {
      ipcRenderer.send('execution-window:minimize')
    },
    /** 关闭窗口 */
    close: () => {
      ipcRenderer.send('execution-window:close')
    },
    /** 获取悬浮球位置（供渲染层计算动画方向） */
    getAvatarPosition: invoke<IpcResponse<AvatarPosition | null>>(
      'execution-window:get-avatar-position',
    ),
    /**
     * 获取初始任务消息（一次性消费）
     * 主窗口通过 open() 传入的 initialMessage 存储在主进程内存中，
     * 执行窗口启动后通过此接口读取（避免 URL 长度限制）。
     * 读取后自动清除，不会重复发送。
     *
     * @param messageKey 消息键（threadId || sessionId，与 open() 存储时一致）
     */
    getInitialMessage: (messageKey: string) =>
      ipcRenderer.invoke('execution-window:get-initial-message', messageKey) as Promise<
        { message: string; silent: boolean; taskContext?: { taskIds: string[]; kind: 'task' | 'batch' } } | null
      >,

    /**
     * 回传 threadId 给主窗口（执行窗口调用）
     *
     * 当主窗口传空 threadId 时，执行窗口自己创建线程后，
     * 通过此接口将新创建的 threadId 报告给主窗口，
     * 主窗口用它更新任务的 threadId 字段。
     *
     * @param sessionId 执行会话 ID（主窗口 open() 时传入）
     * @param threadId 执行窗口创建的线程 ID
     */
    reportThreadId: (sessionId: string, threadId: string) => {
      ipcRenderer.send('execution-window:report-thread-id', { sessionId, threadId })
    },

    /**
     * 监听 threadId 回传事件（主窗口调用）
     *
     * 执行窗口创建线程后通过 reportThreadId 上报，
     * 主进程转发此事件，主窗口监听后更新对应任务的 threadId。
     */
    onThreadIdReported: on<{ sessionId: string; threadId: string }>(
      'execution-window:thread-id-reported',
    ),

    // --------------------------------------------
    // 状态推送（执行窗口 → 主进程 → 主窗口/悬浮球）
    // --------------------------------------------
    /** 推送执行状态摘要 */
    pushStatus: (status: ExecutionWindowStatus | null) => {
      ipcRenderer.send('execution-window:status-update', status)
    },

    // --------------------------------------------
    // 打开/恢复（主窗口/悬浮球 → 主进程）
    // --------------------------------------------
    /** 请求打开执行窗口（主窗口调用） */
    open: (params: OpenExecutionWindowParams) => {
      ipcRenderer.send('execution-window:open', params)
    },
    /** 请求恢复执行窗口（悬浮球调用） */
    restore: () => {
      ipcRenderer.send('execution-window:restore')
    },
    /** 查询执行窗口是否存在（含最小化/隐藏状态） */
    exists: (): Promise<boolean> => {
      return ipcRenderer.invoke('execution-window:exists')
    },

    // --------------------------------------------
    // 事件订阅（主进程 → 执行窗口）
    // --------------------------------------------
    /** 新增 Tab（主进程推送新项目执行请求） */
    onNewTab: on<OpenExecutionWindowParams>('execution-window:new-tab'),
    /** 开始最小化动画 */
    onStartMinimizeAnimation: on<void>('execution-window:start-minimize-animation'),
    /** 开始恢复动画 */
    onStartRestoreAnimation: on<void>('execution-window:start-restore-animation'),

    // --------------------------------------------
    // 事件订阅（主进程 → 主窗口）
    // --------------------------------------------
    /** 执行窗口状态广播（主窗口 ExecutionStatusDock 监听） */
    onStatusBroadcast: on<ExecutionWindowStatus | null>('execution-window:status-broadcast'),
  }
}
