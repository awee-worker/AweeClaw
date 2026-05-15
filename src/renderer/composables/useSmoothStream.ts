import { useState, useEffect, useRef } from 'react'

const STREAM_INTERVAL_MS = 66
const CATCH_UP_INTERVAL_MS = 50

export function useSmoothStream(content: string, isStreaming: boolean, speedMultiplier = 1) {
  const [displayedContent, setDisplayedContent] = useState(() => isStreaming ? '' : content)
  const contentRef = useRef(content)
  const displayedLenRef = useRef(isStreaming ? 0 : content.length)
  const catchUpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    contentRef.current = content

    if (content.length < displayedLenRef.current) {
      displayedLenRef.current = content.length
      setDisplayedContent(content)
      return
    }

    if (!isStreaming) {
      if (displayedLenRef.current < content.length && catchUpTimerRef.current === null) {
        const factor = 0.25 * speedMultiplier
        const catchUp = () => {
          const target = contentRef.current.length
          const current = displayedLenRef.current
          if (current < target) {
            const gap = target - current
            const step = gap <= 3 ? gap : Math.max(1, Math.ceil(gap * factor))
            displayedLenRef.current = Math.min(target, current + step)
            setDisplayedContent(contentRef.current.slice(0, displayedLenRef.current))
            catchUpTimerRef.current = setTimeout(catchUp, CATCH_UP_INTERVAL_MS)
          } else {
            catchUpTimerRef.current = null
          }
        }
        catchUpTimerRef.current = setTimeout(catchUp, CATCH_UP_INTERVAL_MS)
      } else if (displayedLenRef.current >= content.length) {
        setDisplayedContent(content)
        displayedLenRef.current = content.length
      }
    }
  }, [content, isStreaming, speedMultiplier])

  useEffect(() => {
    if (!isStreaming) return

    if (catchUpTimerRef.current !== null) {
      clearTimeout(catchUpTimerRef.current)
      catchUpTimerRef.current = null
    }

    let timerId: ReturnType<typeof setTimeout>
    const factor = 0.15 * speedMultiplier

    const tick = () => {
      const targetLen = contentRef.current.length
      const currentLen = displayedLenRef.current

      if (currentLen < targetLen) {
        const gap = targetLen - currentLen
        const step = gap <= 3 ? gap : Math.max(1, Math.ceil(gap * factor))
        const newLen = Math.min(targetLen, currentLen + step)
        displayedLenRef.current = newLen
        setDisplayedContent(contentRef.current.slice(0, newLen))
      }

      timerId = setTimeout(tick, STREAM_INTERVAL_MS)
    }

    timerId = setTimeout(tick, STREAM_INTERVAL_MS)
    return () => clearTimeout(timerId)
  }, [isStreaming, speedMultiplier])

  useEffect(() => {
    return () => {
      if (catchUpTimerRef.current !== null) clearTimeout(catchUpTimerRef.current)
    }
  }, [])

  return { displayedContent }
}
