/**
 * Cron 调度器
 *
 * 基于 command 指令驱动的定时任务调度：
 * 1. Cron 表达式解析与调度
 * 2. 任务注册、暂停、恢复、删除
 * 3. 任务执行日志
 * 4. 与 Hook 系统集成（Cron 触发 Hook 事件）
 * 5. 触发时通过 command 指令发送给 Agent 执行
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
 * - 每 5 分钟:   星/5 * * * *
 * - 每小时整点:  0 * * * *
 * - 每天凌晨 4 点: 0 4 * * *
 * - 工作日 9:30: 30 9 * * 1-5
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

export type CronTaskStatus = 'active' | 'paused' | 'running' | 'completed' | 'error'

export interface CronTask {
  id: string
  name: string
  description: string
  /** Cron 表达式 */
  expression: string
  /** 解析后的字段 */
  fields: CronFields
  /** 触发时发送给 Agent 的自然语言指令 */
  command: string
  /** 关联的 Agent ID（会话 ID） */
  agentId?: string
  /** 关联的后端自动化规则 ID（用于本地优先执行 + 后端兜底协调） */
  ruleId?: string
  /** 状态 */
  status: CronTaskStatus
  /** 上次执行时间 */
  lastRunAt: number | null
  /** 下次执行时间 */
  nextRunAt: number | null
  /** 执行次数 */
  runCount: number
  /** 最大执行次数（0 = 不限） */
  maxCalls: number
  /** 上次错误 */
  lastError: string | null
  /** 创建时间 */
  createdAt: number
  /** 触发的 Hook 事件名 */
  hookEvent?: string
}

export interface CronTaskConfig {
  name: string
  description?: string
  /** Cron 表达式 */
  expression: string
  /** 触发时发送给 Agent 的自然语言指令 */
  command: string
  /** 关联的 Agent ID */
  agentId?: string
  /** 关联的后端自动化规则 ID */
  ruleId?: string
  /** 触发的 Hook 事件名 */
  hookEvent?: string
  /** 是否立即激活（默认 true） */
  active?: boolean
  /** 最大执行次数（0 = 不限） */
  maxCalls?: number
}

/** 可持久化的任务配置 */
export interface PersistedCronTask {
  id: string
  name: string
  description: string
  expression: string
  command: string
  agentId?: string
  ruleId?: string
  hookEvent?: string
  active: boolean
  maxCalls: number
  createdAt: number
}

/** 任务执行事件 */
export interface CronTaskExecutionEvent {
  taskId: string
  taskName: string
  command: string
  agentId?: string
  ruleId?: string
  timestamp: number
}

// ============================================
// Cron 调度器
// ============================================

class CronScheduler extends EventEmitter {
  private tasks = new Map<string, CronTask>()
  private timer: ReturnType<typeof setInterval> | null = null
  private running = false

