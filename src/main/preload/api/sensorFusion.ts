/**
 * SensorFusion API — 传感器数据融合 IPC 桥接
 *
 * 将主进程的 SensorFusionService 能力暴露给渲染进程。
 * 渲染进程通过 window.electronAPI.sensorFusion.* 调用。
 *
 * 提供能力：
 * - 服务生命周期：start / stop / isRunning
 * - 配置管理：getConfig / updateConfig
 * - 状态与窗口统计查询：getStatus / listEntityWindowStats / getEntityWindowStats
 * - 异常事件订阅：onAnomaly
 */

import { ipcRenderer, type IpcRendererEvent } from 'electron';

/** 统一的 IPC 响应格式（与 iot.ts 保持一致） */
export interface IpcResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// ============================================================
// 类型定义（与 SensorFusionInterface 保持一致）
// ============================================================

export type SensorAnomalyType =
  | 'zscore_outlier'
  | 'rate_of_change'
  | 'stuck_value'
  | 'out_of_range';

export type SensorAnomalySeverity = 'info' | 'warning' | 'critical';

export interface SensorFusionConfig {
  enabled: boolean;
  windowSize: number;
  zscoreThreshold: number;
  rateOfChangeThreshold: number;
  stuckValueTimeoutMs: number;
  stuckMinReadings: number;
  causalIntegrationEnabled: boolean;
  counterfactualOnAnomaly: boolean;
  monitoringIntegrationEnabled: boolean;
  cooldownMs: number;
  retentionDays: number;
  /**
   * 按实体类型差异化配置（阶段6新增）
   *
   * 键为 IoTEntityType，值为该类型实体的参数覆盖（所有字段可选）。
   */
  entityTypeOverrides?: Record<string, Partial<EntityTypeOverride>>;
}

/**
 * 实体类型参数覆盖（所有字段可选，仅覆盖需要调整的参数）
 *
 * 阶段6新增：允许为不同实体类型（如 climate、binary_sensor）配置
 * 差异化的检测阈值与窗口大小，覆盖全局默认值。
 */
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

/**
 * 解析后的有效配置（全局配置与按实体类型覆盖合并的结果）
 *
 * 所有字段均为必填，便于检测算法直接使用而无需做 undefined 判断。
 */
export interface ResolvedSensorFusionConfig {
  windowSize: number;
  zscoreThreshold: number;
  rateOfChangeThreshold: number;
  stuckValueTimeoutMs: number;
  stuckMinReadings: number;
  cooldownMs: number;
}

export interface ReadingRecord {
  timestamp: number;
  value: number | null;
  stringValue?: string;
  unit?: string;
}

export interface EntityWindowStats {
  externalId: string;
  count: number;
  mean: number;
  std: number;
  min: number;
  max: number;
  lastTimestamp: number;
  lastValue: number | null;
}

export interface SensorAnomalyEvent {
  id: string;
  timestamp: number;
  type: SensorAnomalyType;
  severity: SensorAnomalySeverity;
  providerId: string;
  entityId: string;
  externalId: string;
  entityType:
    | 'sensor'
    | 'binary_sensor'
    | 'switch'
    | 'light'
    | 'climate'
    | 'cover'
    | 'lock'
    | 'media_player'
    | 'device_tracker'
    | 'unknown';
  currentValue: number;
  unit?: string;
  windowStats: EntityWindowStats;
  description: string;
  recommendation: string;
  zscore?: number;
  rateOfChange?: number;
  stuckDurationMs?: number;
}

export interface SensorFusionStatus {
  running: boolean;
  startedAt?: number;
  trackedEntityCount: number;
  totalReadingsProcessed: number;
  totalAnomaliesDetected: number;
  activeAnomalyCount: number;
}

// ============================================================
// 异常事件历史查询（阶段7 s7-07 新增）
// ============================================================

/** 异常事件查询过滤条件 */
export interface AnomalyEventQueryFilter {
  providerId?: string;
  entityType?: string;
  severity?: string;
  type?: string;
  startTime?: number;
  endTime?: number;
  limit?: number;
  offset?: number;
  sort?: 'asc' | 'desc';
}

/** 异常事件查询结果 */
export interface AnomalyEventQueryResult {
  items: SensorAnomalyEvent[];
  total: number;
}

// ============================================================
// API 接口
// ============================================================

