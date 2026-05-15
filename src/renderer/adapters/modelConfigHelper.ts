import type { LLMConfig } from '@shared/protocols/modelGateway'
import { useStore } from '@store'
import { getAccessToken, getServerUrl, tryRefreshToken } from '@services/backendApi'

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
        const serverUrl = getServerUrl()

        if (accessToken && serverUrl) {
            return {
                ...config,
                cloudMode: true,
                serverUrl,
                accessToken,
            }
        }
    }

    return { ...config, cloudMode: false }
}

export async function getEffectiveLLMConfigAsync(baseConfig?: LLMConfig): Promise<LLMConfig> {
  const store = useStore.getState()
  const config = baseConfig || store.llmConfig

  if (store.cloudMode === 'cloud' && store.isAuthenticated) {
    await ensureFreshToken()

    const accessToken = getAccessToken()
    const serverUrl = getServerUrl()

    if (accessToken && serverUrl) {
      return {
        ...config,
        cloudMode: true,
        serverUrl,
        accessToken,
      }
    }
  }

  return { ...config, cloudMode: false }
}
