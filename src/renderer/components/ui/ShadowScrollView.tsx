import { useRef, useState, useEffect, ReactNode, useCallback } from 'react'

interface ScrollShadowProps {
  children: ReactNode
  className?: string
  maxHeight?: string
  showScrollbar?: boolean
}

const THRESHOLD = 5
const SHADOW_H = 12

export function ShadowScrollView({ children, className = '', maxHeight = '400px', showScrollbar = false }: ScrollShadowProps) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [topGlow, setTopGlow] = useState(false)
  const [bottomGlow, setBottomGlow] = useState(false)

  const sync = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    const { scrollTop, scrollHeight, clientHeight } = el
    setTopGlow(scrollTop > THRESHOLD)
    setBottomGlow(scrollTop + clientHeight < scrollHeight - THRESHOLD)
  }, [])

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    sync()
    el.addEventListener('scroll', sync)
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    return () => { el.removeEventListener('scroll', sync); ro.disconnect() }
  }, [children, sync])

  return (
    <div className={`relative ${className}`}>
      <div className={`absolute top-0 left-0 right-0 h-${SHADOW_H} pointer-events-none z-10 transition-opacity duration-200 ${topGlow ? 'opacity-100' : 'opacity-0'}`} style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.1) 50%, transparent 100%)' }} />
      <div ref={scrollerRef} className={`overflow-y-auto ${showScrollbar ? '' : 'scrollbar-none'}`} style={{ maxHeight }}>{children}</div>
      <div className={`absolute bottom-0 left-0 right-0 h-${SHADOW_H} pointer-events-none z-10 transition-opacity duration-200 ${bottomGlow ? 'opacity-100' : 'opacity-0'}`} style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.1) 50%, transparent 100%)' }} />
    </div>
  )
}
