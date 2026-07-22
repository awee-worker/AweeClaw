/**
 * Home Assistant WebSocket 实时订阅适配器（阶段7新增）
 *
 * 通过 Home Assistant WebSocket API 实时订阅实体状态变更：
 * 1. 连接 ws(s)://<ha-url>/api/websocket
 * 2. 完成 auth 握手（access_token）
 * 3. 调用 get_states 获取所有实体初始状态
 * 4. subscribe_events 订阅 state_changed 事件，实时推送变更
 * 5. 心跳保活（每 30s 发送 ping）
 * 6. 断线自动重连（指数退避，最长 60s）
 *
 * 相较于 HomeAssistantAdapter（REST 轮询）：
 * - 实时性更高（毫秒级 vs 轮询间隔）
 * - 网络开销更低（仅状态变更才传输）
 * - 服务端推送，无需客户端主动拉取
 *
 * 认证方式：Bearer Token（authConfig.token 或 authConfig.longLivedToken）
 *
 * 参考：https://developers.home-assistant.io/docs/api/websocket/
 *
 * @module iot/adapters/HomeAssistantWebSocketAdapter
 */

import WebSocket from 'ws';
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

/** 心跳间隔（ms） */
const HEARTBEAT_INTERVAL_MS = 30 * 1000;

/** 心跳超时（ms，超过此时间未收到 pong 则认为连接已死） */
const HEARTBEAT_TIMEOUT_MS = 10 * 1000;

/** 初始连接超时（ms） */
const CONNECT_TIMEOUT_MS = 10 * 1000;

/** 认证超时（ms） */
const AUTH_TIMEOUT_MS = 8 * 1000;

/** 命令响应超时（ms） */
const COMMAND_TIMEOUT_MS = 15 * 1000;

/** 最大重连间隔（ms） */
const MAX_RECONNECT_INTERVAL_MS = 60 * 1000;

/** 单次拉取实体上限（HA 通常 < 2000） */
const MAX_ENTITIES_PER_FETCH = 5000;

/** 连接测试超时（ms） */
const TEST_CONNECTION_TIMEOUT_MS = 8000;

// ============================================================
// 类型定义
// ============================================================

/** HA State 响应体（get_states / state_changed.new_state 共用） */
interface HAState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
  last_updated: string;
}

/** HA WebSocket 消息类型 */
type HAMessage =
  | { type: 'auth_required'; ha_version: string }
  | { type: 'auth_ok'; ha_version: string }
  | { type: 'auth_invalid'; message: string }
  | {
      type: 'result';
      id: number;
      success: boolean;
      result?: unknown;
      error?: { code: string; message: string };
    }
  | {
      type: 'event';
      id: number;
      event: {
        event_type: string;
        data: {
          entity_id: string;
          new_state: HAState | null;
          old_state: HAState | null;
        };
        time_fired: string;
      };
    }
  | { type: 'pong'; id: number }
  | { type: string; [key: string]: unknown };

/** HA WebSocket 事件消息（仅 type === 'event'） */
type HAEventMessage = Extract<HAMessage, { type: 'event' }>;

