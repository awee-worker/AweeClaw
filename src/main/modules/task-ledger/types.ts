/**
 * 任务账本 — 类型定义
 *
 * 任务在本地是一等实体：有状态机、有请求快照、有产物、有执行轨迹。
 * 会话（Session）只是查看任务的视角，任务本身不随会话销毁。
 *
 * 字段命名与后端 DeviceTask 对齐（kind/status/risk/request/result/artifacts），
 * 便于后续做端云同步时减少映射成本。
 *
 * @module task-ledger/types
 */

/** 任务状态机 */
export type TaskStatus =
  | 'pending_approval' // 高风险动作，等待人工放行
  | 'queued'           // 已就绪，等待执行
  | 'running'          // 执行中
  | 'completed'        // 成功结束
  | 'failed'           // 失败结束
  | 'cancelled'        // 人工取消

/** 终态集合（终态不可再迁移到 running） */
export const TERMINAL_STATUSES: TaskStatus[] = ['completed', 'failed', 'cancelled']

/** 风险等级（决定是否需要人工审批） */
export type TaskRisk = 'low' | 'medium' | 'high'

/** 任务来源 */
export type TaskOrigin = 'trigger' | 'cron' | 'manual' | 'proactive'

/** 执行轨迹条目（用于排查与后续 Watchdog 判断方向是否跑偏） */
export interface TaskTraceEntry {
  /** 时间戳（ms） */
  at: number
  /** 来源：system | tool | agent | user */
  actor: string
  /** 事件描述 */
  message: string
}

/** 任务产物 */
export interface TaskArtifact {
  type: 'text' | 'log' | 'file' | 'image' | 'url'
  title: string
  /** 小体积文本直接内联 */
  content?: string
  /** 大文件只存路径 */
  path?: string
  url?: string
}

/** 任务执行结果 */
export interface TaskResult {
  success: boolean
  /** 结果摘要（面向人，1-3 行） */
  summary?: string
  /** 产物列表 */
  artifacts?: TaskArtifact[]
  /** 原始输出（可能较长，按需截断） */
  output?: string
  /** 错误信息 */
  error?: string
}

/** 任务实体 */
export interface LedgerTask {
  id: string
  origin: TaskOrigin
  /** 触发它的规则 / cron 任务 id */
  originId?: string
  /** 任务类型，与后端 device_tasks.kind 对齐 */
  kind: string
  title: string
  status: TaskStatus
  risk: TaskRisk
  /** 原始请求参数快照（重试 / 审计用） */
  request: Record<string, unknown> | null
  /** 进度 0-100，null 表示未上报 */
  progress: number | null
  progressMsg: string | null
  result: TaskResult | null
  error: string | null
  createdAt: number
  updatedAt: number
  finishedAt: number | null
  /** 幂等键（历史任务可能不存在该字段） */
  idempotencyKey?: string
  /** 最近 N 条执行轨迹（容量受限） */
  trace: TaskTraceEntry[]
}

/** 创建任务的入参 */
export interface CreateTaskInput {
  origin: TaskOrigin
  originId?: string
  kind: string
  title: string
  risk?: TaskRisk
  request?: Record<string, unknown> | null
  /**
   * 幂等键（可选）
   *
   * 同一幂等键在 IDEMPOTENCY_WINDOW_MS 内若存在未结束任务，直接复用该任务而非新建。
   * 用于触发器重复投递、UI 重复点击等场景。
   */
  idempotencyKey?: string
}

/** 列表查询条件 */
export interface TaskQuery {
  status?: TaskStatus[]
  origin?: TaskOrigin
  kind?: string
  limit?: number
}

/** 账本配置 */
export const DEFAULT_LEDGER_CONFIG = Object.freeze({
  /** 最多保留的任务条数 */
  maxTasks: 500,
  /** 单任务最多保留的 trace 条数 */
  maxTracePerTask: 50,
  /** 恢复时丢弃超过该时长的非终态任务（视为进程异常退出遗留） */
  staleRunningMs: 24 * 60 * 60 * 1000,
  /** 幂等窗口：同 idempotencyKey 在该窗口内复用未结束任务 */
  idempotencyWindowMs: 5 * 60 * 1000,
})

/** 状态机允许的迁移表 */
export const ALLOWED_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  pending_approval: ['queued', 'cancelled'],
  queued: ['running', 'cancelled'],
  running: ['completed', 'failed', 'cancelled'],
  completed: [],
  failed: ['queued'],
  cancelled: ['queued'],
}
