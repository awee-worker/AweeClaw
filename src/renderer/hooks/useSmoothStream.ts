import { useState, useEffect, useRef } from 'react'

export function useSmoothStream(content: string, isStreaming: boolean, speedMultiplier = 1) {
  const [displayedContent, setDisplayedContent] = useState(() => isStreaming ? '' : content)
  const contentRef = useRef(content)
  const displayedLenRef = useRef(isStreaming ? 0 : content.length)
  const catchUpRafRef = useRef<number | null>(null)

  useEffect(() => {
    contentRef.current = content

    if (content.length < displayedLenRef.current) {
      displayedLenRef.current = content.length
      setDisplayedContent(content)
      return
    }

    if (!isStreaming) {
      if (displayedLenRef.current < content.length && catchUpRafRef.current === null) {
        const factor = 0.25 * speedMultiplier
        const catchUp = () => {
          const target = contentRef.current.length
          const current = displayedLenRef.current
          if (current < target) {
            const gap = target - current
            const step = gap <= 3 ? gap : Math.max(1, Math.ceil(gap * factor))
            displayedLenRef.current = Math.min(target, current + step)
            setDisplayedContent(contentRef.current.slice(0, displayedLenRef.current))
            catchUpRafRef.current = requestAnimationFrame(catchUp)
          } else {
            catchUpRafRef.current = null
          }
        }
        catchUpRafRef.current = requestAnimationFrame(catchUp)
      } else if (displayedLenRef.current >= content.length) {
        setDisplayedContent(content)
        displayedLenRef.current = content.length
      }
    }
  }, [content, isStreaming, speedMultiplier])

  useEffect(() => {
    if (!isStreaming) return

    if (catchUpRafRef.current !== null) {
      cancelAnimationFrame(catchUpRafRef.current)
      catchUpRafRef.current = null
    }

    let rafId: number
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

      rafId = requestAnimationFrame(tick)
    }

    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [isStreaming, speedMultiplier])

  useEffect(() => {
    return () => {
      if (catchUpRafRef.current !== null) cancelAnimationFrame(catchUpRafRef.current)
    }
  }, [])

  return { displayedContent }
}
