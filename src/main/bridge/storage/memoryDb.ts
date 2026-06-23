/**
 * 记忆数据库桥接 — SQLite 记忆数据库的 IPC 接口
 *
 * 为渲染进程提供 SQLite 记忆数据库的读写能力：
 * - memory-db:initialize           — 初始化数据库
 * - memory-db:upsertEntry          — 插入或更新记忆条目
 * - memory-db:batchUpsertEntries   — 批量插入记忆条目
 * - memory-db:getEntryById         — 根据 ID 获取记忆
 * - memory-db:queryEntries         — 查询记忆列表（筛选/排序/分页）
 * - memory-db:updateEntry          — 更新记忆条目（部分字段）
 * - memory-db:deleteEntry          — 删除记忆条目
 * - memory-db:softDeleteEntry      — 软删除记忆条目（标记为禁用）
 * - memory-db:clearAll             — 清空所有记忆
 * - memory-db:getStats             — 获取记忆统计
 * - memory-db:upsertRelation       — 插入或更新关联关系
 * - memory-db:getRelations         — 获取记忆的关联关系
 * - memory-db:deleteRelation       — 删除关联关系
 * - memory-db:getSyncState         — 获取同步状态
 * - memory-db:setSyncState         — 设置同步状态
 * - memory-db:getPendingPush       — 获取待推送的记忆
 * - memory-db:markAsSynced         — 标记记忆为已同步
 * - memory-db:migrateFromJsonStore — 从旧 JSON store 迁移数据
 * - memory-db:getPath              — 获取数据库文件路径
 */

import { logger } from '@shared/toolkit/LogEngine'
import { safeIpcHandle } from '../core/ipcGuard'
import { MemoryDb } from '../../modules/memory-db'

// ============================================
// IPC Handlers
// ============================================

