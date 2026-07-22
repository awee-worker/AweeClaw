/**
 * MQTT 协议适配器 — 阶段9 s9-10 真实 MQTT broker 接入
 *
 * 支持的协议：
 * - mqtt://  原生 MQTT over TCP（默认端口 1883）
 * - mqtts:// 原生 MQTT over TLS（默认端口 8883，需配置 ca/cert/key）
 * - ws://    MQTT over WebSocket（默认端口 8083）
 * - wss://   MQTT over WebSocket Secure（默认端口 8084）
 *
 * 功能：
 * 1. 连接 MQTT broker（支持 TCP/TLS/WebSocket 四种传输）
 * 2. 订阅配置的主题（支持 QoS 0/1/2）
 * 3. 解析消息 payload 为数值/字符串
 * 4. 数值型消息回调 onReading，所有消息回调 onEntityUpdate
 * 5. 发布消息到指定主题（publish 方法，支持 QoS 0/1/2 和 retain）
 * 6. LWT（Last Will and Testament）支持：连接异常断开时通知其他客户端
 * 7. TLS 证书配置：authConfig.ca / cert / key
 * 8. keepalive 心跳：防止长时间空闲被中间设备断开
 * 9. 可配置重连：reconnectPeriod > 0 时自动重连
 * 10. $SYS 主题订阅：可选监控 broker 状态
 *
 * 认证方式：authConfig.username + authConfig.password（可选）
 *
 * authConfig 字段：
 * - username: string          用户名
 * - password: string          密码
 * - topics: string[]          订阅主题列表（默认 ['#']）
 * - qos: 0 | 1 | 2            订阅 QoS 等级（默认 0）
 * - keepalive: number         心跳间隔秒数（默认 60）
 * - reconnectPeriod: number   重连间隔毫秒（默认 0，由 IoTBridge 统一处理）
 * - lastWill: { topic, payload, qos, retain }  遗嘱消息
 * - ca: string                CA 证书（PEM 格式）
 * - cert: string              客户端证书（PEM 格式）
 * - key: string               客户端私钥（PEM 格式）
 * - rejectUnauthorized: boolean  是否验证服务器证书（默认 true）
 * - subscribeSys: boolean     是否订阅 $SYS/# 获取 broker 状态（默认 false）
 *
 * 依赖：mqtt npm 包（客户端主进程原生 require）
 *
 * @module iot/adapters/MqttAdapter
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

// ============================================================
// 常量
// ============================================================

const PROTOCOL: IoTProtocol = 'mqtt';

/** 默认订阅主题（# 匹配所有） */
const DEFAULT_TOPIC = '#';

/** 默认 QoS 等级 */
const DEFAULT_QOS = 0;

/** 默认 keepalive（秒） */
const DEFAULT_KEEPALIVE_SEC = 60;

/** 连接测试超时（ms） */
const TEST_CONNECTION_TIMEOUT_MS = 8000;

/** 最大订阅主题数 */
const MAX_TOPICS = 50;

/** 支持的协议前缀 */
const SUPPORTED_PROTOCOLS = ['mqtt:', 'mqtts:', 'ws:', 'wss:'] as const;

// ============================================================
// 类型定义
// ============================================================

/** 遗嘱消息配置 */
interface LastWillConfig {
  topic: string;
  payload: string | Buffer;
  qos?: 0 | 1 | 2;
  retain?: boolean;
}

/** MQTT 适配器内部状态 */
interface MqttAdapterState {
  providerId: string;
  url: string;
  username?: string;
  password?: string;
  topics: string[];
  qos: 0 | 1 | 2;
  subscribeSys: boolean;
  /** mqtt.js client 实例 */
  client: MqttClientLike | null;
  /** 是否已主动断开 */
  disconnected: boolean;
  /** 上报回调 */
  callbacks: AdapterCallbacks;
  /** 已发布的消息计数 */
  publishedCount: number;
  /** 已接收的消息计数 */
  receivedCount: number;
}

/** mqtt.js client 最小接口（避免直接 import 类型） */
interface MqttClientLike {
  on(event: string, listener: (...args: unknown[]) => void): void;
  end(force?: boolean): void;
  subscribe(
    topic: string | string[],
    options?: Record<string, unknown>,
    callback?: (err: Error | null) => void,
  ): void;
  unsubscribe(topic: string | string[]): void;
  publish(
    topic: string,
    message: string | Buffer,
    options?: Record<string, unknown>,
    callback?: (err: Error | null) => void,
  ): void;
  connected: boolean;
}

