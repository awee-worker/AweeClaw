import type { LLMConfig } from '@protocols'
import { logger } from '@shared/toolkit/LogEngine'
import {
  detectUnsupportedCacheFeature,
  getCacheFeatureErrorReason,
  markCacheFeatureUnsupported,
} from './ProviderCacheAdapter'

export async function withCacheCompatibilityRetry<T>(
  config: LLMConfig,
  runCached: () => Promise<T>,
  runWithoutCache: () => Promise<T>
): Promise<T> {
  try {
    return await runCached()
  } catch (error) {
    const unsupportedFeature = detectUnsupportedCacheFeature(error, config)
    if (!unsupportedFeature) {
      throw error
    }

    const reason = getCacheFeatureErrorReason(error)
    markCacheFeatureUnsupported(config, unsupportedFeature, reason)

    logger.llm.warn('[CacheRetry] Retrying request without incompatible cache feature', {
      provider: config.provider,
      protocol: config.protocol,
      model: config.model,
      feature: unsupportedFeature,
    })

    return await runWithoutCache()
  }
}
