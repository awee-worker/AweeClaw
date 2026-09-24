/**
 * 会话效果 IPC 处理器
 *
 * 暴露 EffectMetricsService 给渲染进程：
 * 渲染层提交轨迹指标、上报插件工具调用、按范围查询效果报告、按插件或场景跑质量门。
 *
 * 所有 handler 统一返回 { success, data } / { success, error }，
 * 与监控层保持同一约定，渲染层不必为每个频道写不同的解包逻辑。
 *
 * @module effect-metrics/EffectMetricsIpc
 */

import { ipcMain } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'
import {
  EffectMetricsService,
  type EffectMetricsQuery,
  type QualityGateOptions,
  type QualityGateScope,
  type RecordSessionInput,
  type RecordToolCallInput,
} from './EffectMetricsService'

/** IPC 频道前缀 */
const IPC_PREFIX = 'effect-metrics:'

/** 注册会话效果 IPC 处理器 */
export function registerEffectMetricsIpc(): void {
  const service = EffectMetricsService.getInstance()

  ipcMain.handle(`${IPC_PREFIX}recordSession`, async (_, input: RecordSessionInput) => {
    try {
      const ok = await service.recordSession(input)
      return { success: ok }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.effectMetrics?.error('[IPC] recordSession 失败:', e)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle(`${IPC_PREFIX}recordToolCall`, async (_, input: RecordToolCallInput) => {
    try {
      await service.recordToolCall(input)
      return { success: true }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.effectMetrics?.error('[IPC] recordToolCall 失败:', e)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle(`${IPC_PREFIX}query`, async (_, query: EffectMetricsQuery) => {
    try {
      const report = await service.query(query)
      return { success: true, data: report }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.effectMetrics?.error('[IPC] query 失败:', e)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle(
    `${IPC_PREFIX}qualityGate`,
    async (_, scope: QualityGateScope, targetId: string, options?: QualityGateOptions) => {
      try {
        const result = await service.runQualityGate(scope, targetId, options)
        return { success: true, data: result }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        logger.effectMetrics?.error('[IPC] qualityGate 失败:', e)
        return { success: false, error: msg }
      }
    },
  )


  // 面板打开前结清未落库的插件调用窗口，避免刚发生的调用在统计里缺席
  ipcMain.handle(`${IPC_PREFIX}flush`, async () => {
    try {
      await service.flushPluginBuckets()
      return { success: true }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.effectMetrics?.error('[IPC] flush 失败:', e)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle(`${IPC_PREFIX}clearAll`, async () => {
    try {
      const ok = await service.clearAll()
      return { success: ok }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.effectMetrics?.error('[IPC] clearAll 失败:', e)
      return { success: false, error: msg }
    }
  })

  logger.effectMetrics?.info('[EffectMetricsIpc] IPC 处理器已注册')
}
