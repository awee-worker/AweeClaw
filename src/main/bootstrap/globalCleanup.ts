/**
 * 全局资源清理
 *
 * 应用退出前依次停止后台服务，避免：
 * 1. 持久化数据丢失（ModuleDataStore 未 flush）
 * 2. 子进程未终止（LSP、Python、Cron）
 * 3. 网络连接未关闭（Gateway、Channel）
 *
 * 每个步骤都有独立超时，防止单个服务卡死导致应用无法退出。
 */
import { logger } from '@shared/toolkit/LogEngine'
import { destroyIndexService } from '../search-engine/indexOrchestrator'
import { lspManager } from '../language-server/languageServerManager'

/** IPC 模块句柄，由 moduleInitializer 注入 */
let ipcModule: { cleanupAllHandlers: () => void } | null = null

/** 注入 IPC 模块以便清理时调用 cleanupAllHandlers */
export function setIpcModule(module: { cleanupAllHandlers: () => void } | null): void {
  ipcModule = module
}

/** 带超时的 Promise 包装，超时后仅记录日志不抛错 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T | void> {
  return Promise.race([
    promise,
    new Promise<void>((resolve) =>
      setTimeout(() => {
        logger.system.warn(`[Cleanup] Timeout (${ms}ms): ${label}`)
        resolve()
      }, ms),
    ),
  ])
}

let cleanupStarted = false

/** 集中执行所有后台服务的清理，幂等：重复调用直接返回 */
export async function performGlobalCleanup(): Promise<void> {
  if (cleanupStarted) return
  cleanupStarted = true

  logger.system.info('[Cleanup] Starting global cleanup...')
  try {
    // 1. IPC 处理器（包括终端）
    ipcModule?.cleanupAllHandlers()

    // 2. LSP 服务器（超时 3s）
    await withTimeout(lspManager?.stopAllServers() ?? Promise.resolve(), 3000, 'LSP stopAllServers')

    // 3. 调试会话（超时 2s）
    await withTimeout(
      import('../modules/dap-adapter').then((m) => m.debugService.stopAll()).catch(() => {}),
      2000,
      'DebugService stopAll',
    )

    // 4. 索引 Worker 线程
    try {
      destroyIndexService()
    } catch {
      /* ignore */
    }

    // 5. Cron 调度器
    try {
      const { cronScheduler } = await import('../modules/automation/CronScheduler')
      cronScheduler.stop()
    } catch {
      /* ignore */
    }

    // 6. Session 生命周期管理器
    try {
      const { sessionLifecycleManager } = await import('../modules/session/SessionLifecycleManager')
      sessionLifecycleManager.stop()
    } catch {
      /* ignore */
    }

    // 7. Gateway 客户端
    try {
      const { gatewayClient } = await import('../modules/gateway/GatewayClient')
      await gatewayClient.stop()
    } catch {
      /* ignore */
    }

    // 8. 模块数据持久化存储（最后 flush，确保前序服务产生的状态被持久化）
    try {
      const { moduleDataStore } = await import('../modules/persistence/ModuleDataStore')
      moduleDataStore.flush()
    } catch {
      /* ignore */
    }

    logger.system.info('[Cleanup] Global cleanup completed successfully')
  } catch (err) {
    logger.system.error('[Cleanup] Global cleanup error:', err)
  }
}
