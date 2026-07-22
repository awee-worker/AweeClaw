/**
 * IoT 模块接口定义
 *
 * 定义客户端 IoT Bridge（主进程）与渲染层之间共享的类型。
 * 后端数据库模型（IoTProvider/IoTDevice/IoTEntity/SensorReading）
 * 通过 backendApi 直接访问，不在此处镜像。
 *
 * @module iot/IoTInterface
 */

// ============================================================
// 协议与状态枚举
// ============================================================

/** IoT 协议类型（与后端 PROVIDER_PROTOCOLS 一致） */
export type IoTProtocol = 'homeassistant' | 'mqtt' | 'ble' | 'custom';

/** Provider 连接状态 */
export type ProviderConnectionState =
  | 'disconnected' // 未连接
  | 'connecting' // 连接中
  | 'connected' // 已连接
  | 'error' // 连接异常
  | 'disabled'; // 已禁用

/** 实体类型（与后端 ENTITY_TYPES 一致） */
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

/** 传感器读数来源 */
export type ReadingSource = 'bridge' | 'manual' | 'rule' | 'system';

// ============================================================
// Provider 与实体镜像
// ============================================================

/**
 * Provider 摘要（仅包含 Bridge 运行所需字段，敏感字段如 authConfig 不镜像）
 *
 * Bridge 启动时通过 IPC 回调从渲染层获取，避免主进程直接持有 token。
 */
export interface IoTProviderSummary {
  id: string;
  name: string;
  protocol: IoTProtocol;
  endpoint: string;
  /** 加密的认证配置（解密由渲染层在后端完成；Bridge 仅在内存中暂存解密后的句柄） */
  authConfig: Record<string, unknown> | null;
  pollIntervalSec: number;
  enabled: boolean;
  metadata?: Record<string, unknown>;
}

/** 实体状态快照（Bridge 订阅后实时维护） */
export interface IoTEntitySnapshot {
  id: string;
  deviceId: string;
  externalId: string;
  entityType: IoTEntityType;
  deviceClass?: string | null;
  unitOfMeasurement?: string | null;
  /** 当前状态值（传感器读数 / 开关状态等） */
  state: string | number | boolean | null;
  attributes: Record<string, unknown>;
  lastStateChangedAt: number;
}

// ============================================================
// Bridge 运行状态
// ============================================================

/** 单个 Provider 的连接状态 */
export interface ProviderStatus {
  providerId: string;
  providerName: string;
  protocol: IoTProtocol;
  state: ProviderConnectionState;
  /** 已订阅的实体数量 */
  entityCount: number;
  /** 最近一次错误信息（state === 'error' 时有效） */
  lastError?: string;
  /** 最近一次连接成功时间戳 */
  lastConnectedAt?: number;
  /** 最近一次接收数据时间戳 */
  lastDataAt?: number;
  /** 累计接收读数数量 */
  receivedReadings: number;
  /**
   * 数据流停滞检测阈值（毫秒，阶段8 s8-10）
   *
   * 由 connectProvider 时从 IoTProviderSummary.metadata.staleThresholdMs 读取。
   * 未配置时使用 DEFAULT_STALE_THRESHOLD_MS（5 分钟）。
   */
  staleThresholdMs?: number;
}

/** Bridge 整体运行状态 */
export interface BridgeStatus {
  /** Bridge 是否运行中 */
  running: boolean;
  /** 启动时间戳 */
  startedAt?: number;
  /** 已连接的 Provider 列表及其状态 */
  providers: ProviderStatus[];
  /** 总实体数 */
  totalEntities: number;
  /** 总读数数（自启动以来） */
  totalReadings: number;
}

// ============================================================
// 实时事件
// ============================================================

/** 实体状态变更事件（推送给渲染层） */
export interface EntityUpdateEvent {
  providerId: string;
  entityId: string;
  externalId: string;
  entityType: IoTEntityType;
  /** 新状态值 */
  state: string | number | boolean | null;
  attributes: Record<string, unknown>;
  timestamp: number;
}

