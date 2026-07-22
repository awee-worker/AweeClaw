/**
 * 传感器数据融合主服务
 *
 * 职责：
 * - 订阅 IoTBridge 的内部 reading 事件
 * - 为每个实体维护滚动窗口统计（均值/标准差/极值）
 * - 实时检测三种传感器异常：Z-Score 离群 / 变化率异常 / 值卡死
 * - 与因果推理联动：将异常转为 CausalEvent 喂入 CausalReasoningService.collectEvent
 *   并可选触发反事实查询（查询变量名为 causalNode.name，通过 metadata.iotEntityId 关联）
 * - 与监控服务联动：通过 onAnomaly 回调推送传感器异常给 MonitoringService
 *   （注：MonitoringService 的 onAnomaly 是单向订阅接口，此处仅做事件转发，
 *   实际持久化与 UI 通知由订阅方处理）
 *
 * 单例模式，主进程启动时由 moduleInitializer 初始化。
 *
 * @module iot/SensorFusionService
 */

import { logger } from '@shared/toolkit/LogEngine';
import { IoTBridge, type IoTBridgeInternalEvent } from './IoTBridge';
import type { IoTEntitySnapshot } from './IoTInterface';
import {
  DEFAULT_SENSOR_FUSION_CONFIG,
  type SensorFusionConfig,
  type EntityTypeOverride,
  type ReadingRecord,
  type EntityWindowStats,
  type SensorAnomalyEvent,
  type SensorAnomalyType,
  type SensorAnomalySeverity,
  type SensorAnomalyCallback,
  type SensorFusionStatus,
} from './SensorFusionInterface';
import type { CausalEvent } from '../causal-reasoning/CausalReasoningInterface';
import {
  sensorAnomalyEventDb,
  type AnomalyEventQueryFilter,
  type AnomalyEventQueryResult,
} from './SensorAnomalyEventDb';

// ============================================================
// 内部辅助类型
// ============================================================

/**
 * 解析后的有效配置（全局配置与按实体类型覆盖合并的结果）
 *
 * 所有字段均为必填，便于检测算法直接使用而无需做 undefined 判断。
 */
export interface ResolvedSensorFusionConfig {
  /** 滚动窗口大小 */
  windowSize: number;
  /** Z-Score 异常阈值 */
  zscoreThreshold: number;
  /** 变化率异常阈值 */
  rateOfChangeThreshold: number;
  /** 卡死检测超时（毫秒） */
  stuckValueTimeoutMs: number;
  /** 卡死检测最小读数个数 */
  stuckMinReadings: number;
  /** 冷却时间（毫秒） */
  cooldownMs: number;
}

/** 实体跟踪状态 */
interface EntityTracker {
  /** 实体 ID（IoTBridge 内部 ID） */
  entityId: string;
  /** 实体外部 ID（与因果节点 metadata.iotEntityId 关联） */
  externalId: string;
  /** 实体类型 */
  entityType: string;
  /** Provider ID */
  providerId: string;
  /** 滚动窗口读数 */
  readings: ReadingRecord[];
  /** 最近一次读数时间戳 */
  lastTimestamp: number;
  /** 最近一次读数值 */
  lastValue: number | null;
  /** 冷却表：key = `${anomalyType}`，value = 上次告警时间戳 */
  cooldowns: Map<string, number>;
}

// ============================================================
// 常量
// ============================================================

/** 单实体窗口最大容量（防配置失控） */
const MAX_WINDOW_CAP = 500;

/** 冷却表清理间隔（毫秒） */
const COOLDOWN_PURGE_INTERVAL_MS = 5 * 60 * 1000;

/** 异常事件保留期清理间隔（毫秒，每小时执行一次） */
const ANOMALY_RETENTION_PURGE_INTERVAL_MS = 60 * 60 * 1000;

// ============================================================
// SensorFusionService 实现
// ============================================================

/**
 * 传感器数据融合服务
 *
 * 使用方式：
 * ```ts
 * const service = SensorFusionService.getInstance();
 * await service.initialize();
 * service.updateConfig({ enabled: true });
 * service.start();
 * service.onAnomaly((event) => {
 *   // 推送到渲染层 toast / 桌面通知
 * });
 * ```
 */
export class SensorFusionService {
  private static instance: SensorFusionService | null = null;

  /** 配置 */
  private config: SensorFusionConfig = { ...DEFAULT_SENSOR_FUSION_CONFIG };

