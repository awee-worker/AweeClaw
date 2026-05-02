import type { Middleware, MiddlewareContext } from '../Middleware'

interface RateLimitConfig {
  maxCalls: number
  windowMs: number
  keyExtractor?: (input: unknown) => string
}

interface RateLimitEntry {
  timestamps: number[]
}

export class RateLimitMiddleware<TInput, TOutput> implements Middleware<TInput, TOutput> {
  readonly id = 'rateLimit'
  readonly order = 15

  private config: RateLimitConfig
  private entries = new Map<string, RateLimitEntry>()

  constructor(config: Partial<RateLimitConfig> & { maxCalls: number; windowMs: number }) {
    this.config = config
  }

  async before(input: TInput, _ctx: MiddlewareContext): Promise<TInput> {
    const key = this.config.keyExtractor
      ? this.config.keyExtractor(input)
      : this.extractDefaultKey(input)

    const now = Date.now()
    const entry = this.getOrCreateEntry(key)

    entry.timestamps = entry.timestamps.filter(ts => now - ts < this.config.windowMs)

    if (entry.timestamps.length >= this.config.maxCalls) {
      throw new RateLimitError(
        key,
        this.config.maxCalls,
        this.config.windowMs,
        entry.timestamps[0] - now + this.config.windowMs
      )
    }

    entry.timestamps.push(now)
    return input
  }

  private getOrCreateEntry(key: string): RateLimitEntry {
    let entry = this.entries.get(key)
    if (!entry) {
      entry = { timestamps: [] }
      this.entries.set(key, entry)
    }
    return entry
  }

  private extractDefaultKey(input: unknown): string {
    if (typeof input === 'object' && input !== null) {
      const obj = input as Record<string, unknown>
      if (typeof obj.toolName === 'string') return `tool:${obj.toolName}`
    }
    return 'default'
  }

  reset(key?: string): void {
    if (key) {
      this.entries.delete(key)
    } else {
      this.entries.clear()
    }
  }
}

export class RateLimitError extends Error {
  readonly key: string
  readonly maxCalls: number
  readonly windowMs: number
  readonly retryAfterMs: number

  constructor(key: string, maxCalls: number, windowMs: number, retryAfterMs: number) {
    super(`Rate limit exceeded for "${key}": ${maxCalls} calls per ${windowMs}ms. Retry after ${retryAfterMs}ms.`)
    this.name = 'RateLimitError'
    this.key = key
    this.maxCalls = maxCalls
    this.windowMs = windowMs
    this.retryAfterMs = retryAfterMs
  }
}
