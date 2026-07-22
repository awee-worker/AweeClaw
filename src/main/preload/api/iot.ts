/**
 * IoT API — IoT Bridge IPC 桥接
 *
 * 将主进程的 IoTBridge 能力暴露给渲染进程。
 * 渲染进程通过 window.electronAPI.iot.* 调用。
 *
 * 注意：此 API 仅负责 Bridge 本地连接管理（与本地 MQTT/HA 代理通信）。
 * 后端数据库 CRUD（Provider/Device/Entity/Reading）通过 backendApi 直接访问
 * /api/v1/iot/* 接口，不走 IPC。
 *
 * 提供能力：
 * - Bridge 生命周期：start / stop / isRunning / getStatus
 * - Provider 连接管理：connectProvider / disconnectProvider / testProviderConnection
 * - 实体查询：listEntitySnapshots / listEntitySnapshotsByProvider
 * - 适配器查询：hasAdapter
 * - 渲染层回调注入：setRendererCallbacks（启动时由 BridgeController 调用）
 * - 事件订阅：onBridgeEvent
 */

import { ipcRenderer, type IpcRendererEvent } from 'electron';

/** 统一的 IPC 响应格式 */
export interface IpcResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// ============================================================
// 类型定义（与 IoTInterface 保持一致）
// ============================================================

export type IoTProtocol = 'homeassistant' | 'mqtt' | 'ble' | 'custom';

export type ProviderConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error'
  | 'disabled';

export type IoTEntityType =
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

export type ReadingSource = 'bridge' | 'manual' | 'rule' | 'system';

/** Provider 摘要（含解密后的 authConfig） */
export interface IoTProviderSummary {
  id: string;
  name: string;
  protocol: IoTProtocol;
  endpoint: string;
  authConfig: Record<string, unknown> | null;
  pollIntervalSec: number;
  enabled: boolean;
  metadata?: Record<string, unknown>;
}

/** 实体状态快照 */
export interface IoTEntitySnapshot {
  id: string;
  deviceId: string;
  externalId: string;
  entityType: IoTEntityType;
  deviceClass?: string | null;
  unitOfMeasurement?: string | null;
  state: string | number | boolean | null;
  attributes: Record<string, unknown>;
  lastStateChangedAt: number;
}

/** 单个 Provider 的连接状态 */
export interface ProviderStatus {
  providerId: string;
  providerName: string;
  protocol: IoTProtocol;
  state: ProviderConnectionState;
  entityCount: number;
  lastError?: string;
  lastConnectedAt?: number;
  lastDataAt?: number;
  receivedReadings: number;
  /** 数据流停滞检测阈值（毫秒，阶段8 s8-10） */
  staleThresholdMs?: number;
}

/** Bridge 整体运行状态 */
export interface BridgeStatus {
  running: boolean;
  startedAt?: number;
  providers: ProviderStatus[];
  totalEntities: number;
  totalReadings: number;
}

/** 实体状态变更事件 */
export interface EntityUpdateEvent {
  providerId: string;
  entityId: string;
  externalId: string;
  entityType: IoTEntityType;
  state: string | number | boolean | null;
  attributes: Record<string, unknown>;
  timestamp: number;
}

/** Bridge 事件类型 */
export type BridgeEventType =
  | 'provider:connected'
  | 'provider:disconnected'
  | 'provider:error'
  | 'entity:update'
  | 'reading:received';

/** Bridge 事件 */
export interface BridgeEvent {
  type: BridgeEventType;
  providerId?: string;
  entity?: EntityUpdateEvent;
  error?: string;
  timestamp: number;
}

/** 渲染层注入：获取 Provider 配置（含解密 authConfig） */
export type FetchProviderConfigFn = (
  providerId: string,
) => Promise<IpcResponse<IoTProviderSummary>>;

/** 渲染层注入：批量上报读数到后端 */
export type ReportReadingsFn = (
  readings: Array<{
    entityExternalId: string;
    value?: number;
    stringValue?: string;
    unit?: string;
    source?: ReadingSource;
    recordedAt: number;
  }>,
) => Promise<IpcResponse>;

