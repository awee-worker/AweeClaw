/**
 * Home Assistant 协议适配器
 *
 * 支持两种连接模式，由 authConfig.useWebSocket 控制：
 *
 * 1. **REST 轮询模式（默认）**
 *    - 通过 Home Assistant REST API 轮询实体状态：
 *      a. 连接时拉取所有实体状态（GET /api/states）
 *      b. 按 pollIntervalSec 定时轮询变更
 *      c. 解析实体类型（sensor/binary_sensor/switch/light/climate 等）
 *      d. 数值型 sensor 回调 onReading，所有实体回调 onEntityUpdate
 *
 * 2. **WebSocket 实时订阅模式（阶段7新增，authConfig.useWebSocket = true）**
 *    - 委托给 HomeAssistantWebSocketAdapter：
 *      a. 通过 WebSocket 实时订阅 state_changed 事件
 *      b. 首次连接调用 get_states 获取初始状态
 *      c. 毫秒级实时推送，网络开销更低
 *      d. 自动重连（指数退避）+ 心跳保活
 *
 * 认证方式：Bearer Token（authConfig.token 或 authConfig.longLivedToken）
 *
 * 参考：
 * - REST: https://developers.home-assistant.io/docs/api/rest/
 * - WebSocket: https://developers.home-assistant.io/docs/api/websocket/
 *
 * @module iot/adapters/HomeAssistantAdapter
 */

import { logger } from '@shared/toolkit/LogEngine';
import type {
  IoTProtocolAdapter,
  IoTProtocol,
  IoTProviderSummary,
  AdapterCallbacks,
  AdapterHandle,
  IoTEntityType,
  EntityUpdateEvent,
} from '../IoTInterface';
import { homeAssistantWebSocketAdapter } from './HomeAssistantWebSocketAdapter';

// ============================================================
// 常量
// ============================================================

const PROTOCOL: IoTProtocol = 'homeassistant';

/** HA 实体域名 → IoTEntityType 映射 */
const DOMAIN_TO_ENTITY_TYPE: Record<string, IoTEntityType> = {
  sensor: 'sensor',
  binary_sensor: 'binary_sensor',
  switch: 'switch',
  light: 'light',
  climate: 'climate',
  cover: 'cover',
  lock: 'lock',
  media_player: 'media_player',
  device_tracker: 'device_tracker',
  input_number: 'sensor',
  input_boolean: 'binary_sensor',
  input_select: 'sensor',
  input_text: 'sensor',
};

/** 轮询间隔下限（秒），防止过度请求 */
const MIN_POLL_INTERVAL_SEC = 5;

/** 单次拉取实体上限（HA 通常 < 2000） */
const MAX_ENTITIES_PER_FETCH = 5000;

/** 连接测试超时（ms） */
const TEST_CONNECTION_TIMEOUT_MS = 8000;

// ============================================================
// 类型定义
// ============================================================

/** HA State 响应体 */
interface HAState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
  last_updated: string;
}

/** 适配器内部状态 */
interface AdapterState {
  providerId: string;
  baseUrl: string;
  token: string;
  pollIntervalMs: number;
  /** 上次轮询的实体状态快照（entity_id → state 字符串） */
  lastStates: Map<string, string>;
  /** 轮询定时器 */
  pollTimer: NodeJS.Timeout | null;
  /** 是否已断开 */
  disconnected: boolean;
  /** 上报回调 */
  callbacks: AdapterCallbacks;
}

// ============================================================
// HomeAssistantAdapter 实现
// ============================================================

export class HomeAssistantAdapter implements IoTProtocolAdapter {
  readonly protocol: IoTProtocol = PROTOCOL;

