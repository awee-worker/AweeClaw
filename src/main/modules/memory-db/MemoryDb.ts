/**
 * 记忆数据库模块（客户端本地 SQLite）
 *
 * 使用 node:sqlite (DatabaseSync) 管理客户端本地记忆数据。
 * 数据库路径: {userDataPath}/.aweeclaw/db/memory.db
 *
 * 设计原则：
 * 1. 客户端记忆优先存本地 SQLite，独立于工作区（不再随工作区切换丢失）
 * 2. 后端仅作备份，可通过 sync 机制手动拉取云端记忆到本地
 * 3. 表结构与后端 AgentMemory 模型对齐，便于同步
 *
 * 表结构：
 * - memory_entry: 记忆条目主表（含分类、层级、遗忘、空间上下文等 v3.0 字段）
 * - memory_relation: 记忆关联关系
 * - memory_classification_log: 分类日志
 * - memory_feedback: 用户反馈
 * - memory_version: 记忆版本历史
 * - memory_sync_state: 云端同步状态（记录最后同步时间、游标）
 */

import { logger } from '@shared/toolkit/LogEngine'
import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'

// ============================================
// 类型定义
// ============================================

/** 记忆条目行（对应 memory_entry 表） */
export interface MemoryEntryRow {
  id: string
  user_id: string | null
  conversation_id: string | null
  type: string // SHORT_TERM | LONG_TERM | WORKING | PERMANENT
  content: string
  summary: string | null
  importance: number
  access_count: number
  last_accessed_at: number | null
  expires_at: number | null
  created_at: number
  updated_at: number
  // v3.0 分类
  category: string | null
  subcategory: string | null
  tier: string // permanent | long_term | short_term | working
  // v3.0 分类元数据
  classification_confidence: number
  classified_by: string | null
  classified_at: number | null
  content_hash: string | null
  // v3.0 遗忘引擎
  retention_score: number
  last_reviewed_at: number | null
  review_count: number
  // v3.0 空间上下文（JSON 字符串）
  spatial_context: string | null
  // v3.0 标签（JSON 数组字符串）
  tags: string
  // v3.0 状态
  enabled: number // 0 | 1
  source: string | null
  version: number
  // 同步字段
  sync_status: string // local | synced | pending_push | pending_pull
  remote_id: string | null
  last_synced_at: number | null
}

export interface MemoryRelationRow {
  id: string
  source_memory_id: string
  target_memory_id: string
  relation_type: string
  weight: number
  created_at: number
  sync_status: string
}

export interface MemorySyncStateRow {
  key: string
  value: string
  updated_at: number
}

// ============================================
// 数据库路径
// ============================================

function getDbDir(): string {
  const userDataPath = app.getPath('userData')
  return path.join(userDataPath, '.aweeclaw', 'db')
}

function getDbPath(): string {
  return path.join(getDbDir(), 'memory.db')
}

// ============================================
// MemoryDb 类
// ============================================

export class MemoryDb {
  private db: any = null
  private dbPath: string = ''
  private static instance: MemoryDb | null = null

  private constructor() {}

  static getInstance(): MemoryDb {
    if (!MemoryDb.instance) {
      MemoryDb.instance = new MemoryDb()
    }
    return MemoryDb.instance
  }

