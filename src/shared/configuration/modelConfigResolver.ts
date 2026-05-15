import { getBuiltinProvider } from '@shared/configuration/aiProviders'
import { SETTINGS, type ProviderModelConfig } from '@shared/configuration/preferenceSync'
import type { ApiProtocol, ProviderConfig, PersistedLLMConfig, LLMConfig } from './providerTypes'
import { resolvePersistedLLMBehavior } from '@configuration/modelPersistence'
import { resolveOpenAICompatibilityProfile } from '@shared/configuration/aiProviders'
import type { ScenarioDomain } from './defaultProfile'
import { SCENARIO_PROFILE_DEFAULTS } from './defaultProfile'

type ProviderConfigMap = Record<string, ProviderConfig | ProviderModelConfig | undefined>

interface ResolvedProviderTransportConfig {
  apiKey: string
  baseUrl?: string
  timeout?: number
  headers?: Record<string, string>
  protocol: ApiProtocol
  openAICompatibilityProfile?: LLMConfig['openAICompatibilityProfile']
  model?: string
}

function resolveProviderTransportConfig(
  providerId: string,
  providerConfigs: ProviderConfigMap,
  fallbackConfig?: Partial<LLMConfig>,
): ResolvedProviderTransportConfig {
  const defaults = SETTINGS.llmConfig.default
  const providerConfig = providerConfigs[providerId]
  const builtinProvider = getBuiltinProvider(providerId)

  const fallbackMatchesProvider =
    fallbackConfig?.provider === providerId || (!providerConfig && fallbackConfig?.provider == null)

  return {
    apiKey: providerConfig?.apiKey ?? (fallbackMatchesProvider ? fallbackConfig?.apiKey : undefined) ?? '',
    baseUrl: providerConfig?.baseUrl ?? builtinProvider?.baseUrl ?? (fallbackMatchesProvider ? fallbackConfig?.baseUrl : undefined) ?? defaults.baseUrl,
    timeout: providerConfig?.timeout ?? builtinProvider?.defaults.timeout ?? (fallbackMatchesProvider ? fallbackConfig?.timeout : undefined) ?? defaults.timeout,
    headers: providerConfig?.headers ?? (fallbackMatchesProvider ? fallbackConfig?.headers : undefined) ?? defaults.headers,
    protocol: providerConfig?.protocol ?? builtinProvider?.protocol ?? (fallbackMatchesProvider ? fallbackConfig?.protocol : undefined) ?? 'openai',
    openAICompatibilityProfile: resolveOpenAICompatibilityProfile(
      providerId,
      providerConfig?.protocol ?? builtinProvider?.protocol ?? (fallbackMatchesProvider ? fallbackConfig?.protocol : undefined) ?? 'openai',
      providerConfig?.openAICompatibilityProfile
        ?? (fallbackMatchesProvider ? fallbackConfig?.openAICompatibilityProfile : undefined),
    ),
    model: providerConfig?.model ?? builtinProvider?.defaultModel ?? (fallbackMatchesProvider ? fallbackConfig?.model : undefined),
  }
}

export function resolveRuntimeLLMConfig(
  saved: Partial<PersistedLLMConfig> | undefined,
  providerConfigs: ProviderConfigMap,
): LLMConfig {
  const defaults = SETTINGS.llmConfig.default
  const providerId = saved?.provider ?? defaults.provider
  const transport = resolveProviderTransportConfig(providerId, providerConfigs)
  const behavior = resolvePersistedLLMBehavior(saved, defaults)

  return {
    provider: providerId,
    model: saved?.model ?? transport.model ?? defaults.model,
    apiKey: transport.apiKey,
    baseUrl: transport.baseUrl,
    timeout: transport.timeout,
    ...behavior,
    headers: transport.headers,
    protocol: transport.protocol,
    openAICompatibilityProfile: transport.openAICompatibilityProfile,
  }
}

// ============================================
// 场景感知模型配置解析
// ============================================

interface ScenarioModelOverrides {
    temperature: number
    topP: number
    maxTokens: number
    timeout: number
}

function getScenarioModelOverrides(domain: ScenarioDomain): ScenarioModelOverrides {
    const profile = SCENARIO_PROFILE_DEFAULTS[domain]
    return {
        temperature: Number(profile.llm.temperature),
        topP: Number(profile.llm.topP),
        maxTokens: Number(profile.llm.maxTokens),
        timeout: Number(profile.llm.timeout),
    }
}

export function resolveScenarioLLMConfig(
    saved: Partial<PersistedLLMConfig> | undefined,
    providerConfigs: ProviderConfigMap,
    domain: ScenarioDomain
): LLMConfig {
    const baseConfig = resolveRuntimeLLMConfig(saved, providerConfigs)
    const overrides = getScenarioModelOverrides(domain)

    return {
        ...baseConfig,
        temperature: overrides.temperature,
        topP: overrides.topP,
        maxTokens: baseConfig.maxTokens != null
            ? Math.min(overrides.maxTokens, baseConfig.maxTokens)
            : overrides.maxTokens,
        timeout: baseConfig.timeout != null
            ? Math.max(overrides.timeout, baseConfig.timeout)
            : overrides.timeout,
    }
}

export function resolveScenarioTaskLLMConfig(
    providerId: string,
    modelId: string,
    providerConfigs: ProviderConfigMap,
    domain: ScenarioDomain,
    activeConfig?: Partial<LLMConfig>
): LLMConfig | null {
    const baseConfig = resolveTaskLLMConfig(providerId, modelId, providerConfigs, activeConfig)
    if (!baseConfig) return null

    const overrides = getScenarioModelOverrides(domain)

    return {
        ...baseConfig,
        temperature: overrides.temperature,
        topP: overrides.topP,
        maxTokens: baseConfig.maxTokens != null
            ? Math.min(overrides.maxTokens, baseConfig.maxTokens)
            : overrides.maxTokens,
        timeout: baseConfig.timeout != null
            ? Math.max(overrides.timeout, baseConfig.timeout)
            : overrides.timeout,
    }
}

export function resolveTaskLLMConfig(
  providerId: string,
  modelId: string,
  providerConfigs: ProviderConfigMap,
  activeConfig?: Partial<LLMConfig>,
): LLMConfig | null {
  const defaults = SETTINGS.llmConfig.default
  const transport = resolveProviderTransportConfig(providerId, providerConfigs, activeConfig)

  if (!transport.apiKey) {
    return null
  }

  return {
    ...defaults,
    ...activeConfig,
    provider: providerId,
    model: modelId,
    apiKey: transport.apiKey,
    baseUrl: transport.baseUrl,
    timeout: transport.timeout,
    headers: transport.headers,
    protocol: transport.protocol,
    openAICompatibilityProfile: transport.openAICompatibilityProfile,
  }
}