  async connect(
    provider: IoTProviderSummary,
    callbacks: AdapterCallbacks,
  ): Promise<AdapterHandle> {
    // 阶段7：若用户在 authConfig 中启用 useWebSocket，则委托给 WebSocket 实时订阅适配器
    if (this.shouldUseWebSocket(provider)) {
      logger.iot?.info(
        `[HAAdapter] Provider ${provider.id} 启用 WebSocket 模式，委托给 HomeAssistantWebSocketAdapter`,
      );
      return homeAssistantWebSocketAdapter.connect(provider, callbacks);
    }

    const { baseUrl, token } = this.parseAuthConfig(provider);

    const pollIntervalSec = Math.max(
      MIN_POLL_INTERVAL_SEC,
      provider.pollIntervalSec || 30,
    );

    const state: AdapterState = {
      providerId: provider.id,
      baseUrl,
      token,
      pollIntervalMs: pollIntervalSec * 1000,
      lastStates: new Map(),
      pollTimer: null,
      disconnected: false,
      callbacks,
    };

    // 首次拉取（验证连接 + 初始化快照）
    try {
      await this.pollOnce(state, true);
      logger.iot?.info(
        `[HAAdapter] Provider ${provider.id} 连接成功，初始实体 ${state.lastStates.size} 个`,
      );
    } catch (err) {
      throw new Error(
        `Home Assistant 连接失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // 启动定时轮询
    state.pollTimer = setInterval(() => {
      this.pollOnce(state, false).catch((err) => {
        logger.iot?.warn(`[HAAdapter] Provider ${provider.id} 轮询失败:`, err);
        callbacks.onError(err instanceof Error ? err : new Error(String(err)));
      });
    }, state.pollIntervalMs);

    return {
      providerId: provider.id,
      disconnect: async () => this.disconnect(state),
      isConnected: () => !state.disconnected,
    };
  }

  async testConnection(provider: IoTProviderSummary): Promise<{
    success: boolean;
    latencyMs?: number;
    message: string;
  }> {
    // 阶段7：WebSocket 模式下使用 WS 适配器测试
    if (this.shouldUseWebSocket(provider)) {
      return homeAssistantWebSocketAdapter.testConnection(provider);
    }

    const { baseUrl, token } = this.parseAuthConfig(provider);
    const url = `${baseUrl}/api/`;

    const start = Date.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        TEST_CONNECTION_TIMEOUT_MS,
      );

      const res = await fetch(url, {
        method: 'GET',
        headers: this.buildHeaders(token),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const latencyMs = Date.now() - start;

      if (res.ok) {
        return {
          success: true,
          latencyMs,
          message: 'Home Assistant 连接成功',
        };
      }
      if (res.status === 401) {
        return {
          success: false,
          latencyMs,
          message: 'Token 无效或已过期（401 Unauthorized）',
        };
      }
      return {
        success: false,
        latencyMs,
        message: `HTTP ${res.status} ${res.statusText}`,
      };
    } catch (err) {
      return {
        success: false,
        latencyMs: Date.now() - start,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // ============================================================
  // 内部方法
  // ============================================================

  /**
   * 判断是否应使用 WebSocket 模式（阶段7新增）
   *
   * 用户在 authConfig 中设置 `useWebSocket: true` 可启用 WebSocket 实时订阅；
   * 未设置或为 false 时，沿用 REST 轮询模式（保持向后兼容）。
   */
  private shouldUseWebSocket(provider: IoTProviderSummary): boolean {
    return Boolean(provider.authConfig?.useWebSocket);
  }

  /** 解析 authConfig，提取 baseUrl 与 token */
  private parseAuthConfig(
    provider: IoTProviderSummary,
  ): { baseUrl: string; token: string } {
    const endpoint = provider.endpoint.replace(/\/+$/, '');
    if (!endpoint) {
      throw new Error('Home Assistant endpoint 未配置');
    }

    const auth = provider.authConfig || {};
    const token = (auth.token as string) || (auth.longLivedToken as string) || '';

    if (!token) {
      throw new Error('Home Assistant authConfig.token 未配置（需 Long-Lived Access Token）');
    }

    return { baseUrl: endpoint, token };
  }

  /** 构建请求头 */
  private buildHeaders(token: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }

  /** 拉取所有实体状态 */
  private async fetchAllStates(state: AdapterState): Promise<HAState[]> {
    const url = `${state.baseUrl}/api/states`;
    const res = await fetch(url, {
      method: 'GET',
      headers: this.buildHeaders(state.token),
    });

    if (!res.ok) {
      throw new Error(`fetch /api/states 失败: HTTP ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as HAState[];
    if (!Array.isArray(data)) {
      throw new Error('Home Assistant /api/states 返回非数组');
    }

    return data.slice(0, MAX_ENTITIES_PER_FETCH);
  }

  /**
   * 轮询一次
   *
   * @param state 适配器状态
   * @param isInitial 是否首次拉取（首次时所有实体都回调 onEntityUpdate）
   */
  private async pollOnce(state: AdapterState, isInitial: boolean): Promise<void> {
    if (state.disconnected) return;

    const states = await this.fetchAllStates(state);

    for (const haState of states) {
      const entityExternalId = haState.entity_id;
      const prev = state.lastStates.get(entityExternalId);
      const curr = haState.state;

      // 非首次且状态未变化则跳过
      if (!isInitial && prev === curr) continue;

      state.lastStates.set(entityExternalId, curr);

      const entityType = this.parseEntityType(entityExternalId);
      const numericValue = this.tryParseNumeric(curr);
      const unit = this.extractUnit(haState);

      // 数值型 sensor 触发 reading
      if (entityType === 'sensor' && numericValue !== null) {
        state.callbacks.onReading({
          entityId: '', // Bridge 会通过 externalId 查找内部 ID
          externalId: entityExternalId,
          value: numericValue,
          unit: unit || undefined,
          timestamp: Date.now(),
        });
      }

      // 所有变化触发 entityUpdate
      const event: EntityUpdateEvent = {
        providerId: state.providerId,
        entityId: '', // Bridge 会通过 externalId 查找
        externalId: entityExternalId,
        entityType,
        state: numericValue ?? curr,
        attributes: haState.attributes || {},
        timestamp: Date.now(),
      };
      state.callbacks.onEntityUpdate(event);
    }
  }

  /** 从 entity_id 解析实体类型（如 sensor.temperature → sensor） */
  private parseEntityType(entityId: string): IoTEntityType {
    const domain = entityId.split('.')[0] || '';
    return DOMAIN_TO_ENTITY_TYPE[domain] || 'unknown';
  }

  /** 尝试解析数值 */
  private tryParseNumeric(state: string): number | null {
    if (state === 'unavailable' || state === 'unknown' || state === 'none') {
      return null;
    }
    const num = Number(state);
    return Number.isFinite(num) ? num : null;
  }

  /** 从 attributes 提取单位 */
  private extractUnit(haState: HAState): string | null {
    const unit = haState.attributes?.unit_of_measurement;
    return typeof unit === 'string' ? unit : null;
  }

  /** 断开连接 */
  private async disconnect(state: AdapterState): Promise<void> {
    if (state.disconnected) return;
    state.disconnected = true;

    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }

    state.lastStates.clear();

    logger.iot?.info(
      `[HAAdapter] Provider ${state.providerId} 已断开`,
    );
  }
}

// 默认导出单例（IoTBridge 自动注册）
export const homeAssistantAdapter = new HomeAssistantAdapter();
