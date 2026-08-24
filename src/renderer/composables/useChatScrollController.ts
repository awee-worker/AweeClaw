/**
 * 聊天列表滚动控制器 Hook
 *
 * 管理虚拟列表的自动吸底、滚动按钮显隐与流式追加时的跟随逻辑。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { VirtuosoHandle } from 'react-virtuoso'

/** 距底部小于此值视为已吸底 */
const BOTTOM_THRESHOLD_PX = 220

/** 流式期间吸底轮询间隔 */
const STICK_INTERVAL_MS = 300

/** 滚动位置微小变化阈值 */
const SCROLL_JITTER_PX = 2

/** 可见范围 */
interface VisibleRange {
  startIndex: number
  endIndex: number
}

/** Hook 配置 */
export interface UseChatScrollControllerOptions {
  isHydratingActiveThread: boolean
  isStreaming: boolean
  isSwitchingThread: boolean
  messageCount: number
  threadId: string | null
  /** 外部传入的 virtuosoRef，用于解决与 useTimelineProjection 的循环依赖 */
  virtuosoRef?: React.RefObject<VirtuosoHandle>
}

/** Hook 返回值 */
export interface ChatScrollController {
  attachScrollerNode: (node: HTMLDivElement | null) => void
  followOutput: (isListAtBottom: boolean) => 'auto' | false
  handleBottomStateChange: (bottom: boolean) => void
  handleTotalListHeightChanged: () => void
  handleVisibleRangeChanged: (range: VisibleRange) => void
  scrollToBottom: (behavior?: 'auto' | 'smooth') => void
  showScrollButton: boolean
  virtuosoRef: React.RefObject<VirtuosoHandle>
}

/** 滚动度量结果 */
interface ScrollMetrics {
  bottom: boolean
  hasOverflow: boolean
}

/**
 * 计算滚动容器距底部的度量
 */
function measureScroller(scroller: HTMLDivElement | null, atBottom: boolean): ScrollMetrics {
  if (!scroller) return { bottom: atBottom, hasOverflow: false }

  const distanceFromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
  const hasOverflow = scroller.scrollHeight - scroller.clientHeight > 4
  return {
    bottom: !hasOverflow || distanceFromBottom <= BOTTOM_THRESHOLD_PX,
    hasOverflow,
  }
}