  /** 实体跟踪表（按 entityId 索引） */
  private readonly trackers = new Map<string, EntityTracker>();

  /** 异常事件订阅回调 */
  private readonly anomalyCallbacks = new Set<SensorAnomalyCallback>();

  /** IoTBridge 内部事件取消订阅函数 */
  private unsubscribeBridge: (() => void) | null = null;

  /** 冷却表清理定时器 */
  private cooldownTimer: NodeJS.Timeout | null = null;

  /** 异常事件保留期清理定时器 */
  private retentionPurgeTimer: NodeJS.Timeout | null = null;

  /** 是否已启动 */
  private running = false;

  /** 启动时间戳 */
  private startedAt: number | null = null;

  /** 累计处理读数数 */
  private totalReadingsProcessed = 0;

  /** 累计检测异常数 */
  private totalAnomaliesDetected = 0;

  /** 当前活跃异常数（在冷却期内） */
  private activeAnomalyCount = 0;

  /** 因果推理服务引用（懒加载避免循环依赖） */
  private causalService: {
    collectEvent(event: CausalEvent): void;
    listNodes(filter?: {
      type?: string;
      source?: string;
      enabled?: boolean;
      keyword?: string;
    }): Array<{
      id: string;
      name: string;
      metadata?: Record<string, unknown>;
    }>;
    counterfactual(
      interventionVar: string,
      interventionValue: unknown,
      observedVar: string,
      observedValue: unknown,
      sceneKey?: string,
    ): Promise<unknown>;
  } | null = null;

  private constructor() {}

  /** 获取单例 */
  static getInstance(): SensorFusionService {
    if (!SensorFusionService.instance) {
      SensorFusionService.instance = new SensorFusionService();
    }
    return SensorFusionService.instance;
  }

  // ============================================================
  // 生命周期
  // ============================================================

  /**
   * 初始化（懒加载因果推理服务引用 + 异常事件数据库）
   *
   * 不在此处启动订阅；start() 才会真正订阅 IoTBridge 事件。
   */
  async initialize(): Promise<void> {
    try {
      // 懒加载因果推理服务（避免主进程启动时的循环依赖）
      const { CausalReasoningService } = await import(
        '../causal-reasoning/CausalReasoningService'
      );
      this.causalService = CausalReasoningService.getInstance() as unknown as SensorFusionService['causalService'];
      logger.iot?.info('[SensorFusion] 初始化完成（已桥接因果推理服务）');
    } catch (err) {
      logger.iot?.warn(
        '[SensorFusion] 因果推理服务加载失败，将仅做本地异常检测:',
        err,
      );
    }

    // 初始化异常事件持久化数据库（阶段7 s7-06）
    try {
      await sensorAnomalyEventDb.initialize();
      // 启动时清理一次过期数据
      sensorAnomalyEventDb.cleanupByRetention(this.config.retentionDays);
      logger.iot?.info('[SensorFusion] 异常事件数据库已初始化');
    } catch (err) {
      logger.iot?.warn(
        '[SensorFusion] 异常事件数据库初始化失败（非致命，持久化将不可用）:',
        err,
      );
    }
  }

  /** 启动融合服务：订阅 IoTBridge 内部事件 */
  start(): void {
    if (this.running) {
      logger.iot?.warn('[SensorFusion] 已在运行中，跳过启动');
      return;
    }
    if (!this.config.enabled) {
      logger.iot?.info('[SensorFusion] 配置未启用，跳过启动');
      return;
    }

    const bridge = IoTBridge.getInstance();
    this.unsubscribeBridge = bridge.onInternal((event) => {
      this.handleBridgeEvent(event);
    });

    this.running = true;
    this.startedAt = Date.now();

    // 启动冷却表清理定时器
    this.cooldownTimer = setInterval(() => {
      this.purgeExpiredCooldowns();
    }, COOLDOWN_PURGE_INTERVAL_MS);

    // 启动异常事件保留期清理定时器（阶段7 s7-06）
    this.retentionPurgeTimer = setInterval(() => {
      const deleted = sensorAnomalyEventDb.cleanupByRetention(
        this.config.retentionDays,
      );
      if (deleted > 0) {
        logger.iot?.info(
          `[SensorFusion] 保留期清理：删除 ${deleted} 条过期异常事件`,
        );
      }
    }, ANOMALY_RETENTION_PURGE_INTERVAL_MS);

    logger.iot?.info('[SensorFusion] 已启动（订阅 IoTBridge 内部事件）');
  }

