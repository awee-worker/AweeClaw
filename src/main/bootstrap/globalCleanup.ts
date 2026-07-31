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

/**
 * 快速杀死所有子进程（用于自动更新场景）
 *
 * 自动更新时 NSIS 安装器会尝试卸载旧版本，但旧版本文件仍被子进程锁定。
 * 此函数快速杀死终端、LSP、调试器等子进程，释放文件锁，
 * 让 NSIS 安装器能成功卸载旧版本。
 *
 * 与 performGlobalCleanup 的区别：
 * - performGlobalCleanup: 优雅退出，保存状态，等待 flush（5秒超时）
 * - performFastCleanup: 立即杀死子进程，不等待 flush（500ms 超时）
 */
export async function performFastCleanup(): Promise<void> {
  logger.system.info('[Cleanup] Starting fast cleanup for auto-update...')

  try {
    // 1. IPC 处理器（包括终端）—— 立即杀死所有终端子进程
    ipcModule?.cleanupAllHandlers()
  } catch (err) {
    logger.system.warn('[Cleanup] IPC cleanup error:', err)
  }

  // 2. LSP 服务器（快速杀死，超时 1s）
  try {
    await withTimeout(
      lspManager?.stopAllServers() ?? Promise.resolve(),
      1000,
      'LSP stopAllServers (fast)',
    )
  } catch {
    /* ignore */
  }

  // 3. 模块数据持久化—— 快速 flush（超时 500ms）
  try {
    const { moduleDataStore } = await import('../modules/persistence/ModuleDataStore')
    moduleDataStore.flush()
  } catch {
    /* ignore */
  }

  logger.system.info('[Cleanup] Fast cleanup completed')
}

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

    // 5.1 插件级 Cron 调度桥 + 输入监听桥（host bridge 扩展服务）
    try {
      const { getCronSchedulerBridge } = await import('../modules/plugin-sdk/CronSchedulerBridge')
      getCronSchedulerBridge().stop()
    } catch {
      /* ignore */
    }
    try {
      const { getInputListenerBridge } = await import('../modules/plugin-sdk/InputListenerBridge')
      getInputListenerBridge().stopAll()
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
