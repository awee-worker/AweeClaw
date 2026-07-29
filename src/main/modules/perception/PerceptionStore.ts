/**
 * 感知数据存储 — 基于 LanceDB 的本地持久化
 *
 * 存储三类数据：
 * 1. screen_scenes：屏幕场景序列（向量 + 元数据）
 * 2. user_behaviors：用户行为记录（场景-动作对）
 * 3. predictions：预测记录（含实际结果，用于校准）
 *
 * 数据生命周期：
 * - 默认保留 30 天
 * - 后台定时清理过期数据
 * - 隐私模式下不写入磁盘
 *
 * @module perception/PerceptionStore
 */

import { logger } from '@shared/toolkit/LogEngine'
import * as path from 'path'
import * as fs from 'fs'
import { app } from 'electron'
import type {
  ScreenScene,
  UserBehavior,
  Prediction,
  PerceptionPrivacyConfig,
} from './PerceptionInterface'

// ============================================================
// LanceDB 类型定义（与 vectorRepository.ts 保持一致的风格）
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
  orderBy(column: string, direction: 'ASC' | 'DESC'): LanceDbQuery
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
  SCREEN_SCENES: 'screen_scenes',
  USER_BEHAVIORS: 'user_behaviors',
  PREDICTIONS: 'predictions',
} as const

// ============================================================
// 感知数据存储
// ============================================================

/**
 * 感知数据存储管理器
 *
 * 单例模式，主进程启动时初始化。
 * 提供 screen_scenes、user_behaviors、predictions 三张表的 CRUD。
 */
export class PerceptionStore {
  private static instance: PerceptionStore | null = null

  private db: LanceDbConnection | null = null
  private dbPath: string
  private initialized = false
  private privacyConfig: PerceptionPrivacyConfig

  /** 表缓存 */
  private tables: Map<string, LanceDbTable> = new Map()

  private constructor(privacyConfig: PerceptionPrivacyConfig) {
    this.privacyConfig = privacyConfig
    // 数据存储路径：userData/perception-db
    this.dbPath = path.join(app.getPath('userData'), 'perception-db')
  }

  /** 获取单例 */
  static getInstance(privacyConfig?: PerceptionPrivacyConfig): PerceptionStore {
    if (!PerceptionStore.instance) {
      PerceptionStore.instance = new PerceptionStore(
        privacyConfig ?? {
          enablePerception: false,
          channels: {
            screen: false, voice: false, file: true, process: true,
            camera: false, iot: false, network: false,
          },
          retentionDays: 30,
          privacyMode: false,
          cloudFallback: false,
          saveScreenshots: false,
        },
      )
    }
    return PerceptionStore.instance
  }

  /** 更新隐私配置 */
  updatePrivacyConfig(config: Partial<PerceptionPrivacyConfig>): void {
    this.privacyConfig = { ...this.privacyConfig, ...config }
    logger.perception?.info('[PerceptionStore] 隐私配置已更新:', {
      enablePerception: this.privacyConfig.enablePerception,
      privacyMode: this.privacyConfig.privacyMode,
    })
  }

  /** 获取当前隐私配置 */
  getPrivacyConfig(): PerceptionPrivacyConfig {
    return { ...this.privacyConfig }
  }

  /** 初始化数据库连接 */
  async initialize(): Promise<boolean> {
    if (this.initialized) return true

    try {
      // 确保目录存在
      if (!fs.existsSync(this.dbPath)) {
        fs.mkdirSync(this.dbPath, { recursive: true })
      }

      const lancedb = await import('@lancedb/lancedb')
      this.db = (await lancedb.connect(this.dbPath)) as unknown as LanceDbConnection
      this.initialized = true

      logger.perception?.info(`[PerceptionStore] 数据库初始化成功: ${this.dbPath}`)
      return true
    } catch (e) {
      logger.perception?.error('[PerceptionStore] 数据库初始化失败:', e)
      this.db = null
      return false
    }
  }

