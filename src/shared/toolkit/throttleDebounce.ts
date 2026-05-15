export interface DebouncedFn<T extends (...args: any[]) => any> {
  (...args: Parameters<T>): void
  cancel(): void
  flush(): void
}

export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delayMs: number,
): DebouncedFn<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pendingArgs: Parameters<T> | null = null

  const invoke = () => {
    if (pendingArgs !== null) {
      fn(...pendingArgs)
      pendingArgs = null
    }
  }

  const wrapped = function (...args: Parameters<T>) {
    pendingArgs = args
    if (timer) clearTimeout(timer)
    timer = setTimeout(invoke, delayMs)
  } as DebouncedFn<T>

  wrapped.cancel = () => {
    if (timer) clearTimeout(timer)
    timer = null
    pendingArgs = null
  }

  wrapped.flush = () => {
    if (timer) clearTimeout(timer)
    timer = null
    invoke()
  }

  return wrapped
}

export interface ThrottledFn<T extends (...args: any[]) => any> {
  (...args: Parameters<T>): void
  cancel(): void
}

export function throttle<T extends (...args: any[]) => any>(
  fn: T,
  intervalMs: number,
): ThrottledFn<T> {
  let active = false
  let queued: Parameters<T> | null = null

  const execute = (args: Parameters<T>) => {
    fn(...args)
    active = true
    setTimeout(() => {
      active = false
      if (queued !== null) {
        const captured = queued
        queued = null
        execute(captured)
      }
    }, intervalMs)
  }

  const wrapped = function (...args: Parameters<T>) {
    if (!active) {
      execute(args)
    } else {
      queued = args
    }
  } as ThrottledFn<T>

  wrapped.cancel = () => {
    queued = null
  }

  return wrapped
}

export function rateLimit<T extends (...args: any[]) => any>(
  fn: T,
  callsPerSecond: number,
): ThrottledFn<T> {
  const intervalMs = Math.max(1, Math.floor(1000 / callsPerSecond))
  return throttle(fn, intervalMs)
}
