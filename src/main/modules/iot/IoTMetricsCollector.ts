/**
 * IoT 性能指标采集器 — 阶段8 s8-08
 *
 * 职责：
 * - 订阅 IoTBridge 的 internal 事件，采集细粒度性能指标
 * - 维护时间窗口（1m/5m/1h）的滑动统计
 * - 聚合 Provider 级、协议级、全局级指标
 * - 供 IoTIpc 暴露给渲染层 PerformancePanel 展示
 * - 供 IoTBridge 健康检查使用（数据流停滞检测）
 *
 * 设计原则：
 * - 单例模式：全局唯一实例，与 IoTBridge 生命周期同步
 * - 低开销：仅在事件触发时更新计数，查询时计算速率
 * - 滑动窗口：使用时间戳数组维护窗口内事件，过期自动清理
 * - 非阻塞：所有事件处理 try/catch 容错，不影响 Bridge 主流程
 *
 * @module iot/IoTMetricsCollector
 */

import { logger } from '@shared/toolkit/LogEngine';
import { IoTBridge, type IoTBridgeInternalEvent } from './IoTBridge';
import type {
  IoTProtocol,
  ProviderConnectionState,
  ProviderMetrics,
  ProtocolMetrics,
  BridgeMetrics,
  MetricsWindow,
  MetricsHistorySample,
} from './IoTInterface';

// ============================================================
// 常量
// ============================================================

/** 时间窗口对应的毫秒数 */
const WINDOW_MS: Record<MetricsWindow, number> = {
  '1m': 60 * 1000,
  '5m': 5 * 60 * 1000,
  '1h': 60 * 60 * 1000,
};

/** 默认时间窗口 */
const DEFAULT_WINDOW: MetricsWindow = '5m';

/** 窗口清理间隔（毫秒） */
const CLEANUP_INTERVAL_MS = 60 * 1000;

/** 已知协议列表（用于协议聚合，未注册协议不显示） */
const KNOWN_PROTOCOLS: IoTProtocol[] = ['homeassistant', 'mqtt', 'ble', 'custom'];

/** 历史趋势采样间隔（毫秒，1 分钟一次） */
const HISTORY_SAMPLE_INTERVAL_MS = 60 * 1000;

/** 历史趋势最大采样数（24h * 60min = 1440 个采样点） */
const HISTORY_MAX_SAMPLES = 24 * 60;

// ============================================================
// Provider 指标内部结构
// ============================================================

interface ProviderMetricsState {
  providerId: string;
  providerName: string;
  protocol: IoTProtocol;
  state: ProviderConnectionState;

  /** 累计计数器 */
  totalReadings: number;
  totalErrors: number;
  totalStateChanges: number;

  /** 最近时间戳 */
  lastReadingAt: number | null;
  lastErrorAt: number | null;
  lastConnectedAt: number | null;

  /** 窗口内事件时间戳数组（用于滑动窗口统计） */
  readingTimestamps: number[];
  errorTimestamps: number[];
}

// ============================================================
// IoTMetricsCollector 单例
// ============================================================

/**
 * IoT 性能指标采集器单例
 *
 * 使用方式：
 * ```ts
 * const collector = IoTMetricsCollector.getInstance()
 * collector.attach(bridge)  // Bridge 启动时调用
 * const metrics = collector.getMetrics()  // 渲染层查询时调用
 * collector.detach()  // Bridge 停止时调用
 * ```
 */
export class IoTMetricsCollector {
  private static instance: IoTMetricsCollector | null = null;

  /** Provider 指标状态（按 providerId 索引） */
  private readonly providerStates = new Map<string, ProviderMetricsState>();

  /** 已绑定的 IoTBridge 实例 */
  private bridge: IoTBridge | null = null;

  /** 内部事件订阅取消函数 */
  private unsubscribe: (() => void) | null = null;

  /** 窗口清理定时器 */
  private cleanupTimer: NodeJS.Timeout | null = null;

  /** 当前时间窗口 */
  private currentWindow: MetricsWindow = DEFAULT_WINDOW;

  /** Bridge 启动时间戳 */
  private startedAt: number | null = null;

  /** 历史趋势采样数组（按时间升序，最多保留 HISTORY_MAX_SAMPLES 个） */
  private historySamples: MetricsHistorySample[] = [];

  /** 历史采样定时器 */
  private historyTimer: NodeJS.Timeout | null = null;

  private constructor() {}

  /** 获取单例 */
  static getInstance(): IoTMetricsCollector {
    if (!IoTMetricsCollector.instance) {
      IoTMetricsCollector.instance = new IoTMetricsCollector();
    }
    return IoTMetricsCollector.instance;
  }

