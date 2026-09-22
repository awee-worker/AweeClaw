/**
 * IoT Bridge 云端回调绑定
 *
 * IoTBridge 运行在客户端主进程，但它所需的 Provider 运行配置与读数落库都在
 * 后端 REST 接口上，因此需要两个回调：
 *
 * - fetchProviderConfig：按 providerId 拉取含解密 authConfig 的运行配置
 * - reportReadings：把采集到的传感器读数批量写入后端时序库
 *
 * 回调在主进程内实现（凭据由渲染进程推送，见 IoTBridgeCredentials），
 * 不经过 IPC 传递函数 —— 函数无法被结构化克隆，无法跨进程传递。
 *
 * 读数落库依赖后端实体 ID：Bridge 采集到的 externalId（HA entity_id /
 * MQTT topic / BLE characteristic）需要先映射为后端 Entity 主键，
 * 映射表按 TTL 缓存，避免每条读数都查一次实体列表。
 *
 * @module iot/IoTBridgeBindings
 */

import { logger } from '@shared/toolkit/LogEngine';
import {
  iotBridgeCredentials,
  type IoTBridgeCredentials,
} from './IoTBridgeCredentials';
import type {
  FetchProviderConfigFn,
  IoTProtocol,
  IoTProviderSummary,
  ReportReadingsFn,
} from './IoTInterface';

/** 单次云端请求超时（毫秒） */
const REQUEST_TIMEOUT_MS = 15_000;

/** 实体映射缓存有效期（毫秒） */
const ENTITY_MAP_TTL_MS = 5 * 60 * 1000;

/** 后端 Provider 运行配置响应 */
interface ProviderClientConfigPayload {
  id: string;
  name: string;
  protocol: string;
  endpoint: string;
  authConfig: Record<string, unknown> | null;
  pollIntervalSec: number;
  enabled: boolean;
  metadata?: Record<string, unknown>;
}

/** 后端实体条目（仅取映射所需字段） */
interface EntityListItem {
  id: string;
  externalId: string;
}

/** 请求结果 */
type RequestResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string };

/** 协议白名单：与 IoTInterface 的 IoTProtocol 保持一致 */
const KNOWN_PROTOCOLS: readonly IoTProtocol[] = [
  'homeassistant',
  'mqtt',
  'ble',
  'custom',
];

/**
 * 发起一次带鉴权的 JSON 请求
 *
 * 401 视为凭据失效：清空本地凭据并记录日志，等待渲染进程重新推送。
 * 主进程不自行刷新 token。
 */
async function requestJson<T>(
  creds: IoTBridgeCredentials,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<RequestResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${creds.serverUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${creds.accessToken}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });

    if (res.status === 401) {
      iotBridgeCredentials.clear();
      return {
        ok: false,
        status: 401,
        error: '登录状态已失效，请在设置中重新登录后再启动 Bridge',
      };
    }

    const text = await res.text();
    if (!res.ok) {
      let message = text || res.statusText;
      try {
        const parsed = JSON.parse(text) as { message?: string | string[] };
        if (parsed?.message) {
          message = Array.isArray(parsed.message)
            ? parsed.message.join(', ')
            : String(parsed.message);
        }
      } catch {
        /* 非 JSON 错误体，保留原文 */
      }
      return { ok: false, status: res.status, error: message };
    }

    if (!text) return { ok: true, data: {} as T };

    const json = JSON.parse(text) as unknown;
    // 兼容 { success, data } 包装
    if (
      json &&
      typeof json === 'object' &&
      'success' in json &&
      'data' in json
    ) {
      return { ok: true, data: (json as { data: T }).data };
    }
    return { ok: true, data: json as T };
  } catch (err) {
    const message =
      err instanceof Error && err.name === 'AbortError'
        ? `请求超时（${REQUEST_TIMEOUT_MS / 1000}s）`
        : err instanceof Error
          ? err.message
          : String(err);
    return { ok: false, status: 0, error: message };
  } finally {
    clearTimeout(timer);
  }
}

/** 归一化协议字段：未知协议按自定义协议处理 */
function normalizeProtocol(protocol: string): IoTProtocol {
  return (KNOWN_PROTOCOLS as readonly string[]).includes(protocol)
    ? (protocol as IoTProtocol)
    : 'custom';
}

/**
 * 拉取 Provider 运行配置（含解密后的 authConfig）
 *
 * 供 IoTBridge.connectProvider / testProviderConnection 调用。
 */
export const fetchProviderConfig: FetchProviderConfigFn = async (
  providerId,
) => {
  const creds = iotBridgeCredentials.get();
  if (!creds) {
    return {
      success: false,
      error: '未登录或登录状态未同步到主进程，请先登录后再启动 Bridge',
    };
  }

  const result = await requestJson<ProviderClientConfigPayload>(
    creds,
    'GET',
    `/api/v1/iot/providers/${encodeURIComponent(providerId)}/client-config`,
  );
  if (!result.ok) {
    return { success: false, error: result.error };
  }

  const payload = result.data;
  if (!payload?.id || !payload?.endpoint) {
    return { success: false, error: '后端返回的 Provider 配置不完整' };
  }

  const summary: IoTProviderSummary = {
    id: payload.id,
    name: payload.name,
    protocol: normalizeProtocol(payload.protocol),
    endpoint: payload.endpoint,
    authConfig: payload.authConfig ?? null,
    pollIntervalSec: payload.pollIntervalSec ?? 60,
    enabled: payload.enabled !== false,
    metadata: payload.metadata,
  };
  return { success: true, data: summary };
};

