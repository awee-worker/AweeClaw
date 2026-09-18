/**
 * 性能追踪模块入口
 *
 * 默认不自动开始追踪：常驻采集会持续追加文件，对绝大多数会话都是无用开销。
 * 需要时由渲染层显式开启（见渲染层 diagnostics/perfTraceReporter），
 * 或设置环境变量 AWEE_PERF_TRACE=1 在启动后自动开始，便于复现偶发问题。
 *
 * @module perf-trace
 */

import { logger } from '@shared/toolkit/LogEngine'
import { PerfTraceService } from './PerfTraceService'
import { registerPerfTraceIpc } from './PerfTraceIpc'

/** 环境变量开关：置为 1 时启动即开始追踪 */
const AUTO_START_ENV = 'AWEE_PERF_TRACE'

/** 自动开始时的延迟：避开启动期的集中初始化，噪声太大 */
const AUTO_START_DELAY_MS = 8000

/** 初始化性能追踪模块（注册 IPC，按需自动开始） */
export function initPerfTraceModule(): void {
  registerPerfTraceIpc()

  if (process.env[AUTO_START_ENV] !== '1') return

  setTimeout(() => {
    void PerfTraceService.getInstance()
      .start()
      .then((status) => {
        logger.system.info(`[PerfTrace] 环境变量触发自动追踪 → ${status.filePath}`)
      })
      .catch((err) => {
        logger.system.error('[PerfTrace] 自动追踪启动失败:', err)
      })
  }, AUTO_START_DELAY_MS)
}