/** mqtt.js 模块最小接口 */
interface MqttModule {
  connect(
    url: string,
    options?: Record<string, unknown>,
  ): MqttClientLike;
}

// ============================================================
// MqttAdapter 实现
// ============================================================

export class MqttAdapter implements IoTProtocolAdapter {
  readonly protocol: IoTProtocol = PROTOCOL;

  /** 懒加载 mqtt 模块 */
  private mqttModule: MqttModule | null = null;

  async connect(
    provider: IoTProviderSummary,
    callbacks: AdapterCallbacks,
  ): Promise<AdapterHandle> {
    const config = this.parseAuthConfig(provider);
    const { url, username, password, topics, qos, keepalive, reconnectPeriod, lastWill, tlsOptions, subscribeSys } = config;

    // 懒加载 mqtt 模块
    const mqtt = this.loadMqttModule();

    const state: MqttAdapterState = {
      providerId: provider.id,
      url,
      username,
      password,
      topics,
      qos,
      subscribeSys,
      client: null,
      disconnected: false,
      callbacks,
      publishedCount: 0,
      receivedCount: 0,
    };

    // 构建连接选项
    const options: Record<string, unknown> = {
      clean: true,
      connectTimeout: TEST_CONNECTION_TIMEOUT_MS,
      reconnectPeriod, // 0 表示禁用自动重连，由 IoTBridge 统一处理
      keepalive,
      // 协议版本（mqtt.js 默认 4 = MQTT 3.1.1）
      protocolVersion: 4,
    };

    if (username) options.username = username;
    if (password) options.password = password;

    // LWT（Last Will and Testament）
    if (lastWill) {
      options.will = {
        topic: lastWill.topic,
        payload: lastWill.payload,
        qos: lastWill.qos ?? 0,
        retain: lastWill.retain ?? false,
      };
    }

    // TLS 选项（mqtts:// 或 wss://）
    if (tlsOptions) {
      options.ca = tlsOptions.ca ? [Buffer.from(tlsOptions.ca)] : undefined;
      options.cert = tlsOptions.cert ? Buffer.from(tlsOptions.cert) : undefined;
      options.key = tlsOptions.key ? Buffer.from(tlsOptions.key) : undefined;
      options.rejectUnauthorized = tlsOptions.rejectUnauthorized ?? true;
    }

    return new Promise<AdapterHandle>((resolve, reject) => {
      const client = mqtt.connect(url, options);
      state.client = client;

      const connectTimeout = setTimeout(() => {
        if (state.client) {
          state.client.end(true);
        }
        reject(new Error(`MQTT 连接超时（${TEST_CONNECTION_TIMEOUT_MS}ms）`));
      }, TEST_CONNECTION_TIMEOUT_MS + 2000);

      client.on('connect', () => {
        clearTimeout(connectTimeout);
        logger.iot?.info(
          `[MqttAdapter] Provider ${provider.id} 连接成功，订阅 ${topics.length} 个主题 (QoS=${qos})`,
        );

        // 订阅主题
        const subscribeTopics = subscribeSys ? [...topics, '$SYS/#'] : topics;
        client.subscribe(
          subscribeTopics,
          { qos },
          (err: Error | null) => {
            if (err) {
              logger.iot?.warn(
                `[MqttAdapter] Provider ${provider.id} 订阅失败:`,
                err.message,
              );
              callbacks.onError(err);
            } else {
              logger.iot?.info(
                `[MqttAdapter] Provider ${provider.id} 订阅成功: ${subscribeTopics.join(', ')}`,
              );
            }
          },
        );

        resolve({
          providerId: provider.id,
          disconnect: async () => this.disconnect(state),
          isConnected: () => !state.disconnected && client.connected,
          publish: async (
            topic: string,
            payload: string | Buffer,
            pubOptions?: { qos?: 0 | 1 | 2; retain?: boolean },
          ) => this.publish(state, topic, payload, pubOptions),
        });
      });

      client.on('message', (topic: unknown, payload: unknown) => {
        this.handleMessage(state, topic as string, payload as Buffer);
      });

      client.on('error', (err: unknown) => {
        clearTimeout(connectTimeout);
        const error = err instanceof Error ? err : new Error(String(err));
        logger.iot?.warn(
          `[MqttAdapter] Provider ${provider.id} 错误:`,
          error.message,
        );
        callbacks.onError(error);
      });

      client.on('close', () => {
        logger.iot?.info(
          `[MqttAdapter] Provider ${provider.id} 连接关闭 (published=${state.publishedCount}, received=${state.receivedCount})`,
        );
        if (!state.disconnected) {
          callbacks.onDisconnect('MQTT 连接已关闭');
        }
      });

      client.on('offline', () => {
        logger.iot?.warn(
          `[MqttAdapter] Provider ${provider.id} 离线`,
        );
      });

      client.on('reconnect', () => {
        logger.iot?.info(
          `[MqttAdapter] Provider ${provider.id} 正在重连...`,
        );
      });
    });
  }

