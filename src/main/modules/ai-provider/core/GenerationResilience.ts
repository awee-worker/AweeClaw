import type { LLMConfig } from '@protocols'
import { logger } from '@shared/toolkit/LogEngine'
import { ErrorCode } from '@shared/toolkit/errorCatalog'
import {
  detectUnsupportedCacheFeature,
  getCacheFeatureErrorReason,
  markCacheFeatureUnsupported,
} from './ProviderCacheAdapter'
import {
  detectUnsupportedParameter,
  markParameterSuppressed,
} from './ProviderParameterAdapter'
import { LLMError } from '../providerTypes'

interface RecoveryState {
  cacheRetryCount: number
  parameterRetryCount: number
  transientRetryCount: number
}

export interface GenerationRecoveryOptions<T> {
  config: LLMConfig
  operation: string
  requestId?: string
  abortSignal?: AbortSignal
  execute: (useCache: boolean, attempt: number) => Promise<T>
  maxCacheRetries?: number
  maxTransientRetries?: number
  maxParameterRetries?: number
}

export const DEFAULT_RETRYABLE_GENERATION_CODES = new Set<ErrorCode>([
  ErrorCode.NETWORK,
  ErrorCode.TIMEOUT,
  ErrorCode.LLM_EMPTY_RESPONSE,
  ErrorCode.LLM_NO_OUTPUT,
  ErrorCode.LLM_NO_CONTENT,
])

export async function executeWithGenerationRecovery<T>(
  options: GenerationRecoveryOptions<T>
): Promise<T> {
  const {
    config,
    operation,
    requestId,
    abortSignal,
    execute,
    maxCacheRetries = 1,
    maxTransientRetries = 2,
    maxParameterRetries = 3,
  } = options

  const state: RecoveryState = {
    cacheRetryCount: 0,
    parameterRetryCount: 0,
    transientRetryCount: 0,
  }

  let useCache = true
  let attempt = 0

  while (true) {
    attempt += 1

    try {
      return await execute(useCache, attempt)
    } catch (error) {
      if (abortSignal?.aborted) {
        throw new LLMError('Request was cancelled', ErrorCode.ABORTED, false)
      }

      const unsupportedFeature = detectUnsupportedCacheFeature(error, config)
      if (unsupportedFeature && useCache && state.cacheRetryCount < maxCacheRetries) {
        markCacheFeatureUnsupported(
          config,
          unsupportedFeature,
          getCacheFeatureErrorReason(error)
        )
        state.cacheRetryCount += 1
        useCache = false
        continue
      }

      // 参数级降级：服务商拒收某个参数（例如 top_k / temperature / reasoning_effort）
      // 时，标记该参数在此 provider+model 组合下不可用，去掉后重试。
      // 每个参数只降级一次并带冷却期，因此循环必然收敛；上限兜底防止异常放大。
      const unsupportedParameter = state.parameterRetryCount < maxParameterRetries
        ? detectUnsupportedParameter(error)
        : null
      if (unsupportedParameter) {
        markParameterSuppressed(
          config,
          unsupportedParameter.parameter,
          unsupportedParameter.reason,
        )
        state.parameterRetryCount += 1
        continue
      }

      const llmError = error instanceof LLMError ? error : LLMError.fromError(error)
      if (
        llmError.retryable &&
        DEFAULT_RETRYABLE_GENERATION_CODES.has(llmError.code) &&
        state.transientRetryCount < maxTransientRetries
      ) {
        state.transientRetryCount += 1

        logger.llm.warn('[GenerationRecovery] Retrying transient generation failure', {
          operation,
          provider: config.provider,
          protocol: config.protocol,
          model: config.model,
          requestId,
          code: llmError.code,
          message: llmError.message,
          attempt,
          retryAttempt: state.transientRetryCount,
          useCache,
        })

        await sleep(getGenerationRetryBackoffMs(state.transientRetryCount))
        continue
      }

      if (state.transientRetryCount > 0 || state.cacheRetryCount > 0 || state.parameterRetryCount > 0) {
        logger.llm.error('[GenerationRecovery] Generation failed after retries', {
          operation,
          provider: config.provider,
          protocol: config.protocol,
          model: config.model,
          requestId,
          code: llmError.code,
          message: llmError.message,
          attempt,
          cacheRetries: state.cacheRetryCount,
          parameterRetries: state.parameterRetryCount,
          transientRetries: state.transientRetryCount,
        })
      }

      throw llmError
    }
  }
}

export function getGenerationRetryBackoffMs(retryAttempt: number): number {
  const base = 600
  return base * retryAttempt
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
