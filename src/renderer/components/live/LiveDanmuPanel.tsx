/**
 * LiveDanmuPanel — 主窗口实时弹幕流面板
 *
 * 直播互动链路的渲染层出口：订阅 `live:event`（主进程 LiveManager 转发的
 * 归一化事件），在主窗口右下角以可折叠浮层实时展示弹幕。
 *
 * 设计要点：
 * 1. **懒订阅**：每 5s 轮询一次配置总开关，总开关关闭时不订阅、不渲染，
 *    避免直播功能全程挂着一个空转的监听器。
 * 2. **未读徽标**：折叠态收到新事件时累计未读数，展开后清零。
 * 3. **容量上限**：只保留最近 30 条，超出从头部丢弃，避免长播场景内存增长。
 * 4. **异常隔离**：订阅/轮询失败静默降级（live 链路是宿主，不能反噬主窗口）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, RadioTower } from 'lucide-react'
import { api } from '@renderer/adapters/electronBridge'
import type { LiveEvent } from '@renderer/types/electronBridge'

/** 面板最多保留的事件条数 */
const MAX_EVENTS = 30

/** 总开关轮询间隔（ms） */
const ENABLED_POLL_INTERVAL_MS = 5000

/** 弹幕类型的中文名（与设置页文案保持一致的语义） */
const DANMU_TYPE_LABELS: Record<string, string> = {
  danmaku: '弹幕',
  gift: '礼物',
  buy_guard: '上舰',
  super_chat: 'SC',
  enter_room: '进入',
  follow: '关注',
  like: '点赞',
}

export function LiveDanmuPanel() {
  const [enabled, setEnabled] = useState(false)
  const [events, setEvents] = useState<LiveEvent[]>([])
  const [expanded, setExpanded] = useState(false)
  const [unread, setUnread] = useState(0)

  const expandedRef = useRef(expanded)
  expandedRef.current = expanded

  // --------------------------------------------
  // 总开关轮询（开关关闭时面板整体隐藏，且不订阅事件）
  // --------------------------------------------
  useEffect(() => {
    let disposed = false

    const poll = async (): Promise<void> => {
      try {
        const res = await api.live.getConfig()
        if (disposed) return
        setEnabled(!!res.success && !!res.data?.config.enabled)
      } catch {
        // 静默降级：保持上一次状态
      }
    }

    void poll()
    const timer = setInterval(() => void poll(), ENABLED_POLL_INTERVAL_MS)
    return () => {
      disposed = true
      clearInterval(timer)
    }
  }, [])

  // --------------------------------------------
  // 事件订阅（仅在总开关开启时挂载）
  // --------------------------------------------
  useEffect(() => {
    if (!enabled) {
      setEvents([])
      setUnread(0)
      return
    }

    const unsubscribe = api.live.onEvent(event => {
      if (!event?.id) return
      setEvents(prev => {
        const next = [event, ...prev]
        return next.length > MAX_EVENTS ? next.slice(0, MAX_EVENTS) : next
      })
      if (!expandedRef.current) setUnread(prev => prev + 1)
    })

    return unsubscribe
  }, [enabled])

  // --------------------------------------------
  // 展开时清零未读
  // --------------------------------------------
  const handleToggle = useCallback(() => {
    setExpanded(prev => !prev)
    setUnread(0)
  }, [])

  if (!enabled) return null

  return (
    <div className="pointer-events-none fixed right-4 bottom-16 z-50 flex flex-col items-end">
      <div
        className={`pointer-events-auto flex flex-col overflow-hidden rounded-2xl border border-border/50 bg-surface/90 shadow-lg backdrop-blur transition-all duration-200 ${
          expanded ? 'max-h-80 w-80' : 'h-9 w-9'
        }`}
      >
        {/* 头部：折叠态 = 图标按钮 + 未读徽标；展开态 = 标题栏 */}
        {expanded ? (
          <div className="flex flex-shrink-0 items-center justify-between border-b border-border/40 px-3 py-1.5">
            <div className="flex items-center gap-1.5 text-xs font-medium text-text-primary">
              <RadioTower className="h-3.5 w-3.5" />
              实时弹幕
            </div>
            <button
              type="button"
              aria-label="收起弹幕面板"
              onClick={handleToggle}
              className="rounded p-0.5 text-text-muted hover:text-text-primary"
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            aria-label="展开弹幕面板"
            onClick={handleToggle}
            className="relative flex h-9 w-9 items-center justify-center text-text-muted hover:text-text-primary"
          >
            <RadioTower className="h-4 w-4" />
            {unread > 0 ? (
              <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-medium text-white">
                {unread > 99 ? '99+' : unread}
              </span>
            ) : null}
          </button>
        )}

        {/* 弹幕列表 */}
        {expanded ? (
          events.length === 0 ? (
            <div className="px-3 py-4 text-xs text-text-muted">
              等待弹幕… 可在 设置 → 直播互动 中推送自测事件
            </div>
          ) : (
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
              {events.map(event => (
                <div key={event.id} className="flex items-start gap-1.5 text-xs leading-relaxed">
                  <span className="flex-shrink-0 rounded bg-border/40 px-1 text-[10px] text-text-muted">
                    {event.platform}
                  </span>
                  {event.danmu_type !== 'danmaku' ? (
                    <span className="flex-shrink-0 rounded bg-accent/15 px-1 text-[10px] text-accent">
                      {DANMU_TYPE_LABELS[event.danmu_type] ?? event.danmu_type}
                    </span>
                  ) : null}
                  <span className="min-w-0 break-all text-text-primary">{event.content}</span>
                </div>
              ))}
            </div>
          )
        ) : null}
      </div>
    </div>
  )
}
