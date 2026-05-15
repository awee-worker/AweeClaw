import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LLMConfig } from '@protocols'
import { prepareRequestCache } from '@modules/ai-provider/core/RequestCache'
import {
  clearCacheCompatibilityState,
  isCacheFeatureUnsupported,
  markCacheFeatureUnsupported,
} from '@modules/ai-provider/core/CacheCompatibility'

const longPrompt = 'cacheable prefix '.repeat(2000)

describe('RequestCache', () => {
  afterEach(() => {
    vi.useRealTimers()
    clearCacheCompatibilityState()
  })

  it('applies OpenAI-compatible cache options for custom protocol providers', async () => {
    const config: LLMConfig = {
      provider: 'custom-provider',
      protocol: 'custom',
      model: 'gpt-4.1',
      apiKey: 'test-key',
      baseUrl: 'https://example.com/v1',
    }

    const result = await prepareRequestCache(config, [
      { role: 'user', content: longPrompt },
      { role: 'assistant', content: 'Previous reply' },
      { role: 'user', content: 'Newest turn' },
    ])

    expect(result.providerOptions?.openaiCompatible?.promptCacheKey).toBeTypeOf('string')
    expect(result.providerOptions?.['custom-openai']?.prompt_cache_key).toBeTypeOf('string')
  })
})

describe('CacheCompatibility', () => {
  afterEach(() => {
    vi.useRealTimers()
    clearCacheCompatibilityState()
  })

  it('only disables unsupported cache features for a cooldown window', () => {
    vi.useFakeTimers()

    const config: LLMConfig = {
      provider: 'openai',
      protocol: 'openai',
      model: 'gpt-4.1',
      apiKey: 'test-key',
      baseUrl: 'https://api.openai.com/v1',
    }

    markCacheFeatureUnsupported(config, 'openai-prompt-cache-key', 'unsupported parameter')

    expect(isCacheFeatureUnsupported(config, 'openai-prompt-cache-key')).toBe(true)

    vi.advanceTimersByTime(10 * 60 * 1000 + 1)

    expect(isCacheFeatureUnsupported(config, 'openai-prompt-cache-key')).toBe(false)
  })
})