/** Bridge 事件类型 */
export type BridgeEventType =
  | 'provider:connected' // Provider 连接成功
  | 'provider:disconnected' // Provider 连接断开
  | 'provider:error' // Provider 连接异常
  | 'entity:update' // 实体状态更新
  | 'reading:received'; // 接收到新读数

/** Bridge 事件 */
export interface BridgeEvent {
  type: BridgeEventType;
  providerId?: string;
  /** entity:update / reading:received 时有效 */
  entity?: EntityUpdateEvent;
  /** provider:error 时有效 */
  error?: string;
  timestamp: number;
}

// ============================================================
// 协议适配器接口（s5-10/s5-11/s5-12 实现）
// ============================================================

/**
 * 协议适配器接口
 *
 * 每种协议（Home Assistant / MQTT / BLE / 自定义）实现此接口。
 * IoTBridge 通过此接口与具体协议解耦。
 *
 * 实现方：
 * - s5-11: HomeAssistantAdapter
 * - s5-12: MqttAdapter
 * - s5-13: 自定义适配器（iot-bridge 插件）
 */
export interface IoTProtocolAdapter {
  /** 协议类型 */
  readonly protocol: IoTProtocol;

  /**
   * 建立连接
   *
   * @param provider Provider 摘要（含 endpoint + authConfig）
   * @param callbacks 回调函数集
   * @returns 连接句柄（用于断开连接）
   */
  connect(
    provider: IoTProviderSummary,
    callbacks: AdapterCallbacks,
  ): Promise<AdapterHandle>;

  /** 测试连接（不维持长连接） */
  testConnection(provider: IoTProviderSummary): Promise<{
    success: boolean;
    latencyMs?: number;
    message: string;
  }>;
}

/** 适配器回调（Bridge 注入，让适配器回传数据） */
export interface AdapterCallbacks {
  /** 实体状态变更 */
  onEntityUpdate: (event: EntityUpdateEvent) => void;
  /** 接收到新读数 */
  onReading: (reading: {
    entityId: string;
    externalId: string;
    value?: number;
    stringValue?: string;
    unit?: string;
    timestamp: number;
  }) => void;
  /** 连接异常 */
  onError: (error: Error) => void;
  /** 连接断开 */
  onDisconnect: (reason: string) => void;
}

/** 适配器连接句柄 */
export interface AdapterHandle {
  /** Provider ID */
  providerId: string;
  /** 主动断开连接 */
  disconnect(): Promise<void>;
  /** 是否仍连接中 */
  isConnected(): boolean;
  /**
   * 向 broker 发布消息（阶段9 s9-10，仅 MQTT 协议支持，其他协议返回 false）
   *
   * @param topic 目标主题
   * @param payload 消息内容
   * @param options 发布选项（QoS、retain 等）
   * @returns 是否发布成功
   */
  publish?: (
    topic: string,
    payload: string | Buffer,
    options?: { qos?: 0 | 1 | 2; retain?: boolean },
  ) => Promise<boolean>;
}

// ============================================================
// IPC 通信协议
// ============================================================

/** 渲染层 → 主进程：获取 Provider 配置的回调函数类型 */
export type FetchProviderConfigFn = (
  providerId: string,
) => Promise<{
  success: boolean;
  data?: IoTProviderSummary;
  error?: string;
}>;

/** 渲染层 → 主进程：批量上报读数到后端的回调函数类型 */
export type ReportReadingsFn = (
  readings: Array<{
    entityExternalId: string;
    value?: number;
    stringValue?: string;
    unit?: string;
    source?: ReadingSource;
    recordedAt: number;
  }>,
) => Promise<{ success: boolean; error?: string }>;

// ============================================================
// 性能指标（阶段8 s8-08）
// ============================================================

/** 时间窗口类型 */
export type MetricsWindow = '1m' | '5m' | '1h';

/**
 * 单个 Provider 的性能指标快照
 *
 * 由 IoTMetricsCollector 通过订阅 IoTBridge 的 internal 事件聚合而来。
 * 用于渲染层 PerformancePanel 展示和健康检查判定。
 */
