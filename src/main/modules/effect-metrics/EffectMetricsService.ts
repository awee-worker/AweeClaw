/**
 * 会话效果聚合服务
 *
 * 定位：把「这次任务跑得顺不顺」变成一份可读报告，而不是让人去翻四五个日志文件。
 *
 * 数据分工（哪一路由谁提供）：
 * - 轨迹指标   → 渲染层采集后写入，本服务落库并读取
 * - 操作审计   → 主进程 audit-trail
 * - 资源开销   → 主进程 monitoring 采样（CPU / 内存）
 * - 离线基线   → 渲染层（评测框架在渲染进程，主进程拿不到）
 * - 审批开销   → 渲染层（审批台账存在渲染层本地存储）
 * - 价值换算   → 后端 roi-analysis，由渲染层发起
 *
 * 渲染层拿不到的三路在这里聚合，另外三路由渲染层补齐后合并。
 * 任何一路缺数据都不报错，只在 notes 里标注缺了什么。
 *
 * @module effect-metrics/EffectMetricsService
 */

import { logger } from '@shared/toolkit/LogEngine'
import { auditLogService } from '../audit-trail/AuditLogService'
import { MonitoringService } from '../monitoring/MonitoringService'
import {
  EffectMetricsStore,
  type PluginQualityRecord,
  type SessionEffectRecord,
} from './EffectMetricsStore'
import {
  compareQualityBaseline,
  type QualityGateConfig,
  type QualityGateResult,
  type QualityGateScope,
  type QualitySnapshot,
} from './qualityGate'

export type {
  QualityGateConfig,
  QualityGateResult,
  QualityGateScope,
  QualitySnapshot,
  QualityMetricDelta,
} from './qualityGate'

// ============================================================
// 查询与报告契约
// ============================================================

export interface EffectMetricsQuery {
  scope: 'session' | 'project' | 'period'
  /** session 传 sessionId；project 传项目 id；period 传任意标识 */
  scopeId: string
  /** period / project 模式下的时间窗口（毫秒时间戳） */
  since?: number
  until?: number
}

/** 质量门调用选项 */
export interface QualityGateOptions {
  /** 当前窗口起点，缺省为 until 往前 7 天 */
  since?: number
  /** 当前窗口终点，缺省为当前时间 */
  until?: number
  /**
   * 显式指定基线快照
   *
   * 传 null 表示按「无基线」处理（只建立基线不断言），与「未传该字段」
   * 的含义不同：后者会自动取前一个等长窗口。
   */
  baseline?: QualitySnapshot | null
  /** 门禁配置覆盖，缺省用 DEFAULT_QUALITY_GATE_CONFIG */
  config?: Partial<QualityGateConfig>
}

/** 轨迹指标摘要 */
export interface SessionEffectSummary {
  totalSteps: number
  futileRetries: number
  futileRetryRatio: number
  loopDetections: number
  firstUsefulStep: number | null
  compressionEvents: number
  durationMs: number
  /** 参与聚合的会话条数，session 模式恒为 1 */
  sessionCount: number
}

/** 审批开销摘要（由渲染层补齐） */
export interface ApprovalEffect {
  total: number
  byType: Record<string, number>
  /** 人工介入次数，越低越好 */
  interventions: number
}

/** 操作审计摘要 */
export interface AuditEffect {
  allow: number
  deny: number
  error: number
}

/** 资源开销摘要 */
export interface ResourceEffect {
  avgCpuPercent: number | null
  peakMemoryMB: number | null
  /** 事件循环延迟（ms），无采样来源时为 null */
  eventLoopDelayMs: number | null
}

/** 价值换算摘要（由渲染层补齐） */
export interface ValueEffect {
  savedMinutes: number
  roiPercent: number
}

export interface EffectReport {
  generatedAt: string
  scope: 'session' | 'project' | 'period'
  scopeId: string
  session?: SessionEffectSummary
  approval?: ApprovalEffect
  audit?: AuditEffect
  resource?: ResourceEffect
  /** 离线评测基线（最新一轮），由渲染层补齐 */
  baseline?: unknown
  /** 价值换算，由渲染层补齐 */
  value?: ValueEffect
  /** 缺项与口径说明，供 UI 直接展示 */
  notes: string[]
}

// ============================================================
// 写入契约
// ============================================================

