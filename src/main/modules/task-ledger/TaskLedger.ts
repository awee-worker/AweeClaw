/**
 * 任务账本
 *
 * 让"任务"成为本地一等实体：状态机可校验、进度可追溯、产物可存档、进程重启可恢复。
 * 会话只是查看任务的视角，任务不随会话销毁。
 *
 * 设计约束：
 * - 所有状态迁移必须显式合法（非法迁移抛错，不做静默纠正），避免出现"看起来完成其实没跑"的记录
 * - 写穿 ModuleDataStore（自带 2s 防抖），单次写入成本可控
 * - 容量受限：超出上限优先淘汰最旧的终态任务，运行中任务永不淘汰
 * - 进程异常退出遗留的非终态任务，在初始化时标记为失败，不伪装成"还在跑"
 *
 * @module task-ledger/TaskLedger
 */

import { EventEmitter } from 'events'
import { logger } from '@shared/toolkit/LogEngine'
import { moduleDataStore, STORE_KEYS } from '../persistence/ModuleDataStore'
import {
  ALLOWED_TRANSITIONS,
  DEFAULT_LEDGER_CONFIG,
  TERMINAL_STATUSES,
  type CreateTaskInput,
  type LedgerTask,
  type TaskArtifact,
  type TaskOrigin,
  type TaskQuery,
  type TaskResult,
  type TaskStatus,
  type TaskTraceEntry,
} from './types'

const LOG_PREFIX = '[TaskLedger]'

/** 持久化结构 */
interface PersistedLedger {
  version: number
  tasks: LedgerTask[]
}

const LEDGER_SCHEMA_VERSION = 1

function now(): number {
  return Date.now()
}