// ============================================================
// 性能指标（阶段8 s8-08）
// ============================================================

/** 时间窗口类型 */
export type MetricsWindow = '1m' | '5m' | '1h';

/** 单个 Provider 的性能指标快照 */
export interface ProviderMetrics {
  providerId: string;
  providerName: string;
  protocol: IoTProtocol;
  state: ProviderConnectionState;
  totalReadings: number;
  totalErrors: number;
  totalStateChanges: number;
  lastReadingAt: number | null;
  lastErrorAt: number | null;
  lastConnectedAt: number | null;
  windowReadings: number;
  windowErrors: number;
  readingsPerMinute: number;
  errorRate: number;
  uptimeSeconds: number;
  secondsSinceLastReading: number | null;
}

/** 协议层聚合指标 */
export interface ProtocolMetrics {
  protocol: IoTProtocol;
  providerCount: number;
  connectedCount: number;
  errorCount: number;
  totalReadings: number;
  totalErrors: number;
}

/** Bridge 整体性能指标快照 */
export interface BridgeMetrics {
  collectedAt: number;
  startedAt: number | null;
  uptimeSeconds: number;
  totalReadings: number;
  totalErrors: number;
  totalStateChanges: number;
  windowReadings: number;
  windowErrors: number;
  globalReadingsPerMinute: number;
  globalErrorRate: number;
  connectedProviders: number;
  totalProviders: number;
  totalEntities: number;
  providers: ProviderMetrics[];
  protocols: ProtocolMetrics[];
}

/** 历史趋势采样点（阶段9 s9-08，每分钟一个采样点） */
export interface MetricsHistorySample {
  timestamp: number;
  globalReadingsPerMinute: number;
  globalErrorRate: number;
  connectedProviders: number;
  totalProviders: number;
  totalEntities: number;
  uptimeSeconds: number;
  windowReadings: number;
  windowErrors: number;
}

// ============================================================
// API 接口
// ============================================================

/** IoT Bridge API 接口 */
export interface IoTBridgeApi {
  // ===== Bridge 生命周期 =====
  /** 启动 Bridge */
  start: () => Promise<IpcResponse<boolean>>;
  /** 停止 Bridge */
  stop: () => Promise<IpcResponse<void>>;
  /** Bridge 是否运行中 */
  isRunning: () => Promise<IpcResponse<boolean>>;
  /** 获取 Bridge 整体状态 */
  getStatus: () => Promise<IpcResponse<BridgeStatus>>;

  // ===== Provider 连接管理 =====
  /** 连接指定 Provider */
  connectProvider: (providerId: string) => Promise<IpcResponse<void>>;
  /** 断开指定 Provider */
  disconnectProvider: (providerId: string) => Promise<IpcResponse<void>>;
  /** 测试 Provider 连接（不维持长连接） */
  testProviderConnection: (
    providerId: string,
  ) => Promise<
    IpcResponse<{ success: boolean; latencyMs?: number; message: string }>
  >;
  /**
   * 向指定 Provider 的 broker 发布消息（阶段9 s9-10，仅 MQTT 协议支持）
   *
   * 用于向设备发送控制命令，例如：
   * - 开关设备：publishMessage(providerId, 'home/switch/01/cmd', 'ON')
   * - 设置亮度：publishMessage(providerId, 'home/light/01/brightness', '128')
   *
   * @param providerId Provider ID
   * @param topic 目标主题
   * @param payload 消息内容（字符串）
   * @param options 发布选项（QoS、retain）
   */
  publishMessage: (
    providerId: string,
    topic: string,
    payload: string,
    options?: { qos?: 0 | 1 | 2; retain?: boolean },
  ) => Promise<IpcResponse<{ success: boolean; message: string }>>;

  // ===== 实体查询 =====
  /** 获取所有实体快照 */
  listEntitySnapshots: () => Promise<IpcResponse<IoTEntitySnapshot[]>>;
  /** 获取指定 Provider 下的实体快照 */
  listEntitySnapshotsByProvider: (
    providerId: string,
  ) => Promise<IpcResponse<IoTEntitySnapshot[]>>;