/** 会话结束时由渲染层提交的轨迹指标 */
export interface RecordSessionInput {
  sessionId: string
  scenarioId?: string
  startedAt: number
  endedAt: number
  metrics: {
    totalSteps: number
    futileRetries: number
    futileRetryRatio: number
    loopDetections: number
    firstUsefulStep: number | null
    compressionEvents: number
  }
  /** 本次会话的道具审批次数（渲染层账本口径） */
  approvalTotal?: number
  /** 其中需要人工决策的介入次数 */
  interventions?: number
  inputTokens?: number
  outputTokens?: number
}

/** 一次插件工具调用 */
export interface RecordToolCallInput {
  pluginId: string
  toolName: string
  success: boolean
  invalidArgs: boolean
  timedOut: boolean
  durationMs: number
}

/** 插件工具质量聚合窗口：一小时 */
const PLUGIN_WINDOW_MS = 60 * 60 * 1000

/**
 * 质量门默认评估窗口：7 天
 *
 * 与效果面板默认窗口保持一致。窗口太短则样本不足、门禁频繁放行；太长则
 * 基线被稀释，真实劣化会淹没在历史平均里。
 */
const DEFAULT_GATE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

// ============================================================
// 服务
// ============================================================

export class EffectMetricsService {
  private static instance: EffectMetricsService | null = null

  private store: EffectMetricsStore

  /** 插件调用在窗口内的累计，达到窗口边界才落库 */
  private pluginBuckets = new Map<string, PluginQualityBucket>()

  private constructor() {
    this.store = EffectMetricsStore.getInstance()
  }

  static getInstance(): EffectMetricsService {
    if (!EffectMetricsService.instance) {
      EffectMetricsService.instance = new EffectMetricsService()
    }
    return EffectMetricsService.instance
  }

  async initialize(): Promise<boolean> {
    return this.store.initialize()
  }

  // ============================================================
  // 写入
  // ============================================================

  /**
   * 记录一次会话的效果
   *
   * 资源开销取会话时间窗口内的 monitoring 采样，采样可能因监控关闭而缺失，
   * 缺失时三项记为 null，不阻断写入 —— 轨迹指标本身已足够有价值。
   */
  async recordSession(input: RecordSessionInput): Promise<boolean> {
    const resource = await this.collectResource(input.startedAt, input.endedAt)

    const record: SessionEffectRecord = {
      id: `${input.sessionId}-${input.endedAt}`,
      sessionId: input.sessionId,
      scenarioId: input.scenarioId ?? null,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      durationMs: Math.max(0, input.endedAt - input.startedAt),
      totalSteps: input.metrics.totalSteps,
      futileRetries: input.metrics.futileRetries,
      futileRetryRatio: input.metrics.futileRetryRatio,
      loopDetections: input.metrics.loopDetections,
      firstUsefulStep: input.metrics.firstUsefulStep,
      compressionEvents: input.metrics.compressionEvents,
      approvalTotal: input.approvalTotal ?? 0,
      interventions: input.interventions ?? 0,
      avgCpuPercent: resource.avgCpuPercent,
      peakMemoryMb: resource.peakMemoryMB,
      eventLoopDelayMs: resource.eventLoopDelayMs,
      inputTokens: input.inputTokens ?? 0,
      outputTokens: input.outputTokens ?? 0,
      createdAt: Date.now(),
    }

    const ok = await this.store.saveSession(record)
    if (ok) {
      logger.effectMetrics?.info(
        `[EffectMetricsService] 会话效果已记录: ${input.sessionId} ` +
        `steps=${record.totalSteps} futileRetries=${record.futileRetries} loops=${record.loopDetections}`,
      )
    }
    return ok
  }

  /**
   * 记录一次插件工具调用
   *
   * 不逐次落库：一次调用写一行会让表迅速膨胀，而质量门看的是窗口级比率。
   * 先在内存按「插件 + 工具 + 小时窗口」聚合，跨窗口时把上一窗口结清。
   */
  async recordToolCall(input: RecordToolCallInput): Promise<void> {
    const windowStart = Math.floor(Date.now() / PLUGIN_WINDOW_MS) * PLUGIN_WINDOW_MS
    const key = `${input.pluginId}::${input.toolName}::${windowStart}`

    // 该插件有更早的窗口未结清 → 先落库，避免内存里长期挂着历史窗口
    for (const [bucketKey, bucket] of this.pluginBuckets) {
      if (bucket.windowStart < windowStart && bucketKey.startsWith(`${input.pluginId}::`)) {
        this.pluginBuckets.delete(bucketKey)
        await this.flushBucket(bucket)
      }
    }

    const bucket = this.pluginBuckets.get(key) ?? {
      pluginId: input.pluginId,
      toolName: input.toolName,
      windowStart,
      calls: 0,
      failures: 0,
      invalidArgs: 0,
      timeouts: 0,
      durations: [],
    }

    bucket.calls++
    if (!input.success) bucket.failures++
    if (input.invalidArgs) bucket.invalidArgs++
    if (input.timedOut) bucket.timeouts++
    if (Number.isFinite(input.durationMs) && input.durationMs >= 0) {
      bucket.durations.push(input.durationMs)
    }

    this.pluginBuckets.set(key, bucket)
  }

