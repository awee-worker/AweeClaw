/**
 * 监控服务编排器 — 串联 MetricsCollector / SystemMetricsStore / AnomalyDetector
 *
 * 职责：
 * - 启动定时采样循环（默认 30 秒）
 * - 调用 MetricsCollector 采集指标
 * - 写入 SystemMetricsStore
 * - 触发 AnomalyDetector 分析
 * - 自动解决已恢复的异常
 * - 暴露查询接口给 IPC 层
 *
 * @module monitoring/MonitoringService
 */

import { logger } from '@shared/toolkit/LogEngine'
import { MetricsCollector } from './MetricsCollector'
import { SystemMetricsStore } from './SystemMetricsStore'
import { AnomalyDetector, type AnomalyCallback } from './AnomalyDetector'
import type { SystemMetrics, AnomalyEvent, MonitoringConfig } from './MonitoringInterface'
import { DEFAULT_MONITORING_CONFIG } from './MonitoringInterface'

// ============================================================
// 监控服务
// ============================================================

/**
 * 监控服务单例
 *
 * 使用方式：
 * ```ts
 * const service = MonitoringService.getInstance()
 * service.updateConfig({ enabled: true, sampleIntervalSec: 30 })
 * service.start()
 * service.onAnomaly((event) => {
 *   // 转发到渲染层 toast
 * })
 * ```
 */
export class MonitoringService {
  private static instance: MonitoringService | null = null

  private readonly collector: MetricsCollector
  private readonly store: SystemMetricsStore
  private readonly detector: AnomalyDetector

  /** 采样定时器 */
  private sampleTimer: NodeJS.Timeout | null = null

  /** 清理过期数据定时器（每小时一次） */
  private cleanupTimer: NodeJS.Timeout | null = null

  /** 配置 */
  private config: MonitoringConfig = { ...DEFAULT_MONITORING_CONFIG }

  /** 是否已启动 */
  private running = false

  /** 最新指标缓存（供实时查询） */
  private latestMetrics: SystemMetrics | null = null

  /** 异常事件订阅 */
  private anomalyCallbacks: Set<AnomalyCallback> = new Set()

  private constructor() {
    this.collector = MetricsCollector.getInstance()
    this.store = SystemMetricsStore.getInstance()
    this.detector = AnomalyDetector.getInstance()
  }

  static getInstance(): MonitoringService {
    if (!MonitoringService.instance) {
      MonitoringService.instance = new MonitoringService()
    }
    return MonitoringService.instance
  }

  // ============================================================
  // 生命周期
  // ============================================================

  /**
   * 初始化（必须在 app ready 后调用）
   *
   * 初始化 LanceDB 连接、加载配置
   */
  async initialize(): Promise<boolean> {
    try {
      const ok = await this.store.initialize()
      if (!ok) {
        logger.monitoring?.warn('[MonitoringService] 存储初始化失败，将仅使用内存模式')
      }
      this.config = this.store.getConfig()
      this.detector.updateConfig(this.config)
      logger.monitoring?.info('[MonitoringService] 初始化完成')
      return true
    } catch (e) {
      logger.monitoring?.error('[MonitoringService] 初始化失败:', e)
      return false
    }
  }

  /** 启动监控 */
  start(): void {
    if (this.running || !this.config.enabled) return

    this.running = true
    logger.monitoring?.info(
      `[MonitoringService] 启动监控（间隔 ${this.config.sampleIntervalSec}s）`,
    )

    // 立即采样一次
    this.sample().catch((e) => {
      logger.monitoring?.error('[MonitoringService] 首次采样失败:', e)
    })

    // 启动采样定时器
    const intervalMs = Math.max(this.config.sampleIntervalSec, 5) * 1000
    this.sampleTimer = setInterval(() => {
      this.sample().catch((e) => {
        logger.monitoring?.error('[MonitoringService] 采样失败:', e)
      })
    }, intervalMs)

    // 启动清理定时器（每小时清理一次过期数据）
    this.cleanupTimer = setInterval(
      () => {
        this.store.cleanupExpiredData().catch((e) => {
          logger.monitoring?.warn('[MonitoringService] 清理过期数据失败:', e)
        })
      },
      60 * 60 * 1000,
    )
  }

  /** 停止监控 */
  stop(): void {
    if (!this.running) return

    this.running = false
    if (this.sampleTimer) {
      clearInterval(this.sampleTimer)
      this.sampleTimer = null
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }

    logger.monitoring?.info('[MonitoringService] 监控已停止')
  }

  /** 是否正在运行 */
  isRunning(): boolean {
    return this.running
  }

  // ============================================================
  // 配置管理
  // ============================================================

