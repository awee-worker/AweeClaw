/**
 * 多模态融合感知 IPC 处理器（阶段9 s9-05 新增）
 *
 * 在主进程注册 IPC 处理器，暴露 PerceptionFusionService 能力给渲染进程。
 * 渲染进程通过 window.electronAPI.perceptionFusion.* 调用。
 *
 * 暴露能力：
 * - getEnvironmentContext: 获取当前 4 通道融合后的环境上下文
 * - getFusionHistory: 获取最近 N 次融合历史
 * - getLastContext: 获取最近一次融合结果（无 IO 开销）
 * - clearHistory: 清空历史滑动窗口
 *
 * @module perception/PerceptionFusionIpc
 */

import { ipcMain } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'
import { PerceptionFusionService } from './PerceptionFusionService'

/** IPC 频道前缀 */
const IPC_PREFIX = 'perceptionFusion:'

/** 注册融合感知 IPC 处理器 */
export function registerPerceptionFusionIpc(): void {
  const service = PerceptionFusionService.getInstance()

  /** 获取当前环境上下文（4 通道融合） */
  ipcMain.handle(`${IPC_PREFIX}getEnvironmentContext`, async () => {
    try {
      const ctx = await service.getEnvironmentContext()
      return { success: true, data: ctx }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.perception?.error('[IPC] getEnvironmentContext 失败:', e)
      return { success: false, error: msg }
    }
  })

  /** 获取融合历史（最近 N 次） */
  ipcMain.handle(`${IPC_PREFIX}getFusionHistory`, async (_, limit: number = 20) => {
    try {
      const history = service.getFusionHistory(limit)
      return { success: true, data: history }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.perception?.error('[IPC] getFusionHistory 失败:', e)
      return { success: false, error: msg }
    }
  })

  /** 获取最近一次融合结果（无 IO 开销，从缓存读取） */
  ipcMain.handle(`${IPC_PREFIX}getLastContext`, async () => {
    try {
      const ctx = service.getLastContext()
      return { success: true, data: ctx }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.perception?.error('[IPC] getLastContext 失败:', e)
      return { success: false, error: msg }
    }
  })

  /** 清空融合历史 */
  ipcMain.handle(`${IPC_PREFIX}clearHistory`, async () => {
    try {
      service.clearHistory()
      return { success: true }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.perception?.error('[IPC] clearHistory 失败:', e)
      return { success: false, error: msg }
    }
  })

  logger.perception?.info('[IPC] 融合感知 IPC 处理器已注册（阶段9 s9-05）')
}
