/**
 * 系统指标与异常事件存储 — 基于 LanceDB 的本地持久化
 *
 * 存储两类数据：
 * 1. system_metrics：系统指标时序数据（30s 一次采样）
 * 2. anomaly_events：异常告警事件
 *
 * 数据生命周期：
 * - 默认保留 7 天（指标）/ 30 天（异常）
 * - 后台定时清理过期数据
 * - 隐私模式下不写入磁盘（仅内存缓存）
 *
 * @module monitoring/SystemMetricsStore
 */

import { logger } from '@shared/toolkit/LogEngine'
import * as path from 'path'
import * as fs from 'fs'
import { app } from 'electron'
import type { SystemMetrics, AnomalyEvent, MonitoringConfig } from './MonitoringInterface'
import { DEFAULT_MONITORING_CONFIG } from './MonitoringInterface'

// ============================================================
// LanceDB 类型定义
// ============================================================

interface LanceDbConnection {
  tableNames(): Promise<string[]>
  openTable(name: string): Promise<LanceDbTable>
  createTable(name: string, data: unknown[]): Promise<LanceDbTable>
  dropTable(name: string): Promise<void>
}

interface LanceDbTable {
  countRows(): Promise<number>
  add(data: unknown[]): Promise<void>
  delete(filter: string): Promise<void>
  search(vector: number[]): LanceDbVectorQuery
  query(): LanceDbQuery
}

interface LanceDbQuery {
  select(columns: string[]): LanceDbQuery
  where(filter: string): LanceDbQuery
  limit(n: number): LanceDbQuery
  toArray(): Promise<Record<string, unknown>[]>
}

interface LanceDbVectorQuery {
  limit(n: number): LanceDbVectorQuery
  where(filter: string): LanceDbVectorQuery
  toArray(): Promise<Record<string, unknown>[]>
}

// ============================================================
// 表名常量
// ============================================================

const TABLE_NAMES = {
  SYSTEM_METRICS: 'system_metrics',
  ANOMALY_EVENTS: 'anomaly_events',
} as const

// ============================================================
// 系统指标存储
// ============================================================

/**
 * 系统指标存储管理器
 *
 * 单例模式。提供 system_metrics 与 anomaly_events 两张表的 CRUD。
 * 与 PerceptionStore 类似的轻量 LanceDB 封装。
 */
export class SystemMetricsStore {
  private static instance: SystemMetricsStore | null = null

  private db: LanceDbConnection | null = null
  private dbPath: string
  private initialized = false
  private config: MonitoringConfig

  /** 表缓存 */
  private tables: Map<string, LanceDbTable> = new Map()

  /** 内存环形缓冲（最近 60 个采样，隐私模式下作为唯一存储） */
  private memoryBuffer: SystemMetrics[] = []
  private readonly MEMORY_BUFFER_SIZE = 60

  /** 内存异常事件缓冲（最近 50 条） */
  private anomalyBuffer: AnomalyEvent[] = []
  private readonly ANOMALY_BUFFER_SIZE = 50

  private constructor(config?: MonitoringConfig) {
    this.config = config ?? DEFAULT_MONITORING_CONFIG
    this.dbPath = path.join(app.getPath('userData'), 'monitoring-db')
  }

  static getInstance(config?: MonitoringConfig): SystemMetricsStore {
    if (!SystemMetricsStore.instance) {
      SystemMetricsStore.instance = new SystemMetricsStore(config)
    }
    return SystemMetricsStore.instance
  }

  /** 更新配置 */
  updateConfig(config: Partial<MonitoringConfig>): void {
    this.config = { ...this.config, ...config }
    logger.monitoring?.info('[SystemMetricsStore] 配置已更新:', {
      enabled: this.config.enabled,
      sampleIntervalSec: this.config.sampleIntervalSec,
    })
  }

  /** 获取当前配置 */
  getConfig(): MonitoringConfig {
    return { ...this.config }
  }

  /** 初始化数据库连接 */
  async initialize(): Promise<boolean> {
    if (this.initialized) return true

    try {
      if (!fs.existsSync(this.dbPath)) {
        fs.mkdirSync(this.dbPath, { recursive: true })
      }
      const lancedb = await import('@lancedb/lancedb')
      this.db = (await lancedb.connect(this.dbPath)) as unknown as LanceDbConnection
      this.initialized = true
      logger.monitoring?.info(`[SystemMetricsStore] 数据库初始化成功: ${this.dbPath}`)
      return true
    } catch (e) {
      logger.monitoring?.error('[SystemMetricsStore] 数据库初始化失败:', e)
      this.db = null
      return false
    }
  }

