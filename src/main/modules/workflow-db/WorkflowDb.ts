/**
 * 工作流本地数据库
 *
 * 使用 node:sqlite (DatabaseSync) 持久化工作流定义与运行历史。
 * 数据库路径: {userDataPath}/.aweeclaw/db/workflows.db
 *
 * 为什么从 localStorage 迁到 SQLite：
 * 1. 容量：localStorage 单域约 5~10MB，工作流含 nodes/edges 嵌套 JSON，
 *    100 条就容易写超；写超时 setItem 抛异常被上层 catch 吞掉，
 *    表现为「保存了但重开没了」，属于静默数据丢失。
 * 2. 性能：旧实现每次保存都把整个数组序列化一遍，O(n) 全量写。
 * 3. 查询：按 id 取单条需要线性查找，无法按更新时间分页。
 *
 * 设计取舍：
 * - 每行同时存 id/时间等「可索引列」与完整 payload（JSON）。
 *   不做字段级拆解：nodes/edges 是深层嵌套结构，拆开反而丢信息，
 *   而这里的查询需求只有「按 id 取」和「按时间排序」两种。
 * - payload 存整条记录，schema 演进由应用层 migration 处理，
 *   数据库不做版本判断，避免迁移逻辑散落两处。
 */

import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'

// ============================================
// 类型
// ============================================

export interface WorkflowDefinitionRow {
  id: string
  name: string
  payload: string
  created_at: number
  updated_at: number
}

export interface WorkflowRunRow {
  id: string
  workflow_id: string
  status: string
  payload: string
  started_at: number
  updated_at: number
}

export interface WorkflowDbMetaRow {
  key: string
  value: string
  updated_at: number
}

/** 迁移结果：各类实际落库的条数 */
export interface LegacyImportResult {
  defs: number
  runs: number
  skipped: number
}

// ============================================
// 路径
// ============================================

function getDbDir(): string {
  return path.join(app.getPath('userData'), '.aweeclaw', 'db')
}

function getDbPath(): string {
  return path.join(getDbDir(), 'workflows.db')
}

// ============================================
// WorkflowDb
// ============================================

export class WorkflowDb {
  private db: any = null
  private dbPath = ''
  private static instance: WorkflowDb | null = null

  private constructor() {}

  static getInstance(): WorkflowDb {
    if (!WorkflowDb.instance) WorkflowDb.instance = new WorkflowDb()
    return WorkflowDb.instance
  }

  /**
   * 打开连接并建表。
   *
   * 幂等：已初始化直接返回。并发调用由调用方（IPC handler）串行化，
   * 这里不做额外加锁——Node 单线程下 await 之间不会交错执行到同一临界区。
   */
  async initialize(): Promise<void> {
    if (this.db) return

    this.dbPath = getDbPath()
    const dir = getDbDir()
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

    try {
      const { DatabaseSync } = await import('node:sqlite')
      this.db = new DatabaseSync(this.dbPath, { open: true })
      // WAL：读写不互斥，工作流保存不会阻塞列表读取
      this.db.exec('PRAGMA journal_mode=WAL')
      // busy_timeout：并发写时等锁而不是立刻报 SQLITE_BUSY
      this.db.exec('PRAGMA busy_timeout=5000')
      this.createTables()
      logger.ui.info(`[WorkflowDb] Initialized at ${this.dbPath}`)
    } catch (err) {
      logger.ui.error('[WorkflowDb] Failed to initialize:', err)
      throw err
    }
  }

  close(): void {
    if (!this.db) return
    try {
      this.db.close()
      this.db = null
      logger.ui.info('[WorkflowDb] Closed')
    } catch (err) {
      logger.ui.error('[WorkflowDb] Failed to close:', err)
    }
  }

  getFilePath(): string {
    return this.dbPath
  }

  private ensureOpen(): void {
    if (!this.db) {
      throw new Error('WorkflowDb 未初始化，请先调用 initialize()')
    }
  }

