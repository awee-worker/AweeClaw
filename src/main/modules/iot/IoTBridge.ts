/**
 * IoT Bridge 主服务
 *
 * 职责：
 * - 管理本地与 IoT Provider 的连接（通过可插拔的协议适配器）
 * - 订阅实体状态变更，实时维护实体快照
 * - 接收传感器读数，批量上报到后端
 * - 通过 IPC 事件向渲染层推送实时更新
 *
 * 单例模式，主进程启动时按需初始化。
 *
 * 协议适配器注册：
 * - s5-10 iot-bridge 插件通过 registerAdapter() 注入自定义协议
 * - s5-11 HomeAssistantAdapter 内置注册
 * - s5-12 MqttAdapter 内置注册
 * - s8-01 BleAdapter 内置注册（@abandonware/noble，按需加载）
 *
 * @module iot/IoTBridge
 */

import { BrowserWindow } from 'electron';
import { EventEmitter } from 'events';
import { logger } from '@shared/toolkit/LogEngine';
import type {
  IoTProtocol,
  IoTProtocolAdapter,
  IoTProviderSummary,
  IoTEntitySnapshot,
  BridgeStatus,
  ProviderStatus,
  BridgeEvent,
  EntityUpdateEvent,
  AdapterHandle,
  FetchProviderConfigFn,
  ReportReadingsFn,
  ReadingSource,
} from './IoTInterface';
import { homeAssistantAdapter } from './adapters/HomeAssistantAdapter';
import { mqttAdapter } from './adapters/MqttAdapter';
import { bleAdapter } from './adapters/BleAdapter';
import { iotEntitySnapshotDb } from './IoTEntitySnapshotDb';
import { IoTMetricsCollector } from './IoTMetricsCollector';

// IoTProviderSummary 用于 connectProvider 的类型契约，保留导入以备协议适配器扩展
void ({} as unknown as IoTProviderSummary);

/** IPC 频道前缀（与 preload/api/iot.ts 对齐） */
const IPC_CHANNEL = 'iot:bridge:event';

/**
 * 主进程内部事件类型（供 SensorFusionService 等订阅）
 *
 * 与 BridgeEvent（推送给渲染层）的区别：
 * - 携带完整读数载荷，无需渲染层再次查询
 * - 仅在主进程内部传播，不经过 IPC 序列化
 */
export type IoTBridgeInternalEvent =
  | { type: 'reading'; providerId: string; reading: BridgeReadingPayload }
  | { type: 'entityUpdate'; providerId: string; entity: EntityUpdateEvent }
  | { type: 'providerConnected'; providerId: string }
  | { type: 'providerDisconnected'; providerId: string }
  | { type: 'providerError'; providerId: string; error: string };

/** 内部 reading 事件载荷 */
export interface BridgeReadingPayload {
  entityId: string;
  externalId: string;
  value?: number;
  stringValue?: string;
  unit?: string;
  timestamp: number;
}

/** 默认批量上报间隔（毫秒） */
const DEFAULT_FLUSH_INTERVAL_MS = 10_000;

/** 默认批量上报最大条数 */
const DEFAULT_FLUSH_BATCH_SIZE = 200;

/** 健康检查间隔（ms） */
const HEALTH_CHECK_INTERVAL_MS = 60_000;

/** 连续健康检查失败上限（超过则强制重连） */
const HEALTH_CHECK_MAX_FAILURES = 3;

/**
 * 数据流停滞检测阈值（ms，阶段8 s8-10）
 *
 * Provider 处于 connected 状态但超过此时间未收到读数时，视为数据流停滞。
 * 默认 5 分钟，覆盖大多数 IoT 协议的轮询周期（HA 默认 30s、MQTT 心跳 60s）。
 * 长轮询或事件驱动的 Provider 可在 metadata.staleThresholdMs 中覆盖。
 */
const DEFAULT_STALE_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * 首次读数宽限期（ms，阶段8 s8-10）
 *
 * Provider 刚连接成功后允许的"无读数"时间。
 * 避免在订阅建立期间误报停滞。
 */
const STALE_GRACE_PERIOD_MS = 90 * 1000;

/** 短时间窗口内连续错误上限（超过则标记不健康） */
const MAX_CONSECUTIVE_ERRORS = 3;

/** 错误计数重置窗口（ms，超过此时间无错误则重置计数） */
const ERROR_RESET_WINDOW_MS = 60_000;

/** 待上报读数条目 */
interface PendingReading {
  entityExternalId: string;
  value?: number;
  stringValue?: string;
  unit?: string;
  source: ReadingSource;
  recordedAt: number;
}

/**
 * 从 Provider metadata 中读取数据流停滞检测阈值（阶段8 s8-10）
 *
 * 支持的 metadata 字段：
 * - staleThresholdMs：number，停滞阈值（毫秒），必须 > 0
 * - staleThresholdSec：number，停滞阈值（秒），必须 > 0（优先级低于 staleThresholdMs）
 *
 * 未配置或配置非法时返回 undefined，由调用方使用默认值。
 */
