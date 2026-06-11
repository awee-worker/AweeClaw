/**
 * Automation IPC Bridge
 *
 * 为 Cron 调度器模块提供渲染进程调用通道。
 */

import { safeIpcHandle } from './ipcGuard'
import { cronScheduler } from '../modules/automation/CronScheduler'
import type { CronTaskConfig } from '../modules/automation/CronScheduler'

export function registerAutomationHandlers(): void {
  /** 注册 Cron 任务 */
  safeIpcHandle('cron:register', async (_, config: CronTaskConfig) => {
    const task = cronScheduler.register(config)
    return { success: true, task }
  })

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
    return { success: true, tasks }
  })

  /** 获取指定 Agent 的任务 */
  safeIpcHandle('cron:getTasksForAgent', async (_, agentId: string) => {
    const tasks = cronScheduler.getTasksForAgent(agentId)
    return { success: true, tasks }
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