  /** 确保表存在 */
  private async ensureTable(
    name: string,
    sampleRecord: Record<string, unknown>,
  ): Promise<LanceDbTable | null> {
    if (!this.db) {
      const ok = await this.initialize()
      if (!ok) return null
    }

    const cached = this.tables.get(name)
    if (cached) return cached

    try {
      const tables = await this.db!.tableNames()
      if (tables.includes(name)) {
        const table = await this.db!.openTable(name)
        this.tables.set(name, table)
        return table
      }
      const table = await this.db!.createTable(name, [sampleRecord])
      this.tables.set(name, table)
      logger.monitoring?.info(`[SystemMetricsStore] 创建表: ${name}`)
      return table
    } catch (e) {
      logger.monitoring?.error(`[SystemMetricsStore] 打开/创建表失败 ${name}:`, e)
      return null
    }
  }

  // ============================================================
  // 系统指标
  // ============================================================

  /** 保存系统指标采样 */
  async saveMetrics(metrics: SystemMetrics): Promise<boolean> {
    // 始终写入内存缓冲
    this.memoryBuffer.push(metrics)
    if (this.memoryBuffer.length > this.MEMORY_BUFFER_SIZE) {
      this.memoryBuffer.shift()
    }

    // 隐私模式或未启用云端上报 → 不落盘
    if (!this.config.cloudReportingEnabled) {
      return true
    }

    const table = await this.ensureTable(TABLE_NAMES.SYSTEM_METRICS, {
      timestamp: 0,
      cpuUsage: 0,
      cpuLoadAvg1: 0,
      cpuLoadAvg5: 0,
      cpuLoadAvg15: 0,
      memoryUsage: 0,
      memoryAvailableMB: 0,
      memoryTotalMB: 0,
      diskUsage: 0,
      diskIoReadKBps: 0,
      diskIoWriteKBps: 0,
      networkRxKBps: 0,
      networkTxKBps: 0,
      processCount: 0,
      cpuTemperature: 0,
      batteryPercent: 0,
      batteryCharging: false,
    })
    if (!table) return false

    try {
      await table.add([metrics])
      return true
    } catch (e) {
      logger.monitoring?.error('[SystemMetricsStore] 保存指标失败:', e)
      return false
    }
  }

  /**
   * 获取指定时间范围内的指标
   *
   * @param startTime 起始时间戳（ms）
   * @param endTime   结束时间戳（ms）
   * @param limit     最大返回数量（默认 1000）
   */
  async getMetricsByTimeRange(
    startTime: number,
    endTime: number,
    limit = 1000,
  ): Promise<SystemMetrics[]> {
    // 优先从内存缓冲返回（覆盖最近 30 分钟的数据）
    if (endTime >= Date.now() - 30 * 60 * 1000) {
      const memoryMatches = this.memoryBuffer.filter(
        m => m.timestamp >= startTime && m.timestamp <= endTime,
      )
      if (memoryMatches.length >= limit) {
        return memoryMatches.slice(-limit)
      }
    }

    const table = this.tables.get(TABLE_NAMES.SYSTEM_METRICS)
    if (!table) {
      // 无磁盘表，返回内存缓冲
      return this.memoryBuffer.filter(
        m => m.timestamp >= startTime && m.timestamp <= endTime,
      )
    }

    try {
      const records = await table.query()
        .where(`timestamp >= ${startTime} AND timestamp <= ${endTime}`)
        .limit(limit)
        .toArray()
      const metrics = records.map(r => this.recordToMetrics(r))
      metrics.sort((a, b) => a.timestamp - b.timestamp)
      return metrics
    } catch (e) {
      logger.monitoring?.error('[SystemMetricsStore] 查询指标失败:', e)
      return []
    }
  }

  /** 获取最近的 N 个采样 */
  getRecentMetricsFromMemory(limit = 60): SystemMetrics[] {
    return this.memoryBuffer.slice(-limit)
  }

  /** 获取最近一次采样 */
  getLatestMetrics(): SystemMetrics | null {
    return this.memoryBuffer.length > 0
      ? this.memoryBuffer[this.memoryBuffer.length - 1]
      : null
  }

  // ============================================================
  // 异常事件
  // ============================================================