function readStaleThresholdFromMetadata(
  metadata?: Record<string, unknown>,
): number | undefined {
  if (!metadata) return undefined;

  // 优先 staleThresholdMs
  const ms = metadata.staleThresholdMs;
  if (typeof ms === 'number' && ms > 0 && Number.isFinite(ms)) {
    return ms;
  }

  // 降级到 staleThresholdSec
  const sec = metadata.staleThresholdSec;
  if (typeof sec === 'number' && sec > 0 && Number.isFinite(sec)) {
    return sec * 1000;
  }

  return undefined;
}

/**
 * IoT Bridge 单例服务
 *
 * 继承 EventEmitter 以支持主进程内部订阅（SensorFusionService 等）。
 * 内部事件类型见 {@link IoTBridgeInternalEvent}。
 */
export class IoTBridge extends EventEmitter {
  private static instance: IoTBridge | null = null;

  /** 已注册的协议适配器（按 protocol 索引） */
  private readonly adapters = new Map<IoTProtocol, IoTProtocolAdapter>();

  /** 活跃连接句柄（按 providerId 索引） */
  private readonly handles = new Map<string, AdapterHandle>();

  /** Provider 状态（按 providerId 索引） */
  private readonly providerStatus = new Map<string, ProviderStatus>();

  /** 实体快照（按 entityId 索引） */
  private readonly entitySnapshots = new Map<string, IoTEntitySnapshot>();

  /** 待上报读数队列 */
  private pendingReadings: PendingReading[] = [];

  /** 批量上报定时器 */
  private flushTimer: NodeJS.Timeout | null = null;

  /** Bridge 启动时间戳 */
  private startedAt: number | null = null;

  /** Bridge 是否运行中 */
  private running = false;

  /** 渲染层注入：获取 Provider 配置 */
  private fetchProviderConfig: FetchProviderConfigFn | null = null;

  /** 渲染层注入：批量上报读数到后端 */
  private reportReadings: ReportReadingsFn | null = null;

  /** 主窗口引用（用于推送事件） */
  private mainWindow: BrowserWindow | null = null;

  /** 健康检查定时器 */
  private healthCheckTimer: NodeJS.Timeout | null = null;

  /** 健康检查连续失败计数（providerId → failures） */
  private readonly healthCheckFailures = new Map<string, number>();

  /** 连续错误计数（providerId → count，窗口内累计） */
  private readonly consecutiveErrors = new Map<string, number>();

  /** 最近一次错误时间戳（providerId → timestamp） */
  private readonly lastErrorAt = new Map<string, number>();

  private constructor() {
    super();
    // 主进程内部事件订阅者不超过 10 个（SensorFusionService + 少数观察者），
    // 显式提高上限避免 MaxListenersExceededWarning
    this.setMaxListeners(20);
    // 自动注册内置协议适配器
    this.registerBuiltinAdapters();
  }

  /**
   * 注册内置协议适配器
   *
   * - HomeAssistantAdapter：REST API 轮询（s5-11）
   * - MqttAdapter：WebSocket 订阅（s5-12）
   * - BleAdapter：BLE GATT 订阅/轮询（s8-01，@abandonware/noble 懒加载）
   *
   * 'custom' 等协议由 iot-bridge 插件通过 registerAdapter() 注入。
   *
   * 注意：BleAdapter 在加载 noble 模块失败时会抛错，此处使用 try/catch 容错，
   * 即使 BLE 不可用也不影响 HA/MQTT 适配器的正常使用。
   */
  private registerBuiltinAdapters(): void {
    try {
      this.registerAdapter(homeAssistantAdapter);
    } catch (err) {
      logger.iot?.error('[IoTBridge] 注册 HomeAssistantAdapter 失败:', err);
    }
    try {
      this.registerAdapter(mqttAdapter);
    } catch (err) {
      logger.iot?.error('[IoTBridge] 注册 MqttAdapter 失败:', err);
    }
    try {
      this.registerAdapter(bleAdapter);
    } catch (err) {
      logger.iot?.error('[IoTBridge] 注册 BleAdapter 失败:', err);
    }
  }

  /** 获取单例 */
  static getInstance(): IoTBridge {
    if (!IoTBridge.instance) {
      IoTBridge.instance = new IoTBridge();
    }
    return IoTBridge.instance;
  }

  // ============================================================
  // 适配器注册
  // ============================================================

  /**
   * 注册协议适配器
   *
   * iot-bridge 插件（s5-10）、内置 HomeAssistantAdapter（s5-11）、
   * MqttAdapter（s5-12）通过此方法注入实现。
   */
  registerAdapter(adapter: IoTProtocolAdapter): void {
    if (this.adapters.has(adapter.protocol)) {
      logger.iot?.warn(
        `[IoTBridge] 协议 "${adapter.protocol}" 适配器已存在，覆盖注册`,
      );
    }
    this.adapters.set(adapter.protocol, adapter);
    logger.iot?.info(
      `[IoTBridge] 协议适配器已注册: ${adapter.protocol}`,
    );
  }

