/**
 * 会话效果指标存储 — 基于 LanceDB 的本地持久化
 *
 * 存两张表：
 * 1. session_effect  — 每条会话一行，记录执行过程指标
 * 2. plugin_quality  — 插件工具调用质量，按时间窗口聚合
 *
 * 与 SystemMetricsStore 的分工：那张表回答「机器累不累」（CPU / 内存 / 磁盘），
 * 本表回答「任务顺不顺」（绕了多少弯路、循环拦了几次、要不要人盯着）。
 * 两者互不替代，各自解决一类问题。
 *
 * 落盘策略：数据只写本地，不上报；不记录工具参数内容，只记参数签名。
 * 会话结束才写一次，不在执行过程中逐步落盘，避免给主循环加实时写盘开销。
 *
 * @module effect-metrics/EffectMetricsStore
 */

import { logger } from '@shared/toolkit/LogEngine'
import * as path from 'path'
import * as fs from 'fs'
import { app } from 'electron'

// ============================================================
// LanceDB 连接的最小接口（只声明用到的部分）
// ============================================================

interface LanceDbConnection {
  tableNames(): Promise<string[]>
  openTable(name: string): Promise<LanceDbTable>
  createTable(name: string, data: unknown[]): Promise<LanceDbTable>
}

interface LanceDbTable {
  add(data: unknown[]): Promise<void>
  delete(filter: string): Promise<void>
  query(): LanceDbQuery
}

interface LanceDbQuery {
  where(filter: string): LanceDbQuery
  limit(n: number): LanceDbQuery
  toArray(): Promise<Record<string, unknown>[]>
}

// ============================================================
// 表名常量
// ============================================================

const TABLE_NAMES = {
  SESSION_EFFECT: 'session_effect',
  PLUGIN_QUALITY: 'plugin_quality',
} as const

/** 单次查询返回上限：效果面板看的是近期分布，不需要全量拉取 */
const DEFAULT_QUERY_LIMIT = 500

/**
 * 各表的定型样本
 *
 * 建表与查询共用同一份：查询路径没有记录可传，若拿空对象去建表，
 * 建出来的表没有任何字段，之后写入会直接撞 schema 不匹配。
 */
const TABLE_SAMPLES: Record<string, Record<string, unknown>> = {
  [TABLE_NAMES.SESSION_EFFECT]: {
    id: '',
    sessionId: '',
    scenarioId: null,
    startedAt: 0,
    endedAt: 0,
    durationMs: 0,
    totalSteps: 0,
    futileRetries: 0,
    futileRetryRatio: 0,
    loopDetections: 0,
    firstUsefulStep: null,
    compressionEvents: 0,
    approvalTotal: 0,
    interventions: 0,
    avgCpuPercent: null,
    peakMemoryMb: null,
    eventLoopDelayMs: null,
    inputTokens: 0,
    outputTokens: 0,
    createdAt: 0,
  },
  [TABLE_NAMES.PLUGIN_QUALITY]: {
    id: '',
    pluginId: '',
    toolName: '',
    windowStart: 0,
    windowEnd: 0,
    calls: 0,
    failures: 0,
    invalidArgs: 0,
    timeouts: 0,
    avgDurationMs: 0,
    p95DurationMs: 0,
    createdAt: 0,
  },
}

// ============================================================
// 记录结构
// ============================================================

/** 一条会话效果记录 */
export interface SessionEffectRecord {
  id: string
  sessionId: string
  /** 所属场景，空表示通用助手 */
  scenarioId: string | null
  startedAt: number
  endedAt: number
  durationMs: number

  totalSteps: number
  futileRetries: number
  futileRetryRatio: number
  loopDetections: number
  firstUsefulStep: number | null
  compressionEvents: number

  approvalTotal: number
  interventions: number

  avgCpuPercent: number | null
  peakMemoryMb: number | null
  eventLoopDelayMs: number | null

  inputTokens: number
  outputTokens: number

