/**
 * 通用重试工具
 * 支持指数退避、可重试错误判断、超时控制
 */

export interface RetryConfig {
  maxRetries: number
  initialDelayMs: number
  maxDelayMs: number
  backoffMultiplier: number
  timeoutMs?: number
  isRetryable?: (error: unknown) => boolean
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void
}

const DEFAULT_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
}

const DEFAULT_RETRYABLE_PATTERNS = [
  'timeout',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'network',
  'rate limit',
  'temporarily unavailable',
  '429',
  '503',
  '504',
]

/**
 * 默认的可重试错误判断
 */
export function isRetryableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  const lowerMessage = message.toLowerCase()
  return DEFAULT_RETRYABLE_PATTERNS.some(p => lowerMessage.includes(p.toLowerCase()))
}

/**
 * 带重试的异步函数执行
 */
export async function withRetry<T>(
  fn: (signal?: AbortSignal) => Promise<T>,
  config?: Partial<RetryConfig>
): Promise<T> {
  const cfg: RetryConfig = { ...DEFAULT_CONFIG, ...config }
  const isRetryable = cfg.isRetryable ?? isRetryableError

  let lastError: unknown
  let delay = cfg.initialDelayMs

  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    try {
      // 创建超时控制
      if (cfg.timeoutMs) {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), cfg.timeoutMs)
        try {
          const result = await fn(controller.signal)
          clearTimeout(timeoutId)
          return result
        } catch (e) {
          clearTimeout(timeoutId)
          throw e
        }
      }
      return await fn()
    } catch (error) {
      lastError = error

      // 最后一次尝试或不可重试的错误
      if (attempt === cfg.maxRetries || !isRetryable(error)) {
        throw error
      }

      // 计算下次延迟
      const currentDelay = Math.min(delay, cfg.maxDelayMs)
      cfg.onRetry?.(attempt + 1, error, currentDelay)

      // 等待后重试
      await sleep(currentDelay)
      delay *= cfg.backoffMultiplier
    }
  }

  throw lastError
}

/**
 * 带重试的 Promise.race（用于超时控制）
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutError?: Error
): Promise<T> {
  let timeoutId: NodeJS.Timeout

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(timeoutError ?? new Error(`Operation timed out after ${timeoutMs}ms`))
    }, timeoutMs)
  })

  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    clearTimeout(timeoutId!)
  }
}

/**
 * 睡眠函数
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 创建可取消的 Promise
 */
export function cancellable<T>(
  executor: (signal: AbortSignal) => Promise<T>
): { promise: Promise<T>; cancel: () => void } {
  const controller = new AbortController()
  return {
    promise: executor(controller.signal),
    cancel: () => controller.abort(),
  }
}