  /**
   * 更新配置
   *
   * 如果采样间隔变化且监控正在运行，会自动重启定时器
   */
  updateConfig(patch: Partial<MonitoringConfig>): void {
    const prevInterval = this.config.sampleIntervalSec
    this.config = { ...this.config, ...patch }
    this.store.updateConfig(this.config)
    this.detector.updateConfig(this.config)

    // 启用状态或采样间隔变化 → 重启
    if (this.running) {
      if (!this.config.enabled) {
        this.stop()
      } else if (prevInterval !== this.config.sampleIntervalSec) {
        this.stop()
        this.start()
      }
    } else if (this.config.enabled) {
      this.start()
    }

    logger.monitoring?.info('[MonitoringService] 配置已更新:', {
      enabled: this.config.enabled,
      sampleIntervalSec: this.config.sampleIntervalSec,
      anomalyDetectionEnabled: this.config.anomalyDetectionEnabled,
      predictiveAlertEnabled: this.config.predictiveAlertEnabled,
      cloudReportingEnabled: this.config.cloudReportingEnabled,
    })
  }

  /** 获取当前配置 */
  getConfig(): MonitoringConfig {
    return { ...this.config }
  }

  // ============================================================
  // 查询接口
  // ============================================================

  /** 获取最新指标采样 */
  getLatestMetrics(): SystemMetrics | null {
    return this.latestMetrics ?? this.store.getLatestMetrics()
  }

  /**
   * 获取指定时间范围内的指标
   *
   * @param startTime 起始时间戳（ms）
   * @param endTime   结束时间戳（ms）
   * @param limit     最大返回数量
   */
  async getMetricsByTimeRange(
    startTime: number,
    endTime: number,
    limit = 1000,
  ): Promise<SystemMetrics[]> {
    return this.store.getMetricsByTimeRange(startTime, endTime, limit)
  }

  /**
   * 获取指定时间范围内的异常事件
   */
  async getAnomaliesByTimeRange(
    startTime: number,
    endTime: number,
    limit = 100,
  ): Promise<AnomalyEvent[]> {
    return this.store.getAnomaliesByTimeRange(startTime, endTime, limit)
  }

  /** 获取最近的异常事件 */
  getRecentAnomalies(limit = 20): AnomalyEvent[] {
    return this.store.getRecentAnomalies(limit)
  }

  /** 获取所有 active 异常 */
  getActiveAnomalies(): AnomalyEvent[] {
    return this.store.getActiveAnomalies()
  }

  // ============================================================
  // 异常事件订阅
  // ============================================================

  /**
   * 订阅异常事件
   *
   * @returns 取消订阅函数
   */
  onAnomaly(callback: AnomalyCallback): () => void {
    this.anomalyCallbacks.add(callback)
    return () => this.anomalyCallbacks.delete(callback)
  }

  // ============================================================
  // 异常状态管理
  // ============================================================

  /** 确认异常（用户点击"已知晓"） */
  async acknowledgeAnomaly(anomalyId: string): Promise<boolean> {
    return this.detector.acknowledge(anomalyId)
  }

  /** 标记异常为已解决 */
  async resolveAnomaly(anomalyId: string): Promise<boolean> {
    return this.detector.resolve(anomalyId)
  }

  // ============================================================
  // 内部采样循环
  // ============================================================

  /**
   * 执行一次采样 + 分析
   *
   * 流程：
   * 1. 调用 MetricsCollector.collect() 获取指标
   * 2. 写入 SystemMetricsStore（内存缓冲 + 可选磁盘）
   * 3. 调用 AnomalyDetector.analyze() 检测异常
   * 4. 自动解决已恢复的异常
   * 5. 派发事件给订阅者
   */
  private async sample(): Promise<void> {
    const metrics = await this.collector.collect()
    this.latestMetrics = metrics

    // 写入存储
    await this.store.saveMetrics(metrics)

    // 异常检测
    const newAnomalies = await this.detector.analyze(metrics)

    // 自动解决已恢复的异常
    await this.detector.autoResolve(metrics)

    // 派发新异常事件给订阅者
    for (const event of newAnomalies) {
      for (const cb of this.anomalyCallbacks) {
        try {
          cb(event)
        } catch (e) {
          logger.monitoring?.warn('[MonitoringService] 异常事件回调失败:', e)
        }
      }
    }

    if (newAnomalies.length > 0) {
      logger.monitoring?.info(
        `[MonitoringService] 检测到 ${newAnomalies.length} 个新异常`,
      )
    }
  }

  // ============================================================
  // 诊断与清理
  // ============================================================

  /** 获取检测器统计 */
  getDetectorStats(): {
    forestTrained: boolean
    forestTreeCount: number
    trainingSampleCount: number
    lastTrainedAt: number
    activeAnomalyCount: number
  } {
    return this.detector.getStats()
  }

  /** 清空所有数据（用于隐私模式切换时） */
  async clearAllData(): Promise<boolean> {
    return this.store.clearAllData()
  }

  /** 销毁（应用退出时调用） */
  dispose(): void {
    this.stop()
    this.anomalyCallbacks.clear()
  }
}
