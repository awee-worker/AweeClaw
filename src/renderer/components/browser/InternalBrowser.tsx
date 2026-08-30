/**
 * 内部浏览器（自定义菜单）
 *
 * 复用客户端已有内置浏览器（workspace-editor/browser）的核心能力，不再重复实现 webview 逻辑：
 * - useWebviewController：webview 命令 + 派生状态 + 事件桥接（含 src 首次导航的时序处理，
 *   不会在 webview 未 dom-ready 时调用 loadURL）
 * - BrowserWebView：webview 容器（冻结初始 src，避免 src 导航与 loadURL 双重导航冲突）
 *
 * 本组件只负责：
 * - 内容区占位容器 + 工具栏 UI（关闭/后退/前进/刷新/地址栏/外部打开）
 * - 自定义菜单 URL 驱动的本地会话状态（不注册 previewSessionService，
 *   service 的方法对未知 session 全部 no-op，无副作用）
 */
import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, ExternalLink, Globe, Loader2, RefreshCw, X } from 'lucide-react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { t, type Language } from '@renderer/i18n'
import { api } from '@renderer/adapters/electronBridge'
import type { PreviewSession } from '@shared/protocols/previewProtocol'
import { useWebviewController } from '@components/workspace-editor/browser/hooks/useWebviewController'
import BrowserWebView from '@components/workspace-editor/browser/BrowserWebView'
import { sanitizeUrl } from '@components/workspace-editor/browser/hooks/usePreviewSessionSync'

export default function InternalBrowser() {
  const { url, title, closeInternalBrowser, language } = useStore(
    useShallow((s) => ({
      url: s.internalBrowserUrl,
      title: s.internalBrowserTitle,
      closeInternalBrowser: s.closeInternalBrowser,
      language: s.language,
    })),
  )

  // 本地会话状态：URL 驱动。初始导航由 BrowserWebView 的 src 属性完成，
  // 后续导航通过 session.url 变化触发 controller 的增量 loadURL（webview 已就绪）。
  const [session, setSession] = useState<PreviewSession | null>(() => ({
    id: `internal-browser-${Date.now().toString(36)}`,
    url: url ?? '',
    title: title ?? '',
    source: 'manual',
    status: 'loading',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    reloadToken: 0,
  }))
  const [address, setAddress] = useState(url ?? '')

  const controller = useWebviewController(session)

  // 外部 URL 变化（打开另一个自定义菜单）→ 同步到本地会话
  useEffect(() => {
    if (url && session?.url !== url) {
      setSession((prev) => (prev ? { ...prev, url, title: title ?? prev.title, updatedAt: Date.now() } : prev))
      setAddress(url)
    }
  }, [url, title, session?.url])

  // 地址栏提交导航
  const handleNavigate = useCallback((raw: string) => {
    const next = sanitizeUrl(raw)
    if (!next) return
    setAddress(next)
    setSession((prev) => (prev ? { ...prev, url: next, status: 'loading', updatedAt: Date.now() } : prev))
  }, [])

  // 还原地址栏为当前 URL
  const handleResetAddress = useCallback(() => {
    setAddress(session?.url ?? url ?? '')
  }, [session?.url, url])

  // 刷新：通过 reloadToken 机制触发 controller 内部的 webview.reload()
  const handleReload = useCallback(() => {
    setSession((prev) =>
      prev ? { ...prev, reloadToken: prev.reloadToken + 1, status: 'loading', updatedAt: Date.now() } : prev,
    )
  }, [])

  const handleOpenExternal = useCallback(() => {
    try {
      void api?.file?.openExternalUrl(session?.url ?? url ?? '')
    } catch {
      /* ignore */
    }
  }, [session?.url, url])

  if (!url) return null

  return (
    <div className="h-full w-full flex flex-col min-h-0 overflow-hidden bg-background">
      {/* 工具栏 */}
      <div className="flex items-center gap-1.5 h-11 px-2 border-b border-border/50 bg-background-secondary/60 shrink-0 select-none">
        {/* 关闭 */}
        <button
          onClick={closeInternalBrowser}
          title={t('layout.close', language as Language) || 'Close'}
          className="w-7 h-7 rounded-md flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-text-primary/[0.06] transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="w-px h-4 bg-border/50 mx-0.5" />

        {/* 后退 / 前进 / 刷新 */}
        <button
          onClick={controller.goBack}
          disabled={!controller.canGoBack}
          title={t('layout.browserback', language as Language) || 'Back'}
          className="w-7 h-7 rounded-md flex items-center justify-center text-text-muted disabled:opacity-30 enabled:hover:text-text-primary enabled:hover:bg-text-primary/[0.06] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <button
          onClick={controller.goForward}
          disabled={!controller.canGoForward}
          title={t('layout.browserforward', language as Language) || 'Forward'}
          className="w-7 h-7 rounded-md flex items-center justify-center text-text-muted disabled:opacity-30 enabled:hover:text-text-primary enabled:hover:bg-text-primary/[0.06] transition-colors"
        >
          <ArrowRight className="w-4 h-4" />
        </button>
        <button
          onClick={controller.isLoading ? controller.stop : handleReload}
          title={t('layout.browserreload', language as Language) || 'Reload'}
          className="w-7 h-7 rounded-md flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-text-primary/[0.06] transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${controller.isLoading ? 'animate-spin' : ''}`} />
        </button>

        {/* 地址栏 */}
        <div className="flex-1 min-w-0 mx-1">
          <div className="flex items-center gap-1.5 h-7 px-2.5 rounded-md bg-text-primary/[0.05] border border-border/40 focus-within:border-accent/50 transition-colors">
            <Globe className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleNavigate(address)
                if (e.key === 'Escape') handleResetAddress()
              }}
              spellCheck={false}
              className="flex-1 min-w-0 bg-transparent outline-none text-[12px] text-text-primary placeholder:text-text-muted/50"
              placeholder={t('layout.menuurlplaceholder', language as Language) || 'Enter a URL'}
            />
            {controller.isLoading && <Loader2 className="w-3.5 h-3.5 text-text-muted animate-spin flex-shrink-0" />}
          </div>
        </div>

        {/* 外部打开 */}
        <button
          onClick={handleOpenExternal}
          title={t('layout.openinexternal', language as Language) || 'Open in external browser'}
          className="w-7 h-7 rounded-md flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-text-primary/[0.06] transition-colors"
        >
          <ExternalLink className="w-4 h-4" />
        </button>
      </div>

      {/* webview 主体（复用已有内置浏览器的 webview 容器） */}
      <div className="flex-1 min-h-0 relative">
        {session && <BrowserWebView session={session} controller={controller} />}
      </div>
    </div>
  )
}

