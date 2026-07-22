/**
 * IoT 实体快照 SQLite 持久化
 *
 * 使用 node:sqlite (DatabaseSync) 持久化 IoTBridge 的实体快照，
 * 确保应用重启后可恢复最近一次的实体状态，避免首次连接前的"空窗期"。
 *
 * 数据库路径: {userDataPath}/.aweeclaw/db/iot_snapshots.db
 *
 * 设计原则：
 * - 每个实体一行（externalId + providerId 联合主键）
 * - 仅持久化状态摘要，不存储历史读数（读数在后端数据库）
 * - 写入采用防抖策略（debounce 1s），避免高频更新打满磁盘
 *
 * @module iot/IoTEntitySnapshotDb
 */

import { logger } from '@shared/toolkit/LogEngine';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import type { IoTEntitySnapshot } from './IoTInterface';

// ============================================================
// 类型定义
// ============================================================

/** 数据库行结构 */
interface SnapshotRow {
  provider_id: string;
  entity_id: string;
  device_id: string;
  external_id: string;
  entity_type: string;
  device_class: string | null;
  unit_of_measurement: string | null;
  state: string; // JSON 序列化的 state 值
  attributes: string; // JSON 序列化的 attributes
  last_state_changed_at: number;
  updated_at: number;
}

// ============================================================
// IoTEntitySnapshotDb 单例
// ============================================================

export class IoTEntitySnapshotDb {
  private static instance: IoTEntitySnapshotDb | null = null;

  private db: unknown = null; // DatabaseSync 实例
  private dbPath = '';
  private initialized = false;

  /** 防抖写入定时器 */
  private flushTimer: NodeJS.Timeout | null = null;
  /** 待写入的快照缓冲（key: providerId:externalId → snapshot） */
  private pendingBuffer = new Map<string, IoTEntitySnapshot & { providerId: string }>();
  /** 防抖延迟（ms） */
  private static readonly FLUSH_DEBOUNCE_MS = 1000;

  private constructor() {}

  static getInstance(): IoTEntitySnapshotDb {
    if (!IoTEntitySnapshotDb.instance) {
      IoTEntitySnapshotDb.instance = new IoTEntitySnapshotDb();
    }
    return IoTEntitySnapshotDb.instance;
  }

  // ============================================================
  // 初始化
  // ============================================================