  /**
   * 绑定到 IoTBridge 并开始采集
   *
   * 应在 Bridge.start() 成功后调用。重复调用会先 detach 再 attach。
   */
  attach(bridge: IoTBridge): void {
    // 已绑定到同一 Bridge，跳过
    if (this.bridge === bridge && this.unsubscribe) return;

    // 先解绑旧的
    this.detach();

    this.bridge = bridge;
    this.startedAt = Date.now();

    // 订阅 internal 事件
    this.unsubscribe = bridge.onInternal((event) => {
      this.handleInternalEvent(event);
    });

    // 启动窗口清理定时器
    this.cleanupTimer = setInterval(() => {
      this.cleanupWindows();
    }, CLEANUP_INTERVAL_MS);

    // 启动历史趋势采样定时器（阶段9 s9-08）
    this.historyTimer = setInterval(() => {
      this.recordHistorySample();
    }, HISTORY_SAMPLE_INTERVAL_MS);

    // 立即采样一次，避免首个采样点延迟 1 分钟才出现
    this.recordHistorySample();

    logger.iot?.info('[IoTMetricsCollector] 已绑定 IoTBridge，开始采集指标');
  }

  /** 解绑 IoTBridge，停止采集并清空状态 */
  detach(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    if (this.historyTimer) {
      clearInterval(this.historyTimer);
      this.historyTimer = null;
    }
    this.bridge = null;
    this.startedAt = null;
    this.providerStates.clear();
    this.historySamples.length = 0;

    logger.iot?.info('[IoTMetricsCollector] 已解绑 IoTBridge，停止采集');
  }

  /** 设置时间窗口 */
  setWindow(window: MetricsWindow): void {
    this.currentWindow = window;
  }

  /** 获取当前时间窗口 */
  getWindow(): MetricsWindow {
    return this.currentWindow;
  }

  // ============================================================
  // 指标查询
  // ============================================================

  /**
   * 获取完整的 Bridge 指标快照
   *
   * 调用时会清理过期的时间戳，然后基于当前窗口计算速率和错误率。
   */
  getMetrics(): BridgeMetrics {
    const now = Date.now();
    const windowMs = WINDOW_MS[this.currentWindow];
    const collectedAt = now;

    // 先清理过期时间戳
    this.pruneStaleTimestamps(now, windowMs);

    // 聚合 Provider 指标
    const providers = this.buildProviderMetrics(now, windowMs);

    // 聚合全局指标
    let totalReadings = 0;
    let totalErrors = 0;
    let totalStateChanges = 0;
    let windowReadings = 0;
    let windowErrors = 0;
    let connectedProviders = 0;

    for (const p of providers) {
      totalReadings += p.totalReadings;
      totalErrors += p.totalErrors;
      totalStateChanges += p.totalStateChanges;
      windowReadings += p.windowReadings;
      windowErrors += p.windowErrors;
      if (p.state === 'connected') connectedProviders++;
    }

    // 窗口时长（分钟）
    const windowMinutes = windowMs / 60000;
    const globalReadingsPerMinute =
      windowMinutes > 0 ? windowReadings / windowMinutes : 0;
    const totalWindowEvents = windowReadings + windowErrors;
    const globalErrorRate =
      totalWindowEvents > 0 ? windowErrors / totalWindowEvents : 0;

    // 聚合协议指标
    const protocols = this.buildProtocolMetrics(providers);

    // 实体总数从 Bridge.getStatus() 获取
    let totalEntities = 0;
    if (this.bridge) {
      try {
        totalEntities = this.bridge.getStatus().totalEntities;
      } catch (e) {
        logger.iot?.warn('[IoTMetricsCollector] 获取实体总数失败:', e);
      }
    }

    return {
      collectedAt,
      startedAt: this.startedAt,
      uptimeSeconds: this.startedAt
        ? Math.floor((now - this.startedAt) / 1000)
        : 0,
      totalReadings,
      totalErrors,
      totalStateChanges,
      windowReadings,
      windowErrors,
      globalReadingsPerMinute: Number(globalReadingsPerMinute.toFixed(2)),
      globalErrorRate: Number(globalErrorRate.toFixed(4)),
      connectedProviders,
      totalProviders: providers.length,
      totalEntities,
      providers,
      protocols,
    };
  }