  /** 保存异常事件 */
  async saveAnomaly(event: AnomalyEvent): Promise<boolean> {
    // 始终写入内存缓冲
    this.anomalyBuffer.push(event)
    if (this.anomalyBuffer.length > this.ANOMALY_BUFFER_SIZE) {
      this.anomalyBuffer.shift()
    }

    if (!this.config.cloudReportingEnabled) {
      return true
    }

    const table = await this.ensureTable(TABLE_NAMES.ANOMALY_EVENTS, {
      id: '',
      timestamp: 0,
      type: 'unknown',
      severity: 'info',
      metricType: 'cpu_usage',
      currentValue: 0,
      predictedPeak: 0,
      predictedTriggerAt: 0,
      description: '',
      recommendation: '',
      status: 'active',
      evidenceStart: 0,
      evidenceEnd: 0,
      samples: '[]',
    })
    if (!table) return false

    try {
      await table.add([{
        id: event.id,
        timestamp: event.timestamp,
        type: event.type,
        severity: event.severity,
        metricType: event.metricType,
        currentValue: event.currentValue,
        predictedPeak: event.predictedPeak ?? 0,
        predictedTriggerAt: event.predictedTriggerAt ?? 0,
        description: event.description,
        recommendation: event.recommendation,
        status: event.status,
        evidenceStart: event.evidenceWindow.start,
        evidenceEnd: event.evidenceWindow.end,
        samples: JSON.stringify(event.samples ?? []),
      }])
      return true
    } catch (e) {
      logger.monitoring?.error('[SystemMetricsStore] 保存异常失败:', e)
      return false
    }
  }

  /** 更新异常事件状态（已确认/已恢复） */
  async updateAnomalyStatus(
    anomalyId: string,
    status: 'active' | 'resolved' | 'acknowledged',
  ): Promise<boolean> {
    // 先更新内存缓冲
    const idx = this.anomalyBuffer.findIndex(a => a.id === anomalyId)
    if (idx >= 0) {
      this.anomalyBuffer[idx].status = status
    }

    if (!this.config.cloudReportingEnabled) {
      return true
    }

    const table = this.tables.get(TABLE_NAMES.ANOMALY_EVENTS)
    if (!table) return false

    try {
      // LanceDB 不支持单行更新，使用 delete + add 实现
      const records = await table.query().where(`id = '${anomalyId}'`).toArray()
      if (records.length === 0) return false
      const original = records[0]
      await table.delete(`id = '${anomalyId}'`)
      await table.add([{ ...original, status }])
      return true
    } catch (e) {
      logger.monitoring?.error('[SystemMetricsStore] 更新异常状态失败:', e)
      return false
    }
  }

  /**
   * 获取指定时间范围内的异常事件
   */
  async getAnomaliesByTimeRange(
    startTime: number,
    endTime: number,
    limit = 100,
  ): Promise<AnomalyEvent[]> {
    // 内存缓冲合并
    const memoryMatches = this.anomalyBuffer.filter(
      a => a.timestamp >= startTime && a.timestamp <= endTime,
    )

    const table = this.tables.get(TABLE_NAMES.ANOMALY_EVENTS)
    if (!table) {
      return memoryMatches.slice(-limit)
    }

    try {
      const records = await table.query()
        .where(`timestamp >= ${startTime} AND timestamp <= ${endTime}`)
        .limit(limit)
        .toArray()
      const diskMatches = records.map(r => this.recordToAnomaly(r))

      // 合并去重
      const seen = new Set(memoryMatches.map(a => a.id))
      const merged = [...memoryMatches]
      for (const a of diskMatches) {
        if (!seen.has(a.id)) {
          merged.push(a)
          seen.add(a.id)
        }
      }
      merged.sort((a, b) => b.timestamp - a.timestamp)
      return merged.slice(0, limit)
    } catch (e) {
      logger.monitoring?.error('[SystemMetricsStore] 查询异常失败:', e)
      return memoryMatches.slice(-limit)
    }
  }

  /** 获取活跃异常（status === 'active'） */
  getActiveAnomalies(): AnomalyEvent[] {
    return this.anomalyBuffer.filter(a => a.status === 'active')
  }

  /** 获取最近异常（从内存缓冲） */
  getRecentAnomalies(limit = 20): AnomalyEvent[] {
    return this.anomalyBuffer.slice(-limit).reverse()
  }

  // ============================================================
  // 数据清理
  // ============================================================

