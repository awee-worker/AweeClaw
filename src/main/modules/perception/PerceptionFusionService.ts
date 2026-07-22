/**
 * 多模态融合感知服务 — 4 通道融合 + 统一环境上下文
 *
 * 职责：
 * - 并行聚合 4 个感知通道的数据：
 *   1. 场景通道（PerceptionStore）：最近屏幕场景
 *   2. IoT 通道（IoTBridge + SensorFusionService）：传感器实体 + 异常
 *   3. 因果通道（CausalReasoningService）：因果图统计 + 最近查询
 *   4. 监控通道（MonitoringService）：系统指标 + 异常
 * - 生成统一的 EnvironmentContext，供 IntelligenceCore 注入 LLM 系统提示
 * - 提供跨通道洞察（如「编码时 CPU 持续高负载，可能在执行构建/测试」）
 * - 维护最近 20 次融合结果的滑动窗口，供趋势分析
 *
 * 容错策略：
 * - 每个通道独立超时（800ms），超时返回 stale 标记
 * - 单通道失败不影响其他通道，使用 Promise.allSettled
 * - 通道未启动时返回 inactive 状态，不抛错
 *
 * @module perception/PerceptionFusionService
 */

import { logger } from '@shared/toolkit/LogEngine'
import { PerceptionStore } from './PerceptionStore'
import { IoTBridge } from '../iot/IoTBridge'
import { SensorFusionService } from '../iot/SensorFusionService'
import { CausalReasoningService } from '../causal-reasoning/CausalReasoningService'
import { MonitoringService } from '../monitoring/MonitoringService'
import type { IoTEntitySnapshot } from '../iot/IoTInterface'
import type { SensorAnomalyEvent } from '../iot/SensorFusionInterface'
import type { AnomalyEvent } from '../monitoring/MonitoringInterface'
import type { CausalUserConfig } from '../causal-reasoning/CausalReasoningInterface'

// ============================================================
// 常量
// ============================================================

/** 单通道超时（ms） */
const CHANNEL_TIMEOUT_MS = 800

/** 融合结果滑动窗口大小 */
const HISTORY_MAX_SIZE = 20

/** 数据过期阈值（ms），超过则标记 stale */
const STALE_THRESHOLD_MS = 2 * 60 * 1000

// ============================================================
// 类型定义
// ============================================================

/** 融合通道名称 */
export type FusionChannelName = 'scene' | 'iot' | 'causal' | 'monitoring'

/** 单通道摘要 */
export interface ChannelSummary {
  /** 通道名称 */
  name: FusionChannelName
  /** 是否在运行 */
  running: boolean
  /** 最后更新时间（ms） */
  lastUpdateAt: number | null
  /** 当前异常数 */
  anomalyCount: number
  /** 人类可读的一行摘要 */
  summary: string
  /** 是否过期 */
  stale: boolean
  /** 通道专属结构化数据（可选，供调试/可视化使用） */
  data?: unknown
}

/** 跨通道洞察 */
export interface CrossChannelInsight {
  /** 洞察类型 */
  type:
    | 'high_load_during_coding'    // 编码时高负载
    | 'sensor_anomaly_correlation' // 传感器异常关联
    | 'causal_inquiry_spike'       // 因果查询激增
    | 'monitoring_anomaly_burst'   // 监控异常爆发
    | 'iot_disconnected'           // IoT 断连
    | 'all_quiet'                  // 全部正常
  /** 描述 */
  description: string
  /** 严重度 */
  severity: 'info' | 'warning' | 'critical'
  /** 关联的通道 */
  channels: FusionChannelName[]
}

/** 场景通道数据 */
export interface SceneChannelData {
  latestScene: {
    id: string
    timestamp: number
    app: string
    windowTitle: string
    activity: string
    textSummary: string
  } | null
  totalScenes: number
}

/** IoT 通道数据 */
export interface IoTChannelData {
  bridgeRunning: boolean
  totalProviders: number
  connectedProviders: number
  totalEntities: number
  recentAnomalyCount: number
  recentAnomalies: Array<{
    type: string
    severity: string
    description: string
    externalId: string
    timestamp: number
  }>
  recentEntities: Array<{
    externalId: string
    entityType: string
    state: string | number | boolean | null
    unit?: string
  }>
}

/** 因果通道数据 */
export interface CausalChannelData {
  enabled: boolean
  nodeCount: number
  edgeCount: number
  density: number
  recentQueryCount: number
  recentQueries: Array<{
    queryType: string
    success: boolean
    timestamp: number
  }>
}

