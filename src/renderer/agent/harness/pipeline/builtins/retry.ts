import { logger } from '@utils/Logger'
import type { Middleware, MiddlewareContext } from '../Middleware'

interface RetryConfig {
  maxRetries: number
  delayMs: number
  backoffMultiplier: number
  maxDelayMs: number
  retryableCheck?: (error: Error) => boolean
}

const DEFAULT_RETRYABLE = (error: Error): boolean => {
  const msg = error.message.toLowerCase()
  return (
    msg.includes('timeout') ||
    msg.includes('network') ||
    msg.includes('econnreset') ||
    msg.includes('econnrefused') ||
    msg.includes('rate limit') ||
    msg.includes('429') ||
    msg.includes('503') ||
    msg.includes('500')
  )
}

export class RetryMiddleware<TInput, TOutput> implements Middleware<TInput, TOutput> {
  readonly id = 'retry'
  readonly order = 20

  private config: RetryConfig

  constructor(config?: Partial<RetryConfig>) {
    this.config = {
      maxRetries: config?.maxRetries ?? 2,
      delayMs: config?.delayMs ?? 1000,
      backoffMultiplier: config?.backoffMultiplier ?? 2,
      maxDelayMs: config?.maxDelayMs ?? 30000,
      retryableCheck: config?.retryableCheck ?? DEFAULT_RETRYABLE,
    }
  }

  async before(input: TInput, ctx: MiddlewareContext): Promise<void> {
    ctx.set('__retry_count__', 0)
    ctx.set('__retry_original_input__', input)
  }

  async onError(error: Error, ctx: MiddlewareContext): Promise<void> {
    const retryCount = ctx.get<number>('__retry_count__') ?? 0
    const isRetryable = this.config.retryableCheck?.(error) ?? DEFAULT_RETRYABLE(error)

    if (!isRetryable || retryCount >= this.config.maxRetries) {
      return
    }

    const delay = Math.min(
      this.config.delayMs * Math.pow(this.config.backoffMultiplier, retryCount),
      this.config.maxDelayMs
    )

    logger.agent.warn(
      `[RetryMiddleware] Attempt ${retryCount + 1}/${this.config.maxRetries} failed: ${error.message}. ` +
      `Retrying in ${delay}ms...`
    )

    ctx.set('__retry_count__', retryCount + 1)
    ctx.set('__retry_delay__', delay)
    ctx.set('__should_retry__', true)
  }
}

export function shouldRetryAfterError(ctx: MiddlewareContext): { retry: boolean; delay: number; input: unknown } | null {
  const shouldRetry = ctx.get<boolean>('__should_retry__')
  if (!shouldRetry) return null

  const delay = ctx.get<number>('__retry_delay__') ?? 1000
  const input = ctx.get('__retry_original_input__')

  ctx.set('__should_retry__', false)

  return { retry: true, delay, input }
}