  /** 清理过期数据 */
  async cleanupExpiredData(): Promise<void> {
    const metricsCutoff = Date.now() - this.config.retentionDays * 24 * 60 * 60 * 1000
    const anomalyCutoff = Date.now() - 30 * 24 * 60 * 60 * 1000 // 异常保留 30 天

    for (const [name, cutoff] of [
      [TABLE_NAMES.SYSTEM_METRICS, metricsCutoff],
      [TABLE_NAMES.ANOMALY_EVENTS, anomalyCutoff],
    ] as const) {
      const table = this.tables.get(name)
      if (!table) continue
      try {
        await table.delete(`timestamp < ${cutoff}`)
        logger.monitoring?.info(`[SystemMetricsStore] 清理过期数据: ${name}`)
      } catch (e) {
        logger.monitoring?.error(`[SystemMetricsStore] 清理失败 ${name}:`, e)
      }
    }
  }

  /** 清空所有数据 */
  async clearAllData(): Promise<boolean> {
    if (!this.db) {
      this.memoryBuffer = []
      this.anomalyBuffer = []
      return true
    }

    try {
      for (const tableName of Object.values(TABLE_NAMES)) {
        const tables = await this.db.tableNames()
        if (tables.includes(tableName)) {
          await this.db.dropTable(tableName)
        }
      }
      this.tables.clear()
      this.memoryBuffer = []
      this.anomalyBuffer = []
      logger.monitoring?.info('[SystemMetricsStore] 所有数据已清空')
      return true
    } catch (e) {
      logger.monitoring?.error('[SystemMetricsStore] 清空数据失败:', e)
      return false
    }
  }

  // ============================================================
  // 记录转换工具
  // ============================================================

  private recordToMetrics(r: Record<string, unknown>): SystemMetrics {
    return {
      timestamp: Number(r.timestamp ?? 0),
      cpuUsage: Number(r.cpuUsage ?? 0),
      cpuLoadAvg1: Number(r.cpuLoadAvg1 ?? 0),
      cpuLoadAvg5: Number(r.cpuLoadAvg5 ?? 0),
      cpuLoadAvg15: Number(r.cpuLoadAvg15 ?? 0),
      memoryUsage: Number(r.memoryUsage ?? 0),
      memoryAvailableMB: Number(r.memoryAvailableMB ?? 0),
      memoryTotalMB: Number(r.memoryTotalMB ?? 0),
      diskUsage: Number(r.diskUsage ?? 0),
      diskIoReadKBps: Number(r.diskIoReadKBps ?? 0),
      diskIoWriteKBps: Number(r.diskIoWriteKBps ?? 0),
      networkRxKBps: Number(r.networkRxKBps ?? 0),
      networkTxKBps: Number(r.networkTxKBps ?? 0),
      processCount: Number(r.processCount ?? 0),
      cpuTemperature: Number(r.cpuTemperature ?? -1),
      batteryPercent: Number(r.batteryPercent ?? -1),
      batteryCharging: Boolean(r.batteryCharging),
    }
  }

  private recordToAnomaly(r: Record<string, unknown>): AnomalyEvent {
    let samples: Array<{ timestamp: number; value: number }> = []
    try {
      const v = r.samples
      samples = typeof v === 'string' ? JSON.parse(v) : []
    } catch { /* keep [] */ }

    return {
      id: String(r.id ?? ''),
      timestamp: Number(r.timestamp ?? 0),
      type: String(r.type ?? 'unknown') as AnomalyEvent['type'],
      severity: String(r.severity ?? 'info') as AnomalyEvent['severity'],
      metricType: String(r.metricType ?? 'cpu_usage') as AnomalyEvent['metricType'],
      currentValue: Number(r.currentValue ?? 0),
      predictedPeak: r.predictedPeak ? Number(r.predictedPeak) : undefined,
      predictedTriggerAt: r.predictedTriggerAt ? Number(r.predictedTriggerAt) : undefined,
      description: String(r.description ?? ''),
      recommendation: String(r.recommendation ?? ''),
      status: String(r.status ?? 'active') as AnomalyEvent['status'],
      evidenceWindow: {
        start: Number(r.evidenceStart ?? 0),
        end: Number(r.evidenceEnd ?? 0),
      },
      samples,
    }
  }

  /** 释放资源 */
  async dispose(): Promise<void> {
    this.tables.clear()
    this.db = null
    this.initialized = false
    this.memoryBuffer = []
    this.anomalyBuffer = []
    SystemMetricsStore.instance = null
  }
}