/** 监控通道数据 */
export interface MonitoringChannelData {
  running: boolean
  activeAnomalyCount: number
  recentAnomalies: Array<{
    type: string
    severity: string
    description: string
    timestamp: number
  }>
  systemMetrics: {
    cpuUsage: number | null
    memoryUsage: number | null
    diskUsage: number | null
  } | null
}

/** 统一环境上下文 */
export interface EnvironmentContext {
  /** 生成时间戳 */
  timestamp: number
  /** 4 个通道的摘要 */
  channels: ChannelSummary[]
  /** 异常总数（4 通道汇总） */
  totalAnomalyCount: number
  /** 注意力分数（0-1，根据异常数 + 严重度计算） */
  attentionScore: number
  /** 跨通道洞察 */
  insights: CrossChannelInsight[]
  /** 已过期的通道列表 */
  staleChannels: FusionChannelName[]
  /** 场景通道详情 */
  scene: SceneChannelData | null
  /** IoT 通道详情 */
  iot: IoTChannelData | null
  /** 因果通道详情 */
  causal: CausalChannelData | null
  /** 监控通道详情 */
  monitoring: MonitoringChannelData | null
}

// ============================================================
// PerceptionFusionService 实现
// ============================================================

/**
 * 多模态融合感知服务单例
 *
 * 使用方式：
 * ```ts
 * const service = PerceptionFusionService.getInstance()
 * const ctx = await service.getEnvironmentContext()
 * console.log(ctx.totalAnomalyCount, ctx.attentionScore, ctx.insights)
 * ```
 */
export class PerceptionFusionService {
  private static instance: PerceptionFusionService | null = null

  /** 融合历史滑动窗口 */
  private readonly history: EnvironmentContext[] = []

  /** 最后一次融合结果（缓存） */
  private lastContext: EnvironmentContext | null = null

  private constructor() {}

  static getInstance(): PerceptionFusionService {
    if (!PerceptionFusionService.instance) {
      PerceptionFusionService.instance = new PerceptionFusionService()
    }
    return PerceptionFusionService.instance
  }

  /**
   * 获取当前环境上下文（4 通道融合）
   *
   * 并行查询 4 个通道，每个通道独立超时（800ms），
   * 任一通道失败不影响其他通道。
   */
  async getEnvironmentContext(): Promise<EnvironmentContext> {
    const timestamp = Date.now()

    // 并行查询 4 个通道
    const [sceneResult, iotResult, causalResult, monitoringResult] =
      await Promise.allSettled([
        this.loadSceneChannel(),
        this.loadIoTChannel(),
        this.loadCausalChannel(),
        this.loadMonitoringChannel(),
      ])

    // 提取结果（失败通道返回 null）
    const scene = sceneResult.status === 'fulfilled' ? sceneResult.value : null
    const iot = iotResult.status === 'fulfilled' ? iotResult.value : null
    const causal = causalResult.status === 'fulfilled' ? causalResult.value : null
    const monitoring = monitoringResult.status === 'fulfilled' ? monitoringResult.value : null

    // 构建通道摘要
    const channels: ChannelSummary[] = [
      this.buildSceneSummary(scene, timestamp),
      this.buildIoTSummary(iot, timestamp),
      this.buildCausalSummary(causal, timestamp),
      this.buildMonitoringSummary(monitoring, timestamp),
    ]

    // 计算异常总数
    const totalAnomalyCount = channels.reduce((sum, c) => sum + c.anomalyCount, 0)

    // 计算注意力分数
    const attentionScore = this.computeAttentionScore(channels, totalAnomalyCount)

    // 生成跨通道洞察
    const insights = this.generateInsights(scene, iot, causal, monitoring)

    // 标记过期通道
    const staleChannels = channels.filter((c) => c.stale).map((c) => c.name)

    const ctx: EnvironmentContext = {
      timestamp,
      channels,
      totalAnomalyCount,
      attentionScore,
      insights,
      staleChannels,
      scene,
      iot,
      causal,
      monitoring,
    }

    // 入历史滑动窗口
    this.history.push(ctx)
    if (this.history.length > HISTORY_MAX_SIZE) {
      this.history.shift()
    }

    this.lastContext = ctx

    logger.perception?.info(
      `[PerceptionFusion] 融合完成: 异常=${totalAnomalyCount} 注意力=${attentionScore.toFixed(2)} 洞察=${insights.length} 过期通道=${staleChannels.length}`,
    )

    return ctx
  }