  /**
   * 获取历史趋势采样数据（阶段9 s9-08）
   *
   * 返回最近 durationMs 时间内的采样点。最多 1440 个（24h）。
   * 若 Bridge 刚启动不足 1 分钟，可能返回空数组或仅有 1 个采样点。
   *
   * @param durationMs 查询时长（毫秒），默认 24h
   * @returns 采样点数组（按时间升序）
   */
  getMetricsHistory(durationMs: number = 24 * 60 * 60 * 1000): MetricsHistorySample[] {
    const now = Date.now();
    const cutoff = now - durationMs;
    return this.historySamples.filter((s) => s.timestamp >= cutoff);
  }

  /** 清空历史采样（仅供测试或重置使用） */
  clearHistory(): void {
    this.historySamples.length = 0;
  }

  /**
   * 采样一次当前指标到历史数组（阶段9 s9-08）
   *
   * 由 historyTimer 每分钟触发。从当前 getMetrics() 提取趋势所需字段，
   * 添加到 historySamples，超过 HISTORY_MAX_SAMPLES 时丢弃最旧采样点。
   */
  private recordHistorySample(): void {
    try {
      const metrics = this.getMetrics();
      const sample: MetricsHistorySample = {
        timestamp: metrics.collectedAt,
        globalReadingsPerMinute: metrics.globalReadingsPerMinute,
        globalErrorRate: metrics.globalErrorRate,
        connectedProviders: metrics.connectedProviders,
        totalProviders: metrics.totalProviders,
        totalEntities: metrics.totalEntities,
        uptimeSeconds: metrics.uptimeSeconds,
        windowReadings: metrics.windowReadings,
        windowErrors: metrics.windowErrors,
      };
      this.historySamples.push(sample);
      // 超出上限丢弃最旧采样点（FIFO）
      if (this.historySamples.length > HISTORY_MAX_SAMPLES) {
        this.historySamples.shift();
      }
    } catch (e) {
      logger.iot?.warn(
        '[IoTMetricsCollector] 历史采样失败:',
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  // ============================================================
  // 事件处理
  // ============================================================

  /** 处理 IoTBridge internal 事件 */
  private handleInternalEvent(event: IoTBridgeInternalEvent): void {
    try {
      switch (event.type) {
        case 'reading':
          this.handleReadingEvent(event);
          break;
        case 'entityUpdate':
          this.handleEntityUpdateEvent(event);
          break;
        case 'providerConnected':
          this.handleProviderConnectedEvent(event);
          break;
        case 'providerDisconnected':
          this.handleProviderDisconnectedEvent(event);
          break;
        case 'providerError':
          this.handleProviderErrorEvent(event);
          break;
        default:
          // 其他事件类型不处理
          break;
      }
    } catch (e) {
      logger.iot?.warn(
        '[IoTMetricsCollector] 事件处理异常:',
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  /** 处理读数事件 */
  private handleReadingEvent(
    event: Extract<IoTBridgeInternalEvent, { type: 'reading' }>,
  ): void {
    const state = this.getOrCreateProviderState(event.providerId);
    state.totalReadings += 1;
    state.lastReadingAt = event.reading.timestamp;
    state.readingTimestamps.push(event.reading.timestamp);
  }

  /** 处理实体状态变更事件 */
  private handleEntityUpdateEvent(
    event: Extract<IoTBridgeInternalEvent, { type: 'entityUpdate' }>,
  ): void {
    const state = this.getOrCreateProviderState(event.providerId);
    state.totalStateChanges += 1;
  }

  /** 处理 Provider 连接成功事件 */
  private handleProviderConnectedEvent(
    event: Extract<IoTBridgeInternalEvent, { type: 'providerConnected' }>,
  ): void {
    const state = this.getOrCreateProviderState(event.providerId);
    state.state = 'connected';
    state.lastConnectedAt = Date.now();
  }

  /** 处理 Provider 断开事件 */
  private handleProviderDisconnectedEvent(
    event: Extract<IoTBridgeInternalEvent, { type: 'providerDisconnected' }>,
  ): void {
    const state = this.getOrCreateProviderState(event.providerId);
    state.state = 'disconnected';
  }

  /** 处理 Provider 错误事件 */
  private handleProviderErrorEvent(
    event: Extract<IoTBridgeInternalEvent, { type: 'providerError' }>,
  ): void {
    const now = Date.now();
    const state = this.getOrCreateProviderState(event.providerId);
    state.totalErrors += 1;
    state.lastErrorAt = now;
    state.state = 'error';
    state.errorTimestamps.push(now);
  }

  // ============================================================
  // 状态管理
  // ============================================================

  /**
   * 获取或创建 Provider 指标状态
   *
   * IoTBridgeInternalEvent 仅携带 providerId，不包含 name/protocol，
   * 因此在首次创建状态时从 bridge.getStatus() 查询 Provider 元信息。
   * 若 Bridge 不可用或查询失败，使用 providerId 作为 fallback 名称。
   */
  private getOrCreateProviderState(providerId: string): ProviderMetricsState {
    let state = this.providerStates.get(providerId);
    if (state) return state;

    // 从 Bridge 查询 Provider 元信息
    let providerName = providerId;
    let protocol: IoTProtocol = 'custom';
    let connState: ProviderConnectionState = 'disconnected';

    if (this.bridge) {
      try {
        const status = this.bridge.getStatus();
        const provider = status.providers.find((p) => p.providerId === providerId);
        if (provider) {
          providerName = provider.providerName;
          protocol = provider.protocol;
          connState = provider.state;
        }
      } catch (e) {
        logger.iot?.warn(
          '[IoTMetricsCollector] 查询 Provider 元信息失败:',
          e instanceof Error ? e.message : String(e),
        );
      }
    }

    state = {
      providerId,
      providerName,
      protocol,
      state: connState,
      totalReadings: 0,
      totalErrors: 0,
      totalStateChanges: 0,
      lastReadingAt: null,
      lastErrorAt: null,
      lastConnectedAt: null,
      readingTimestamps: [],
      errorTimestamps: [],
    };
    this.providerStates.set(providerId, state);
    return state;
  }

  // ============================================================
  // 指标构建
  // ============================================================

  /** 构建 Provider 指标数组 */
  private buildProviderMetrics(
    now: number,
    windowMs: number,
  ): ProviderMetrics[] {
    const result: ProviderMetrics[] = [];

    for (const state of this.providerStates.values()) {
      const windowReadings = state.readingTimestamps.length;
      const windowErrors = state.errorTimestamps.length;

      const windowMinutes = windowMs / 60000;
      const readingsPerMinute =
        windowMinutes > 0 ? windowReadings / windowMinutes : 0;
      const totalWindowEvents = windowReadings + windowErrors;
      const errorRate =
        totalWindowEvents > 0 ? windowErrors / totalWindowEvents : 0;

      const uptimeSeconds = state.lastConnectedAt
        ? Math.floor((now - state.lastConnectedAt) / 1000)
        : 0;

      const secondsSinceLastReading = state.lastReadingAt
        ? Math.floor((now - state.lastReadingAt) / 1000)
        : null;

      result.push({
        providerId: state.providerId,
        providerName: state.providerName,
        protocol: state.protocol,
        state: state.state,
        totalReadings: state.totalReadings,
        totalErrors: state.totalErrors,
        totalStateChanges: state.totalStateChanges,
        lastReadingAt: state.lastReadingAt,
        lastErrorAt: state.lastErrorAt,
        lastConnectedAt: state.lastConnectedAt,
        windowReadings,
        windowErrors,
        readingsPerMinute: Number(readingsPerMinute.toFixed(2)),
        errorRate: Number(errorRate.toFixed(4)),
        uptimeSeconds,
        secondsSinceLastReading,
      });
    }

    return result;
  }

  /** 构建协议聚合指标 */
  private buildProtocolMetrics(providers: ProviderMetrics[]): ProtocolMetrics[] {
    const result: ProtocolMetrics[] = [];

    for (const protocol of KNOWN_PROTOCOLS) {
      const protocolProviders = providers.filter((p) => p.protocol === protocol);
      if (protocolProviders.length === 0) continue;

      result.push({
        protocol,
        providerCount: protocolProviders.length,
        connectedCount: protocolProviders.filter((p) => p.state === 'connected').length,
        errorCount: protocolProviders.filter((p) => p.state === 'error').length,
        totalReadings: protocolProviders.reduce((s, p) => s + p.totalReadings, 0),
        totalErrors: protocolProviders.reduce((s, p) => s + p.totalErrors, 0),
      });
    }

    return result;
  }

  // ============================================================
  // 窗口清理
  // ============================================================

  /** 清理过期的时间戳（基于当前窗口） */
  private cleanupWindows(): void {
    const now = Date.now();
    const windowMs = WINDOW_MS[this.currentWindow];
    this.pruneStaleTimestamps(now, windowMs);
  }

  /** 移除所有 Provider 的过期时间戳 */
  private pruneStaleTimestamps(now: number, windowMs: number): void {
    const threshold = now - windowMs;
    for (const state of this.providerStates.values()) {
      state.readingTimestamps = state.readingTimestamps.filter((t) => t >= threshold);
      state.errorTimestamps = state.errorTimestamps.filter((t) => t >= threshold);
    }
  }
}