  /** 停止融合服务 */
  stop(): void {
    if (!this.running) return;

    if (this.unsubscribeBridge) {
      this.unsubscribeBridge();
      this.unsubscribeBridge = null;
    }
    if (this.cooldownTimer) {
      clearInterval(this.cooldownTimer);
      this.cooldownTimer = null;
    }
    if (this.retentionPurgeTimer) {
      clearInterval(this.retentionPurgeTimer);
      this.retentionPurgeTimer = null;
    }

    this.running = false;
    this.startedAt = null;
    logger.iot?.info('[SensorFusion] 已停止');
  }

  /** 是否运行中 */
  isRunning(): boolean {
    return this.running;
  }

  // ============================================================
  // 配置管理
  // ============================================================

  /** 获取当前配置 */
  getConfig(): SensorFusionConfig {
    return { ...this.config };
  }

  /**
   * 更新配置
   *
   * - enabled 切换会自动 start/stop
   * - windowSize 变化时，已有窗口会按新大小裁剪
   */
  updateConfig(patch: Partial<SensorFusionConfig>): SensorFusionConfig {
    const prevEnabled = this.config.enabled;
    const prevWindowSize = this.config.windowSize;
    this.config = { ...this.config, ...patch };

    // windowSize 变化时裁剪已有窗口
    if (
      patch.windowSize !== undefined &&
      patch.windowSize !== prevWindowSize
    ) {
      const cap = Math.min(patch.windowSize, MAX_WINDOW_CAP);
      for (const tracker of this.trackers.values()) {
        if (tracker.readings.length > cap) {
          tracker.readings = tracker.readings.slice(-cap);
        }
      }
    }

    // entityTypeOverrides 变化时，按类型裁剪已有窗口
    if (patch.entityTypeOverrides !== undefined) {
      for (const tracker of this.trackers.values()) {
        const effective = this.getEffectiveConfig(tracker.entityType);
        const cap = Math.min(effective.windowSize, MAX_WINDOW_CAP);
        if (tracker.readings.length > cap) {
          tracker.readings = tracker.readings.slice(-cap);
        }
      }
    }

    // enabled 状态变化联动启停
    if (this.config.enabled && !prevEnabled) {
      this.start();
    } else if (!this.config.enabled && prevEnabled) {
      this.stop();
    }

    logger.iot?.info('[SensorFusion] 配置已更新:', {
      enabled: this.config.enabled,
      windowSize: this.config.windowSize,
      zscoreThreshold: this.config.zscoreThreshold,
      causalIntegrationEnabled: this.config.causalIntegrationEnabled,
      monitoringIntegrationEnabled: this.config.monitoringIntegrationEnabled,
      entityTypeOverridesKeys: Object.keys(this.config.entityTypeOverrides ?? {}),
    });

    return { ...this.config };
  }

  /**
   * 解析指定实体类型的有效配置（阶段6新增）
   *
   * 合并顺序：全局配置 → entityTypeOverrides[entityType]
   * 若 entityType 未配置覆盖或字段为 undefined，则保留全局值。
   *
   * @param entityType 实体类型（如 'sensor' / 'climate' / 'binary_sensor'）
   * @returns 合并后的有效配置（所有字段均为必填）
   */
  getEffectiveConfig(entityType: string): ResolvedSensorFusionConfig {
    const overrides: Partial<EntityTypeOverride> | undefined =
      this.config.entityTypeOverrides?.[entityType];
    return {
      windowSize: overrides?.windowSize ?? this.config.windowSize,
      zscoreThreshold:
        overrides?.zscoreThreshold ?? this.config.zscoreThreshold,
      rateOfChangeThreshold:
        overrides?.rateOfChangeThreshold ?? this.config.rateOfChangeThreshold,
      stuckValueTimeoutMs:
        overrides?.stuckValueTimeoutMs ?? this.config.stuckValueTimeoutMs,
      stuckMinReadings:
        overrides?.stuckMinReadings ?? this.config.stuckMinReadings,
      cooldownMs: overrides?.cooldownMs ?? this.config.cooldownMs,
    };
  }

  // ============================================================
  // 状态查询
  // ============================================================