  /**
   * 启动调度器
   */
  start(): void {
    if (this.running) return
    this.running = true

    // 每分钟检查一次（对齐到整分钟）
    const now = Date.now()
    const delay = 60000 - (now % 60000)
    setTimeout(() => {
      this.tick()
      this.timer = setInterval(() => this.tick(), 60000)
    }, delay)

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
   * 从持久化存储恢复任务
   */
  restoreFromStore(): void {
    const persisted = moduleDataStore.get<PersistedCronTask[]>(STORE_KEYS.CRON_TASKS)
    if (!persisted || persisted.length === 0) return

    let restored = 0
    for (const p of persisted) {
      try {
        this.register({
          name: p.name,
          description: p.description,
          expression: p.expression,
          command: p.command,
          agentId: p.agentId,
          ruleId: p.ruleId,
          hookEvent: p.hookEvent,
          active: p.active,
          maxCalls: p.maxCalls,
        })
        restored++
      } catch (err) {
        logger.system.error(`[CronScheduler] Failed to restore task "${p.name}": ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    logger.system.info(`[CronScheduler] Restored ${restored}/${persisted.length} tasks from store`)
  }

  /** 持久化当前任务列表 */
  private persistTasks(): void {
    const persisted: PersistedCronTask[] = Array.from(this.tasks.values()).map(t => ({
      id: t.id,
      name: t.name,
      description: t.description,
      expression: t.expression,
      command: t.command,
      agentId: t.agentId,
      ruleId: t.ruleId,
      hookEvent: t.hookEvent,
      active: t.status === 'active',
      maxCalls: t.maxCalls,
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
      description: config.description || '',
      expression: config.expression,
      fields,
      command: config.command,
      agentId: config.agentId,
      ruleId: config.ruleId,
      status: config.active !== false ? 'active' : 'paused',
      lastRunAt: null,
      nextRunAt: this.calculateNextRun(fields),
      runCount: 0,
      maxCalls: config.maxCalls || 0,
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
   * 更新 Cron 任务
   */
  update(taskId: string, updates: Partial<Pick<CronTaskConfig, 'name' | 'description' | 'expression' | 'command' | 'maxCalls'>>): CronTask | null {
    const task = this.tasks.get(taskId)
    if (!task) return null

    if (updates.name !== undefined) task.name = updates.name
    if (updates.description !== undefined) task.description = updates.description
    if (updates.command !== undefined) task.command = updates.command
    if (updates.maxCalls !== undefined) task.maxCalls = updates.maxCalls
    if (updates.expression !== undefined) {
      task.expression = updates.expression
      task.fields = parseCronExpression(updates.expression)
      task.nextRunAt = this.calculateNextRun(task.fields)
    }

    this.persistTasks()
    this.emit('task-updated', task)
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
    this.persistTasks()
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
    this.persistTasks()
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

  /**
   * 获取指定任务
   */
  getTask(taskId: string): CronTask | undefined {
    return this.tasks.get(taskId)
  }

  // ============================================
  // 按 ruleId 操作（用于自动化规则同步）
  // ============================================

  /**
   * 按后端规则 ID 查找任务
   */
  findByRuleId(ruleId: string): CronTask | undefined {
    return Array.from(this.tasks.values()).find(t => t.ruleId === ruleId)
  }

  /**
   * 按后端规则 ID 移除任务
   */
  unregisterByRuleId(ruleId: string): boolean {
    const task = this.findByRuleId(ruleId)
    if (!task) return false
    return this.unregister(task.id)
  }

  /**
   * 按后端规则 ID 暂停任务
   */
  pauseByRuleId(ruleId: string): boolean {
    const task = this.findByRuleId(ruleId)
    if (!task) return false
    return this.pause(task.id)
  }

  /**
   * 按后端规则 ID 恢复任务
   */
  resumeByRuleId(ruleId: string): boolean {
    const task = this.findByRuleId(ruleId)
    if (!task) return false
    return this.resume(task.id)
  }

  /**
   * 按后端规则 ID 更新任务（不存在则注册）
   */
  upsertByRuleId(
    ruleId: string,
    updates: Partial<Pick<CronTaskConfig, 'name' | 'description' | 'expression' | 'command' | 'maxCalls'>>,
    active?: boolean,
  ): CronTask | null {
    const existing = this.findByRuleId(ruleId)
    if (existing) {
      const updated = this.update(existing.id, updates)
      // 同步启停状态
      if (active !== undefined) {
        if (active && existing.status === 'paused') {
          this.resume(existing.id)
        } else if (!active && existing.status === 'active') {
          this.pause(existing.id)
        }
      }
      return updated
    }
    // 不存在则注册（需要 expression 和 command）
    if (!updates.expression) return null
    return this.register({
      name: updates.name || ruleId,
      description: updates.description || '',
      expression: updates.expression,
      command: updates.command || '',
      ruleId,
      active: active ?? true,
      maxCalls: updates.maxCalls,
    })
  }

  // ============================================
  // 调度逻辑（私有）
  // ============================================

  private async tick(): Promise<void> {
    const now = new Date()

    for (const task of this.tasks.values()) {
      if (task.status !== 'active') continue
      if (!matchesCron(now, task.fields)) continue

      // 检查最大执行次数
      if (task.maxCalls > 0 && task.runCount >= task.maxCalls) {
        task.status = 'paused'
        this.persistTasks()
        logger.system.info(`[CronScheduler] Task ${task.name} reached max calls (${task.maxCalls}), auto-paused`)
        this.emit('task-max-calls-reached', task)
        continue
      }

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
    this.emit('task-state-changed', this.serializeTask(task))

    try {
      // 触发关联的 Hook 事件
      if (task.hookEvent) {
        await hookEngine.trigger(task.hookEvent as any, {
          taskId: task.id,
          taskName: task.name,
          agentId: task.agentId,
          timestamp: Date.now(),
        })
      }

      // 发送 command 执行事件，由上层（automation bridge）监听并转发给渲染进程
      const executionEvent: CronTaskExecutionEvent = {
        taskId: task.id,
        taskName: task.name,
        command: task.command,
        agentId: task.agentId,
        ruleId: task.ruleId,
        timestamp: Date.now(),
      }
      this.emit('task-execute', executionEvent)

      task.runCount++
      task.nextRunAt = this.calculateNextRun(task.fields)
      task.lastError = null

      // 判断是否为一次性任务（maxCalls 达到上限或下次执行时间为 -1）
      if (task.maxCalls > 0 && task.runCount >= task.maxCalls) {
        task.status = 'completed'
      } else {
        task.status = 'active'
      }

      logger.system.info(`[CronScheduler] Task triggered: ${task.name} (run #${task.runCount})`)
      this.emit('task-completed', task)
      this.emit('task-state-changed', this.serializeTask(task))
      this.persistTasks()

    } catch (err) {
      task.status = 'error'
      task.lastError = err instanceof Error ? err.message : String(err)

      logger.system.error(`[CronScheduler] Task failed: ${task.name} - ${task.lastError}`)
      this.emit('task-error', task, err)
      this.emit('task-state-changed', this.serializeTask(task))
      this.persistTasks()
    }
  }

  /**
   * 计算下次执行时间（检查未来 7 天）
   */
  /** 序列化任务为可传输的纯对象 */
  private serializeTask(task: CronTask): Record<string, unknown> {
    return {
      id: task.id,
      name: task.name,
      description: task.description,
      expression: task.expression,
      command: task.command,
      agentId: task.agentId,
      ruleId: task.ruleId,
      status: task.status,
      lastRunAt: task.lastRunAt,
      nextRunAt: task.nextRunAt,
      runCount: task.runCount,
      maxCalls: task.maxCalls,
      lastError: task.lastError,
      createdAt: task.createdAt,
      hookEvent: task.hookEvent,
    }
  }

  private calculateNextRun(fields: CronFields): number {
    const now = new Date()
    const future = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

    for (let t = new Date(now.getTime() + 60000); t <= future; t = new Date(t.getTime() + 60000)) {
      if (matchesCron(t, fields)) {
        return t.getTime()
      }
    }

    return -1 // 7 天内无匹配
  }
}

/** 全局 Cron 调度器实例 */
export const cronScheduler = new CronScheduler()
