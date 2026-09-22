/**
 * 页面健康指示灯
 *
 * 展示当前预览页面的健康状况（控制台告警与错误、资源加载失败、白屏、崩溃），
 * 点击展开明细。目标是无需打开 DevTools 就能判断「页面为什么不对」。
 */
import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, RefreshCw, XCircle } from 'lucide-react'
import type { PreviewHealthLevel, PreviewHealthSnapshot } from '@shared/protocols/previewProtocol'
import { useStore } from '@store'
import { t, type Language } from '@renderer/i18n'

interface BrowserHealthIndicatorProps {
  /** 健康快照；尚未采集到时为 undefined */
  health?: PreviewHealthSnapshot
  /**
   * 主动重新拉取一次快照
   *
   * 采集侧按节拍推送，且只推「有变化」的状态；面板展开时手动取一次实时快照，
   * 可以覆盖绑定未赶上、推送尚未到达这类空档。
   */
  onRecheck?: () => Promise<void> | void
}

/** 等级对应的颜色与文案 */
const LEVEL_STYLE: Record<PreviewHealthLevel, { dot: string; text: string; labelKey: string }> = {
  healthy: {
    dot: 'bg-status-success',
    text: 'text-status-success',
    labelKey: 'editor.browser.health.healthy',
  },
  warning: {
    dot: 'bg-status-warning',
    text: 'text-status-warning',
    labelKey: 'editor.browser.health.warning',
  },
  error: {
    dot: 'bg-status-error',
    text: 'text-status-error',
    labelKey: 'editor.browser.health.error',
  },
}

/** 明细面板宽度（px）：决定向左还是向右展开 */
const PANEL_WIDTH = 320

/** 面板与容器边缘至少留出的间隙（px） */
const PANEL_GAP = 8

/** 控制台来源只显示文件名，完整地址在窄面板里放不下 */
function shortSource(source: string): string {
  try {
    const pathname = new URL(source).pathname
    return pathname.split('/').filter(Boolean).pop() || source
  } catch {
    return source.split('/').filter(Boolean).pop() || source
  }
}