  createdAt: number
}

/** 一条插件工具质量记录 */
export interface PluginQualityRecord {
  id: string
  pluginId: string
  toolName: string
  windowStart: number
  windowEnd: number
  calls: number
  failures: number
  invalidArgs: number
  timeouts: number
  avgDurationMs: number
  p95DurationMs: number
  createdAt: number
}

/**
 * 会话效果存储
 *
 * 单例。表按需创建，首次打开时用一条样本记录定型 schema。
 */
export class EffectMetricsStore {
  private static instance: EffectMetricsStore | null = null

  private db: LanceDbConnection | null = null
  private dbPath: string
  private initialized = false
  private tables: Map<string, LanceDbTable> = new Map()

  private constructor() {
    this.dbPath = path.join(app.getPath('userData'), 'effect-metrics-db')
  }

  static getInstance(): EffectMetricsStore {
    if (!EffectMetricsStore.instance) {
      EffectMetricsStore.instance = new EffectMetricsStore()
    }
    return EffectMetricsStore.instance
  }

  /** 建立数据库连接 */
  async initialize(): Promise<boolean> {
    if (this.initialized) return true

    try {
      if (!fs.existsSync(this.dbPath)) {
        fs.mkdirSync(this.dbPath, { recursive: true })
      }
      const lancedb = await import('@lancedb/lancedb')
      this.db = (await lancedb.connect(this.dbPath)) as unknown as LanceDbConnection
      this.initialized = true
      logger.effectMetrics?.info(`[EffectMetricsStore] 数据库初始化成功: ${this.dbPath}`)
      return true
    } catch (e) {
      logger.effectMetrics?.error('[EffectMetricsStore] 数据库初始化失败:', e)
      this.db = null
      return false
    }
  }

  /** 确保表存在 */
  private async ensureTable(
    name: string,
    sampleRecord?: Record<string, unknown>,
  ): Promise<LanceDbTable | null> {
    if (!this.db) {
      const ok = await this.initialize()
      if (!ok) return null
    }

    const cached = this.tables.get(name)
    if (cached) return cached

    // 调用方没给样本时回退到内置定型样本，避免查询路径建出无字段的表
    const sample =
      sampleRecord && Object.keys(sampleRecord).length > 0
        ? sampleRecord
        : (TABLE_SAMPLES[name] ?? {})

    try {
      const existed = (await this.db!.tableNames()).includes(name)
      const table = existed
        ? await this.db!.openTable(name)
        : await this.db!.createTable(name, [sample])
      this.tables.set(name, table)
      if (!existed) {
        logger.effectMetrics?.info(`[EffectMetricsStore] 创建表: ${name}`)
      }
      return table
    } catch (e) {
      logger.effectMetrics?.error(`[EffectMetricsStore] 打开/创建表失败 ${name}:`, e)
      return null
    }
  }

  // ============================================================
  // 会话效果
  // ============================================================

  /** 写入一条会话效果记录 */
  async saveSession(record: SessionEffectRecord): Promise<boolean> {
    const table = await this.ensureTable(TABLE_NAMES.SESSION_EFFECT, {
      id: '',
      sessionId: '',
      scenarioId: null,
      startedAt: 0,
      endedAt: 0,
      durationMs: 0,
      totalSteps: 0,
      futileRetries: 0,
      futileRetryRatio: 0,
      loopDetections: 0,
      firstUsefulStep: null,
      compressionEvents: 0,
      approvalTotal: 0,
      interventions: 0,
      avgCpuPercent: null,
      peakMemoryMb: null,
      eventLoopDelayMs: null,
      inputTokens: 0,
      outputTokens: 0,
      createdAt: 0,
    })
    if (!table) return false

    try {
      await table.add([record])
      return true
    } catch (e) {
      logger.effectMetrics?.error('[EffectMetricsStore] 保存会话效果失败:', e)
      return false
    }
  }

