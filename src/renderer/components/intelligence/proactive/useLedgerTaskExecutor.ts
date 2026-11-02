/**
 * 任务执行订阅 Hook
 *
 * 订阅主进程的 'ledger:task-execute' 频道，把自动执行的任务交给执行器。
 * 只在 autoExecuteTask 开启时才会有事件到达——主进程侧已经做了拦截，
 * 这里不再重复判断开关，避免两处口径不一致。
 *
 * 应在 ChatPanel 顶层调用一次，全局生效。
 *
 * @module intelligence/proactive/useLedgerTaskExecutor
 */

import { useEffect } from 'react'
import { logger } from '@toolkit/LogEngine'
import type { LedgerTaskView } from '../../../types/electronBridge'
import { executeLedgerTask } from './ledgerTaskExecutor'

export function useLedgerTaskExecutor(): void {
  useEffect(() => {
    const api = window.electronAPI

    if (!api?.trigger?.onLedgerTaskExecute) {
      logger.agent?.warn('[useLedgerTaskExecutor] onLedgerTaskExecute API 不可用')
      return
    }

    const unsubscribe = api.trigger.onLedgerTaskExecute((task: LedgerTaskView) => {
      if (!task?.id) {
        logger.agent?.warn('[useLedgerTaskExecutor] 收到无效任务载荷:', task)
        return
      }

      void executeLedgerTask(task).then((outcome) => {
        if (!outcome.ok && !outcome.skipped) {
          logger.agent?.warn(
            `[useLedgerTaskExecutor] 自动执行未成功: ${outcome.taskId} (${outcome.reason})`,
          )
        }
      })
    })

    return () => {
      unsubscribe()
    }
  }, [])
}
