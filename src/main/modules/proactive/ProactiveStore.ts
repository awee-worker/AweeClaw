/**
 * 主动提案 SQLite 持久化（阶段10 s10-02 新增）
 *
 * 使用 node:sqlite (DatabaseSync) 持久化 ProactiveDecisionEngine 产出的提案、
 * 用户反馈、审计日志，支持历史查询、采纳率统计、按保留期自动清理。
 *
 * 数据库路径: {userDataPath}/.aweeclaw/db/proactive.db
 *
 * 三张表：
 * 1. proactive_proposals — 提案主表（含状态生命周期）
 * 2. proactive_feedback  — 用户反馈（accepted/rejected/later/ignored）
 * 3. proactive_audit_log — 审计日志（s10-05 ProactivePermission 写入）
 *
 * 4 个索引覆盖常见查询：状态+时间、来源+时间、反馈关联、审计关联
 *
 * @module proactive/ProactiveStore
 */

import { logger } from '@shared/toolkit/LogEngine'
import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import {
  type ProactiveProposal,
  type ProposalStatus,
  type ProposalFeedback,
  type ProactiveSource,
  type ProactiveSeverity,
  type AdoptionStats,
} from './ProactiveInterface'

// ============================================================
// 常量
// ============================================================

/** 保留期（天），超过自动清理 */
const RETENTION_DAYS = 30

/** 单次查询最大返回条数 */
const MAX_QUERY_LIMIT = 500

/** 默认查询返回条数 */
const DEFAULT_QUERY_LIMIT = 50

// ============================================================
// 类型定义
// ============================================================

/** 提案数据库行结构 */
interface ProposalRow {
  id: string
  source: string
  trigger: string
  severity: string
  title: string
  description: string
  action_type: string
  action_payload: string
  confidence: number
  reason: string
  signals: string // JSON 序列化
  dedup_key: string
  status: string
  created_at: number
  resolved_at: number | null
}

/** 反馈数据库行结构 */
interface FeedbackRow {
  id: string
  proposal_id: string
  feedback: string
  actual_action: string | null
  created_at: number
}

/** 审计日志数据库行结构 */
interface AuditLogRow {
  id: string
  proposal_id: string
  event: string
  detail: string // JSON 序列化
  created_at: number
}

/** 提案查询过滤条件 */
export interface ProposalQueryFilter {
  /** 来源场景过滤 */
  source?: ProactiveSource
  /** 严重度过滤 */
  severity?: ProactiveSeverity
  /** 状态过滤 */
  status?: ProposalStatus
  /** 起始时间戳（ms，包含） */
  startTime?: number
  /** 结束时间戳（ms，包含） */
  endTime?: number
  /** 返回条数上限（默认 50，最大 500） */
  limit?: number
  /** 偏移量（默认 0） */
  offset?: number
  /** 排序方式（默认 'desc' 按时间倒序） */
  sort?: 'asc' | 'desc'
}

/** 提案查询结果 */
export interface ProposalQueryResult {
  /** 当前页数据 */
  items: ProactiveProposal[]
  /** 总条数 */
  total: number
}

/** 审计事件类型 */
export type AuditEvent =
  | 'created'      // 提案创建
  | 'permitted'    // 权限校验通过
  | 'blocked'      // 权限校验拦截
  | 'dispatched'   // 已派发
  | 'failed'       // 派发失败
  | 'feedback'     // 收到用户反馈

/** 审计日志条目 */
export interface AuditLogEntry {
  id: string
  proposalId: string
  event: AuditEvent
  detail: Record<string, unknown>
  createdAt: number
}

// ============================================================
// ProactiveStore 单例
// ============================================================

export class ProactiveStore {
  private static instance: ProactiveStore | null = null

  private db: unknown = null // DatabaseSync 实例
  private dbPath = ''
  private initialized = false

  private constructor() {}

  static getInstance(): ProactiveStore {
    if (!ProactiveStore.instance) {
      ProactiveStore.instance = new ProactiveStore()
    }
    return ProactiveStore.instance
  }

  // ============================================================
  // 初始化
  // ============================================================