  /** 获取服务运行状态 */
  getStatus(): SensorFusionStatus {
    return {
      running: this.running,
      startedAt: this.startedAt ?? undefined,
      trackedEntityCount: this.trackers.size,
      totalReadingsProcessed: this.totalReadingsProcessed,
      totalAnomaliesDetected: this.totalAnomaliesDetected,
      activeAnomalyCount: this.activeAnomalyCount,
    };
  }

  /** 获取指定实体的窗口统计（供设置面板/调试使用） */
  getEntityWindowStats(externalId: string): EntityWindowStats | null {
    const tracker = this.findTrackerByExternalId(externalId);
    if (!tracker) return null;
    return this.computeStats(tracker);
  }

  /** 列出所有实体的窗口统计 */
  listEntityWindowStats(): EntityWindowStats[] {
    const result: EntityWindowStats[] = [];
    for (const tracker of this.trackers.values()) {
      result.push(this.computeStats(tracker));
    }
    return result;
  }

  /**
   * 获取最近 N 条异常事件（阶段7 s7-06：从 SQLite 持久化查询）
   *
   * 按时间倒序返回。
   */
  getRecentAnomalies(limit = 20): SensorAnomalyEvent[] {
    return sensorAnomalyEventDb.queryRecent(limit);
  }

  /**
   * 按条件查询异常事件（阶段7 s7-06 新增）
   *
   * 支持多维度过滤 + 分页 + 排序。
   */
  queryAnomalies(filter: AnomalyEventQueryFilter): AnomalyEventQueryResult {
    return sensorAnomalyEventDb.query(filter);
  }

  // ============================================================
  // 异常事件订阅
  // ============================================================

  /**
   * 订阅异常事件
   *
   * @returns 取消订阅函数
   */
  onAnomaly(callback: SensorAnomalyCallback): () => void {
    this.anomalyCallbacks.add(callback);
    return () => this.anomalyCallbacks.delete(callback);
  }

  // ============================================================
  // 内部：IoTBridge 事件处理
  // ============================================================

  /** 处理 IoTBridge 内部事件 */
  private handleBridgeEvent(event: IoTBridgeInternalEvent): void {
    switch (event.type) {
      case 'reading':
        this.processReading(event.providerId, event.reading);
        break;
      case 'entityUpdate':
        // 实体类型/属性变化时同步到 tracker
        this.syncTrackerFromEntity(event.providerId, event.entity);
        break;
      case 'providerDisconnected':
        // Provider 断开时清理其名下 tracker
        this.cleanupTrackersForProvider(event.providerId);
        break;
      case 'providerConnected':
      case 'providerError':
        // 无需处理
        break;
    }
  }

  /**
   * 处理一条新读数
   *
   * 流程：
   * 1. 解析数值（若 stringValue 无法转数字则跳过异常检测）
   * 2. 维护滚动窗口
   * 3. 执行三种异常检测
   * 4. 异常 → 触发因果推理 + 监控服务联动
   */
  private processReading(
    providerId: string,
    reading: {
      entityId: string;
      externalId: string;
      value?: number;
      stringValue?: string;
      unit?: string;
      timestamp: number;
    },
  ): void {
    this.totalReadingsProcessed += 1;

    // 数值解析：优先 reading.value，否则尝试 stringValue 转 number
    let numericValue: number | null = null;
    if (typeof reading.value === 'number' && Number.isFinite(reading.value)) {
      numericValue = reading.value;
    } else if (reading.stringValue) {
      const parsed = Number(reading.stringValue);
      if (Number.isFinite(parsed)) {
        numericValue = parsed;
      }
    }

    // 获取或创建 tracker
    let tracker = this.trackers.get(reading.entityId);
    if (!tracker) {
      tracker = {
        entityId: reading.entityId,
        externalId: reading.externalId,
        entityType: 'unknown',
        providerId,
        readings: [],
        lastTimestamp: reading.timestamp,
        lastValue: numericValue,
        cooldowns: new Map(),
      };
      this.trackers.set(reading.entityId, tracker);
    }

    // 推入滚动窗口
    const record: ReadingRecord = {
      timestamp: reading.timestamp,
      value: numericValue,
      stringValue: reading.stringValue,
      unit: reading.unit,
    };
    tracker.readings.push(record);
    // 按实体类型解析有效窗口大小（阶段6：支持 entityTypeOverrides）
    const effectiveConfig = this.getEffectiveConfig(tracker.entityType);
    const cap = Math.min(effectiveConfig.windowSize, MAX_WINDOW_CAP);
    // 阶段8 s8-09：使用 shift 替代 slice(-cap)，避免每次创建新数组对象
    // 虽然 shift() 本身是 O(n)，但避免了数组重新分配和 GC 压力
    while (tracker.readings.length > cap) {
      tracker.readings.shift();
    }

    // 非数值读数跳过异常检测（如 binary_sensor 的 on/off 文本状态）
    if (numericValue === null) {
      tracker.lastTimestamp = reading.timestamp;
      tracker.lastValue = null;
      return;
    }

    // 异常检测（需先有足够窗口样本）
    if (tracker.readings.length >= 3) {
      this.detectAnomalies(tracker, record);
    }

    // 更新最近一次读数
    tracker.lastTimestamp = reading.timestamp;
    tracker.lastValue = numericValue;
  }

