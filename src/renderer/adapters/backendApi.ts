type RequestMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

import { BRAND } from '@shared/brand'
import { logger } from '@shared/toolkit/LogEngine'
import { StorageService } from '@shared/toolkit/StorageService'

interface RequestOptions {
  headers?: Record<string, string>;
  body?: unknown;
  signal?: AbortSignal;
}

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

let tokens: AuthTokens | null = null;
let serverUrl = '';
let onTokenRefresh: ((newTokens: AuthTokens) => void) | null = null;
let onAuthFailed: (() => void) | null = null;
let refreshPromise: Promise<AuthTokens | null> | null = null;
let proactiveRefreshTimer: ReturnType<typeof setTimeout> | null = null;

// accessToken 7天过期，提前1天刷新，确保不会因定时器延迟导致过期
const ACCESS_TOKEN_REFRESH_MARGIN_MS = 24 * 60 * 60 * 1000;

function decodeJwtExp(token: string): number | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    let payload = parts[1];
    payload = payload.replace(/-/g, '+').replace(/_/g, '/');
    while (payload.length % 4 !== 0) {
      payload += '=';
    }
    const decoded = atob(payload);
    const json = JSON.parse(decoded);
    return typeof json.exp === 'number' ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

function scheduleProactiveRefresh() {
  if (proactiveRefreshTimer) {
    clearTimeout(proactiveRefreshTimer);
    proactiveRefreshTimer = null;
  }

  if (!tokens?.accessToken) return;

  const expiresAt = decodeJwtExp(tokens.accessToken);

  if (!expiresAt) {
    // 无法解析 JWT 过期时间，按固定间隔刷新（6天，对应7天过期提前1天）
    proactiveRefreshTimer = setTimeout(() => {
      proactiveRefreshTimer = null;
      refreshAccessToken().catch(() => {});
    }, 6 * 24 * 60 * 60 * 1000);
    return;
  }

  const now = Date.now();
  const refreshAt = expiresAt - ACCESS_TOKEN_REFRESH_MARGIN_MS;
  const delay = refreshAt - now;

  if (delay <= 0) {
    refreshAccessToken().catch(() => {});
    return;
  }

  proactiveRefreshTimer = setTimeout(() => {
    proactiveRefreshTimer = null;
    refreshAccessToken().catch(() => {});
  }, delay);
}

export function setServerUrl(url: string) {
  serverUrl = url.replace(/\/+$/, '');
}

export function getServerUrl(): string {
  return serverUrl;
}

export function setTokens(newTokens: AuthTokens | null) {
  tokens = newTokens;
  if (newTokens) {
    scheduleProactiveRefresh();
  } else {
    if (proactiveRefreshTimer) {
      clearTimeout(proactiveRefreshTimer);
      proactiveRefreshTimer = null;
    }
  }
}

/**
 * 从主进程同步刷新后的 token（由 cloudFetch 的 onTokenRefreshed 回调触发）
 * 避免渲染进程后续使用已撤销的 refreshToken 刷新导致认证状态失效
 */
export function syncRefreshedTokens(newAccessToken: string, newRefreshToken?: string) {
  if (!newAccessToken) return

  const currentRefreshToken = tokens?.refreshToken
  tokens = {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken || currentRefreshToken || '',
  }
  scheduleProactiveRefresh()
  onTokenRefresh?.(tokens)
}

export function getTokens(): AuthTokens | null {
  return tokens;
}

export function setOnTokenRefresh(handler: (newTokens: AuthTokens) => void) {
  onTokenRefresh = handler;
}

export function setOnAuthFailed(handler: () => void) {
  onAuthFailed = handler;
}

export function getAccessToken(): string | null {
  return tokens?.accessToken ?? null;
}

export function isAuthenticated(): boolean {
  return !!tokens?.accessToken;
}

export async function tryRefreshToken(): Promise<boolean> {
  const newTokens = await refreshAccessToken();
  return !!newTokens;
}

/**
 * 从 StorageService 读取持久化的 refreshToken（降级恢复用）
 */
function loadPersistedRefreshToken(): string | null {
  const data = StorageService.get<{ refreshToken?: string }>(BRAND.storageKeys.cloudAuth);
  return data?.refreshToken || null;
}

async function refreshAccessToken(): Promise<AuthTokens | null> {
  // 优先使用内存中的 refreshToken，降级从 localStorage 读取
  const refreshToken = tokens?.refreshToken || loadPersistedRefreshToken() || undefined;

  if (!refreshToken || !serverUrl) return null;

  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const res = await fetch(`${serverUrl}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      if (!res.ok) {
        // 区分 refresh token 无效（401）和服务器临时错误（5xx）
        if (res.status === 401 || res.status === 403) {
          // refresh token 已失效，但 accessToken 可能仍在有效期内
          // 只有 accessToken 也过期时才触发 onAuthFailed
          const currentExpiresAt = tokens?.accessToken ? decodeJwtExp(tokens.accessToken) : null;
          const now = Date.now();
          if (!currentExpiresAt || currentExpiresAt <= now) {
            // accessToken 也已过期，用户必须重新登录
            tokens = null;
            if (proactiveRefreshTimer) {
              clearTimeout(proactiveRefreshTimer);
              proactiveRefreshTimer = null;
            }
            onAuthFailed?.();
          }
          // accessToken 仍有效，保留认证状态，等下次请求时再判断
        }
        // 5xx 等临时错误：保留 tokens，不清除认证状态
        return null;
      }

      const data = await res.json();
      const newTokens: AuthTokens = {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken ?? refreshToken,
      };

      tokens = newTokens;
      onTokenRefresh?.(newTokens);
      scheduleProactiveRefresh();
      return newTokens;
    } catch {
      // 网络错误：保留 tokens，不清除认证状态
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

async function request<T>(
  method: RequestMethod,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const url = `${serverUrl}${path}`;
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

  if (res.status === 401 && (tokens?.refreshToken || loadPersistedRefreshToken())) {
    const newTokens = await refreshAccessToken();
    if (newTokens) {
      headers['Authorization'] = `Bearer ${newTokens.accessToken}`;
      res = await fetch(url, { ...fetchOptions, headers });
    }
  }

  if (!res.ok) {
    const errorBody = await res.text().catch(() => '');
    let errorMessage = errorBody || res.statusText;
    try {
      const errorJson = JSON.parse(errorBody);
      if (errorJson?.message) {
        errorMessage = Array.isArray(errorJson.message) ? errorJson.message.join(', ') : String(errorJson.message);
      }
    } catch (e) { logger.system.debug('Failed to parse error response body:', e) }
    throw new BackendApiError(res.status, errorMessage);
  }

  const text = await res.text();
  if (!text) return {} as T;

  const json = JSON.parse(text);

  if (json && typeof json === 'object' && 'success' in json && 'data' in json) {
    return json.data as T;
  }

  return json as T;
}

export class BackendApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'BackendApiError';
  }
}

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