  /** 初始化数据库连接并建表 */
  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.proactive?.debug('[ProactiveStore] 已初始化，跳过')
      return
    }

    const dbDir = path.join(app.getPath('userData'), '.aweeclaw', 'db')
    this.dbPath = path.join(dbDir, 'proactive.db')

    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true })
    }

    try {
      const { DatabaseSync } = await import('node:sqlite')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.db = new (DatabaseSync as any)(this.dbPath, { open: true })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(this.db as any).exec('PRAGMA journal_mode=WAL')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(this.db as any).exec('PRAGMA busy_timeout=5000')

      this.createTables()
      this.initialized = true
      logger.proactive?.info(`[ProactiveStore] 已初始化: ${this.dbPath}`)
    } catch (err) {
      logger.proactive?.error(`[ProactiveStore] 初始化失败: ${err instanceof Error ? err.message : String(err)}`)
      throw err
    }
  }

  /** 关闭数据库连接 */
  close(): void {
    if (this.db) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(this.db as any).close()
        this.db = null
        this.initialized = false
        logger.proactive?.info('[ProactiveStore] 已关闭')
      } catch (err) {
        logger.proactive?.error(`[ProactiveStore] 关闭失败: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  /** 是否已初始化 */
  isInitialized(): boolean {
    return this.initialized
  }

  // ============================================================
  // 建表
  // ============================================================

  private createTables(): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.db as any).exec(`
      CREATE TABLE IF NOT EXISTS proactive_proposals (
        id              TEXT PRIMARY KEY,
        source          TEXT NOT NULL,
        trigger         TEXT NOT NULL,
        severity        TEXT NOT NULL,
        title           TEXT NOT NULL,
        description     TEXT NOT NULL,
        action_type     TEXT NOT NULL,
        action_payload  TEXT NOT NULL,
        confidence      REAL NOT NULL,
        reason          TEXT NOT NULL,
        signals         TEXT NOT NULL DEFAULT '[]',
        dedup_key       TEXT NOT NULL,
        status          TEXT NOT NULL DEFAULT 'pending',
        created_at      INTEGER NOT NULL,
        resolved_at     INTEGER
      );

      CREATE TABLE IF NOT EXISTS proactive_feedback (
        id              TEXT PRIMARY KEY,
        proposal_id     TEXT NOT NULL,
        feedback        TEXT NOT NULL,
        actual_action   TEXT,
        created_at      INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS proactive_audit_log (
        id              TEXT PRIMARY KEY,
        proposal_id     TEXT NOT NULL,
        event           TEXT NOT NULL,
        detail          TEXT NOT NULL DEFAULT '{}',
        created_at      INTEGER NOT NULL
      );

      -- 索引：状态 + 时间（历史查询主索引）
      CREATE INDEX IF NOT EXISTS idx_proposals_status_created ON proactive_proposals(status, created_at DESC);
      -- 索引：来源 + 时间（按场景统计）
      CREATE INDEX IF NOT EXISTS idx_proposals_source_created ON proactive_proposals(source, created_at DESC);
      -- 索引：反馈关联（查询某提案的所有反馈）
      CREATE INDEX IF NOT EXISTS idx_feedback_proposal_id ON proactive_feedback(proposal_id);
      -- 索引：审计关联（查询某提案的完整审计链路）
      CREATE INDEX IF NOT EXISTS idx_audit_proposal_created ON proactive_audit_log(proposal_id, created_at DESC);
    `)
  }

  // ============================================================
  // 提案写操作
  // ============================================================

  /**
   * 插入一条提案（初始状态 pending）
   * 插入失败仅记录日志，不抛异常（避免影响决策引擎主流程）
   */
  insertProposal(proposal: ProactiveProposal, status: ProposalStatus = 'pending'): void {
    if (!this.ensureReady()) return

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stmt = (this.db as any).prepare(`
        INSERT OR REPLACE INTO proactive_proposals (
          id, source, trigger, severity, title, description,
          action_type, action_payload, confidence, reason,
          signals, dedup_key, status, created_at, resolved_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)

      stmt.run(
        proposal.id,
        proposal.source,
        proposal.trigger,
        proposal.severity,
        proposal.title,
        proposal.description,
        proposal.action.type,
        proposal.action.payload,
        proposal.confidence,
        proposal.reason,
        JSON.stringify(proposal.signals),
        proposal.dedupKey,
        status,
        proposal.createdAt,
        null,
      )
    } catch (err) {
      logger.proactive?.warn(`[ProactiveStore] 插入提案失败: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /**
   * 更新提案状态
   * @param id 提案 ID
   * @param status 新状态
   */
  updateProposalStatus(id: string, status: ProposalStatus): void {
    if (!this.ensureReady()) return

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stmt = (this.db as any).prepare(`
        UPDATE proactive_proposals
        SET status = ?, resolved_at = ?
        WHERE id = ?
      `)

      const resolvedAt = ['accepted', 'rejected', 'dismissed'].includes(status) ? Date.now() : null
      stmt.run(status, resolvedAt, id)
    } catch (err) {
      logger.proactive?.warn(`[ProactiveStore] 更新提案状态失败: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // ============================================================
  // 反馈写操作
  // ============================================================

  /**
   * 记录用户反馈
   * @param proposalId 关联提案 ID
   * @param feedback 反馈类型
   * @param actualAction 用户实际动作（可选）
   */
  recordFeedback(proposalId: string, feedback: ProposalFeedback, actualAction?: string): void {
    if (!this.ensureReady()) return

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stmt = (this.db as any).prepare(`
        INSERT INTO proactive_feedback (id, proposal_id, feedback, actual_action, created_at)
        VALUES (?, ?, ?, ?, ?)
      `)

      const feedbackId = `fb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      stmt.run(feedbackId, proposalId, feedback, actualAction ?? null, Date.now())

      // 同步更新提案状态
      const statusMap: Record<ProposalFeedback, ProposalStatus> = {
        accepted: 'accepted',
        rejected: 'rejected',
        later: 'pending', // 稍后提醒，保持 pending
        ignored: 'dismissed',
      }
      this.updateProposalStatus(proposalId, statusMap[feedback])
    } catch (err) {
      logger.proactive?.warn(`[ProactiveStore] 记录反馈失败: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // ============================================================
  // 审计日志写操作
  // ============================================================

  /**
   * 写入审计日志
   * @param proposalId 关联提案 ID
   * @param event 事件类型
   * @param detail 事件详情
   */
  insertAuditLog(proposalId: string, event: AuditEvent, detail: Record<string, unknown> = {}): void {
    if (!this.ensureReady()) return

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stmt = (this.db as any).prepare(`
        INSERT INTO proactive_audit_log (id, proposal_id, event, detail, created_at)
        VALUES (?, ?, ?, ?, ?)
      `)

      const logId = `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      stmt.run(logId, proposalId, event, JSON.stringify(detail), Date.now())
    } catch (err) {
      logger.proactive?.warn(`[ProactiveStore] 写入审计日志失败: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // ============================================================
  // 查询操作
  // ============================================================

  /**
   * 分页查询提案
   */
  listProposals(filter: ProposalQueryFilter = {}): ProposalQueryResult {
    if (!this.ensureReady()) return { items: [], total: 0 }

    try {
      const where: string[] = []
      const params: unknown[] = []

      if (filter.source) {
        where.push('source = ?')
        params.push(filter.source)
      }
      if (filter.severity) {
        where.push('severity = ?')
        params.push(filter.severity)
      }
      if (filter.status) {
        where.push('status = ?')
        params.push(filter.status)
      }
      if (filter.startTime !== undefined) {
        where.push('created_at >= ?')
        params.push(filter.startTime)
      }
      if (filter.endTime !== undefined) {
        where.push('created_at <= ?')
        params.push(filter.endTime)
      }

      const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
      const limit = Math.min(Math.max(filter.limit ?? DEFAULT_QUERY_LIMIT, 1), MAX_QUERY_LIMIT)
      const offset = Math.max(filter.offset ?? 0, 0)
      const sortOrder = filter.sort === 'asc' ? 'ASC' : 'DESC'

      // 查询总数
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const countStmt = (this.db as any).prepare(`SELECT COUNT(*) as total FROM proactive_proposals ${whereClause}`)
      const countResult = countStmt.get(...params) as { total: number }
      const total = countResult?.total ?? 0

      // 查询数据
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dataStmt = (this.db as any).prepare(`
        SELECT * FROM proactive_proposals ${whereClause}
        ORDER BY created_at ${sortOrder}
        LIMIT ? OFFSET ?
      `)
      const rows = dataStmt.all(...params, limit, offset) as ProposalRow[]

      return {
        items: rows.map((row) => this.rowToProposal(row)),
        total,
      }
    } catch (err) {
      logger.proactive?.warn(`[ProactiveStore] 查询提案失败: ${err instanceof Error ? err.message : String(err)}`)
      return { items: [], total: 0 }
    }
  }

  /**
   * 查询某提案的反馈列表
   */
  listFeedback(proposalId: string): Array<{ feedback: ProposalFeedback; actualAction: string | null; createdAt: number }> {
    if (!this.ensureReady()) return []

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stmt = (this.db as any).prepare(`
        SELECT feedback, actual_action, created_at
        FROM proactive_feedback
        WHERE proposal_id = ?
        ORDER BY created_at ASC
      `)
      const rows = stmt.all(proposalId) as FeedbackRow[]
      return rows.map((r) => ({
        feedback: r.feedback as ProposalFeedback,
        actualAction: r.actual_action,
        createdAt: r.created_at,
      }))
    } catch (err) {
      logger.proactive?.warn(`[ProactiveStore] 查询反馈失败: ${err instanceof Error ? err.message : String(err)}`)
      return []
    }
  }

  /**
   * 查询某提案的审计日志
   */
  listAuditLogs(proposalId: string): AuditLogEntry[] {
    if (!this.ensureReady()) return []

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stmt = (this.db as any).prepare(`
        SELECT id, proposal_id, event, detail, created_at
        FROM proactive_audit_log
        WHERE proposal_id = ?
        ORDER BY created_at ASC
      `)
      const rows = stmt.all(proposalId) as AuditLogRow[]
      return rows.map((r) => ({
        id: r.id,
        proposalId: r.proposal_id,
        event: r.event as AuditEvent,
        detail: this.safeParseJson(r.detail),
        createdAt: r.created_at,
      }))
    } catch (err) {
      logger.proactive?.warn(`[ProactiveStore] 查询审计日志失败: ${err instanceof Error ? err.message : String(err)}`)
      return []
    }
  }

  // ============================================================
  // 统计
  // ============================================================

  /**
   * 计算指定时间窗口内的采纳率统计
   * @param startTime 起始时间戳（ms），默认 7 天前
   * @param endTime 结束时间戳（ms），默认当前
   */
  getAdoptionStats(startTime?: number, endTime?: number): AdoptionStats {
    if (!this.ensureReady()) return this.emptyStats()

    try {
      const end = endTime ?? Date.now()
      const start = startTime ?? (end - 7 * 24 * 60 * 60 * 1000)

      // 统计各反馈计数
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const feedbackStmt = (this.db as any).prepare(`
        SELECT feedback, COUNT(*) as cnt
        FROM proactive_feedback
        WHERE created_at >= ? AND created_at <= ?
        GROUP BY feedback
      `)
      const feedbackRows = feedbackStmt.all(start, end) as Array<{ feedback: string; cnt: number }>

      const feedbackCounts: Record<string, number> = {}
      for (const r of feedbackRows) {
        feedbackCounts[r.feedback] = r.cnt
      }

      // 统计按来源细分
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sourceStmt = (this.db as any).prepare(`
        SELECT p.source, COUNT(*) as total,
          SUM(CASE WHEN f.feedback = 'accepted' THEN 1 ELSE 0 END) as accepted
        FROM proactive_proposals p
        LEFT JOIN proactive_feedback f ON p.id = f.proposal_id
        WHERE p.created_at >= ? AND p.created_at <= ?
        GROUP BY p.source
      `)
      const sourceRows = sourceStmt.all(start, end) as Array<{ source: string; total: number; accepted: number }>

      const bySource = {} as AdoptionStats['bySource']
      const sources: ProactiveSource[] = ['coding', 'iot', 'system', 'time', 'fusion']
      for (const src of sources) {
        const row = sourceRows.find((r) => r.source === src)
        const total = row?.total ?? 0
        const accepted = row?.accepted ?? 0
        bySource[src] = { total, accepted, rate: total > 0 ? accepted / total : 0 }
      }

      // 统计按严重度细分
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const severityStmt = (this.db as any).prepare(`
        SELECT p.severity, COUNT(*) as total,
          SUM(CASE WHEN f.feedback = 'accepted' THEN 1 ELSE 0 END) as accepted
        FROM proactive_proposals p
        LEFT JOIN proactive_feedback f ON p.id = f.proposal_id
        WHERE p.created_at >= ? AND p.created_at <= ?
        GROUP BY p.severity
      `)
      const severityRows = severityStmt.all(start, end) as Array<{ severity: string; total: number; accepted: number }>

      const bySeverity = {} as AdoptionStats['bySeverity']
      const severities: ProactiveSeverity[] = ['info', 'low', 'medium', 'high', 'critical']
      for (const sev of severities) {
        const row = severityRows.find((r) => r.severity === sev)
        const total = row?.total ?? 0
        const accepted = row?.accepted ?? 0
        bySeverity[sev] = { total, accepted, rate: total > 0 ? accepted / total : 0 }
      }

      const accepted = feedbackCounts['accepted'] ?? 0
      const rejected = feedbackCounts['rejected'] ?? 0
      const later = feedbackCounts['later'] ?? 0
      const ignored = feedbackCounts['ignored'] ?? 0
      const total = accepted + rejected + later + ignored

      return {
        total,
        accepted,
        rejected,
        later,
        ignored,
        adoptionRate: total > 0 ? accepted / total : 0,
        bySource,
        bySeverity,
      }
    } catch (err) {
      logger.proactive?.warn(`[ProactiveStore] 统计采纳率失败: ${err instanceof Error ? err.message : String(err)}`)
      return this.emptyStats()
    }
  }

  // ============================================================
  // 清理
  // ============================================================

  /**
   * 清理过期数据（超过保留期）
   * 建议由 CronScheduler 每日调用
   * @returns 清理的记录数
   */
  cleanupExpired(): number {
    if (!this.ensureReady()) return 0

    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000
    let removed = 0

    try {
      // 先清理反馈（外键关联）
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fbStmt = (this.db as any).prepare(`DELETE FROM proactive_feedback WHERE created_at < ?`)
      const fbResult = fbStmt.run(cutoff)
      removed += (fbResult.changes as number) ?? 0

      // 清理审计日志
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const auditStmt = (this.db as any).prepare(`DELETE FROM proactive_audit_log WHERE created_at < ?`)
      const auditResult = auditStmt.run(cutoff)
      removed += (auditResult.changes as number) ?? 0

      // 清理提案
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const propStmt = (this.db as any).prepare(`DELETE FROM proactive_proposals WHERE created_at < ?`)
      const propResult = propStmt.run(cutoff)
      removed += (propResult.changes as number) ?? 0

      if (removed > 0) {
        logger.proactive?.info(`[ProactiveStore] 清理过期数据: 移除 ${removed} 条（保留期 ${RETENTION_DAYS} 天）`)
      }
      return removed
    } catch (err) {
      logger.proactive?.warn(`[ProactiveStore] 清理过期数据失败: ${err instanceof Error ? err.message : String(err)}`)
      return 0
    }
  }

  /**
   * 清空所有数据（用于设置面板"清除历史"）
   */
  clearAll(): void {
    if (!this.ensureReady()) return

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(this.db as any).exec(`
        DELETE FROM proactive_feedback;
        DELETE FROM proactive_audit_log;
        DELETE FROM proactive_proposals;
      `)
      logger.proactive?.info('[ProactiveStore] 已清空所有数据')
    } catch (err) {
      logger.proactive?.warn(`[ProactiveStore] 清空数据失败: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // ============================================================
  // 私有辅助
  // ============================================================

  /** 确保数据库已初始化，未初始化时记录警告并返回 false */
  private ensureReady(): boolean {
    if (!this.initialized || !this.db) {
      logger.proactive?.warn('[ProactiveStore] 未初始化，跳过操作')
      return false
    }
    return true
  }

  /** 数据库行 → ProactiveProposal 对象 */
  private rowToProposal(row: ProposalRow): ProactiveProposal {
    return {
      id: row.id,
      source: row.source as ProactiveSource,
      trigger: row.trigger,
      severity: row.severity as ProactiveSeverity,
      title: row.title,
      description: row.description,
      action: {
        type: row.action_type as ProactiveProposal['action']['type'],
        payload: row.action_payload,
      },
      confidence: row.confidence,
      reason: row.reason,
      signals: this.safeParseJson<string[]>(row.signals),
      dedupKey: row.dedup_key,
      createdAt: row.created_at,
    }
  }

  /**
   * 安全解析 JSON（失败返回空对象）
   * 泛型版本：调用方指定目标类型 T，解析失败返回 `{} as T`
   */
  private safeParseJson<T = Record<string, unknown>>(raw: string): T {
    try {
      return JSON.parse(raw) as T
    } catch {
      return {} as T
    }
  }

  /** 返回空统计结构 */
  private emptyStats(): AdoptionStats {
    const emptyBySource = {} as AdoptionStats['bySource']
    const emptyBySeverity = {} as AdoptionStats['bySeverity']
    const sources: ProactiveSource[] = ['coding', 'iot', 'system', 'time', 'fusion']
    const severities: ProactiveSeverity[] = ['info', 'low', 'medium', 'high', 'critical']
    for (const s of sources) emptyBySource[s] = { total: 0, accepted: 0, rate: 0 }
    for (const s of severities) emptyBySeverity[s] = { total: 0, accepted: 0, rate: 0 }
    return {
      total: 0,
      accepted: 0,
      rejected: 0,
      later: 0,
      ignored: 0,
      adoptionRate: 0,
      bySource: emptyBySource,
      bySeverity: emptyBySeverity,
    }
  }
}

// ============================================================
// 导出单例
// ============================================================

export const proactiveStore = ProactiveStore.getInstance()
