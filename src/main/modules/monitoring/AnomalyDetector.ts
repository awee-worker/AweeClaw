/**
 * 异常检测器 — 基于规则 + Isolation Forest + 趋势预测的综合检测引擎
 *
 * 职责：
 * - 接收最新 SystemMetrics 采样
 * - 规则层：阈值告警（CPU/内存/磁盘/温度/电量等）
 * - ML 层：Isolation Forest 多维联合异常检测
 * - 预测层：趋势外推（线性回归 + 增长率），提前 1h 预警 OOM/磁盘满
 * - 告警去重：同类型异常在窗口期内（默认 10 分钟）合并
 * - 状态转换：active ↔ resolved ↔ acknowledged
 *
 * @module monitoring/AnomalyDetector
 */

import { logger } from '@shared/toolkit/LogEngine'
import type {
  SystemMetrics,
  AnomalyEvent,
  AnomalyType,
  AnomalySeverity,
  MetricType,
  MonitoringConfig,
} from './MonitoringInterface'
import { SystemMetricsStore } from './SystemMetricsStore'
import {
  IsolationForest,
  extractFeaturesFromMetrics,
  extractFeaturesFromMetricsBatch,
  getIsolationForest,
} from './IsolationForest'

// ============================================================
// 常量
// ============================================================

/** 告警去重窗口（同类型异常在此期间内不重复触发，ms） */
const DEDUP_WINDOW_MS = 10 * 60 * 1000

/** Isolation Forest 训练最小样本数 */
const MIN_TRAINING_SAMPLES = 32

/** Isolation Forest 重新训练间隔（小时） */
const RETRAIN_INTERVAL_HOURS = 6

/** 趋势预测使用的最近样本数 */
const TREND_SAMPLE_COUNT = 30

/** 异常事件回调 */
export type AnomalyCallback = (event: AnomalyEvent) => void

// ============================================================
// 异常描述与建议映射
// ============================================================

/** 异常类型 → 描述模板 */
const ANOMALY_DESCRIPTIONS: Record<AnomalyType, (v: number) => string> = {
  high_cpu: (v) => `CPU 持续高负载（${v.toFixed(1)}%）`,
  high_memory: (v) => `内存使用率过高（${v.toFixed(1)}%）`,
  memory_leak: (v) => `内存持续上升（${v.toFixed(1)}%），疑似内存泄漏`,
  disk_full: (v) => `磁盘空间不足（${v.toFixed(1)}%）`,
  disk_io_high: (v) => `磁盘 IO 异常高（${v.toFixed(1)} KB/s）`,
  network_anomaly: (v) => `网络流量异常（${v.toFixed(1)} KB/s）`,
  process_explosion: (v) => `进程数激增（${v}）`,
  high_temperature: (v) => `CPU 温度过高（${v.toFixed(1)}℃）`,
  low_battery: (v) => `电量过低（${v.toFixed(1)}%）`,
  unknown: () => '检测到未知异常',
}

/** 异常类型 → 建议操作 */
const ANOMALY_RECOMMENDATIONS: Record<AnomalyType, string> = {
  high_cpu: '请检查占用 CPU 较高的进程，关闭非必要程序；如有长任务，建议暂停后再恢复',
  high_memory: '请关闭部分应用释放内存，或检查是否有内存占用异常的进程',
  memory_leak: '建议重启相关应用或系统，避免因内存耗尽导致崩溃',
  disk_full: '请清理临时文件、缓存或大文件，确保磁盘剩余空间充足',
  disk_io_high: '请检查是否有大量磁盘读写操作，如系统备份、索引重建等',
  network_anomaly: '请检查后台是否有大文件下载或上传任务，或检查是否存在异常网络连接',
  process_explosion: '请检查是否有进程异常 fork，可能存在僵尸进程或恶意程序',
  high_temperature: '请改善散热环境，关闭高负载应用，避免硬件损坏',
  low_battery: '请尽快连接电源适配器，避免因电量耗尽中断工作',
  unknown: '请关注系统状态，必要时手动排查',
}

