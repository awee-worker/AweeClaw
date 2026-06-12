/**
 * backendApi.ts - 后端 API 通信层
 *
 * 设计原则：
 * 1. Token 管理：内存 + localStorage 双写
 * 2. 请求发送：自动附加 Authorization 头
 * 3. 401 处理：刷新 token 后重试，刷新失败则退出登录
 * 4. 防竞态：refresh 加锁，401 只处理一次（首个触发刷新，其余排队等待）
 */

type RequestMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

import { BRAND } from '@shared/brand'
import { logger } from '@shared/toolkit/LogEngine'
import { StorageService } from '@shared/toolkit/StorageService'

// ─── 类型定义 ───────────────────────────────────────────

interface RequestOptions {
  headers?: Record<string, string>;
  body?: unknown;
  signal?: AbortSignal;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

// ─── 模块级状态 ─────────────────────────────────────────

let tokens: AuthTokens | null = null;
let serverUrl = '';

// 回调函数
let onTokenRefresh: ((newTokens: AuthTokens) => void) | null = null;
let onAuthFailed: (() => void) | null = null;

// refresh 加锁：防止并发刷新
let refreshPromise: Promise<RefreshResult> | null = null;

// 401 处理标记：防止多个并发 401 重复触发 onAuthFailed
let isHandling401 = false;

// ─── Token 持久化 ───────────────────────────────────────

const STORAGE_KEY = BRAND.storageKeys.cloudAuth;

function loadPersistedRefreshToken(): string | null {
  const data = StorageService.get<{ refreshToken?: string }>(STORAGE_KEY);
  return data?.refreshToken || null;
}

function clearPersistedTokens() {
  const data = StorageService.get<Record<string, unknown>>(STORAGE_KEY);
  if (data) {
    // 保留 serverUrl 和 cloudMode，只清除 token
    delete (data as any).accessToken;
    delete (data as any).refreshToken;
    StorageService.set(STORAGE_KEY, data);
  }
}

// ─── 公共 API：Token 管理 ───────────────────────────────

export function setServerUrl(url: string) {
  serverUrl = url.replace(/\/+$/, '');
}

export function getServerUrl(): string {
  return serverUrl;
}

export function setTokens(newTokens: AuthTokens | null) {
  tokens = newTokens;
}

export function getTokens(): AuthTokens | null {
  return tokens;
}

export function getAccessToken(): string | null {
  return tokens?.accessToken ?? null;
}

export function isAuthenticated(): boolean {
  return !!tokens?.accessToken;
}

export function setOnTokenRefresh(handler: (newTokens: AuthTokens) => void) {
  onTokenRefresh = handler;
}

export function setOnAuthFailed(handler: () => void) {
  onAuthFailed = handler;
}

/**
 * 从主进程同步刷新后的 token
 */
export function syncRefreshedTokens(newAccessToken: string, newRefreshToken?: string) {
  if (!newAccessToken) return;
  tokens = {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken || tokens?.refreshToken || '',
  };
  onTokenRefresh?.(tokens);
}

// ─── Token 刷新 ─────────────────────────────────────────

type RefreshResult =
  | { ok: true; tokens: AuthTokens }
  | { ok: false; tokenInvalid: boolean }; // tokenInvalid=true 表示 refreshToken 确认无效

/**
 * 刷新 accessToken，加锁防止并发
 * - tokenInvalid=true：refreshToken 已失效（401/403），必须退出登录
 * - tokenInvalid=false：临时错误（5xx/网络），保留认证状态
 */
async function refreshAccessToken(): Promise<RefreshResult> {
  const refreshToken = tokens?.refreshToken || loadPersistedRefreshToken();

  if (!refreshToken || !serverUrl) {
    return { ok: false, tokenInvalid: false };
  }

  // 加锁：如果已有刷新请求在进行中，复用同一个 Promise
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async (): Promise<RefreshResult> => {
    try {
      const res = await fetch(`${serverUrl}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      if (res.status === 401 || res.status === 403) {
        // refreshToken 确认无效，必须退出登录
        return { ok: false, tokenInvalid: true };
      }

      if (!res.ok) {
        // 5xx 等临时错误，保留认证状态
        logger.system.warn('[BackendApi] Refresh failed with status:', res.status);
        return { ok: false, tokenInvalid: false };
      }

      const raw = await res.json();
      // 后端 TransformInterceptor 包装格式：{ success, data: { accessToken, refreshToken }, timestamp }
      const data = raw?.data ?? raw;
      if (!data.accessToken) {
        logger.system.error('[BackendApi] Refresh response missing accessToken:', JSON.stringify(raw));
        return { ok: false, tokenInvalid: false };
      }
      const newTokens: AuthTokens = {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken || refreshToken,
      };

      // 更新内存中的 token
      tokens = newTokens;
      // 通知 authSlice 持久化
      onTokenRefresh?.(newTokens);

      return { ok: true, tokens: newTokens };
    } catch {
      // 网络错误，保留认证状态
      logger.system.warn('[BackendApi] Refresh failed: network error');
      return { ok: false, tokenInvalid: false };
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

/**
 * 检查 accessToken 是否即将过期（5 分钟内）或已过期
 */
function isAccessTokenExpiringSoon(): boolean {
  if (!tokens?.accessToken) return true;
  try {
    const payload = JSON.parse(atob(tokens.accessToken.split('.')[1]));
    const exp = payload.exp * 1000; // 转为毫秒
    const now = Date.now();
    const buffer = 5 * 60 * 1000; // 5 分钟缓冲
    return now >= exp - buffer;
  } catch {
    // 解析失败，假设即将过期
    return true;
  }
}

/**
 * 主动刷新 token（供 visibilitychange / system resume 等场景使用）
 * 只在 accessToken 即将过期时才刷新，避免不必要的 refresh 请求
 * 只在 token 确认无效时才触发退出登录
 */
export async function tryRefreshToken(): Promise<boolean> {
  // accessToken 仍然有效，无需刷新
  if (!isAccessTokenExpiringSoon()) return true;

  const result = await refreshAccessToken();
  if (result.ok) return true;
  if (result.tokenInvalid) {
    handleAuthFailed('tryRefreshToken: refreshToken invalid');
  }
  return false;
}

// ─── 认证失效处理 ───────────────────────────────────────

/**
 * 统一的认证失效处理入口
 * 清除 token + 持久化 + 通知 UI，确保只执行一次
 */
function handleAuthFailed(reason: string) {
  if (!tokens && !loadPersistedRefreshToken()) {
    // 已经是未认证状态，不重复处理
    return;
  }

  logger.system.warn('[BackendApi] Auth failed, clearing state:', reason);
  tokens = null;
  clearPersistedTokens();
  onAuthFailed?.();
}

// ─── 请求发送 ───────────────────────────────────────────

async function request<T>(
  method: RequestMethod,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const url = `${serverUrl}${path}`;

  // 构建 headers
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (tokens?.accessToken) {
    headers['Authorization'] = `Bearer ${tokens.accessToken}`;
  }

  const fetchOptions: globalThis.RequestInit = {
    method,
    headers,
    signal: options.signal,
  };

  if (options.body && method !== 'GET') {
    fetchOptions.body = JSON.stringify(options.body);
  }

  let res = await fetch(url, fetchOptions);

  // ─── 401 处理 ───
  if (res.status === 401 && tokens) {
    // 防止多个并发 401 重复处理
    if (isHandling401) {
      // 已有其他请求在处理 401，等待其完成后再决定是否重试
      // 简单策略：直接抛出 401，因为第一个 401 处理器会统一处理
      throw new BackendApiError(401, 'Unauthorized');
    }

    isHandling401 = true;
    try {
      const refreshToken = tokens?.refreshToken || loadPersistedRefreshToken();
      if (refreshToken) {
        const result = await refreshAccessToken();
        if (result.ok) {
          // 刷新成功，用新 token 重试原请求
          headers['Authorization'] = `Bearer ${result.tokens.accessToken}`;
          res = await fetch(url, { ...fetchOptions, headers });
        } else if (result.tokenInvalid) {
          // refreshToken 确认无效，退出登录
          handleAuthFailed('401 + refreshToken invalid');
          throw new BackendApiError(401, 'Session expired');
        }
        // 临时错误：用原 token 重试（可能后端临时故障已恢复）
        // 如果仍然 401，下面会走到 !res.ok 的错误抛出
      } else {
        // 无 refreshToken，退出登录
        handleAuthFailed('401 + no refreshToken');
        throw new BackendApiError(401, 'Session expired');
      }
    } finally {
      isHandling401 = false;
    }
  }

  // ─── 响应处理 ───
  if (!res.ok) {
    const errorBody = await res.text().catch(() => '');
    let errorMessage = errorBody || res.statusText;
    try {
      const errorJson = JSON.parse(errorBody);
      if (errorJson?.message) {
        errorMessage = Array.isArray(errorJson.message)
          ? errorJson.message.join(', ')
          : String(errorJson.message);
      }
    } catch { /* ignore parse error */ }
    throw new BackendApiError(res.status, errorMessage);
  }

  const text = await res.text();
  if (!text) return {} as T;

  const json = JSON.parse(text);

  // 兼容 { success, data } 包装格式
  if (json && typeof json === 'object' && 'success' in json && 'data' in json) {
    return json.data as T;
  }

  return json as T;
}

// ─── 错误类 ─────────────────────────────────────────────

export class BackendApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'BackendApiError';
  }
}

// ─── 便捷方法 ───────────────────────────────────────────

export const backendApi = {
  get: <T>(path: string, options?: RequestOptions) =>
    request<T>('GET', path, options),

  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('POST', path, { ...options, body }),

  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('PUT', path, { ...options, body }),

  delete: <T>(path: string, options?: RequestOptions) =>
    request<T>('DELETE', path, options),
};
