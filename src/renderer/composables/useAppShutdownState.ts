import { useEffect } from 'react'
import { aweeclawDir } from '@services/appDirService'
import { persistAllRuntimeState } from '@services/shutdownCoordinator'
import { api } from '../adapters/electronBridge'
import { logger } from '@toolkit/LogEngine'
import { agentHarness } from '@intelligence/harness'

/** 关闭阶段执行结果 */
interface PhaseResult {
  ok: boolean
  error?: unknown
}

/** 执行单个关闭阶段，捕获异常并返回结果 */
async function runPhase(task: () => unknown | Promise<unknown>): Promise<PhaseResult> {
  try {
    await task()
    return { ok: true }
  } catch (error) {
    return { ok: false, error }
  }
}

/** 页面卸载时执行的同步清理阶段 */
function runUnloadPhases(): void {
  void runPhase(() => agentHarness.shutdown('app_unload'))
  void runPhase(() => persistAllRuntimeState())
  void runPhase(() =>
    import('@services/TerminalAdapter').then(({ terminalManager }) => terminalManager.cleanup()),
  )
  void runPhase(() => aweeclawDir.flush())
}

/** 应用关闭请求时执行的异步清理阶段，返回整体成功状态 */
async function runShutdownPhases(requestId: string): Promise<boolean> {
  const agentResult = await runPhase(() => agentHarness.shutdown('app_shutdown'))
  if (!agentResult.ok) {
    /* 忽略 agent 关闭失败，继续后续阶段 */
  }

  const persistResult = await runPhase(() => persistAllRuntimeState())
  if (!persistResult.ok) {
    logger.system.error('[App] Failed to persist runtime state during shutdown:', persistResult.error)
  }

  const respondResult = await runPhase(() =>
    api.app.respondToShutdownRequest(requestId, persistResult.ok),
  )
  if (!respondResult.ok) {
    /* 忽略响应失败 */
  }

  return persistResult.ok
}

/**
 * 应用关闭状态 Hook
 *
 * 注册终端观察者、页面卸载监听器和主进程关闭请求监听器，
 * 通过分阶段执行清理任务，确保各阶段独立失败不影响后续流程。
 */
export function useAppShutdownState(): void {
  useEffect(() => {
    let terminalWatcherCleanup: (() => void) | null = null

    void import('@intelligence/runtime/terminalObserver')
      .then(({ terminalWatcher }) => {
        terminalWatcher.start()
        terminalWatcherCleanup = () => terminalWatcher.stop()
      })
      .catch((error) => {
        logger.system.warn('[App] Failed to initialize terminal watcher:', error)
      })

    const handleUnload = () => {
      runUnloadPhases()
    }

    const unsubscribeShutdown = api.app.onShutdownRequested(async ({ requestId }) => {
      await runShutdownPhases(requestId)
    })

    window.addEventListener('beforeunload', handleUnload)

    return () => {
      terminalWatcherCleanup?.()
      unsubscribeShutdown()
      window.removeEventListener('beforeunload', handleUnload)
    }
  }, [])
}
