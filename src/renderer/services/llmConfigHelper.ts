import type { LLMConfig } from '@shared/types/llm'
import { useStore } from '@renderer/store'
import { getAccessToken, getServerUrl } from '@renderer/services/backendApi'

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
