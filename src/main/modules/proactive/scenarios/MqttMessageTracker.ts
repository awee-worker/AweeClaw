/**
 * MQTT 消息频率追踪器（阶段10 s10-09 新增）
 *
 * 轻量级单例，记录 MQTT 消息接收时间戳，供 IotScenario 的 MqttMessageAnomalyDetector 使用：
 * - 统计最近窗口（10 分钟）的消息频率
 * - 计算与基线窗口（1 小时）的 Z-Score
 *
 * 数据流：
 *   IoTBridge 内部事件（reading/entityUpdate）
 *     → recordMessage()
 *     → MqttMessageTracker（内存时间戳数组）
 *     → MqttMessageAnomalyDetector 读取 getFrequencyStats()
 *
 * 订阅策略：
 * - 通过 IoTBridge.onInternal() 订阅主进程内部事件（项目既定模式，
 *   参见 SensorFusionService.start / IoTMetricsCollector.attach）
 * - 同时监听 'reading'（数值型消息）与 'entityUpdate'（所有消息）两类事件，
 *   避免漏报非数值型 MQTT 消息（ON/OFF、JSON 等）
 * - MqttAdapter 本身不 extends EventEmitter，无法直接订阅
 *
 * 设计原则：
 * - 纯内存，不持久化
 * - 滑动窗口统计，自动清理过期数据
 * - 低开销（仅存储时间戳，不存储消息内容）
 *
 * @module proactive/scenarios/MqttMessageTracker
 */

import { logger } from '@shared/toolkit/LogEngine'

// ============================================================
// 类型定义
// ============================================================

/** 频率统计结果 */
export interface MqttFrequencyStats {
  /** 最近窗口消息数 */
  recentCount: number
  /** 最近窗口消息频率（条/分钟） */
  recentRate: number
  /** 基线窗口消息数 */
  baselineCount: number
  /** 基线窗口消息频率（条/分钟） */
  baselineRate: number
  /** Z-Score（最近频率偏离基线的标准差倍数，>2σ 视为异常） */
  zscore: number
}

// ============================================================
// 常量
// ============================================================

/** 最大保留时间戳数（防止内存溢出） */
const MAX_TIMESTAMPS = 5000

/** 自动清理间隔（5 分钟） */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000

/** 基线最小样本数（不足则不计算 Z-Score） */
const MIN_BASELINE_SAMPLES = 10

// ============================================================
// MqttMessageTracker 单例
// ============================================================

export class MqttMessageTracker {
  private static instance: MqttMessageTracker | null = null

  /** 消息时间戳列表（按时间顺序，最新在末尾） */
  private timestamps: number[] = []

  /** 上次清理时间 */
  private lastCleanupAt: number = Date.now()

  /** 是否已订阅 IoT Bridge 事件 */
  private subscribed: boolean = false

  /** IoTBridge 内部事件取消订阅函数 */
  private unsubscribeBridge: (() => void) | null = null

  private constructor() {}

  static getInstance(): MqttMessageTracker {
    if (!MqttMessageTracker.instance) {
      MqttMessageTracker.instance = new MqttMessageTracker()
    }
    return MqttMessageTracker.instance
  }

  // ============================================================
  // 写入接口（由 MqttAdapter 消息事件调用）
  // ============================================================

  /** 记录一条 MQTT 消息 */
  recordMessage(): void {
    this.timestamps.push(Date.now())

    // 防止内存溢出
    if (this.timestamps.length > MAX_TIMESTAMPS) {
      this.timestamps = this.timestamps.slice(-MAX_TIMESTAMPS)
    }

    // 定期清理过期数据
    const now = Date.now()
    if (now - this.lastCleanupAt > CLEANUP_INTERVAL_MS) {
      this.cleanup(now)
      this.lastCleanupAt = now
    }
  }

