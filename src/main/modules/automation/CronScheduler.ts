/**
 * Cron 调度器
 *
 * 借鉴 OpenClaw 的自动化引擎，实现定时任务调度：
 * 1. Cron 表达式解析与调度
 * 2. 任务注册、暂停、恢复、删除
 * 3. 任务执行日志
 * 4. 与 Hook 系统集成（Cron 触发 Hook 事件）
 *
 * @module automation/CronScheduler
 */

import { EventEmitter } from 'events'
import { logger } from '@shared/toolkit/LogEngine'
import { hookEngine } from '@shared/plugin-sdk/hooks'
import { moduleDataStore, STORE_KEYS } from '../persistence/ModuleDataStore'

// ============================================
// Cron 表达式解析
// ============================================

/** 简化的 Cron 字段 */
export interface CronFields {
  minute: number[]      // 0-59
  hour: number[]        // 0-23
  dayOfMonth: number[]  // 1-31
  month: number[]       // 1-12
  dayOfWeek: number[]   // 0-6 (0=Sunday)
}

/**
 * 解析简化的 Cron 表达式
 * 支持格式：分 时 日 月 周
 * - "*\/5 * * * *"    - 每 5 分钟
 * - "0 * * * *"       - 每小时整点
 * - "0 4 * * *"       - 每天凌晨 4 点
 * - "30 9 * * 1-5"    - 工作日 9:30
 */
