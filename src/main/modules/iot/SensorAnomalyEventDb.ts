/**
 * 传感器异常事件 SQLite 持久化（阶段7 s7-06 新增）
 *
 * 使用 node:sqlite (DatabaseSync) 持久化 SensorFusionService 检测到的异常事件，
 * 支持历史查询、过滤统计、按保留期自动清理。
 *
 * 数据库路径: {userDataPath}/.aweeclaw/db/iot_anomaly_events.db
 *
 * 设计原则：
 * - 每条异常事件一行（id 主键）
 * - 同步写入（异常事件频率低，无需防抖）
 * - 按 retentionDays 自动清理过期记录
 * - 支持多维度过滤查询（provider/entityType/severity/type/timeRange）
 *
 * @module iot/SensorAnomalyEventDb
 */

import { logger } from '@shared/toolkit/LogEngine';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import type { SensorAnomalyEvent } from './SensorFusionInterface';

// ============================================================
// 类型定义
// ============================================================

/** 数据库行结构 */
interface AnomalyEventRow {
  id: string;
  timestamp: number;
  type: string;
  severity: string;
  provider_id: string;
  entity_id: string;
  external_id: string;
  entity_type: string;
  current_value: number;
  unit: string | null;
  description: string;
  recommendation: string;
  window_stats: string; // JSON 序列化
  extra: string; // JSON 序列化（zscore/rateOfChange/stuckDurationMs）
  created_at: number;
}

/** 查询过滤条件 */
export interface AnomalyEventQueryFilter {
  /** Provider ID 过滤 */
  providerId?: string;
  /** 实体类型过滤 */
  entityType?: string;
  /** 严重度过滤 */
  severity?: string;
  /** 异常类型过滤 */
  type?: string;
  /** 起始时间戳（ms，包含） */
  startTime?: number;
  /** 结束时间戳（ms，包含） */
  endTime?: number;
  /** 返回条数上限（默认 50，最大 500） */
  limit?: number;
  /** 偏移量（默认 0） */
  offset?: number;
  /** 排序方式（默认 'desc' 按时间倒序） */
  sort?: 'asc' | 'desc';
}

/** 查询结果 */
export interface AnomalyEventQueryResult {
  /** 当前页数据 */
  items: SensorAnomalyEvent[];
  /** 总条数（满足过滤条件） */
  total: number;
}

// ============================================================
// 常量
// ============================================================

/** 单次查询最大返回条数 */
const MAX_QUERY_LIMIT = 500;

/** 默认查询返回条数 */
const DEFAULT_QUERY_LIMIT = 50;

// ============================================================
// SensorAnomalyEventDb 单例
// ============================================================

export class SensorAnomalyEventDb {
  private static instance: SensorAnomalyEventDb | null = null;

  private db: unknown = null; // DatabaseSync 实例
  private dbPath = '';
  private initialized = false;

  private constructor() {}

  static getInstance(): SensorAnomalyEventDb {
    if (!SensorAnomalyEventDb.instance) {
      SensorAnomalyEventDb.instance = new SensorAnomalyEventDb();
    }
    return SensorAnomalyEventDb.instance;
  }

  // ============================================================
  // 初始化
  // ============================================================