/** 异常类型 → 触发指标 */
const ANOMALY_METRIC_TYPE: Record<AnomalyType, MetricType> = {
  high_cpu: 'cpu_usage',
  high_memory: 'memory_usage',
  memory_leak: 'memory_usage',
  disk_full: 'disk_usage',
  disk_io_high: 'disk_io_read',
  network_anomaly: 'network_rx',
  process_explosion: 'process_count',
  high_temperature: 'temperature',
  low_battery: 'battery',
  unknown: 'cpu_usage',
}

// ============================================================
// 异常检测器
// ============================================================

/**
 * 异常检测器单例
 *
 * 使用方式：
 * ```ts
 * const detector = AnomalyDetector.getInstance()
 * detector.updateConfig(config)
 * detector.onAnomaly((event) => {
 *   // 推送 toast 通知 / 转发到渲染层
 * })
 *
 * // 每次 MetricsCollector.collect() 后调用
 * const events = await detector.analyze(metrics)
 * ```
 */
export class AnomalyDetector {
  private static instance: AnomalyDetector | null = null

  private readonly store: SystemMetricsStore
  private readonly forest: IsolationForest
  private config: MonitoringConfig

  /** 训练时间戳（用于判断是否需要重新训练） */
  private lastTrainedAt = 0

  /** 最近一次规则告警时间（用于去重） */
  private lastAlertAt: Map<AnomalyType, number> = new Map()

  /** 异常事件订阅 */
  private callbacks: Set<AnomalyCallback> = new Set()

  /** 训练样本计数 */
  private trainingSampleCount = 0

  private constructor() {
    this.store = SystemMetricsStore.getInstance()
    this.forest = getIsolationForest()
    this.config = this.store.getConfig()
  }

  static getInstance(): AnomalyDetector {
    if (!AnomalyDetector.instance) {
      AnomalyDetector.instance = new AnomalyDetector()
    }
    return AnomalyDetector.instance
  }