  private createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workflow_definitions (
        id         TEXT PRIMARY KEY NOT NULL,
        name       TEXT NOT NULL DEFAULT '',
        payload    TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL DEFAULT 0
      )
    `)
    // 列表默认按更新时间倒序，索引跟随排序键
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_wf_def_updated
        ON workflow_definitions (updated_at DESC)
    `)

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workflow_runs (
        id          TEXT PRIMARY KEY NOT NULL,
        workflow_id TEXT NOT NULL DEFAULT '',
        status      TEXT NOT NULL DEFAULT '',
        payload     TEXT NOT NULL,
        started_at  INTEGER NOT NULL DEFAULT 0,
        updated_at  INTEGER NOT NULL DEFAULT 0
      )
    `)
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_wf_run_started
        ON workflow_runs (started_at DESC)
    `)
    // 按工作流筛选运行记录是最常见的查询
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_wf_run_wfid
        ON workflow_runs (workflow_id, started_at DESC)
    `)

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workflow_db_meta (
        key        TEXT PRIMARY KEY NOT NULL,
        value      TEXT NOT NULL DEFAULT '',
        updated_at INTEGER NOT NULL DEFAULT 0
      )
    `)
  }

  // ==========================================
  // 工作流定义
  // ==========================================

  listDefinitions(): WorkflowDefinitionRow[] {
    this.ensureOpen()
    return this.db
      .prepare(
        `SELECT id, name, payload, created_at, updated_at
           FROM workflow_definitions
          ORDER BY updated_at DESC`,
      )
      .all() as WorkflowDefinitionRow[]
  }

  getDefinition(id: string): WorkflowDefinitionRow | null {
    this.ensureOpen()
    const row = this.db
      .prepare(
        `SELECT id, name, payload, created_at, updated_at
           FROM workflow_definitions
          WHERE id = ?`,
      )
      .get(id) as WorkflowDefinitionRow | undefined
    return row ?? null
  }

  /**
   * 写入或覆盖单条定义。
   *
   * 用 UPSERT 而不是「先查后插」：后者在两次 IPC 之间存在竞态窗口，
   * 快速连续保存同一 id 会撞主键。ON CONFLICT 由数据库一次性解决。
   */
  upsertDefinition(def: {
    id: string
    name: string
    createdAt?: number
    updatedAt?: number
    payload: string
  }): void {
    this.ensureOpen()
    const now = Date.now()
    this.db
      .prepare(
        `INSERT INTO workflow_definitions (id, name, payload, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           payload = excluded.payload,
           updated_at = excluded.updated_at`,
      )
      .run(
        def.id,
        def.name || '',
        def.payload,
        def.createdAt ?? now,
        def.updatedAt ?? now,
      )
  }

  deleteDefinition(id: string): void {
    this.ensureOpen()
    this.db.prepare('DELETE FROM workflow_definitions WHERE id = ?').run(id)
  }

  // ==========================================
  // 运行历史
  // ==========================================

  listRuns(limit = 50): WorkflowRunRow[] {
    this.ensureOpen()
    return this.db
      .prepare(
        `SELECT id, workflow_id, status, payload, started_at, updated_at
           FROM workflow_runs
          ORDER BY started_at DESC
          LIMIT ?`,
      )
      .all(limit) as WorkflowRunRow[]
  }

  upsertRun(run: {
    id: string
    workflowId: string
    status: string
    startedAt: number
    updatedAt: number
    payload: string
  }): void {
    this.ensureOpen()
    this.db
      .prepare(
        `INSERT INTO workflow_runs (id, workflow_id, status, payload, started_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           workflow_id = excluded.workflow_id,
           status = excluded.status,
           payload = excluded.payload,
           updated_at = excluded.updated_at`,
      )
      .run(
        run.id,
        run.workflowId || '',
        run.status || '',
        run.payload,
        run.startedAt || 0,
        run.updatedAt || Date.now(),
      )
  }

  /**
   * 只更新运行状态相关的列，不重写整条 payload。
   *
   * 为什么单独开这个方法：一次运行会多次推进状态（running → completed），
   * 每次都序列化整个 payload 太浪费；这里由调用方传完整 payload 也可，
   * 但状态列与索引列可独立更新，便于后续按状态筛选。
   */
  clearRuns(): void {
    this.ensureOpen()
    this.db.exec('DELETE FROM workflow_runs')
  }

  /**
   * 删除单条运行记录。
   *
   * 必须单独存在：没有它时「删除一条历史」只能靠整体重写，
   * 或者退化成只改 localStorage，重启后已删记录会复活。
   */
  deleteRun(id: string): void {
    this.ensureOpen()
    this.db.prepare('DELETE FROM workflow_runs WHERE id = ?').run(id)
  }

  /** 裁剪历史，只保留最近 N 条（替代旧实现的 slice(0, MAX_HISTORY)） */
  trimRuns(keep: number): number {
    this.ensureOpen()
    const rows = this.db
      .prepare('SELECT id FROM workflow_runs ORDER BY started_at DESC LIMIT -1 OFFSET ?')
      .all(keep) as Array<{ id: string }>
    if (rows.length === 0) return 0
    const del = this.db.prepare('DELETE FROM workflow_runs WHERE id = ?')
    for (const r of rows) del.run(r.id)
    return rows.length
  }

  // ==========================================
  // meta（迁移标记等）
  // ==========================================

  getMeta(key: string): string | null {
    this.ensureOpen()
    const row = this.db
      .prepare('SELECT value FROM workflow_db_meta WHERE key = ?')
      .get(key) as { value: string } | undefined
    return row?.value ?? null
  }

  setMeta(key: string, value: string): void {
    this.ensureOpen()
    this.db
      .prepare(
        `INSERT INTO workflow_db_meta (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, value, Date.now())
  }

  /**
   * 把渲染进程传来的旧 localStorage 数据批量写入。
   *
   * 事务包裹：中途失败则整批不生效，避免留下「导入了一半」的状态——
   * 那种状态最难判断该补导还是重导。
   *
   * 已存在同 id 的定义不覆盖：SQLite 里的数据更新，
   * 旧 localStorage 只可能在首次迁移时提供候选。
   */
  importLegacy(
    defs: Array<{ id: string; name?: string; payload: string; createdAt?: number; updatedAt?: number }>,
    runs: Array<{ id: string; workflowId?: string; status?: string; payload: string; startedAt?: number; updatedAt?: number }>,
  ): LegacyImportResult {
    this.ensureOpen()
    let defsWritten = 0
    let runsWritten = 0
    let skipped = 0

    this.db.exec('BEGIN')
    try {
      const existsDef = this.db.prepare('SELECT 1 FROM workflow_definitions WHERE id = ?')
      for (const d of defs) {
        if (!d?.id || typeof d.payload !== 'string') {
          skipped++
          continue
        }
        if (existsDef.get(d.id)) {
          skipped++
          continue
        }
        this.upsertDefinition({
          id: d.id,
          name: d.name || '',
          payload: d.payload,
          createdAt: d.createdAt,
          updatedAt: d.updatedAt,
        })
        defsWritten++
      }

      const existsRun = this.db.prepare('SELECT 1 FROM workflow_runs WHERE id = ?')
      for (const r of runs) {
        if (!r?.id || typeof r.payload !== 'string') {
          skipped++
          continue
        }
        if (existsRun.get(r.id)) {
          skipped++
          continue
        }
        this.upsertRun({
          id: r.id,
          workflowId: r.workflowId || '',
          status: r.status || '',
          payload: r.payload,
          startedAt: r.startedAt || 0,
          updatedAt: r.updatedAt || Date.now(),
        })
        runsWritten++
      }

      this.db.exec('COMMIT')
    } catch (err) {
      try {
        this.db.exec('ROLLBACK')
      } catch {
        // rollback 失败说明事务已不可用，原始错误更重要
      }
      logger.ui.error('[WorkflowDb] importLegacy failed, rolled back:', err)
      throw err
    }

    return { defs: defsWritten, runs: runsWritten, skipped }
  }
}

export const workflowDb = WorkflowDb.getInstance()
