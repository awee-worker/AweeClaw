/**
 * 防抖与节流工具 — 基于时间戳与定时器组合的控制函数
 *
 * 支持配置：
 * - leading：是否在调用开始时立即执行
 * - trailing：是否在调用结束后执行最后一次
 */

/** 控制函数配置 */
interface ControlOptions {
  /** 是否在周期开始时执行 */
  leading?: boolean
  /** 是否在周期结束时执行 */
  trailing?: boolean
}

/** 防抖函数包装器 */
export interface DebouncedFn<T extends (...args: any[]) => any> {
  (...args: Parameters<T>): void
  /** 取消待执行的调用 */
  cancel(): void
  /** 立即执行待执行的调用 */
  flush(): void
}

/** 节流函数包装器 */
export interface ThrottledFn<T extends (...args: any[]) => any> {
  (...args: Parameters<T>): void
  /** 取消待执行的调用 */
  cancel(): void
}

/** 防抖 — 在停止调用 delayMs 毫秒后执行最后一次 */
export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delayMs: number,
  options?: ControlOptions,
): DebouncedFn<T> {
  const { leading = false, trailing = true } = options ?? {}
  let timer: ReturnType<typeof setTimeout> | null = null
  let pendingArgs: Parameters<T> | null = null
  let lastInvokeTime = 0

  const invoke = (args: Parameters<T>) => {
    fn(...args)
    lastInvokeTime = Date.now()
  }

  const wrapped = function (...args: Parameters<T>) {
    const now = Date.now()
    const isLeadingCall = leading && lastInvokeTime === 0 && timer === null

    pendingArgs = args

    if (isLeadingCall) {
      invoke(args)
      pendingArgs = null
      return
    }

    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      if (trailing && pendingArgs !== null) {
        invoke(pendingArgs)
        pendingArgs = null
      }
    }, delayMs)
  } as DebouncedFn<T>

  wrapped.cancel = () => {
    if (timer) clearTimeout(timer)
    timer = null
    pendingArgs = null
    lastInvokeTime = 0
  }

  wrapped.flush = () => {
    if (timer) clearTimeout(timer)
    timer = null
    if (pendingArgs !== null) {
      invoke(pendingArgs)
      pendingArgs = null
    }
  }

  return wrapped
}

/** 节流 — 在 intervalMs 周期内最多执行一次 */
export function throttle<T extends (...args: any[]) => any>(
  fn: T,
  intervalMs: number,
  options?: ControlOptions,
): ThrottledFn<T> {
  const { leading = true, trailing = true } = options ?? {}
  let lastExecTime = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let queuedArgs: Parameters<T> | null = null

  const execute = (args: Parameters<T>) => {
    fn(...args)
    lastExecTime = Date.now()
    queuedArgs = null
  }

  const scheduleTrailing = () => {
    const elapsed = Date.now() - lastExecTime
    const remaining = intervalMs - elapsed
    timer = setTimeout(() => {
      timer = null
      if (queuedArgs !== null && trailing) {
        execute(queuedArgs)
      }
    }, Math.max(0, remaining))
  }

  const wrapped = function (...args: Parameters<T>) {
    const now = Date.now()
    const canExecuteLeading = leading && now - lastExecTime >= intervalMs

    if (canExecuteLeading) {
      execute(args)
      return
    }

    queuedArgs = args
    if (timer === null && trailing) {
      scheduleTrailing()
    }
  } as ThrottledFn<T>

  wrapped.cancel = () => {
    if (timer) clearTimeout(timer)
    timer = null
    queuedArgs = null
  }

  return wrapped
}

/** 速率限制 — 基于 callsPerSecond 转换为节流间隔 */
export function rateLimit<T extends (...args: any[]) => any>(
  fn: T,
  callsPerSecond: number,
): ThrottledFn<T> {
  const intervalMs = Math.max(1, Math.floor(1000 / callsPerSecond))
  return throttle(fn, intervalMs)
}