  /**
   * 订阅 IoT Bridge 内部事件以记录 MQTT 消息
   *
   * 实现说明：
   * - MqttAdapter 本身不是 EventEmitter，MQTT 消息通过
   *   AdapterCallbacks → IoTBridge.handleReading/handleEntityUpdate
   *   → emitInternal({type:'reading'|'entityUpdate'}) 派发
   * - 此处订阅 IoTBridge.onInternal() 是项目既定模式
   *   （参见 SensorFusionService.start / IoTMetricsCollector.attach）
   * - 同时监听 'reading'（数值型）与 'entityUpdate'（所有消息）两类事件，
   *   避免漏报非数值型 MQTT 消息
   *
   * 注：方法名保留 subscribeToMqttAdapter 以兼容外部调用约定。
   */
  subscribeToMqttAdapter(): void {
    if (this.subscribed) return
    this.subscribed = true

    try {
      // 动态导入避免循环依赖
      import('../../iot/IoTBridge')
        .then(({ IoTBridge }) => {
          const bridge = IoTBridge.getInstance()
          this.unsubscribeBridge = bridge.onInternal((event) => {
            // 数值型消息触发 reading，所有消息触发 entityUpdate
            if (
              event.type !== 'reading' &&
              event.type !== 'entityUpdate'
            ) {
              return
            }
            this.recordMessage()
          })
          logger.proactive?.info(
            '[MqttMessageTracker] 已订阅 IoTBridge 内部事件',
          )
        })
        .catch((e) => {
          logger.proactive?.warn(
            '[MqttMessageTracker] 订阅 IoTBridge 失败:',
            e,
          )
          this.subscribed = false
        })
    } catch (e) {
      logger.proactive?.warn('[MqttMessageTracker] 订阅初始化失败:', e)
      this.subscribed = false
    }
  }

  /**
   * 停止订阅并释放资源
   *
   * 在模块卸载或应用退出时调用。
   */
  dispose(): void {
    if (this.unsubscribeBridge) {
      try {
        this.unsubscribeBridge()
      } catch (e) {
        logger.proactive?.warn('[MqttMessageTracker] 取消订阅失败:', e)
      }
      this.unsubscribeBridge = null
    }
    this.subscribed = false
  }

  // ============================================================
  // 读取接口（由探测器调用）
  // ============================================================

  /**
   * 获取频率统计
   * @param recentWindowMs 最近窗口大小（默认 10 分钟）
   * @param baselineWindowMs 基线窗口大小（默认 1 小时）
   * @returns 统计结果（null 表示样本不足）
   */
  getFrequencyStats(
    recentWindowMs: number = 10 * 60 * 1000,
    baselineWindowMs: number = 60 * 60 * 1000,
  ): MqttFrequencyStats | null {
    const now = Date.now()
    const recentCutoff = now - recentWindowMs
    const baselineCutoff = now - baselineWindowMs

    let recentCount = 0
    let baselineCount = 0

    // 从最新往前扫描
    for (let i = this.timestamps.length - 1; i >= 0; i--) {
      const ts = this.timestamps[i]
      if (ts < baselineCutoff) break
      baselineCount++
      if (ts >= recentCutoff) {
        recentCount++
      }
    }

    // 基线样本不足
    if (baselineCount < MIN_BASELINE_SAMPLES) return null

    const recentRate = recentCount / (recentWindowMs / 60000)
    const baselineRate = baselineCount / (baselineWindowMs / 60000)

    // 计算 Z-Score
    // 将基线窗口按 10 分钟分桶，计算各桶频率的均值和标准差
    const bucketSize = recentWindowMs
    const bucketCount = Math.floor(baselineWindowMs / bucketSize)
    const bucketRates: number[] = []

    for (let i = 0; i < bucketCount; i++) {
      const bucketStart = baselineCutoff + i * bucketSize
      const bucketEnd = bucketStart + bucketSize
      let bucketCount = 0
      for (const ts of this.timestamps) {
        if (ts >= bucketStart && ts < bucketEnd) {
          bucketCount++
        }
      }
      bucketRates.push(bucketCount / (bucketSize / 60000))
    }

    const mean = bucketRates.reduce((a, b) => a + b, 0) / bucketRates.length
    const variance =
      bucketRates.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) /
      bucketRates.length
    const stdDev = Math.sqrt(variance)

    const zscore = stdDev > 0 ? (recentRate - mean) / stdDev : 0

    return {
      recentCount,
      recentRate,
      baselineCount,
      baselineRate,
      zscore,
    }
  }

  // ============================================================
  // 私有方法
  // ============================================================

  /** 清理过期时间戳（保留最近 1 小时） */
  private cleanup(now: number): void {
    const cutoff = now - 60 * 60 * 1000
    const idx = this.timestamps.findIndex((ts) => ts >= cutoff)
    if (idx > 0) {
      this.timestamps = this.timestamps.slice(idx)
    }
  }

  /** 清空历史（测试用） */
  clear(): void {
    this.timestamps = []
  }
}

/** 单例实例 */
export const mqttMessageTracker = MqttMessageTracker.getInstance()
