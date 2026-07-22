/**
 * 传感器数据融合接口定义
 *
 * 定义 SensorFusionService（主进程）的配置、事件、异常等类型规范。
 *
 * 融合策略：
 * - 滚动窗口统计：维护每个实体最近 N 条读数，计算均值/标准差
 * - 三种异常检测：
 *   1) Z-Score 异常：|value - mean| / std > zscoreThreshold
 *   2) 变化率异常：|Δvalue / Δt| 相对均值的偏离超过 rateOfChangeThreshold
 *   3) 卡死异常：值在 stuckValueTimeoutMs 内未变化（可能传感器故障）
 * - 与因果推理联动：异常触发时，若存在 metadata.iotEntityId 关联的因果节点，
 *   生成 CausalEvent 喂入 CausalReasoningService，并可选触发反事实查询
 * - 与监控服务联动：将传感器异常映射为 AnomalyEvent 推送给 MonitoringService
 *
 * @module iot/SensorFusionInterface
 */

import type { IoTEntityType } from './IoTInterface';

// ============================================================
// 配置
// ============================================================

/** 传感器融合用户配置 */
export interface SensorFusionConfig {
  /** 是否启用融合服务 */
  enabled: boolean;
  /** 每个实体的滚动窗口大小（默认 50） */
  windowSize: number;
  /** Z-Score 异常阈值（默认 3.0，越敏感则越小） */
  zscoreThreshold: number;
  /** 变化率异常阈值（默认 3.0，单位：相对历史均值的标准差倍数） */
  rateOfChangeThreshold: number;
  /** 卡死检测超时（毫秒，默认 5 分钟） */
  stuckValueTimeoutMs: number;
  /** 卡死检测的最小读数个数（少于则不触发卡死，默认 5） */
  stuckMinReadings: number;
  /** 是否将异常事件喂入因果推理（collectEvent） */
  causalIntegrationEnabled: boolean;
  /** 是否在异常时触发反事实查询（要求 causalIntegrationEnabled=true） */
  counterfactualOnAnomaly: boolean;
  /** 是否将传感器异常推送到监控服务（onAnomaly 回调） */
  monitoringIntegrationEnabled: boolean;
  /** 冷却时间（毫秒，同一实体同一异常类型的两次告警最小间隔，默认 60 秒） */
  cooldownMs: number;
  /** 数据保留期（天，默认 7） */
  retentionDays: number;
  /**
   * 按实体类型差异化配置（阶段6新增）
   *
   * 键为 IoTEntityType（如 'sensor' / 'binary_sensor' / 'climate'），
   * 值为该类型实体的参数覆盖。
   *
   * 示例：
   * ```json
   * {
   *   "climate": { "zscoreThreshold": 2.5, "stuckValueTimeoutMs": 600000 },
   *   "binary_sensor": { "zscoreThreshold": 4.0, "stuckMinReadings": 3 }
   * }
   * ```
   */
  entityTypeOverrides?: Record<string, Partial<EntityTypeOverride>>;
}

/** 实体类型参数覆盖（所有字段可选，仅覆盖需要调整的参数） */
export interface EntityTypeOverride {
  /** 滚动窗口大小 */
  windowSize?: number;
  /** Z-Score 异常阈值 */
  zscoreThreshold?: number;
  /** 变化率异常阈值 */
  rateOfChangeThreshold?: number;
  /** 卡死检测超时（毫秒） */
  stuckValueTimeoutMs?: number;
  /** 卡死检测最小读数个数 */
  stuckMinReadings?: number;
  /** 冷却时间（毫秒） */
  cooldownMs?: number;
}

/** 默认配置 */
export const DEFAULT_SENSOR_FUSION_CONFIG: SensorFusionConfig = {
  enabled: false,
  windowSize: 50,
  zscoreThreshold: 3.0,
  rateOfChangeThreshold: 3.0,
  stuckValueTimeoutMs: 5 * 60 * 1000,
  stuckMinReadings: 5,
  causalIntegrationEnabled: true,
  counterfactualOnAnomaly: false,
  monitoringIntegrationEnabled: true,
  cooldownMs: 60 * 1000,
  retentionDays: 7,
  entityTypeOverrides: {},
};

// ============================================================
// 滚动窗口与统计
// ============================================================

/** 单条读数记录（用于窗口统计） */
export interface ReadingRecord {
  /** 读数时间戳（ms） */
  timestamp: number;
  /** 数值（无法解析为数字时为 null） */
  value: number | null;
  /** 原始字符串值 */
  stringValue?: string;
  /** 单位 */
  unit?: string;
}

/** 实体滚动窗口统计 */
export interface EntityWindowStats {
  /** 实体外部 ID（用于与因果节点 metadata.iotEntityId 关联） */
  externalId: string;
  /** 当前窗口内读数个数 */
  count: number;
  /** 窗口内均值 */
  mean: number;
  /** 窗口内标准差 */
  std: number;
  /** 窗口内最小值 */
  min: number;
  /** 窗口内最大值 */
  max: number;
  /** 最近一次读数时间戳 */
  lastTimestamp: number;
  /** 最近一次读数值 */
  lastValue: number | null;
}

// ============================================================
// 异常事件
// ============================================================

/** 传感器异常类型 */
export type SensorAnomalyType =
  | 'zscore_outlier' // Z-Score 离群点
  | 'rate_of_change' // 变化率异常
  | 'stuck_value' // 值卡死（疑似传感器故障）
  | 'out_of_range'; // 超出合理范围（可选，由用户配置触发）

/** 传感器异常严重度 */
export type SensorAnomalySeverity = 'info' | 'warning' | 'critical';

/** 传感器异常事件 */
export interface SensorAnomalyEvent {
  /** 事件唯一 ID（nanoid） */
  id: string;
  /** 检测时间戳（ms） */
  timestamp: number;
  /** 异常类型 */
  type: SensorAnomalyType;
  /** 严重度 */
  severity: SensorAnomalySeverity;
  /** Provider ID */
  providerId: string;
  /** 实体 ID */
  entityId: string;
  /** 实体外部 ID */
  externalId: string;
  /** 实体类型 */
  entityType: IoTEntityType;
  /** 当前读数值 */
  currentValue: number;
  /** 当前读数单位 */
  unit?: string;
  /** 滚动窗口统计（异常检测时的快照） */
  windowStats: EntityWindowStats;
  /** 异常描述（人类可读） */
  description: string;
  /** 建议操作 */
  recommendation: string;
  /** 异常检测的 Z-Score（仅 zscore_outlier 有值） */
  zscore?: number;
  /** 变化率（仅 rate_of_change 有值，单位：值/秒） */
  rateOfChange?: number;
  /** 卡死持续时长（仅 stuck_value 有值，单位：ms） */
  stuckDurationMs?: number;
}

// ============================================================
// 服务状态
// ============================================================

/** 融合服务运行状态 */
export interface SensorFusionStatus {
  /** 是否运行中 */
  running: boolean;
  /** 启动时间戳 */
  startedAt?: number;
  /** 已跟踪实体数 */
  trackedEntityCount: number;
  /** 累计处理读数数 */
  totalReadingsProcessed: number;
  /** 累计检测异常数 */
  totalAnomaliesDetected: number;
  /** 当前活跃异常数（在冷却期内） */
  activeAnomalyCount: number;
}

/** 异常事件回调 */
export type SensorAnomalyCallback = (event: SensorAnomalyEvent) => void;
