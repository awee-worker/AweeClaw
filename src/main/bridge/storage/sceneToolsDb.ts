/**
 * 场景工具数据库桥接 — 场景工具 SQLite 持久化的 IPC 接口
 *
 * 为渲染进程提供场景工具数据的 SQLite 读写能力：
 * - scene-tools-db:initialize — 初始化数据库（幂等，含建表）
 * - scene-tools-db:get        — 读取单个 key 的原始 JSON 字符串
 * - scene-tools-db:set        — 写入（upsert）单个 key
 * - scene-tools-db:remove     — 删除单个 key
 * - scene-tools-db:loadAll    — 加载全部 key -> JSON 字符串
 * - scene-tools-db:getPath    — 获取数据库文件路径
 *
 * key 与渲染进程 zustand persist 的 name 一一对应（如 `scene-tools:work-todo`），
 * value 为 JSON 序列化字符串，与原有 localStorage 格式完全兼容。
 */

import { logger } from '@shared/toolkit/LogEngine'
import { safeIpcHandle } from '../core/ipcGuard'
import { SceneToolsDb } from '../../modules/scene-tools-db'

// ============================================
// IPC Handlers
// ============================================

export function registerSceneToolsDbIpcHandlers(): void {
  const db = SceneToolsDb.getInstance()

  // 初始化数据库（幂等）
  safeIpcHandle('scene-tools-db:initialize', async () => {
    try {
      await db.ensureInitialized()
      return { success: true, dbPath: db.getDbPath() }
    } catch (err) {
      logger.system.error('[SceneToolsDb] Initialize failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 读取单个 key（原始 JSON 字符串）
  safeIpcHandle('scene-tools-db:get', async (_event, key: string) => {
    try {
      await db.ensureInitialized()
      return db.get(key)
    } catch (err) {
      logger.system.error('[SceneToolsDb] Get failed:', err)
      return null
    }
  })

  // 写入（upsert）单个 key
  safeIpcHandle('scene-tools-db:set', async (_event, key: string, value: string) => {
    try {
      await db.ensureInitialized()
      db.set(key, value)
      return { success: true }
    } catch (err) {
      logger.system.error('[SceneToolsDb] Set failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 删除单个 key
  safeIpcHandle('scene-tools-db:remove', async (_event, key: string) => {
    try {
      await db.ensureInitialized()
      db.remove(key)
      return { success: true }
    } catch (err) {
      logger.system.error('[SceneToolsDb] Remove failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 加载全部 key -> JSON 字符串
  safeIpcHandle('scene-tools-db:loadAll', async () => {
    try {
      await db.ensureInitialized()
      return db.loadAll()
    } catch (err) {
      logger.system.error('[SceneToolsDb] LoadAll failed:', err)
      return {}
    }
  })

  // 获取数据库路径
  safeIpcHandle('scene-tools-db:getPath', async () => {
    await db.ensureInitialized()
    return db.getDbPath()
  })
}
