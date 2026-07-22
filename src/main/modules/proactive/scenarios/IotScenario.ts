/**
 * IoT 场景探测器（阶段10 s10-09 新增）
 *
 * 包含 2 个 ScenarioDetector 实现：
 * 1. IotAnomalyPersistenceDetector — IoT 异常持续检测（同一实体异常持续 ≥ 5min）
 * 2. MqttMessageAnomalyDetector     — MQTT 消息频率突变检测（>2σ）
 *
 * 数据流：
 *   SensorFusionService 异常事件 → IotAnomalyPersistenceDetector
 *   MqttAdapter 消息流 → MqttMessageTracker → MqttMessageAnomalyDetector
 *     → ScenarioSignal[] → ProactiveDecisionEngine
 *
 * @module proactive/scenarios/IotScenario
 */

import { logger } from '@shared/toolkit/LogEngine'
import {
  type ScenarioDetector,
  type ScenarioSignal,
} from '../ProactiveInterface'
import { SensorFusionService } from '../../iot/SensorFusionService'
import type { SensorAnomalyEvent } from '../../iot/SensorFusionInterface'
import { mqttMessageTracker } from './MqttMessageTracker'

// ============================================================
// 常量
// ============================================================

/** IoT 异常持续阈值（5 分钟） */
const IOT_ANOMALY_PERSISTENCE_MS = 5 * 60 * 1000

/** MQTT 消息频率突变检测窗口（最近 10 分钟 vs 基线 1 小时） */
const MQTT_RECENT_WINDOW_MS = 10 * 60 * 1000
const MQTT_BASELINE_WINDOW_MS = 60 * 60 * 1000

/** Z-Score 触发阈值（>2σ） */
const MQTT_ZSCORE_THRESHOLD = 2

// ============================================================
// 探测器 1：IoT 异常持续
// ============================================================

/**
 * IoT 异常持续探测器
 *
 * 触发条件：同一实体异常持续 ≥ 5 分钟
 * 行动：suggest（预警 + 排查建议）
 */
export class IotAnomalyPersistenceDetector implements ScenarioDetector {
  readonly name = 'IotAnomalyPersistenceDetector'
  readonly source = 'iot' as const

  /** 已提示的实体+异常类型组合（避免重复打扰，30 分钟内不重复） */
  private promptedKeys = new Map<string, number>()

  /** 提示冷却时间（30 分钟） */
  private static readonly PROMPT_COOLDOWN_MS = 30 * 60 * 1000

  async detect(): Promise<ScenarioSignal[]> {
    try {
      const fusion = SensorFusionService.getInstance()
      const anomalies = fusion.getRecentAnomalies(50)
      if (anomalies.length === 0) return []

      const now = Date.now()
      const signals: ScenarioSignal[] = []

      // 按实体+异常类型分组，检查持续时间
      const anomalyGroups = new Map<string, SensorAnomalyEvent[]>()
      for (const anomaly of anomalies) {
        const key = `${anomaly.entityId}:${anomaly.type}`
        const group = anomalyGroups.get(key) ?? []
        group.push(anomaly)
        anomalyGroups.set(key, group)
      }

      for (const [key, group] of anomalyGroups) {
        // 检查最近一次异常是否在持续期内
        const latest = group[0]
        if (now - latest.timestamp > IOT_ANOMALY_PERSISTENCE_MS) continue

        // 检查是否有足够长的持续记录（最早一条距今 ≥ 5 分钟）
        const earliest = group[group.length - 1]
        const durationMs = latest.timestamp - earliest.timestamp
        if (durationMs < IOT_ANOMALY_PERSISTENCE_MS) continue

        // 冷却检查
        const lastPrompted = this.promptedKeys.get(key) ?? 0
        if (now - lastPrompted < IotAnomalyPersistenceDetector.PROMPT_COOLDOWN_MS) continue

        this.promptedKeys.set(key, now)

        const durationMin = Math.round(durationMs / 60000)
        const signal: ScenarioSignal = {
          source: 'iot',
          trigger: `iot_anomaly_persist:${latest.entityId}:${latest.type}`,
          severity: latest.severity === 'critical' ? 'high' : 'medium',
          title: 'IoT 异常持续告警',
          description: `实体 "${latest.externalId}" 的 ${latest.type} 异常已持续 ${durationMin} 分钟（${group.length} 次事件）`,
          action: {
            type: 'suggest',
            payload: `IoT 实体 "${latest.externalId}"（类型: ${latest.entityType}）检测到 ${latest.type} 异常，已持续 ${durationMin} 分钟。\n\n异常描述: ${latest.description}\n建议操作: ${latest.recommendation}\n\n当前值: ${latest.currentValue}${latest.unit ?? ''}\n\n请检查设备状态和传感器连接。`,
          },
          confidence: Math.min(0.5 + group.length * 0.05, 0.85),
          reason: `实体 ${latest.entityId} 的 ${latest.type} 异常在 ${durationMin} 分钟内触发 ${group.length} 次，超过 ${IOT_ANOMALY_PERSISTENCE_MS / 60000} 分钟持续阈值`,
          dedupKey: `iot_anomaly_persist:${latest.entityId}:${latest.type}`,
        }
        signals.push(signal)
      }

      // 清理过期的冷却记录
      this.cleanupPromptedKeys(now)

      return signals
    } catch (e) {
      logger.proactive?.warn(`[${this.name}] 探测失败:`, e)
      return []
    }
  }