  /**
   * 预热：在决策引擎首次节拍前异步完成 LanceDB native 模块加载与表打开。
   *
   * 根因：`import('@lancedb/lancedb')` 是 native 模块加载，首次调用会阻塞
   * 主进程事件循环约 2-3 秒。若懒加载到首次查询时才触发，会导致
   * ProactiveDecisionEngine 同一节拍的 10 路信号全部因事件循环阻塞而超时。
   *
   * 本方法在应用启动时（决策引擎 start 之前）异步调用，将阻塞提前到启动阶段，
   * 避免污染决策引擎的节拍采集。
   *
   * @param preloadTables 是否预打开常用表（screen_scenes / user_behaviors / predictions）
   */
  async warmup(preloadTables = true): Promise<boolean> {
    const ok = await this.initialize()
    if (!ok || !preloadTables) return ok

    // 并行预打开三张常用表（ensureTable 内部有缓存，后续查询直接命中）
    const sampleRecords: Record<string, Record<string, unknown>> = {
      [TABLE_NAMES.SCREEN_SCENES]: {
        id: '', timestamp: 0, app: '', windowTitle: '',
        activity: 'unknown', textSummary: '', embedding: [],
        elements: '[]', screenshotDataUrl: null,
      },
      [TABLE_NAMES.USER_BEHAVIORS]: {
        id: '', timestamp: 0, sceneId: '', sceneEmbedding: [],
        scene: '{}', action: '{}', outcome: 'success',
      },
      [TABLE_NAMES.PREDICTIONS]: {
        id: '', timestamp: 0, type: 'behavior', predictedAction: '{}',
        confidence: 0, basedOnBehaviors: '[]', reason: '',
        actualAction: null, feedback: 'ignored',
      },
    }

    await Promise.allSettled(
      Object.entries(sampleRecords).map(([name, sample]) =>
        this.ensureTable(name, sample),
      ),
    )

    logger.perception?.info('[PerceptionStore] 预热完成（DB + 常用表已就绪）')
    return ok
  }

  /** 数据库是否已初始化就绪（供外部探测是否需要 warmup） */
  isReady(): boolean {
    return this.initialized && this.db !== null
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

    // 从缓存读取
    const cached = this.tables.get(name)
    if (cached) return cached

    try {
      const tables = await this.db!.tableNames()
      if (tables.includes(name)) {
        const table = await this.db!.openTable(name)
        this.tables.set(name, table)
        return table
      }

      // 创建新表
      const table = await this.db!.createTable(name, [sampleRecord])
      this.tables.set(name, table)
      logger.perception?.info(`[PerceptionStore] 创建表: ${name}`)
      return table
    } catch (e) {
      logger.perception?.error(`[PerceptionStore] 打开/创建表失败 ${name}:`, e)
      return null
    }
  }

  // ============================================================
  // 屏幕场景
  // ============================================================

  /** 保存屏幕场景 */
  async saveScreenScene(scene: ScreenScene): Promise<boolean> {
    // 隐私模式下不保存
    if (this.privacyConfig.privacyMode || !this.privacyConfig.channels.screen) {
      return false
    }

    const table = await this.ensureTable(TABLE_NAMES.SCREEN_SCENES, {
      id: '',
      timestamp: 0,
      app: '',
      windowTitle: '',
      activity: 'unknown',
      textSummary: '',
      embedding: [],
      elements: '[]',
      screenshotDataUrl: null,
    })
    if (!table) return false

    try {
      await table.add([{
        id: scene.id,
        timestamp: scene.timestamp,
        app: scene.app,
        windowTitle: scene.windowTitle,
        activity: scene.activity,
        textSummary: scene.textSummary,
        embedding: scene.embedding,
        elements: JSON.stringify(scene.elements ?? []),
        // 隐私配置关闭时不保存截图
        screenshotDataUrl: this.privacyConfig.saveScreenshots
          ? (scene.screenshotDataUrl ?? null)
          : null,
      }])
      return true
    } catch (e) {
      logger.perception?.error('[PerceptionStore] 保存屏幕场景失败:', e)
      return false
    }
  }

  /** 检索相似屏幕场景 */
  async searchSimilarScenes(
    embedding: number[],
    topK = 10,
    filter?: string,
  ): Promise<ScreenScene[]> {
    const table = this.tables.get(TABLE_NAMES.SCREEN_SCENES)
    if (!table) return []

    try {
      let query = table.search(embedding).limit(topK)
      if (filter) {
        query = query.where(filter)
      }
      const records = await query.toArray()
      return records.map(r => this.recordToScreenScene(r))
    } catch (e) {
      logger.perception?.error('[PerceptionStore] 检索相似场景失败:', e)
      return []
    }
  }

  /** 获取最近 N 条场景 */
  async getRecentScenes(limit = 20): Promise<ScreenScene[]> {
    const table = this.tables.get(TABLE_NAMES.SCREEN_SCENES)
    if (!table) return []

    try {
      const records = await table.query()
        .limit(limit)
        .toArray()
      return records.map(r => this.recordToScreenScene(r))
    } catch (e) {
      logger.perception?.error('[PerceptionStore] 获取最近场景失败:', e)
      return []
    }
  }

  // ============================================================
  // 用户行为
  // ============================================================