  /** 注销协议适配器 */
  unregisterAdapter(protocol: IoTProtocol): void {
    // 先断开该协议下所有活跃连接
    for (const [providerId, handle] of this.handles.entries()) {
      const status = this.providerStatus.get(providerId);
      if (status?.protocol === protocol) {
        handle
          .disconnect()
          .catch((err) =>
            logger.iot?.error(
              `[IoTBridge] 断开 ${providerId} 失败:`,
              err,
            ),
          );
        this.handles.delete(providerId);
        this.providerStatus.delete(providerId);
      }
    }
    this.adapters.delete(protocol);
    logger.iot?.info(`[IoTBridge] 协议适配器已注销: ${protocol}`);
  }

  /** 查询协议适配器是否已注册 */
  hasAdapter(protocol: IoTProtocol): boolean {
    return this.adapters.has(protocol);
  }

  // ============================================================
  // 渲染层回调注入
  // ============================================================

  /**
   * 注入渲染层回调
   *
   * 必须在 start() 之前调用。Bridge 通过这些回调：
   * - 获取 Provider 配置（含解密后的 authConfig）
   * - 批量上报读数到后端 /api/v1/iot/readings/batch
   */
  setRendererCallbacks(callbacks: {
    fetchProviderConfig: FetchProviderConfigFn;
    reportReadings: ReportReadingsFn;
  }): void {
    this.fetchProviderConfig = callbacks.fetchProviderConfig;
    this.reportReadings = callbacks.reportReadings;
    logger.iot?.info('[IoTBridge] 渲染层回调已注入');
  }

  /** 设置主窗口引用（用于推送事件） */
  setMainWindow(window: BrowserWindow | null): void {
    this.mainWindow = window;
  }

  // ============================================================
  // 生命周期管理
  // ============================================================

  /**
   * 启动 Bridge
   *
   * - 从 SQLite 恢复历史快照
   * - 启动批量上报定时器
   * - 标记为运行中
   *
   * 注意：不会自动连接任何 Provider。需调用 connectProvider() 主动连接。
   */
  async start(): Promise<void> {
    if (this.running) {
      logger.iot?.warn('[IoTBridge] 已在运行中，无需重复启动');
      return;
    }

    if (!this.fetchProviderConfig || !this.reportReadings) {
      throw new Error(
        '渲染层回调未注入，请先调用 setRendererCallbacks()',
      );
    }

    // 初始化 SQLite 并恢复历史快照
    try {
      await iotEntitySnapshotDb.initialize();
      const restored = iotEntitySnapshotDb.loadAll();
      for (const snap of restored) {
        this.entitySnapshots.set(snap.id || snap.externalId, {
          id: snap.id,
          deviceId: snap.deviceId,
          externalId: snap.externalId,
          entityType: snap.entityType,
          deviceClass: snap.deviceClass,
          unitOfMeasurement: snap.unitOfMeasurement,
          state: snap.state,
          attributes: snap.attributes,
          lastStateChangedAt: snap.lastStateChangedAt,
        });
      }
      if (restored.length > 0) {
        logger.iot?.info(
          `[IoTBridge] 从 SQLite 恢复 ${restored.length} 个实体快照`,
        );
      }
    } catch (err) {
      logger.iot?.warn('[IoTBridge] 快照恢复失败（非致命）:', err);
    }

    this.running = true;
    this.startedAt = Date.now();
    this.startFlushTimer();
    this.startHealthCheck();
    // 阶段8 s8-08：启动性能指标采集器
    IoTMetricsCollector.getInstance().attach(this);
    logger.iot?.info('[IoTBridge] 已启动');
    this.emitEvent({ type: 'provider:connected', timestamp: Date.now() });
  }

  /** 停止 Bridge：断开所有连接、刷新待上报读数、清理定时器 */
  async stop(): Promise<void> {
    if (!this.running) return;

    // 停止健康检查
    this.stopHealthCheck();

    // 清除所有重连定时器
    for (const [providerId, timer] of this.reconnectTimers.entries()) {
      clearTimeout(timer);
      logger.iot?.info(
        `[IoTBridge] 清除 Provider ${providerId} 的重连定时器`,
      );
    }
    this.reconnectTimers.clear();
    this.reconnectAttempts.clear();

    // 断开所有连接
    const disconnects: Promise<void>[] = [];
    for (const [providerId, handle] of this.handles.entries()) {
      disconnects.push(
        handle.disconnect().catch((err) => {
          logger.iot?.error(
            `[IoTBridge] 断开 ${providerId} 失败:`,
            err,
          );
        }),
      );
    }
    await Promise.allSettled(disconnects);

    this.handles.clear();
    this.providerStatus.clear();
    this.entitySnapshots.clear();

    // 最后一次刷新
    await this.flushReadings();
    this.stopFlushTimer();

    // 阶段8 s8-08：停止性能指标采集器
    IoTMetricsCollector.getInstance().detach();

    this.running = false;
    this.startedAt = null;
    logger.iot?.info('[IoTBridge] 已停止');
  }

  /** 是否运行中 */
  isRunning(): boolean {
    return this.running;
  }

  // ============================================================
  // Provider 连接管理
  // ============================================================

