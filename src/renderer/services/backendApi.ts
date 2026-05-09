type RequestMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

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

async function refreshAccessToken(): Promise<AuthTokens | null> {
  if (!tokens?.refreshToken || !serverUrl) return null;

  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const res = await fetch(`${serverUrl}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: tokens!.refreshToken }),
      });

      if (!res.ok) {
        tokens = null;
        onAuthFailed?.();
        return null;
      }

      const data = await res.json();
      const newTokens: AuthTokens = {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken ?? tokens!.refreshToken,
      };

      tokens = newTokens;
      onTokenRefresh?.(newTokens);
      return newTokens;
    } catch {
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

  if (res.status === 401 && tokens?.refreshToken) {
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
    } catch {}
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
