/**
 * 会话数据库模块
 *
 * 使用 node:sqlite (DatabaseSync) 管理 Agent 会话数据。
 * 数据库路径: {userDataPath}/.aweeclaw/db/sessions.db
 *
 * 表结构：
 * - session_meta: 会话元数据（currentThreadId, threadIds, branches 等）
 * - thread_meta: 线程元数据（标题、创建时间、修改时间等）
 * - thread_message: 线程消息（每条消息独立一行，JSONL 格式存储内容）
 */

import { logger } from '@shared/toolkit/LogEngine'
import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'

// ============================================
// 类型定义
// ============================================

export interface SessionMetaRow {
  key: string
  value: string
  updated_at: number
}

export interface ThreadMetaRow {
  thread_id: string
  title: string | null
  created_at: number
  last_modified: number
  message_count: number
  user_id: string | null
  context_items: string        // JSON
  message_checkpoints: string  // JSON
  context_summary: string | null
  todos: string | null         // JSON
  handoff_context: string | null
  handoff_resume: string | null  // JSON
  pending_objective: string | null
  pending_steps: string | null  // JSON
  mode: string | null
  origin: string | null
  plan_id: string | null
  task_id: string | null
  extra: string                // JSON — 扩展字段
  created_at_db: number
  updated_at_db: number
}

export interface ThreadMessageRow {
  thread_id: string
  seq: number
  role: string
  content: string              // JSON
  created_at: number
}

// ============================================
// 数据库路径
// ============================================

function getDbDir(): string {
  const userDataPath = app.getPath('userData')
  return path.join(userDataPath, '.aweeclaw', 'db')
}

function getDbPath(): string {
  return path.join(getDbDir(), 'sessions.db')
}

// ============================================
// SessionDb 类
// ============================================

export class SessionDb {
  private db: any = null
  private dbPath: string = ''
  private static instance: SessionDb | null = null

  private constructor() {}

  static getInstance(): SessionDb {
    if (!SessionDb.instance) {
      SessionDb.instance = new SessionDb()
    }
    return SessionDb.instance
  }

  /** 初始化数据库：创建目录、打开连接、建表 */
  async initialize(): Promise<void> {
    if (this.db) {
      logger.session.info('[SessionDb] Already initialized, skipping')
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
      this.repairMessageCounts()

      logger.session.info(`[SessionDb] Initialized at ${this.dbPath}`)
    } catch (err) {
      logger.session.error('[SessionDb] Failed to initialize:', err)
      throw err
    }
  }

