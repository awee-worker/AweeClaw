/**
 * 场景感知重试策略
 *
 * 设计理念：
 * - 场景驱动：不同场景使用不同重试策略
 * - 法律场景：保守重试，长间隔，确保合规
 * - 医疗场景：紧急重试，短间隔，快速失败
 * - 教育场景：标准重试，平衡稳定性和响应速度
 * - 通用场景：默认策略
 * - 指数退避：支持抖动，避免惊群
 * - 可取消：支持 AbortSignal
 */

// ============================================
// 场景定义
// ============================================

/** 场景类型 */
export type RetryScenario = 'legal' | 'medical' | 'education' | 'general'

/** 场景重试策略 */
export interface ScenarioRetryPolicy {
  /** 场景名称 */
  scenario: RetryScenario
  /** 最大重试次数 */
  maxRetries: number
  /** 初始延迟（毫秒） */
  initialDelayMs: number
  /** 最大延迟（毫秒） */
  maxDelayMs: number
  /** 退避倍数 */
  backoffMultiplier: number
  /** 抖动比例（0-1，用于避免惊群） */
  jitterRatio: number
  /** 默认超时（毫秒） */
  defaultTimeoutMs: number
  /** 是否启用审计日志 */
  enableAudit: boolean
  /** 可重试错误模式 */
  retryablePatterns: string[]
}

// ============================================
// 场景策略预设
// ============================================

const SCENARIO_POLICIES: Record<RetryScenario, ScenarioRetryPolicy> = {
  /** 法律场景：保守策略，长间隔，完整审计 */
  legal: {
    scenario: 'legal',
    maxRetries: 5,
    initialDelayMs: 2000,
    maxDelayMs: 60000,
    backoffMultiplier: 2,
    jitterRatio: 0.2,
    defaultTimeoutMs: 30000,
    enableAudit: true,
    retryablePatterns: [
      'timeout',
      'ECONNRESET',
      'ETIMEDOUT',
      'network',
      'rate limit',
      '503',
      '504',
    ],
  },

  /** 医疗场景：紧急策略，短间隔，快速失败 */
  medical: {
    scenario: 'medical',
    maxRetries: 2,
    initialDelayMs: 500,
    maxDelayMs: 5000,
    backoffMultiplier: 1.5,
    jitterRatio: 0.1,
    defaultTimeoutMs: 10000,
    enableAudit: true,
    retryablePatterns: [
      'timeout',
      'ECONNRESET',
      'ETIMEDOUT',
      'network',
      '503',
      '504',
    ],
  },

  /** 教育场景：标准策略 */
  education: {
    scenario: 'education',
    maxRetries: 3,
    initialDelayMs: 1000,
    maxDelayMs: 15000,
    backoffMultiplier: 2,
    jitterRatio: 0.15,
    defaultTimeoutMs: 20000,
    enableAudit: false,
    retryablePatterns: [
      'timeout',
      'ECONNRESET',
      'ETIMEDOUT',
      'network',
      'rate limit',
      '429',
      '503',
      '504',
    ],
  },

  /** 通用场景：默认策略 */
  general: {
    scenario: 'general',
    maxRetries: 3,
    initialDelayMs: 1000,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
    jitterRatio: 0.1,
    defaultTimeoutMs: 30000,
    enableAudit: false,
    retryablePatterns: [
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
    ],
  },
}

// ============================================
// 重试配置
// ============================================

/** 重试配置 */
export interface RetryConfig {
  maxRetries: number
  initialDelayMs: number
  maxDelayMs: number
  backoffMultiplier: number
  jitterRatio: number
  timeoutMs?: number
  abortSignal?: AbortSignal
  /** 自定义可重试判断 */
  isRetryable?: (error: unknown) => boolean
  /** 重试回调 */
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void
  /** 场景类型 */
  scenario?: RetryScenario
}

/** 默认配置（通用场景） */
const DEFAULT_CONFIG: RetryConfig = {
  ...SCENARIO_POLICIES.general,
}

// ============================================
// 核心函数
// ============================================

/**
 * 获取场景重试策略
 *
 * @param scenario 场景类型
 * @returns 场景重试策略
 */
export function getScenarioRetryPolicy(
  scenario: RetryScenario,
): ScenarioRetryPolicy {
  return SCENARIO_POLICIES[scenario]
}

/**
 * 默认的可重试错误判断
 *
 * @param error 错误对象
 * @param patterns 可重试错误模式
 * @returns 是否可重试
 */
export function isRetryableError(
  error: unknown,
  patterns: string[] = SCENARIO_POLICIES.general.retryablePatterns,
): boolean {
  const message = error instanceof Error ? error.message : String(error)
  const lowerMessage = message.toLowerCase()
  return patterns.some((p) => lowerMessage.includes(p.toLowerCase()))
}

/**
 * 计算重试延迟（带抖动）
 *
 * @param attempt 当前尝试次数（从 0 开始）
 * @param config 重试配置
 * @returns 延迟毫秒数
 */
