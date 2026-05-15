import { logger } from '@toolkit/LogEngine'

interface PendingTask {
  id: string
  description: string
  promise: Promise<void>
}

export class GracefulShutdown {
  private pendingTasks = new Map<string, PendingTask>()
  private isShuttingDown = false
  private timeoutMs: number
  private forceShutdownCallback?: () => void

  constructor(timeoutMs = 15000, forceShutdownCallback?: () => void) {
    this.timeoutMs = timeoutMs
    this.forceShutdownCallback = forceShutdownCallback
  }

  registerTask(id: string, description: string, promise: Promise<void>): void {
    if (this.isShuttingDown) {
      logger.agent.warn(`[GracefulShutdown] Ignoring task "${id}" during shutdown`)
      return
    }
    this.pendingTasks.set(id, { id, description, promise })
    promise.finally(() => this.pendingTasks.delete(id))
  }

  async shutdown(): Promise<void> {
    if (this.isShuttingDown) return
    this.isShuttingDown = true

    const tasks = Array.from(this.pendingTasks.values())
    if (tasks.length === 0) {
      logger.agent.info('[GracefulShutdown] No pending tasks, shutting down immediately')
      return
    }

    logger.agent.info(
      `[GracefulShutdown] Waiting for ${tasks.length} pending tasks: ` +
      tasks.map(t => `${t.id}(${t.description})`).join(', ')
    )

    const allSettled = Promise.allSettled(tasks.map(t => t.promise))
    const timeout = new Promise<void>(resolve => {
      setTimeout(() => {
        logger.agent.warn(`[GracefulShutdown] Timeout after ${this.timeoutMs}ms, forcing shutdown`)
        this.forceShutdownCallback?.()
        resolve()
      }, this.timeoutMs)
    })

    await Promise.race([allSettled, timeout])
    logger.agent.info('[GracefulShutdown] All tasks completed or timed out')
  }

  getPendingTasks(): ReadonlyArray<{ id: string; description: string }> {
    return Array.from(this.pendingTasks.values()).map(t => ({ id: t.id, description: t.description }))
  }

  get isRunning(): boolean {
    return !this.isShuttingDown
  }
}