  /** 把内存里所有未落库的窗口结清（退出前或面板打开前调用） */
  async flushPluginBuckets(): Promise<void> {
    const buckets = Array.from(this.pluginBuckets.values())
    this.pluginBuckets.clear()
    for (const bucket of buckets) {
      await this.flushBucket(bucket)
    }
  }

  private async flushBucket(bucket: PluginQualityBucket): Promise<void> {
    if (bucket.calls === 0) return

    const record: PluginQualityRecord = {
      id: `${bucket.pluginId}-${bucket.toolName}-${bucket.windowStart}`,
      pluginId: bucket.pluginId,
      toolName: bucket.toolName,
      windowStart: bucket.windowStart,
      windowEnd: bucket.windowStart + PLUGIN_WINDOW_MS,
      calls: bucket.calls,
      failures: bucket.failures,
      invalidArgs: bucket.invalidArgs,
      timeouts: bucket.timeouts,
      avgDurationMs: average(bucket.durations),
      p95DurationMs: percentile(bucket.durations, 0.95),
      createdAt: Date.now(),
    }

    await this.store.savePluginQuality(record)
  }

  // ============================================================
  // 查询
  // ============================================================

  /**
   * 查询效果报告
   *
   * session 模式只取该会话本身；project / period 模式在时间窗口内跨会话聚合。
   * 未指定窗口时按最近 7 天取值，避免把全量历史拉进面板。
   */
  async query(query: EffectMetricsQuery): Promise<EffectReport> {
    const notes: string[] = []
    const report: EffectReport = {
      generatedAt: new Date().toISOString(),
      scope: query.scope,
      scopeId: query.scopeId,
      notes,
    }

    const window = resolveWindow(query)

    // ① 轨迹
    if (query.scope === 'session') {
      // 续接续跑会把同一会话写成多条轮次记录，合并后再呈现
      const records = await this.store.getSessionsBySessionId(query.scopeId)
      if (records.length > 0) {
        report.session = aggregateSessions(records)
      } else {
        notes.push('未找到该会话的轨迹记录：会话可能过短、未触发工具调用，或记录尚未落库')
      }
    } else {
      const records = await this.store.getSessionsByRange(window.since, window.until)
      if (records.length > 0) {
        report.session = aggregateSessions(records)
      } else {
        notes.push('所选时间窗口内没有会话轨迹记录')
      }
    }

    // ② 操作审计
    const audit = await this.collectAudit(window.since, window.until)
    if (audit) {
      report.audit = audit
    } else {
      notes.push('未读取到操作审计数据：审计日志可能未开启或该窗口无操作')
    }

    // ③ 资源开销
    const resource = await this.collectResource(window.since, window.until)
    report.resource = resource
    if (resource.avgCpuPercent === null && resource.peakMemoryMB === null) {
      notes.push('未读取到资源采样：系统监控可能处于关闭状态，可在设置中开启')
    }
    if (resource.eventLoopDelayMs === null) {
      notes.push('事件循环延迟暂无采样来源，该项按空值呈现')
    }

    notes.push('审批开销、离线基线与价值换算由界面层补齐；三项数据源不在主进程')

    return report
  }

  // ============================================================
  // 质量门
  // ============================================================