export function useChatScrollController({
  isHydratingActiveThread,
  isStreaming,
  isSwitchingThread,
  messageCount,
  threadId,
  virtuosoRef: externalVirtuosoRef,
}: UseChatScrollControllerOptions): ChatScrollController {
  // 优先使用外部传入的 virtuosoRef，用于解决与 useTimelineProjection 的循环依赖
  const internalVirtuosoRef = useRef<VirtuosoHandle>(null)
  const virtuosoRef = externalVirtuosoRef ?? internalVirtuosoRef
  const scrollerRef = useRef<HTMLDivElement | null>(null)

  // 滚动状态
  const isAutoScrollingRef = useRef(false)
  const atBottomRef = useRef(true)
  const pendingBottomSnapRef = useRef(true)
  const lastScrollTopRef = useRef(0)
  const stickyFrameRef = useRef<number | null>(null)

  const [showScrollButton, setShowScrollButton] = useState(false)

  /** 读取当前滚动度量 */
  const getMetrics = useCallback((): ScrollMetrics => {
    return measureScroller(scrollerRef.current, atBottomRef.current)
  }, [])

  /** 同步底部状态与按钮显隐 */
  const applyBottomState = useCallback((bottom: boolean, hasOverflow = true) => {
    const next = hasOverflow && !bottom
    atBottomRef.current = bottom
    setShowScrollButton(next)
  }, [])

  /** 基于滚动容器度量同步状态 */
  const syncFromScroller = useCallback(() => {
    const { bottom, hasOverflow } = getMetrics()
    applyBottomState(bottom, hasOverflow)
  }, [getMetrics, applyBottomState])

  /** 滚动到底部 */
  const scrollToBottom = useCallback(
    (behavior: 'auto' | 'smooth' = 'smooth') => {
      if (messageCount <= 0) return
      // 标记正在自动滚动，防止 syncFromScroller 和 handleBottomStateChange 干扰
      isAutoScrollingRef.current = true
      atBottomRef.current = true
      setShowScrollButton(false)

      requestAnimationFrame(() => {
        // 优先用 scrollToIndex 滚动到最后一条消息底部
        virtuosoRef.current?.scrollToIndex({ index: messageCount - 1, align: 'end', behavior })
        // 同时用 stickToBottom 兜底（直接操作 scrollTop），防止 scrollToIndex 在流式增长时失效
        const scroller = scrollerRef.current
        if (scroller) {
          scroller.scrollTop = scroller.scrollHeight
        }
        // 延迟清除 isAutoScrolling 标记，等待 smooth 动画完成
        const delay = behavior === 'smooth' ? 350 : 100
        setTimeout(() => {
          isAutoScrollingRef.current = false
          // 再次确保到底部
          if (scrollerRef.current && atBottomRef.current) {
            scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight
          }
          syncFromScroller()
        }, delay)
      })
    },
    [messageCount, syncFromScroller],
  )

  /** 立即吸底（直接操作 scrollTop） */
  const stickToBottom = useCallback(() => {
    const scroller = scrollerRef.current
    if (!scroller || messageCount <= 0) return

    isAutoScrollingRef.current = true
    atBottomRef.current = true
    setShowScrollButton(false)

    scroller.scrollTop = scroller.scrollHeight
    virtuosoRef.current?.autoscrollToBottom()

    requestAnimationFrame(() => {
      scroller.scrollTop = scroller.scrollHeight
      lastScrollTopRef.current = scroller.scrollTop
      isAutoScrollingRef.current = false
    })
  }, [messageCount])

  /** 调度下一帧吸底 */
  const scheduleStick = useCallback(() => {
    if (stickyFrameRef.current !== null) return
    stickyFrameRef.current = requestAnimationFrame(() => {
      stickyFrameRef.current = null
      stickToBottom()
    })
  }, [stickToBottom])

  /** Virtuoso followOutput 策略 */
  const followOutput = useCallback(
    (isListAtBottom: boolean): 'auto' | false => {
      return isListAtBottom || atBottomRef.current ? 'auto' : false
    },
    [],
  )

  /** 列表总高度变化时处理 */
  const handleTotalListHeightChanged = useCallback(() => {
    if (!isStreaming) {
      requestAnimationFrame(syncFromScroller)
      return
    }

    const { bottom } = getMetrics()
    if (!atBottomRef.current && !bottom) {
      requestAnimationFrame(syncFromScroller)
      return
    }

    atBottomRef.current = true
    isAutoScrollingRef.current = true
    setShowScrollButton(false)

    requestAnimationFrame(() => {
      stickToBottom()
      requestAnimationFrame(() => {
        stickToBottom()
        requestAnimationFrame(() => {
          isAutoScrollingRef.current = false
          syncFromScroller()
        })
      })
    })
  }, [getMetrics, isStreaming, stickToBottom, syncFromScroller])

  /** Virtuoso 底部状态变化回调
   *
   * 关键设计：流式期间，Virtuoso 可能因布局变化（输入框高度变化、思考内容展开动画等）
   * 报告 bottom=false，但实际上用户并未主动向上滚动。此时应使用 measureScroller 的结果
   * （距底部 < BOTTOM_THRESHOLD_PX 视为在底部）而非 Virtuoso 报告的值，
   * 避免错误地停止 followOutput 导致内容不自动滚动到底部。
   */
  const handleBottomStateChange = useCallback(
    (bottom: boolean) => {
      if (isAutoScrollingRef.current) return
      // 流式期间：以 measureScroller 的度量为准，避免 Virtuoso 因布局抖动误报
      if (isStreaming) {
        const metrics = getMetrics()
        applyBottomState(metrics.bottom, metrics.hasOverflow)
        // 如果度量认为在底部，但 Virtuoso 报告不在底部，调度吸底
        if (metrics.bottom && !bottom) {
          scheduleStick()
        }
        return
      }
      // 非流式：直接使用 Virtuoso 报告的值
      const { hasOverflow } = getMetrics()
      applyBottomState(bottom, hasOverflow)
    },
    [getMetrics, applyBottomState, isStreaming, scheduleStick],
  )

  /** 可见范围变化回调（保留接口，度量以 scroll 为准） */
  const handleVisibleRangeChanged = useCallback((_range: VisibleRange) => {
    // 滚动度量是底部状态的唯一来源，避免 Virtuoso range 抢先更新按钮状态
  }, [])

  /** 挂载滚动容器节点 */
  const attachScrollerNode = useCallback(
    (node: HTMLDivElement | null) => {
      scrollerRef.current = node
      if (!node) return
      requestAnimationFrame(syncFromScroller)
    },
    [syncFromScroller],
  )

  // 切换会话时标记待吸底
  useEffect(() => {
    pendingBottomSnapRef.current = true
  }, [threadId])

  // 会话就绪后吸底
  useEffect(() => {
    if (!pendingBottomSnapRef.current) return
    if (isSwitchingThread || isHydratingActiveThread || messageCount === 0) return

    pendingBottomSnapRef.current = false
    requestAnimationFrame(() => {
      requestAnimationFrame(() => scrollToBottom('auto'))
    })
  }, [isSwitchingThread, isHydratingActiveThread, messageCount, scrollToBottom])

  // 消息数量变化时同步
  useEffect(() => {
    syncFromScroller()
  }, [messageCount, syncFromScroller])

  // 绑定原生滚动与尺寸监听
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return

    const handleScroll = () => {
      if (isAutoScrollingRef.current) return
      const previousTop = lastScrollTopRef.current
      const currentTop = scroller.scrollTop
      lastScrollTopRef.current = currentTop

      // 流式期间向上滚动：脱离吸底
      if (isStreaming && currentTop < previousTop - SCROLL_JITTER_PX) {
        const { hasOverflow } = getMetrics()
        applyBottomState(false, hasOverflow)
        return
      }

      // 流式期间向下滚动：尝试重新吸底
      if (isStreaming && currentTop >= previousTop) {
        const { bottom, hasOverflow } = getMetrics()
        if (bottom || atBottomRef.current) {
          applyBottomState(true, hasOverflow)
          scheduleStick()
          return
        }
      }

      syncFromScroller()
    }

    lastScrollTopRef.current = scroller.scrollTop
    handleScroll()
    scroller.addEventListener('scroll', handleScroll, { passive: true })

    const resizeObserver = new ResizeObserver(() => {
      if (isStreaming && atBottomRef.current) {
        setShowScrollButton(false)
        scheduleStick()
        return
      }
      syncFromScroller()
    })
    resizeObserver.observe(scroller)

    return () => {
      scroller.removeEventListener('scroll', handleScroll)
      resizeObserver.disconnect()
    }
  }, [getMetrics, isStreaming, scheduleStick, applyBottomState, syncFromScroller])

  // 流式期间定时吸底
  useEffect(() => {
    if (!isStreaming) return
    const timer = window.setInterval(() => {
      if (atBottomRef.current) stickToBottom()
    }, STICK_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [isStreaming, stickToBottom])

  // 卸载时清理 rAF
  useEffect(() => {
    return () => {
      if (stickyFrameRef.current !== null) cancelAnimationFrame(stickyFrameRef.current)
    }
  }, [])

  return {
    attachScrollerNode,
    followOutput,
    handleBottomStateChange,
    handleTotalListHeightChanged,
    handleVisibleRangeChanged,
    scrollToBottom,
    showScrollButton,
    virtuosoRef,
  }
}