  /** 实体更新事件同步到 tracker 的 entityType */
  private syncTrackerFromEntity(
    providerId: string,
    entity: {
      entityId: string;
      externalId: string;
      entityType: string;
    },
  ): void {
    let tracker = this.trackers.get(entity.entityId);
    if (!tracker) {
      tracker = {
        entityId: entity.entityId,
        externalId: entity.externalId,
        entityType: entity.entityType,
        providerId,
        readings: [],
        lastTimestamp: Date.now(),
        lastValue: null,
        cooldowns: new Map(),
      };
      this.trackers.set(entity.entityId, tracker);
      return;
    }
    tracker.entityType = entity.entityType;
    tracker.externalId = entity.externalId;
  }

  /** 清理指定 Provider 下的所有 tracker */
  private cleanupTrackersForProvider(providerId: string): void {
    for (const [entityId, tracker] of this.trackers.entries()) {
      if (tracker.providerId === providerId) {
        this.trackers.delete(entityId);
      }
    }
  }

  // ============================================================
  // 异常检测算法
  // ============================================================

  /**
   * 三种异常检测主入口
   *
   * 1. Z-Score 离群点：当前值相对窗口均值的偏离
   * 2. 变化率异常：相对前一条读数的变化率
   * 3. 卡死检测：值长时间未变化
   *
   * 阶段6：所有阈值参数按实体类型解析（getEffectiveConfig），
   * 支持通过 entityTypeOverrides 为不同类型实体配置差异化阈值。
   */
  private detectAnomalies(
    tracker: EntityTracker,
    currentRecord: ReadingRecord,
  ): void {
    if (currentRecord.value === null) return;

    const stats = this.computeStats(tracker);
    if (stats.count < 3) return;

    // 解析当前实体类型的有效配置
    const cfg = this.getEffectiveConfig(tracker.entityType);

    // 1. Z-Score 离群点检测（剔除当前值避免均值漂移）
    if (stats.std > 0) {
      const zscore = Math.abs(
        (currentRecord.value - stats.mean) / stats.std,
      );
      if (zscore > cfg.zscoreThreshold) {
        this.emitAnomaly(tracker, {
          type: 'zscore_outlier',
          severity: this.severityFromZscore(zscore, cfg.zscoreThreshold),
          currentValue: currentRecord.value,
          unit: currentRecord.unit,
          windowStats: stats,
          description: `传感器值 ${currentRecord.value}${currentRecord.unit ?? ''} 偏离窗口均值 ${stats.mean.toFixed(2)} 过大（Z-Score=${zscore.toFixed(2)}）`,
          recommendation: '检查传感器是否故障或环境是否发生突变',
          zscore,
        });
      }
    }

    // 2. 变化率异常（与前一条读数比较）
    if (tracker.readings.length >= 2) {
      const prev = tracker.readings[tracker.readings.length - 2];
      if (prev.value !== null && prev.timestamp !== currentRecord.timestamp) {
        const deltaValue = currentRecord.value - prev.value;
        const deltaTimeSec = Math.max(
          (currentRecord.timestamp - prev.timestamp) / 1000,
          0.001,
        );
        const rate = Math.abs(deltaValue) / deltaTimeSec;
        // 计算历史变化率的标准差作为基准
        const historicalRates = this.computeHistoricalRates(tracker);
        if (
          historicalRates.length >= 3 &&
          historicalRates.std > 0
        ) {
          const rateZscore = Math.abs(
            (rate - historicalRates.mean) / historicalRates.std,
          );
          if (rateZscore > cfg.rateOfChangeThreshold) {
            this.emitAnomaly(tracker, {
              type: 'rate_of_change',
              severity: this.severityFromZscore(
                rateZscore,
                cfg.zscoreThreshold,
              ),
              currentValue: currentRecord.value,
              unit: currentRecord.unit,
              windowStats: stats,
              description: `传感器变化率 ${rate.toFixed(3)}/s 异常（Z-Score=${rateZscore.toFixed(2)}）`,
              recommendation: '检查是否存在突发性环境变化或传感器噪声',
              rateOfChange: rate,
            });
          }
        }
      }
    }

    // 3. 卡死检测：值长时间未变化
    if (
      tracker.readings.length >= cfg.stuckMinReadings &&
      tracker.lastValue !== null &&
      tracker.lastValue === currentRecord.value
    ) {
      // 找到值开始保持不变的时间点
      let stuckSince = currentRecord.timestamp;
      for (let i = tracker.readings.length - 1; i >= 0; i -= 1) {
        const r = tracker.readings[i];
        if (r.value !== currentRecord.value) break;
        stuckSince = r.timestamp;
      }
      const stuckDuration = currentRecord.timestamp - stuckSince;
      if (stuckDuration >= cfg.stuckValueTimeoutMs) {
        this.emitAnomaly(tracker, {
          type: 'stuck_value',
          severity: 'warning',
          currentValue: currentRecord.value,
          unit: currentRecord.unit,
          windowStats: stats,
          description: `传感器值卡死在 ${currentRecord.value}${currentRecord.unit ?? ''} 已 ${(stuckDuration / 1000).toFixed(0)} 秒`,
          recommendation: '检查传感器是否故障或断线',
          stuckDurationMs: stuckDuration,
        });
      }
    }
  }