  /**
   * 与基线比对，给出插件或场景的质量门结论
   *
   * 基线取法：不显式指定时，取当前窗口之前等长的一段作为参照。这样门禁
   * 不需要额外的基线表，也直接回答「比上一轮差了没有」；前一段没有记录时
   * 按「无基线」处理，只建立基线不做阻断。
   *
   * 插件维度会先把内存里未落库的窗口结清，否则刚发生的调用不进统计，
   * 样本量被低估而误放行。
   */
  async runQualityGate(
    scope: QualityGateScope,
    targetId: string,
    options: QualityGateOptions = {},
  ): Promise<QualityGateResult> {
    if (scope === 'plugin') {
      await this.flushPluginBuckets()
    }

    const until = options.until ?? Date.now()
    const since = options.since ?? until - DEFAULT_GATE_WINDOW_MS

    const current =
      scope === 'plugin'
        ? await this.collectPluginSnapshot(targetId, since, until)
        : await this.collectScenarioSnapshot(targetId, since, until)

    let baseline: QualitySnapshot | null
    if (options.baseline !== undefined) {
      baseline = options.baseline
    } else {
      const span = Math.max(1, until - since)
      const previous =
        scope === 'plugin'
          ? await this.collectPluginSnapshot(targetId, since - span, since)
          : await this.collectScenarioSnapshot(targetId, since - span, since)
      baseline = previous.sampleCount > 0 ? previous : null
    }

    return compareQualityBaseline({
      scope,
      targetId,
      baseline,
      current,
      config: options.config,
    })
  }

  /**
   * 插件维度快照
   *
   * 按插件而不是按工具聚合：门禁要回答的是「这个插件还能不能用」，
   * 单个工具的波动放在插件整体数字里更不容易被误读成回归。
   */
  private async collectPluginSnapshot(
    pluginId: string,
    since: number,
    until: number,
  ): Promise<QualitySnapshot> {
    const empty: QualitySnapshot = {
      metrics: {},
      sampleCount: 0,
      windowStart: since,
      windowEnd: until,
    }

    try {
      const records = await this.store.getPluginQualityByRange(since, until, pluginId)
      if (records.length === 0) return empty

      let calls = 0
      let failures = 0
      let invalidArgs = 0
      let timeouts = 0
      let durationWeightedSum = 0

      for (const record of records) {
        calls += record.calls
        failures += record.failures
        invalidArgs += record.invalidArgs
        timeouts += record.timeouts
        // 窗口里存的是该窗口的 p95，无法反推整体分位，按调用次数加权平均作近似
        durationWeightedSum += record.p95DurationMs * record.calls
      }
      if (calls === 0) return empty

      return {
        metrics: {
          'plugin.failureRate': round4(failures / calls),
          'plugin.invalidArgsRate': round4(invalidArgs / calls),
          'plugin.timeoutRate': round4(timeouts / calls),
          'plugin.p95DurationMs': round2(durationWeightedSum / calls),
        },
        sampleCount: calls,
        windowStart: since,
        windowEnd: until,
      }
    } catch (e) {
      logger.effectMetrics?.warn('[EffectMetricsService] 聚合插件质量失败:', e)
      return empty
    }
  }

  /**
   * 场景维度快照
   *
   * 比率类指标按总量还原（总无效重试 / 总步数），而不是对各会话的比率取平均：
   * 后者会让一条 3 步就放弃的会话与一条 50 步的会话等权。
   *
   * 「任务完成率」在会话记录里没有对应字段可算，暂以无效重试占比与循环检出
   * 次数作为「这一轮跑得顺不顺」的代理：两者上升同样意味着更可能没做成。
   */
  private async collectScenarioSnapshot(
    scenarioId: string,
    since: number,
    until: number,
  ): Promise<QualitySnapshot> {
    const empty: QualitySnapshot = {
      metrics: {},
      sampleCount: 0,
      windowStart: since,
      windowEnd: until,
    }

    try {
      const records = await this.store.getSessionsByScenario(scenarioId, since, until)
      if (records.length === 0) return empty

      let totalSteps = 0
      let futileRetries = 0
      let loopDetections = 0
      let interventions = 0
      let firstUsefulSum = 0
      let firstUsefulCount = 0

      for (const record of records) {
        totalSteps += record.totalSteps
        futileRetries += record.futileRetries
        loopDetections += record.loopDetections
        interventions += record.interventions
        if (record.firstUsefulStep !== null) {
          firstUsefulSum += record.firstUsefulStep
          firstUsefulCount++
        }
      }

      const sessionCount = records.length
      const metrics: Record<string, number> = {
        'scenario.futileRetryRatio': totalSteps > 0 ? round4(futileRetries / totalSteps) : 0,
        'scenario.loopDetectionRate': round4(loopDetections / sessionCount),
        'scenario.avgSteps': round2(totalSteps / sessionCount),
        'scenario.interventionsPerSession': round4(interventions / sessionCount),
      }
      // 一次都没走到可用步骤时该项没有参照值，不放进比对集合
      if (firstUsefulCount > 0) {
        metrics['scenario.avgFirstUsefulStep'] = round2(firstUsefulSum / firstUsefulCount)
      }

      return {
        metrics,
        sampleCount: sessionCount,
        windowStart: since,
        windowEnd: until,
      }
    } catch (e) {
      logger.effectMetrics?.warn('[EffectMetricsService] 聚合场景质量失败:', e)
      return empty
    }
  }