  /**
   * 获取融合历史（最近 N 次）
   *
   * @param limit 返回条数（默认 20）
   */
  getFusionHistory(limit = HISTORY_MAX_SIZE): EnvironmentContext[] {
    return this.history.slice(-limit)
  }

  /** 获取最近一次融合结果（无则返回 null） */
  getLastContext(): EnvironmentContext | null {
    return this.lastContext
  }

  /** 清空历史 */
  clearHistory(): void {
    this.history.length = 0
    this.lastContext = null
  }

  // ============================================================
  // 通道加载
  // ============================================================

  /** 加载场景通道数据 */
  private async loadSceneChannel(): Promise<SceneChannelData> {
    return this.withTimeout(async () => {
      const store = PerceptionStore.getInstance()
      const scenes = await store.getRecentScenes(1)
      const latest = scenes[0] ?? null
      return {
        latestScene: latest
          ? {
              id: latest.id,
              timestamp: latest.timestamp,
              app: latest.app,
              windowTitle: latest.windowTitle,
              activity: latest.activity,
              textSummary: latest.textSummary,
            }
          : null,
        totalScenes: scenes.length,
      }
    }, CHANNEL_TIMEOUT_MS, 'scene')
  }

  /** 加载 IoT 通道数据 */
  private async loadIoTChannel(): Promise<IoTChannelData> {
    return this.withTimeout(async () => {
      const bridge = IoTBridge.getInstance()
      const status = bridge.getStatus()
      const entities = bridge.listEntitySnapshots()

      // 传感器异常（SensorFusionService 是同步接口）
      let recentAnomalies: SensorAnomalyEvent[] = []
      try {
        const fusion = SensorFusionService.getInstance()
        recentAnomalies = fusion.getRecentAnomalies(5)
      } catch {
        // SensorFusionService 未初始化时静默
      }

      return {
        bridgeRunning: status.running,
        totalProviders: status.providers.length,
        connectedProviders: status.providers.filter((p) => p.state === 'connected').length,
        totalEntities: status.totalEntities,
        recentAnomalyCount: recentAnomalies.length,
        recentAnomalies: recentAnomalies.map((a) => ({
          type: a.type,
          severity: a.severity,
          description: a.description,
          externalId: a.externalId,
          timestamp: a.timestamp,
        })),
        recentEntities: entities.slice(0, 5).map((e: IoTEntitySnapshot) => ({
          externalId: e.externalId,
          entityType: e.entityType,
          state: e.state,
          unit: e.unitOfMeasurement ?? undefined,
        })),
      }
    }, CHANNEL_TIMEOUT_MS, 'iot')
  }

  /** 加载因果通道数据 */
  private async loadCausalChannel(): Promise<CausalChannelData> {
    return this.withTimeout(async () => {
      const service = CausalReasoningService.getInstance()
      const config = service.getConfig() as CausalUserConfig
      const stats = service.getStats()
      const since = Date.now() - 24 * 60 * 60 * 1000 // 最近 24 小时
      const queries = service.listQueries({ startDate: since })

      return {
        enabled: config.enabled,
        nodeCount: stats.nodeCount,
        edgeCount: stats.edgeCount,
        density: stats.density,
        recentQueryCount: queries.length,
        recentQueries: queries.slice(0, 5).map((q) => ({
          queryType: q.queryType,
          success: q.success,
          timestamp: q.createdAt,
        })),
      }
    }, CHANNEL_TIMEOUT_MS, 'causal')
  }

  /** 加载监控通道数据 */
  private async loadMonitoringChannel(): Promise<MonitoringChannelData> {
    return this.withTimeout(async () => {
      const service = MonitoringService.getInstance()
      const running = service.isRunning()
      const activeAnomalies = service.getActiveAnomalies()
      const recentAnomalies = service.getRecentAnomalies(5)
      const metrics = service.getLatestMetrics()

      return {
        running,
        activeAnomalyCount: activeAnomalies.length,
        recentAnomalies: recentAnomalies.map((a: AnomalyEvent) => ({
          type: a.type,
          severity: a.severity,
          description: a.description,
          timestamp: a.timestamp,
        })),
        systemMetrics: metrics
          ? {
              cpuUsage: metrics.cpuUsage,
              memoryUsage: metrics.memoryUsage,
              diskUsage: metrics.diskUsage,
            }
          : null,
      }
    }, CHANNEL_TIMEOUT_MS, 'monitoring')
  }

