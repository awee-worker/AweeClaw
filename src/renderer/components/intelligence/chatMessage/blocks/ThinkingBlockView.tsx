/**
 * 思考过程块视图
 * 折叠式展示推理过程，支持流式动画和计时显示
 */
import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { ChevronDown } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useStore } from '@store'
import { useSmoothStream } from '@hooks/useSmoothStream'
import { t, type Language } from '@renderer/i18n'
import { renderStreamingTailText } from '../markdown/streamingDecorator'

interface ThinkingBlockViewProps {
  content: string
  startTime?: number
  isStreaming: boolean
  fontSize: number
}

function ThinkingBlockViewBase({ content, startTime, isStreaming, fontSize }: ThinkingBlockViewProps) {
  const language = useStore(s => s.language)
  const expandThinkingByDefault = useStore(s => s.agentConfig.expandThinkingByDefault ?? true)
  const [isExpanded, setIsExpanded] = useState(expandThinkingByDefault)
  const [elapsed, setElapsed] = useState<number>(0)
  const lastElapsed = useRef<number>(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [shadowClass, setShadowClass] = useState('')
  const prevIsStreamingRef = useRef(isStreaming)
  const userToggledRef = useRef(false)

  /** 流式开始时自动展开，结束时按用户偏好折叠 */
  useEffect(() => {
    if (isStreaming && !prevIsStreamingRef.current) {
      setIsExpanded(true)
      userToggledRef.current = false
    } else if (!isStreaming && prevIsStreamingRef.current) {
      if (!userToggledRef.current && !expandThinkingByDefault) {
        const timer = setTimeout(() => setIsExpanded(false), 600)
        return () => clearTimeout(timer)
      }
    }
    prevIsStreamingRef.current = isStreaming
  }, [isStreaming, expandThinkingByDefault])

  const handleToggle = useCallback(() => {
    userToggledRef.current = true
    setIsExpanded(prev => !prev)
  }, [])

  /** 计时器 */
  useEffect(() => {
    if (!startTime || !isStreaming) return
    const timer = setInterval(() => {
      const current = Math.floor((Date.now() - startTime) / 1000)
      setElapsed(current)
      lastElapsed.current = current
    }, 1000)
    return () => clearInterval(timer)
  }, [startTime, isStreaming])

  /** 滚动阴影检测 */
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !isExpanded) return
    const checkScroll = () => {
      const hasTop = el.scrollTop > 0
      const hasBottom = el.scrollTop < el.scrollHeight - el.clientHeight - 1
      setShadowClass([hasTop ? 'shadow-top' : '', hasBottom ? 'shadow-bottom' : ''].filter(Boolean).join(' '))
    }
    checkScroll()
    el.addEventListener('scroll', checkScroll)
    return () => el.removeEventListener('scroll', checkScroll)
  }, [isExpanded, content])

  const { displayedContent: fluidContent } = useSmoothStream(content, isStreaming, 1.5)

  /** 流式时自动滚动到底部 */
  useEffect(() => {
    if (isStreaming && isExpanded && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [fluidContent, isStreaming, isExpanded])

  const durationText = !isStreaming
    ? (lastElapsed.current > 0 ? t('thought.for', language, { sec: lastElapsed.current }) : t('thought.done', language))
    : t('thinking.for', language, { sec: elapsed })

  const previewText = useMemo(() => {
    if (!content || content.length === 0) return ''
    const firstLine = content.split('\n').find(l => l.trim().length > 0) || ''
    return firstLine.length > 60 ? firstLine.slice(0, 60) + '...' : firstLine
  }, [content])

  return (
    <div className="my-2.5 group/think overflow-hidden">
      <button
        onClick={handleToggle}
        className="flex w-full items-center gap-2 py-1.5 text-text-muted/85 hover:text-text-muted rounded-md hover:bg-text-primary/[0.03] transition-colors select-none"
      >
        <div className={`transition-transform duration-200 ${isExpanded ? 'rotate-0' : '-rotate-90'}`}>
          <ChevronDown className="w-3.5 h-3.5" />
        </div>
        <div className="flex items-center gap-1.5">
          {isStreaming ? (
            <span className="thinking-indicator-icon" />
          ) : (
            <span className="w-2 h-2 rounded-full bg-accent/25" />
          )}
        </div>
        <span className={`text-[12px] ${isStreaming ? 'text-accent/80 font-medium' : ''}`}>
          {durationText}
        </span>
        {!isExpanded && previewText && (
          <span className="text-[11px] text-text-muted/50 truncate max-w-[60%] ml-1">
            {previewText}
          </span>
        )}
        {!isExpanded && isStreaming && (
          <span className="w-1.5 h-1.5 rounded-full bg-accent/50 animate-breathe ml-0.5" />
        )}
      </button>

      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="relative ml-[14px] mt-0.5 mb-1">
              <div className={`absolute left-0 top-0 bottom-0 w-[2px] rounded-full ${isStreaming ? 'thinking-border-glow' : 'bg-accent/20'}`} />
              {isStreaming && (
                <div className="absolute left-0 top-0 bottom-0 w-[2px] rounded-full thinking-sweep-line" />
              )}
              <div className={`relative rounded-xl rounded-tl-none rounded-bl-none ${isStreaming ? 'bg-accent/[0.03]' : 'bg-surface/30'} border ${isStreaming ? 'border-accent/[0.08]' : 'border-border/30'} overflow-hidden`}>
                <div className={`scroll-shadow-container ${shadowClass}`}>
                  <div
                    ref={scrollRef}
                    className="max-h-[300px] overflow-y-auto scrollbar-none pl-5 pr-3 py-3"
                  >
                    {content ? (
                      <div
                        style={{ fontSize: `${fontSize - 1}px` }}
                        className={`text-text-muted/80 leading-relaxed whitespace-pre-wrap font-sans ${isStreaming ? 'animate-block-reveal' : ''}`}
                      >
                        {isStreaming ? renderStreamingTailText(fluidContent, 'think-tail') : fluidContent}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-text-muted/80 italic text-xs py-1">
                        <span className="text-shimmer">{t('ai.analyzing', language as Language)}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export const ThinkingBlockView = React.memo(ThinkingBlockViewBase)
ThinkingBlockView.displayName = 'ThinkingBlockView'