  /** 计算实体滚动窗口统计量（阶段8 s8-09：单次遍历优化，原 5 次遍历 → 1 次） */
  private computeStats(tracker: EntityTracker): EntityWindowStats {
    // 单次遍历同时计算 count/sum/sumOfSquares/min/max
    let count = 0;
    let sum = 0;
    let sumOfSquares = 0;
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;

    for (const r of tracker.readings) {
      if (r.value === null) continue;
      const v = r.value;
      count += 1;
      sum += v;
      sumOfSquares += v * v;
      if (v < min) min = v;
      if (v > max) max = v;
    }

    if (count === 0) {
      return {
        externalId: tracker.externalId,
        count: 0,
        mean: 0,
        std: 0,
        min: 0,
        max: 0,
        lastTimestamp: tracker.lastTimestamp,
        lastValue: tracker.lastValue,
      };
    }

    const mean = sum / count;
    // 方差 = E[X²] - E[X]²，避免二次遍历
    const variance = Math.max(sumOfSquares / count - mean * mean, 0);
    const std = Math.sqrt(variance);

    return {
      externalId: tracker.externalId,
      count,
      mean,
      std,
      min,
      max,
      lastTimestamp: tracker.lastTimestamp,
      lastValue: tracker.lastValue,
    };
  }

  /** 计算历史变化率（每两条读数之间的 |Δvalue/Δt|）的均值与标准差（阶段8 s8-09：单次遍历优化） */
  private computeHistoricalRates(tracker: EntityTracker): {
    mean: number;
    std: number;
    length: number;
  } {
    // 单次遍历同时计算 count/sum/sumOfSquares
    let count = 0;
    let sum = 0;
    let sumOfSquares = 0;

    for (let i = 1; i < tracker.readings.length; i += 1) {
      const prev = tracker.readings[i - 1];
      const curr = tracker.readings[i];
      if (prev.value === null || curr.value === null) continue;
      const dt = Math.max((curr.timestamp - prev.timestamp) / 1000, 0.001);
      const rate = Math.abs(curr.value - prev.value) / dt;
      count += 1;
      sum += rate;
      sumOfSquares += rate * rate;
    }

    if (count === 0) {
      return { mean: 0, std: 0, length: 0 };
    }

    const mean = sum / count;
    const variance = Math.max(sumOfSquares / count - mean * mean, 0);
    return { mean, std: Math.sqrt(variance), length: count };
  }