  /** 初始化数据库连接并建表 */
  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.iot?.info('[SnapshotDb] 已初始化，跳过');
      return;
    }

    const dbDir = path.join(app.getPath('userData'), '.aweeclaw', 'db');
    this.dbPath = path.join(dbDir, 'iot_snapshots.db');

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
      logger.iot?.info(`[SnapshotDb] 已初始化: ${this.dbPath}`);
    } catch (err) {
      logger.iot?.error('[SnapshotDb] 初始化失败:', err);
      throw err;
    }
  }

  /** 关闭数据库连接 */
  close(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
      this.flushBufferSync();
    }
    if (this.db) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.db as any).close();
        this.db = null;
        this.initialized = false;
        logger.iot?.info('[SnapshotDb] 已关闭');
      } catch (err) {
        logger.iot?.error('[SnapshotDb] 关闭失败:', err);
      }
    }
  }

  // ============================================================
  // 建表
  // ============================================================

  private createTables(): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.db as any).exec(`
      CREATE TABLE IF NOT EXISTS entity_snapshots (
        provider_id           TEXT NOT NULL,
        entity_id             TEXT NOT NULL,
        device_id             TEXT NOT NULL,
        external_id           TEXT NOT NULL,
        entity_type           TEXT NOT NULL,
        device_class          TEXT,
        unit_of_measurement   TEXT,
        state                 TEXT NOT NULL,
        attributes            TEXT NOT NULL DEFAULT '{}',
        last_state_changed_at INTEGER NOT NULL,
        updated_at            INTEGER NOT NULL,
        PRIMARY KEY (provider_id, external_id)
      );
      CREATE INDEX IF NOT EXISTS idx_snapshots_provider ON entity_snapshots(provider_id);
      CREATE INDEX IF NOT EXISTS idx_snapshots_entity_type ON entity_snapshots(entity_type);
      -- 阶段8 s8-09：entity_id 单列索引，支持按实体 ID 快速查询
      CREATE INDEX IF NOT EXISTS idx_snapshots_entity_id ON entity_snapshots(entity_id);
      -- 阶段8 s8-09：updated_at 索引，支持按更新时间排序和清理过期快照
      CREATE INDEX IF NOT EXISTS idx_snapshots_updated_at ON entity_snapshots(updated_at);
    `);
  }

  // ============================================================
  // 读操作
  // ============================================================

  /** 加载指定 Provider 的所有实体快照 */
  loadByProvider(providerId: string): Array<IoTEntitySnapshot & { providerId: string }> {
    if (!this.initialized || !this.db) return [];

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stmt = (this.db as any).prepare(
        'SELECT * FROM entity_snapshots WHERE provider_id = ?',
      );
      const rows = stmt.all(providerId) as SnapshotRow[];
      return rows.map((row) => this.rowToSnapshot(row));
    } catch (err) {
      logger.iot?.warn('[SnapshotDb] 加载快照失败:', err);
      return [];
    }
  }

  /** 加载所有 Provider 的实体快照 */
  loadAll(): Array<IoTEntitySnapshot & { providerId: string }> {
    if (!this.initialized || !this.db) return [];

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stmt = (this.db as any).prepare(
        'SELECT * FROM entity_snapshots',
      );
      const rows = stmt.all() as SnapshotRow[];
      return rows.map((row) => this.rowToSnapshot(row));
    } catch (err) {
      logger.iot?.warn('[SnapshotDb] 加载全部快照失败:', err);
      return [];
    }
  }

  // ============================================================
  // 写操作（防抖批量写入）
  // ============================================================

  /**
   * 更新单个实体快照（防抖写入）
   *
   * 高频调用时自动合并，1s 后批量写入。
   */
  upsertSnapshot(providerId: string, snapshot: IoTEntitySnapshot): void {
    if (!this.initialized) return;

    const key = `${providerId}:${snapshot.externalId}`;
    this.pendingBuffer.set(key, { ...snapshot, providerId });

    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushBufferSync();
    }, IoTEntitySnapshotDb.FLUSH_DEBOUNCE_MS);
  }

  /** 删除指定 Provider 的所有快照 */
  deleteByProvider(providerId: string): void {
    if (!this.initialized || !this.db) return;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stmt = (this.db as any).prepare(
        'DELETE FROM entity_snapshots WHERE provider_id = ?',
      );
      stmt.run(providerId);
    } catch (err) {
      logger.iot?.warn('[SnapshotDb] 删除快照失败:', err);
    }
  }

  /** 清空所有快照 */
  clearAll(): void {
    if (!this.initialized || !this.db) return;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.db as any).exec('DELETE FROM entity_snapshots');
    } catch (err) {
      logger.iot?.warn('[SnapshotDb] 清空失败:', err);
    }
  }

  // ============================================================
  // 内部方法
  // ============================================================

  /** 立即刷新缓冲区到数据库 */
  private flushBufferSync(): void {
    if (!this.initialized || !this.db || this.pendingBuffer.size === 0) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stmt = (this.db as any).prepare(`
      INSERT OR REPLACE INTO entity_snapshots (
        provider_id, entity_id, device_id, external_id,
        entity_type, device_class, unit_of_measurement,
        state, attributes, last_state_changed_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const now = Date.now();
    let count = 0;
    for (const snapshot of this.pendingBuffer.values()) {
      try {
        stmt.run(
          snapshot.providerId,
          snapshot.id,
          snapshot.deviceId,
          snapshot.externalId,
          snapshot.entityType,
          snapshot.deviceClass ?? null,
          snapshot.unitOfMeasurement ?? null,
          JSON.stringify(snapshot.state),
          JSON.stringify(snapshot.attributes || {}),
          snapshot.lastStateChangedAt,
          now,
        );
        count++;
      } catch (err) {
        logger.iot?.warn('[SnapshotDb] 写入快照失败:', err);
      }
    }

    this.pendingBuffer.clear();
    if (count > 0) {
      logger.iot?.info(`[SnapshotDb] 已持久化 ${count} 条快照`);
    }
  }

  /** 数据库行 → 快照对象 */
  private rowToSnapshot(row: SnapshotRow): IoTEntitySnapshot & { providerId: string } {
    let state: string | number | boolean | null = null;
    try {
      const parsed = JSON.parse(row.state);
      if (typeof parsed === 'string' || typeof parsed === 'number' || typeof parsed === 'boolean' || parsed === null) {
        state = parsed;
      } else {
        state = row.state;
      }
    } catch {
      state = row.state;
    }

    let attributes: Record<string, unknown> = {};
    try {
      attributes = JSON.parse(row.attributes);
    } catch {
      // 保留默认空对象
    }

    return {
      providerId: row.provider_id,
      id: row.entity_id,
      deviceId: row.device_id,
      externalId: row.external_id,
      entityType: row.entity_type as IoTEntitySnapshot['entityType'],
      deviceClass: row.device_class,
      unitOfMeasurement: row.unit_of_measurement,
      state,
      attributes,
      lastStateChangedAt: row.last_state_changed_at,
    };
  }
}

// 导出单例
export const iotEntitySnapshotDb = IoTEntitySnapshotDb.getInstance();