function generateTaskId(): string {
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export class TaskLedger extends EventEmitter {
  private readonly tasks = new Map<string, LedgerTask>()
  private initialized = false

  // ============================================================
  // 生命周期
  // ============================================================

  /** 从存储恢复任务，并清理遗留的非终态任务 */
  initialize(): void {
    if (this.initialized) return
    this.initialized = true

    try {
      const persisted = moduleDataStore.get<PersistedLedger>(STORE_KEYS.TASK_LEDGER)
      if (persisted && Array.isArray(persisted.tasks)) {
        for (const task of persisted.tasks) {
          if (!task || !task.id) continue
          this.tasks.set(task.id, { ...task, trace: task.trace ?? [] })
        }
      }
      this.recoverStaleTasks()
      this.enforceCapacity()
      logger.system.info(`${LOG_PREFIX} 已恢复 ${this.tasks.size} 条任务`)
    } catch (err) {
      logger.system.warn(
        `${LOG_PREFIX} 任务恢复失败: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  // ============================================================
  // 创建
  // ============================================================

  /**
   * 创建任务
   *
   * risk=high 时进入 pending_approval，必须先 approve 才能执行；
   * 其余风险直接进入 queued。
   */
  create(input: CreateTaskInput): LedgerTask {
    const ts = now()
    const risk = input.risk ?? 'low'
    const status: TaskStatus = risk === 'high' ? 'pending_approval' : 'queued'

    const task: LedgerTask = {
      id: generateTaskId(),
      origin: input.origin,
      originId: input.originId,
      kind: input.kind,
      title: input.title.slice(0, 200),
      status,
      risk,
      request: input.request ?? null,
      progress: null,
      progressMsg: null,
      result: null,
      error: null,
      createdAt: ts,
      updatedAt: ts,
      finishedAt: null,
      idempotencyKey: input.idempotencyKey,
      trace: [{ at: ts, actor: 'system', message: `任务创建（${status}）` }],
    }

    this.tasks.set(task.id, task)
    this.enforceCapacity()
    this.persist()

    logger.system.info(`${LOG_PREFIX} 任务已创建: ${task.title} (${task.id}, ${status})`)
    this.emit('created', task)
    return task
  }

  /**
   * 幂等创建
   *
   * 未提供 idempotencyKey 时等价于 create。
   * 提供时，若同一 key 在幂等窗口内已有未结束任务，直接复用，避免重复投递产生多条任务。
   */
  createIdempotent(input: CreateTaskInput): { idempotent: boolean; task: LedgerTask } {
    const key = input.idempotencyKey
    if (!key) {
      return { idempotent: false, task: this.create(input) }
    }

    const windowStart = now() - DEFAULT_LEDGER_CONFIG.idempotencyWindowMs
    for (const task of this.tasks.values()) {
      if (task.idempotencyKey !== key) continue
      if (TERMINAL_STATUSES.includes(task.status)) continue
      if (task.createdAt < windowStart) continue
      logger.system.debug(`${LOG_PREFIX} 幂等命中，复用任务: ${task.id} (key=${key})`)
      return { idempotent: true, task }
    }

    return { idempotent: false, task: this.create(input) }
  }

  // ============================================================
  // 状态迁移
  // ============================================================

  /** pending_approval → queued */
  approve(id: string): LedgerTask {
    return this.transition(id, 'queued', 'user', '人工放行')
  }

  /** queued → running */
  start(id: string): LedgerTask {
    return this.transition(id, 'running', 'system', '开始执行')
  }

  /** running → completed，并写入结果 */
  succeed(id: string, result: TaskResult): LedgerTask {
    return this.transition(id, 'completed', 'system', '执行完成', (task) => {
      task.result = result
      task.progress = 100
      if (result.artifacts && result.artifacts.length > 0) {
        this.pushTrace(task, 'system', `产出 ${result.artifacts.length} 项产物`)
      }
    })
  }

  /** running → failed */
  fail(id: string, error: string): LedgerTask {
    return this.transition(id, 'failed', 'system', `执行失败: ${error.slice(0, 200)}`, (task) => {
      task.error = error
      task.result = { success: false, error }
    })
  }

  /** 任意可取消状态 → cancelled */
  cancel(id: string): LedgerTask {
    return this.transition(id, 'cancelled', 'user', '人工取消')
  }

  /** failed / cancelled → queued，重试前清空上次结果 */
  retry(id: string): LedgerTask {
    return this.transition(id, 'queued', 'user', '重试', (task) => {
      task.error = null
      task.result = null
      task.progress = null
      task.progressMsg = null
      // 回到非终态，finishedAt 必须清空，否则看板会把重试中的任务算作已结束
      task.finishedAt = null
    })
  }

  /** 上报进度 */
  updateProgress(id: string, progress: number, message?: string): LedgerTask | null {
    const task = this.tasks.get(id)
    if (!task) return null
    if (TERMINAL_STATUSES.includes(task.status)) {
      logger.system.warn(`${LOG_PREFIX} 任务已结束，忽略进度更新: ${id}`)
      return null
    }
    task.progress = Math.max(0, Math.min(100, Math.round(progress)))
    if (message !== undefined) task.progressMsg = message
    this.touch(task)
    return task
  }

  /** 追加执行轨迹 */
  addTrace(id: string, actor: string, message: string): LedgerTask | null {
    const task = this.tasks.get(id)
    if (!task) return null
    this.pushTrace(task, actor, message)
    this.touch(task)
    return task
  }

  /** 追加产物 */
  attachArtifact(id: string, artifact: TaskArtifact): LedgerTask | null {
    const task = this.tasks.get(id)
    if (!task) return null
    if (!task.result) {
      task.result = { success: false, artifacts: [] }
    }
    task.result.artifacts = [...(task.result.artifacts ?? []), artifact]
    this.pushTrace(task, 'system', `新增产物: ${artifact.title}`)
    this.touch(task)
    return task
  }

  // ============================================================
  // 查询
  // ============================================================

  get(id: string): LedgerTask | undefined {
    return this.tasks.get(id)
  }

  list(query: TaskQuery = {}): LedgerTask[] {
    const limit = query.limit && query.limit > 0 ? query.limit : 50
    const filters = query.status && query.status.length > 0 ? new Set(query.status) : null

    const matched: LedgerTask[] = []
    for (const task of this.tasks.values()) {
      if (filters && !filters.has(task.status)) continue
      if (query.origin && task.origin !== query.origin) continue
      if (query.kind && task.kind !== query.kind) continue
      matched.push(task)
    }

    matched.sort((a, b) => {
      if (b.createdAt !== a.createdAt) return b.createdAt - a.createdAt
      if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt
      // 同一毫秒创建时用 id 兜底，保证排序确定，避免看板顺序抖动
      return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
    })
    return matched.slice(0, limit)
  }

  /** 按来源统计（用于看板） */
  countByStatus(): Record<TaskStatus, number> {
    const counts: Record<TaskStatus, number> = {
      pending_approval: 0,
      queued: 0,
      running: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    }
    for (const task of this.tasks.values()) {
      counts[task.status]++
    }
    return counts
  }

  /** 按来源过滤（供触发器订阅者判断是否重复建任务） */
  findByOriginId(originId: string, origin?: TaskOrigin): LedgerTask[] {
    const result: LedgerTask[] = []
    for (const task of this.tasks.values()) {
      if (task.originId !== originId) continue
      if (origin && task.origin !== origin) continue
      result.push(task)
    }
    return result
  }

  // ============================================================
  // 内部实现
  // ============================================================

  /**
   * 校验并执行状态迁移
   *
   * @param mutate 迁移完成后、持久化与广播之前的就地修改钩子
   *
   * 提供该钩子的原因：迁移动作往往伴随结果写入（succeed/fail/retry），
   * 若调用方在 transition 返回后再改字段并自行 touch，会导致 'updated'/'finished'
   * 事件被发射两次，订阅方会重复通知。所有伴随写入必须在这里完成。
   */
  private transition(
    id: string,
    next: TaskStatus,
    actor: string,
    message: string,
    mutate?: (task: LedgerTask) => void,
  ): LedgerTask {
    const task = this.tasks.get(id)
    if (!task) {
      throw new Error(`${LOG_PREFIX} 任务不存在: ${id}`)
    }

    const allowed = ALLOWED_TRANSITIONS[task.status] ?? []
    if (!allowed.includes(next)) {
      throw new Error(
        `${LOG_PREFIX} 非法状态迁移: ${task.status} → ${next}（任务 ${id}）`,
      )
    }

    const prev = task.status
    task.status = next
    if (next === 'completed' || next === 'failed' || next === 'cancelled') {
      task.finishedAt = now()
    }
    this.pushTrace(task, actor, `${message}（${prev} → ${next}）`)
    mutate?.(task)
    this.touch(task)
    return task
  }

  private pushTrace(task: LedgerTask, actor: string, message: string): void {
    const entry: TaskTraceEntry = { at: now(), actor, message }
    task.trace.push(entry)
    if (task.trace.length > DEFAULT_LEDGER_CONFIG.maxTracePerTask) {
      task.trace = task.trace.slice(-DEFAULT_LEDGER_CONFIG.maxTracePerTask)
    }
  }

  /** 更新时间戳、持久化并广播变更 */
  private touch(task: LedgerTask): void {
    task.updatedAt = now()
    this.persist()
    this.emit('updated', task)
    if (TERMINAL_STATUSES.includes(task.status)) {
      this.emit('finished', task)
    }
  }

  /**
   * 恢复时处理遗留的非终态任务
   *
   * 进程异常退出后，queued/running/pending_approval 的任务不可能还在跑，
   * 直接标记失败并写明原因，避免任务中心出现永远"执行中"的僵尸条目。
   */
  private recoverStaleTasks(): void {
    let recovered = 0

    for (const task of this.tasks.values()) {
      if (TERMINAL_STATUSES.includes(task.status)) continue
      task.status = 'failed'
      task.error = '进程重启，任务中断'
      task.result = { success: false, error: task.error }
      task.finishedAt = task.finishedAt ?? now()
      this.pushTrace(task, 'system', '进程重启，遗留任务收敛为失败')
      recovered++
    }

    if (recovered > 0) {
      logger.system.warn(`${LOG_PREFIX} 收敛 ${recovered} 条遗留任务为失败`)
    }
  }

  /** 容量控制：超出上限时优先淘汰最旧的终态任务 */
  private enforceCapacity(): void {
    const max = DEFAULT_LEDGER_CONFIG.maxTasks
    if (this.tasks.size <= max) return

    const candidates = Array.from(this.tasks.values())
      .filter((t) => TERMINAL_STATUSES.includes(t.status))
      .sort((a, b) => a.createdAt - b.createdAt)

    let needRemove = this.tasks.size - max
    for (const task of candidates) {
      if (needRemove <= 0) break
      this.tasks.delete(task.id)
      needRemove--
    }

    if (needRemove > 0) {
      // 终态任务不够淘汰（极端情况：大量任务同时运行），按创建时间兜底
      const rest = Array.from(this.tasks.values()).sort((a, b) => a.createdAt - b.createdAt)
      for (const task of rest) {
        if (needRemove <= 0) break
        this.tasks.delete(task.id)
        needRemove--
      }
    }
  }

  private persist(): void {
    try {
      const data: PersistedLedger = {
        version: LEDGER_SCHEMA_VERSION,
        tasks: Array.from(this.tasks.values()),
      }
      moduleDataStore.set(STORE_KEYS.TASK_LEDGER, data)
    } catch (err) {
      logger.system.warn(
        `${LOG_PREFIX} 持久化失败: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
}

/** 全局任务账本单例 */
export const taskLedger = new TaskLedger()
