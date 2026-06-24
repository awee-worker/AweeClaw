import { useState, useEffect, useRef } from 'react'

/** 流式期间每帧推进间隔（毫秒） */
const STREAM_TICK_MS = 66

/** 收尾动画每帧推进间隔（毫秒） */
const CATCH_UP_TICK_MS = 50

/** 间距小于等于此值时一次性补齐，避免逐字符抖动 */
const DIRECT_FINISH_GAP = 3

/** 流式期间每帧推进比例 */
const STREAM_FACTOR = 0.15

/** 收尾动画每帧推进比例 */
const CATCH_UP_FACTOR = 0.25

/** 计算单步推进字符数 */
function computeStep(gap: number, factor: number): number {
  if (gap <= DIRECT_FINISH_GAP) return gap
  return Math.max(1, Math.ceil(gap * factor))
}

/** 推进显示长度并返回新内容切片 */
function advance(
  content: string,
  currentLen: number,
  factor: number,
): { nextLen: number; slice: string } | null {
  const target = content.length
  if (currentLen >= target) return null
  const step = computeStep(target - currentLen, factor)
  const nextLen = Math.min(target, currentLen + step)
  return { nextLen, slice: content.slice(0, nextLen) }
}

/**
 * 平滑流式文本插值器
 *
 * 在流式输出期间按固定时间步推进显示长度，收尾时以更高比例补齐剩余内容，
 * 避免内容突变造成的视觉跳动。
 */
export function useSmoothStream(
  content: string,
  isStreaming: boolean,
  speedMultiplier = 1,
): { displayedContent: string } {
  const [displayedContent, setDisplayedContent] = useState(() =>
    isStreaming ? '' : content,
  )
  const contentRef = useRef(content)
  const displayedLenRef = useRef(isStreaming ? 0 : content.length)
  const streamTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const catchUpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** 清理收尾动画定时器 */
  const clearCatchUp = () => {
    if (catchUpTimerRef.current !== null) {
      clearTimeout(catchUpTimerRef.current)
      catchUpTimerRef.current = null
    }
  }

  /** 清理流式定时器 */
  const clearStream = () => {
    if (streamTimerRef.current !== null) {
      clearTimeout(streamTimerRef.current)
      streamTimerRef.current = null
    }
  }

  // 同步内容引用，并处理内容回退或收尾动画
  useEffect(() => {
    contentRef.current = content

    if (content.length < displayedLenRef.current) {
      displayedLenRef.current = content.length
      setDisplayedContent(content)
      return
    }

    if (isStreaming) return

    if (displayedLenRef.current < content.length && catchUpTimerRef.current === null) {
      const factor = CATCH_UP_FACTOR * speedMultiplier
      const runCatchUp = () => {
        const advanced = advance(contentRef.current, displayedLenRef.current, factor)
        if (!advanced) {
          catchUpTimerRef.current = null
          return
        }
        displayedLenRef.current = advanced.nextLen
        setDisplayedContent(advanced.slice)
        catchUpTimerRef.current = setTimeout(runCatchUp, CATCH_UP_TICK_MS)
      }
      catchUpTimerRef.current = setTimeout(runCatchUp, CATCH_UP_TICK_MS)
    } else if (displayedLenRef.current >= content.length) {
      setDisplayedContent(content)
      displayedLenRef.current = content.length
    }
  }, [content, isStreaming, speedMultiplier])

  // 流式期间推进循环
  useEffect(() => {
    if (!isStreaming) return

    clearCatchUp()

    const factor = STREAM_FACTOR * speedMultiplier
    const runStream = () => {
      const advanced = advance(contentRef.current, displayedLenRef.current, factor)
      if (advanced) {
        displayedLenRef.current = advanced.nextLen
        setDisplayedContent(advanced.slice)
      }
      streamTimerRef.current = setTimeout(runStream, STREAM_TICK_MS)
    }
    streamTimerRef.current = setTimeout(runStream, STREAM_TICK_MS)

    return clearStream
  }, [isStreaming, speedMultiplier])

  // 卸载时清理所有定时器
  useEffect(() => {
    return () => {
      clearCatchUp()
      clearStream()
    }
  }, [])

  return { displayedContent }
}
