/**
 * 监控层 IPC 处理器
 *
 * 在主进程注册 IPC 处理器，暴露 MonitoringService 能力给渲染进程。
 * 渲染进程通过 window.electronAPI.monitoring.* 调用。
 *
 * 安全约束：
 * - 所有方法都需要先检查监控是否启用
 * - 隐私模式下只允许读取状态，不允许上报到云端
 * - 异常事件订阅使用 webContents.send 推送
 *
 * @module monitoring/MonitoringIpc
 */

import { ipcMain, BrowserWindow } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'
import { MonitoringService } from './MonitoringService'
import type { MonitoringConfig } from './MonitoringInterface'

/** IPC 频道前缀 */
const IPC_PREFIX = 'monitoring:'

/** 注册监控层 IPC 处理器 */
export function registerMonitoringIpc(): void {
  const service = MonitoringService.getInstance()

  // ============================================================
  // 配置管理
  // ============================================================

  ipcMain.handle(`${IPC_PREFIX}getConfig`, async () => {
    try {
      return { success: true, data: service.getConfig() }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.monitoring?.error('[IPC] getConfig 失败:', e)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle(
    `${IPC_PREFIX}updateConfig`,
    async (_, config: Partial<MonitoringConfig>) => {
      try {
        service.updateConfig(config)
        return { success: true, data: service.getConfig() }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        logger.monitoring?.error('[IPC] updateConfig 失败:', e)
        return { success: false, error: msg }
      }
    },
  )

  // ============================================================
  // 状态查询
  // ============================================================

  ipcMain.handle(`${IPC_PREFIX}isRunning`, async () => {
    try {
      return { success: true, data: service.isRunning() }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.monitoring?.error('[IPC] isRunning 失败:', e)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle(`${IPC_PREFIX}getLatestMetrics`, async () => {
    try {
      const metrics = service.getLatestMetrics()
      return { success: true, data: metrics }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.monitoring?.error('[IPC] getLatestMetrics 失败:', e)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle(
    `${IPC_PREFIX}getMetricsByTimeRange`,
    async (_, startTime: number, endTime: number, limit?: number) => {
      try {
        const metrics = await service.getMetricsByTimeRange(startTime, endTime, limit ?? 1000)
        return { success: true, data: metrics }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        logger.monitoring?.error('[IPC] getMetricsByTimeRange 失败:', e)
        return { success: false, error: msg }
      }
    },
  )

  // ============================================================
  // 异常查询
  // ============================================================

  ipcMain.handle(
    `${IPC_PREFIX}getAnomaliesByTimeRange`,
    async (_, startTime: number, endTime: number, limit?: number) => {
      try {
        const anomalies = await service.getAnomaliesByTimeRange(startTime, endTime, limit ?? 100)
        return { success: true, data: anomalies }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        logger.monitoring?.error('[IPC] getAnomaliesByTimeRange 失败:', e)
        return { success: false, error: msg }
      }
    },
  )

  ipcMain.handle(`${IPC_PREFIX}getRecentAnomalies`, async (_, limit?: number) => {
    try {
      const anomalies = service.getRecentAnomalies(limit ?? 20)
      return { success: true, data: anomalies }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.monitoring?.error('[IPC] getRecentAnomalies 失败:', e)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle(`${IPC_PREFIX}getActiveAnomalies`, async () => {
    try {
      const anomalies = service.getActiveAnomalies()
      return { success: true, data: anomalies }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.monitoring?.error('[IPC] getActiveAnomalies 失败:', e)
      return { success: false, error: msg }
    }
  })

  // ============================================================
  // 异常状态管理
  // ============================================================

  ipcMain.handle(`${IPC_PREFIX}acknowledgeAnomaly`, async (_, anomalyId: string) => {
    try {
      const ok = await service.acknowledgeAnomaly(anomalyId)
      return { success: ok }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.monitoring?.error('[IPC] acknowledgeAnomaly 失败:', e)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle(`${IPC_PREFIX}resolveAnomaly`, async (_, anomalyId: string) => {
    try {
      const ok = await service.resolveAnomaly(anomalyId)
      return { success: ok }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.monitoring?.error('[IPC] resolveAnomaly 失败:', e)
      return { success: false, error: msg }
    }
  })

  // ============================================================
  // 异常事件订阅（主进程 → 渲染进程推送）
  // ============================================================

  /**
   * 渲染进程通过此接口订阅异常事件
   *
   * 订阅后，主进程会通过 'monitoring:anomalyEvent' 频道向所有窗口推送新事件
   */
  ipcMain.handle(`${IPC_PREFIX}subscribe`, async () => {
    try {
      // 订阅并广播给所有窗口
      service.onAnomaly((event) => {
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) {
            win.webContents.send(`${IPC_PREFIX}anomalyEvent`, event)
          }
        }
      })
      return { success: true }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.monitoring?.error('[IPC] subscribe 失败:', e)
      return { success: false, error: msg }
    }
  })

  // ============================================================
  // 诊断与清理
  // ============================================================

  ipcMain.handle(`${IPC_PREFIX}getDetectorStats`, async () => {
    try {
      const stats = service.getDetectorStats()
      return { success: true, data: stats }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.monitoring?.error('[IPC] getDetectorStats 失败:', e)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle(`${IPC_PREFIX}clearAllData`, async () => {
    try {
      const ok = await service.clearAllData()
      return { success: ok }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.monitoring?.error('[IPC] clearAllData 失败:', e)
      return { success: false, error: msg }
    }
  })

  logger.monitoring?.info('[MonitoringIpc] IPC 处理器已注册')
}