  /**
   * 按时间区间读取会话效果
   *
   * since / until 均为毫秒时间戳，闭区间。结果按开始时间升序，
   * 便于调用方直接做时序聚合。
   */
  async getSessionsByRange(
    since: number,
    until: number,
    limit = DEFAULT_QUERY_LIMIT,
  ): Promise<SessionEffectRecord[]> {
    const table = await this.ensureTable(TABLE_NAMES.SESSION_EFFECT, {})
    if (!table) return []

    try {
      const rows = await table
        .query()
        .where(`startedAt >= ${since} AND startedAt <= ${until}`)
        .limit(limit)
        .toArray()
      const records = rows.map(rowToSessionEffect)
      records.sort((a, b) => a.startedAt - b.startedAt)
      return records
    } catch (e) {
      logger.effectMetrics?.error('[EffectMetricsStore] 查询会话效果失败:', e)
      return []
    }
  }

  /**
   * 读取某条会话的全部执行轮次
   *
   * 一轮对话被中断后续接时会产生多条记录（每次主循环各写一行），
   * 所以这里返回列表，由调用方决定是聚合还是取最新一条。
   */
  async getSessionsBySessionId(sessionId: string): Promise<SessionEffectRecord[]> {
    const table = await this.ensureTable(TABLE_NAMES.SESSION_EFFECT, {})
    if (!table) return []

    try {
      const rows = await table
        .query()
        .where(`sessionId = '${escapeLiteral(sessionId)}'`)
        .limit(DEFAULT_QUERY_LIMIT)
        .toArray()
      const records = rows.map(rowToSessionEffect)
      records.sort((a, b) => a.startedAt - b.startedAt)
      return records
    } catch (e) {
      logger.effectMetrics?.error('[EffectMetricsStore] 查询会话记录失败:', e)
      return []
    }
  }

  /**
   * 读取某场景在时间区间内的会话
   *
   * 场景过滤下沉到查询条件而非取回内存再筛：窗口内通用助手的会话量远大
   * 于单个场景，若先按区间取回再过滤，通用会话会把结果顶到 limit 上限，
   * 该场景的记录被截掉，样本量看起来偏小。
   */
  async getSessionsByScenario(
    scenarioId: string,
    since: number,
    until: number,
    limit = DEFAULT_QUERY_LIMIT,
  ): Promise<SessionEffectRecord[]> {
    const table = await this.ensureTable(TABLE_NAMES.SESSION_EFFECT, {})
    if (!table) return []

    try {
      const rows = await table
        .query()
        .where(
          `scenarioId = '${escapeLiteral(scenarioId)}' ` +
          `AND startedAt >= ${since} AND startedAt <= ${until}`,
        )
        .limit(limit)
        .toArray()
      const records = rows.map(rowToSessionEffect)
      records.sort((a, b) => a.startedAt - b.startedAt)
      return records
    } catch (e) {
      logger.effectMetrics?.error('[EffectMetricsStore] 按场景查询会话失败:', e)
      return []
    }
  }

  // ============================================================
  // 插件工具质量
  // ============================================================

  /** 写入一条插件工具质量记录 */
  async savePluginQuality(record: PluginQualityRecord): Promise<boolean> {
    const table = await this.ensureTable(TABLE_NAMES.PLUGIN_QUALITY, {
      id: '',
      pluginId: '',
      toolName: '',
      windowStart: 0,
      windowEnd: 0,
      calls: 0,
      failures: 0,
      invalidArgs: 0,
      timeouts: 0,
      avgDurationMs: 0,
      p95DurationMs: 0,
      createdAt: 0,
    })
    if (!table) return false

    try {
      await table.add([record])
      return true
    } catch (e) {
      logger.effectMetrics?.error('[EffectMetricsStore] 保存插件质量失败:', e)
      return false
    }
  }