  /** 初始化数据库连接并建表 */
  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.iot?.info('[AnomalyDb] 已初始化，跳过');
      return;
    }

    const dbDir = path.join(app.getPath('userData'), '.aweeclaw', 'db');
    this.dbPath = path.join(dbDir, 'iot_anomaly_events.db');

    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    try {
      const { DatabaseSync } = await import('node:sqlite');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.db = new DatabaseSync(this.dbPath, { open: true }) as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.db as any).exec('PRAGMA journal_mode=WAL');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.db as any).exec('PRAGMA busy_timeout=5000');

      this.createTables();
      this.initialized = true;
      logger.iot?.info(`[AnomalyDb] 已初始化: ${this.dbPath}`);
    } catch (err) {
      logger.iot?.error('[AnomalyDb] 初始化失败:', err);
      throw err;
    }
  }

  /** 关闭数据库连接 */
  close(): void {
    if (this.db) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.db as any).close();
        this.db = null;
        this.initialized = false;
        logger.iot?.info('[AnomalyDb] 已关闭');
      } catch (err) {
        logger.iot?.error('[AnomalyDb] 关闭失败:', err);
      }
    }
  }

  // ============================================================
  // 建表
  // ============================================================

  private createTables(): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.db as any).exec(`
      CREATE TABLE IF NOT EXISTS anomaly_events (
        id              TEXT PRIMARY KEY,
        timestamp       INTEGER NOT NULL,
        type            TEXT NOT NULL,
        severity        TEXT NOT NULL,
        provider_id     TEXT NOT NULL,
        entity_id       TEXT NOT NULL,
        external_id     TEXT NOT NULL,
        entity_type     TEXT NOT NULL,
        current_value   REAL NOT NULL,
        unit            TEXT,
        description     TEXT NOT NULL,
        recommendation  TEXT NOT NULL,
        window_stats    TEXT NOT NULL DEFAULT '{}',
        extra           TEXT NOT NULL DEFAULT '{}',
        created_at      INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_anomaly_timestamp ON anomaly_events(timestamp);
      CREATE INDEX IF NOT EXISTS idx_anomaly_provider ON anomaly_events(provider_id);
      CREATE INDEX IF NOT EXISTS idx_anomaly_entity_type ON anomaly_events(entity_type);
      CREATE INDEX IF NOT EXISTS idx_anomaly_severity ON anomaly_events(severity);
      CREATE INDEX IF NOT EXISTS idx_anomaly_type ON anomaly_events(type);
      CREATE INDEX IF NOT EXISTS idx_anomaly_external_id ON anomaly_events(external_id);
      -- 阶段8 s8-09：组合索引，覆盖常见查询模式（WHERE provider_id = ? ORDER BY timestamp DESC）
      -- 查询场景：AnomalyHistoryPanel 按 Provider 筛选 + 时间倒序展示
      CREATE INDEX IF NOT EXISTS idx_anomaly_provider_timestamp ON anomaly_events(provider_id, timestamp DESC);
      -- 阶段8 s8-09：组合索引，覆盖时间范围 + 类型筛选的查询
      CREATE INDEX IF NOT EXISTS idx_anomaly_type_timestamp ON anomaly_events(type, timestamp DESC);
    `);
  }

  // ============================================================
  // 写操作
  // ============================================================

  /**
   * 插入一条异常事件
   *
   * 同步写入（异常事件频率低，无需防抖）。
   * 插入失败仅记录日志，不抛出异常（避免影响 SensorFusionService 主流程）。
   */
  insert(event: SensorAnomalyEvent): void {
    if (!this.initialized || !this.db) {
      logger.iot?.warn('[AnomalyDb] 未初始化，跳过插入');
      return;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stmt = (this.db as any).prepare(`
        INSERT OR REPLACE INTO anomaly_events (
          id, timestamp, type, severity,
          provider_id, entity_id, external_id, entity_type,
          current_value, unit, description, recommendation,
          window_stats, extra, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const extra: Record<string, unknown> = {};
      if (event.zscore !== undefined) extra.zscore = event.zscore;
      if (event.rateOfChange !== undefined) extra.rateOfChange = event.rateOfChange;
      if (event.stuckDurationMs !== undefined) extra.stuckDurationMs = event.stuckDurationMs;

      stmt.run(
        event.id,
        event.timestamp,
        event.type,
        event.severity,
        event.providerId,
        event.entityId,
        event.externalId,
        event.entityType,
        event.currentValue,
        event.unit ?? null,
        event.description,
        event.recommendation,
        JSON.stringify(event.windowStats),
        JSON.stringify(extra),
        Date.now(),
      );
    } catch (err) {
      logger.iot?.warn('[AnomalyDb] 插入异常事件失败:', err);
    }
  }

  // ============================================================
  // 读操作
  // ============================================================

  /**
   * 按条件查询异常事件
   *
   * 支持多维度过滤 + 分页 + 排序。
   */
  query(filter: AnomalyEventQueryFilter): AnomalyEventQueryResult {
    if (!this.initialized || !this.db) {
      return { items: [], total: 0 };
    }

    const limit = Math.min(
      Math.max(filter.limit ?? DEFAULT_QUERY_LIMIT, 1),
      MAX_QUERY_LIMIT,
    );
    const offset = Math.max(filter.offset ?? 0, 0);
    const sort = filter.sort === 'asc' ? 'ASC' : 'DESC';

    const { whereClause, params } = this.buildWhereClause(filter);

    try {
      // 查询总数
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const countStmt = (this.db as any).prepare(
        `SELECT COUNT(*) as total FROM anomaly_events ${whereClause}`,
      );
      const countResult = countStmt.get(...params) as { total: number };

      // 查询数据
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dataStmt = (this.db as any).prepare(
        `SELECT * FROM anomaly_events ${whereClause} ORDER BY timestamp ${sort} LIMIT ? OFFSET ?`,
      );
      const rows = dataStmt.all(...params, limit, offset) as AnomalyEventRow[];

      return {
        items: rows.map((row) => this.rowToEvent(row)),
        total: countResult.total,
      };
    } catch (err) {
      logger.iot?.warn('[AnomalyDb] 查询异常事件失败:', err);
      return { items: [], total: 0 };
    }
  }

  /**
   * 查询最近 N 条异常事件（便捷方法）
   *
   * 按时间倒序返回。
   */
  queryRecent(limit = 20): SensorAnomalyEvent[] {
    return this.query({ limit, sort: 'desc' }).items;
  }

  // ============================================================
  // 清理操作
  // ============================================================

  /**
   * 删除早于指定时间戳的记录
   *
   * 用于按 retentionDays 自动清理过期数据。
   *
   * @param beforeTimestamp 删除此时间戳之前的记录（不包含）
   * @returns 删除的条数
   */
  deleteOlderThan(beforeTimestamp: number): number {
    if (!this.initialized || !this.db) return 0;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stmt = (this.db as any).prepare(
        'DELETE FROM anomaly_events WHERE timestamp < ?',
      );
      const result = stmt.run(beforeTimestamp) as { changes: number };
      return result.changes ?? 0;
    } catch (err) {
      logger.iot?.warn('[AnomalyDb] 清理过期记录失败:', err);
      return 0;
    }
  }

  /**
   * 按保留天数清理过期记录
   *
   * @param retentionDays 保留天数（删除 retentionDays 天前的记录）
   * @returns 删除的条数
   */
  cleanupByRetention(retentionDays: number): number {
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const deleted = this.deleteOlderThan(cutoff);
    if (deleted > 0) {
      logger.iot?.info(
        `[AnomalyDb] 按保留期 ${retentionDays} 天清理 ${deleted} 条过期记录`,
      );
    }
    return deleted;
  }

  /** 清空所有异常事件（危险操作，仅供调试/重置使用） */
  clearAll(): void {
    if (!this.initialized || !this.db) return;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.db as any).exec('DELETE FROM anomaly_events');
      logger.iot?.info('[AnomalyDb] 已清空所有异常事件');
    } catch (err) {
      logger.iot?.warn('[AnomalyDb] 清空失败:', err);
    }
  }

  // ============================================================
  // 内部方法
  // ============================================================

  /** 构建 WHERE 子句和参数 */
  private buildWhereClause(filter: AnomalyEventQueryFilter): {
    whereClause: string;
    params: unknown[];
  } {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.providerId) {
      conditions.push('provider_id = ?');
      params.push(filter.providerId);
    }
    if (filter.entityType) {
      conditions.push('entity_type = ?');
      params.push(filter.entityType);
    }
    if (filter.severity) {
      conditions.push('severity = ?');
      params.push(filter.severity);
    }
    if (filter.type) {
      conditions.push('type = ?');
      params.push(filter.type);
    }
    if (filter.startTime !== undefined) {
      conditions.push('timestamp >= ?');
      params.push(filter.startTime);
    }
    if (filter.endTime !== undefined) {
      conditions.push('timestamp <= ?');
      params.push(filter.endTime);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    return { whereClause, params };
  }

  /** 数据库行 → SensorAnomalyEvent 对象 */
  private rowToEvent(row: AnomalyEventRow): SensorAnomalyEvent {
    let windowStats: SensorAnomalyEvent['windowStats'];
    try {
      windowStats = JSON.parse(row.window_stats);
    } catch {
      windowStats = {
        externalId: row.external_id,
        count: 0,
        mean: 0,
        std: 0,
        min: 0,
        max: 0,
        lastTimestamp: row.timestamp,
        lastValue: row.current_value,
      };
    }

    let extra: Record<string, unknown> = {};
    try {
      extra = JSON.parse(row.extra);
    } catch {
      // 保留默认空对象
    }

    return {
      id: row.id,
      timestamp: row.timestamp,
      type: row.type as SensorAnomalyEvent['type'],
      severity: row.severity as SensorAnomalyEvent['severity'],
      providerId: row.provider_id,
      entityId: row.entity_id,
      externalId: row.external_id,
      entityType: row.entity_type as SensorAnomalyEvent['entityType'],
      currentValue: row.current_value,
      unit: row.unit ?? undefined,
      windowStats,
      description: row.description,
      recommendation: row.recommendation,
      zscore: typeof extra.zscore === 'number' ? extra.zscore : undefined,
      rateOfChange:
        typeof extra.rateOfChange === 'number'
          ? extra.rateOfChange
          : undefined,
      stuckDurationMs:
        typeof extra.stuckDurationMs === 'number'
          ? extra.stuckDurationMs
          : undefined,
    };
  }
}

// 导出单例
export const sensorAnomalyEventDb = SensorAnomalyEventDb.getInstance();
