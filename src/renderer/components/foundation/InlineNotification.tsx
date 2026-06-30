import { useState, useCallback, createContext, useContext, ReactNode } from 'react'

export type ToastType = 'success' | 'error' | 'warning' | 'info'
export type ToastVariant = 'inline' | 'card'

export interface ToastAction {
  id: string
  label: string
  style?: 'primary' | 'secondary' | 'ghost'
  onClick?: () => void
}

export interface NotificationEntry {
  id: string
  type: ToastType
  variant: ToastVariant
  title?: string
  message: string
  duration?: number
  timestamp: number
  source?: string
  dedupeKey?: string
  actions?: ToastAction[]
}

export type ToastMessage = NotificationEntry

interface CardOptions {
  type?: ToastType
  title: string
  message: string
  actions?: ToastAction[]
  duration?: number
  source?: string
  dedupeKey?: string
}

interface NotificationContextValue {
  toasts: NotificationEntry[]
  visibleIds: string[]
  addToast: (type: ToastType, message: string, durationOrDetail?: number | string) => string
  showCard: (options: CardOptions) => string
  removeToast: (id: string) => void
  dismissToast: (id: string) => void
  success: (message: string, durationOrDetail?: number | string) => string
  error: (message: string, durationOrDetail?: number | string) => string
  warning: (message: string, durationOrDetail?: number | string) => string
  info: (message: string, durationOrDetail?: number | string) => string
}

const NotificationCtx = createContext<NotificationContextValue | null>(null)

function uid(tag: string): string {
  return `${tag}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

const MAX_QUEUE = 50
const MAX_VISIBLE = 5
// 默认右上角弹窗自动消失时长：4s
const DEFAULT_LIFE_MS = 4000

export function InlineNotificationProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<NotificationEntry[]>([])
  const [visibleIds, setVisibleIds] = useState<string[]>([])

  const autoHide = useCallback((id: string, lifeMs: number) => {
    if (lifeMs <= 0) return
    setTimeout(() => setVisibleIds(prev => prev.filter(v => v !== id)), lifeMs)
  }, [])

  /**
   * 默认以「右上角卡片弹窗」展示，4s 自动消失。
   *
   * 调用方传参语义：
   *   - message：主标题
   *   - durationOrDetail：
   *       string => 作为消息详情（正文）展示，时长用默认 4s
   *       number => 覆盖自动消失时长（ms），无详情正文
   */
  const addToast = useCallback((type: ToastType, message: string, durationOrDetail?: number | string) => {
    const id = uid('ntf')
    const title = message
    let body = ''
    let lifeMs = DEFAULT_LIFE_MS
    if (typeof durationOrDetail === 'string' && durationOrDetail) body = durationOrDetail
    else if (typeof durationOrDetail === 'number') lifeMs = durationOrDetail

    const entry: NotificationEntry = {
      id,
      type,
      variant: 'card',
      title,
      message: body,
      duration: lifeMs,
      timestamp: Date.now(),
    }
    setEntries(prev => (prev.length >= MAX_QUEUE ? prev.slice(1) : prev).concat(entry))
    setVisibleIds(prev => (prev.length >= MAX_VISIBLE ? prev.slice(-MAX_VISIBLE + 1) : prev).concat(id))
    autoHide(id, lifeMs)
    return id
  }, [autoHide])

  const showCard = useCallback((opts: CardOptions) => {
    const existing = opts.dedupeKey ? entries.find(e => e.dedupeKey === opts.dedupeKey) : null
    if (existing) {
      setEntries(prev => prev.map(e => e.id === existing.id ? { ...e, ...opts, variant: 'card' as ToastVariant, timestamp: Date.now() } : e))
      setVisibleIds(prev => prev.includes(existing.id) ? prev : prev.concat(existing.id))
      autoHide(existing.id, opts.duration ?? 0)
      return existing.id
    }
    const id = uid('card')
    const entry: NotificationEntry = { id, type: opts.type || 'info', variant: 'card', title: opts.title, message: opts.message, duration: opts.duration ?? 0, timestamp: Date.now(), source: opts.source, dedupeKey: opts.dedupeKey, actions: opts.actions }
    setEntries(prev => (prev.length >= MAX_QUEUE ? prev.slice(1) : prev).concat(entry))
    setVisibleIds(prev => prev.filter(v => v !== id).concat(id))
    autoHide(id, entry.duration ?? 0)
    return id
  }, [autoHide, entries])

  const removeToast = useCallback((id: string) => {
    setEntries(prev => prev.filter(e => e.id !== id))
    setVisibleIds(prev => prev.filter(v => v !== id))
  }, [])

  const dismissToast = useCallback((id: string) => {
    setVisibleIds(prev => prev.filter(v => v !== id))
  }, [])

  const success = useCallback((msg: string, d?: number | string) => addToast('success', msg, d), [addToast])
  const error = useCallback((msg: string, d?: number | string) => addToast('error', msg, d), [addToast])
  const warning = useCallback((msg: string, d?: number | string) => addToast('warning', msg, d), [addToast])
  const info = useCallback((msg: string, d?: number | string) => addToast('info', msg, d), [addToast])

  return (
    <NotificationCtx.Provider value={{ toasts: entries, visibleIds, addToast, showCard, removeToast, dismissToast, success, error, warning, info }}>
      {children}
    </NotificationCtx.Provider>
  )
}

export function useInlineToast() {
  const ctx = useContext(NotificationCtx)
  if (!ctx) throw new Error('useInlineToast must be used within InlineNotificationProvider')
  return ctx
}

let globalRef: NotificationContextValue | null = null
export function setGlobalInlineToast(ref: NotificationContextValue) { globalRef = ref }

export const toast = {
  success: (msg: string, d?: number | string) => globalRef?.success(msg, d),
  error: (msg: string, d?: number | string) => globalRef?.error(msg, d),
  warning: (msg: string, d?: number | string) => globalRef?.warning(msg, d),
  info: (msg: string, d?: number | string) => globalRef?.info(msg, d),
  card: (opts: CardOptions) => globalRef?.showCard(opts),
  dismiss: (id: string) => globalRef?.dismissToast(id),
  remove: (id: string) => globalRef?.removeToast(id),
}

export const InlineToastProvider = InlineNotificationProvider
export type ShowCardOptions = CardOptions
