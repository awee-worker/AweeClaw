/**
 * 系统场景探测器（阶段10 s10-09 新增）
 *
 * 包含 2 个 ScenarioDetector 实现：
 * 1. SystemResourceAlertDetector — 系统资源告警（CPU>90%/内存>85%/磁盘>95% 持续 1min）
 * 2. PredictiveAlertDetector     — 预测性告警（基于历史趋势预测 1h 内可能告警）
 *
 * 数据流：
 *   MonitoringService.getLatestMetrics() → SystemResourceAlertDetector
 *   MonitoringService.getMetricsByTimeRange() → PredictiveAlertDetector
 *     → ScenarioSignal[] → ProactiveDecisionEngine
 *
 * @module proactive/scenarios/SystemScenario
 */

import { logger } from '@shared/toolkit/LogEngine'
import {
  type ScenarioDetector,
  type ScenarioSignal,
} from '../ProactiveInterface'
import { MonitoringService } from '../../monitoring/MonitoringService'
import type { SystemMetrics } from '../../monitoring/MonitoringInterface'

// ============================================================
// 常量
// ============================================================

/** 资源告警阈值 */
const CPU_ALERT_THRESHOLD = 90
const MEMORY_ALERT_THRESHOLD = 85
const DISK_ALERT_THRESHOLD = 95

/** 资源告警持续阈值（1 分钟，检查最近 2 次采样是否都超限） */
const RESOURCE_ALERT_PERSISTENCE_SAMPLES = 2

/** 预测性告警历史窗口（1 小时） */
const PREDICTIVE_HISTORY_WINDOW_MS = 60 * 60 * 1000

/** 预测窗口（未来 1 小时） */
const PREDICTIVE_FORECAST_WINDOW_MS = 60 * 60 * 1000

/** 预测性告警的斜率阈值（每小时增长 > 5% 视为可能告警） */
const PREDICTIVE_SLOPE_THRESHOLD = 5

// ============================================================
// 探测器 1：系统资源告警
// ============================================================

/**
 * 系统资源告警探测器
 *
 * 触发条件：CPU>90% 或 内存>85% 或 磁盘>95% 持续 1 分钟（连续 2 次采样）
 * 行动：suggest（建议清理）
 */
export class SystemResourceAlertDetector implements ScenarioDetector {
  readonly name = 'SystemResourceAlertDetector'
  readonly source = 'system' as const

  /** 上次提示时间（避免频繁打扰，15 分钟冷却） */
  private lastPromptAt: number = 0

  /** 提示间隔（15 分钟） */
  private static readonly PROMPT_INTERVAL_MS = 15 * 60 * 1000

  async detect(): Promise<ScenarioSignal[]> {
    try {
      // 频率控制
      const now = Date.now()
      if (now - this.lastPromptAt < SystemResourceAlertDetector.PROMPT_INTERVAL_MS) {
        return []
      }

      const monitoring = MonitoringService.getInstance()
      const latest = monitoring.getLatestMetrics()
      if (!latest) return []

      // 检查是否超过阈值
      const alerts = this.checkThresholds(latest)
      if (alerts.length === 0) return []

      // 检查持续性（获取历史采样，检查最近 N 次是否都超限）
      const history = await monitoring.getMetricsByTimeRange(
        now - 5 * 60 * 1000, // 最近 5 分钟
        now,
        RESOURCE_ALERT_PERSISTENCE_SAMPLES + 2,
      )
      if (history.length < RESOURCE_ALERT_PERSISTENCE_SAMPLES) return []

      // 检查最近 N 次采样是否都有同一类告警
      const recentHistory = history.slice(-RESOURCE_ALERT_PERSISTENCE_SAMPLES)
      const persistentAlerts = alerts.filter((alert) =>
        recentHistory.every((m) => this.isMetricOverThreshold(m, alert.type)),
      )
      if (persistentAlerts.length === 0) return []

      this.lastPromptAt = now

      const topAlert = persistentAlerts[0]
      const signal: ScenarioSignal = {
        source: 'system',
        trigger: `system_resource:${topAlert.type}:${topAlert.value.toFixed(1)}`,
        severity: topAlert.value > 95 ? 'high' : 'medium',
        title: '系统资源告警',
        description: `${topAlert.label}已达到 ${topAlert.value.toFixed(1)}%（阈值 ${topAlert.threshold}%），持续超过 1 分钟`,
        action: {
          type: 'suggest',
          payload: this.buildResourceSuggestion(persistentAlerts, latest),
        },
        confidence: Math.min(0.6 + (topAlert.value - topAlert.threshold) * 0.02, 0.9),
        reason: `${topAlert.label} ${topAlert.value.toFixed(1)}% 超过阈值 ${topAlert.threshold}%，连续 ${RESOURCE_ALERT_PERSISTENCE_SAMPLES} 次采样均超限`,
        dedupKey: `system_resource:${topAlert.type}`,
      }
      return [signal]
    } catch (e) {
      logger.proactive?.warn(`[${this.name}] 探测失败:`, e)
      return []
    }
  }

