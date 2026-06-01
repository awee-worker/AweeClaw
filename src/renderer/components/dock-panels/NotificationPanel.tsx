import { useState, useCallback } from 'react'
import { Trash2, CheckCircle2, XCircle, AlertTriangle, Info, CheckCheck, Copy, Check } from 'lucide-react'
import { useInlineToast } from '@components/foundation/InlineNotification'
import { t, type Language } from '@renderer/i18n'

interface NotificationCenterContentProps {
  language?: 'en' | 'zh'
}

export default function NotificationCenterContent({ language = 'zh' }: NotificationCenterContentProps) {
  const { toasts, removeToast } = useInlineToast()
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const getIcon = (type: string) => {
    switch (type) {
      case 'success': return <CheckCircle2 className="w-4 h-4 text-emerald-400" />
      case 'error': return <XCircle className="w-4 h-4 text-red-400" />
      case 'warning': return <AlertTriangle className="w-4 h-4 text-amber-400" />
      case 'info':
      default: return <Info className="w-4 h-4 text-blue-400" />
    }
  }

  const formatTime = (ts: number) => {
    const diff = Date.now() - ts
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return t('app.justnow', language as Language)
    if (mins < 60) return `${mins}${t('app.mago', language as Language)}`
    return `${Math.floor(mins / 60)}${t('app.hago', language as Language)}`
  }

  const handleCopy = useCallback((id: string, message: string) => {
    navigator.clipboard.writeText(message).catch(() => {})
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }, [])

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-auto custom-scrollbar p-2">
        {toasts.length === 0 ? (
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
                      <span className="rounded-full border border-white/8 bg-white/[0.04] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-text-muted">
                        {toast.variant}
                      </span>
                    </div>
                  )}
                  <div className="text-[11.5px] font-medium text-text-primary/95 leading-relaxed whitespace-pre-wrap break-words">
                    {toast.message}
                  </div>
                </div>

                <div className="absolute right-2 top-1.5 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <span className="text-[10px] text-text-muted/85 font-mono tracking-wide px-1">
                    {formatTime(toast.timestamp || Date.now())}
                  </span>
                  <button
                    onClick={() => handleCopy(toast.id, toast.message)}
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
