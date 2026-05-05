import type {
  LocalProviderType,
  LocalProviderStatus,
  LocalModelInfo,
  LocalModelCapabilities,
} from './types'
import { getApiPaths, getDefaultBaseUrl } from './types'

interface FetchOptions {
  signal?: AbortSignal
  timeout?: number
}

async function fetchWithTimeout(url: string, options: FetchOptions = {}): Promise<Response> {
  const { signal, timeout = 5000 } = options
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)

  const onExternalAbort = () => controller.abort()
  signal?.addEventListener('abort', onExternalAbort, { once: true })

  try {
    const response = await fetch(url, {
      signal: controller.signal,
    })
    return response
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onExternalAbort)
  }
}

function parseOllamaModels(data: any): LocalModelInfo[] {
  if (!data?.models || !Array.isArray(data.models)) return []

  return data.models.map((m: any) => {
    const name: string = m.name || m.model || ''
    const parts = name.split(':')
    const family = m.details?.family || ''
    const paramSize = m.details?.parameter_size || ''

    return {
      id: name,
      name: parts[0] || name,
      provider: 'ollama' as LocalProviderType,
      size: m.size,
      quantization: m.details?.quantization_level,
      format: m.details?.format,
      family,
      parameterSize: paramSize,
      contextLength: 4096,
      capabilities: inferCapabilities('ollama', name, family),
      modifiedAt: m.modified_at ? new Date(m.modified_at).getTime() : undefined,
    }
  })
}

function parseOpenAIModels(data: any, provider: LocalProviderType): LocalModelInfo[] {
  if (!data?.data || !Array.isArray(data.data)) return []

  return data.data.map((m: any) => ({
    id: m.id,
    name: m.id,
    provider,
    capabilities: inferCapabilities(provider, m.id, ''),
  }))
}

function inferCapabilities(provider: LocalProviderType, modelId: string, family: string): LocalModelCapabilities {
  const id = modelId.toLowerCase()
  const fam = family.toLowerCase()

  const hasVision = id.includes('vision') || id.includes('llava') || id.includes('bakllava') ||
    fam.includes('llava') || id.includes('minicpm-v') || id.includes('qwen-vl')

  const hasTools = provider === 'ollama' ||
    id.includes('tool') ||
    fam.includes('llama') ||
    fam.includes('qwen') ||
    fam.includes('mistral') ||
    fam.includes('mixtral')

  const hasEmbedding = id.includes('embed') || id.includes('e5') || id.includes('bge')

  return {
    completion: true,
    chat: true,
    tools: hasTools,
    vision: hasVision,
    embedding: hasEmbedding,
    streaming: true,
  }
}

export class LocalModelDiscovery {
  private cache = new Map<string, LocalProviderStatus>()
  private cacheTtl = 60_000

  async checkProvider(
    provider: LocalProviderType,
    baseUrl?: string,
    options?: FetchOptions,
  ): Promise<LocalProviderStatus> {
    const url = baseUrl || getDefaultBaseUrl(provider)
    const cacheKey = `${provider}:${url}`

    const cached = this.cache.get(cacheKey)
    if (cached && Date.now() - cached.checkedAt < this.cacheTtl) {
      return cached
    }

    const paths = getApiPaths(provider)
    const status: LocalProviderStatus = {
      available: false,
      provider,
      baseUrl: url,
      models: [],
      checkedAt: Date.now(),
    }

    try {
      const healthResponse = await fetchWithTimeout(`${url}${paths.health}`, options)

      if (!healthResponse.ok) {
        status.error = `Health check failed: ${healthResponse.status}`
        this.cache.set(cacheKey, status)
        return status
      }

      const healthData = await healthResponse.json()
      status.available = true
      status.version = healthData.version

      const modelsResponse = await fetchWithTimeout(`${url}${paths.models}`, options)

      if (modelsResponse.ok) {
        const modelsData = await modelsResponse.json()

        if (provider === 'ollama') {
          status.models = parseOllamaModels(modelsData)
        } else {
          status.models = parseOpenAIModels(modelsData, provider)
        }
      }
    } catch (error) {
      status.error = error instanceof Error ? error.message : 'Connection failed'
    }

    this.cache.set(cacheKey, status)
    return status
  }

  async discoverAll(options?: FetchOptions): Promise<LocalProviderStatus[]> {
    const providers: LocalProviderType[] = ['ollama', 'lmstudio', 'llamacpp', 'koboldcpp']
    const results = await Promise.allSettled(
      providers.map(p => this.checkProvider(p, undefined, options))
    )

    return results
      .filter((r): r is PromiseFulfilledResult<LocalProviderStatus> => r.status === 'fulfilled')
      .map(r => r.value)
  }

  async getAvailableModels(provider?: LocalProviderType, baseUrl?: string): Promise<LocalModelInfo[]> {
    if (provider) {
      const status = await this.checkProvider(provider, baseUrl)
      return status.available ? status.models : []
    }

    const allStatuses = await this.discoverAll()
    return allStatuses.filter(s => s.available).flatMap(s => s.models)
  }

  async isModelAvailable(modelId: string, provider?: LocalProviderType): Promise<boolean> {
    const models = await this.getAvailableModels(provider)
    return models.some(m => m.id === modelId || m.name === modelId)
  }

  invalidateCache(provider?: LocalProviderType, baseUrl?: string): void {
    if (provider && baseUrl) {
      this.cache.delete(`${provider}:${baseUrl}`)
    } else {
      this.cache.clear()
    }
  }
}

export const localModelDiscovery = new LocalModelDiscovery()