export default function BrowserHealthIndicator({ health, onRecheck }: BrowserHealthIndicatorProps) {
  const language = useStore((state) => state.language) as Language
  const [open, setOpen] = useState(false)
  /** 重新检测进行中：按钮转圈并置灰，避免连点 */
  const [rechecking, setRechecking] = useState(false)
  /** 展开方向：默认右对齐（贴按钮右侧），按钮靠近窗口左边时改为左对齐 */
  const [align, setAlign] = useState<'left' | 'right'>('right')
  const containerRef = useRef<HTMLDivElement | null>(null)

  // 页面切换后收起面板，避免展示上一页的明细
  useEffect(() => {
    setOpen(false)
  }, [health?.url])

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  /**
   * 展开明细面板
   *
   * 面板固定宽度，右对齐会让左边溢出到工具栏之外（被编辑器裁剪），
   * 因此打开前量一次按钮位置，哪一侧放得下就往哪一侧展开。
   */
  const togglePanel = () => {
    if (open) {
      setOpen(false)
      return
    }

    const rect = containerRef.current?.getBoundingClientRect()
    if (rect) {
      const fitsRight = rect.right - PANEL_WIDTH >= PANEL_GAP
      const fitsLeft = rect.left + PANEL_WIDTH <= window.innerWidth - PANEL_GAP
      setAlign(fitsRight || !fitsLeft ? 'right' : 'left')
    }
    setOpen(true)
  }

  /** 手动重新检测：取一次主进程的实时快照 */
  const handleRecheck = async () => {
    if (!onRecheck || rechecking) return

    setRechecking(true)
    try {
      await onRecheck()
    } finally {
      setRechecking(false)
    }
  }

  const tracked = Boolean(health)
  const level: PreviewHealthLevel = health?.level ?? 'healthy'
  const style = LEVEL_STYLE[level]
  const statusLabel = tracked
    ? t(style.labelKey, language)
    : t('editor.browser.health.untracked', language)

  const consoleMessages = health?.consoleMessages ?? []
  const loadFailures = health?.loadFailures ?? []
  const issueCount = consoleMessages.length + loadFailures.length
  const healthy = tracked && issueCount === 0 && !health?.blank && !health?.crashed

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        onClick={togglePanel}
        className="h-8 flex items-center gap-1.5 px-2 rounded-lg hover:bg-text-primary/[0.05] transition-colors"
        title={statusLabel}
        aria-label={statusLabel}
        aria-expanded={open}
      >
        <span
          className={`w-2 h-2 rounded-full ${tracked ? style.dot : 'bg-text-muted/40'}`}
          aria-hidden="true"
        />
        {tracked && issueCount > 0 && (
          <span className={`text-[11px] tabular-nums ${style.text}`}>{issueCount}</span>
        )}
      </button>

      {open && (
        <div
          className={`absolute top-9 z-20 max-h-80 overflow-y-auto custom-scrollbar rounded-xl border border-border/60 bg-background-editor shadow-xl p-3 space-y-2 ${align === 'right' ? 'right-0' : 'left-0'}`}
          style={{ width: PANEL_WIDTH }}
        >
          <div className="flex items-center gap-2">
            {healthy ? (
              <CheckCircle2 className={`w-4 h-4 shrink-0 ${style.text}`} />
            ) : level === 'error' ? (
              <XCircle className={`w-4 h-4 shrink-0 ${tracked ? style.text : 'text-text-muted'}`} />
            ) : (
              <AlertTriangle
                className={`w-4 h-4 shrink-0 ${tracked ? style.text : 'text-text-muted'}`}
              />
            )}
            <span className="text-sm font-medium text-text-primary">{statusLabel}</span>
          </div>

          {health?.crashed && (
            <p className="rounded-lg bg-status-error/10 px-2 py-1.5 text-[11px] text-status-error">
              {t('editor.browser.health.crashed', language)}
            </p>
          )}

          {health?.blank && (
            <p className="rounded-lg bg-status-warning/10 px-2 py-1.5 text-[11px] text-status-warning">
              {t('editor.browser.health.blank', language)}
            </p>
          )}

          {loadFailures.length > 0 && (
            <section className="space-y-1">
              <h4 className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
                {t('editor.browser.health.loadFailureTitle', language)}
              </h4>
              {loadFailures.map((failure, index) => (
                <div key={`${failure.url}-${index}`} className="rounded-lg bg-status-error/5 px-2 py-1.5">
                  <p className="break-all font-mono text-[11px] text-text-primary">{failure.url}</p>
                  <p className="mt-0.5 text-[11px] text-status-error/80">
                    {failure.errorDescription}
                  </p>
                </div>
              ))}
            </section>
          )}

          {consoleMessages.length > 0 && (
            <section className="space-y-1">
              <h4 className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
                {t('editor.browser.health.consoleTitle', language)}
              </h4>
              {consoleMessages.map((entry, index) => {
                const meta = [
                  entry.source ? shortSource(entry.source) : '',
                  entry.line > 0
                    ? t('editor.browser.health.line', language, { line: entry.line })
                    : '',
                  entry.count > 1
                    ? t('editor.browser.health.count', language, { count: entry.count })
                    : '',
                ]
                  .filter(Boolean)
                  .join(' · ')

                return (
                  <div key={`${entry.message}-${index}`} className="rounded-lg bg-text-primary/[0.03] px-2 py-1.5">
                    <p className="whitespace-pre-wrap break-words text-[11px] text-text-primary">
                      {entry.message}
                    </p>
                    {meta && <p className="mt-0.5 truncate text-[11px] text-text-muted">{meta}</p>}
                  </div>
                )
              })}
            </section>
          )}

          {healthy && (
            <p className="text-[11px] text-text-muted">
              {t('editor.browser.health.noIssues', language)}
            </p>
          )}

          {!tracked && (
            <p className="text-[11px] text-text-muted">
              {t('editor.browser.health.untracked', language)}
            </p>
          )}

          {onRecheck && (
            <button
              type="button"
              onClick={handleRecheck}
              disabled={rechecking}
              className="w-full h-7 flex items-center justify-center gap-1.5 rounded-lg border border-border/50 text-[11px] text-text-secondary hover:text-text-primary hover:bg-text-primary/[0.05] transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${rechecking ? 'animate-spin' : ''}`} />
              {t('editor.browser.health.refresh', language)}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