  /** 清理过期的冷却记录 */
  private cleanupPromptedKeys(now: number): void {
    for (const [key, ts] of this.promptedKeys) {
      if (now - ts > IotAnomalyPersistenceDetector.PROMPT_COOLDOWN_MS * 2) {
        this.promptedKeys.delete(key)
      }
    }
  }
}

// ============================================================
// 探测器 2：MQTT 消息频率异常
// ============================================================

/**
 * MQTT 消息频率突变探测器
 *
 * 触发条件：消息频率突变（最近 10 分钟 vs 基线 1 小时，Z-Score > 2）
 * 行动：notify（异常通知）
 */
export class MqttMessageAnomalyDetector implements ScenarioDetector {
  readonly name = 'MqttMessageAnomalyDetector'
  readonly source = 'iot' as const

  /** 上次提示时间（避免频繁打扰） */
  private lastPromptAt: number = 0

  /** 提示间隔（15 分钟） */
  private static readonly PROMPT_INTERVAL_MS = 15 * 60 * 1000

  async detect(): Promise<ScenarioSignal[]> {
    try {
      // 频率控制
      const now = Date.now()
      if (now - this.lastPromptAt < MqttMessageAnomalyDetector.PROMPT_INTERVAL_MS) {
        return []
      }

      const stats = mqttMessageTracker.getFrequencyStats(
        MQTT_RECENT_WINDOW_MS,
        MQTT_BASELINE_WINDOW_MS,
      )

      if (!stats || stats.zscore < MQTT_ZSCORE_THRESHOLD) return []

      this.lastPromptAt = now

      const signal: ScenarioSignal = {
        source: 'iot',
        trigger: `mqtt_msg_anomaly:zscore_${stats.zscore.toFixed(1)}`,
        severity: stats.zscore > 3 ? 'medium' : 'low',
        title: 'MQTT 消息频率异常',
        description: `最近 10 分钟消息频率为 ${stats.recentRate.toFixed(1)}/min，偏离基线 ${stats.zscore.toFixed(1)}σ（基线 ${stats.baselineRate.toFixed(1)}/min）`,
        action: {
          type: 'notify',
          payload: `MQTT 消息流检测到频率突变：\n- 最近 10 分钟: ${stats.recentRate.toFixed(1)} 条/分钟\n- 基线（1 小时）: ${stats.baselineRate.toFixed(1)} 条/分钟\n- Z-Score: ${stats.zscore.toFixed(2)}\n\n可能原因：设备故障、网络抖动、传感器异常。建议检查 MQTT 客户端和设备状态。`,
        },
        confidence: Math.min(0.5 + stats.zscore * 0.1, 0.85),
        reason: `消息频率 Z-Score=${stats.zscore.toFixed(2)}，超过 ${MQTT_ZSCORE_THRESHOLD}σ 阈值`,
        dedupKey: `mqtt_msg_anomaly:frequency`,
      }
      return [signal]
    } catch (e) {
      logger.proactive?.warn(`[${this.name}] 探测失败:`, e)
      return []
    }
  }
}

// ============================================================
// 导出所有 IoT 探测器实例
// ============================================================

export const iotDetectors: ScenarioDetector[] = [
  new IotAnomalyPersistenceDetector(),
  new MqttMessageAnomalyDetector(),
]