  /** 读取时间窗口内的审计结论分布 */
  private async collectAudit(since: number, until: number): Promise<AuditEffect | null> {
    try {
      const entries = await auditLogService.query({ since, limit: 5000 })
      if (entries.length === 0) return null

      let allow = 0
      let deny = 0
      let error = 0
      for (const entry of entries) {
        if (entry.timestamp > until) continue
        if (entry.outcome === 'allow') allow++
        else if (entry.outcome === 'deny') deny++
        else error++
      }
      return { allow, deny, error }
    } catch (e) {
      logger.effectMetrics?.warn('[EffectMetricsService] 读取审计数据失败:', e)
      return null
    }
  }

  /**
   * 读取时间窗口内的资源开销
   *
   * 事件循环延迟当前没有可查询的采样源（性能追踪服务只在追踪开启时写文件，
   * 不提供按窗口取数），固定返回 null，由 UI 标注为空值。
   */
  private async collectResource(since: number, until: number): Promise<ResourceEffect> {
    const empty: ResourceEffect = {
      avgCpuPercent: null,
      peakMemoryMB: null,
      eventLoopDelayMs: null,
    }

    try {
      const metrics = await MonitoringService.getInstance().getMetricsByTimeRange(since, until, 2000)
      if (metrics.length === 0) return empty

      let cpuSum = 0
      let peakMemory = 0
      for (const sample of metrics) {
        if (typeof sample.cpuUsage === 'number' && sample.cpuUsage >= 0) {
          cpuSum += sample.cpuUsage
        }
        // 内存使用率 × 总量 = 实际占用；采样只给比例，不直接给 MB
        const usedMB = (sample.memoryUsage / 100) * (sample.memoryTotalMB || 0)
        if (usedMB > peakMemory) peakMemory = usedMB
      }

      return {
        avgCpuPercent: round2(cpuSum / metrics.length),
        peakMemoryMB: round2(peakMemory),
        eventLoopDelayMs: null,
      }
    } catch (e) {
      logger.effectMetrics?.warn('[EffectMetricsService] 读取资源采样失败:', e)
      return empty
    }
  }

  // ============================================================
  // 维护
  // ============================================================

  async clearAll(): Promise<boolean> {
    this.pluginBuckets.clear()
    return this.store.clearAll()
  }
}

// ============================================================
// 内部工具
// ============================================================

interface PluginQualityBucket {
  pluginId: string
  toolName: string
  windowStart: number
  calls: number
  failures: number
  invalidArgs: number
  timeouts: number
  durations: number[]
}

function resolveWindow(query: EffectMetricsQuery): { since: number; until: number } {
  const until = query.until ?? Date.now()
  const since = query.since ?? until - 7 * 24 * 60 * 60 * 1000
  return { since, until }
}

/**
 * 跨会话聚合
 *
 * 比率类指标按加权平均还原（总无效重试 / 总步数），
 * 直接对各会话比率取平均会让短会话与长会话等权，掩盖真实分布。
 */
function aggregateSessions(records: SessionEffectRecord[]): SessionEffectSummary {
  let totalSteps = 0
  let futileRetries = 0
  let loopDetections = 0
  let compressionEvents = 0
  let durationMs = 0
  let firstUsefulSum = 0
  let firstUsefulCount = 0

  for (const record of records) {
    totalSteps += record.totalSteps
    futileRetries += record.futileRetries
    loopDetections += record.loopDetections
    compressionEvents += record.compressionEvents
    durationMs += record.durationMs
    if (record.firstUsefulStep !== null) {
      firstUsefulSum += record.firstUsefulStep
      firstUsefulCount++
    }
  }

  return {
    totalSteps,
    futileRetries,
    loopDetections,
    compressionEvents,
    durationMs,
    futileRetryRatio: totalSteps > 0 ? round4(futileRetries / totalSteps) : 0,
    firstUsefulStep: firstUsefulCount > 0 ? Math.round(firstUsefulSum / firstUsefulCount) : null,
    sessionCount: records.length,
  }
}

function average(values: number[]): number {
  if (values.length === 0) return 0
  return round2(values.reduce((sum, value) => sum + value, 0) / values.length)
}

/** 最近邻分位数：样本量小时不做插值，取不超过目标位的那一个 */
function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))
  return round2(sorted[index])
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000
}