  async testConnection(provider: IoTProviderSummary): Promise<{
    success: boolean;
    latencyMs?: number;
    message: string;
  }> {
    const config = this.parseAuthConfig(provider);
    const { url, username, password, keepalive, lastWill, tlsOptions } = config;

    let mqtt: MqttModule;
    try {
      mqtt = this.loadMqttModule();
    } catch (err) {
      return {
        success: false,
        message: `mqtt 模块加载失败: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const start = Date.now();
    return new Promise((resolve) => {
      const options: Record<string, unknown> = {
        clean: true,
        connectTimeout: TEST_CONNECTION_TIMEOUT_MS,
        reconnectPeriod: 0,
        keepalive,
        protocolVersion: 4,
      };
      if (username) options.username = username;
      if (password) options.password = password;
      if (lastWill) {
        options.will = {
          topic: lastWill.topic,
          payload: lastWill.payload,
          qos: lastWill.qos ?? 0,
          retain: lastWill.retain ?? false,
        };
      }
      if (tlsOptions) {
        options.ca = tlsOptions.ca ? [Buffer.from(tlsOptions.ca)] : undefined;
        options.cert = tlsOptions.cert ? Buffer.from(tlsOptions.cert) : undefined;
        options.key = tlsOptions.key ? Buffer.from(tlsOptions.key) : undefined;
        options.rejectUnauthorized = tlsOptions.rejectUnauthorized ?? true;
      }

      const client = mqtt.connect(url, options);
      let settled = false;

      const cleanup = () => {
        if (!settled) {
          settled = true;
          client.end(true);
        }
      };

      const timeout = setTimeout(() => {
        cleanup();
        resolve({
          success: false,
          latencyMs: Date.now() - start,
          message: 'MQTT 连接超时',
        });
      }, TEST_CONNECTION_TIMEOUT_MS + 1000);

      client.on('connect', () => {
        clearTimeout(timeout);
        const latencyMs = Date.now() - start;
        cleanup();
        resolve({
          success: true,
          latencyMs,
          message: 'MQTT 连接成功',
        });
      });

      client.on('error', (err: unknown) => {
        clearTimeout(timeout);
        cleanup();
        resolve({
          success: false,
          latencyMs: Date.now() - start,
          message: err instanceof Error ? err.message : String(err),
        });
      });
    });
  }

  // ============================================================
  // 内部方法
  // ============================================================

  /** 解析 authConfig（阶段9 s9-10 扩展：支持原生 MQTT + TLS + LWT + keepalive） */
  private parseAuthConfig(provider: IoTProviderSummary): {
    url: string;
    username?: string;
    password?: string;
    topics: string[];
    qos: 0 | 1 | 2;
    keepalive: number;
    reconnectPeriod: number;
    lastWill?: LastWillConfig;
    tlsOptions?: {
      ca?: string;
      cert?: string;
      key?: string;
      rejectUnauthorized?: boolean;
    };
    subscribeSys: boolean;
  } {
    const endpoint = provider.endpoint;
    if (!endpoint) {
      throw new Error('MQTT endpoint 未配置（需 mqtt:// / mqtts:// / ws:// / wss:// URL）');
    }

    // 协议校验（阶段9 s9-10：支持 mqtt:// mqtts:// ws:// wss://）
    const protocolMatch = SUPPORTED_PROTOCOLS.some((p) => endpoint.startsWith(p));
    if (!protocolMatch) {
      throw new Error(
        `MQTT endpoint 必须以 mqtt:// / mqtts:// / ws:// / wss:// 开头，当前: ${endpoint}`,
      );
    }

    const auth = provider.authConfig || {};
    const username = (auth.username as string) || undefined;
    const password = (auth.password as string) || undefined;

    // 解析订阅主题
    let topics: string[] = [];
    const rawTopics = auth.topics;
    if (Array.isArray(rawTopics)) {
      topics = rawTopics
        .filter((t): t is string => typeof t === 'string' && t.length > 0)
        .slice(0, MAX_TOPICS);
    } else if (typeof rawTopics === 'string' && rawTopics.trim()) {
      topics = rawTopics
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t.length > 0)
        .slice(0, MAX_TOPICS);
    }
    if (topics.length === 0) {
      topics = [DEFAULT_TOPIC];
    }