  /** 更新配置 */
  updateConfig(config: Partial<MonitoringConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /** 订阅异常事件 */
  onAnomaly(callback: AnomalyCallback): () => void {
    this.callbacks.add(callback)
    return () => this.callbacks.delete(callback)
  }

  // ============================================================
  // 主入口：分析最新采样
  // ============================================================

  /**
   * 分析最新指标采样
   *
   * 流程：
   * 1. 规则检测：阈值告警（立即触发，覆盖单点超限）
   * 2. 趋势预测：基于最近 30 个样本外推 1h，提前预警
   * 3. ML 检测：Isolation Forest 多维联合异常（需已训练）
   * 4. 告警去重 + 派发事件
   *
   * @param metrics 最新采样
   * @returns 本次产生的异常事件列表
   */
  async analyze(metrics: SystemMetrics): Promise<AnomalyEvent[]> {
    if (!this.config.anomalyDetectionEnabled) return []

    const events: AnomalyEvent[] = []

    // 1. 规则检测
    events.push(...this.detectByRules(metrics))

    // 2. 趋势预测
    if (this.config.predictiveAlertEnabled) {
      events.push(...(await this.detectByTrend(metrics)))
    }

    // 3. ML 检测（异步训练 + 同步预测）
    if (this.config.anomalyDetectionEnabled) {
      await this.ensureModelTrained()
      const mlEvent = this.detectByForest(metrics)
      if (mlEvent) events.push(mlEvent)
    }

    // 4. 去重 + 派发
    const deduped = this.deduplicate(events)
    for (const event of deduped) {
      // 持久化到存储
      await this.store.saveAnomaly(event)
      // 异步派发回调
      for (const cb of this.callbacks) {
        try {
          cb(event)
        } catch (e) {
          logger.monitoring?.warn('[AnomalyDetector] 回调执行失败:', e)
        }
      }
    }

    return deduped
  }

  // ============================================================
  // 规则检测：阈值告警
  // ============================================================

  /**
   * 基于阈值的规则检测
   *
   * 单点超限立即触发，覆盖最直接的告警场景
   */
  private detectByRules(metrics: SystemMetrics): AnomalyEvent[] {
    const events: AnomalyEvent[] = []
    const t = this.config.thresholds

    // CPU
    if (metrics.cpuUsage >= t.cpuCritical) {
      events.push(this.createEvent('high_cpu', 'critical', metrics.cpuUsage, metrics))
    } else if (metrics.cpuUsage >= t.cpuWarning) {
      events.push(this.createEvent('high_cpu', 'warning', metrics.cpuUsage, metrics))
    }

    // 内存
    if (metrics.memoryUsage >= t.memoryCritical) {
      events.push(this.createEvent('high_memory', 'critical', metrics.memoryUsage, metrics))
    } else if (metrics.memoryUsage >= t.memoryWarning) {
      events.push(this.createEvent('high_memory', 'warning', metrics.memoryUsage, metrics))
    }

    // 磁盘
    if (metrics.diskUsage >= t.diskCritical) {
      events.push(this.createEvent('disk_full', 'critical', metrics.diskUsage, metrics))
    } else if (metrics.diskUsage >= t.diskWarning) {
      events.push(this.createEvent('disk_full', 'warning', metrics.diskUsage, metrics))
    }

    // 温度
    if (metrics.cpuTemperature >= 0) {
      if (metrics.cpuTemperature >= t.temperatureCritical) {
        events.push(
          this.createEvent('high_temperature', 'critical', metrics.cpuTemperature, metrics),
        )
      } else if (metrics.cpuTemperature >= t.temperatureWarning) {
        events.push(
          this.createEvent('high_temperature', 'warning', metrics.cpuTemperature, metrics),
        )
      }
    }

    // 电量
    if (metrics.batteryPercent >= 0 && !metrics.batteryCharging) {
      if (metrics.batteryPercent <= t.batteryLow) {
        events.push(
          this.createEvent('low_battery', 'warning', metrics.batteryPercent, metrics),
        )
      }
    }

    // 进程数
    if (metrics.processCount >= t.processExplosion) {
      events.push(
        this.createEvent('process_explosion', 'warning', metrics.processCount, metrics),
      )
    }

    return events
  }

  // ============================================================
  // 趋势预测：线性外推
  // ============================================================

  /**
   * 基于最近样本的趋势预测
   *
   * 对单调上升指标（如内存使用率、磁盘使用率）做线性外推，
   * 若预测在 predictiveWindowMin 分钟内会突破临界阈值，则提前预警。
   */
  private async detectByTrend(latest: SystemMetrics): Promise<AnomalyEvent[]> {
    const events: AnomalyEvent[] = []

    // 取最近样本
    const recent = this.store.getRecentMetricsFromMemory(TREND_SAMPLE_COUNT)
    if (recent.length < 5) return events // 样本不足，跳过趋势预测

    const windowMs = this.config.predictiveWindowMin * 60 * 1000
    const predictAt = latest.timestamp + windowMs
    const t = this.config.thresholds

    // 内存使用率趋势预测（疑似内存泄漏/OOM）
    const memoryTrend = this.linearExtrapolate(recent, 'memoryUsage')
    if (memoryTrend && memoryTrend.slope > 0) {
      const predicted = memoryTrend.valueAt(predictAt)
      if (predicted >= t.memoryCritical) {
        const event = this.createEvent(
          'memory_leak',
          'critical',
          latest.memoryUsage,
          latest,
          {
            predictedPeak: Math.min(predicted, 100),
            predictedTriggerAt: predictAt,
          },
        )
        events.push(event)
      }
    }

    // 磁盘使用率趋势预测
    const diskTrend = this.linearExtrapolate(recent, 'diskUsage')
    if (diskTrend && diskTrend.slope > 0) {
      const predicted = diskTrend.valueAt(predictAt)
      if (predicted >= t.diskCritical) {
        const event = this.createEvent(
          'disk_full',
          'warning',
          latest.diskUsage,
          latest,
          {
            predictedPeak: Math.min(predicted, 100),
            predictedTriggerAt: predictAt,
          },
        )
        events.push(event)
      }
    }

    return events
  }

  /**
   * 线性回归外推（最小二乘法）
   *
   * 对 (timestamp, value) 数据点拟合 y = a + b*x
   */
  private linearExtrapolate(
    samples: SystemMetrics[],
    field: keyof SystemMetrics,
  ): { slope: number; intercept: number; valueAt: (t: number) => number } | null {
    const points: Array<{ x: number; y: number }> = samples
      .map((s) => ({ x: s.timestamp, y: s[field] as unknown as number }))
      .filter((p) => typeof p.y === 'number' && p.y >= 0)

    if (points.length < 5) return null

    const n = points.length
    const sumX = points.reduce((acc, p) => acc + p.x, 0)
    const sumY = points.reduce((acc, p) => acc + p.y, 0)
    const sumXY = points.reduce((acc, p) => acc + p.x * p.y, 0)
    const sumX2 = points.reduce((acc, p) => acc + p.x * p.x, 0)

    const denominator = n * sumX2 - sumX * sumX
    if (denominator === 0) return null

    const slope = (n * sumXY - sumX * sumY) / denominator
    const intercept = (sumY - slope * sumX) / n

    return {
      slope,
      intercept,
      valueAt: (t: number) => slope * t + intercept,
    }
  }

  // ============================================================
  // Isolation Forest 多维联合检测
  // ============================================================

  /**
   * 确保模型已训练（按需重新训练）
   *
   * 训练策略：
   * - 首次训练：积累 32 个样本后启动
   * - 后续训练：每 6 小时重新训练一次
   */
  private async ensureModelTrained(): Promise<void> {
    if (this.forest.isTrained()) {
      const hoursSinceTrain = (Date.now() - this.lastTrainedAt) / (60 * 60 * 1000)
      if (hoursSinceTrain < RETRAIN_INTERVAL_HOURS) {
        return
      }
    }

    // 取最近样本作为训练数据
    const samples = this.store.getRecentMetricsFromMemory(Math.min(TREND_SAMPLE_COUNT * 4, 120))
    this.trainingSampleCount = samples.length

    if (samples.length < MIN_TRAINING_SAMPLES) {
      return // 样本不足
    }

    const features = extractFeaturesFromMetricsBatch(samples)
    const result = this.forest.train(features)
    if (result.success) {
      this.lastTrainedAt = Date.now()
      logger.monitoring?.info(
        `[AnomalyDetector] iForest 已训练: trees=${result.treeCount} samples=${result.sampleCount} duration=${result.duration}ms`,
      )
    }
  }

  /**
   * 使用 Isolation Forest 检测多维联合异常
   *
   * 与规则检测互补：捕获 CPU+内存双飙升等复合异常
   */
  private detectByForest(metrics: SystemMetrics): AnomalyEvent | null {
    if (!this.forest.isTrained()) return null

    try {
      const features = extractFeaturesFromMetrics(metrics)
      const result = this.forest.predict(features)

      if (!result.isAnomaly || !result.topFeature) return null

      // 异常得分 > 0.7 才转化为告警（避免频繁误报）
      if (result.score < 0.7) return null

      const anomalyType = this.featureToAnomalyType(result.topFeature)
      const severity: AnomalySeverity = result.score >= 0.85 ? 'critical' : 'warning'

      const event = this.createEvent(
        anomalyType,
        severity,
        metrics[result.topFeature] as unknown as number,
        metrics,
        {
          description: `检测到多维联合异常（${result.topFeature}贡献最大，异常得分=${result.score}）`,
        },
      )
      return event
    } catch (e) {
      logger.monitoring?.error('[AnomalyDetector] iForest 预测失败:', e)
      return null
    }
  }

  /** 特征名 → 异常类型映射 */
  private featureToAnomalyType(feature: string): AnomalyType {
    switch (feature) {
      case 'cpuUsage':
      case 'cpuLoadAvg1':
        return 'high_cpu'
      case 'memoryUsage':
      case 'memoryAvailableMB':
        return 'high_memory'
      case 'diskUsage':
        return 'disk_full'
      case 'diskIoReadKBps':
      case 'diskIoWriteKBps':
        return 'disk_io_high'
      case 'networkRxKBps':
      case 'networkTxKBps':
        return 'network_anomaly'
      case 'processCount':
        return 'process_explosion'
      case 'cpuTemperature':
        return 'high_temperature'
      case 'batteryPercent':
        return 'low_battery'
      default:
        return 'unknown'
    }
  }

  // ============================================================
  // 告警去重 + 状态管理
  // ============================================================

  /**
   * 告警去重
   *
   * 同类型异常在 DEDUP_WINDOW_MS 内不重复触发
   */
  private deduplicate(events: AnomalyEvent[]): AnomalyEvent[] {
    const now = Date.now()
    const result: AnomalyEvent[] = []

    for (const event of events) {
      const lastTime = this.lastAlertAt.get(event.type) ?? 0
      if (now - lastTime < DEDUP_WINDOW_MS) {
        // 在去重窗口内，跳过
        continue
      }
      this.lastAlertAt.set(event.type, now)
      result.push(event)
    }

    return result
  }

  // ============================================================
  // 异常事件工厂
  // ============================================================

  /**
   * 创建异常事件
   *
   * @param type 异常类型
   * @param severity 严重度
   * @param currentValue 当前值
   * @param metrics 触发时的完整采样
   * @param overrides 可选覆盖字段
   */
  private createEvent(
    type: AnomalyType,
    severity: AnomalySeverity,
    currentValue: number,
    metrics: SystemMetrics,
    overrides?: Partial<Pick<AnomalyEvent, 'predictedPeak' | 'predictedTriggerAt' | 'description' | 'recommendation'>>,
  ): AnomalyEvent {
    return {
      id: `anom_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      timestamp: Date.now(),
      type,
      severity,
      metricType: ANOMALY_METRIC_TYPE[type],
      currentValue,
      predictedPeak: overrides?.predictedPeak,
      predictedTriggerAt: overrides?.predictedTriggerAt,
      description: overrides?.description ?? ANOMALY_DESCRIPTIONS[type](currentValue),
      recommendation: overrides?.recommendation ?? ANOMALY_RECOMMENDATIONS[type],
      status: 'active',
      evidenceWindow: {
        start: metrics.timestamp,
        end: Date.now(),
      },
    }
  }

  // ============================================================
  // 状态管理
  // ============================================================

  /**
   * 确认异常（用户点击"已知晓"）
   *
   * @param anomalyId 异常 ID
   */
  async acknowledge(anomalyId: string): Promise<boolean> {
    return this.store.updateAnomalyStatus(anomalyId, 'acknowledged')
  }

  /**
   * 标记异常为已解决
   *
   * @param anomalyId 异常 ID
   */
  async resolve(anomalyId: string): Promise<boolean> {
    return this.store.updateAnomalyStatus(anomalyId, 'resolved')
  }

  /**
   * 自动解决已恢复的异常
   *
   * 在最新指标采样中检查所有 active 异常是否已恢复
   */
  async autoResolve(metrics: SystemMetrics): Promise<string[]> {
    const active = this.store.getActiveAnomalies()
    const resolved: string[] = []

    for (const event of active) {
      if (this.isRecovered(event, metrics)) {
        await this.resolve(event.id)
        resolved.push(event.id)
      }
    }

    if (resolved.length > 0) {
      logger.monitoring?.info(`[AnomalyDetector] 自动解决 ${resolved.length} 个异常`)
    }

    return resolved
  }

  /** 判断异常是否已恢复 */
  private isRecovered(event: AnomalyEvent, metrics: SystemMetrics): boolean {
    const t = this.config.thresholds
    switch (event.type) {
      case 'high_cpu':
        return metrics.cpuUsage < t.cpuWarning
      case 'high_memory':
      case 'memory_leak':
        return metrics.memoryUsage < t.memoryWarning
      case 'disk_full':
        return metrics.diskUsage < t.diskWarning
      case 'high_temperature':
        return metrics.cpuTemperature < t.temperatureWarning
      case 'low_battery':
        return metrics.batteryCharging || metrics.batteryPercent > t.batteryLow + 10
      case 'process_explosion':
        return metrics.processCount < t.processExplosion * 0.8
      default:
        return false
    }
  }

  // ============================================================
  // 统计
  // ============================================================

  /** 获取检测器统计信息 */
  getStats(): {
    forestTrained: boolean
    forestTreeCount: number
    trainingSampleCount: number
    lastTrainedAt: number
    activeAnomalyCount: number
  } {
    return {
      forestTrained: this.forest.isTrained(),
      forestTreeCount: this.forest.getTreeCount(),
      trainingSampleCount: this.trainingSampleCount,
      lastTrainedAt: this.lastTrainedAt,
      activeAnomalyCount: this.store.getActiveAnomalies().length,
    }
  }
}
