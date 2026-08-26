/**
 * 场景工具数据库模块
 *
 * 使用 node:sqlite (DatabaseSync) 持久化场景模式内置工具（待办/工时/账本/闪卡等）的数据。
 * 数据库路径: {userDataPath}/.aweeclaw/db/scene-tools.db
 *
 * 设计原则:
 * - 所有场景工具共用一个 SQLite 数据库文件
 * - 每个工具对应一个 key（与渲染进程 zustand persist 的 name 一致，如 `scene-tools:work-todo`），
 *   value 为 JSON 字符串，与原有 localStorage 序列化格式完全兼容，可无缝迁移
 * - 采用 WAL + busy_timeout，保证多窗口并发读写安全
 */

import { logger } from '@shared/toolkit/LogEngine'
import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import type { DatabaseSync } from 'node:sqlite'

// ============================================
// 类型定义
// ============================================

export interface SceneToolsRow {
  key: string
  value: string
  updated_at: number
}

// ============================================
// 数据库路径
// ============================================

function getDbDir(): string {
  return path.join(app.getPath('userData'), '.aweeclaw', 'db')
}

function getDbPath(): string {
  return path.join(getDbDir(), 'scene-tools.db')
}

// ============================================
// SceneToolsDb 单例
// ============================================

export class SceneToolsDb {
  private static instance: SceneToolsDb | null = null
  private db: DatabaseSync | null = null
  private dbPath = ''
  private initPromise: Promise<void> | null = null

  static getInstance(): SceneToolsDb {
    if (!SceneToolsDb.instance) {
      SceneToolsDb.instance = new SceneToolsDb()
    }
    return SceneToolsDb.instance
  }

  /** 当前数据库是否已初始化 */
  isReady(): boolean {
    return this.db !== null
  }

  /**
   * 懒初始化（幂等）：IPC handler 调用前确保数据库就绪。
   * 并发调用共享同一个初始化 Promise，避免重复建表。
   */
  ensureInitialized(): Promise<void> {
    if (this.db) return Promise.resolve()
    if (!this.initPromise) {
      this.initPromise = this.initialize().catch((err) => {
        this.initPromise = null
        throw err
      })
    }
    return this.initPromise
  }

  /** 初始化数据库（建目录 / 建表），幂等 */
  async initialize(): Promise<void> {
    if (this.db) {
      logger.system.info('[SceneToolsDb] Already initialized, skipping')
      return
    }
    try {
      const { DatabaseSync } = await import('node:sqlite')
      this.dbPath = getDbPath()
      const dbDir = path.dirname(this.dbPath)
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true })
      }
      this.db = new DatabaseSync(this.dbPath, { open: true })
      this.db.exec('PRAGMA journal_mode=WAL')
      this.db.exec('PRAGMA foreign_keys=ON')
      this.db.exec('PRAGMA busy_timeout=5000')
      this.createTables()
      logger.system.info(`[SceneToolsDb] Initialized at ${this.dbPath}`)
    } catch (err) {
      logger.system.error('[SceneToolsDb] Failed to initialize:', err)
      throw err
    }
  }

  private createTables(): void {
    if (!this.db) return
    // 通用 KV 表：key 对应渲染进程 store 名称，value 为 JSON 序列化字符串
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS scene_tools_store (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)
  }

  /** 关闭数据库（应用退出时调用） */
  close(): void {
    if (this.db) {
      try {
        this.db.close()
      } catch (err) {
        logger.system.error('[SceneToolsDb] Failed to close:', err)
      }
      this.db = null
      this.dbPath = ''
    }
  }

  /** 获取数据库文件路径 */
  getDbPath(): string {
    return this.dbPath || getDbPath()
  }

  /** 读取单个 key 的原始 JSON 字符串，不存在返回 null */
  get(key: string): string | null {
    if (!this.db) return null
    const row = this.db
      .prepare('SELECT value FROM scene_tools_store WHERE key = ?')
      .get(key) as { value: string } | undefined
    return row ? row.value : null
  }

  /** 写入（upsert）单个 key */
  set(key: string, value: string): void {
    if (!this.db) return
    this.db
      .prepare(
        `INSERT INTO scene_tools_store (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, value, Date.now())
  }

  /** 删除单个 key */
  remove(key: string): void {
    if (!this.db) return
    this.db.prepare('DELETE FROM scene_tools_store WHERE key = ?').run(key)
  }

  /** 加载全部 key -> JSON 字符串 */
  loadAll(): Record<string, string> {
    if (!this.db) return {}
    const rows = this.db
      .prepare('SELECT key, value, updated_at FROM scene_tools_store')
      .all() as unknown as SceneToolsRow[]
    const result: Record<string, string> = {}
    for (const row of rows) {
      result[row.key] = row.value
    }
    return result
  }
}