/** SensorFusion API 接口 */
export interface SensorFusionApi {
  // ===== 生命周期 =====
  /** 启动融合服务 */
  start: () => Promise<IpcResponse<boolean>>;
  /** 停止融合服务 */
  stop: () => Promise<IpcResponse<void>>;
  /** 是否运行中 */
  isRunning: () => Promise<IpcResponse<boolean>>;

  // ===== 配置管理 =====
  /** 获取当前配置 */
  getConfig: () => Promise<IpcResponse<SensorFusionConfig>>;
  /** 更新配置（enabled 切换会自动 start/stop） */
  updateConfig: (
    patch: Partial<SensorFusionConfig>,
  ) => Promise<IpcResponse<SensorFusionConfig>>;
  /**
   * 按实体类型查询有效配置（阶段6新增）
   *
   * 返回全局配置与 entityTypeOverrides[entityType] 合并后的结果。
   */
  getEffectiveConfig: (
    entityType: string,
  ) => Promise<IpcResponse<ResolvedSensorFusionConfig>>;

  // ===== 状态与窗口统计查询 =====
  /** 获取服务运行状态 */
  getStatus: () => Promise<IpcResponse<SensorFusionStatus>>;
  /** 列出所有实体的窗口统计 */
  listEntityWindowStats: () => Promise<IpcResponse<EntityWindowStats[]>>;
  /** 获取指定实体的窗口统计 */
  getEntityWindowStats: (
    externalId: string,
  ) => Promise<IpcResponse<EntityWindowStats | null>>;

  // ===== 事件订阅 =====
  /** 监听主进程推送的传感器异常事件 */
  onAnomaly: (
    callback: (event: SensorAnomalyEvent) => void,
  ) => () => void;

  // ===== 异常事件历史查询（阶段7 s7-07） =====
  /**
   * 按条件查询异常事件历史（支持过滤、分页、排序）
   *
   * 数据来源：本地 SQLite 持久化（iot_anomaly_events.db）
   */
  queryAnomalies: (
    filter: AnomalyEventQueryFilter,
  ) => Promise<IpcResponse<AnomalyEventQueryResult>>;
  /**
   * 获取最近 N 条异常事件（按时间倒序）
   *
   * 便捷方法，等价于 queryAnomalies({ limit: N, sort: 'desc' })
   */
  getRecentAnomalies: (
    limit: number,
  ) => Promise<IpcResponse<SensorAnomalyEvent[]>>;
}

// ============================================================
// API 实现
// ============================================================

/** 创建 SensorFusion API */
export function createSensorFusionApi(): SensorFusionApi {
  return {
    // ===== 生命周期 =====
    start: () => ipcRenderer.invoke('sensorFusion:start'),
    stop: () => ipcRenderer.invoke('sensorFusion:stop'),
    isRunning: () => ipcRenderer.invoke('sensorFusion:isRunning'),

    // ===== 配置管理 =====
    getConfig: () => ipcRenderer.invoke('sensorFusion:getConfig'),
    updateConfig: (patch) =>
      ipcRenderer.invoke('sensorFusion:updateConfig', patch),
    getEffectiveConfig: (entityType) =>
      ipcRenderer.invoke('sensorFusion:getEffectiveConfig', entityType),

    // ===== 状态与窗口统计查询 =====
    getStatus: () => ipcRenderer.invoke('sensorFusion:getStatus'),
    listEntityWindowStats: () =>
      ipcRenderer.invoke('sensorFusion:listEntityWindowStats'),
    getEntityWindowStats: (externalId) =>
      ipcRenderer.invoke(
        'sensorFusion:getEntityWindowStats',
        externalId,
      ),

    // ===== 事件订阅 =====
    onAnomaly: (callback) => {
      const handler = (
        _event: IpcRendererEvent,
        evt: SensorAnomalyEvent,
      ) => {
        callback(evt);
      };
      ipcRenderer.on('sensorFusion:anomaly', handler);
      return () => {
        ipcRenderer.removeListener('sensorFusion:anomaly', handler);
      };
    },

    // ===== 异常事件历史查询（阶段7 s7-07） =====
    queryAnomalies: (filter) =>
      ipcRenderer.invoke('sensorFusion:queryAnomalies', filter),
    getRecentAnomalies: (limit) =>
      ipcRenderer.invoke('sensorFusion:getRecentAnomalies', limit),
  };
}