export function parseCronExpression(expression: string): CronFields {
  const parts = expression.trim().split(/\s+/)
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression: expected 5 fields, got ${parts.length}`)
  }

  return {
    minute: parseField(parts[0], 0, 59),
    hour: parseField(parts[1], 0, 23),
    dayOfMonth: parseField(parts[2], 1, 31),
    month: parseField(parts[3], 1, 12),
    dayOfWeek: parseField(parts[4], 0, 6),
  }
}

function parseField(field: string, min: number, max: number): number[] {
  const values = new Set<number>()

  for (const part of field.split(',')) {
    if (part === '*') {
      for (let i = min; i <= max; i++) values.add(i)
    } else if (part.startsWith('*/')) {
      const step = parseInt(part.slice(2), 10)
      if (isNaN(step) || step <= 0) throw new Error(`Invalid step: ${part}`)
      for (let i = min; i <= max; i += step) values.add(i)
    } else if (part.includes('-')) {
      const [startStr, endStr] = part.split('-')
      const start = parseInt(startStr, 10)
      const end = parseInt(endStr, 10)
      if (isNaN(start) || isNaN(end)) throw new Error(`Invalid range: ${part}`)
      for (let i = start; i <= end; i++) values.add(i)
    } else {
      const val = parseInt(part, 10)
      if (isNaN(val)) throw new Error(`Invalid value: ${part}`)
      values.add(val)
    }
  }

  return Array.from(values).sort((a, b) => a - b)
}

/**
 * 检查给定时间是否匹配 Cron 字段
 */
export function matchesCron(date: Date, fields: CronFields): boolean {
  return (
    fields.minute.includes(date.getMinutes()) &&
    fields.hour.includes(date.getHours()) &&
    fields.dayOfMonth.includes(date.getDate()) &&
    fields.month.includes(date.getMonth() + 1) &&
    fields.dayOfWeek.includes(date.getDay())
  )
}

// ============================================
// Cron 任务定义
// ============================================

export type CronTaskStatus = 'active' | 'paused' | 'running' | 'error'

export interface CronTask {
  id: string
  name: string
  /** Cron 表达式 */
  expression: string
  /** 解析后的字段 */
  fields: CronFields
  /** 任务处理函数 */
  handler: () => Promise<void>
  /** 关联的 Agent ID */
  agentId?: string
  /** 状态 */
  status: CronTaskStatus
  /** 上次执行时间 */
  lastRunAt: number | null
  /** 下次执行时间 */
  nextRunAt: number | null
  /** 执行次数 */
  runCount: number
  /** 上次错误 */
  lastError: string | null
  /** 创建时间 */
  createdAt: number
  /** 触发的 Hook 事件名 */
  hookEvent?: string
}

export interface CronTaskConfig {
  name: string
  expression: string
  handler: () => Promise<void>
  agentId?: string
  hookEvent?: string
  /** 是否立即激活（默认 true） */
  active?: boolean
}

/** 可持久化的任务配置（不含 handler 函数） */
export interface PersistedCronTask {
  id: string
  name: string
  expression: string
  agentId?: string
  hookEvent?: string
  active: boolean
  createdAt: number
}

// ============================================
// Cron 调度器
// ============================================

class CronScheduler extends EventEmitter {
  private tasks = new Map<string, CronTask>()
  private timer: ReturnType<typeof setInterval> | null = null
  private running = false
  /** 已注册的 handler 工厂（用于恢复持久化任务时重建 handler） */
  private handlerFactories = new Map<string, () => Promise<void>>()

  /**
   * 启动调度器
   */
  start(): void {
    if (this.running) return
    this.running = true

    // 每分钟检查一次
    this.timer = setInterval(() => this.tick(), 60000)
    logger.system.info('[CronScheduler] Started')
  }

  /**
   * 停止调度器
   */
  stop(): void {
    if (!this.running) return
    this.running = false

    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }

    logger.system.info('[CronScheduler] Stopped')
  }

  // ============================================
  // 持久化
  // ============================================

  /**
   * 注册 handler 工厂（用于恢复持久化任务时重建 handler）
   * 应在应用初始化时调用，注册各场景的 handler 工厂
   */
  registerHandlerFactory(taskName: string, factory: () => Promise<void>): void {
    this.handlerFactories.set(taskName, factory)
  }

  /**
   * 从持久化存储恢复任务
   * 恢复的任务 handler 通过 handlerFactory 重建，若无对应工厂则跳过
   */
  restoreFromStore(): void {
    const persisted = moduleDataStore.get<PersistedCronTask[]>(STORE_KEYS.CRON_TASKS)
    if (!persisted || persisted.length === 0) return

    let restored = 0
    for (const p of persisted) {
      const factory = this.handlerFactories.get(p.name)
      if (!factory) {
        logger.system.warn(`[CronScheduler] No handler factory for task "${p.name}", skipping restore`)
        continue
      }

      this.register({
        name: p.name,
        expression: p.expression,
        handler: factory,
        agentId: p.agentId,
        hookEvent: p.hookEvent,
        active: p.active,
      })
      restored++
    }

    logger.system.info(`[CronScheduler] Restored ${restored}/${persisted.length} tasks from store`)
  }

  /** 持久化当前任务列表 */
  private persistTasks(): void {
    const persisted: PersistedCronTask[] = Array.from(this.tasks.values()).map(t => ({
      id: t.id,
      name: t.name,
      expression: t.expression,
      agentId: t.agentId,
      hookEvent: t.hookEvent,
      active: t.status === 'active',
      createdAt: t.createdAt,
    }))
    moduleDataStore.set(STORE_KEYS.CRON_TASKS, persisted)
  }

  // ============================================
  // 任务管理
  // ============================================

  /**
   * 注册 Cron 任务
   */
  register(config: CronTaskConfig): CronTask {
    const id = `cron-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const fields = parseCronExpression(config.expression)

    const task: CronTask = {
      id,
      name: config.name,
      expression: config.expression,
      fields,
      handler: config.handler,
      agentId: config.agentId,
      status: config.active !== false ? 'active' : 'paused',
      lastRunAt: null,
      nextRunAt: this.calculateNextRun(fields),
      runCount: 0,
      lastError: null,
      createdAt: Date.now(),
      hookEvent: config.hookEvent,
    }

    this.tasks.set(id, task)
    this.persistTasks()
    logger.system.info(`[CronScheduler] Registered task: ${config.name} (${config.expression})`)
    this.emit('task-registered', task)

    return task
  }

  /**
   * 移除 Cron 任务
   */
  unregister(taskId: string): boolean {
    const task = this.tasks.get(taskId)
    if (!task) return false

    this.tasks.delete(taskId)
    this.persistTasks()
    logger.system.info(`[CronScheduler] Unregistered task: ${task.name}`)
    this.emit('task-unregistered', task)
    return true
  }

  /**
   * 暂停任务
   */
  pause(taskId: string): boolean {
    const task = this.tasks.get(taskId)
    if (!task || task.status !== 'active') return false
    task.status = 'paused'
    this.emit('task-paused', task)
    return true
  }

  /**
   * 恢复任务
   */
  resume(taskId: string): boolean {
    const task = this.tasks.get(taskId)
    if (!task || task.status !== 'paused') return false
    task.status = 'active'
    task.nextRunAt = this.calculateNextRun(task.fields)
    this.emit('task-resumed', task)
    return true
  }

  /**
   * 获取所有任务
   */
  getAllTasks(): CronTask[] {
    return Array.from(this.tasks.values())
  }

  /**
   * 获取指定 Agent 的任务
   */
  getTasksForAgent(agentId: string): CronTask[] {
    return Array.from(this.tasks.values()).filter(t => t.agentId === agentId)
  }

  // ============================================
  // 调度逻辑（私有）
  // ============================================

  private async tick(): Promise<void> {
    const now = new Date()

    for (const task of this.tasks.values()) {
      if (task.status !== 'active') continue
      if (!matchesCron(now, task.fields)) continue

      // 异步执行，不阻塞其他任务
      this.executeTask(task).catch(err => {
        logger.system.error(`[CronScheduler] Unhandled error in task ${task.name}: ${err}`)
      })
    }
  }

  private async executeTask(task: CronTask): Promise<void> {
    task.status = 'running'
    task.lastRunAt = Date.now()
    this.emit('task-started', task)

    try {
      // 执行任务处理函数
      await task.handler()

      // 触发关联的 Hook 事件
      if (task.hookEvent) {
        await hookEngine.trigger(task.hookEvent as any, {
          taskId: task.id,
          taskName: task.name,
          agentId: task.agentId,
          timestamp: Date.now(),
        })
      }

      task.status = 'active'
      task.runCount++
      task.nextRunAt = this.calculateNextRun(task.fields)
      task.lastError = null

      logger.system.info(`[CronScheduler] Task completed: ${task.name} (run #${task.runCount})`)
      this.emit('task-completed', task)

    } catch (err) {
      task.status = 'active'
      task.lastError = err instanceof Error ? err.message : String(err)

      logger.system.error(`[CronScheduler] Task failed: ${task.name} - ${task.lastError}`)
      this.emit('task-error', task, err)
    }
  }

  /**
   * 计算下次执行时间（简化版，只检查未来 24 小时）
   */
  private calculateNextRun(fields: CronFields): number {
    const now = new Date()
    const future = new Date(now.getTime() + 24 * 60 * 60 * 1000)

    for (let t = new Date(now.getTime() + 60000); t <= future; t = new Date(t.getTime() + 60000)) {
      if (matchesCron(t, fields)) {
        return t.getTime()
      }
    }

    return -1 // 24 小时内无匹配
  }
}

/** 全局 Cron 调度器实例 */
export const cronScheduler = new CronScheduler()