  /** 初始化数据库：创建目录、打开连接、建表 */
  async initialize(): Promise<void> {
    if (this.db) {
      logger.agent.info('[MemoryDb] Already initialized, skipping')
      return
    }

    this.dbPath = getDbPath()
    const dbDir = getDbDir()

    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true })
    }

    try {
      const { DatabaseSync } = await import('node:sqlite')
      this.db = new DatabaseSync(this.dbPath, { open: true })
      this.db.exec('PRAGMA journal_mode=WAL')
      this.db.exec('PRAGMA foreign_keys=ON')
      this.db.exec('PRAGMA busy_timeout=5000')

      this.createTables()
      this.migrateSchema()

      logger.agent.info(`[MemoryDb] Initialized at ${this.dbPath}`)
    } catch (err) {
      logger.agent.error('[MemoryDb] Failed to initialize:', err)
      throw err
    }
  }

  /** 关闭数据库连接 */
  close(): void {
    if (this.db) {
      try {
        this.db.close()
        this.db = null
        logger.agent.info('[MemoryDb] Closed')
      } catch (err) {
        logger.agent.error('[MemoryDb] Failed to close:', err)
      }
    }
  }

  /** 获取数据库路径 */
  getDbPath(): string {
    return this.dbPath
  }

  // ============================================
  // 建表
  // ============================================

  private createTables(): void {
    // 记忆条目主表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_entry (
        id                      TEXT PRIMARY KEY NOT NULL,
        user_id                 TEXT,
        conversation_id         TEXT,
        type                    TEXT NOT NULL DEFAULT 'SHORT_TERM',
        content                 TEXT NOT NULL DEFAULT '',
        summary                 TEXT,
        importance              REAL NOT NULL DEFAULT 0.5,
        access_count            INTEGER NOT NULL DEFAULT 0,
        last_accessed_at        INTEGER,
        expires_at              INTEGER,
        created_at              INTEGER NOT NULL DEFAULT 0,
        updated_at              INTEGER NOT NULL DEFAULT 0,
        category                TEXT,
        subcategory             TEXT,
        tier                    TEXT NOT NULL DEFAULT 'short_term',
        classification_confidence REAL NOT NULL DEFAULT 0,
        classified_by           TEXT,
        classified_at           INTEGER,
        content_hash            TEXT,
        retention_score         REAL NOT NULL DEFAULT 1.0,
        last_reviewed_at        INTEGER,
        review_count            INTEGER NOT NULL DEFAULT 0,
        spatial_context         TEXT,
        tags                    TEXT NOT NULL DEFAULT '[]',
        enabled                 INTEGER NOT NULL DEFAULT 1,
        source                  TEXT,
        version                 INTEGER NOT NULL DEFAULT 1,
        sync_status             TEXT NOT NULL DEFAULT 'local',
        remote_id               TEXT,
        last_synced_at          INTEGER
      )
    `)

    // 记忆关联关系表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_relation (
        id                  TEXT PRIMARY KEY NOT NULL,
        source_memory_id    TEXT NOT NULL,
        target_memory_id    TEXT NOT NULL,
        relation_type       TEXT NOT NULL,
        weight              REAL NOT NULL DEFAULT 0.5,
        created_at          INTEGER NOT NULL DEFAULT 0,
        sync_status         TEXT NOT NULL DEFAULT 'local',
        FOREIGN KEY (source_memory_id) REFERENCES memory_entry(id) ON DELETE CASCADE,
        FOREIGN KEY (target_memory_id) REFERENCES memory_entry(id) ON DELETE CASCADE
      )
    `)

    // 分类日志表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_classification_log (
        id              TEXT PRIMARY KEY NOT NULL,
        memory_id       TEXT NOT NULL,
        category        TEXT,
        subcategory     TEXT,
        classified_by   TEXT,
        confidence      REAL NOT NULL DEFAULT 0,
        success         INTEGER NOT NULL DEFAULT 1,
        error_message   TEXT,
        created_at      INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (memory_id) REFERENCES memory_entry(id) ON DELETE CASCADE
      )
    `)

    // 用户反馈表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_feedback (
        id              TEXT PRIMARY KEY NOT NULL,
        memory_id       TEXT NOT NULL,
        feedback_type   TEXT NOT NULL,
        comment         TEXT,
        created_at      INTEGER NOT NULL DEFAULT 0,
        sync_status     TEXT NOT NULL DEFAULT 'local',
        FOREIGN KEY (memory_id) REFERENCES memory_entry(id) ON DELETE CASCADE
      )
    `)

    // 版本历史表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_version (
        id              TEXT PRIMARY KEY NOT NULL,
        memory_id       TEXT NOT NULL,
        version         INTEGER NOT NULL,
        content         TEXT NOT NULL,
        change_type     TEXT,
        changed_by      TEXT,
        created_at      INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (memory_id) REFERENCES memory_entry(id) ON DELETE CASCADE
      )
    `)

    // 同步状态表（键值对）
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_sync_state (
        key         TEXT PRIMARY KEY NOT NULL,
        value       TEXT NOT NULL DEFAULT '',
        updated_at  INTEGER NOT NULL DEFAULT 0
      )
    `)

    // Schema 版本
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        key   TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL DEFAULT ''
      )
    `)

    // 索引
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_memory_entry_user_id ON memory_entry (user_id)
    `)
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_memory_entry_created_at ON memory_entry (created_at DESC)
    `)
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_memory_entry_tier ON memory_entry (tier)
    `)
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_memory_entry_category ON memory_entry (category)
    `)
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_memory_entry_enabled ON memory_entry (enabled)
    `)
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_memory_entry_sync_status ON memory_entry (sync_status)
    `)
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_memory_relation_source ON memory_relation (source_memory_id)
    `)
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_memory_relation_target ON memory_relation (target_memory_id)
    `)
  }

  /** Schema 迁移 */
  private migrateSchema(): void {
    const existingVersion = this.db.prepare("SELECT value FROM schema_version WHERE key = 'version'").get() as any
    const version = existingVersion ? parseInt(existingVersion.value, 10) : 0

    if (version < 1) {
      this.db.prepare("INSERT OR REPLACE INTO schema_version (key, value) VALUES ('version', '1')").run()
      logger.agent.info('[MemoryDb] Schema initialized to v1')
    }
  }

  // ============================================
  // 记忆条目 CRUD
  // ============================================

  /** 插入或更新记忆条目 */
  upsertEntry(entry: Partial<MemoryEntryRow> & { id: string }): void {
    const now = Date.now()
    this.db.prepare(`
      INSERT INTO memory_entry (
        id, user_id, conversation_id, type, content, summary, importance,
        access_count, last_accessed_at, expires_at, created_at, updated_at,
        category, subcategory, tier, classification_confidence, classified_by,
        classified_at, content_hash, retention_score, last_reviewed_at, review_count,
        spatial_context, tags, enabled, source, version, sync_status, remote_id, last_synced_at
      ) VALUES (
        @id, @user_id, @conversation_id, @type, @content, @summary, @importance,
        @access_count, @last_accessed_at, @expires_at, @created_at, @updated_at,
        @category, @subcategory, @tier, @classification_confidence, @classified_by,
        @classified_at, @content_hash, @retention_score, @last_reviewed_at, @review_count,
        @spatial_context, @tags, @enabled, @source, @version, @sync_status, @remote_id, @last_synced_at
      )
      ON CONFLICT(id) DO UPDATE SET
        user_id = @user_id,
        conversation_id = @conversation_id,
        type = @type,
        content = @content,
        summary = @summary,
        importance = @importance,
        access_count = @access_count,
        last_accessed_at = @last_accessed_at,
        expires_at = @expires_at,
        updated_at = @updated_at,
        category = @category,
        subcategory = @subcategory,
        tier = @tier,
        classification_confidence = @classification_confidence,
        classified_by = @classified_by,
        classified_at = @classified_at,
        content_hash = @content_hash,
        retention_score = @retention_score,
        last_reviewed_at = @last_reviewed_at,
        review_count = @review_count,
        spatial_context = @spatial_context,
        tags = @tags,
        enabled = @enabled,
        source = @source,
        version = @version,
        sync_status = @sync_status,
        remote_id = @remote_id,
        last_synced_at = @last_synced_at
    `).run({
      id: entry.id,
      user_id: entry.user_id ?? null,
      conversation_id: entry.conversation_id ?? null,
      type: entry.type ?? 'SHORT_TERM',
      content: entry.content ?? '',
      summary: entry.summary ?? null,
      importance: entry.importance ?? 0.5,
      access_count: entry.access_count ?? 0,
      last_accessed_at: entry.last_accessed_at ?? null,
      expires_at: entry.expires_at ?? null,
      created_at: entry.created_at ?? now,
      updated_at: entry.updated_at ?? now,
      category: entry.category ?? null,
      subcategory: entry.subcategory ?? null,
      tier: entry.tier ?? 'short_term',
      classification_confidence: entry.classification_confidence ?? 0,
      classified_by: entry.classified_by ?? null,
      classified_at: entry.classified_at ?? null,
      content_hash: entry.content_hash ?? null,
      retention_score: entry.retention_score ?? 1.0,
      last_reviewed_at: entry.last_reviewed_at ?? null,
      review_count: entry.review_count ?? 0,
      spatial_context: entry.spatial_context ?? null,
      tags: entry.tags ?? '[]',
      enabled: entry.enabled ?? 1,
      source: entry.source ?? null,
      version: entry.version ?? 1,
      sync_status: entry.sync_status ?? 'local',
      remote_id: entry.remote_id ?? null,
      last_synced_at: entry.last_synced_at ?? null,
    })
  }

  /** 批量插入记忆条目（事务） */
  batchUpsertEntries(entries: Array<Partial<MemoryEntryRow> & { id: string }>): void {
    if (entries.length === 0) return
    this.db.prepare('BEGIN TRANSACTION').run()
    try {
      for (const entry of entries) {
        this.upsertEntry(entry)
      }
      this.db.prepare('COMMIT').run()
    } catch (err) {
      this.db.prepare('ROLLBACK').run()
      throw err
    }
  }

  /** 根据 ID 获取记忆 */
  getEntryById(id: string): MemoryEntryRow | null {
    const row = this.db.prepare('SELECT * FROM memory_entry WHERE id = ?').get(id) as MemoryEntryRow | undefined
    return row ?? null
  }

  /** 获取记忆列表（支持筛选、排序、分页） */
  queryEntries(options: {
    userId?: string | null
    category?: string
    categories?: string[]
    tier?: string
    tiers?: string[]
    type?: string
    keyword?: string
    tags?: string[]
    dateFrom?: number
    dateTo?: number
    minImportance?: number
    maxImportance?: number
    enabledOnly?: boolean
    sortBy?: string
    sortOrder?: 'asc' | 'desc'
    limit?: number
    offset?: number
  } = {}): { items: MemoryEntryRow[]; total: number } {
    const where: string[] = []
    const params: any[] = []

    if (options.userId !== undefined) {
      where.push('user_id = ?')
      params.push(options.userId)
    }
    // 单分类（向后兼容）
    if (options.category) {
      where.push('category = ?')
      params.push(options.category)
    }
    // 多分类（下沉到 SQL）
    if (options.categories && options.categories.length > 0) {
      const placeholders = options.categories.map(() => '?').join(',')
      where.push(`category IN (${placeholders})`)
      params.push(...options.categories)
    }
    // 单层级
    if (options.tier) {
      where.push('tier = ?')
      params.push(options.tier)
    }
    // 多层级（下沉到 SQL）
    if (options.tiers && options.tiers.length > 0) {
      const placeholders = options.tiers.map(() => '?').join(',')
      where.push(`tier IN (${placeholders})`)
      params.push(...options.tiers)
    }
    if (options.type) {
      where.push('type = ?')
      params.push(options.type)
    }
    if (options.keyword) {
      where.push('(content LIKE ? OR summary LIKE ?)')
      params.push(`%${options.keyword}%`, `%${options.keyword}%`)
    }
    // 多标签（JSON 数组 LIKE 匹配）
    if (options.tags && options.tags.length > 0) {
      const tagClauses = options.tags.map(() => 'tags LIKE ?').join(' OR ')
      where.push(`(${tagClauses})`)
      options.tags.forEach((t) => params.push(`%"${t}"%`))
    }
    // 日期范围
    if (options.dateFrom !== undefined) {
      where.push('created_at >= ?')
      params.push(options.dateFrom)
    }
    if (options.dateTo !== undefined) {
      where.push('created_at <= ?')
      params.push(options.dateTo)
    }
    // 重要性范围
    if (options.minImportance !== undefined) {
      where.push('importance >= ?')
      params.push(options.minImportance)
    }
    if (options.maxImportance !== undefined) {
      where.push('importance <= ?')
      params.push(options.maxImportance)
    }
    if (options.enabledOnly) {
      where.push('enabled = 1')
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
    const allowedSortFields = ['created_at', 'updated_at', 'importance', 'retention_score', 'last_reviewed_at']
    const sortField = allowedSortFields.includes(options.sortBy ?? '') ? options.sortBy! : 'created_at'
    const sortOrder = options.sortOrder === 'asc' ? 'ASC' : 'DESC'
    const limit = Math.min(options.limit ?? 20, 100)
    const offset = options.offset ?? 0

    const items = this.db.prepare(
      `SELECT * FROM memory_entry ${whereClause} ORDER BY ${sortField} ${sortOrder} LIMIT ? OFFSET ?`
    ).all(...params, limit, offset) as MemoryEntryRow[]

    const totalRow = this.db.prepare(
      `SELECT COUNT(*) as count FROM memory_entry ${whereClause}`
    ).get(...params) as { count: number }

    return { items, total: totalRow.count }
  }

  /** 更新记忆条目（部分字段） */
  updateEntry(id: string, updates: Partial<MemoryEntryRow>): boolean {
    const allowedFields: Array<keyof MemoryEntryRow> = [
      'content', 'summary', 'importance', 'access_count', 'last_accessed_at',
      'expires_at', 'category', 'subcategory', 'tier', 'classification_confidence',
      'classified_by', 'classified_at', 'content_hash', 'retention_score',
      'last_reviewed_at', 'review_count', 'spatial_context', 'tags', 'enabled',
      'source', 'version', 'sync_status', 'remote_id', 'last_synced_at',
      'user_id', 'conversation_id', 'type',
    ]

    const setClauses: string[] = []
    const params: any[] = []
    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        setClauses.push(`${field} = ?`)
        params.push(updates[field])
      }
    }

    if (setClauses.length === 0) return false

    setClauses.push('updated_at = ?')
    params.push(Date.now())
    params.push(id)

    const result = this.db.prepare(
      `UPDATE memory_entry SET ${setClauses.join(', ')} WHERE id = ?`
    ).run(...params)
    return result.changes > 0
  }

  /** 删除记忆条目 */
  deleteEntry(id: string): boolean {
    const result = this.db.prepare('DELETE FROM memory_entry WHERE id = ?').run(id)
    return result.changes > 0
  }

  /** 软删除（标记为禁用） */
  softDeleteEntry(id: string): boolean {
    return this.updateEntry(id, { enabled: 0 })
  }

  /** 清空所有记忆（危险操作） */
  clearAll(userId?: string | null): number {
    if (userId !== undefined) {
      const result = this.db.prepare('DELETE FROM memory_entry WHERE user_id = ?').run(userId)
      return result.changes
    }
    const result = this.db.prepare('DELETE FROM memory_entry').run()
    return result.changes
  }

  /** 获取记忆统计 */
  getStats(userId?: string | null): {
    total: number
    enabled: number
    byTier: Record<string, number>
    byCategory: Record<string, number>
  } {
    const where = userId !== undefined ? 'WHERE user_id = ?' : ''
    const params = userId !== undefined ? [userId] : []

    const totalRow = this.db.prepare(
      `SELECT COUNT(*) as count FROM memory_entry ${where}`
    ).get(...params) as { count: number }

    const enabledRow = this.db.prepare(
      `SELECT COUNT(*) as count FROM memory_entry ${where} ${where ? 'AND' : 'WHERE'} enabled = 1`
    ).get(...params) as { count: number }

    const tierRows = this.db.prepare(
      `SELECT tier, COUNT(*) as count FROM memory_entry ${where} GROUP BY tier`
    ).all(...params) as Array<{ tier: string; count: number }>

    const categoryRows = this.db.prepare(
      `SELECT category, COUNT(*) as count FROM memory_entry ${where} GROUP BY category`
    ).all(...params) as Array<{ category: string | null; count: number }>

    const byTier: Record<string, number> = {}
    for (const row of tierRows) byTier[row.tier] = row.count

    const byCategory: Record<string, number> = {}
    for (const row of categoryRows) {
      const key = row.category ?? 'UNCATEGORIZED'
      byCategory[key] = (byCategory[key] ?? 0) + row.count
    }

    return {
      total: totalRow.count,
      enabled: enabledRow.count,
      byTier,
      byCategory,
    }
  }

  /**
   * 获取记忆概览统计（用于统计面板）
   * 返回分类分布、层级分布、近期增长、热门标签
   */
  getOverview(userId?: string | null): {
    total: number
    active: number
    forgotten: number
    byCategory: Array<{ category: string; count: number; avgImportance: number }>
    byTier: Array<{ tier: string; count: number; avgRetention: number }>
    recentGrowth: Array<{ date: string; count: number }>
    topTags: Array<{ tag: string; count: number }>
  } {
    const where = userId !== undefined ? 'WHERE user_id = ?' : ''
    const params = userId !== undefined ? [userId] : []

    const totalRow = this.db.prepare(
      `SELECT COUNT(*) as count FROM memory_entry ${where}`
    ).get(...params) as { count: number }

    const activeRow = this.db.prepare(
      `SELECT COUNT(*) as count FROM memory_entry ${where} ${where ? 'AND' : 'WHERE'} enabled = 1`
    ).get(...params) as { count: number }

    const forgottenRow = this.db.prepare(
      `SELECT COUNT(*) as count FROM memory_entry ${where} ${where ? 'AND' : 'WHERE'} enabled = 0`
    ).get(...params) as { count: number }

    // 分类分布
    const categoryRows = this.db.prepare(
      `SELECT category, COUNT(*) as count, AVG(importance) as avg_importance
       FROM memory_entry ${where}
       GROUP BY category
       ORDER BY count DESC`
    ).all(...params) as Array<{ category: string | null; count: number; avg_importance: number }>

    // 层级分布
    const tierRows = this.db.prepare(
      `SELECT tier, COUNT(*) as count, AVG(retention_score) as avg_retention
       FROM memory_entry ${where}
       GROUP BY tier`
    ).all(...params) as Array<{ tier: string; count: number; avg_retention: number }>

    // 近 7 天增长
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    const growthRows = this.db.prepare(
      `SELECT DATE(created_at/1000, 'unixepoch', 'localtime') as date, COUNT(*) as count
       FROM memory_entry ${where} ${where ? 'AND' : 'WHERE'} created_at >= ?
       GROUP BY date ORDER BY date ASC`
    ).all(...params, sevenDaysAgo) as Array<{ date: string; count: number }>

    // 热门标签（需要解析 JSON 数组）
    const allTagsRows = this.db.prepare(
      `SELECT tags FROM memory_entry ${where} ${where ? 'AND' : 'WHERE'} tags != '[]' AND tags IS NOT NULL`
    ).all(...params) as Array<{ tags: string }>

    const tagCount: Record<string, number> = {}
    for (const row of allTagsRows) {
      try {
        const tags = JSON.parse(row.tags || '[]') as string[]
        for (const tag of tags) {
          tagCount[tag] = (tagCount[tag] || 0) + 1
        }
      } catch {
        // 忽略解析错误
      }
    }
    const topTags = Object.entries(tagCount)
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)

    return {
      total: totalRow.count,
      active: activeRow.count,
      forgotten: forgottenRow.count,
      byCategory: categoryRows.map((r) => ({
        category: r.category ?? 'UNCATEGORIZED',
        count: r.count,
        avgImportance: r.avg_importance ?? 0,
      })),
      byTier: tierRows.map((r) => ({
        tier: r.tier,
        count: r.count,
        avgRetention: r.avg_retention ?? 0,
      })),
      recentGrowth: growthRows,
      topTags,
    }
  }

  /**
   * 获取可视化数据（用于 3D 图谱/网络图）
   * 返回节点（记忆）和边（关联关系）
   */
  getVisualizationData(options: {
    userId?: string | null
    limit?: number
    category?: string
    tier?: string
    minImportance?: number
  } = {}): {
    nodes: Array<{
      id: string
      label: string
      category: string
      tier: string
      importance: number
      retentionScore: number
      createdAt: number
    }>
    edges: Array<{
      id: string
      source: string
      target: string
      type: string
      weight: number
    }>
    meta: {
      total: number
      byCategory: Record<string, number>
      byTier: Record<string, number>
      avgImportance: number
      avgRetention: number
    }
  } {
    const where: string[] = []
    const params: any[] = []

    if (options.userId !== undefined) {
      where.push('user_id = ?')
      params.push(options.userId)
    }
    if (options.category) {
      where.push('category = ?')
      params.push(options.category)
    }
    if (options.tier) {
      where.push('tier = ?')
      params.push(options.tier)
    }
    if (options.minImportance !== undefined) {
      where.push('importance >= ?')
      params.push(options.minImportance)
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
    const limit = Math.min(options.limit ?? 200, 500)

    // 智能采样：按 importance + 时间衰减 + retention_score 综合评分
    // 评分公式：importance * 0.5 + retention_score * 0.3 + 时间衰减 * 0.2
    // 时间衰减：最近 7 天 = 1.0，30 天 = 0.7，90 天 = 0.4，更早 = 0.2
    // 这样保证：重要记忆优先、近期记忆优先、未遗忘记忆优先
    const now = Date.now()
    const rows = this.db.prepare(
      `SELECT id, content, summary, category, tier, importance, retention_score, created_at,
        (
          importance * 0.5 +
          retention_score * 0.3 +
          CASE
            WHEN created_at >= ? THEN 0.2
            WHEN created_at >= ? THEN 0.14
            WHEN created_at >= ? THEN 0.08
            ELSE 0.04
          END
        ) AS sample_score
       FROM memory_entry ${whereClause}
       ORDER BY sample_score DESC
       LIMIT ?`
    ).all(
      now - 7 * 86400000,
      now - 30 * 86400000,
      now - 90 * 86400000,
      ...params,
      limit,
    ) as Array<{
      id: string
      content: string
      summary: string | null
      category: string | null
      tier: string
      importance: number
      retention_score: number
      created_at: number
      sample_score: number
    }>

    const nodes = rows.map((r) => ({
      id: r.id,
      label: r.summary || r.content.slice(0, 30),
      category: r.category ?? 'UNCATEGORIZED',
      tier: r.tier,
      importance: r.importance,
      retentionScore: r.retention_score,
      createdAt: r.created_at,
    }))

    // 获取这些记忆之间的关联关系
    const nodeIds = nodes.map((n) => n.id)
    let edges: Array<{
      id: string
      source: string
      target: string
      type: string
      weight: number
    }> = []

    if (nodeIds.length > 0) {
      const placeholders = nodeIds.map(() => '?').join(',')
      const relRows = this.db.prepare(
        `SELECT id, source_memory_id, target_memory_id, relation_type, weight
         FROM memory_relation
         WHERE source_memory_id IN (${placeholders}) OR target_memory_id IN (${placeholders})`
      ).all(...nodeIds, ...nodeIds) as Array<{
        id: string
        source_memory_id: string
        target_memory_id: string
        relation_type: string
        weight: number
      }>

      const nodeIdSet = new Set(nodeIds)
      edges = relRows
        .filter((r) => nodeIdSet.has(r.source_memory_id) && nodeIdSet.has(r.target_memory_id))
        .map((r) => ({
          id: r.id,
          source: r.source_memory_id,
          target: r.target_memory_id,
          type: r.relation_type,
          weight: r.weight,
        }))
    }

    // 计算元数据
    const byCategory: Record<string, number> = {}
    const byTier: Record<string, number> = {}
    let importanceSum = 0
    let retentionSum = 0
    for (const node of nodes) {
      byCategory[node.category] = (byCategory[node.category] || 0) + 1
      byTier[node.tier] = (byTier[node.tier] || 0) + 1
      importanceSum += node.importance
      retentionSum += node.retentionScore
    }

    return {
      nodes,
      edges,
      meta: {
        total: nodes.length,
        byCategory,
        byTier,
        avgImportance: nodes.length > 0 ? importanceSum / nodes.length : 0,
        avgRetention: nodes.length > 0 ? retentionSum / nodes.length : 0,
      },
    }
  }

  /**
   * 获取时间轴数据（按创建时间排序的记忆列表）
   */
  getTimeline(options: {
    userId?: string | null
    limit?: number
    category?: string
    tier?: string
  } = {}): Array<{
    id: string
    content: string
    summary: string | null
    category: string | null
    tier: string
    importance: number
    created_at: number
  }> {
    const where: string[] = []
    const params: any[] = []

    if (options.userId !== undefined) {
      where.push('user_id = ?')
      params.push(options.userId)
    }
    if (options.category) {
      where.push('category = ?')
      params.push(options.category)
    }
    if (options.tier) {
      where.push('tier = ?')
      params.push(options.tier)
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
    const limit = Math.min(options.limit ?? 50, 200)

    return this.db.prepare(
      `SELECT id, content, summary, category, tier, importance, created_at
       FROM memory_entry ${whereClause}
       ORDER BY created_at DESC
       LIMIT ?`
    ).all(...params, limit) as Array<{
      id: string
      content: string
      summary: string | null
      category: string | null
      tier: string
      importance: number
      created_at: number
    }>
  }

  /**
   * 按月分页获取时间轴数据
   * - 传入 year/month 加载该月数据
   * - 不传 year/month 时加载最近一个月
   * - 返回该月所有记忆 + 该月总数 + 上一月/下一月是否存在
   *
   * 性能：created_at 已有索引，按月范围查询 O(log n)，几十万数据无压力
   */
  getTimelineByMonth(options: {
    userId?: string | null
    year?: number
    month?: number  // 1-12
    category?: string
    limit?: number
  } = {}): {
    items: Array<{
      id: string
      content: string
      summary: string | null
      category: string | null
      tier: string
      importance: number
      created_at: number
    }>
    monthTotal: number
    hasPrev: boolean
    hasNext: boolean
    year: number
    month: number
  } {
    const now = new Date()
    let year = options.year ?? now.getFullYear()
    let month = options.month ?? now.getMonth() + 1

    // 计算该月起止时间戳
    const start = new Date(year, month - 1, 1, 0, 0, 0, 0).getTime()
    const end = new Date(year, month, 1, 0, 0, 0, 0).getTime()  // 下月1号 = 本月结束+1ms

    const where: string[] = ['created_at >= ?', 'created_at < ?']
    const params: any[] = [start, end]

    if (options.userId !== undefined) {
      where.push('user_id = ?')
      params.push(options.userId)
    }
    if (options.category) {
      where.push('category = ?')
      params.push(options.category)
    }

    const whereClause = `WHERE ${where.join(' AND ')}`
    const limit = Math.min(options.limit ?? 500, 1000)

    const items = this.db.prepare(
      `SELECT id, content, summary, category, tier, importance, created_at
       FROM memory_entry ${whereClause}
       ORDER BY created_at DESC
       LIMIT ?`
    ).all(...params, limit) as Array<{
      id: string
      content: string
      summary: string | null
      category: string | null
      tier: string
      importance: number
      created_at: number
    }>

    const totalRow = this.db.prepare(
      `SELECT COUNT(*) as count FROM memory_entry ${whereClause}`
    ).get(...params) as { count: number }

    // 上一月（更早）：是否存在 created_at < start 的记录
    const prevParams: any[] = []
    const prevWhere: string[] = ['created_at < ?']
    prevParams.push(start)
    if (options.userId !== undefined) {
      prevWhere.push('user_id = ?')
      prevParams.push(options.userId)
    }
    if (options.category) {
      prevWhere.push('category = ?')
      prevParams.push(options.category)
    }
    const prevRow = this.db.prepare(
      `SELECT 1 FROM memory_entry WHERE ${prevWhere.join(' AND ')} LIMIT 1`
    ).get(...prevParams)

    // 下一月（更新）：是否存在 created_at >= end 的记录
    const nextParams: any[] = []
    const nextWhere: string[] = ['created_at >= ?']
    nextParams.push(end)
    if (options.userId !== undefined) {
      nextWhere.push('user_id = ?')
      nextParams.push(options.userId)
    }
    if (options.category) {
      nextWhere.push('category = ?')
      nextParams.push(options.category)
    }
    const nextRow = this.db.prepare(
      `SELECT 1 FROM memory_entry WHERE ${nextWhere.join(' AND ')} LIMIT 1`
    ).get(...nextParams)

    return {
      items,
      monthTotal: totalRow.count,
      hasPrev: !!prevRow,
      hasNext: !!nextRow,
      year,
      month,
    }
  }

  /**
   * 获取所有有记忆的月份列表（用于时间轴快速跳转）
   */
  getTimelineMonths(options: {
    userId?: string | null
    category?: string
  } = {}): Array<{ year: number; month: number; count: number }> {
    const where: string[] = ['enabled = 1']
    const params: any[] = []

    if (options.userId !== undefined) {
      where.push('user_id = ?')
      params.push(options.userId)
    }
    if (options.category) {
      where.push('category = ?')
      params.push(options.category)
    }

    const whereClause = `WHERE ${where.join(' AND ')}`

    const rows = this.db.prepare(
      `SELECT
        (created_at / 86400000) AS day_key,
        COUNT(*) as count
       FROM memory_entry ${whereClause}
       GROUP BY day_key
       ORDER BY day_key DESC`
    ).all(...params) as Array<{ day_key: number; count: number }>

    // 按月聚合
    const monthMap = new Map<string, { year: number; month: number; count: number }>()
    rows.forEach((r) => {
      const date = new Date(r.day_key * 86400000)
      const year = date.getFullYear()
      const month = date.getMonth() + 1
      const key = `${year}-${month}`
      const existing = monthMap.get(key)
      if (existing) {
        existing.count += r.count
      } else {
        monthMap.set(key, { year, month, count: r.count })
      }
    })

    return Array.from(monthMap.values()).sort((a, b) => {
      if (a.year !== b.year) return b.year - a.year
      return b.month - a.month
    })
  }

  // ============================================
  // 关联关系 CRUD
  // ============================================

  upsertRelation(rel: Partial<MemoryRelationRow> & { id: string }): void {
    const now = Date.now()
    this.db.prepare(`
      INSERT INTO memory_relation (id, source_memory_id, target_memory_id, relation_type, weight, created_at, sync_status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        source_memory_id = excluded.source_memory_id,
        target_memory_id = excluded.target_memory_id,
        relation_type = excluded.relation_type,
        weight = excluded.weight,
        sync_status = excluded.sync_status
    `).run(
      rel.id,
      rel.source_memory_id ?? '',
      rel.target_memory_id ?? '',
      rel.relation_type ?? '',
      rel.weight ?? 0.5,
      rel.created_at ?? now,
      rel.sync_status ?? 'local',
    )
  }

  getRelationsByMemoryId(memoryId: string): MemoryRelationRow[] {
    return this.db.prepare(
      'SELECT * FROM memory_relation WHERE source_memory_id = ? OR target_memory_id = ?'
    ).all(memoryId, memoryId) as MemoryRelationRow[]
  }

  deleteRelation(id: string): boolean {
    const result = this.db.prepare('DELETE FROM memory_relation WHERE id = ?').run(id)
    return result.changes > 0
  }

  // ============================================
  // 同步状态管理
  // ============================================

  /** 获取同步状态值 */
  getSyncState(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM memory_sync_state WHERE key = ?').get(key) as { value: string } | undefined
    return row?.value ?? null
  }

  /** 设置同步状态值 */
  setSyncState(key: string, value: string): void {
    this.db.prepare(`
      INSERT INTO memory_sync_state (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, value, Date.now())
  }

  /** 获取待推送的记忆（sync_status = pending_push） */
  getPendingPushEntries(limit = 100): MemoryEntryRow[] {
    return this.db.prepare(
      'SELECT * FROM memory_entry WHERE sync_status = ? LIMIT ?'
    ).all('pending_push', limit) as MemoryEntryRow[]
  }

  /** 标记记忆为已同步 */
  markAsSynced(id: string, remoteId: string): void {
    this.db.prepare(
      'UPDATE memory_entry SET sync_status = ?, remote_id = ?, last_synced_at = ? WHERE id = ?'
    ).run('synced', remoteId, Date.now(), id)
  }

  // ============================================
  // JSON 迁移（从旧 JSON 文件迁移数据）
  // ============================================

  /**
   * 从旧 JSON store 迁移数据到 SQLite
   * 兼容 longTermMemoryService 的 MemoryStore 结构
   */
  migrateFromJsonStore(store: {
    version?: number
    shortTerm?: Array<Record<string, any>>
    longTerm?: Array<Record<string, any>>
    forgotten?: Array<Record<string, any>>
  }): { migrated: number; skipped: number } {
    let migrated = 0
    let skipped = 0
    const now = Date.now()

    // 合并三个列表，打上层级和类型标记
    const allEntries: Array<Record<string, any> & { _tier: string; _type: string; _enabled?: boolean }> = [
      ...(store.shortTerm ?? []).map(e => ({ ...e, _tier: 'short_term', _type: 'SHORT_TERM' })),
      ...(store.longTerm ?? []).map(e => ({ ...e, _tier: 'long_term', _type: 'LONG_TERM' })),
      ...(store.forgotten ?? []).map(e => ({ ...e, _tier: 'short_term', _type: 'SHORT_TERM', _enabled: false })),
    ]

    if (allEntries.length === 0) {
      return { migrated: 0, skipped: 0 }
    }

    this.db.prepare('BEGIN TRANSACTION').run()
    try {
      for (const entry of allEntries) {
        if (!entry.id || !entry.content) {
          skipped++
          continue
        }

        // 检查是否已存在
        const existing = this.getEntryById(entry.id)
        if (existing) {
          skipped++
          continue
        }

        this.upsertEntry({
          id: entry.id,
          user_id: null, // 旧数据无 user_id
          conversation_id: entry.originalSessionId ?? null,
          type: entry._type,
          content: entry.content,
          summary: null,
          importance: entry.confidence ?? 0.7,
          access_count: entry.recallCount ?? 0,
          last_accessed_at: entry.lastRecalledAt ?? null,
          expires_at: entry.expiresAt ?? null,
          created_at: entry.createdAt ?? now,
          updated_at: entry.updatedAt ?? now,
          category: null,
          subcategory: null,
          tier: entry._tier,
          classification_confidence: 0,
          classified_by: null,
          classified_at: null,
          content_hash: null,
          retention_score: 1.0,
          last_reviewed_at: null,
          review_count: 0,
          spatial_context: null,
          tags: JSON.stringify(entry.tags ?? []),
          enabled: entry._enabled !== false ? 1 : 0,
          source: entry.source ?? null,
          version: 1,
          sync_status: 'local',
          remote_id: null,
          last_synced_at: null,
        })
        migrated++
      }
      this.db.prepare('COMMIT').run()
    } catch (err) {
      this.db.prepare('ROLLBACK').run()
      throw err
    }

    logger.agent.info(`[MemoryDb] Migrated ${migrated} entries from JSON store, skipped ${skipped}`)
    return { migrated, skipped }
  }
}