  // ============================================================
  // 通道摘要构建
  // ============================================================

  private buildSceneSummary(data: SceneChannelData | null, now: number): ChannelSummary {
    if (!data || !data.latestScene) {
      return {
        name: 'scene',
        running: false,
        lastUpdateAt: null,
        anomalyCount: 0,
        summary: '无场景数据',
        stale: true,
        data,
      }
    }

    const lastUpdateAt = data.latestScene.timestamp
    const stale = now - lastUpdateAt > STALE_THRESHOLD_MS
    return {
      name: 'scene',
      running: true,
      lastUpdateAt,
      anomalyCount: 0,
      summary: `${data.latestScene.app}/${data.latestScene.activity}: ${data.latestScene.textSummary.slice(0, 50)}`,
      stale,
      data,
    }
  }

  private buildIoTSummary(data: IoTChannelData | null, now: number): ChannelSummary {
    if (!data) {
      return {
        name: 'iot',
        running: false,
        lastUpdateAt: null,
        anomalyCount: 0,
        summary: 'IoT 通道加载失败',
        stale: true,
        data,
      }
    }

    if (!data.bridgeRunning) {
      return {
        name: 'iot',
        running: false,
        lastUpdateAt: null,
        anomalyCount: data.recentAnomalyCount,
        summary: `IoT Bridge 未运行（异常 ${data.recentAnomalyCount}）`,
        stale: false,
        data,
      }
    }

    // 用最近异常时间作为 lastUpdateAt；无异常则用当前时间
    const lastUpdateAt = data.recentAnomalies[0]?.timestamp ?? now
    const stale = now - lastUpdateAt > STALE_THRESHOLD_MS && data.recentAnomalyCount === 0
    return {
      name: 'iot',
      running: true,
      lastUpdateAt,
      anomalyCount: data.recentAnomalyCount,
      summary: `IoT: ${data.connectedProviders}/${data.totalProviders} providers, ${data.totalEntities} entities, 异常 ${data.recentAnomalyCount}`,
      stale,
      data,
    }
  }

  private buildCausalSummary(data: CausalChannelData | null, now: number): ChannelSummary {
    if (!data) {
      return {
        name: 'causal',
        running: false,
        lastUpdateAt: null,
        anomalyCount: 0,
        summary: '因果通道加载失败',
        stale: true,
        data,
      }
    }

    if (!data.enabled) {
      return {
        name: 'causal',
        running: false,
        lastUpdateAt: null,
        anomalyCount: 0,
        summary: '因果推理未启用',
        stale: false,
        data,
      }
    }

    const lastUpdateAt = data.recentQueries[0]?.timestamp ?? now
    const stale = now - lastUpdateAt > STALE_THRESHOLD_MS
    return {
      name: 'causal',
      running: true,
      lastUpdateAt,
      anomalyCount: 0,
      summary: `因果图: ${data.nodeCount} 节点 / ${data.edgeCount} 边, 最近 24h 查询 ${data.recentQueryCount}`,
      stale,
      data,
    }
  }

  private buildMonitoringSummary(data: MonitoringChannelData | null, now: number): ChannelSummary {
    if (!data) {
      return {
        name: 'monitoring',
        running: false,
        lastUpdateAt: null,
        anomalyCount: 0,
        summary: '监控通道加载失败',
        stale: true,
        data,
      }
    }

    if (!data.running) {
      return {
        name: 'monitoring',
        running: false,
        lastUpdateAt: null,
        anomalyCount: data.activeAnomalyCount,
        summary: `系统监控未运行（异常 ${data.activeAnomalyCount}）`,
        stale: false,
        data,
      }
    }

    const lastUpdateAt = data.recentAnomalies[0]?.timestamp ?? now
    const stale = now - lastUpdateAt > STALE_THRESHOLD_MS && data.activeAnomalyCount === 0
    const metrics = data.systemMetrics
    const metricsStr = metrics
      ? `CPU=${metrics.cpuUsage?.toFixed(0)}% MEM=${metrics.memoryUsage?.toFixed(0)}% DISK=${metrics.diskUsage?.toFixed(0)}%`
      : '无指标'
    return {
      name: 'monitoring',
      running: true,
      lastUpdateAt,
      anomalyCount: data.activeAnomalyCount,
      summary: `监控: ${metricsStr}, 活跃异常 ${data.activeAnomalyCount}`,
      stale,
      data,
    }
  }

