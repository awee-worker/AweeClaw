/**
 * Cron Scheduler Bridge — 插件定时调度桥接层
 *
 * 为外部插件提供独立的定时任务调度能力（如 ai-macro-recorder 插件的"每天 9 点自动复现宏"）。
 *
 * 设计决策（独立定时器，不复用主 CronScheduler）：
 *   客户端已有的 automation/CronScheduler 单例，其任务触发语义是"发 command 给 Agent 执行"，
 *   会进入 Agent 对话流。而插件场景（如宏任务复现）需要的是"定时调用插件本地回调"，不应
 *   干扰 Agent 调度，也不应被 Agent 生命周期影响。
 *   因此本 Bridge 维护独立的定时器与任务表，仅复用 CronScheduler 的纯函数
 *   parseCronExpression / matchesCron 完成 cron 解析，保持表达式语义一致。
 *
 * 特性：
 *   - 5 段标准 cron 表达式（分 时 日 月 周）
 *   - 任务注册/取消/暂停/恢复/立即触发
 *   - 任务回调支持同步/异步
 *   - 失败重试与最大执行次数控制
 *   - 执行日志与事件通知（EventEmitter）
 *   - 任务持久化由插件自行负责（Bridge 只管运行时调度）
 *
 * @module plugin-sdk/CronSchedulerBridge
 */

import { EventEmitter } from 'events'
import { logger } from '@shared/toolkit/LogEngine'
import {
  parseCronExpression,
  matchesCron,
  type CronFields,
} from '../automation/CronScheduler'

// ============================================
// 类型定义
// ============================================

/** 插件定时任务触发时的回调 */
export type PluginTaskHandler = (taskId: string) => void | Promise<void>

/** 任务状态 */
export type PluginTaskStatus = 'active' | 'paused' | 'running' | 'completed' | 'error'

/** 插件定时任务定义 */
export interface PluginCronTask {
  /** 任务 ID */
  id: string
  /** 任务名（插件自定义） */
  name: string
  /** Cron 表达式（5 段：分 时 日 月 周） */
  expression: string
  /** 解析后的 cron 字段 */
  fields: CronFields
  /** 触发时执行的回调 */
  handler: PluginTaskHandler
  /** 关联的插件 ID（用于归属与批量清理） */
  pluginId: string
  /** 状态 */
  status: PluginTaskStatus
  /** 上次执行时间（ms），null 表示从未执行 */
  lastRunAt: number | null
  /** 下次执行时间（ms），-1 表示 7 天内无匹配 */
  nextRunAt: number | null
  /** 已执行次数 */
  runCount: number
  /** 最大执行次数（0 = 不限） */
  maxCalls: number
  /** 失败重试次数（默认 0，不重试） */
  maxRetries: number
  /** 上次错误信息 */
  lastError: string | null
  /** 创建时间 */
  createdAt: number
}

/** 注册任务配置 */
export interface PluginTaskConfig {
  name: string
  expression: string
  handler: PluginTaskHandler
  pluginId: string
  /** 是否立即激活（默认 true） */
  active?: boolean
  /** 最大执行次数（0 = 不限） */
  maxCalls?: number
  /** 失败重试次数（默认 0） */
  maxRetries?: number
}

/** 任务事件名 */
export type CronBridgeEvent =
  | 'task-registered'
  | 'task-unregistered'
  | 'task-started'
  | 'task-completed'
  | 'task-error'
  | 'task-state-changed'

/** 任务执行结果 */
export interface TaskTriggerResult {
  success: boolean
  taskId: string
  error?: string
  runCount: number
}

// ============================================
// CronSchedulerBridge 实现
// ============================================

export class CronSchedulerBridge extends EventEmitter {
  private static _instance: CronSchedulerBridge | null = null

  /** 任务表（taskId -> task） */
  private tasks = new Map<string, PluginCronTask>()
  /** 全局调度定时器（每分钟对齐检查一次） */
  private timer: ReturnType<typeof setInterval> | null = null
  /** 是否正在运行 */
  private running = false
  /** 任务 ID 自增计数器 */
  private seq = 0

  private constructor() {
    super()
    logger.system?.info('[CronSchedulerBridge] Initialized (plugin-scoped, independent timer)')
  }