  /**
   * 连接指定 Provider
   *
   * 流程：
   * 1. 通过渲染层回调获取 Provider 配置
   * 2. 根据协议查找适配器
   * 3. 调用适配器 connect() 建立连接
   * 4. 维护状态与事件推送
   *
   * @param providerId Provider ID
   */
  async connectProvider(providerId: string): Promise<void> {
    if (!this.running) {
      throw new Error('Bridge 未启动，请先调用 start()');
    }
    if (!this.fetchProviderConfig) {
      throw new Error('渲染层回调未注入');
    }
    if (this.handles.has(providerId)) {
      logger.iot?.warn(
        `[IoTBridge] Provider ${providerId} 已连接，跳过`,
      );
      return;
    }

    // 获取配置
    const result = await this.fetchProviderConfig(providerId);
    if (!result.success || !result.data) {
      throw new Error(
        `获取 Provider 配置失败: ${result.error ?? '未知错误'}`,
      );
    }
    const provider = result.data;

    if (!provider.enabled) {
      throw new Error(`Provider "${provider.name}" 已禁用`);
    }

    // 查找适配器
    const adapter = this.adapters.get(provider.protocol);
    if (!adapter) {
      throw new Error(
        `协议 "${provider.protocol}" 未注册适配器，请先安装 iot-bridge 插件或对应协议扩展`,
      );
    }

    // 初始化状态
    // 阶段8 s8-10：从 metadata 读取数据流停滞检测阈值
    const staleThresholdMs = readStaleThresholdFromMetadata(provider.metadata);
    this.providerStatus.set(providerId, {
      providerId,
      providerName: provider.name,
      protocol: provider.protocol,
      state: 'connecting',
      entityCount: 0,
      receivedReadings: 0,
      staleThresholdMs,
    });

    try {
      const handle = await adapter.connect(provider, {
        onEntityUpdate: (event) =>
          this.handleEntityUpdate(providerId, event),
        onReading: (reading) =>
          this.handleReading(providerId, reading),
        onError: (err) => this.handleProviderError(providerId, err),
        onDisconnect: (reason) =>
          this.handleProviderDisconnect(providerId, reason),
      });

      this.handles.set(providerId, handle);
      this.updateProviderStatus(providerId, {
        state: 'connected',
        lastConnectedAt: Date.now(),
      });
      // 重置健康检查计数器（新连接开始）
      this.resetHealthCounters(providerId);
      logger.iot?.info(
        `[IoTBridge] Provider ${provider.name} (${providerId}) 已连接`,
      );
      this.emitEvent({
        type: 'provider:connected',
        providerId,
        timestamp: Date.now(),
      });
      // 同步通知主进程内部订阅者（SensorFusionService 等）
      this.emitInternal({
        type: 'providerConnected',
        providerId,
      });
    } catch (err) {
      this.updateProviderStatus(providerId, {
        state: 'error',
        lastError: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /** 断开指定 Provider 连接 */
  async disconnectProvider(providerId: string): Promise<void> {
    // 清除重连定时器，防止主动断开后自动重连
    this.clearReconnectTimer(providerId);
    this.reconnectAttempts.delete(providerId);
    // 清理健康检查计数器
    this.resetHealthCounters(providerId);

    const handle = this.handles.get(providerId);
    if (!handle) {
      logger.iot?.warn(
        `[IoTBridge] Provider ${providerId} 未连接，无需断开`,
      );
      return;
    }
    await handle.disconnect();
    this.handles.delete(providerId);
    this.updateProviderStatus(providerId, {
      state: 'disconnected',
      entityCount: 0,
    });
    logger.iot?.info(
      `[IoTBridge] Provider ${providerId} 已主动断开`,
    );
    this.emitEvent({
      type: 'provider:disconnected',
      providerId,
      timestamp: Date.now(),
    });
  }

  /**
   * 测试 Provider 连接（不维持长连接）
   *
   * 用于设置面板的"测试连接"按钮。
   */
  async testProviderConnection(
    providerId: string,
  ): Promise<{ success: boolean; latencyMs?: number; message: string }> {
    if (!this.fetchProviderConfig) {
      return {
        success: false,
        message: '渲染层回调未注入',
      };
    }

    const result = await this.fetchProviderConfig(providerId);
    if (!result.success || !result.data) {
      return {
        success: false,
        message: `获取 Provider 配置失败: ${result.error ?? '未知错误'}`,
      };
    }

    const provider = result.data;
    const adapter = this.adapters.get(provider.protocol);
    if (!adapter) {
      return {
        success: false,
        message: `协议 "${provider.protocol}" 未注册适配器`,
      };
    }

    return adapter.testConnection(provider);
  }

  /**
   * 向指定 Provider 的 broker 发布消息（阶段9 s9-10）
   *
   * 仅 MQTT 协议支持，其他协议返回 { success: false, message: '该协议不支持发布消息' }。
   * 常用于向设备发送控制命令，例如：
   * - 开关设备：publishMessage(providerId, 'home/switch/01/cmd', 'ON')
   * - 设置亮度：publishMessage(providerId, 'home/light/01/brightness', '128')
   *
   * @param providerId Provider ID
   * @param topic 目标主题
   * @param payload 消息内容
   * @param options 发布选项（QoS、retain）
   */
  async publishMessage(
    providerId: string,
    topic: string,
    payload: string | Buffer,
    options?: { qos?: 0 | 1 | 2; retain?: boolean },
  ): Promise<{ success: boolean; message: string }> {
    const handle = this.handles.get(providerId);
    if (!handle) {
      return {
        success: false,
        message: `Provider ${providerId} 未连接`,
      };
    }
    if (!handle.isConnected()) {
      return {
        success: false,
        message: `Provider ${providerId} 连接已断开`,
      };
    }
    if (!handle.publish) {
      return {
        success: false,
        message: '该协议不支持发布消息（仅 MQTT 协议支持）',
      };
    }

    try {
      const ok = await handle.publish(topic, payload, options);
      if (ok) {
        logger.iot?.info(
          `[IoTBridge] Provider ${providerId} 发布消息: ${topic}`,
        );
        return { success: true, message: '消息已发布' };
      }
      return { success: false, message: '发布失败（broker 拒绝或未连接）' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.iot?.warn(
        `[IoTBridge] Provider ${providerId} 发布异常: ${topic} - ${msg}`,
      );
      return { success: false, message: msg };
    }
  }

  // ============================================================
  // 状态查询
  // ============================================================

  /** 获取 Bridge 整体状态 */
  getStatus(): BridgeStatus {
    const providers = Array.from(this.providerStatus.values());
    return {
      running: this.running,
      startedAt: this.startedAt ?? undefined,
      providers,
      totalEntities: this.entitySnapshots.size,
      totalReadings: providers.reduce(
        (sum, p) => sum + p.receivedReadings,
        0,
      ),
    };
  }

  /** 获取所有实体快照 */
  listEntitySnapshots(): IoTEntitySnapshot[] {
    return Array.from(this.entitySnapshots.values());
  }

  /** 获取指定 Provider 下的实体快照 */
  listEntitySnapshotsByProvider(_providerId: string): IoTEntitySnapshot[] {
    // 通过 device.providerId 关联；此处简化为返回全部快照
    // 实际场景下 AdapterHandle 应维护 providerId → entityIds 映射
    return this.listEntitySnapshots();
  }

  // ============================================================
  // 适配器回调处理
  // ============================================================

  /** 实体状态更新 */
  private handleEntityUpdate(
    providerId: string,
    event: EntityUpdateEvent,
  ): void {
    // 更新快照
    const snapshot: IoTEntitySnapshot = {
      id: event.entityId,
      deviceId: '', // 由适配器在 onReading 中补充
      externalId: event.externalId,
      entityType: event.entityType,
      state: event.state,
      attributes: event.attributes,
      lastStateChangedAt: event.timestamp,
    };
    this.entitySnapshots.set(event.entityId, snapshot);

    // 持久化到 SQLite（防抖写入）
    try {
      iotEntitySnapshotDb.upsertSnapshot(providerId, snapshot);
    } catch (err) {
      logger.iot?.warn('[IoTBridge] 快照持久化失败:', err);
    }

    // 推送给渲染层
    this.emitEvent({
      type: 'entity:update',
      providerId,
      entity: event,
      timestamp: Date.now(),
    });
    // 同步通知主进程内部订阅者
    this.emitInternal({
      type: 'entityUpdate',
      providerId,
      entity: event,
    });
  }

  /** 接收到新读数 */
  private handleReading(
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
    this.pendingReadings.push({
      entityExternalId: reading.externalId,
      value: reading.value,
      stringValue: reading.stringValue,
      unit: reading.unit,
      source: 'bridge',
      recordedAt: reading.timestamp,
    });

    // 更新统计
    const status = this.providerStatus.get(providerId);
    if (status) {
      status.receivedReadings += 1;
      status.lastDataAt = Date.now();
    }

    // 数据流正常，重置连续错误计数
    this.consecutiveErrors.delete(providerId);
    this.lastErrorAt.delete(providerId);

    this.emitEvent({
      type: 'reading:received',
      providerId,
      timestamp: Date.now(),
    });
    // 同步通知主进程内部订阅者（SensorFusionService 等）
    this.emitInternal({
      type: 'reading',
      providerId,
      reading: {
        entityId: reading.entityId,
        externalId: reading.externalId,
        value: reading.value,
        stringValue: reading.stringValue,
        unit: reading.unit,
        timestamp: reading.timestamp,
      },
    });

    // 队列满则立即刷新
    if (this.pendingReadings.length >= DEFAULT_FLUSH_BATCH_SIZE) {
      void this.flushReadings();
    }
  }

  /** Provider 连接异常 */
  private handleProviderError(providerId: string, err: Error): void {
    // 更新连续错误计数（窗口外重置）
    const now = Date.now();
    const lastErr = this.lastErrorAt.get(providerId) ?? 0;
    if (now - lastErr >= ERROR_RESET_WINDOW_MS) {
      this.consecutiveErrors.set(providerId, 0);
    }
    this.consecutiveErrors.set(
      providerId,
      (this.consecutiveErrors.get(providerId) ?? 0) + 1,
    );
    this.lastErrorAt.set(providerId, now);

    logger.iot?.error(
      `[IoTBridge] Provider ${providerId} 连接异常:`,
      err,
    );
    this.updateProviderStatus(providerId, {
      state: 'error',
      lastError: err.message,
    });
    this.emitEvent({
      type: 'provider:error',
      providerId,
      error: err.message,
      timestamp: Date.now(),
    });
    this.emitInternal({
      type: 'providerError',
      providerId,
      error: err.message,
    });
  }

  /** Provider 连接断开 */
  private handleProviderDisconnect(
    providerId: string,
    reason: string,
  ): void {
    logger.iot?.warn(
      `[IoTBridge] Provider ${providerId} 连接断开: ${reason}`,
    );
    this.handles.delete(providerId);
    this.updateProviderStatus(providerId, {
      state: 'disconnected',
      entityCount: 0,
    });
    this.emitEvent({
      type: 'provider:disconnected',
      providerId,
      timestamp: Date.now(),
    });
    this.emitInternal({
      type: 'providerDisconnected',
      providerId,
    });

    // 自动重连（仅在 Bridge 运行中且非主动断开时）
    this.scheduleReconnect(providerId);
  }

  // ============================================================
  // 断线重连
  // ============================================================

  /** 重连定时器映射（providerId → timer） */
  private readonly reconnectTimers = new Map<string, NodeJS.Timeout>();

  /** 最大重连次数 */
  private static readonly MAX_RECONNECT_ATTEMPTS = 5;

  /** 重连基础延迟（ms，指数退避：delay * 2^attempt） */
  private static readonly RECONNECT_BASE_DELAY_MS = 5000;

  /** 重连次数映射（providerId → attempts） */
  private readonly reconnectAttempts = new Map<string, number>();

  /**
   * 调度自动重连
   *
   * 采用指数退避策略：5s → 10s → 20s → 40s → 80s，最多 5 次。
   * 主动 disconnectProvider 时不触发重连（通过 clearReconnectTimer 清除）。
   */
  private scheduleReconnect(providerId: string): void {
    // 清除已有定时器
    this.clearReconnectTimer(providerId);

    const attempts = this.reconnectAttempts.get(providerId) ?? 0;
    if (attempts >= IoTBridge.MAX_RECONNECT_ATTEMPTS) {
      logger.iot?.warn(
        `[IoTBridge] Provider ${providerId} 已达最大重连次数 (${IoTBridge.MAX_RECONNECT_ATTEMPTS})，停止重连`,
      );
      this.reconnectAttempts.delete(providerId);
      return;
    }

    const delay =
      IoTBridge.RECONNECT_BASE_DELAY_MS * Math.pow(2, attempts);
    this.reconnectAttempts.set(providerId, attempts + 1);

    logger.iot?.info(
      `[IoTBridge] Provider ${providerId} 将在 ${delay / 1000}s 后尝试第 ${attempts + 1} 次重连`,
    );

    const timer = setTimeout(() => {
      this.reconnectTimers.delete(providerId);
      if (!this.running) {
        logger.iot?.info(
          `[IoTBridge] Bridge 已停止，取消 Provider ${providerId} 重连`,
        );
        return;
      }
      logger.iot?.info(
        `[IoTBridge] 正在重连 Provider ${providerId}（第 ${attempts + 1} 次）...`,
      );
      this.connectProvider(providerId)
        .then(() => {
          // 重连成功，重置计数
          this.reconnectAttempts.delete(providerId);
          logger.iot?.info(
            `[IoTBridge] Provider ${providerId} 重连成功`,
          );
        })
        .catch((err) => {
          logger.iot?.warn(
            `[IoTBridge] Provider ${providerId} 重连失败:`,
            err instanceof Error ? err.message : String(err),
          );
          // 递归调度下一次重连
          this.scheduleReconnect(providerId);
        });
    }, delay);

    this.reconnectTimers.set(providerId, timer);
  }

  /** 清除指定 Provider 的重连定时器 */
  private clearReconnectTimer(providerId: string): void {
    const timer = this.reconnectTimers.get(providerId);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(providerId);
    }
  }

  // ============================================================
  // 健康检查（阶段7 s7-05 新增）
  // ============================================================

  /**
   * 启动健康检查定时器
   *
   * 每 {@link HEALTH_CHECK_INTERVAL_MS} 毫秒执行一次：
   * - 调用 handle.isConnected() 检测静默断连
   * - 检查窗口内连续错误计数
   * - 连续 {@link HEALTH_CHECK_MAX_FAILURES} 次不健康 → 强制重连
   *
   * 适用场景：
   * - HA REST 适配器轮询失败但未触发 onDisconnect
   * - HA WebSocket 适配器内部重连持续失败
   * - MQTT 适配器 onDisconnect 未触发的边界情况
   */
  private startHealthCheck(): void {
    if (this.healthCheckTimer) return;
    this.healthCheckTimer = setInterval(() => {
      this.performHealthCheck();
    }, HEALTH_CHECK_INTERVAL_MS);
    logger.iot?.info(
      `[IoTBridge] 健康检查已启动（间隔 ${HEALTH_CHECK_INTERVAL_MS / 1000}s）`,
    );
  }

  /** 停止健康检查定时器并清理计数器 */
  private stopHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
    this.healthCheckFailures.clear();
    this.consecutiveErrors.clear();
    this.lastErrorAt.clear();
  }

  /**
   * 执行一次健康检查
   *
   * 检查策略：
   * 1. 连接状态检查：handle.isConnected() 返回 false → 不健康
   * 2. 错误率检查：窗口内连续错误 ≥ MAX_CONSECUTIVE_ERRORS → 不健康
   * 3. 数据流停滞检查（阶段8 s8-10）：connected 状态但超过阈值未收到读数 → 不健康
   * 4. 连续 HEALTH_CHECK_MAX_FAILURES 次不健康 → 调用 forceReconnect()
   *
   * 注意：HA WebSocket 适配器有内部重连机制，健康检查仅在持续失败时介入。
   */
  private performHealthCheck(): void {
    if (!this.running) return;
    const now = Date.now();

    for (const [providerId, handle] of this.handles.entries()) {
      const status = this.providerStatus.get(providerId);
      if (!status) continue;

      let isHealthy = true;
      let unhealthyReason = '';

      // 1. 连接状态检查
      try {
        if (!handle.isConnected()) {
          isHealthy = false;
          unhealthyReason = '适配器报告未连接';
        }
      } catch (err) {
        isHealthy = false;
        unhealthyReason = `isConnected() 异常: ${err instanceof Error ? err.message : String(err)}`;
      }

      // 2. 连续错误检查（仅在窗口内累计）
      const lastErr = this.lastErrorAt.get(providerId) ?? 0;
      const errCount = this.consecutiveErrors.get(providerId) ?? 0;
      if (
        isHealthy &&
        errCount >= MAX_CONSECUTIVE_ERRORS &&
        now - lastErr < ERROR_RESET_WINDOW_MS
      ) {
        isHealthy = false;
        unhealthyReason = `窗口内连续错误 ${errCount} 次`;
      }

      // 3. 数据流停滞检查（阶段8 s8-10）
      //    Provider 处于 connected 状态但长时间未收到读数 → 数据流停滞
      //    - 跳过宽限期（刚连接的 Provider 允许 90s 内无读数）
      //    - 阈值可通过 Provider metadata.staleThresholdMs 自定义
      if (isHealthy && status.state === 'connected') {
        const connectedAt = status.lastConnectedAt ?? 0;
        const inGracePeriod = connectedAt > 0 && now - connectedAt < STALE_GRACE_PERIOD_MS;
        if (!inGracePeriod) {
          const lastDataAt = status.lastDataAt ?? 0;
          if (lastDataAt > 0) {
            const staleThreshold = this.getStaleThreshold(providerId);
            const silenceMs = now - lastDataAt;
            if (silenceMs > staleThreshold) {
              isHealthy = false;
              unhealthyReason =
                `数据流停滞：已 ${(silenceMs / 1000).toFixed(0)}s 未收到读数（阈值 ${staleThreshold / 1000}s）`;
            }
          }
        }
      }

      // 4. 更新健康检查失败计数
      if (isHealthy) {
        this.healthCheckFailures.delete(providerId);
      } else {
        const failures =
          (this.healthCheckFailures.get(providerId) ?? 0) + 1;
        this.healthCheckFailures.set(providerId, failures);
        logger.iot?.warn(
          `[IoTBridge] Provider ${providerId} 健康检查失败 (${failures}/${HEALTH_CHECK_MAX_FAILURES}): ${unhealthyReason}`,
        );

        if (failures >= HEALTH_CHECK_MAX_FAILURES) {
          logger.iot?.warn(
            `[IoTBridge] Provider ${providerId} 连续 ${failures} 次健康检查失败，强制重连`,
          );
          this.healthCheckFailures.delete(providerId);
          this.consecutiveErrors.delete(providerId);
          this.lastErrorAt.delete(providerId);

          // 通知 UI 持久故障
          this.emitEvent({
            type: 'provider:error',
            providerId,
            error: `健康检查失败：${unhealthyReason}`,
            timestamp: now,
          });
          this.emitInternal({
            type: 'providerError',
            providerId,
            error: `健康检查失败：${unhealthyReason}`,
          });

          // 强制重连（异步，不阻塞健康检查循环）
          void this.forceReconnect(providerId, unhealthyReason);
        }
      }

      // 5. 重置过期错误计数（窗口外无新错误则清零）
      if (
        errCount > 0 &&
        now - lastErr >= ERROR_RESET_WINDOW_MS
      ) {
        this.consecutiveErrors.delete(providerId);
        this.lastErrorAt.delete(providerId);
      }
    }
  }

  /**
   * 获取指定 Provider 的数据流停滞阈值（阶段8 s8-10）
   *
   * 优先读取 Provider 配置中的 metadata.staleThresholdMs，
   * 未配置时返回默认值 DEFAULT_STALE_THRESHOLD_MS。
   *
   * 注意：Bridge 不直接持有 Provider 元信息，此处通过 providerStatus 中
   * 已缓存的 state 字段判断连接状态。staleThresholdMs 由 connectProvider
   * 时从 IoTProviderSummary.metadata 中读取并缓存在 providerStatus 中。
   */
  private getStaleThreshold(providerId: string): number {
    const status = this.providerStatus.get(providerId);
    if (status?.staleThresholdMs && status.staleThresholdMs > 0) {
      return status.staleThresholdMs;
    }
    return DEFAULT_STALE_THRESHOLD_MS;
  }

  /**
   * 强制断开并调度重连
   *
   * 用于健康检查检测到静默故障时主动触发重连。
   * 主动调用 handle.disconnect() 清理适配器状态，不依赖 onDisconnect 回调。
   *
   * @param providerId Provider ID
   * @param reason 强制重连原因（记录到日志和状态）
   */
  private async forceReconnect(
    providerId: string,
    reason: string,
  ): Promise<void> {
    const handle = this.handles.get(providerId);
    if (handle) {
      // 清除已有重连定时器（防止 scheduleReconnect 重复调度）
      this.clearReconnectTimer(providerId);

      try {
        await handle.disconnect();
      } catch (err) {
        logger.iot?.warn(
          `[IoTBridge] Provider ${providerId} 强制断开异常:`,
          err instanceof Error ? err.message : String(err),
        );
      }
      this.handles.delete(providerId);
    }

    // 更新状态并通知
    this.updateProviderStatus(providerId, {
      state: 'disconnected',
      entityCount: 0,
      lastError: reason,
    });
    this.emitEvent({
      type: 'provider:disconnected',
      providerId,
      timestamp: Date.now(),
    });
    this.emitInternal({
      type: 'providerDisconnected',
      providerId,
    });

    // 调度重连
    this.scheduleReconnect(providerId);
  }

  /**
   * 重置指定 Provider 的健康计数器
   *
   * 在以下场景调用：
   * - connectProvider() 成功连接后
   * - disconnectProvider() 主动断开时
   */
  private resetHealthCounters(providerId: string): void {
    this.healthCheckFailures.delete(providerId);
    this.consecutiveErrors.delete(providerId);
    this.lastErrorAt.delete(providerId);
  }

  // ============================================================
  // 批量上报
  // ============================================================

  /** 启动批量上报定时器 */
  private startFlushTimer(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => {
      void this.flushReadings();
    }, DEFAULT_FLUSH_INTERVAL_MS);
  }

  /** 停止批量上报定时器 */
  private stopFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /** 批量上报待发送读数到后端 */
  private async flushReadings(): Promise<void> {
    if (this.pendingReadings.length === 0) return;
    if (!this.reportReadings) {
      logger.iot?.warn(
        '[IoTBridge] 渲染层上报回调未注入，丢弃待上报读数',
      );
      this.pendingReadings = [];
      return;
    }

    const batch = this.pendingReadings.splice(0, DEFAULT_FLUSH_BATCH_SIZE);
    try {
      const result = await this.reportReadings(batch);
      if (!result.success) {
        logger.iot?.warn(
          `[IoTBridge] 批量上报失败 (${batch.length} 条): ${result.error}`,
        );
        // 失败的读数放回队列头部（最多保留 1000 条避免无限增长）
        if (this.pendingReadings.length < 1000) {
          this.pendingReadings.unshift(...batch);
        }
      } else {
        logger.iot?.debug(
          `[IoTBridge] 批量上报成功 (${batch.length} 条)`,
        );
      }
    } catch (err) {
      logger.iot?.error('[IoTBridge] 批量上报异常:', err);
      // 异常时不放回，避免坏数据反复重试
    }
  }

  // ============================================================
  // 内部工具
  // ============================================================

  /** 更新 Provider 状态 */
  private updateProviderStatus(
    providerId: string,
    patch: Partial<ProviderStatus>,
  ): void {
    const current = this.providerStatus.get(providerId);
    if (!current) return;
    this.providerStatus.set(providerId, { ...current, ...patch });
  }

  /** 推送事件到渲染层 */
  private emitEvent(event: BridgeEvent): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    this.mainWindow.webContents.send(IPC_CHANNEL, event);
  }

  /**
   * 推送内部事件给主进程订阅者（SensorFusionService 等）
   *
   * 与 emitEvent 的区别：
   * - 不经过 IPC 序列化，性能更高
   * - 携带完整读数载荷（BridgeEvent 的 reading:received 不含载荷）
   * - 仅在主进程内部传播
   *
   * 使用 EventEmitter 的 'internal' 频道统一派发，订阅者通过 onInternal() 注册。
   * 异常被吞掉避免影响 Bridge 主流程。
   */
  private emitInternal(event: IoTBridgeInternalEvent): void {
    try {
      this.emit('internal', event);
    } catch (err) {
      logger.iot?.warn('[IoTBridge] 内部事件派发异常:', err);
    }
  }

  /**
   * 订阅主进程内部事件
   *
   * @returns 取消订阅函数
   */
  onInternal(
    listener: (event: IoTBridgeInternalEvent) => void,
  ): () => void {
    this.on('internal', listener);
    return () => {
      this.off('internal', listener);
    };
  }
}
