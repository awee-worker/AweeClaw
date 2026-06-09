/**
 * 会话数据库 IPC handlers
 *
 * 为渲染进程提供 SQLite 会话数据库的读写能力：
 * - session-db:initialize           — 初始化数据库（含自动迁移）
 * - session-db:getAllSessionMeta    — 获取所有会话元数据
 * - session-db:upsertSessionMeta    — 保存会话元数据
 * - session-db:batchUpsertSessionMeta — 批量保存会话元数据
 * - session-db:deleteSessionMeta    — 删除会话元数据
 * - session-db:getAllThreadSummaries — 获取所有线程摘要
 * - session-db:getThreadMeta        — 获取线程元数据
 * - session-db:upsertThreadMeta     — 保存线程元数据
 * - session-db:deleteThreadMeta     — 删除线程元数据
 * - session-db:getThreadMessages    — 获取线程消息
 * - session-db:batchUpsertThreadMessages — 批量保存线程消息
 * - session-db:appendThreadMessage  — 追加单条消息
 * - session-db:deleteThreadMessages — 删除线程消息
 * - session-db:getThreadMessageCount — 获取线程消息数量
 * - session-db:deleteThread         — 删除线程（含消息）
 * - session-db:clearAll             — 清空所有会话数据
 * - session-db:getPath              — 获取数据库文件路径
 */

import { logger } from '@shared/toolkit/LogEngine'
import { safeIpcHandle } from './ipcGuard'
import { SessionDb } from '../modules/session-db'

// ============================================
// IPC Handlers
// ============================================

export function registerSessionDbIpcHandlers(): void {
  const db = SessionDb.getInstance()

  // 初始化数据库 + 自动迁移
  safeIpcHandle('session-db:initialize', async (_event, params?: { sessionsDir?: string }) => {
    try {
      await db.initialize()
      // 如果提供了 sessionsDir，执行 JSONL 迁移
      if (params?.sessionsDir) {
        await db.migrateFromJsonlFiles(params.sessionsDir)
      }
      return { success: true, dbPath: db.getDbPath() }
    } catch (err) {
      logger.session.error('[SessionDb] Initialize failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 获取所有会话元数据
  safeIpcHandle('session-db:getAllSessionMeta', async () => {
    try {
      return db.getAllSessionMeta()
    } catch (err) {
      logger.session.error('[SessionDb] GetAllSessionMeta failed:', err)
      return {}
    }
  })

  // 保存会话元数据
  safeIpcHandle('session-db:upsertSessionMeta', async (_event, key: string, value: any) => {
    try {
      db.upsertSessionMeta(key, value)
      return { success: true }
    } catch (err) {
      logger.session.error('[SessionDb] UpsertSessionMeta failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 批量保存会话元数据
  safeIpcHandle('session-db:batchUpsertSessionMeta', async (_event, meta: Record<string, any>) => {
    try {
      db.batchUpsertSessionMeta(meta)
      return { success: true }
    } catch (err) {
      logger.session.error('[SessionDb] BatchUpsertSessionMeta failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 删除会话元数据
  safeIpcHandle('session-db:deleteSessionMeta', async (_event, key: string) => {
    try {
      db.deleteSessionMeta(key)
      return { success: true }
    } catch (err) {
      logger.session.error('[SessionDb] DeleteSessionMeta failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 获取所有线程摘要
  safeIpcHandle('session-db:getAllThreadSummaries', async (_event, userId?: string | null) => {
    try {
      return db.getAllThreadSummaries(userId)
    } catch (err) {
      logger.session.error('[SessionDb] GetAllThreadSummaries failed:', err)
      return []
    }
  })

  // 获取线程元数据
  safeIpcHandle('session-db:getThreadMeta', async (_event, threadId: string) => {
    try {
      return db.getThreadMeta(threadId)
    } catch (err) {
      logger.session.error('[SessionDb] GetThreadMeta failed:', err)
      return null
    }
  })

  // 保存线程元数据
  safeIpcHandle('session-db:upsertThreadMeta', async (_event, threadId: string, data: any) => {
    try {
      db.upsertThreadMeta(threadId, data)
      return { success: true }
    } catch (err) {
      logger.session.error('[SessionDb] UpsertThreadMeta failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 删除线程元数据
  safeIpcHandle('session-db:deleteThreadMeta', async (_event, threadId: string) => {
    try {
      db.deleteThreadMeta(threadId)
      return { success: true }
    } catch (err) {
      logger.session.error('[SessionDb] DeleteThreadMeta failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 将未关联用户的线程归属到指定用户
  safeIpcHandle('session-db:claimOrphanThreads', async (_event, userId: string) => {
    try {
      const count = db.claimOrphanThreads(userId)
      return { success: true, count }
    } catch (err) {
      logger.session.error('[SessionDb] ClaimOrphanThreads failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 修复缺少标题的线程
  safeIpcHandle('session-db:repairMissingTitles', async () => {
    try {
      const count = db.repairMissingTitles()
      return { success: true, count }
    } catch (err) {
      logger.session.error('[SessionDb] RepairMissingTitles failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 获取线程消息
  safeIpcHandle('session-db:getThreadMessages', async (_event, threadId: string) => {
    try {
      return db.getThreadMessages(threadId)
    } catch (err) {
      logger.session.error('[SessionDb] GetThreadMessages failed:', err)
      return []
    }
  })

  // 批量保存线程消息
  safeIpcHandle('session-db:batchUpsertThreadMessages', async (_event, threadId: string, messages: any[]) => {
    try {
      db.batchUpsertThreadMessages(threadId, messages)
      return { success: true }
    } catch (err) {
      logger.session.error('[SessionDb] BatchUpsertThreadMessages failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 追加单条消息
  safeIpcHandle('session-db:appendThreadMessage', async (_event, threadId: string, message: any) => {
    try {
      db.appendThreadMessage(threadId, message)
      return { success: true }
    } catch (err) {
      logger.session.error('[SessionDb] AppendThreadMessage failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 删除线程消息
  safeIpcHandle('session-db:deleteThreadMessages', async (_event, threadId: string) => {
    try {
      db.deleteThreadMessages(threadId)
      return { success: true }
    } catch (err) {
      logger.session.error('[SessionDb] DeleteThreadMessages failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 获取线程消息数量
  safeIpcHandle('session-db:getThreadMessageCount', async (_event, threadId: string) => {
    try {
      return db.getThreadMessageCount(threadId)
    } catch (err) {
      logger.session.error('[SessionDb] GetThreadMessageCount failed:', err)
      return 0
    }
  })

  // 删除线程（含消息）
  safeIpcHandle('session-db:deleteThread', async (_event, threadId: string) => {
    try {
      db.deleteThread(threadId)
      return { success: true }
    } catch (err) {
      logger.session.error('[SessionDb] DeleteThread failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 清空所有会话数据
  safeIpcHandle('session-db:clearAll', async () => {
    try {
      db.clearAll()
      return { success: true }
    } catch (err) {
      logger.session.error('[SessionDb] ClearAll failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 获取数据库路径
  safeIpcHandle('session-db:getPath', async () => {
    return db.getDbPath()
  })

  logger.ipc.info('[SessionDb] IPC handlers registered')
}