    // QoS（0/1/2，默认 0）
    const rawQos = auth.qos;
    let qos: 0 | 1 | 2 = DEFAULT_QOS;
    if (rawQos === 1 || rawQos === 2) {
      qos = rawQos;
    }

    // keepalive（秒，默认 60）
    const rawKeepalive = typeof auth.keepalive === 'number' ? auth.keepalive : undefined;
    const keepalive = rawKeepalive && rawKeepalive > 0 ? rawKeepalive : DEFAULT_KEEPALIVE_SEC;

    // 重连间隔（毫秒，默认 0 = 禁用，由 IoTBridge 统一处理）
    const rawReconnect = typeof auth.reconnectPeriod === 'number' ? auth.reconnectPeriod : undefined;
    const reconnectPeriod = rawReconnect && rawReconnect >= 0 ? rawReconnect : 0;

    // LWT 遗嘱消息
    let lastWill: LastWillConfig | undefined;
    const rawWill = auth.lastWill;
    if (rawWill && typeof rawWill === 'object') {
      const will = rawWill as Record<string, unknown>;
      if (typeof will.topic === 'string' && will.topic.length > 0) {
        lastWill = {
          topic: will.topic,
          payload: typeof will.payload === 'string' ? will.payload : JSON.stringify(will.payload ?? ''),
          qos: will.qos === 1 || will.qos === 2 ? will.qos : 0,
          retain: typeof will.retain === 'boolean' ? will.retain : false,
        };
      }
    }

    // TLS 选项（ca/cert/key）
    let tlsOptions: {
      ca?: string;
      cert?: string;
      key?: string;
      rejectUnauthorized?: boolean;
    } | undefined;
    const ca = typeof auth.ca === 'string' ? auth.ca : undefined;
    const cert = typeof auth.cert === 'string' ? auth.cert : undefined;
    const key = typeof auth.key === 'string' ? auth.key : undefined;
    const rejectUnauthorized = typeof auth.rejectUnauthorized === 'boolean' ? auth.rejectUnauthorized : undefined;
    if (ca || cert || key || rejectUnauthorized !== undefined) {
      tlsOptions = { ca, cert, key, rejectUnauthorized };
    }

    // 是否订阅 $SYS 主题
    const subscribeSys = typeof auth.subscribeSys === 'boolean' ? auth.subscribeSys : false;