  /** 获取单例 */
  static getInstance(): CronSchedulerBridge {
    if (!CronSchedulerBridge._instance) {
      CronSchedulerBridge._instance = new CronSchedulerBridge()
    }
    return CronSchedulerBridge._instance
  }

  // ============================================
  // 调度器生命周期
  // ============================================

  /** 启动调度器（应用启动时调用一次） */
  start(): void {
    if (this.running) return
    this.running = true

    // 对齐到下一个整分钟，保证 cron 语义准确
    const now = Date.now()
    const delay = 60000 - (now % 60000)
    setTimeout(() => {
      if (!this.running) return
      this.tick()
      this.timer = setInterval(() => this.tick(), 60000)
    }, delay)

    logger.system?.info('[CronSchedulerBridge] Scheduler started')
  }

  /** 停止调度器（应用退出时调用） */
  stop(): void {
    if (!this.running) return
    this.running = false
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    logger.system?.info('[CronSchedulerBridge] Scheduler stopped')
  }

  // ============================================
  // 任务管理 API
  // ============================================

  /**
   * 注册定时任务
   * @returns taskId
   */
  register(config: PluginTaskConfig): string {
    // 校验 cron 表达式（parseCronExpression 会抛错）
    const fields = parseCronExpression(config.expression)

    const taskId = `pcron-${Date.now()}-${++this.seq}`
    const task: PluginCronTask = {
      id: taskId,
      name: config.name,
      expression: config.expression,
      fields,
      handler: config.handler,
      pluginId: config.pluginId,
      status: config.active !== false ? 'active' : 'paused',
      lastRunAt: null,
      nextRunAt: this.calculateNextRun(fields),
      runCount: 0,
      maxCalls: config.maxCalls ?? 0,
      maxRetries: config.maxRetries ?? 0,
      lastError: null,
      createdAt: Date.now(),
    }

    this.tasks.set(taskId, task)
    logger.system?.info(
      `[CronSchedulerBridge] Task registered: ${config.name} (${config.expression}) by plugin ${config.pluginId}`,
    )
    this.emit('task-registered', this.serialize(task))
    return taskId
  }

  /** 取消任务 */
  unregister(taskId: string): boolean {
    const task = this.tasks.get(taskId)
    if (!task) return false
    this.tasks.delete(taskId)
    logger.system?.info(`[CronSchedulerBridge] Task unregistered: ${task.name} (${taskId})`)
    this.emit('task-unregistered', this.serialize(task))
    return true
  }

  /** 批量取消某插件的所有任务（插件卸载时调用） */
  unregisterByPlugin(pluginId: string): number {
    let count = 0
    for (const [id, task] of Array.from(this.tasks.entries())) {
      if (task.pluginId === pluginId) {
        this.tasks.delete(id)
        this.emit('task-unregistered', this.serialize(task))
        count++
      }
    }
    if (count > 0) {
      logger.system?.info(`[CronSchedulerBridge] Unregistered ${count} task(s) for plugin ${pluginId}`)
    }
    return count
  }

  /** 暂停任务 */
  pause(taskId: string): boolean {
    const task = this.tasks.get(taskId)
    if (!task || task.status !== 'active') return false
    task.status = 'paused'
    this.emit('task-state-changed', this.serialize(task))
    return true
  }

  /** 恢复任务 */
  resume(taskId: string): boolean {
    const task = this.tasks.get(taskId)
    if (!task || task.status !== 'paused') return false
    task.status = 'active'
    task.nextRunAt = this.calculateNextRun(task.fields)
    this.emit('task-state-changed', this.serialize(task))
    return true
  }

  /** 获取任务信息 */
  getTask(taskId: string): PluginCronTask | undefined {
    return this.tasks.get(taskId)
  }

  /** 获取所有任务 */
  listTasks(): PluginCronTask[] {
    return Array.from(this.tasks.values())
  }

  /** 获取某插件的所有任务 */
  listTasksByPlugin(pluginId: string): PluginCronTask[] {
    return Array.from(this.tasks.values()).filter((t) => t.pluginId === pluginId)
  }

  /**
   * 立即触发一次（不影响下次定时计划与 runCount 计数）
   * 用于"测试运行"或手动补跑
   */
  async triggerNow(taskId: string): Promise<TaskTriggerResult> {
    const task = this.tasks.get(taskId)
    if (!task) {
      return { success: false, taskId, error: 'Task not found', runCount: 0 }
    }
    // executeTask 内部捕获 handler 异常（避免 tick 场景未捕获拒绝），
    // 因此通过返回值判定成功/失败，而非 try/catch
    const result = await this.executeTask(task, /* isManual */ true)
    if (result.success) {
      return { success: true, taskId, runCount: task.runCount }
    }
    return { success: false, taskId, error: result.error, runCount: task.runCount }
  }