  /** 检查指标是否超过阈值 */
  private checkThresholds(metrics: SystemMetrics): Array<{
    type: 'cpu' | 'memory' | 'disk'
    label: string
    value: number
    threshold: number
  }> {
    const alerts: Array<{
      type: 'cpu' | 'memory' | 'disk'
      label: string
      value: number
      threshold: number
    }> = []

    if (metrics.cpuUsage >= CPU_ALERT_THRESHOLD) {
      alerts.push({
        type: 'cpu',
        label: 'CPU 使用率',
        value: metrics.cpuUsage,
        threshold: CPU_ALERT_THRESHOLD,
      })
    }
    if (metrics.memoryUsage >= MEMORY_ALERT_THRESHOLD) {
      alerts.push({
        type: 'memory',
        label: '内存使用率',
        value: metrics.memoryUsage,
        threshold: MEMORY_ALERT_THRESHOLD,
      })
    }
    if (metrics.diskUsage >= DISK_ALERT_THRESHOLD) {
      alerts.push({
        type: 'disk',
        label: '磁盘使用率',
        value: metrics.diskUsage,
        threshold: DISK_ALERT_THRESHOLD,
      })
    }

    return alerts
  }

  /** 判断特定指标是否超阈值 */
  private isMetricOverThreshold(
    metrics: SystemMetrics,
    type: 'cpu' | 'memory' | 'disk',
  ): boolean {
    switch (type) {
      case 'cpu':
        return metrics.cpuUsage >= CPU_ALERT_THRESHOLD
      case 'memory':
        return metrics.memoryUsage >= MEMORY_ALERT_THRESHOLD
      case 'disk':
        return metrics.diskUsage >= DISK_ALERT_THRESHOLD
    }
  }

  /** 构建资源建议文本 */
  private buildResourceSuggestion(
    alerts: Array<{ type: string; label: string; value: number; threshold: number }>,
    metrics: SystemMetrics,
  ): string {
    const lines = alerts.map(
      (a) => `- ${a.label}: ${a.value.toFixed(1)}%（阈值 ${a.threshold}%）`,
    )
    lines.push('')
    lines.push(`进程数: ${metrics.processCount}`)
    lines.push(`可用内存: ${metrics.memoryAvailableMB.toFixed(0)} MB / ${metrics.memoryTotalMB.toFixed(0)} MB`)
    lines.push('')
    lines.push('建议操作:')
    lines.push('1. 检查是否有异常进程占用资源')
    lines.push('2. 关闭不必要的应用和浏览器标签页')
    lines.push('3. 清理临时文件和缓存')
    lines.push('4. 如果磁盘空间不足，考虑清理日志和大文件')

    return `检测到系统资源持续告警：\n\n${lines.join('\n')}`
  }
}

// ============================================================
// 探测器 2：预测性告警
// ============================================================

/**
 * 预测性告警探测器
 *
 * 触发条件：基于历史趋势预测 1h 内可能告警（线性回归斜率 > 阈值）
 * 行动：low（提前预警通知）
 */
export class PredictiveAlertDetector implements ScenarioDetector {
  readonly name = 'PredictiveAlertDetector'
  readonly source = 'system' as const

  /** 上次提示时间（避免频繁打扰，30 分钟冷却） */
  private lastPromptAt: number = 0

  /** 提示间隔（30 分钟） */
  private static readonly PROMPT_INTERVAL_MS = 30 * 60 * 1000