/** 待处理命令的 Promise 句柄 */
interface PendingCommand {
  resolve: (msg: HAMessage) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

/** 适配器内部状态 */
interface AdapterState {
  providerId: string;
  wsUrl: string;
  token: string;
  /** WebSocket 实例 */
  ws: WebSocket | null;
  /** 下一条命令的 ID（自增） */
  nextCommandId: number;
  /** 待处理的命令（id → PendingCommand） */
  pendingCommands: Map<number, PendingCommand>;
  /** state_changed 订阅 ID（用于解订阅） */
  stateChangedSubscriptionId: number | null;
  /** 实体最近状态快照（entity_id → state 字符串） */
  lastStates: Map<string, string>;
  /** 心跳定时器 */
  heartbeatTimer: NodeJS.Timeout | null;
  /** 心跳超时定时器 */
  heartbeatTimeoutTimer: NodeJS.Timeout | null;
  /** 重连定时器 */
  reconnectTimer: NodeJS.Timeout | null;
  /** 当前重连间隔（指数退避） */
  reconnectIntervalMs: number;
  /** 是否主动断开（不再重连） */
  manuallyDisconnected: boolean;
  /** 是否已完成首次订阅 */
  subscribed: boolean;
  /** 上报回调 */
  callbacks: AdapterCallbacks;
}

// ============================================================
// HomeAssistantWebSocketAdapter 实现
// ============================================================

export class HomeAssistantWebSocketAdapter
  implements IoTProtocolAdapter
{
  readonly protocol: IoTProtocol = PROTOCOL;

  async connect(
    provider: IoTProviderSummary,
    callbacks: AdapterCallbacks,
  ): Promise<AdapterHandle> {
    const { wsUrl, token } = this.parseAuthConfig(provider);

    const state: AdapterState = {
      providerId: provider.id,
      wsUrl,
      token,
      ws: null,
      nextCommandId: 1,
      pendingCommands: new Map(),
      stateChangedSubscriptionId: null,
      lastStates: new Map(),
      heartbeatTimer: null,
      heartbeatTimeoutTimer: null,
      reconnectTimer: null,
      reconnectIntervalMs: 1000,
      manuallyDisconnected: false,
      subscribed: false,
      callbacks,
    };

    // 首次连接（同步等待 subscribe 完成才返回 handle）
    try {
      await this.openConnection(state);
      await this.authenticate(state);
      await this.fetchInitialStates(state);
      await this.subscribeStateChanged(state);
      this.startHeartbeat(state);
      logger.iot?.info(
        `[HAWsAdapter] Provider ${provider.id} WebSocket 连接成功，初始实体 ${state.lastStates.size} 个`,
      );
    } catch (err) {
      // 清理已分配资源
      this.cleanup(state);
      throw new Error(
        `Home Assistant WebSocket 连接失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return {
      providerId: provider.id,
      disconnect: async () => this.disconnect(state),
      isConnected: () =>
        !state.manuallyDisconnected &&
        state.ws !== null &&
        state.ws.readyState === WebSocket.OPEN,
    };
  }

  async testConnection(provider: IoTProviderSummary): Promise<{
    success: boolean;
    latencyMs?: number;
    message: string;
  }> {
    const { wsUrl, token } = this.parseAuthConfig(provider);
    const start = Date.now();

    return new Promise((resolve) => {
      let settled = false;
      const cleanup = () => {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.close();
          } catch {
            /* ignore */
          }
        }
      };

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({
          success: false,
          latencyMs: Date.now() - start,
          message: '连接超时',
        });
      }, TEST_CONNECTION_TIMEOUT_MS);

      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl);
      } catch (err) {
        clearTimeout(timeout);
        resolve({
          success: false,
          latencyMs: Date.now() - start,
          message: err instanceof Error ? err.message : String(err),
        });
        return;
      }

      ws.on('open', () => {
        // 等待 auth_required
      });

      ws.on('message', (data: Buffer | string) => {
        if (settled) return;
        let msg: HAMessage;
        try {
          msg = JSON.parse(
            typeof data === 'string' ? data : data.toString('utf8'),
          ) as HAMessage;
        } catch {
          return;
        }
        if (msg.type === 'auth_required') {
          try {
            ws.send(JSON.stringify({ type: 'auth', access_token: token }));
          } catch {
            /* ignore */
          }
        } else if (msg.type === 'auth_ok') {
          settled = true;
          clearTimeout(timeout);
          const latencyMs = Date.now() - start;
          cleanup();
          resolve({
            success: true,
            latencyMs,
            message: 'Home Assistant WebSocket 连接成功',
          });
        } else if (msg.type === 'auth_invalid') {
          settled = true;
          clearTimeout(timeout);
          cleanup();
          resolve({
            success: false,
            latencyMs: Date.now() - start,
            message:
              (msg as { message?: string }).message ||
              'Token 无效或已过期（auth_invalid）',
          });
        }
      });

      ws.on('error', (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        cleanup();
        resolve({
          success: false,
          latencyMs: Date.now() - start,
          message: err.message,
        });
      });
    });
  }

  // ============================================================
  // 内部方法 - 连接管理
  // ============================================================

  /** 解析 authConfig，提取 wsUrl 与 token */
  private parseAuthConfig(
    provider: IoTProviderSummary,
  ): { wsUrl: string; token: string } {
    const endpoint = provider.endpoint.replace(/\/+$/, '');
    if (!endpoint) {
      throw new Error('Home Assistant endpoint 未配置');
    }

    // 将 http(s):// 转换为 ws(s)://，并附加 /api/websocket
    const wsUrl = endpoint
      .replace(/^http:\/\//i, 'ws://')
      .replace(/^https:\/\//i, 'wss://')
      .concat('/api/websocket');

    const auth = provider.authConfig || {};
    const token =
      (auth.token as string) ||
      (auth.longLivedToken as string) ||
      (auth.accessToken as string) ||
      '';

    if (!token) {
      throw new Error(
        'Home Assistant authConfig.token 未配置（需 Long-Lived Access Token）',
      );
    }

    return { wsUrl, token };
  }

  /** 打开 WebSocket 连接 */
  private openConnection(state: AdapterState): Promise<void> {
    return new Promise((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(state.wsUrl);
      } catch (err) {
        reject(
          err instanceof Error
            ? err
            : new Error(`WebSocket 创建失败: ${String(err)}`),
        );
        return;
      }

      const connectTimeout = setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          try {
            ws.close();
          } catch {
            /* ignore */
          }
          reject(new Error(`WebSocket 连接超时（${CONNECT_TIMEOUT_MS}ms）`));
        }
      }, CONNECT_TIMEOUT_MS);

      ws.on('open', () => {
        clearTimeout(connectTimeout);
        state.ws = ws;
        this.attachMessageHandler(state);
        this.attachErrorHandler(state);
        this.attachCloseHandler(state);
        resolve();
      });

      ws.on('error', (err: Error) => {
        clearTimeout(connectTimeout);
        reject(err);
      });
    });
  }

  /** 完成 auth 握手 */
  private authenticate(state: AdapterState): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!state.ws) {
        reject(new Error('WebSocket 未连接'));
        return;
      }

      const ws = state.ws;
      const authTimeout = setTimeout(() => {
        reject(new Error(`WebSocket 认证超时（${AUTH_TIMEOUT_MS}ms）`));
      }, AUTH_TIMEOUT_MS);

      const onMessage = (data: Buffer | string) => {
        let msg: HAMessage;
        try {
          msg = JSON.parse(
            typeof data === 'string' ? data : data.toString('utf8'),
          ) as HAMessage;
        } catch {
          return;
        }
        if (msg.type === 'auth_required') {
          try {
            ws.send(
              JSON.stringify({ type: 'auth', access_token: state.token }),
            );
          } catch (err) {
            clearTimeout(authTimeout);
            ws.off('message', onMessage);
            reject(
              err instanceof Error
                ? err
                : new Error('发送 auth 消息失败'),
            );
          }
        } else if (msg.type === 'auth_ok') {
          clearTimeout(authTimeout);
          ws.off('message', onMessage);
          resolve();
        } else if (msg.type === 'auth_invalid') {
          clearTimeout(authTimeout);
          ws.off('message', onMessage);
          reject(
            new Error(
              (msg as { message?: string }).message ||
                'Token 无效或已过期（auth_invalid）',
            ),
          );
        }
      };

      ws.on('message', onMessage);
    });
  }

  /** 挂载通用消息处理器（认证后使用） */
  private attachMessageHandler(state: AdapterState): void {
    if (!state.ws) return;
    state.ws.on('message', (data: Buffer | string) => {
      let msg: HAMessage;
      try {
        msg = JSON.parse(
          typeof data === 'string' ? data : data.toString('utf8'),
        ) as HAMessage;
      } catch {
        logger.iot?.warn(
          `[HAWsAdapter] Provider ${state.providerId} 收到非 JSON 消息，忽略`,
        );
        return;
      }

      // 1. 命令响应（type === 'result'）
      if (msg.type === 'result' && typeof msg.id === 'number') {
        const pending = state.pendingCommands.get(msg.id);
        if (pending) {
          clearTimeout(pending.timer);
          state.pendingCommands.delete(msg.id);
          pending.resolve(msg);
        }
        return;
      }

      // 2. 心跳 pong
      if (msg.type === 'pong' && typeof msg.id === 'number') {
        const pending = state.pendingCommands.get(msg.id);
        if (pending) {
          clearTimeout(pending.timer);
          state.pendingCommands.delete(msg.id);
          pending.resolve(msg);
        }
        return;
      }

      // 3. 事件（type === 'event'）
      if (msg.type === 'event' && typeof msg.id === 'number') {
        // state_changed 订阅事件
        if (
          state.stateChangedSubscriptionId !== null &&
          msg.id === state.stateChangedSubscriptionId
        ) {
          // 此处 msg 已通过 type === 'event' 与 typeof msg.id === 'number' 双重判断，
          // 但 TypeScript 无法从联合类型中精确收窄（因 fallback 成员 { type: string; [key: string]: unknown } 吸收了所有 type 值），
          // 故使用类型断言将其收窄为 HAEventMessage。
          this.handleStateChangedEvent(state, msg as HAEventMessage);
        }
        return;
      }
    });
  }

  /** 挂载错误处理器 */
  private attachErrorHandler(state: AdapterState): void {
    if (!state.ws) return;
    state.ws.on('error', (err: Error) => {
      logger.iot?.error(
        `[HAWsAdapter] Provider ${state.providerId} WebSocket 错误:`,
        err,
      );
      state.callbacks.onError(err);
    });
  }

  /** 挂载关闭处理器（触发自动重连） */
  private attachCloseHandler(state: AdapterState): void {
    if (!state.ws) return;
    state.ws.on('close', (code: number, reason: Buffer) => {
      const reasonStr = reason.toString('utf8') || `code=${code}`;
      logger.iot?.warn(
        `[HAWsAdapter] Provider ${state.providerId} WebSocket 关闭 (${reasonStr})`,
      );

      // 清理心跳
      this.stopHeartbeat(state);

      // 失败所有待处理命令
      this.failAllPending(state, new Error(`WebSocket 关闭: ${reasonStr}`));

      state.ws = null;
      state.subscribed = false;
      state.stateChangedSubscriptionId = null;

      if (!state.manuallyDisconnected) {
        state.callbacks.onDisconnect(reasonStr);
        this.scheduleReconnect(state);
      }
    });
  }

  /** 拉取所有实体初始状态 */
  private async fetchInitialStates(state: AdapterState): Promise<void> {
    const response = await this.sendCommand<HAState[]>(state, {
      type: 'get_states',
    });

    if (!Array.isArray(response)) {
      throw new Error('get_states 返回非数组');
    }

    const limited = response.slice(0, MAX_ENTITIES_PER_FETCH);
    for (const haState of limited) {
      state.lastStates.set(haState.entity_id, haState.state);
      this.emitEntityUpdate(state, haState);
    }
  }

  /** 订阅 state_changed 事件 */
  private async subscribeStateChanged(state: AdapterState): Promise<void> {
    const cmdId = state.nextCommandId;
    const response = await this.sendCommand<{ id?: number }>(state, {
      type: 'subscribe_events',
      event_type: 'state_changed',
    });

    // HA 返回 { result: null, success: true } 确认订阅，事件使用同一 id
    state.stateChangedSubscriptionId = cmdId;
    state.subscribed = true;
    void response; // 显式标记 response 已使用
  }

  /**
   * 发送命令并等待 result 响应
   *
   * @param state 适配器状态
   * @param cmd 命令体（不含 id，由本方法自动填充）
   */
  private sendCommand<T = unknown>(
    state: AdapterState,
    cmd: { type: string } & Record<string, unknown>,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket 未连接'));
        return;
      }

      const id = state.nextCommandId++;
      const fullCmd = { ...cmd, id };

      const timer = setTimeout(() => {
        state.pendingCommands.delete(id);
        reject(
          new Error(
            `命令 ${cmd.type} (id=${id}) 响应超时（${COMMAND_TIMEOUT_MS}ms）`,
          ),
        );
      }, COMMAND_TIMEOUT_MS);

      state.pendingCommands.set(id, {
        resolve: (msg: HAMessage) => {
          // 显式判断 result 类型（联合类型中 fallback 成员 { type: string; [key: string]: unknown }
          // 会与 result 类型同时匹配 msg.type === 'result'，故使用显式断言）
          if (msg.type === 'result') {
            const resultMsg = msg as Extract<
              HAMessage,
              { type: 'result' }
            >;
            if (resultMsg.success) {
              resolve(resultMsg.result as T);
            } else {
              reject(
                new Error(
                  `命令 ${cmd.type} 失败: ${resultMsg.error?.message || '未知错误'}`,
                ),
              );
            }
          } else {
            // pong 等
            resolve(undefined as T);
          }
        },
        reject,
        timer,
      });

      try {
        state.ws.send(JSON.stringify(fullCmd));
      } catch (err) {
        clearTimeout(timer);
        state.pendingCommands.delete(id);
        reject(
          err instanceof Error
            ? err
            : new Error(`发送命令 ${cmd.type} 失败`),
        );
      }
    });
  }

  // ============================================================
  // 内部方法 - 事件处理
  // ============================================================

  /** 处理 state_changed 事件 */
  private handleStateChangedEvent(
    state: AdapterState,
    msg: Extract<HAMessage, { type: 'event' }>,
  ): void {
    const new_state = msg.event.data.new_state;
    if (!new_state) {
      // 实体被删除（new_state === null）
      state.lastStates.delete(msg.event.data.entity_id);
      return;
    }

    const prev = state.lastStates.get(new_state.entity_id);
    state.lastStates.set(new_state.entity_id, new_state.state);

    // 仅在状态变化时触发（HA 可能因 last_updated 变化而推送但 state 不变）
    if (prev === new_state.state) return;

    this.emitEntityUpdate(state, new_state);
  }

  /** 派发实体更新（含 reading 回调） */
  private emitEntityUpdate(state: AdapterState, haState: HAState): void {
    const entityExternalId = haState.entity_id;
    const entityType = this.parseEntityType(entityExternalId);
    const numericValue = this.tryParseNumeric(haState.state);
    const unit = this.extractUnit(haState);

    // 数值型 sensor 触发 reading
    if (entityType === 'sensor' && numericValue !== null) {
      state.callbacks.onReading({
        entityId: '', // Bridge 通过 externalId 查找内部 ID
        externalId: entityExternalId,
        value: numericValue,
        unit: unit || undefined,
        timestamp: Date.now(),
      });
    }

    // 所有变化触发 entityUpdate
    const event: EntityUpdateEvent = {
      providerId: state.providerId,
      entityId: '',
      externalId: entityExternalId,
      entityType,
      state: numericValue ?? haState.state,
      attributes: haState.attributes || {},
      timestamp: Date.now(),
    };
    state.callbacks.onEntityUpdate(event);
  }

  /** 从 entity_id 解析实体类型 */
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

  // ============================================================
  // 内部方法 - 心跳与重连
  // ============================================================

  /** 启动心跳 */
  private startHeartbeat(state: AdapterState): void {
    this.stopHeartbeat(state);

    state.heartbeatTimer = setInterval(() => {
      if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;

      // 心跳超时检测
      state.heartbeatTimeoutTimer = setTimeout(() => {
        logger.iot?.warn(
          `[HAWsAdapter] Provider ${state.providerId} 心跳超时，强制关闭连接以触发重连`,
        );
        try {
          state.ws?.close();
        } catch {
          /* ignore */
        }
      }, HEARTBEAT_TIMEOUT_MS);

      // 发送 ping（HA 使用 ping/pong 命令）
      this.sendCommand(state, { type: 'ping' })
        .then(() => {
          if (state.heartbeatTimeoutTimer) {
            clearTimeout(state.heartbeatTimeoutTimer);
            state.heartbeatTimeoutTimer = null;
          }
        })
        .catch(() => {
          if (state.heartbeatTimeoutTimer) {
            clearTimeout(state.heartbeatTimeoutTimer);
            state.heartbeatTimeoutTimer = null;
          }
        });
    }, HEARTBEAT_INTERVAL_MS);
  }

  /** 停止心跳 */
  private stopHeartbeat(state: AdapterState): void {
    if (state.heartbeatTimer) {
      clearInterval(state.heartbeatTimer);
      state.heartbeatTimer = null;
    }
    if (state.heartbeatTimeoutTimer) {
      clearTimeout(state.heartbeatTimeoutTimer);
      state.heartbeatTimeoutTimer = null;
    }
  }

  /** 调度重连（指数退避） */
  private scheduleReconnect(state: AdapterState): void {
    if (state.manuallyDisconnected) return;
    if (state.reconnectTimer) return; // 已在等待重连

    const delay = state.reconnectIntervalMs;
    state.reconnectIntervalMs = Math.min(
      state.reconnectIntervalMs * 2,
      MAX_RECONNECT_INTERVAL_MS,
    );

    logger.iot?.info(
      `[HAWsAdapter] Provider ${state.providerId} 将在 ${delay}ms 后重连`,
    );

    state.reconnectTimer = setTimeout(() => {
      state.reconnectTimer = null;
      void this.reconnect(state);
    }, delay);
  }

  /** 执行重连 */
  private async reconnect(state: AdapterState): Promise<void> {
    if (state.manuallyDisconnected) return;

    logger.iot?.info(
      `[HAWsAdapter] Provider ${state.providerId} 开始重连`,
    );

    try {
      // 清理旧的 ws（如有）
      if (state.ws) {
        try {
          state.ws.close();
        } catch {
          /* ignore */
        }
        state.ws = null;
      }

      await this.openConnection(state);
      await this.authenticate(state);
      await this.fetchInitialStates(state);
      await this.subscribeStateChanged(state);
      this.startHeartbeat(state);

      // 重连成功，重置退避
      state.reconnectIntervalMs = 1000;
      logger.iot?.info(
        `[HAWsAdapter] Provider ${state.providerId} 重连成功，当前实体 ${state.lastStates.size} 个`,
      );
    } catch (err) {
      logger.iot?.warn(
        `[HAWsAdapter] Provider ${state.providerId} 重连失败:`,
        err,
      );
      // 继续重试
      this.scheduleReconnect(state);
    }
  }

  /** 失败所有待处理命令 */
  private failAllPending(state: AdapterState, err: Error): void {
    for (const [id, pending] of state.pendingCommands) {
      clearTimeout(pending.timer);
      pending.reject(err);
      state.pendingCommands.delete(id);
    }
  }

  // ============================================================
  // 内部方法 - 资源清理与断开
  // ============================================================

  /** 清理所有资源（不触发重连） */
  private cleanup(state: AdapterState): void {
    state.manuallyDisconnected = true;

    this.stopHeartbeat(state);

    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }

    this.failAllPending(state, new Error('适配器已清理'));

    if (state.ws) {
      try {
        state.ws.removeAllListeners();
        if (state.ws.readyState === WebSocket.OPEN) {
          state.ws.close();
        }
      } catch {
        /* ignore */
      }
      state.ws = null;
    }

    state.lastStates.clear();
    state.subscribed = false;
    state.stateChangedSubscriptionId = null;
  }

  /** 主动断开连接 */
  private async disconnect(state: AdapterState): Promise<void> {
    if (state.manuallyDisconnected) return;
    logger.iot?.info(
      `[HAWsAdapter] Provider ${state.providerId} 主动断开`,
    );
    this.cleanup(state);
  }
}

// 默认导出单例（IoTBridge 自动注册，覆盖 REST 适配器以提供实时订阅）
export const homeAssistantWebSocketAdapter =
  new HomeAssistantWebSocketAdapter();