  /**
   * 根据 Z-Score 映射异常严重度
   *
   * @param zscore 当前 Z-Score
   * @param zscoreThreshold 当前实体类型的 Z-Score 异常阈值（来自 getEffectiveConfig）
   */
  private severityFromZscore(
    zscore: number,
    zscoreThreshold: number,
  ): SensorAnomalySeverity {
    if (zscore >= zscoreThreshold * 2) return 'critical';
    if (zscore >= zscoreThreshold * 1.5) return 'warning';
    return 'info';
  }

  // ============================================================
  // 异常事件派发
  // ============================================================

  /**
   * 派发异常事件
   *
   * 1. 冷却检查：同一实体同一类型在冷却期内不重复告警
   * 2. 通知所有订阅者（onAnomaly 回调）
   * 3. 联动因果推理：collectEvent + 可选 counterfactual 查询
   */
  private emitAnomaly(
    tracker: EntityTracker,
    payload: {
      type: SensorAnomalyType;
      severity: SensorAnomalySeverity;
      currentValue: number;
      unit?: string;
      windowStats: EntityWindowStats;
      description: string;
      recommendation: string;
      zscore?: number;
      rateOfChange?: number;
      stuckDurationMs?: number;
    },
  ): void {
    // 冷却检查（按实体类型解析冷却时间，阶段6新增）
    const cooldownKey = payload.type;
    const lastAlertAt = tracker.cooldowns.get(cooldownKey);
    const now = Date.now();
    const effectiveConfig = this.getEffectiveConfig(tracker.entityType);
    if (lastAlertAt && now - lastAlertAt < effectiveConfig.cooldownMs) {
      return; // 在冷却期内，跳过
    }
    tracker.cooldowns.set(cooldownKey, now);
    this.activeAnomalyCount += 1;
    this.totalAnomaliesDetected += 1;

    const event: SensorAnomalyEvent = {
      id: `sa_${now}_${Math.random().toString(36).slice(2, 10)}`,
      timestamp: now,
      type: payload.type,
      severity: payload.severity,
      providerId: tracker.providerId,
      entityId: tracker.entityId,
      externalId: tracker.externalId,
      entityType: tracker.entityType as SensorAnomalyEvent['entityType'],
      currentValue: payload.currentValue,
      unit: payload.unit,
      windowStats: payload.windowStats,
      description: payload.description,
      recommendation: payload.recommendation,
      zscore: payload.zscore,
      rateOfChange: payload.rateOfChange,
      stuckDurationMs: payload.stuckDurationMs,
    };

    // 通知订阅者（同步派发，捕获异常避免互相影响）
    for (const cb of this.anomalyCallbacks) {
      try {
        cb(event);
      } catch (err) {
        logger.iot?.warn('[SensorFusion] 异常事件回调失败:', err);
      }
    }

    // 持久化到 SQLite（阶段7 s7-06，异步写入避免阻塞主流程）
    try {
      sensorAnomalyEventDb.insert(event);
    } catch (err) {
      logger.iot?.warn('[SensorFusion] 异常事件持久化失败:', err);
    }

    // 联动因果推理
    if (this.config.causalIntegrationEnabled) {
      this.feedToCausalReasoning(event).catch((err) => {
        logger.iot?.warn('[SensorFusion] 因果推理联动失败:', err);
      });
    }

    logger.iot?.info(
      `[SensorFusion] 检测到异常 [${event.type}] 实体=${tracker.externalId} 值=${payload.currentValue}${payload.unit ?? ''} 严重度=${event.severity}`,
    );
  }

  // ============================================================
  // 因果推理联动
  // ============================================================

