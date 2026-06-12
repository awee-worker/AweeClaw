/**
 * Automation IPC Bridge
 *
 * 为 Cron 调度器模块提供渲染进程调用通道。
 * 支持 command 指令驱动的定时任务模式。
 * 同时监听 CronScheduler 事件，通过 IPC 推送到渲染进程。
 */

import { BrowserWindow } from 'electron'
import { safeIpcHandle } from './ipcGuard'
import { cronScheduler } from '../modules/automation/CronScheduler'
import type { CronTaskConfig, CronTaskExecutionEvent } from '../modules/automation/CronScheduler'

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
}