export interface ProviderMetrics {
  /** Provider ID */
  providerId: string;
  /** Provider 名称 */
  providerName: string;
  /** 协议类型 */
  protocol: IoTProtocol;
  /** 当前连接状态 */
  state: ProviderConnectionState;

  /** 累计读数总数（自 Bridge 启动以来） */
  totalReadings: number;
  /** 累计错误总数 */
  totalErrors: number;
  /** 累计状态变更次数 */
  totalStateChanges: number;

  /** 最近一次读数时间戳（毫秒） */
  lastReadingAt: number | null;
  /** 最近一次错误时间戳 */
  lastErrorAt: number | null;
  /** 最近一次连接成功时间戳 */
  lastConnectedAt: number | null;

  /** 当前窗口内读数数量 */
  windowReadings: number;
  /** 当前窗口内错误数量 */
  windowErrors: number;
  /** 读数速率（每分钟），基于当前窗口计算 */
  readingsPerMinute: number;
  /** 错误率（0-1），基于当前窗口计算 */
  errorRate: number;

  /** 连接持续时间（秒），自最近一次 connected 起算 */
  uptimeSeconds: number;
  /** 距离上次读数的间隔（秒），用于停滞检测 */
  secondsSinceLastReading: number | null;
}

/**
 * 协议层聚合指标
 *
 * 按协议类型（homeassistant/mqtt/ble/custom）汇总所有 Provider 的指标。
 */
export interface ProtocolMetrics {
  /** 协议类型 */
  protocol: IoTProtocol;
  /** 该协议下的 Provider 数量 */
  providerCount: number;
  /** 已连接的 Provider 数量 */
  connectedCount: number;
  /** 异常的 Provider 数量 */
  errorCount: number;
  /** 累计读数总数 */
  totalReadings: number;
  /** 累计错误总数 */
  totalErrors: number;
}

/**
 * Bridge 整体性能指标快照
 *
 * 由 IoTMetricsCollector.getMetrics() 返回，包含全局聚合、
 * Provider 明细和协议层聚合三部分。
 */
export interface BridgeMetrics {
  /** 采集时间戳 */
  collectedAt: number;
  /** Bridge 启动时间戳 */
  startedAt: number | null;
  /** Bridge 运行时长（秒） */
  uptimeSeconds: number;

  /** 全局累计读数总数 */
  totalReadings: number;
  /** 全局累计错误总数 */
  totalErrors: number;
  /** 全局累计状态变更总数 */
  totalStateChanges: number;

  /** 当前窗口内读数总数 */
  windowReadings: number;
  /** 当前窗口内错误总数 */
  windowErrors: number;
  /** 全局读数速率（每分钟） */
  globalReadingsPerMinute: number;
  /** 全局错误率（0-1） */
  globalErrorRate: number;

  /** 已连接的 Provider 数量 */
  connectedProviders: number;
  /** Provider 总数 */
  totalProviders: number;
  /** 实体总数 */
  totalEntities: number;

  /** 各 Provider 明细 */
  providers: ProviderMetrics[];
  /** 各协议聚合 */
  protocols: ProtocolMetrics[];
}

/**
 * 历史趋势采样点（阶段9 s9-08）
 *
 * IoTMetricsCollector 每分钟采样一次 BridgeMetrics 的关键指标，
 * 保留最近 24h（1440 个采样点），用于 PerformancePanel 趋势图展示。
 * 仅保留趋势所需字段，避免内存占用过大（1440 * ~80B ≈ 115KB）。
 */
export interface MetricsHistorySample {
  /** 采样时间戳（ms） */
  timestamp: number;
  /** 全局读数速率（每分钟） */
  globalReadingsPerMinute: number;
  /** 全局错误率（0-1） */
  globalErrorRate: number;
  /** 已连接 Provider 数量 */
  connectedProviders: number;
  /** Provider 总数 */
  totalProviders: number;
  /** 实体总数 */
  totalEntities: number;
  /** Bridge 运行时长（秒） */
  uptimeSeconds: number;
  /** 当前窗口读数 */
  windowReadings: number;
  /** 当前窗口错误 */
  windowErrors: number;
}
