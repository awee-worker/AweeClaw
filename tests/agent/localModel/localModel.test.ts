import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LocalModelDiscovery } from '@intelligence/localModel/LocalModelDiscovery'
import {
  getDefaultPort,
  getDefaultBaseUrl,
  getApiPaths,
  toLLMConfig,
  detectLocalProviderFromUrl,
} from '@intelligence/localModel/types'

describe('LocalModel types', () => {
  it('returns default ports', () => {
    expect(getDefaultPort('ollama')).toBe(11434)
    expect(getDefaultPort('lmstudio')).toBe(1234)
    expect(getDefaultPort('llamacpp')).toBe(8080)
    expect(getDefaultPort('koboldcpp')).toBe(5001)
  })

  it('returns default base URLs', () => {
    expect(getDefaultBaseUrl('ollama')).toBe('http://localhost:11434')
    expect(getDefaultBaseUrl('lmstudio')).toBe('http://localhost:1234')
  })

  it('returns API paths', () => {
    const ollamaPaths = getApiPaths('ollama')
    expect(ollamaPaths.models).toBe('/api/tags')
    expect(ollamaPaths.health).toBe('/api/version')

    const lmstudioPaths = getApiPaths('lmstudio')
    expect(lmstudioPaths.models).toBe('/v1/models')
    expect(lmstudioPaths.chat).toBe('/v1/chat/completions')
  })

  it('converts LocalModelConfig to LLMConfig', () => {
    const llmConfig = toLLMConfig({
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'llama3',
      temperature: 0.5,
      topP: 0.8,
    })

    expect(llmConfig.provider).toBe('ollama')
    expect(llmConfig.model).toBe('llama3')
    expect(llmConfig.baseUrl).toBe('http://localhost:11434')
    expect(llmConfig.temperature).toBe(0.5)
    expect(llmConfig.topP).toBe(0.8)
    expect(llmConfig.protocol).toBe('openai')
  })

  it('converts non-ollama provider to custom', () => {
    const llmConfig = toLLMConfig({
      provider: 'lmstudio',
      baseUrl: 'http://localhost:1234',
      model: 'my-model',
    })

    expect(llmConfig.provider).toBe('custom')
    expect(llmConfig.openAICompatibilityProfile).toBe('compatible')
  })

  it('detects local provider from URL', () => {
    expect(detectLocalProviderFromUrl('http://localhost:11434')).toBe('ollama')
    expect(detectLocalProviderFromUrl('http://localhost:1234')).toBe('lmstudio')
    expect(detectLocalProviderFromUrl('http://localhost:8080')).toBe('llamacpp')
    expect(detectLocalProviderFromUrl('http://localhost:5001')).toBe('koboldcpp')
    expect(detectLocalProviderFromUrl('http://localhost:9999')).toBe('custom_local')
    expect(detectLocalProviderFromUrl('http://192.168.1.1:8080')).toBeNull()
  })
})

describe('LocalModelDiscovery', () => {
  let discovery: LocalModelDiscovery

  beforeEach(() => {
    discovery = new LocalModelDiscovery()
    vi.restoreAllMocks()
  })

  it('returns unavailable status when provider is not running', async () => {
    const status = await discovery.checkProvider('ollama', 'http://localhost:19999', {
      timeout: 1000,
    })

    expect(status.available).toBe(false)
    expect(status.provider).toBe('ollama')
    expect(status.error).toBeDefined()
  })

  it('caches provider status', async () => {
    const status1 = await discovery.checkProvider('ollama', 'http://localhost:19999', { timeout: 500 })
    const status2 = await discovery.checkProvider('ollama', 'http://localhost:19999', { timeout: 500 })

    expect(status1.checkedAt).toBe(status2.checkedAt)
  })

  it('invalidates cache', async () => {
    await discovery.checkProvider('ollama', 'http://localhost:19999', { timeout: 500 })
    discovery.invalidateCache('ollama', 'http://localhost:19999')

    const status = await discovery.checkProvider('ollama', 'http://localhost:19999', { timeout: 500 })
    expect(status).toBeDefined()
  })

  it('parses Ollama model response', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        version: '0.1.20',
        models: [
          {
            name: 'llama3:8b',
            model: 'llama3:8b',
            size: 4661224676,
            modified_at: '2024-01-01T00:00:00Z',
            details: {
              family: 'llama',
              parameter_size: '8B',
              quantization_level: 'Q4_0',
              format: 'gguf',
            },
          },
          {
            name: 'nomic-embed-text',
            size: 274302608,
            details: {
              family: 'nomic',
              parameter_size: '137M',
              quantization_level: 'Q4_0',
              format: 'gguf',
            },
          },
        ],
      }),
    }

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as any)

    const status = await discovery.checkProvider('ollama', 'http://localhost:11434')

    expect(status.available).toBe(true)
    expect(status.models.length).toBe(2)
    expect(status.models[0].name).toBe('llama3')
    expect(status.models[0].family).toBe('llama')
    expect(status.models[0].parameterSize).toBe('8B')
    expect(status.models[0].capabilities.tools).toBe(true)
    expect(status.models[1].capabilities.embedding).toBe(true)
  })

  it('parses LM Studio model response', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        data: [
          { id: 'TheBloke/Mistral-7B-Instruct-v0.2-GGUF' },
          { id: 'meta-llama/Meta-Llama-3-8B-Instruct-GGUF' },
        ],
      }),
    }

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as any)

    const status = await discovery.checkProvider('lmstudio', 'http://localhost:1234')

    expect(status.available).toBe(true)
    expect(status.models.length).toBe(2)
    expect(status.models[0].id).toBe('TheBloke/Mistral-7B-Instruct-v0.2-GGUF')
  })

  it('infers vision capabilities from model name', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        data: [
          { id: 'llava-v1.6' },
          { id: 'qwen-vl-chat' },
          { id: 'mistral-7b' },
        ],
      }),
    }

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as any)

    const status = await discovery.checkProvider('lmstudio', 'http://localhost:1234')

    expect(status.models[0].capabilities.vision).toBe(true)
    expect(status.models[1].capabilities.vision).toBe(true)
    expect(status.models[2].capabilities.vision).toBe(false)
  })

  it('discoverAll returns results for all providers', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Connection refused'))

    const results = await discovery.discoverAll({ timeout: 500 })

    expect(results.length).toBe(4)
    results.forEach(r => {
      expect(r.available).toBe(false)
    })
  })
})