  // ============================================================
  // 跨通道洞察生成
  // ============================================================

  private generateInsights(
    scene: SceneChannelData | null,
    iot: IoTChannelData | null,
    causal: CausalChannelData | null,
    monitoring: MonitoringChannelData | null,
  ): CrossChannelInsight[] {
    const insights: CrossChannelInsight[] = []

    // 1. 编码时高负载
    if (
      scene?.latestScene?.activity === 'coding' &&
      monitoring?.systemMetrics &&
      (monitoring.systemMetrics.cpuUsage ?? 0) > 80
    ) {
      insights.push({
        type: 'high_load_during_coding',
        description: `编码场景下 CPU 使用率 ${monitoring.systemMetrics.cpuUsage?.toFixed(0)}%，可能在执行构建/测试/索引`,
        severity: 'warning',
        channels: ['scene', 'monitoring'],
      })
    }

    // 2. 传感器异常关联（IoT 异常 + 因果推理启用）
    if (iot && iot.recentAnomalyCount > 0 && causal?.enabled) {
      insights.push({
        type: 'sensor_anomaly_correlation',
        description: `检测到 ${iot.recentAnomalyCount} 条传感器异常，因果推理已启用可分析根因`,
        severity: 'info',
        channels: ['iot', 'causal'],
      })
    }

    // 3. 因果查询激增（最近 24h > 20 条）
    if (causal && causal.recentQueryCount > 20) {
      insights.push({
        type: 'causal_inquiry_spike',
        description: `最近 24h 因果查询 ${causal.recentQueryCount} 次，用户高度关注因果关系`,
        severity: 'info',
        channels: ['causal'],
      })
    }

    // 4. 监控异常爆发（活跃异常 ≥ 3）
    if (monitoring && monitoring.activeAnomalyCount >= 3) {
      insights.push({
        type: 'monitoring_anomaly_burst',
        description: `监控系统检测到 ${monitoring.activeAnomalyCount} 个活跃异常，建议关注系统健康`,
        severity: 'critical',
        channels: ['monitoring'],
      })
    }

    // 5. IoT 断连
    if (iot && iot.totalProviders > 0 && iot.connectedProviders === 0) {
      insights.push({
        type: 'iot_disconnected',
        description: `IoT 配置了 ${iot.totalProviders} 个 provider 但全部断连`,
        severity: 'warning',
        channels: ['iot'],
      })
    }

    // 6. 全部正常
    if (insights.length === 0) {
      insights.push({
        type: 'all_quiet',
        description: '所有感知通道运行正常，无异常',
        severity: 'info',
        channels: ['scene', 'iot', 'causal', 'monitoring'],
      })
    }

    return insights
  }

  // ============================================================
  // 注意力分数计算
  // ============================================================

  /**
   * 计算注意力分数（0-1）
   *
   * 规则：
   * - 基础分 0.1（即使无异常也保留最低注意力）
   * - 每条异常 +0.05（上限 0.5）
   * - critical 洞察 +0.2，warning +0.1，info +0.05（上限 0.4）
   * - 总分钳制 [0, 1]
   */
  private computeAttentionScore(
    channels: ChannelSummary[],
    totalAnomalyCount: number,
  ): number {
    let score = 0.1

    // 异常数贡献
    score += Math.min(0.5, totalAnomalyCount * 0.05)

    // 过期通道贡献（每过期一个 +0.05）
    const staleCount = channels.filter((c) => c.stale).length
    score += staleCount * 0.05

    // 未运行通道贡献（每未运行 +0.03）
    const inactiveCount = channels.filter((c) => !c.running).length
    score += inactiveCount * 0.03

    return Math.max(0, Math.min(1, Math.round(score * 100) / 100))
  }

  // ============================================================
  // 工具方法
  // ============================================================

  /**
   * 带超时的 Promise 包装
   *
   * @param loader 数据加载函数
   * @param timeoutMs 超时毫秒
   * @param channelName 通道名（用于日志）
   */
  private async withTimeout<T>(
    loader: () => Promise<T>,
    timeoutMs: number,
    channelName: string,
  ): Promise<T> {
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error(`通道 ${channelName} 加载超时（${timeoutMs}ms）`)),
        timeoutMs,
      )
    })
    return Promise.race([loader(), timeout]) as Promise<T>
  }

  /** 释放资源 */
  dispose(): void {
    this.history.length = 0
    this.lastContext = null
    PerceptionFusionService.instance = null
  }
}