  async detect(): Promise<ScenarioSignal[]> {
    try {
      // 频率控制
      const now = Date.now()
      if (now - this.lastPromptAt < PredictiveAlertDetector.PROMPT_INTERVAL_MS) {
        return []
      }

      const monitoring = MonitoringService.getInstance()
      const history = await monitoring.getMetricsByTimeRange(
        now - PREDICTIVE_HISTORY_WINDOW_MS,
        now,
        60, // 最多 60 个采样点
      )
      if (history.length < 10) return []

      // 对 CPU、内存、磁盘分别做线性回归
      const predictions: Array<{
        type: 'cpu' | 'memory' | 'disk'
        label: string
        currentValue: number
        predictedValue: number
        slope: number
        threshold: number
      }> = []

      const cpuPred = this.predictMetric(history.map((m) => m.cpuUsage), 'cpu', 'CPU 使用率', CPU_ALERT_THRESHOLD)
      if (cpuPred) predictions.push(cpuPred)

      const memPred = this.predictMetric(history.map((m) => m.memoryUsage), 'memory', '内存使用率', MEMORY_ALERT_THRESHOLD)
      if (memPred) predictions.push(memPred)

      const diskPred = this.predictMetric(history.map((m) => m.diskUsage), 'disk', '磁盘使用率', DISK_ALERT_THRESHOLD)
      if (diskPred) predictions.push(diskPred)

      if (predictions.length === 0) return []

      this.lastPromptAt = now

      const top = predictions[0]
      const signal: ScenarioSignal = {
        source: 'system',
        trigger: `predictive_alert:${top.type}:slope_${top.slope.toFixed(2)}`,
        severity: 'low',
        title: '预测性资源告警',
        description: `基于最近 1 小时趋势，${top.label}可能在 1 小时内达到 ${top.predictedValue.toFixed(1)}%（当前 ${top.currentValue.toFixed(1)}%，阈值 ${top.threshold}%）`,
        action: {
          type: 'notify',
          payload: this.buildPredictiveMessage(predictions),
        },
        confidence: Math.min(0.4 + top.slope * 0.05, 0.75),
        reason: `${top.label}增长斜率 ${top.slope.toFixed(2)}%/h，超过 ${PREDICTIVE_SLOPE_THRESHOLD}% 阈值，预测 1h 后达到 ${top.predictedValue.toFixed(1)}%`,
        dedupKey: `predictive_alert:${top.type}`,
      }
      return [signal]
    } catch (e) {
      logger.proactive?.warn(`[${this.name}] 探测失败:`, e)
      return []
    }
  }

  /**
   * 线性回归预测
   * @returns 如果预测值会超过阈值则返回预测结果，否则返回 null
   */
  private predictMetric(
    values: number[],
    type: 'cpu' | 'memory' | 'disk',
    label: string,
    threshold: number,
  ): {
    type: 'cpu' | 'memory' | 'disk'
    label: string
    currentValue: number
    predictedValue: number
    slope: number
    threshold: number
  } | null {
    if (values.length < 10) return null

    const n = values.length
    const x = Array.from({ length: n }, (_, i) => i)

    // 最小二乘法线性回归
    const sumX = x.reduce((a, b) => a + b, 0)
    const sumY = values.reduce((a, b) => a + b, 0)
    const sumXY = x.reduce((sum, xi, i) => sum + xi * values[i], 0)
    const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0)

    const denominator = n * sumX2 - sumX * sumX
    if (denominator === 0) return null

    const slope = (n * sumXY - sumX * sumY) / denominator
    const intercept = (sumY - slope * sumX) / n

    const currentValue = values[n - 1]
    // 预测未来 1 小时后的值
    // 假设采样间隔约 60 秒，1 小时 ≈ 60 个采样点
    const samplesAhead = Math.floor(PREDICTIVE_FORECAST_WINDOW_MS / 60000)
    const predictedValue = slope * (n - 1 + samplesAhead) + intercept

    // 斜率不足或预测值未超过阈值
    if (slope < PREDICTIVE_SLOPE_THRESHOLD) return null
    if (predictedValue < threshold) return null
    // 已经超过阈值的不再预测（由 SystemResourceAlertDetector 处理）
    if (currentValue >= threshold) return null

    return {
      type,
      label,
      currentValue,
      predictedValue: Math.min(predictedValue, 100), // 上限 100%
      slope: slope * 60, // 转换为每小时斜率
      threshold,
    }
  }

  /** 构建预测性告警消息 */
  private buildPredictiveMessage(
    predictions: Array<{
      label: string
      currentValue: number
      predictedValue: number
      slope: number
      threshold: number
    }>,
  ): string {
    const lines = predictions.map(
      (p) =>
        `- ${p.label}: 当前 ${p.currentValue.toFixed(1)}%，预测 1h 后 ${p.predictedValue.toFixed(1)}%（斜率 ${p.slope.toFixed(2)}%/h，阈值 ${p.threshold}%）`,
    )
    return `基于历史趋势的资源预测告警：\n\n${lines.join('\n')}\n\n建议提前采取预防措施以避免资源耗尽。`
  }
}

// ============================================================
// 导出所有系统场景探测器实例
// ============================================================

export const systemDetectors: ScenarioDetector[] = [
  new SystemResourceAlertDetector(),
  new PredictiveAlertDetector(),
]