  /** 保存用户行为 */
  async saveUserBehavior(behavior: UserBehavior): Promise<boolean> {
    if (this.privacyConfig.privacyMode) {
      return false
    }

    const table = await this.ensureTable(TABLE_NAMES.USER_BEHAVIORS, {
      id: '',
      timestamp: 0,
      sceneId: '',
      sceneEmbedding: [],
      scene: '{}',
      action: '{}',
      outcome: 'success',
    })
    if (!table) return false

    try {
      await table.add([{
        id: behavior.id,
        timestamp: behavior.timestamp,
        sceneId: behavior.sceneId,
        sceneEmbedding: behavior.sceneEmbedding,
        scene: JSON.stringify(behavior.scene),
        action: JSON.stringify(behavior.action),
        outcome: behavior.outcome ?? 'success',
      }])
      return true
    } catch (e) {
      logger.perception?.error('[PerceptionStore] 保存用户行为失败:', e)
      return false
    }
  }

  /** 检索相似场景下的历史行为 */
  async searchSimilarBehaviors(
    sceneEmbedding: number[],
    topK = 20,
    filter?: string,
  ): Promise<UserBehavior[]> {
    const table = this.tables.get(TABLE_NAMES.USER_BEHAVIORS)
    if (!table) return []

    try {
      let query = table.search(sceneEmbedding).limit(topK)
      if (filter) {
        query = query.where(filter)
      }
      const records = await query.toArray()
      return records.map(r => this.recordToUserBehavior(r))
    } catch (e) {
      logger.perception?.error('[PerceptionStore] 检索相似行为失败:', e)
      return []
    }
  }

  // ============================================================
  // 预测记录
  // ============================================================

  /** 保存预测记录 */
  async savePrediction(prediction: Prediction): Promise<boolean> {
    const table = await this.ensureTable(TABLE_NAMES.PREDICTIONS, {
      id: '',
      timestamp: 0,
      type: 'behavior',
      predictedAction: '{}',
      confidence: 0,
      basedOnBehaviors: '[]',
      reason: '',
      actualAction: null,
      feedback: 'ignored',
    })
    if (!table) return false

    try {
      await table.add([{
        id: prediction.id,
        timestamp: prediction.timestamp,
        type: prediction.type,
        predictedAction: JSON.stringify(prediction.predictedAction),
        confidence: prediction.confidence,
        basedOnBehaviors: JSON.stringify(prediction.basedOnBehaviors),
        reason: prediction.reason,
        actualAction: prediction.actualAction ? JSON.stringify(prediction.actualAction) : null,
        feedback: prediction.feedback ?? 'ignored',
      }])
      return true
    } catch (e) {
      logger.perception?.error('[PerceptionStore] 保存预测记录失败:', e)
      return false
    }
  }

  /** 更新预测的实际结果（用于校准） */
  async updatePredictionOutcome(
    predictionId: string,
    actualAction: UserBehavior['action'],
    feedback?: 'accepted' | 'rejected' | 'ignored',
  ): Promise<boolean> {
    // LanceDB 不支持单行更新，通过删除+重新插入实现
    const table = this.tables.get(TABLE_NAMES.PREDICTIONS)
    if (!table) return false

    try {
      // 查找原记录
      const records = await table.query()
        .where(`id = '${predictionId}'`)
        .toArray()

      if (records.length === 0) return false

      const original = records[0]
      // 删除原记录
      await table.delete(`id = '${predictionId}'`)

      // 插入更新后的记录
      await table.add([{
        ...original,
        actualAction: JSON.stringify(actualAction),
        feedback: feedback ?? original.feedback ?? 'ignored',
      }])

      return true
    } catch (e) {
      logger.perception?.error('[PerceptionStore] 更新预测结果失败:', e)
      return false
    }
  }

