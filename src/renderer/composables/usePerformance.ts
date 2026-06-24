/**
 * React 组件性能辅助 Hooks
 *
 * 提供事件监听、防抖节流、外部点击、挂载状态等常用工具。
 * 所有 Hook 内部通过 ref 持有最新回调，避免依赖项变化导致频繁重建。
 */

import { useCallback, useEffect, useRef, useState } from 'react'

/* ------------------------------------------------------------------ */
/* 事件监听                                                          */
/* ------------------------------------------------------------------ */

/** 绑定 DOM 事件，自动在卸载时解绑 */
export function useEventListener<K extends keyof WindowEventMap>(
  eventName: K,
  handler: (event: WindowEventMap[K]) => void,
  element: Window | HTMLElement | null = window,
  options?: AddEventListenerOptions,
) {
  const latestHandler = useRef(handler)

  useEffect(() => {
    latestHandler.current = handler
  }, [handler])

  useEffect(() => {
    if (!element) return

    const listener = (event: Event) => latestHandler.current(event as WindowEventMap[K])
    element.addEventListener(eventName, listener, options)
    return () => element.removeEventListener(eventName, listener, options)
  }, [eventName, element, options])
}

/* ------------------------------------------------------------------ */
/* 防抖与节流                                                        */
/* ------------------------------------------------------------------ */

/** 防抖：延迟执行，期间再次调用会重置计时 */
export function useDebounce<T extends (...args: any[]) => any>(callback: T, delay: number): T {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const callbackRef = useRef(callback)

  useEffect(() => {
    callbackRef.current = callback
  }, [callback])

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  return useCallback(
    (...args: Parameters<T>) => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => callbackRef.current(...args), delay)
    },
    [delay],
  ) as T
}

/** 节流：固定时间窗口内最多执行一次 */
export function useThrottle<T extends (...args: any[]) => any>(callback: T, delay: number): T {
  const lastRunRef = useRef(0)
  const callbackRef = useRef(callback)

  useEffect(() => {
    callbackRef.current = callback
  }, [callback])

  return useCallback(
    (...args: Parameters<T>) => {
      const now = Date.now()
      if (now - lastRunRef.current >= delay) {
        callbackRef.current(...args)
        lastRunRef.current = now
      }
    },
    [delay],
  ) as T
}

/** 稳定回调：返回引用永远不变的函数，但内部始终调用最新闭包 */
export function useStableCallback<T extends (...args: any[]) => any>(callback: T): T {
  const callbackRef = useRef(callback)

  useEffect(() => {
    callbackRef.current = callback
  })

  return useCallback((...args: Parameters<T>) => callbackRef.current(...args), []) as T
}

/* ------------------------------------------------------------------ */
/* 点击外部与 ESC 键                                                 */
/* ------------------------------------------------------------------ */

/** 检测点击是否发生在指定元素外部 */
export function useClickOutside<T extends HTMLElement = HTMLElement>(
  handler: () => void,
  enabled = true,
  externalRefs?: React.RefObject<HTMLElement>[],
) {
  const internalRef = useRef<T>(null)
  const handlerRef = useRef(handler)

  useEffect(() => {
    handlerRef.current = handler
  }, [handler])

  useEffect(() => {
    if (!enabled) return

    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node

      if (externalRefs && externalRefs.length > 0) {
        const inside = externalRefs.some((ref) => ref.current?.contains(target))
        if (!inside) handlerRef.current()
        return
      }

      if (internalRef.current && !internalRef.current.contains(target)) {
        handlerRef.current()
      }
    }

    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [enabled, externalRefs])

  return internalRef
}

/** 监听 ESC 键 */
export function useEscapeKey(handler: () => void, enabled = true) {
  const handlerRef = useRef(handler)

  useEffect(() => {
    handlerRef.current = handler
  }, [handler])

  useEffect(() => {
    if (!enabled) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handlerRef.current()
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [enabled])
}

/** 组合：点击外部或按 ESC 时触发 */
export function useCloseOnOutsideOrEscape<T extends HTMLElement = HTMLElement>(
  handler: () => void,
  enabled = true,
) {
  const ref = useClickOutside<T>(handler, enabled)
  useEscapeKey(handler, enabled)
  return ref
}

/* ------------------------------------------------------------------ */
/* 值与状态                                                          */
/* ------------------------------------------------------------------ */

/** 防抖值：延迟更新状态 */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return debounced
}

/** 保存上一次渲染的值 */
export function usePrevious<T>(value: T): T | undefined {
  const prevRef = useRef<T>(undefined)

  useEffect(() => {
    prevRef.current = value
  }, [value])

  return prevRef.current
}

/** 返回一个函数，用于判断组件是否仍处于挂载状态 */
export function useIsMounted(): () => boolean {
  const mountedRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  return useCallback(() => mountedRef.current, [])
}
