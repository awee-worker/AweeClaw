/**
 * 工作空间运行时引导
 *
 * 渲染进程启动后有两件事必须尽早做，否则用户侧只会看到「功能静默失效」：
 * 索引工作线程不启动，代码检索一直查不到结果；plan 与图执行状态不恢复，
 * 上一次崩溃前的执行进度、待审批卡片全部丢失。
 *
 * 这两项此前挂在状态栏组件上，状态栏下线后改为应用级引导，与界面渲染解耦：
 * 无论当前是哪个场景、外壳怎么排布，运行时该做的事都要做。
 */

import { useEffect } from 'react'
import { useStore } from '@store'
import { useAgentStore } from '@intelligence/state/IntelligenceStore'
import { indexWorkerService } from '@services/indexWorkerAdapter'
import { recoverGraphRuntimeFromDisk } from '@intelligence/graph/graphRecovery'
import { logger } from '@toolkit/LogEngine'

export function useWorkspaceRuntimeBootstrap(): void {
  // 索引工作线程：自身幂等，重复调用无副作用，与工作空间切换无关
  useEffect(() => {
    indexWorkerService.initialize()
    return indexWorkerService.onError(error => {
      logger.index.error('[index] Worker error:', error)
    })
  }, [])

  const workspacePath = useStore(s => s.workspacePath)

  // 工作空间就绪后先加载 plan，再按 plan 恢复图执行状态
  useEffect(() => {
    if (!workspacePath) return

    let cancelled = false
    const loadPlansFromDisk = useAgentStore.getState().loadPlansFromDisk

    loadPlansFromDisk(workspacePath)
      .then(() => {
        if (cancelled) return
        return recoverGraphRuntimeFromDisk(workspacePath)
      })
      .catch(error => {
        if (cancelled) return
        logger.index.error('[graph] Runtime recovery failed:', error)
      })

    return () => {
      cancelled = true
    }
  }, [workspacePath])
}