  /**
   * 获取指定时间之后的预测记录
   *
   * 用于统计命中率与反馈分布。
   *
   * @param since 起始时间戳（ms）
   * @returns 预测记录列表（已反序列化 predictedAction/actualAction/basedOnBehaviors）
   */
  async getPredictionsSince(since: number): Promise<Array<{
    id: string
    timestamp: number
    type: string
    predictedAction: unknown
    confidence: number
    basedOnBehaviors: string[]
    reason: string
    actualAction: unknown
    feedback: 'accepted' | 'rejected' | 'ignored'
    /** 是否命中（actualAction 存在且类型/目标匹配 predictedAction） */
    hit: boolean
  }>> {
    const table = this.tables.get(TABLE_NAMES.PREDICTIONS)
    if (!table) return []

    try {
      const raw = await table.query()
        .where(`timestamp >= ${since}`)
        .toArray()

      return raw.map((r: Record<string, unknown>) => {
        let predictedAction: unknown = null
        let actualAction: unknown = null
        let basedOnBehaviors: string[] = []
        try {
          const v = r.predictedAction
          predictedAction = typeof v === 'string' ? JSON.parse(v) : v
        } catch { /* keep null */ }
        try {
          const v = r.actualAction
          actualAction = typeof v === 'string' && v ? JSON.parse(v) : null
        } catch { /* keep null */ }
        try {
          const v = r.basedOnBehaviors
          basedOnBehaviors = typeof v === 'string' ? JSON.parse(v) : []
        } catch { /* keep [] */ }

        const pa = predictedAction as { type?: string; target?: string } | null
        const aa = actualAction as { type?: string; target?: string } | null

        // 命中定义：actualAction 存在，且 type 或 target 与 predictedAction 一致
        const hit = !!aa && !!pa && (
          aa.type === pa.type ||
          aa.target === pa.target
        )

        return {
          id: String(r.id ?? ''),
          timestamp: Number(r.timestamp ?? 0),
          type: String(r.type ?? 'behavior'),
          predictedAction,
          confidence: Number(r.confidence ?? 0),
          basedOnBehaviors,
          reason: String(r.reason ?? ''),
          actualAction,
          feedback: (String(r.feedback ?? 'ignored')) as 'accepted' | 'rejected' | 'ignored',
          hit,
        }
      })
    } catch (e) {
      logger.perception?.error('[PerceptionStore] getPredictionsSince 失败:', e)
      return []
    }
  }

  // ============================================================
  // 阶段2：场景时间轴与行为热力图
  // ============================================================

  /**
   * 获取指定时间范围内的场景时间轴数据
   *
   * 用于渲染历史场景浏览界面，按时间倒序返回。
   *
   * @param startDate 起始时间戳（ms，包含）
   * @param endDate   结束时间戳（ms，包含）
   * @param limit     最大返回数量（默认 500，防止数据量过大）
   */
  async getSceneTimeline(
    startDate: number,
    endDate: number,
    limit = 500,
  ): Promise<ScreenScene[]> {
    const table = this.tables.get(TABLE_NAMES.SCREEN_SCENES)
    if (!table) return []

    try {
      const records = await table.query()
        .where(`timestamp >= ${startDate} AND timestamp <= ${endDate}`)
        .limit(limit)
        .toArray()
      // 按时间倒序排序（LanceDB orderBy 支持度不一致，这里在内存中排序）
      const scenes = records.map(r => this.recordToScreenScene(r))
      scenes.sort((a, b) => b.timestamp - a.timestamp)
      return scenes
    } catch (e) {
      logger.perception?.error('[PerceptionStore] getSceneTimeline 失败:', e)
      return []
    }
  }