  // ===== 适配器查询 =====
  /** 查询协议适配器是否已注册 */
  hasAdapter: (protocol: IoTProtocol) => Promise<IpcResponse<boolean>>;

  // ===== 渲染层回调注入 =====
  /**
   * 注入渲染层回调（Bridge 启动前调用）
   *
   * Bridge 通过这些回调：
   * - 获取 Provider 配置（含解密后的 authConfig）
   * - 批量上报读数到后端 /api/v1/iot/readings/batch
   */
  setRendererCallbacks: (callbacks: {
    fetchProviderConfig: FetchProviderConfigFn;
    reportReadings: ReportReadingsFn;
  }) => Promise<IpcResponse<boolean>>;

  // ===== 性能指标（阶段8 s8-08 + 阶段9 s9-08） =====
  /** 获取 Bridge 性能指标快照 */
  getMetrics: () => Promise<IpcResponse<BridgeMetrics>>;
  /** 设置指标统计时间窗口 */
  setMetricsWindow: (
    window: MetricsWindow,
  ) => Promise<IpcResponse<MetricsWindow>>;
  /** 获取历史趋势采样数据（默认 24h，每分钟一个采样点） */
  getMetricsHistory: (
    durationMs?: number,
  ) => Promise<IpcResponse<MetricsHistorySample[]>>;

  // ===== 事件订阅 =====
  /** 监听主进程推送的 Bridge 事件 */
  onBridgeEvent: (callback: (event: BridgeEvent) => void) => () => void;
}

// ============================================================
// API 实现
// ============================================================

/** 创建 IoT Bridge API */
export function createIoTBridgeApi(): IoTBridgeApi {
  return {
    // ===== Bridge 生命周期 =====
    start: () => ipcRenderer.invoke('iot:start'),
    stop: () => ipcRenderer.invoke('iot:stop'),
    isRunning: () => ipcRenderer.invoke('iot:isRunning'),
    getStatus: () => ipcRenderer.invoke('iot:getStatus'),

    // ===== Provider 连接管理 =====
    connectProvider: (providerId) =>
      ipcRenderer.invoke('iot:connectProvider', providerId),
    disconnectProvider: (providerId) =>
      ipcRenderer.invoke('iot:disconnectProvider', providerId),
    testProviderConnection: (providerId) =>
      ipcRenderer.invoke('iot:testProviderConnection', providerId),
    publishMessage: (providerId, topic, payload, options) =>
      ipcRenderer.invoke(
        'iot:publishMessage',
        providerId,
        topic,
        payload,
        options,
      ),

    // ===== 实体查询 =====
    listEntitySnapshots: () =>
      ipcRenderer.invoke('iot:listEntitySnapshots'),
    listEntitySnapshotsByProvider: (providerId) =>
      ipcRenderer.invoke(
        'iot:listEntitySnapshotsByProvider',
        providerId,
      ),

    // ===== 适配器查询 =====
    hasAdapter: (protocol) => ipcRenderer.invoke('iot:hasAdapter', protocol),

    // ===== 渲染层回调注入 =====
    setRendererCallbacks: (callbacks) =>
      ipcRenderer.invoke('iot:setRendererCallbacks', callbacks),

    // ===== 性能指标 =====
    getMetrics: () => ipcRenderer.invoke('iot:getMetrics'),
    setMetricsWindow: (window) =>
      ipcRenderer.invoke('iot:setMetricsWindow', window),
    getMetricsHistory: (durationMs) =>
      ipcRenderer.invoke('iot:getMetricsHistory', durationMs),

    // ===== 事件订阅 =====
    onBridgeEvent: (callback) => {
      const handler = (
        _event: IpcRendererEvent,
        evt: BridgeEvent,
      ) => {
        callback(evt);
      };
      ipcRenderer.on('iot:bridge:event', handler);
      return () => {
        ipcRenderer.removeListener('iot:bridge:event', handler);
      };
    },
  };
}