// ============================================================
// 实体映射缓存（externalId → 后端 entityId）
// ============================================================

let entityMapCache: {
  fetchedAt: number;
  map: Map<string, string>;
} | null = null;
let entityMapInFlight: Promise<Map<string, string>> | null = null;

/**
 * 客户端读数来源 → 后端 source 枚举映射
 *
 * 客户端 ReadingSource 为采集侧语义（bridge / manual / rule / system），
 * 后端枚举为接入侧语义（ha / mqtt / ble / bridge / manual / derived），
 * 规则类与系统类读数在后端统一归类为 derived。
 */
function normalizeReadingSource(source?: string): string {
  switch (source) {
    case 'manual':
      return 'manual';
    case 'rule':
    case 'system':
      return 'derived';
    default:
      return 'bridge';
  }
}

/** 拉取实体列表并构建 externalId → entityId 映射 */
async function loadEntityMap(
  creds: IoTBridgeCredentials,
): Promise<Map<string, string>> {
  const result = await requestJson<EntityListItem[]>(
    creds,
    'GET',
    '/api/v1/iot/entities',
  );
  if (!result.ok) {
    logger.iot?.warn(`[IoTBridgeBindings] 拉取实体列表失败: ${result.error}`);
    return entityMapCache?.map ?? new Map();
  }

  const list = Array.isArray(result.data) ? result.data : [];
  const map = new Map<string, string>();
  for (const item of list) {
    if (item?.externalId && item?.id) {
      map.set(item.externalId, item.id);
    }
  }
  entityMapCache = { fetchedAt: Date.now(), map };
  return map;
}

/** 获取实体映射（命中缓存则直接返回，过期后重新拉取） */
async function resolveEntityMap(
  creds: IoTBridgeCredentials,
  force = false,
): Promise<Map<string, string>> {
  if (!force && entityMapCache) {
    if (Date.now() - entityMapCache.fetchedAt < ENTITY_MAP_TTL_MS) {
      return entityMapCache.map;
    }
  }
  if (entityMapInFlight) return entityMapInFlight;

  entityMapInFlight = loadEntityMap(creds).finally(() => {
    entityMapInFlight = null;
  });
  return entityMapInFlight;
}

/**
 * 批量上报读数到后端
 *
 * 未能在后端找到对应 Entity 的读数会被跳过（重试无意义），并记录一条警告，
 * 便于排查「平台实体未在后端登记」的情况。
 */
export const reportReadings: ReportReadingsFn = async (readings) => {
  if (readings.length === 0) return { success: true };

  const creds = iotBridgeCredentials.get();
  if (!creds) {
    return { success: false, error: '登录状态未同步到主进程，读数暂未上报' };
  }

  const map = await resolveEntityMap(creds);
  const payload: Array<Record<string, unknown>> = [];
  let unmatched = 0;

  for (const reading of readings) {
    const entityId = map.get(reading.entityExternalId);
    if (!entityId) {
      unmatched += 1;
      continue;
    }
    payload.push({
      entityId,
      value: reading.value,
      stringValue: reading.stringValue,
      unit: reading.unit,
      source: normalizeReadingSource(reading.source),
      recordedAt: new Date(reading.recordedAt).toISOString(),
    });
  }

  if (unmatched > 0) {
    logger.iot?.warn(
      `[IoTBridgeBindings] ${unmatched} 条读数未匹配到后端实体，已跳过（请确认实体的 externalId 与平台实体 ID 一致）`,
    );
  }
  if (payload.length === 0) {
    // 全部未匹配：不是网络问题，不进入重试队列
    return { success: true };
  }

  const result = await requestJson<{ created: number }>(
    creds,
    'POST',
    '/api/v1/iot/readings/batch',
    { readings: payload },
  );
  if (!result.ok) {
    return { success: false, error: result.error };
  }
  logger.iot?.debug(
    `[IoTBridgeBindings] 读数上报成功 ${result.data?.created ?? payload.length} 条`,
  );
  return { success: true };
};

/**
 * 绑定云端回调到 IoTBridge 单例
 *
 * 在注册 IoT IPC 处理器时调用一次；重复调用幂等（覆盖同一组函数）。
 */
export function bindIoTBridgeCallbacks(bridge: {
  setCloudCallbacks: (callbacks: {
    fetchProviderConfig: FetchProviderConfigFn;
    reportReadings: ReportReadingsFn;
  }) => void;
}): void {
  bridge.setCloudCallbacks({ fetchProviderConfig, reportReadings });
  logger.iot?.info('[IoTBridgeBindings] 云端回调已绑定');
}