  /** 按时间区间读取插件工具质量记录 */
  async getPluginQualityByRange(
    since: number,
    until: number,
    pluginId?: string,
    limit = DEFAULT_QUERY_LIMIT,
  ): Promise<PluginQualityRecord[]> {
    const table = await this.ensureTable(TABLE_NAMES.PLUGIN_QUALITY, {})
    if (!table) return []

    const conditions = [`windowStart >= ${since}`, `windowStart <= ${until}`]
    if (pluginId) conditions.push(`pluginId = '${escapeLiteral(pluginId)}'`)

    try {
      const rows = await table
        .query()
        .where(conditions.join(' AND '))
        .limit(limit)
        .toArray()
      const records = rows.map(rowToPluginQuality)
      records.sort((a, b) => a.windowStart - b.windowStart)
      return records
    } catch (e) {
      logger.effectMetrics?.error('[EffectMetricsStore] 查询插件质量失败:', e)
      return []
    }
  }

  // ============================================================
  // 维护
  // ============================================================

  /** 清空两张表的数据 */
  async clearAll(): Promise<boolean> {
    let ok = true
    for (const name of Object.values(TABLE_NAMES)) {
      const table = this.tables.get(name)
      if (!table) continue
      try {
        // LanceDB 无 truncate，用全量删除条件代替
        await table.delete('createdAt >= 0')
      } catch (e) {
        logger.effectMetrics?.error(`[EffectMetricsStore] 清空 ${name} 失败:`, e)
        ok = false
      }
    }
    return ok
  }
}

// ============================================================
// 行 → 记录
// ============================================================

function rowToSessionEffect(row: Record<string, unknown>): SessionEffectRecord {
  return {
    id: String(row.id ?? ''),
    sessionId: String(row.sessionId ?? ''),
    scenarioId: row.scenarioId == null ? null : String(row.scenarioId),
    startedAt: Number(row.startedAt ?? 0),
    endedAt: Number(row.endedAt ?? 0),
    durationMs: Number(row.durationMs ?? 0),
    totalSteps: Number(row.totalSteps ?? 0),
    futileRetries: Number(row.futileRetries ?? 0),
    futileRetryRatio: Number(row.futileRetryRatio ?? 0),
    loopDetections: Number(row.loopDetections ?? 0),
    firstUsefulStep: row.firstUsefulStep == null ? null : Number(row.firstUsefulStep),
    compressionEvents: Number(row.compressionEvents ?? 0),
    approvalTotal: Number(row.approvalTotal ?? 0),
    interventions: Number(row.interventions ?? 0),
    avgCpuPercent: row.avgCpuPercent == null ? null : Number(row.avgCpuPercent),
    peakMemoryMb: row.peakMemoryMb == null ? null : Number(row.peakMemoryMb),
    eventLoopDelayMs: row.eventLoopDelayMs == null ? null : Number(row.eventLoopDelayMs),
    inputTokens: Number(row.inputTokens ?? 0),
    outputTokens: Number(row.outputTokens ?? 0),
    createdAt: Number(row.createdAt ?? 0),
  }
}

function rowToPluginQuality(row: Record<string, unknown>): PluginQualityRecord {
  return {
    id: String(row.id ?? ''),
    pluginId: String(row.pluginId ?? ''),
    toolName: String(row.toolName ?? ''),
    windowStart: Number(row.windowStart ?? 0),
    windowEnd: Number(row.windowEnd ?? 0),
    calls: Number(row.calls ?? 0),
    failures: Number(row.failures ?? 0),
    invalidArgs: Number(row.invalidArgs ?? 0),
    timeouts: Number(row.timeouts ?? 0),
    avgDurationMs: Number(row.avgDurationMs ?? 0),
    p95DurationMs: Number(row.p95DurationMs ?? 0),
    createdAt: Number(row.createdAt ?? 0),
  }
}

/** 单引号转义：会话 id 可能来自场景包，不能直接拼进过滤表达式 */
function escapeLiteral(value: string): string {
  return value.replace(/'/g, "''")
}
