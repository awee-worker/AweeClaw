/**
 * 邮件列表（虚拟滚动）
 *
 * 邮件数量可能达到数百条，一次性渲染全部 DOM 会造成明显卡顿。
 * 这里采用固定行高的窗口化渲染：仅渲染可视区 ± 缓冲区的行，
 * 通过撑高的占位容器维持正确的滚动条长度。
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Paperclip, Star } from 'lucide-react'
import type { MailMessageMeta } from '@shared/protocols/mail'

interface MailListViewProps {
  messages: MailMessageMeta[]
  selectedKey: string | null
  onSelect: (message: MailMessageMeta) => void
  /** 空态提示文案 */
  emptyText: string
}

/** 固定行高（px），虚拟滚动依赖它计算总高度 */
const ROW_HEIGHT = 76
/** 可视区上下额外渲染的行数，减少快速滚动时的白屏 */
const OVERSCAN = 6

/** 格式化列表时间：当天显示 HH:mm，否则显示 M月D日 */
function formatListDate(ts: number, zh: boolean): string {
  const d = new Date(ts)
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  if (sameDay) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  return zh ? `${d.getMonth() + 1}月${d.getDate()}日` : `${d.getMonth() + 1}/${d.getDate()}`
}

/** 展示名：优先显示名，其次地址 */
function displayName(addr?: { name?: string; address: string }): string {
  if (!addr) return ''
  return addr.name || addr.address
}

export function MailListView({ messages, selectedKey, onSelect, emptyText }: MailListViewProps) {
  const zh = true
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(600)

  // 视口高度变化（窗口调整）时重新计算可见区间
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const update = () => setViewportHeight(el.clientHeight || 600)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // 切换列表内容时回到顶部，避免停留在旧滚动位置
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = 0
    setScrollTop(0)
  }, [messages])

  const { startIndex, endIndex, offsetY, totalHeight } = useMemo(() => {
    const total = messages.length * ROW_HEIGHT
    const visibleCount = Math.ceil(viewportHeight / ROW_HEIGHT)
    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
    const end = Math.min(messages.length, start + visibleCount + OVERSCAN * 2)
    return {
      startIndex: start,
      endIndex: end,
      offsetY: start * ROW_HEIGHT,
      totalHeight: total,
    }
  }, [messages.length, scrollTop, viewportHeight])

  const visible = messages.slice(startIndex, endIndex)

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-text-muted px-6 text-center">
        {emptyText}
      </div>
    )
  }

  return (
    <div
      ref={scrollRef}
      onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
      className="flex-1 overflow-y-auto"
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div style={{ transform: `translateY(${offsetY}px)` }}>
          {visible.map((msg) => {
            const key = `${msg.accountId}#${msg.folder}#${msg.uid}`
            const active = key === selectedKey
            const unread = !msg.seen
            return (
              <div
                key={key}
                onClick={() => onSelect(msg)}
                style={{ height: ROW_HEIGHT }}
                className={`px-4 py-2.5 border-b border-border/20 cursor-pointer transition-colors ${
                  active ? 'bg-accent/10' : 'hover:bg-surface/50'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`text-xs truncate ${unread ? 'font-semibold text-text-primary' : 'text-text-secondary'}`}
                  >
                    {displayName(msg.from[0]) || '(未知发件人)'}
                  </span>
                  <span className="text-[10px] text-text-muted shrink-0">
                    {formatListDate(msg.date, zh)}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 mt-1">
                  {unread && <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />}
                  <span
                    className={`text-xs truncate ${unread ? 'text-text-primary' : 'text-text-secondary'}`}
                  >
                    {msg.subject}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-1 text-[10px] text-text-muted">
                  {msg.flagged && <Star className="w-3 h-3 text-amber-400 fill-amber-400" />}
                  {msg.hasAttachments && (
                    <span className="flex items-center gap-0.5">
                      <Paperclip className="w-3 h-3" />
                      {msg.attachmentCount}
                    </span>
                  )}
                  {msg.ai?.category && (
                    <span className="px-1.5 py-0.5 rounded bg-accent/10 text-accent">
                      {msg.ai.category}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