    return {
      url: endpoint,
      username,
      password,
      topics,
      qos,
      keepalive,
      reconnectPeriod,
      lastWill,
      tlsOptions,
      subscribeSys,
    };
  }

  /** 懒加载 mqtt 模块 */
  private loadMqttModule(): MqttModule {
    if (this.mqttModule) return this.mqttModule;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      this.mqttModule = require('mqtt') as MqttModule;
      return this.mqttModule;
    } catch (err) {
      throw new Error(
        `mqtt 模块未安装，请运行 npm install mqtt。错误: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** 处理收到的 MQTT 消息 */
  private handleMessage(
    state: MqttAdapterState,
    topic: string,
    payload: Buffer,
  ): void {
    if (state.disconnected) return;

    state.receivedCount += 1;
    const payloadStr = payload.toString('utf-8');
    const externalId = this.topicToEntityId(topic);
    const entityType = this.inferEntityType(topic, payloadStr);
    const numericValue = this.tryParseNumeric(payloadStr);

    // $SYS 主题消息单独处理（broker 状态信息，不计入实体）
    if (topic.startsWith('$SYS/')) {
      logger.iot?.debug(
        `[MqttAdapter] $SYS 消息: ${topic} = ${payloadStr.slice(0, 100)}`,
      );
      return;
    }

    // 数值型消息触发 reading
    if (numericValue !== null) {
      state.callbacks.onReading({
        entityId: '',
        externalId,
        value: numericValue,
        unit: this.inferUnit(topic),
        timestamp: Date.now(),
      });
    }

    // 所有消息触发 entityUpdate
    const event: EntityUpdateEvent = {
      providerId: state.providerId,
      entityId: '',
      externalId,
      entityType,
      state: numericValue ?? payloadStr,
      attributes: { topic, qos: state.qos },
      timestamp: Date.now(),
    };
    state.callbacks.onEntityUpdate(event);
  }

  /**
   * 发布消息到指定主题（阶段9 s9-10）
   *
   * 用于向 broker 发送控制命令，例如：
   * - 开关设备：publish('home/switch/01/cmd', 'ON')
   * - 设置亮度：publish('home/light/01/brightness', '128')
   *
   * @param state 适配器状态
   * @param topic 目标主题
   * @param payload 消息内容
   * @param options 发布选项（QoS、retain）
   */
  private async publish(
    state: MqttAdapterState,
    topic: string,
    payload: string | Buffer,
    options?: { qos?: 0 | 1 | 2; retain?: boolean },
  ): Promise<boolean> {
    if (state.disconnected || !state.client || !state.client.connected) {
      logger.iot?.warn(
        `[MqttAdapter] Provider ${state.providerId} 未连接，无法发布到 ${topic}`,
      );
      return false;
    }

    const pubOptions = {
      qos: options?.qos ?? 0,
      retain: options?.retain ?? false,
    };

    return new Promise<boolean>((resolve) => {
      try {
        state.client!.publish(topic, payload, pubOptions, (err: Error | null) => {
          if (err) {
            logger.iot?.warn(
              `[MqttAdapter] Provider ${state.providerId} 发布失败: ${topic} - ${err.message}`,
            );
            resolve(false);
          } else {
            state.publishedCount += 1;
            logger.iot?.debug(
              `[MqttAdapter] Provider ${state.providerId} 发布成功: ${topic} (qos=${pubOptions.qos}, retain=${pubOptions.retain})`,
            );
            resolve(true);
          }
        });
      } catch (err) {
        logger.iot?.warn(
          `[MqttAdapter] Provider ${state.providerId} 发布异常: ${topic}`,
          err instanceof Error ? err.message : String(err),
        );
        resolve(false);
      }
    });
  }

  /** MQTT 主题转 entity_id（如 home/sensor/temp → sensor.temp） */
  private topicToEntityId(topic: string): string {
    const parts = topic.split('/').filter((p) => p.length > 0);
    if (parts.length >= 2) {
      return `${parts[0]}.${parts.slice(1).join('_')}`;
    }
    return `mqtt.${topic.replace(/[^a-zA-Z0-9_]/g, '_')}`;
  }

  /** 推断实体类型 */
  private inferEntityType(topic: string, payload: string): IoTEntityType {
    const lowerTopic = topic.toLowerCase();
    if (lowerTopic.includes('sensor') || lowerTopic.includes('temp') || lowerTopic.includes('humidity')) {
      return 'sensor';
    }
    if (lowerTopic.includes('binary') || lowerTopic.includes('motion') || lowerTopic.includes('door')) {
      return 'binary_sensor';
    }
    if (lowerTopic.includes('switch') || lowerTopic.includes('power')) {
      return 'switch';
    }
    if (lowerTopic.includes('light')) {
      return 'light';
    }
    // 布尔值推断为 binary_sensor
    if (payload === 'ON' || payload === 'OFF' || payload === '1' || payload === '0') {
      return 'binary_sensor';
    }
    return 'unknown';
  }

  /** 尝试解析数值 */
  private tryParseNumeric(value: string): number | null {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const num = Number(trimmed);
    return Number.isFinite(num) ? num : null;
  }

  /** 从主题推断单位 */
  private inferUnit(topic: string): string | undefined {
    const lower = topic.toLowerCase();
    if (lower.includes('temp')) return '°C';
    if (lower.includes('humidity')) return '%';
    if (lower.includes('pressure')) return 'hPa';
    if (lower.includes('battery')) return '%';
    return undefined;
  }

  /** 断开连接 */
  private async disconnect(state: MqttAdapterState): Promise<void> {
    if (state.disconnected) return;
    state.disconnected = true;

    if (state.client) {
      try {
        state.client.end(true);
      } catch (err) {
        logger.iot?.warn(
          `[MqttAdapter] Provider ${state.providerId} 断开异常:`,
          err instanceof Error ? err.message : String(err),
        );
      }
      state.client = null;
    }

    logger.iot?.info(
      `[MqttAdapter] Provider ${state.providerId} 已断开 (published=${state.publishedCount}, received=${state.receivedCount})`,
    );
  }
}

// 默认导出单例
export const mqttAdapter = new MqttAdapter();