  /** 关闭数据库连接 */
  close(): void {
    if (this.db) {
      try {
        this.db.close()
        this.db = null
        logger.session.info('[SessionDb] Closed')
      } catch (err) {
        logger.session.error('[SessionDb] Failed to close:', err)
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
    // 会话元数据表（键值对存储全局会话状态）
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS session_meta (
        key         TEXT PRIMARY KEY NOT NULL,
        value       TEXT NOT NULL DEFAULT '',
        updated_at  INTEGER NOT NULL DEFAULT 0
      )
    `)

    // 线程元数据表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS thread_meta (
        thread_id           TEXT PRIMARY KEY NOT NULL,
        title               TEXT,
        created_at          INTEGER NOT NULL DEFAULT 0,
        last_modified       INTEGER NOT NULL DEFAULT 0,
        message_count       INTEGER NOT NULL DEFAULT 0,
        user_id             TEXT DEFAULT NULL,
        context_items       TEXT NOT NULL DEFAULT '[]',
        message_checkpoints TEXT NOT NULL DEFAULT '[]',
        context_summary     TEXT,
        todos               TEXT,
        handoff_context     TEXT,
        handoff_resume      TEXT,
        pending_objective   TEXT,
        pending_steps       TEXT,
        mode                TEXT,
        origin              TEXT,
        plan_id             TEXT,
        task_id             TEXT,
        extra               TEXT NOT NULL DEFAULT '{}',
        created_at_db       INTEGER NOT NULL DEFAULT 0,
        updated_at_db       INTEGER NOT NULL DEFAULT 0
      )
    `)

    // 线程消息表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS thread_message (
        thread_id   TEXT NOT NULL,
        seq         INTEGER NOT NULL,
        role        TEXT NOT NULL DEFAULT '',
        content     TEXT NOT NULL DEFAULT '',
        created_at  INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (thread_id, seq)
      )
    `)

    // 索引（不含 user_id，该索引在迁移后创建）
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_thread_message_thread_id
      ON thread_message (thread_id)
    `)
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_thread_meta_last_modified
      ON thread_meta (last_modified DESC)
    `)

    // Schema 版本
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        key   TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL DEFAULT ''
      )
    `)

    const existingVersion = this.db.prepare("SELECT value FROM schema_version WHERE key = 'version'").get() as any
    const version = existingVersion ? parseInt(existingVersion.value, 10) : 0

    // 迁移：v1 → v2：添加 user_id 列
    if (version < 2) {
      try {
        this.db.exec('ALTER TABLE thread_meta ADD COLUMN user_id TEXT DEFAULT NULL')
        logger.session.info('[SessionDb] Migrated schema to v2: added user_id column')
      } catch (err: any) {
        // 列已存在则忽略
        if (!err?.message?.includes('duplicate column')) {
          logger.session.warn('[SessionDb] Migration v2 failed:', err)
        }
      }
      this.db.prepare("INSERT OR REPLACE INTO schema_version (key, value) VALUES ('version', '2')").run()
    }

    // user_id 索引（迁移后创建，确保列已存在）
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_thread_meta_user_id
      ON thread_meta (user_id)
    `)
  }

  // ============================================
  // 数据修复
  // ============================================

  /**
   * 修复 message_count 不一致的线程
   * 当 thread_meta.message_count 与 thread_message 表中实际消息数量不一致时，
   * 更新 message_count 为实际消息数量。这确保线程不会被 buildEffectiveSessionMeta 过滤掉。
   */
  private repairMessageCounts(): void {
    try {
      const rows = this.db.prepare(`
        SELECT tm.thread_id, COUNT(msg.seq) as actual_count
        FROM thread_meta tm
        LEFT JOIN thread_message msg ON msg.thread_id = tm.thread_id
        GROUP BY tm.thread_id
        HAVING actual_count != tm.message_count
      `).all() as Array<{ thread_id: string; actual_count: number }>

      if (rows.length === 0) return

      for (const row of rows) {
        this.db.prepare(
          'UPDATE thread_meta SET message_count = ?, updated_at_db = ? WHERE thread_id = ?'
        ).run(row.actual_count, Date.now(), row.thread_id)
      }

      logger.session.info(`[SessionDb] Repaired message_count for ${rows.length} threads`)
    } catch (err) {
      logger.session.warn('[SessionDb] repairMessageCounts failed:', err)
    }
  }

  // ============================================
  // 会话元数据 CRUD
  // ============================================

  /** 获取所有会话元数据 */
  getAllSessionMeta(): Record<string, any> {
    const rows = this.db.prepare('SELECT * FROM session_meta').all() as SessionMetaRow[]
    const result: Record<string, any> = {}
    for (const row of rows) {
      try {
        result[row.key] = JSON.parse(row.value)
      } catch {
        result[row.key] = row.value
      }
    }
    return result
  }

  /** 获取单个会话元数据 */
  getSessionMeta(key: string): any | null {
    const row = this.db.prepare('SELECT * FROM session_meta WHERE key = ?').get(key) as SessionMetaRow | undefined
    if (!row) return null
    try {
      return JSON.parse(row.value)
    } catch {
      return row.value
    }
  }

  /** 保存/更新会话元数据 */
  upsertSessionMeta(key: string, value: any): void {
    const now = Date.now()
    const jsonValue = typeof value === 'string' ? value : JSON.stringify(value)
    const existing = this.db.prepare('SELECT key FROM session_meta WHERE key = ?').get(key) as any

    if (existing) {
      this.db.prepare('UPDATE session_meta SET value = ?, updated_at = ? WHERE key = ?').run(jsonValue, now, key)
    } else {
      this.db.prepare('INSERT INTO session_meta (key, value, updated_at) VALUES (?, ?, ?)').run(key, jsonValue, now)
    }
  }

  /** 批量保存会话元数据（事务） */
  batchUpsertSessionMeta(meta: Record<string, any>): void {
    const tx = this.db.prepare('BEGIN TRANSACTION')
    try {
      tx.run()
      for (const [key, value] of Object.entries(meta)) {
        this.upsertSessionMeta(key, value)
      }
      this.db.prepare('COMMIT').run()
    } catch (err) {
      this.db.prepare('ROLLBACK').run()
      logger.session.error('[SessionDb] batchUpsertSessionMeta failed:', err)
      throw err
    }
  }

  /** 删除会话元数据 */
  deleteSessionMeta(key: string): void {
    this.db.prepare('DELETE FROM session_meta WHERE key = ?').run(key)
  }

  // ============================================
  // 线程元数据 CRUD
  // ============================================

  /** 获取所有线程摘要 */
  /**
   * 获取所有线程摘要
   * @param userId 用户 ID。传入字符串时按该用户过滤；传入 null 时返回 user_id IS NULL 的线程；不传时返回所有线程
   */
  getAllThreadSummaries(userId?: string | null): Array<{ id: string; title: string | null; lastModified: number; messageCount: number; userId: string | null }> {
    let rows: any[]
    if (userId === undefined) {
      // 不传：返回所有线程
      rows = this.db.prepare(
        'SELECT thread_id, title, last_modified, message_count, user_id FROM thread_meta ORDER BY last_modified DESC'
      ).all() as any[]
    } else if (userId === null) {
      // null：返回未登录用户的线程
      rows = this.db.prepare(
        'SELECT thread_id, title, last_modified, message_count, user_id FROM thread_meta WHERE user_id IS NULL ORDER BY last_modified DESC'
      ).all() as any[]
    } else {
      // 字符串：返回指定用户的线程
      rows = this.db.prepare(
        'SELECT thread_id, title, last_modified, message_count, user_id FROM thread_meta WHERE user_id = ? ORDER BY last_modified DESC'
      ).all(userId) as any[]
    }

    // 批量修复缺少标题的线程
    const repairStmt = this.db.prepare('UPDATE thread_meta SET title = ?, updated_at_db = ? WHERE thread_id = ?')
    for (const row of rows) {
      if (!row.title && row.message_count > 0) {
        const extractedTitle = this.extractTitleFromFirstUserMessage(row.thread_id)
        if (extractedTitle) {
          repairStmt.run(extractedTitle, Date.now(), row.thread_id)
          row.title = extractedTitle
        }
      }
    }

    return rows.map(row => ({
      id: row.thread_id,
      title: row.title,
      lastModified: row.last_modified,
      messageCount: row.message_count,
      userId: row.user_id,
    }))
  }

  /** 获取单个线程元数据 */
  getThreadMeta(threadId: string): any | null {
    const row = this.db.prepare('SELECT * FROM thread_meta WHERE thread_id = ?').get(threadId) as ThreadMetaRow | undefined
    if (!row) return null

    // 自动修复：title 为 NULL 但有消息时，从第一条用户消息提取标题并回填
    if (!row.title && row.message_count > 0) {
      const extractedTitle = this.extractTitleFromFirstUserMessage(threadId)
      if (extractedTitle) {
        this.db.prepare('UPDATE thread_meta SET title = ?, updated_at_db = ? WHERE thread_id = ?')
          .run(extractedTitle, Date.now(), threadId)
        row.title = extractedTitle
        logger.session.info(`[SessionDb] Auto-repaired title for thread ${threadId}: "${extractedTitle}"`)
      }
    }

    return this.rowToThreadMeta(row)
  }

  /** 批量获取线程元数据 — 一次查询替代 N 次单条查询，显著减少 IPC 开销 */
  batchGetThreadMeta(threadIds: string[]): Record<string, any> {
    if (threadIds.length === 0) return {}

    const placeholders = threadIds.map(() => '?').join(',')
    const rows = this.db.prepare(
      `SELECT * FROM thread_meta WHERE thread_id IN (${placeholders})`
    ).all(...threadIds) as ThreadMetaRow[]

    const result: Record<string, any> = {}
    for (const row of rows) {
      result[row.thread_id] = this.rowToThreadMeta(row)
    }
    return result
  }

  /** 从第一条用户消息中提取标题文本 */
  private extractTitleFromFirstUserMessage(threadId: string): string | null {
    const msgRow = this.db.prepare(
      `SELECT content FROM thread_message
       WHERE thread_id = ? AND role = 'user'
       ORDER BY seq ASC LIMIT 1`
    ).get(threadId) as { content: string } | undefined

    if (!msgRow) return null

    try {
      return this.extractTextFromMessageContent(msgRow.content)
    } catch {
      return null
    }
  }

  /** 从数据库存储的消息 JSON 中提取文本内容
   *  数据库中 content 列存储的是 JSON.stringify(完整消息对象)，如：
   *  {"id":"...","role":"user","content":"你好" 或 [{"type":"text","text":"你好"}],...}
   */
  private extractTextFromMessageContent(rawContent: string): string | null {
    const msgObj = JSON.parse(rawContent)
    // 取消息对象的 content 字段
    const content = msgObj?.content
    if (!content) return null

    if (typeof content === 'string') {
      return content.trim().slice(0, 60) || null
    }
    if (Array.isArray(content)) {
      const text = content
        .filter((p: any) => p.type === 'text' && typeof p.text === 'string')
        .map((p: any) => p.text)
        .join(' ')
      return text.trim().slice(0, 60) || null
    }
    return null
  }

  /** 保存/更新线程元数据 */
  upsertThreadMeta(threadId: string, data: any): void {
    const now = Date.now()
    const existing = this.db.prepare('SELECT thread_id, title FROM thread_meta WHERE thread_id = ?').get(threadId) as any

    // 保护已有标题：如果新数据没有标题但数据库中已有标题，保留数据库中的标题
    const effectiveTitle = data.title?.trim() || (existing?.title ?? null)

    const fields = {
      title: effectiveTitle,
      created_at: data.createdAt ?? now,
      last_modified: data.lastModified ?? now,
      message_count: data.messageCount ?? 0,
      user_id: data.userId ?? null,
      context_items: JSON.stringify(data.contextItems ?? []),
      message_checkpoints: JSON.stringify(data.messageCheckpoints ?? []),
      context_summary: data.contextSummary ?? null,
      todos: data.todos ? JSON.stringify(data.todos) : null,
      handoff_context: data.handoffContext ?? null,
      handoff_resume: data.handoffResume ? JSON.stringify(data.handoffResume) : null,
      pending_objective: data.pendingObjective ?? null,
      pending_steps: data.pendingSteps ? JSON.stringify(data.pendingSteps) : null,
      mode: data.mode ?? null,
      origin: data.origin ?? null,
      plan_id: data.planId ?? null,
      task_id: data.taskId ?? null,
      extra: JSON.stringify(data.extra ?? {}),
    }

    if (existing) {
      this.db.prepare(`
        UPDATE thread_meta SET
          title = ?, created_at = ?, last_modified = ?, message_count = ?,
          user_id = ?,
          context_items = ?, message_checkpoints = ?, context_summary = ?,
          todos = ?, handoff_context = ?, handoff_resume = ?,
          pending_objective = ?, pending_steps = ?, mode = ?,
          origin = ?, plan_id = ?, task_id = ?, extra = ?,
          updated_at_db = ?
        WHERE thread_id = ?
      `).run(
        fields.title, fields.created_at, fields.last_modified, fields.message_count,
        fields.user_id,
        fields.context_items, fields.message_checkpoints, fields.context_summary,
        fields.todos, fields.handoff_context, fields.handoff_resume,
        fields.pending_objective, fields.pending_steps, fields.mode,
        fields.origin, fields.plan_id, fields.task_id, fields.extra,
        now, threadId,
      )
    } else {
      this.db.prepare(`
        INSERT INTO thread_meta (
          thread_id, title, created_at, last_modified, message_count,
          user_id,
          context_items, message_checkpoints, context_summary,
          todos, handoff_context, handoff_resume,
          pending_objective, pending_steps, mode,
          origin, plan_id, task_id, extra,
          created_at_db, updated_at_db
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        threadId, fields.title, fields.created_at, fields.last_modified, fields.message_count,
        fields.user_id,
        fields.context_items, fields.message_checkpoints, fields.context_summary,
        fields.todos, fields.handoff_context, fields.handoff_resume,
        fields.pending_objective, fields.pending_steps, fields.mode,
        fields.origin, fields.plan_id, fields.task_id, fields.extra,
        now, now,
      )
    }
  }

  /** 删除线程元数据 */
  deleteThreadMeta(threadId: string): void {
    this.db.prepare('DELETE FROM thread_meta WHERE thread_id = ?').run(threadId)
  }

  /** 将未关联用户的线程归属到指定用户（登录后调用） */
  claimOrphanThreads(userId: string): number {
    const result = this.db.prepare(
      'UPDATE thread_meta SET user_id = ?, updated_at_db = ? WHERE user_id IS NULL'
    ).run(userId, Date.now())
    return result.changes
  }

  /** 修复缺少标题的线程：从第一条用户消息中提取标题
   *  用于一次性修复历史数据中 title 为 NULL 但有消息的线程
   */
  repairMissingTitles(): number {
    const rows = this.db.prepare(
      `SELECT tm.thread_id FROM thread_meta tm
       WHERE tm.title IS NULL AND tm.message_count > 0`
    ).all() as { thread_id: string }[]

    if (rows.length === 0) return 0

    const updateStmt = this.db.prepare(
      'UPDATE thread_meta SET title = ?, updated_at_db = ? WHERE thread_id = ?'
    )
    let repaired = 0

    for (const { thread_id } of rows) {
      try {
        const title = this.extractTitleFromFirstUserMessage(thread_id)
        if (title) {
          updateStmt.run(title, Date.now(), thread_id)
          repaired++
        }
      } catch (err) {
        logger.session.warn(`[SessionDb] repairMissingTitles: failed for thread ${thread_id}:`, err)
      }
    }

    if (repaired > 0) {
      logger.session.info(`[SessionDb] repairMissingTitles: ${repaired} threads repaired`)
    }
    return repaired
  }

  /** 行转线程元数据对象 */
  private rowToThreadMeta(row: ThreadMetaRow): any {
    let contextItems: any[] = []
    try { contextItems = JSON.parse(row.context_items) } catch { /* ignore */ }

    let messageCheckpoints: any[] = []
    try { messageCheckpoints = JSON.parse(row.message_checkpoints) } catch { /* ignore */ }

    let todos: any = undefined
    if (row.todos) {
      try { todos = JSON.parse(row.todos) } catch { /* ignore */ }
    }

    let handoffResume: any = undefined
    if (row.handoff_resume) {
      try { handoffResume = JSON.parse(row.handoff_resume) } catch { /* ignore */ }
    }

    let pendingSteps: any = undefined
    if (row.pending_steps) {
      try { pendingSteps = JSON.parse(row.pending_steps) } catch { /* ignore */ }
    }

    let extra: Record<string, any> = {}
    try { extra = JSON.parse(row.extra) } catch { /* ignore */ }

    return {
      id: row.thread_id,
      title: row.title ?? undefined,
      createdAt: row.created_at,
      lastModified: row.last_modified,
      messageCount: row.message_count,
      userId: row.user_id ?? undefined,
      contextItems,
      messageCheckpoints,
      contextSummary: row.context_summary ?? null,
      todos,
      handoffContext: row.handoff_context ?? undefined,
      handoffResume,
      pendingObjective: row.pending_objective ?? undefined,
      pendingSteps,
      mode: row.mode ?? undefined,
      origin: row.origin ?? undefined,
      planId: row.plan_id ?? undefined,
      taskId: row.task_id ?? undefined,
      ...extra,
    }
  }

  // ============================================
  // 线程消息 CRUD
  // ============================================

  /** 获取线程所有消息 */
  getThreadMessages(threadId: string): any[] {
    const rows = this.db.prepare(
      'SELECT * FROM thread_message WHERE thread_id = ? ORDER BY seq ASC'
    ).all(threadId) as ThreadMessageRow[]

    return rows.map(row => {
      try {
        return JSON.parse(row.content)
      } catch {
        return { role: row.role, content: row.content, _parseError: true }
      }
    })
  }

  /** 批量保存线程消息（事务，先清空再写入） */
  batchUpsertThreadMessages(threadId: string, messages: any[]): void {
    const tx = this.db.prepare('BEGIN TRANSACTION')
    try {
      tx.run()
      // 先删除该线程的旧消息
      this.db.prepare('DELETE FROM thread_message WHERE thread_id = ?').run(threadId)

      // 批量插入新消息
      const stmt = this.db.prepare(
        'INSERT INTO thread_message (thread_id, seq, role, content, created_at) VALUES (?, ?, ?, ?, ?)'
      )
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i]
        stmt.run(
          threadId,
          i,
          msg.role ?? '',
          JSON.stringify(msg),
          msg.createdAt ?? Date.now(),
        )
      }

      this.db.prepare('COMMIT').run()
    } catch (err) {
      this.db.prepare('ROLLBACK').run()
      logger.session.error('[SessionDb] batchUpsertThreadMessages failed:', err)
      throw err
    }
  }

  /** 追加单条消息 */
  appendThreadMessage(threadId: string, message: any): void {
    // 获取当前最大 seq
    const maxSeqRow = this.db.prepare(
      'SELECT MAX(seq) as max_seq FROM thread_message WHERE thread_id = ?'
    ).get(threadId) as { max_seq: number | null } | undefined

    const nextSeq = (maxSeqRow?.max_seq ?? -1) + 1

    this.db.prepare(
      'INSERT INTO thread_message (thread_id, seq, role, content, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(
      threadId,
      nextSeq,
      message.role ?? '',
      JSON.stringify(message),
      message.createdAt ?? Date.now(),
    )
  }

  /** 删除线程所有消息 */
  deleteThreadMessages(threadId: string): void {
    this.db.prepare('DELETE FROM thread_message WHERE thread_id = ?').run(threadId)
  }

  /** 获取线程消息数量 */
  getThreadMessageCount(threadId: string): number {
    const row = this.db.prepare(
      'SELECT COUNT(*) as count FROM thread_message WHERE thread_id = ?'
    ).get(threadId) as { count: number }
    return row.count
  }

  // ============================================
  // 线程完整操作
  // ============================================

  /** 删除线程（含元数据和消息） */
  deleteThread(threadId: string): void {
    const tx = this.db.prepare('BEGIN TRANSACTION')
    try {
      tx.run()
      this.db.prepare('DELETE FROM thread_message WHERE thread_id = ?').run(threadId)
      this.db.prepare('DELETE FROM thread_meta WHERE thread_id = ?').run(threadId)
      this.db.prepare('COMMIT').run()
    } catch (err) {
      this.db.prepare('ROLLBACK').run()
      logger.session.error('[SessionDb] deleteThread failed:', err)
      throw err
    }
  }

  /** 清空所有会话数据 */
  clearAll(): void {
    const tx = this.db.prepare('BEGIN TRANSACTION')
    try {
      tx.run()
      this.db.prepare('DELETE FROM thread_message').run()
      this.db.prepare('DELETE FROM thread_meta').run()
      this.db.prepare('DELETE FROM session_meta').run()
      this.db.prepare('COMMIT').run()
    } catch (err) {
      this.db.prepare('ROLLBACK').run()
      logger.session.error('[SessionDb] clearAll failed:', err)
      throw err
    }
  }

  // ============================================
  // 数据迁移
  // ============================================

  /** 从 JSONL 文件迁移数据到 SQLite
   *  支持增量迁移：
   *  - 首次迁移：完整导入元数据和消息
   *  - 已迁移：检查并修复缺失的消息 + 清理无效数据
   */
  async migrateFromJsonlFiles(sessionsDir: string): Promise<boolean> {
    const alreadyMigrated = this.getSessionMeta('_migrated_from_jsonl') === true

    // 检测之前有 bug 的迁移结果（message_count=0 且 title 为空的线程）
    // 这些是无效数据，需要清理后重新迁移
    if (alreadyMigrated) {
      const invalidThreads = this.db.prepare(`
        SELECT thread_id FROM thread_meta
        WHERE message_count = 0 AND (title IS NULL OR title = '')
      `).all() as Array<{ thread_id: string }>

      if (invalidThreads.length > 0) {
        logger.session.warn(`[SessionDb] Found ${invalidThreads.length} threads with empty data (buggy migration), resetting migration flag`)
        // 清理无效线程
        const tx = this.db.prepare('BEGIN TRANSACTION')
        try {
          tx.run()
          const deletedIds = new Set(invalidThreads.map(t => t.thread_id))
          for (const { thread_id } of invalidThreads) {
            this.db.prepare('DELETE FROM thread_message WHERE thread_id = ?').run(thread_id)
            this.db.prepare('DELETE FROM thread_meta WHERE thread_id = ?').run(thread_id)
          }
          // 更新 threadIds 列表，移除已删除的线程
          const currentThreadIds = this.getSessionMeta('threadIds')
          if (Array.isArray(currentThreadIds)) {
            const filtered = currentThreadIds.filter((id: string) => !deletedIds.has(id))
            this.upsertSessionMeta('threadIds', filtered)
          }
          this.db.prepare('COMMIT').run()
          // 重置迁移标记，让完整迁移重新执行
          this.deleteSessionMeta('_migrated_from_jsonl')
          logger.session.info('[SessionDb] Cleaned up invalid threads, will re-migrate from JSONL')
        } catch (err) {
          this.db.prepare('ROLLBACK').run()
          logger.session.error('[SessionDb] Failed to clean up invalid threads:', err)
        }
      }
    }

    const needFullMigration = this.getSessionMeta('_migrated_from_jsonl') !== true

    logger.session.info(`[SessionDb] ${needFullMigration ? 'Starting' : 'Checking'} migration from JSONL files...`)

    try {
      const fsExtra = await import('fs/promises')

      // 检查 sessions 目录是否存在
      try {
        await fsExtra.access(sessionsDir)
      } catch {
        logger.session.info('[SessionDb] Sessions directory does not exist, nothing to migrate')
        this.upsertSessionMeta('_migrated_from_jsonl', true)
        return false
      }

      const entries = await fsExtra.readdir(sessionsDir)
      let migratedThreadCount = 0
      let repairedCount = 0

      // 首次迁移：导入会话元数据
      if (needFullMigration) {
        // 读取 _meta.json
        const metaPath = path.join(sessionsDir, '_meta.json')
        try {
          const metaContent = await fsExtra.readFile(metaPath, 'utf-8')
          const meta = JSON.parse(metaContent)
          if (meta.currentThreadId !== undefined) {
            this.upsertSessionMeta('currentThreadId', meta.currentThreadId)
          }
          if (meta.threadIds) {
            this.upsertSessionMeta('threadIds', meta.threadIds)
          }
          if (meta.version !== undefined) {
            this.upsertSessionMeta('version', meta.version)
          }
        } catch {
          logger.session.info('[SessionDb] No _meta.json found, skipping meta migration')
        }

        // 读取 _extra.json
        const extraPath = path.join(sessionsDir, '_extra.json')
        try {
          const extraContent = await fsExtra.readFile(extraPath, 'utf-8')
          const extra = JSON.parse(extraContent)
          this.upsertSessionMeta('extra', extra)
        } catch {
          // _extra.json 可能不存在
        }
      }

      // 遍历线程文件（首次迁移 + 增量修复）
      const corruptedThreads: string[] = []
      const repairedThreads: string[] = []

      for (const entry of entries) {
        if (!entry.endsWith('.json') || entry === '_meta.json' || entry === '_extra.json') continue

        const threadId = entry.replace('.json', '')
        const threadFilePath = path.join(sessionsDir, entry)

        try {
          // 检查数据库中是否已有该线程的消息
          const existingMsgCount = this.getThreadMessageCount(threadId)

          if (needFullMigration) {
            // 首次迁移：导入线程元数据
            const threadContent = await fsExtra.readFile(threadFilePath, 'utf-8')
            let threadData: any
            try {
              threadData = JSON.parse(threadContent)
            } catch (parseErr) {
              // JSON 文件可能因写入中断而截断，尝试修复
              corruptedThreads.push(threadId)
              threadData = this.tryRepairTruncatedJson(threadContent)
              if (!threadData) {
                continue
              }
              repairedThreads.push(threadId)
            }

            // 读取 .jsonl 消息文件
            const jsonlPath = path.join(sessionsDir, `${threadId}.jsonl`)
            let messageCount = threadData.messageCount ?? 0
            try {
              const jsonlContent = await fsExtra.readFile(jsonlPath, 'utf-8')
              const messages = this.parseJsonlContent(jsonlContent)
              if (messages.length > 0) {
                this.batchUpsertThreadMessages(threadId, messages)
                messageCount = messages.length
              }
            } catch { /* .jsonl 可能不存在 */ }

            threadData.messageCount = messageCount
            this.upsertThreadMeta(threadId, threadData)
            migratedThreadCount++
          } else if (existingMsgCount === 0) {
            // 已迁移但消息缺失：增量修复消息
            const jsonlPath = path.join(sessionsDir, `${threadId}.jsonl`)
            try {
              const jsonlContent = await fsExtra.readFile(jsonlPath, 'utf-8')
              const messages = this.parseJsonlContent(jsonlContent)
              if (messages.length > 0) {
                this.batchUpsertThreadMessages(threadId, messages)
                // 同步更新 message_count
                this.db.prepare(
                  'UPDATE thread_meta SET message_count = ?, updated_at_db = ? WHERE thread_id = ?'
                ).run(messages.length, Date.now(), threadId)
                repairedCount++
              }
            } catch { /* .jsonl 可能不存在 */ }
          }
        } catch (err) {
          logger.session.warn(`[SessionDb] Failed to migrate thread ${threadId}:`, err)
        }
      }

      // 标记迁移完成
      this.upsertSessionMeta('_migrated_from_jsonl', true)

      // 汇总输出损坏线程信息（避免逐条刷屏）
      if (corruptedThreads.length > 0) {
        const failedCount = corruptedThreads.length - repairedThreads.length
        if (repairedThreads.length > 0) {
          logger.session.info(`[SessionDb] Corrupted JSON repair: ${repairedThreads.length}/${corruptedThreads.length} threads repaired successfully`)
        }
        if (failedCount > 0) {
          logger.session.warn(`[SessionDb] Corrupted JSON repair: ${failedCount} threads could not be repaired and were skipped`)
        }
      }

      if (needFullMigration) {
        logger.session.info(`[SessionDb] Migration completed: ${migratedThreadCount} threads migrated`)
      } else if (repairedCount > 0) {
        logger.session.info(`[SessionDb] Incremental repair: ${repairedCount} threads had missing messages restored`)
      } else if (corruptedThreads.length === 0) {
        logger.session.info('[SessionDb] All thread messages are intact, no repair needed')
      }

      return migratedThreadCount > 0 || repairedCount > 0
    } catch (err) {
      logger.session.error('[SessionDb] Migration failed:', err)
      return false
    }
  }

  /** 解析 JSONL 内容为消息数组 */
  private parseJsonlContent(content: string): any[] {
    if (!content.trim()) return []
    const messages: any[] = []
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        messages.push(JSON.parse(trimmed))
      } catch {
        // 跳过无效行
      }
    }
    return messages
  }

  /**
   * 尝试修复截断的 JSON 字符串
   * 常见场景：写入过程中断导致 JSON 不完整
   * 策略：逐步移除末尾字符直到能成功解析
   */
  private tryRepairTruncatedJson(content: string): any | null {
    const trimmed = content.trim()
    if (!trimmed) return null

    // 策略1：直接尝试（可能只是尾部空白问题）
    try { return JSON.parse(trimmed) } catch { /* continue */ }

    // 策略2：逐步截断末尾字符，找到最后一个完整的 JSON 对象
    for (let i = trimmed.length - 1; i > 0; i--) {
      const ch = trimmed[i]
      // 跳过可能的不完整键值对，尝试在对象边界闭合
      if (ch === ',' || ch === '"' || ch === ':' || ch === '{' || ch === '[') {
        const candidate = trimmed.substring(0, i)
        // 尝试补全闭合括号（仅补全缺失的，忽略多余的）
        const openBraces = (candidate.match(/{/g) || []).length
        const closeBraces = (candidate.match(/}/g) || []).length
        const openBrackets = (candidate.match(/\[/g) || []).length
        const closeBrackets = (candidate.match(/]/g) || []).length

        const braceCount = Math.max(0, openBraces - closeBraces)
        const bracketCount = Math.max(0, openBrackets - closeBrackets)

        if (braceCount === 0 && bracketCount === 0) continue

        const repaired = candidate
          + '}'.repeat(braceCount)
          + ']'.repeat(bracketCount)

        try { return JSON.parse(repaired) } catch { /* continue */ }
      }
    }

    return null
  }
}