export function computeRetryDelay(
  attempt: number,
  config: Pick<
    RetryConfig,
    'initialDelayMs' | 'maxDelayMs' | 'backoffMultiplier' | 'jitterRatio'
  >,
): number {
  const baseDelay =
    config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt)
  const clampedDelay = Math.min(baseDelay, config.maxDelayMs)

  // 添加抖动
  if (config.jitterRatio > 0) {
    const jitter = clampedDelay * config.jitterRatio * (Math.random() * 2 - 1)
    return Math.max(0, Math.round(clampedDelay + jitter))
  }

  return Math.round(clampedDelay)
}

/**
 * 带场景感知的重试执行
 *
 * @param fn 要执行的函数
 * @param config 重试配置
 * @returns 执行结果
 */
export async function withRetry<T>(
  fn: (signal?: AbortSignal) => Promise<T>,
  config?: Partial<RetryConfig>,
): Promise<T> {
  // 合并配置：默认 → 场景策略 → 用户配置
  const scenario = config?.scenario ?? 'general'
  const scenarioPolicy = SCENARIO_POLICIES[scenario]
  const cfg: RetryConfig = {
    ...DEFAULT_CONFIG,
    ...scenarioPolicy,
    ...config,
  }

  const isRetryable =
    cfg.isRetryable ??
    ((error: unknown) => isRetryableError(error, scenarioPolicy.retryablePatterns))

  let lastError: unknown

  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    try {
      // 超时控制
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

      // 最后一次尝试或不可重试
      if (attempt === cfg.maxRetries || !isRetryable(error)) {
        throw error
      }

      // 计算延迟
      const delayMs = computeRetryDelay(attempt, cfg)
      cfg.onRetry?.(attempt + 1, error, delayMs)

      // 等待（支持取消）
      if (cfg.abortSignal) {
        await waitForDelayWithAbort(delayMs, cfg.abortSignal)
      } else {
        await sleep(delayMs)
      }
    }
  }

  throw lastError
}

/**
 * 带超时的 Promise 执行
 *
 * @param promise 要执行的 Promise
 * @param timeoutMs 超时时间
 * @param timeoutError 超时错误
 * @returns 执行结果
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutError?: Error,
): Promise<T> {
  let timeoutId: NodeJS.Timeout

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(
        timeoutError ?? new Error(`Operation timed out after ${timeoutMs}ms`),
      )
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
 *
 * @param ms 毫秒数
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 创建可取消的 Promise
 *
 * @param executor 执行函数
 * @returns Promise 和取消函数
 */
export function cancellable<T>(
  executor: (signal: AbortSignal) => Promise<T>,
): { promise: Promise<T>; cancel: () => void } {
  const controller = new AbortController()
  return {
    promise: executor(controller.signal),
    cancel: () => controller.abort(),
  }
}

// ============================================
// 重试中间件类
// ============================================

/**
 * 场景感知重试中间件
 */
export class RetryMiddleware {
  private policy: ScenarioRetryPolicy

  constructor(scenario: RetryScenario = 'general') {
    this.policy = SCENARIO_POLICIES[scenario]
  }

  /**
   * 判断是否应该重试
   *
   * @param error 错误对象
   * @param attempt 当前尝试次数
   * @returns 是否重试
   */
  shouldRetry(error: unknown, attempt: number): boolean {
    if (attempt >= this.policy.maxRetries) return false
    return isRetryableError(error, this.policy.retryablePatterns)
  }

  /**
   * 获取重试延迟
   *
   * @param attempt 当前尝试次数
   * @returns 延迟毫秒数
   */
  getDelay(attempt: number): number {
    return computeRetryDelay(attempt, this.policy)
  }

  /**
   * 切换场景策略
   *
   * @param scenario 场景类型
   */
  switchScenario(scenario: RetryScenario): void {
    this.policy = SCENARIO_POLICIES[scenario]
  }

  /**
   * 获取当前策略
   *
   * @returns 场景重试策略
   */
  getPolicy(): ScenarioRetryPolicy {
    return this.policy
  }
}

// ============================================
// 兼容性函数
// ============================================

/**
 * 判断错误后是否应该重试（兼容旧 API）
 *
 * @param error 错误对象
 * @param attempt 当前尝试次数
 * @param maxAttempts 最大尝试次数
 * @returns 是否重试
 */
export function shouldRetryAfterError(
  error: unknown,
  attempt: number,
  maxAttempts: number = 3,
): boolean {
  if (attempt >= maxAttempts) return false
  return isRetryableError(error)
}

// ============================================
// 内部工具
// ============================================

/**
 * 带取消的延迟等待
 *
 * @param ms 延迟毫秒数
 * @param signal 取消信号
 */
async function waitForDelayWithAbort(
  ms: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    throw new Error('Aborted')
  }

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new Error('Aborted'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
