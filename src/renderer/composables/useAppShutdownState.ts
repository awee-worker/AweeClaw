import { useEffect } from 'react'
import { aweeclawDir } from '@services/appDirService'
import { persistAllRuntimeState } from '@services/shutdownCoordinator'
import { api } from '../adapters/electronBridge'
import { logger } from '@toolkit/LogEngine'
import { agentHarness } from '@intelligence/harness'

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
      try {
        void agentHarness.shutdown('app_unload')
      } catch {
        /* ignore */
      }

      try {
        void persistAllRuntimeState()
      } catch {
        /* ignore */
      }

      try {
        void import('@services/TerminalAdapter')
          .then(({ terminalManager }) => terminalManager.cleanup())
          .catch(() => {
            /* ignore */
          })
      } catch {
        /* ignore */
      }

      try {
        void aweeclawDir.flush()
      } catch {
        /* ignore */
      }
    }

    const unsubscribeShutdown = api.app.onShutdownRequested(async ({ requestId }) => {
      let success = true
      try {
        await agentHarness.shutdown('app_shutdown')
      } catch {
        /* ignore */
      }

      try {
        await persistAllRuntimeState()
      } catch (error) {
        success = false
        logger.system.error('[App] Failed to persist runtime state during shutdown:', error)
      }

      try {
        await api.app.respondToShutdownRequest(requestId, success)
      } catch {
        /* ignore */
      }
    })

    window.addEventListener('beforeunload', handleUnload)

    return () => {
      terminalWatcherCleanup?.()
      unsubscribeShutdown()
      window.removeEventListener('beforeunload', handleUnload)
    }
  }, [])
}