  // ============================================
  // 内部调度逻辑
  // ============================================

  /** 每分钟触发一次，检查所有 active 任务是否匹配 */
  private async tick(): Promise<void> {
    const now = new Date()
    const tasksToRun: PluginCronTask[] = []

    for (const task of this.tasks.values()) {
      if (task.status !== 'active') continue
      if (!matchesCron(now, task.fields)) continue

      // 检查最大执行次数
      if (task.maxCalls > 0 && task.runCount >= task.maxCalls) {
        task.status = 'completed'
        this.emit('task-state-changed', this.serialize(task))
        continue
      }
      tasksToRun.push(task)
    }

    // 并行执行所有命中任务（互不阻塞）
    for (const task of tasksToRun) {
      this.executeTask(task, /* isManual */ false).catch((err) => {
        logger.system?.error(
          `[CronSchedulerBridge] Unhandled error in task ${task.name}: ${err}`,
        )
      })
    }
  }

  /**
   * 执行单个任务（含重试逻辑）
   *
   * 内部捕获 handler 异常（避免 tick 场景产生未捕获的 Promise 拒绝），
   * 通过返回值向上层（triggerNow）传递成功/失败结果。
   *
   * @param isManual 是否为手动触发（手动触发不计入 runCount，不更新 nextRunAt）
   * @returns 执行结果：成功时 { success: true }，失败时 { success: false, error }
   */
  private async executeTask(
    task: PluginCronTask,
    isManual: boolean,
  ): Promise<{ success: true } | { success: false; error: string }> {
    const prevStatus = task.status
    task.status = 'running'
    task.lastRunAt = Date.now()
    this.emit('task-started', this.serialize(task))

    let attempt = 0
    const maxAttempts = 1 + task.maxRetries
    let lastErr: Error | null = null

    while (attempt < maxAttempts) {
      try {
        await task.handler(task.id)
        lastErr = null
        break
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err))
        attempt++
        if (attempt < maxAttempts) {
          // 重试前等待 1 秒（避免瞬时故障连续失败）
          await new Promise((r) => setTimeout(r, 1000))
          logger.system?.warn(
            `[CronSchedulerBridge] Task ${task.name} retry ${attempt}/${task.maxRetries}: ${lastErr.message}`,
          )
        }
      }
    }

    if (lastErr) {
      task.status = 'error'
      task.lastError = lastErr.message
      logger.system?.error(`[CronSchedulerBridge] Task failed: ${task.name} - ${lastErr.message}`)
      this.emit('task-error', this.serialize(task), lastErr)
      this.emit('task-state-changed', this.serialize(task))
      return { success: false, error: lastErr.message }
    }

    task.lastError = null
    if (!isManual) {
      task.runCount++
      task.nextRunAt = this.calculateNextRun(task.fields)
      // 达到最大次数则标记完成
      if (task.maxCalls > 0 && task.runCount >= task.maxCalls) {
        task.status = 'completed'
      } else {
        task.status = 'active'
      }
    } else {
      // 手动触发恢复原状态
      task.status = prevStatus === 'running' ? 'active' : prevStatus
    }
    logger.system?.info(
      `[CronSchedulerBridge] Task ${isManual ? 'triggered' : 'completed'}: ${task.name} (run #${task.runCount})`,
    )
    this.emit('task-completed', this.serialize(task))
    this.emit('task-state-changed', this.serialize(task))
    return { success: true }
  }

  /**
   * 计算下次执行时间（扫描未来 7 天，每分钟粒度）
   * 复用 automation/CronScheduler 的 matchesCron 语义
   */
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

  /** 序列化任务为可传输的纯对象（去掉 handler 函数） */
  private serialize(task: PluginCronTask): Omit<PluginCronTask, 'handler'> {
    const { handler: _handler, ...rest } = task
    return rest
  }
}

// ============================================
// 导出
// ============================================

/** 全局单例便捷获取 */
export function getCronSchedulerBridge(): CronSchedulerBridge {
  return CronSchedulerBridge.getInstance()
}