export function registerMemoryDbIpcHandlers(): void {
  const db = MemoryDb.getInstance()

  // 初始化数据库
  safeIpcHandle('memory-db:initialize', async () => {
    try {
      await db.initialize()
      return { success: true, dbPath: db.getDbPath() }
    } catch (err) {
      logger.agent.error('[MemoryDb] Initialize failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 插入或更新记忆条目
  safeIpcHandle('memory-db:upsertEntry', async (_event, entry: any) => {
    try {
      db.upsertEntry(entry)
      return { success: true }
    } catch (err) {
      logger.agent.error('[MemoryDb] UpsertEntry failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 批量插入记忆条目
  safeIpcHandle('memory-db:batchUpsertEntries', async (_event, entries: any[]) => {
    try {
      db.batchUpsertEntries(entries)
      return { success: true }
    } catch (err) {
      logger.agent.error('[MemoryDb] BatchUpsertEntries failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 根据 ID 获取记忆
  safeIpcHandle('memory-db:getEntryById', async (_event, id: string) => {
    try {
      return db.getEntryById(id)
    } catch (err) {
      logger.agent.error('[MemoryDb] GetEntryById failed:', err)
      return null
    }
  })

  // 查询记忆列表
  safeIpcHandle('memory-db:queryEntries', async (_event, options: any = {}) => {
    try {
      return db.queryEntries(options)
    } catch (err) {
      logger.agent.error('[MemoryDb] QueryEntries failed:', err)
      return { items: [], total: 0 }
    }
  })

  // 更新记忆条目
  safeIpcHandle('memory-db:updateEntry', async (_event, id: string, updates: any) => {
    try {
      const success = db.updateEntry(id, updates)
      return { success }
    } catch (err) {
      logger.agent.error('[MemoryDb] UpdateEntry failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 删除记忆条目
  safeIpcHandle('memory-db:deleteEntry', async (_event, id: string) => {
    try {
      const success = db.deleteEntry(id)
      return { success }
    } catch (err) {
      logger.agent.error('[MemoryDb] DeleteEntry failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 软删除记忆条目
  safeIpcHandle('memory-db:softDeleteEntry', async (_event, id: string) => {
    try {
      const success = db.softDeleteEntry(id)
      return { success }
    } catch (err) {
      logger.agent.error('[MemoryDb] SoftDeleteEntry failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 清空所有记忆
  safeIpcHandle('memory-db:clearAll', async (_event, userId?: string | null) => {
    try {
      const count = db.clearAll(userId)
      return { success: true, count }
    } catch (err) {
      logger.agent.error('[MemoryDb] ClearAll failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 获取记忆统计
  safeIpcHandle('memory-db:getStats', async (_event, userId?: string | null) => {
    try {
      return db.getStats(userId)
    } catch (err) {
      logger.agent.error('[MemoryDb] GetStats failed:', err)
      return { total: 0, enabled: 0, byTier: {}, byCategory: {} }
    }
  })

  // 获取记忆概览（统计面板用）
  safeIpcHandle('memory-db:getOverview', async (_event, userId?: string | null) => {
    try {
      return db.getOverview(userId)
    } catch (err) {
      logger.agent.error('[MemoryDb] GetOverview failed:', err)
      return {
        total: 0,
        active: 0,
        forgotten: 0,
        byCategory: [],
        byTier: [],
        recentGrowth: [],
        topTags: [],
      }
    }
  })

  // 获取可视化数据（3D 图谱用）
  safeIpcHandle('memory-db:getVisualizationData', async (_event, options: any = {}) => {
    try {
      return db.getVisualizationData(options)
    } catch (err) {
      logger.agent.error('[MemoryDb] GetVisualizationData failed:', err)
      return { nodes: [], edges: [], meta: { total: 0, byCategory: {}, byTier: {}, avgImportance: 0, avgRetention: 0 } }
    }
  })

  // 获取时间轴数据
  safeIpcHandle('memory-db:getTimeline', async (_event, options: any = {}) => {
    try {
      return db.getTimeline(options)
    } catch (err) {
      logger.agent.error('[MemoryDb] GetTimeline failed:', err)
      return []
    }
  })

  // 按月分页获取时间轴数据（v3.1）
  safeIpcHandle('memory-db:getTimelineByMonth', async (_event, options: any = {}) => {
    try {
      return db.getTimelineByMonth(options)
    } catch (err) {
      logger.agent.error('[MemoryDb] GetTimelineByMonth failed:', err)
      return { items: [], monthTotal: 0, hasPrev: false, hasNext: false, year: 0, month: 0 }
    }
  })

  // 获取所有有记忆的月份列表（v3.1）
  safeIpcHandle('memory-db:getTimelineMonths', async (_event, options: any = {}) => {
    try {
      return db.getTimelineMonths(options)
    } catch (err) {
      logger.agent.error('[MemoryDb] GetTimelineMonths failed:', err)
      return []
    }
  })

  // 插入或更新关联关系
  safeIpcHandle('memory-db:upsertRelation', async (_event, rel: any) => {
    try {
      db.upsertRelation(rel)
      return { success: true }
    } catch (err) {
      logger.agent.error('[MemoryDb] UpsertRelation failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 获取记忆的关联关系
  safeIpcHandle('memory-db:getRelations', async (_event, memoryId: string) => {
    try {
      return db.getRelationsByMemoryId(memoryId)
    } catch (err) {
      logger.agent.error('[MemoryDb] GetRelations failed:', err)
      return []
    }
  })

  // 删除关联关系
  safeIpcHandle('memory-db:deleteRelation', async (_event, id: string) => {
    try {
      const success = db.deleteRelation(id)
      return { success }
    } catch (err) {
      logger.agent.error('[MemoryDb] DeleteRelation failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 获取同步状态
  safeIpcHandle('memory-db:getSyncState', async (_event, key: string) => {
    try {
      return db.getSyncState(key)
    } catch (err) {
      logger.agent.error('[MemoryDb] GetSyncState failed:', err)
      return null
    }
  })

  // 设置同步状态
  safeIpcHandle('memory-db:setSyncState', async (_event, key: string, value: string) => {
    try {
      db.setSyncState(key, value)
      return { success: true }
    } catch (err) {
      logger.agent.error('[MemoryDb] SetSyncState failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 获取待推送的记忆
  safeIpcHandle('memory-db:getPendingPush', async (_event, limit?: number) => {
    try {
      return db.getPendingPushEntries(limit ?? 100)
    } catch (err) {
      logger.agent.error('[MemoryDb] GetPendingPush failed:', err)
      return []
    }
  })

  // 标记记忆为已同步
  safeIpcHandle('memory-db:markAsSynced', async (_event, id: string, remoteId: string) => {
    try {
      db.markAsSynced(id, remoteId)
      return { success: true }
    } catch (err) {
      logger.agent.error('[MemoryDb] MarkAsSynced failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 从旧 JSON store 迁移数据
  safeIpcHandle('memory-db:migrateFromJsonStore', async (_event, store: any) => {
    try {
      const result = db.migrateFromJsonStore(store)
      return { success: true, ...result }
    } catch (err) {
      logger.agent.error('[MemoryDb] MigrateFromJsonStore failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err), migrated: 0, skipped: 0 }
    }
  })

  // 获取数据库路径
  safeIpcHandle('memory-db:getPath', async () => {
    return db.getDbPath()
  })

  logger.ipc.info('[MemoryDb] IPC handlers registered')
}
