/**
 * 自动化引擎桥接 — Cron 调度器的 IPC 接口
 *
 * 职责：
 * - 暴露定时任务的增删改查、手动触发等 IPC 接口
 * - 支持 command 指令驱动的定时任务模式
 * - 监听 CronScheduler 事件，通过 IPC 推送到渲染进程
 */

import { BrowserWindow } from 'electron'
import { safeIpcHandle } from '../core/ipcGuard'
import { cronScheduler } from '../../modules/automation/CronScheduler'
import type { CronTaskConfig, CronTaskExecutionEvent } from '../../modules/automation/CronScheduler'

/** 获取所有可用窗口 */
function getAllWindows(): BrowserWindow[] {
  return BrowserWindow.getAllWindows().filter(w => !w.isDestroyed())
}

/** 向所有窗口广播 IPC 消息 */
function broadcast(channel: string, ...args: unknown[]): void {
  for (const win of getAllWindows()) {
    win.webContents.send(channel, ...args)
  }
}

/**
 * 注册 CronScheduler 事件监听，将状态变更推送到渲染进程
 */
export function registerAutomationEventListeners(): void {
  // 任务状态变更（running → active/completed/error）
  cronScheduler.on('task-state-changed', (taskData: Record<string, unknown>) => {
    broadcast('cron:task-state-changed', taskData)
  })

  // 任务触发执行 → 通知渲染进程发送 AI 指令
  cronScheduler.on('task-execute', (event: CronTaskExecutionEvent) => {
    broadcast('cron:task-execute', event)
  })
}

export function registerAutomationHandlers(): void {
  /** 注册 Cron 任务 */
  safeIpcHandle('cron:register', async (_, config: CronTaskConfig) => {
    const task = cronScheduler.register(config)
    return {
      success: true,
      task: {
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
      },
    }
  })

  /** 更新 Cron 任务 */
  safeIpcHandle(
    'cron:update',
    async (
      _,
      taskId: string,
      updates: Partial<Pick<CronTaskConfig, 'name' | 'description' | 'expression' | 'command' | 'maxCalls'>>,
    ) => {
      const task = cronScheduler.update(taskId, updates)
      if (!task) return { success: false, error: 'Task not found' }
      return {
        success: true,
        task: {
          id: task.id,
          name: task.name,
          description: task.description,
          expression: task.expression,
          command: task.command,
          agentId: task.agentId,
          status: task.status,
          lastRunAt: task.lastRunAt,
          nextRunAt: task.nextRunAt,
          runCount: task.runCount,
          maxCalls: task.maxCalls,
          lastError: task.lastError,
          createdAt: task.createdAt,
        },
      }
    },
  )

  /** 移除 Cron 任务 */
  safeIpcHandle('cron:unregister', async (_, taskId: string) => {
    const removed = cronScheduler.unregister(taskId)
    return { success: removed }
  })

  /** 暂停任务 */
  safeIpcHandle('cron:pause', async (_, taskId: string) => {
    const paused = cronScheduler.pause(taskId)
    return { success: paused }
  })

  /** 恢复任务 */
  safeIpcHandle('cron:resume', async (_, taskId: string) => {
    const resumed = cronScheduler.resume(taskId)
    return { success: resumed }
  })

  /** 获取所有任务 */
  safeIpcHandle('cron:getAllTasks', async () => {
    const tasks = cronScheduler.getAllTasks()
    return {
      success: true,
      tasks: tasks.map(t => ({
        id: t.id,
        name: t.name,
        description: t.description,
        expression: t.expression,
        command: t.command,
        agentId: t.agentId,
        ruleId: t.ruleId,
        status: t.status,
        lastRunAt: t.lastRunAt,
        nextRunAt: t.nextRunAt,
        runCount: t.runCount,
        maxCalls: t.maxCalls,
        lastError: t.lastError,
        createdAt: t.createdAt,
        hookEvent: t.hookEvent,
      })),
    }
  })

  /** 获取指定 Agent 的任务 */
  safeIpcHandle('cron:getTasksForAgent', async (_, agentId: string) => {
    const tasks = cronScheduler.getTasksForAgent(agentId)
    return {
      success: true,
      tasks: tasks.map(t => ({
        id: t.id,
        name: t.name,
        description: t.description,
        expression: t.expression,
        command: t.command,
        agentId: t.agentId,
        status: t.status,
        lastRunAt: t.lastRunAt,
        nextRunAt: t.nextRunAt,
        runCount: t.runCount,
        maxCalls: t.maxCalls,
        lastError: t.lastError,
        createdAt: t.createdAt,
      })),
    }
  })

  /** 启动调度器 */
  safeIpcHandle('cron:start', async () => {
    cronScheduler.start()
    return { success: true }
  })

  /** 停止调度器 */
  safeIpcHandle('cron:stop', async () => {
    cronScheduler.stop()
    return { success: true }
  })

  // ─── 按 ruleId 操作（自动化规则同步用） ──────────────

  /** 按后端规则 ID 移除任务 */
  safeIpcHandle('cron:unregisterByRuleId', async (_, ruleId: string) => {
    const removed = cronScheduler.unregisterByRuleId(ruleId)
    return { success: removed }
  })

  /** 按后端规则 ID 暂停任务 */
  safeIpcHandle('cron:pauseByRuleId', async (_, ruleId: string) => {
    const paused = cronScheduler.pauseByRuleId(ruleId)
    return { success: paused }
  })

  /** 按后端规则 ID 恢复任务 */
  safeIpcHandle('cron:resumeByRuleId', async (_, ruleId: string) => {
    const resumed = cronScheduler.resumeByRuleId(ruleId)
    return { success: resumed }
  })

  /** 按后端规则 ID 查询任务 */
  safeIpcHandle('cron:getTaskByRuleId', async (_, ruleId: string) => {
    const task = cronScheduler.findByRuleId(ruleId)
    if (!task) return { success: false, task: null }
    return {
      success: true,
      task: {
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
      },
    }
  })

  /** 按后端规则 ID 更新或创建任务（upsert） */
  safeIpcHandle(
    'cron:upsertByRuleId',
    async (
      _,
      ruleId: string,
      updates: {
        name?: string
        description?: string
        expression?: string
        command?: string
        maxCalls?: number
      },
      active?: boolean,
    ) => {
      const task = cronScheduler.upsertByRuleId(ruleId, updates, active)
      if (!task) return { success: false, error: 'Task not found and no expression provided' }
      return {
        success: true,
        task: {
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
        },
      }
    },
  )
}
