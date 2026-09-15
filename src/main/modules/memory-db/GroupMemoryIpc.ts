/**
 * 群组记忆 IPC 通道（P1-3）
 *
 * 注册群组记忆相关的 IPC 处理器，供渲染层调用。
 *
 * @module GroupMemoryIpc
 */

import { ipcMain } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'
import { GroupMemoryManager } from './GroupMemoryManager'
import type { GroupMemoryConfig } from './GroupMemoryManager'
import type { ExtractRequest } from './GroupMemoryExtractor'

// ============================================
// IPC 通道名
// ============================================

const CHANNELS = {
  GET_CONFIG: 'group-memory:get-config',
  UPDATE_CONFIG: 'group-memory:update-config',
  RESET_CONFIG: 'group-memory:reset-config',
  EXTRACT: 'group-memory:extract',
  GET_CONTEXT: 'group-memory:get-context',
  GET_MEMORIES: 'group-memory:get-memories',
  SUPERSEDE: 'group-memory:supersede',
  CLEAR_GROUP: 'group-memory:clear-group',
  CLEAR_ALL: 'group-memory:clear-all',
  DELETE_BY_SOURCE: 'group-memory:delete-by-source',
  GET_STATS: 'group-memory:get-stats',
} as const

// ============================================
// 注册函数
// ============================================

/**
 * 注册群组记忆 IPC 处理器
 */
export function registerGroupMemoryIpcHandlers(): void {
  const manager = GroupMemoryManager.getInstance()

  // 获取配置
  ipcMain.handle(CHANNELS.GET_CONFIG, async () => {
    try {
      return { success: true, config: manager.getConfig() }
    } catch (err) {
      logger.agent.error('[GroupMemoryIpc] Failed to get config:', err)
      return { success: false, error: String(err) }
    }
  })

  // 更新配置
  ipcMain.handle(CHANNELS.UPDATE_CONFIG, async (_event, config: Partial<GroupMemoryConfig>) => {
    try {
      manager.updateConfig(config)
      return { success: true, config: manager.getConfig() }
    } catch (err) {
      logger.agent.error('[GroupMemoryIpc] Failed to update config:', err)
      return { success: false, error: String(err) }
    }
  })

  // 重置配置
  ipcMain.handle(CHANNELS.RESET_CONFIG, async () => {
    try {
      manager.updateConfig({ enabled: false })
      return { success: true, config: manager.getConfig() }
    } catch (err) {
      logger.agent.error('[GroupMemoryIpc] Failed to reset config:', err)
      return { success: false, error: String(err) }
    }
  })

  // 提取记忆
  ipcMain.handle(CHANNELS.EXTRACT, async (_event, request: ExtractRequest) => {
    try {
      const count = await manager.extractMemories(request)
      return { success: true, count }
    } catch (err) {
      logger.agent.error('[GroupMemoryIpc] Failed to extract memories:', err)
      return { success: false, error: String(err) }
    }
  })

  // 获取记忆上下文
  ipcMain.handle(CHANNELS.GET_CONTEXT, async (_event, groupId: string, groupName: string, queryText: string) => {
    try {
      const context = manager.getMemoryContext(groupId, groupName, queryText)
      return { success: true, context }
    } catch (err) {
      logger.agent.error('[GroupMemoryIpc] Failed to get memory context:', err)
      return { success: false, error: String(err) }
    }
  })

  // 获取记忆列表
  ipcMain.handle(CHANNELS.GET_MEMORIES, async (_event, groupId: string, options?: {
    status?: string
    keyword?: string
    topK?: number
  }) => {
    try {
      const memories = manager.getGroupMemories(groupId, options)
      return { success: true, memories }
    } catch (err) {
      logger.agent.error('[GroupMemoryIpc] Failed to get memories:', err)
      return { success: false, error: String(err) }
    }
  })

  // 标记记忆为 superseded
  ipcMain.handle(CHANNELS.SUPERSEDE, async (_event, id: string) => {
    try {
      manager.supersedeMemory(id)
      return { success: true }
    } catch (err) {
      logger.agent.error('[GroupMemoryIpc] Failed to supersede memory:', err)
      return { success: false, error: String(err) }
    }
  })

  // 清除指定群组的记忆
  ipcMain.handle(CHANNELS.CLEAR_GROUP, async (_event, groupId: string) => {
    try {
      const count = manager.clearGroupMemories(groupId)
      return { success: true, count }
    } catch (err) {
      logger.agent.error('[GroupMemoryIpc] Failed to clear group memories:', err)
      return { success: false, error: String(err) }
    }
  })

  // 清除所有群组记忆
  ipcMain.handle(CHANNELS.CLEAR_ALL, async () => {
    try {
      const count = manager.clearAllGroupMemories()
      return { success: true, count }
    } catch (err) {
      logger.agent.error('[GroupMemoryIpc] Failed to clear all group memories:', err)
      return { success: false, error: String(err) }
    }
  })

  // 删除指定来源的记忆
  ipcMain.handle(CHANNELS.DELETE_BY_SOURCE, async (_event, sourceChatId: string) => {
    try {
      const count = manager.deleteMemoriesBySource(sourceChatId)
      return { success: true, count }
    } catch (err) {
      logger.agent.error('[GroupMemoryIpc] Failed to delete memories by source:', err)
      return { success: false, error: String(err) }
    }
  })

  // 获取统计
  ipcMain.handle(CHANNELS.GET_STATS, async (_event, groupId?: string) => {
    try {
      const stats = manager.getStats(groupId)
      return { success: true, stats }
    } catch (err) {
      logger.agent.error('[GroupMemoryIpc] Failed to get stats:', err)
      return { success: false, error: String(err) }
    }
  })

  logger.agent.info('[GroupMemoryIpc] Registered group memory IPC handlers')
}

/**
 * 清理群组记忆 IPC 处理器
 */
export function cleanupGroupMemoryIpcHandlers(): void {
  const channels = Object.values(CHANNELS)
  for (const channel of channels) {
    ipcMain.removeHandler(channel)
  }
  logger.agent.info('[GroupMemoryIpc] Cleaned up group memory IPC handlers')
}