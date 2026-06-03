import type { LLMConfig } from '@shared/protocols/modelGateway'
import { useStore } from '@store'
import { getAccessToken, getTokens, getServerUrl, tryRefreshToken } from '@services/backendApi'

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
    return null
  }
}

function isTokenExpiringSoon(): boolean {
  const token = getAccessToken()
  if (!token) return true

  const expiresAt = decodeJwtExp(token)
  if (!expiresAt) return false

  return Date.now() > expiresAt - 2 * 60 * 1000
}

let refreshPromise: Promise<boolean> | null = null

async function ensureFreshToken(): Promise<boolean> {
  if (!isTokenExpiringSoon()) return true

  if (refreshPromise) return refreshPromise

  refreshPromise = tryRefreshToken().finally(() => {
    refreshPromise = null
  })

  return refreshPromise
}

export function getEffectiveLLMConfig(baseConfig?: LLMConfig): LLMConfig {
    const store = useStore.getState()
    const config = baseConfig || store.llmConfig

    if (store.cloudMode === 'cloud' && store.isAuthenticated) {
        const accessToken = getAccessToken()
        const refreshToken = getTokens()?.refreshToken
        const serverUrl = getServerUrl()

        if ((accessToken || refreshToken) && serverUrl) {
            return {
                ...config,
                cloudMode: true,
                serverUrl,
                accessToken: accessToken || '',
                refreshToken,
            }
        }
    }

    return { ...config, cloudMode: false }
}

export async function getEffectiveLLMConfigAsync(baseConfig?: LLMConfig): Promise<LLMConfig> {
  const store = useStore.getState()
  const config = baseConfig || store.llmConfig

  if (store.cloudMode === 'cloud' && store.isAuthenticated) {
    // 尝试刷新 token（内部会区分临时错误和 token 失效）
    await ensureFreshToken()

    const accessToken = getAccessToken()
    const refreshToken = getTokens()?.refreshToken
    const serverUrl = getServerUrl()

    // accessToken 可能为空（refresh 遇到临时错误），但 refreshToken 仍有效
    // 仍然返回 cloud 配置，让 createCloudModel 的自定义 fetch 在 401 时自动刷新
    if ((accessToken || refreshToken) && serverUrl) {
      return {
        ...config,
        cloudMode: true,
        serverUrl,
        accessToken: accessToken || '',
        refreshToken,
      }
    }
  }

  return { ...config, cloudMode: false }
}