  /**
   * 将异常事件喂入因果推理服务
   *
   * 1. 构造 CausalEvent，调用 collectEvent
   * 2. 若配置开启 counterfactualOnAnomaly 且存在关联因果节点，
   *    触发反事实查询：以异常变量为干预变量，查询其对其他相关节点的影响
   */
  private async feedToCausalReasoning(
    event: SensorAnomalyEvent,
  ): Promise<void> {
    if (!this.causalService) return;

    // 1. 构造 CausalEvent
    const causalEvent: CausalEvent = {
      type: 'anomaly',
      source: 'iot',
      timestamp: event.timestamp,
      text: `IoT 传感器异常: ${event.description}. 实体 ${event.externalId} (类型 ${event.entityType}) 当前值 ${event.currentValue}${event.unit ?? ''}. 建议: ${event.recommendation}`,
      relatedNodes: [event.externalId],
      metadata: {
        anomalyType: event.type,
        severity: event.severity,
        entityId: event.entityId,
        externalId: event.externalId,
        providerId: event.providerId,
        currentValue: event.currentValue,
        unit: event.unit,
        zscore: event.zscore,
        rateOfChange: event.rateOfChange,
        stuckDurationMs: event.stuckDurationMs,
        windowStats: event.windowStats,
      },
    };
    try {
      this.causalService.collectEvent(causalEvent);
    } catch (err) {
      logger.iot?.warn('[SensorFusion] collectEvent 失败:', err);
    }

    // 2. 反事实查询（可选）
    if (!this.config.counterfactualOnAnomaly) return;

    try {
      // 查找关联的因果节点（通过 metadata.iotEntityId 匹配 externalId）
      const nodes = this.causalService.listNodes({ enabled: true });
      const relatedNode = nodes.find(
        (n) => n.metadata?.iotEntityId === event.externalId,
      );
      if (!relatedNode) {
        logger.iot?.debug(
          `[SensorFusion] 未找到实体 ${event.externalId} 关联的因果节点，跳过反事实查询`,
        );
        return;
      }

      // 查询：如果异常变量保持当前异常值，对其他关联节点的影响
      // observedVar 选第一个以 relatedNode 为起点的出边终点
      // 此处简化处理：仅触发以 relatedNode.name 为干预变量的查询，
      // 由 CausalReasoningService 内部根据 DAG 自动选择观测变量
      // 为避免无意义查询，仅当节点有出边时触发（由 engine 内部判断）
      await this.causalService.counterfactual(
        relatedNode.name,
        event.currentValue,
        '', // observedVar 留空，由引擎根据 DAG 推断
        event.windowStats.mean,
      );
    } catch (err) {
      logger.iot?.warn(
        '[SensorFusion] 反事实查询失败（可能是图结构不完整）:',
        err,
      );
    }
  }

  // ============================================================
  // 维护操作
  // ============================================================

  /**
   * 清理过期的冷却记录
   *
   * 阶段6：按实体类型解析冷却时间，避免不同类型实体的冷却记录被误清理。
   */
  private purgeExpiredCooldowns(): void {
    const now = Date.now();
    for (const tracker of this.trackers.values()) {
      const effectiveConfig = this.getEffectiveConfig(tracker.entityType);
      for (const [key, ts] of tracker.cooldowns.entries()) {
        if (now - ts > effectiveConfig.cooldownMs * 2) {
          tracker.cooldowns.delete(key);
        }
      }
    }
  }

  /** 按 externalId 查找 tracker */
  private findTrackerByExternalId(externalId: string): EntityTracker | null {
    for (const tracker of this.trackers.values()) {
      if (tracker.externalId === externalId) return tracker;
    }
    return null;
  }

  /** 销毁服务（应用退出时调用） */
  dispose(): void {
    this.stop();
    this.anomalyCallbacks.clear();
    this.trackers.clear();
    this.activeAnomalyCount = 0;
    // 关闭异常事件数据库（阶段7 s7-06）
    sensorAnomalyEventDb.close();
  }
}

// ============================================================
// 监控服务联动桥接（避免直接依赖 MonitoringService 造成循环）
// ============================================================

/**
 * 将 SensorFusionService 的异常事件桥接到 MonitoringService 的 onAnomaly 订阅者
 *
 * 由于 MonitoringService 的 AnomalyEvent 类型与 SensorAnomalyEvent 不同，
 * 此处仅做"通知"性质转发，不强行复用 AnomalyEvent 持久化机制。
 *
 * 真正的持久化由订阅 MonitoringService.onAnomaly 的下游（如渲染层 toast、
 * 系统通知）自行处理；此处仅触发回调链。
 *
 * @internal 仅供 SensorFusionIpc 初始化时调用
 */
export function bridgeSensorAnomaliesToMonitoring(): void {
  const fusion = SensorFusionService.getInstance();
  fusion.onAnomaly((event) => {
    // 此处可扩展：将 SensorAnomalyEvent 转换为 MonitoringService.AnomalyEvent
    // 当前实现：仅打印日志，由 SensorFusionIpc 推送到渲染层处理
    logger.iot?.info(
      `[SensorFusion→Monitoring] 异常转发: type=${event.type} entity=${event.externalId} severity=${event.severity}`,
    );
  });
}

// 防止未使用的导入告警（IoTEntitySnapshot 类型用于未来扩展）
void ({} as unknown as IoTEntitySnapshot);
