/**
 * VMC 协议 IPC 通道
 *
 * 负责渲染进程与主进程之间的 VMC 相关通信。
 * 支持：
 * - 配置查询和更新
 * - 状态查询
 * - 帧数据发送
 * - 模块启停控制
 *
 * @module vmc/VmcIpc
 */

import { ipcMain } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'
import { getVmcManager, type VmcFramePayload } from './VmcManager'
import type { VmcConfig } from './VmcStore'

// ============================================
// IPC 通道名称
// ============================================

const IPC_CHANNELS = {
  GET_CONFIG: 'vmc:get-config',
  UPDATE_CONFIG: 'vmc:update-config',
  RESET_CONFIG: 'vmc:reset-config',
  GET_STATE: 'vmc:get-state',
  GET_SENDER_STATE: 'vmc:get-sender-state',
  GET_RECEIVER_STATE: 'vmc:get-receiver-state',
  START_SENDER: 'vmc:start-sender',
  STOP_SENDER: 'vmc:stop-sender',
  START_RECEIVER: 'vmc:start-receiver',
  STOP_RECEIVER: 'vmc:stop-receiver',
  SEND_FRAME: 'vmc:send-frame',
  SEND_BONE: 'vmc:send-bone',
  SEND_BLEND: 'vmc:send-blend',
  GET_UNMAPPED_BONES: 'vmc:get-unmapped-bones',
  GET_UNMAPPED_BLENDS: 'vmc:get-unmapped-blends',
  RESET_STATS: 'vmc:reset-stats',
} as const

// ============================================
// 注册 IPC 处理器
// ============================================

/**
 * 注册 VMC IPC 处理器
 */
export function registerVmcIpcHandlers(): void {
  const manager = getVmcManager()

  // 获取配置
  ipcMain.handle(IPC_CHANNELS.GET_CONFIG, () => {
    try {
      return { success: true, data: manager.getConfig() }
    } catch (err) {
      logger.system.error('[VmcIpc] Get config failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 更新配置
  ipcMain.handle(IPC_CHANNELS.UPDATE_CONFIG, (_, update: Partial<VmcConfig>) => {
    try {
      return { success: true, data: manager.updateConfig(update) }
    } catch (err) {
      logger.system.error('[VmcIpc] Update config failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 重置配置
  ipcMain.handle(IPC_CHANNELS.RESET_CONFIG, () => {
    try {
      return {
        success: true,
        data: manager.updateConfig({
          enabled: false,
          send: { enabled: false, host: '127.0.0.1', port: 39540 },
          receive: { enabled: false, port: 39539, allowedIps: ['127.0.0.1'], syncExpression: true },
          heartbeat: { enabled: true, intervalMs: 1000 },
        }),
      }
    } catch (err) {
      logger.system.error('[VmcIpc] Reset config failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 获取状态
  ipcMain.handle(IPC_CHANNELS.GET_STATE, () => {
    try {
      return { success: true, data: manager.getState() }
    } catch (err) {
      logger.system.error('[VmcIpc] Get state failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 获取发送器状态
  ipcMain.handle(IPC_CHANNELS.GET_SENDER_STATE, () => {
    try {
      return { success: true, data: manager.getSenderState() }
    } catch (err) {
      logger.system.error('[VmcIpc] Get sender state failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 获取接收器状态
  ipcMain.handle(IPC_CHANNELS.GET_RECEIVER_STATE, () => {
    try {
      return { success: true, data: manager.getReceiverState() }
    } catch (err) {
      logger.system.error('[VmcIpc] Get receiver state failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 启动发送器
  ipcMain.handle(IPC_CHANNELS.START_SENDER, () => {
    try {
      const config = manager.getConfig()
      return { success: true, data: manager.startSender(config.send) }
    } catch (err) {
      logger.system.error('[VmcIpc] Start sender failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 停止发送器
  ipcMain.handle(IPC_CHANNELS.STOP_SENDER, () => {
    try {
      manager.stopSender()
      return { success: true, data: true }
    } catch (err) {
      logger.system.error('[VmcIpc] Stop sender failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 启动接收器
  ipcMain.handle(IPC_CHANNELS.START_RECEIVER, () => {
    try {
      const config = manager.getConfig()
      return { success: true, data: manager.startReceiver(config.receive) }
    } catch (err) {
      logger.system.error('[VmcIpc] Start receiver failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 停止接收器
  ipcMain.handle(IPC_CHANNELS.STOP_RECEIVER, () => {
    try {
      manager.stopReceiver()
      return { success: true, data: true }
    } catch (err) {
      logger.system.error('[VmcIpc] Stop receiver failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 发送帧数据
  ipcMain.handle(IPC_CHANNELS.SEND_FRAME, (_, frameData: VmcFramePayload) => {
    try {
      return { success: true, data: manager.sendFrame(frameData) }
    } catch (err) {
      logger.system.error('[VmcIpc] Send frame failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 发送单个骨骼数据
  ipcMain.handle(IPC_CHANNELS.SEND_BONE, (_, boneName: string, position: { x: number; y: number; z: number }, rotation: { x: number; y: number; z: number; w: number }) => {
    try {
      return { success: true, data: manager.sendBone(boneName, position, rotation) }
    } catch (err) {
      logger.system.error('[VmcIpc] Send bone failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 发送单个表情数据
  ipcMain.handle(IPC_CHANNELS.SEND_BLEND, (_, blendName: string, weight: number) => {
    try {
      return { success: true, data: manager.sendBlend(blendName, weight) }
    } catch (err) {
      logger.system.error('[VmcIpc] Send blend failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 获取未映射的骨骼名
  ipcMain.handle(IPC_CHANNELS.GET_UNMAPPED_BONES, () => {
    try {
      return { success: true, data: manager.getUnmappedBones() }
    } catch (err) {
      logger.system.error('[VmcIpc] Get unmapped bones failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 获取未映射的表情名
  ipcMain.handle(IPC_CHANNELS.GET_UNMAPPED_BLENDS, () => {
    try {
      return { success: true, data: manager.getUnmappedBlends() }
    } catch (err) {
      logger.system.error('[VmcIpc] Get unmapped blends failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 重置统计信息
  ipcMain.handle(IPC_CHANNELS.RESET_STATS, () => {
    try {
      manager.resetStats()
      return { success: true, data: true }
    } catch (err) {
      logger.system.error('[VmcIpc] Reset stats failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  logger.system.info('[VmcIpc] Handlers registered')
}

/**
 * 清理 VMC IPC 处理器
 */
export function cleanupVmcIpcHandlers(): void {
  for (const channel of Object.values(IPC_CHANNELS)) {
    ipcMain.removeHandler(channel)
  }
  logger.system.info('[VmcIpc] Handlers cleaned up')
}