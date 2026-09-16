import { useState, useCallback, useEffect } from 'react'
import { Trash2, CheckCircle2, XCircle, AlertTriangle, Info, CheckCheck, Copy, Check, Loader2 } from 'lucide-react'
import { useInlineToast } from '@components/foundation/InlineNotification'
import { t, type Language } from '@renderer/i18n'
import { useStore } from '@store'
import {
  useUserNotificationStore,
  classifyNotification,
  type UserNotificationItem,
  type NotificationLevel,
} from '@store/userNotificationStore'

interface NotificationCenterContentProps {
  language?: 'en' | 'zh'
  /** 点击通知条目完成跳转后回调：父组件据此收起 popover */
  onNavigate?: () => void
}

/** 面板分段：系统通知（后端）/ 运行消息（本地 toast） */
type PanelTab = 'system' | 'runtime'

export default function NotificationCenterContent({ language = 'zh', onNavigate }: NotificationCenterContentProps) {
  const zh = language === 'zh'
  const { toasts, removeToast } = useInlineToast()
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [tab, setTab] = useState<PanelTab>('system')

  const notifications = useUserNotificationStore(s => s.items)
  const unreadCount = useUserNotificationStore(s => s.unreadCount)
  const loadingNotifications = useUserNotificationStore(s => s.loading)
  const includeRead = useUserNotificationStore(s => s.includeRead)
  const fetchNotifications = useUserNotificationStore(s => s.fetch)
  const markRead = useUserNotificationStore(s => s.markRead)
  const markAllRead = useUserNotificationStore(s => s.markAllRead)

  // 面板打开时同步一次，避免用户盯着 60s 轮询的延迟
  useEffect(() => {
    void fetchNotifications({ silent: true })
  }, [fetchNotifications])

  /** 通知类型 → 目标页面（到期提醒都带明确的处理入口） */
  const resolveTarget = useCallback(
    (type: string): 'scenario' | 'plugin' | 'billing' | null => {
      if (type.startsWith('scenario_')) return 'scenario'
      if (type.startsWith('plugin_')) return 'plugin'
      if (type.startsWith('subscription_')) return 'billing'
      return null
    },
    [],
  )

  /** 点击通知：标记已读 + 跳转到对应页面 */
  const handleOpenNotification = useCallback(
    (item: UserNotificationItem) => {
      void markRead(item.id)

      const target = resolveTarget(item.type)
      if (!target) return

      const store = useStore.getState()
      store.closeAllFullPages?.()
      if (target === 'scenario') store.setShowScenarioPage(true)
      else if (target === 'plugin') store.setShowPluginCenterPage(true)
      else store.setShowBillingCenterPage(true)

      onNavigate?.()
    },
    [markRead, resolveTarget, onNavigate],
  )

  const getIcon = (type: string) => {
    switch (type) {
      case 'success': return <CheckCircle2 className="w-4 h-4 text-emerald-400" />
      case 'error': return <XCircle className="w-4 h-4 text-red-400" />
      case 'warning': return <AlertTriangle className="w-4 h-4 text-amber-400" />
      case 'info':
      default: return <Info className="w-4 h-4 text-blue-400" />
    }
  }

  /** 后端通知按业务语义着色：到期预警 / 已过期 / 成功 / 一般 */
  const getNotificationIcon = (level: NotificationLevel) => {
    switch (level) {
      case 'warning': return <AlertTriangle className="w-4 h-4 text-amber-400" />
      case 'error': return <XCircle className="w-4 h-4 text-red-400" />
      case 'success': return <CheckCircle2 className="w-4 h-4 text-emerald-400" />
      default: return <Info className="w-4 h-4 text-blue-400" />
    }
  }

  const formatTime = (ts: number) => {
    const diff = Date.now() - ts
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return t('app.justnow', language as Language)
    if (mins < 60) return t('app.mago', language as Language, { diffMins: mins })
    return t('app.hago', language as Language, { diffHours: Math.floor(mins / 60) })
  }

  /** 后端通知时间：近 24 小时用相对时间，更早显示日期 */
  const formatNotificationTime = (iso: string) => {
    const ts = new Date(iso).getTime()
    if (Number.isNaN(ts)) return ''
    const mins = Math.floor((Date.now() - ts) / 60000)
    if (mins < 24 * 60) return formatTime(ts)
    return new Date(ts).toLocaleDateString(zh ? 'zh-CN' : 'en-US')
  }

  /**
   * 复制通知内容到剪贴板
   *
   * 通知数据模型中 title 是主标题、message 是正文详情。
   * 多数通知（如 toast.success('文件已保存')）只填充了 title，message 为空字符串，
   * 因此需要取「用户实际可见的内容」：
   * - 两者都有：拼接为 "标题\n正文"
   * - 只有 title（message 为空）：复制 title
   * - 只有 message（title 为空）：复制 message
   */
  const handleCopy = useCallback(async (id: string, title: string | undefined, message: string) => {
    const parts = [title, message].filter((s): s is string => !!s && s.trim().length > 0)
    const text = parts.join('\n')
    if (!text) return

    try {
      await navigator.clipboard.writeText(text)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch {
      // 剪贴板 API 不可用时静默失败（不显示虚假的"已复制"对勾）
    }
  }, [])

  const tabButtonClass = (active: boolean) =>
    `flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors ${
      active ? 'bg-accent/15 text-accent' : 'text-text-muted hover:text-text-primary hover:bg-white/[0.05]'
    }`

  return (
    <div className="h-full flex flex-col">
      {/* 分段切换：系统通知（需持久化）与运行消息（本地 toast）语义不同，分开呈现 */}
      <div className="shrink-0 flex items-center gap-1 px-2 pt-2">
        <button className={tabButtonClass(tab === 'system')} onClick={() => setTab('system')}>
          {zh ? '系统通知' : 'Notifications'}
          {unreadCount > 0 && (
            <span className="min-w-[16px] h-[16px] px-1 flex items-center justify-center text-[10px] font-semibold bg-accent text-white rounded-full">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
        <button className={tabButtonClass(tab === 'runtime')} onClick={() => setTab('runtime')}>
          {zh ? '运行消息' : 'Activity'}
          {toasts.length > 0 && (
            <span className="min-w-[16px] h-[16px] px-1 flex items-center justify-center text-[10px] font-semibold bg-white/10 text-text-muted rounded-full">
              {toasts.length}
            </span>
          )}
        </button>
        <div className="flex-1" />
        {tab === 'system' && unreadCount > 0 && (
          <button
            onClick={() => void markAllRead()}
            className="p-1 rounded-md text-text-muted hover:text-accent hover:bg-accent/10 transition-colors"
            title={zh ? '全部标记为已读' : 'Mark all as read'}
          >
            <CheckCheck className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-auto custom-scrollbar p-2">
        {tab === 'system' ? (
          loadingNotifications && notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-text-muted gap-3 opacity-60">
              <Loader2 className="w-6 h-6 animate-spin opacity-50" />
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-text-muted gap-3 opacity-60">
              <CheckCheck className="w-8 h-8 opacity-40" />
              <span className="text-[12px] font-medium tracking-wide">
                {zh ? '暂无通知' : 'No notifications'}
              </span>
            </div>
          ) : (
            <div className="space-y-1.5">
              {notifications.map((item) => {
                const target = resolveTarget(item.type)
                return (
                  <div
                    key={item.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleOpenNotification(item)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') handleOpenNotification(item)
                    }}
                    className={`group relative flex items-start gap-3 px-3.5 py-3 rounded-[10px] border cursor-pointer transition-all overflow-hidden ${
                      item.isRead
                        ? 'bg-white/[0.02] border-white/[0.03] hover:bg-white/[0.04] hover:border-white/10'
                        : 'bg-accent/[0.06] border-accent/20 hover:bg-accent/[0.1]'
                    }`}
                  >
                    <div className="shrink-0 mt-[1px]">
                      {getNotificationIcon(classifyNotification(item.type))}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="mb-1 flex items-center gap-2">
                        <span className="text-[12px] font-semibold text-text-primary truncate">
                          {item.title}
                        </span>
                        {!item.isRead && (
                          <span className="shrink-0 w-1.5 h-1.5 bg-accent rounded-full" />
                        )}
                      </div>
                      {item.content && (
                        <p className="text-[12px] font-medium text-text-primary/90 leading-relaxed whitespace-pre-wrap break-words">
                          {item.content}
                        </p>
                      )}
                      <div className="mt-1.5 flex items-center gap-2 text-[12px] text-text-muted/70 font-mono tracking-wide">
                        <span>{formatNotificationTime(item.createdAt)}</span>
                        {target && (
                          <span className="text-accent font-sans">{zh ? '去处理 →' : 'Open →'}</span>
                        )}
                      </div>
                    </div>

                    {/* 仅标记已读、不跳转 */}
                    {!item.isRead && (
                      <span
                        role="button"
                        tabIndex={-1}
                        onClick={(e) => {
                          e.stopPropagation()
                          void markRead(item.id)
                        }}
                        className="absolute right-2 top-2 p-1 rounded-md text-text-muted/85 hover:text-text-primary hover:bg-white/5 opacity-0 group-hover:opacity-100 transition-all"
                        title={zh ? '标记已读' : 'Mark as read'}
                      >
                        <Check className="w-3.5 h-3.5" />
                      </span>
                    )}
                  </div>
                )
              })}

              {/* 已到期提醒被清理后仍可回看历史 */}
              <button
                onClick={() => void fetchNotifications({ includeRead: !includeRead })}
                className="w-full mt-1 px-2 py-2 text-[11px] text-text-muted hover:text-accent hover:bg-accent/[0.08] rounded-md transition-colors border border-border/30 border-dashed"
              >
                {includeRead
                  ? (zh ? '只看未读' : 'Unread only')
                  : (zh ? '查看历史通知' : 'Show history')}
              </button>
            </div>
          )
        ) : toasts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-text-muted gap-3 opacity-60">
            <CheckCheck className="w-8 h-8 opacity-40" />
            <span className="text-[12px] font-medium tracking-wide">{t('app.norecords', language as Language)}</span>
          </div>
        ) : (
          <div className="space-y-1.5">
            {[...toasts].reverse().map((toast) => (
              <div key={toast.id} className="group relative flex items-start gap-3 px-3.5 py-3 rounded-[10px] bg-white/[0.02] hover:bg-white/[0.04] border border-white/[0.03] hover:border-white/10 transition-all overflow-hidden">
                <div className="shrink-0 mt-[1px]">
                  {getIcon(toast.type)}
                </div>

                <div className="flex-1 min-w-0 flex flex-col pr-16">
                  {toast.title && (
                    <div className="mb-1 flex items-center gap-2">
                      <div className="text-[12px] font-semibold text-text-primary">
                        {toast.title}
                      </div>
                      <span className="rounded-full border border-white/8 bg-white/[0.04] px-1.5 py-0.5 text-[12px] uppercase tracking-wide text-text-muted">
                        {toast.variant}
                      </span>
                    </div>
                  )}
                  <div className="text-[12px] font-medium text-text-primary/95 leading-relaxed whitespace-pre-wrap break-words">
                    {toast.message}
                  </div>
                  {/* 时间常显在列表项底部 */}
                  <div className="mt-1.5 text-[12px] text-text-muted/70 font-mono tracking-wide">
                    {formatTime(toast.timestamp || Date.now())}
                  </div>
                  {/* 操作按钮（如"去更新"跳转） */}
                  {toast.actions && toast.actions.length > 0 && (
                    <div className="mt-2 flex items-center gap-2">
                      {toast.actions.map(action => (
                        <button
                          key={action.id}
                          onClick={() => {
                            action.onClick?.()
                            removeToast(toast.id)
                          }}
                          className="px-2.5 py-1 rounded-md text-[12px] font-medium bg-accent/15 text-accent hover:bg-accent/25 hover:text-accent transition-colors border border-accent/20"
                        >
                          {action.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="absolute right-2 top-1.5 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => handleCopy(toast.id, toast.title, toast.message)}
                    className="p-1.5 rounded-md text-text-muted/85 hover:text-text-primary hover:bg-white/5 transition-all"
                    title={copiedId === toast.id ? t('app.copied', language as Language) : t('app.copy', language as Language)}
                  >
                    {copiedId === toast.id
                      ? <Check className="w-3.5 h-3.5 text-green-400" />
                      : <Copy className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    onClick={() => removeToast(toast.id)}
                    className="p-1.5 rounded-md text-text-muted/85 hover:text-red-400 hover:bg-red-400/10 transition-all"
                    title={t('app.delete', language as Language)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function NotificationClearButton({ language = 'zh' }: { language?: 'en' | 'zh' }) {
  const { toasts, removeToast } = useInlineToast()
  const t = (zh: string, en: string) => (language === 'zh' ? zh : en)

  if (toasts.length === 0) return null

  return (
    <button
      onClick={() => toasts.forEach(t => removeToast(t.id))}
      className="p-1 rounded-md text-text-muted hover:text-red-400 hover:bg-red-400/10 transition-colors"
      title={t('app.clear', language as Language)}
    >
      <Trash2 className="w-3.5 h-3.5" />
    </button>
  )
}