  /**
   * 获取行为热力图数据
   *
   * 返回一个网格：每天 × 每小时（24小时）的行为计数。
   * 用于渲染 GitHub-style 热力图，帮助用户了解自己的工作模式。
   *
   * @param days 跨越天数（默认 14 天）
   * @returns 热力图单元格数组
   */
  async getBehaviorHeatmap(
    days = 14,
  ): Promise<Array<{
    /** 日期（YYYY-MM-DD） */
    date: string
    /** 小时（0-23） */
    hour: number
    /** 该时段的行为数量 */
    count: number
    /** 主要活动类型（出现次数最多的 activity） */
    topActivity: string
  }>> {
    const table = this.tables.get(TABLE_NAMES.USER_BEHAVIORS)
    if (!table) return []

    try {
      const now = Date.now()
      const startTime = now - days * 24 * 60 * 60 * 1000

      const records = await table.query()
        .where(`timestamp >= ${startTime}`)
        .limit(10000)
        .toArray()

      // 按 (date, hour) 聚合
      const grid = new Map<string, { count: number; activities: Map<string, number> }>()
      for (const r of records) {
        const ts = Number(r.timestamp ?? 0)
        if (!ts) continue
        const d = new Date(ts)
        const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        const hour = d.getHours()
        const key = `${dateStr}_${hour}`

        let cell = grid.get(key)
        if (!cell) {
          cell = { count: 0, activities: new Map() }
          grid.set(key, cell)
        }
        cell.count++

        // 解析 scene 中的 activity
        try {
          const sceneRaw = r.scene
          const scene = typeof sceneRaw === 'string' ? JSON.parse(sceneRaw) : sceneRaw
          const activity = String(scene?.activity ?? 'unknown')
          cell.activities.set(activity, (cell.activities.get(activity) ?? 0) + 1)
        } catch {
          cell.activities.set('unknown', (cell.activities.get('unknown') ?? 0) + 1)
        }
      }

      // 转换为数组并找出每个单元格的 top activity
      const result: Array<{ date: string; hour: number; count: number; topActivity: string }> = []
      for (const [key, cell] of grid.entries()) {
        const [date, hourStr] = key.split('_')
        let topActivity = 'unknown'
        let topCount = 0
        for (const [activity, count] of cell.activities.entries()) {
          if (count > topCount) {
            topCount = count
            topActivity = activity
          }
        }
        result.push({
          date,
          hour: Number(hourStr),
          count: cell.count,
          topActivity,
        })
      }

      // 按日期升序、小时升序排列
      result.sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date)
        return a.hour - b.hour
      })

      return result
    } catch (e) {
      logger.perception?.error('[PerceptionStore] getBehaviorHeatmap 失败:', e)
      return []
    }
  }

  /**
   * 获取指定时间范围内的用户行为列表
   *
   * @param startTime 起始时间戳（ms）
   * @param endTime   结束时间戳（ms）
   * @param limit     最大返回数量
   */
  async getBehaviorsByTimeRange(
    startTime: number,
    endTime: number,
    limit = 1000,
  ): Promise<UserBehavior[]> {
    const table = this.tables.get(TABLE_NAMES.USER_BEHAVIORS)
    if (!table) return []

    try {
      const records = await table.query()
        .where(`timestamp >= ${startTime} AND timestamp <= ${endTime}`)
        .limit(limit)
        .toArray()
      const behaviors = records.map(r => this.recordToUserBehavior(r))
      behaviors.sort((a, b) => b.timestamp - a.timestamp)
      return behaviors
    } catch (e) {
      logger.perception?.error('[PerceptionStore] getBehaviorsByTimeRange 失败:', e)
      return []
    }
  }

  // ============================================================
  // 数据清理
  // ============================================================

  /** 清理过期数据 */
  async cleanupExpiredData(): Promise<void> {
    const cutoff = Date.now() - this.privacyConfig.retentionDays * 24 * 60 * 60 * 1000

    for (const tableName of Object.values(TABLE_NAMES)) {
      const table = this.tables.get(tableName)
      if (!table) continue

      try {
        await table.delete(`timestamp < ${cutoff}`)
        logger.perception?.info(`[PerceptionStore] 清理过期数据: ${tableName}`)
      } catch (e) {
        logger.perception?.error(`[PerceptionStore] 清理失败 ${tableName}:`, e)
      }
    }
  }

  /** 清空所有数据 */
  async clearAllData(): Promise<boolean> {
    if (!this.db) return false

    try {
      for (const tableName of Object.values(TABLE_NAMES)) {
        const tables = await this.db.tableNames()
        if (tables.includes(tableName)) {
          await this.db.dropTable(tableName)
        }
      }
      this.tables.clear()
      logger.perception?.info('[PerceptionStore] 所有数据已清空')
      return true
    } catch (e) {
      logger.perception?.error('[PerceptionStore] 清空数据失败:', e)
      return false
    }
  }

  // ============================================================
  // 记录转换工具
  // ============================================================

  private recordToScreenScene(r: Record<string, unknown>): ScreenScene {
    return {
      id: String(r.id ?? ''),
      timestamp: Number(r.timestamp ?? 0),
      app: String(r.app ?? ''),
      windowTitle: String(r.windowTitle ?? ''),
      activity: String(r.activity ?? 'unknown') as ScreenScene['activity'],
      textSummary: String(r.textSummary ?? ''),
      embedding: Array.isArray(r.embedding) ? (r.embedding as number[]) : [],
      elements: r.elements ? JSON.parse(String(r.elements)) : undefined,
      screenshotDataUrl: r.screenshotDataUrl ? String(r.screenshotDataUrl) : undefined,
    }
  }

  private recordToUserBehavior(r: Record<string, unknown>): UserBehavior {
    const scene = r.scene ? JSON.parse(String(r.scene)) : {}
    const action = r.action ? JSON.parse(String(r.action)) : {}
    return {
      id: String(r.id ?? ''),
      timestamp: Number(r.timestamp ?? 0),
      sceneId: String(r.sceneId ?? ''),
      sceneEmbedding: Array.isArray(r.sceneEmbedding) ? (r.sceneEmbedding as number[]) : [],
      scene,
      action,
      outcome: String(r.outcome ?? 'success') as UserBehavior['outcome'],
    }
  }

  /** 释放资源 */
  async dispose(): Promise<void> {
    this.tables.clear()
    this.db = null
    this.initialized = false
    PerceptionStore.instance = null
  }
}
