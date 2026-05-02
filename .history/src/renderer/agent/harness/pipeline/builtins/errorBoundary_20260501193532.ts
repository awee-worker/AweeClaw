import { logger } from '@utils/Logger'
import type { Middleware, MiddlewareContext } from '../Middleware'

export class ErrorBoundaryMiddleware<TInput, TOutput> implements Middleware<TInput, TOutput> {
  readonly id = 'errorBoundary'
  readonly order = 0

  private fallbackValue?: TOutput
  private onErrorCallback?: (error: Error, ctx: MiddlewareContext) => void

  constructor(options?: {
    fallbackValue?: TOutput
    onError?: (error: Error, ctx: MiddlewareContext) => void
  }) {
    this.fallbackValue = options?.fallbackValue
    this.onErrorCallback = options?.onError
  }

  async onError(error: Error, ctx: MiddlewareContext): Promise<void> {
    logger.agent.error(
      `[ErrorBoundary] Pipeline "${ctx.pipelineId}" caught error: ${error.message}`
    )

    this.onErrorCallback?.(error, ctx)
  }

  getFallback(): TOutput | undefined {
    return this.fallbackValue
  }
}

export class CircuitBreakerMiddleware<TInput, TOutput> implements Middleware<TInput, TOutput> {
  readonly id = 'circuitBreaker'
  readonly order = 3

  private failureCount = 0
  private lastFailureTime = 0
  private state: 'closed' | 'open' | 'half-open' = 'closed'

  constructor(
    private readonly threshold: number = 5,
    private readonly resetTimeoutMs: number = 30000,
    _halfOpenMaxCalls: number = 1
  ) {}

  async before(input: TInput, ctx: MiddlewareContext): Promise<TInput> {
    if (this.state === 'open') {
      const elapsed = Date.now() - this.lastFailureTime
      if (elapsed >= this.resetTimeoutMs) {
        this.state = 'half-open'
        ctx.set('__circuit_half_open__', true)
      } else {
        throw new CircuitBreakerOpenError(
          ctx.pipelineId,
          this.failureCount,
          this.resetTimeoutMs - elapsed
        )
      }
    }
    return input
  }

  async after(_output: TOutput, _ctx: MiddlewareContext): Promise<void> {
    if (this.state === 'half-open') {
      this.state = 'closed'
      this.failureCount = 0
    }
  }

  async onError(error: Error, ctx: MiddlewareContext): Promise<void> {
    this.failureCount++
    this.lastFailureTime = Date.now()

    if (this.failureCount >= this.threshold) {
      this.state = 'open'
      logger.agent.warn(
        `[CircuitBreaker] Opened for "${ctx.pipelineId}" after ${this.failureCount} failures. ` +
        `Will retry after ${this.resetTimeoutMs}ms.`
      )
    }
  }

  reset(): void {
    this.state = 'closed'
    this.failureCount = 0
    this.lastFailureTime = 0
  }

  getState(): { state: string; failureCount: number } {
    return { state: this.state, failureCount: this.failureCount }
  }
}

export class CircuitBreakerOpenError extends Error {
  readonly pipelineId: string
  readonly failureCount: number
  readonly retryAfterMs: number

  constructor(pipelineId: string, failureCount: number, retryAfterMs: number) {
    super(
      `Circuit breaker open for "${pipelineId}": ${failureCount} failures. ` +
      `Retry after ${retryAfterMs}ms.`
    )
    this.name = 'CircuitBreakerOpenError'
    this.pipelineId = pipelineId
    this.failureCount = failureCount
    this.retryAfterMs = retryAfterMs
  }
}
