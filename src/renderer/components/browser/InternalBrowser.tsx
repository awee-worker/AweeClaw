/**
 * 内部浏览器（自定义菜单）
 *
 * 复用客户端已有内置浏览器（workspace-editor/browser）的核心能力，不再重复实现 webview 逻辑：
 * - useWebviewController：webview 命令 + 派生状态 + 事件桥接（含 src 首次导航的时序处理，
 *   不会在 webview 未 dom-ready 时调用 loadURL）
 * - BrowserWebView：webview 容器（冻结初始 src，避免 src 导航与 loadURL 双重导航冲突）
 *
 * 本组件负责：
 * - 内容区占位容器 + 标签条 + 工具栏 UI（关闭/后退/前进/刷新/地址栏/外部打开）
 * - 多标签：页面里的 target=_blank / window.open 由主进程推回来，在这里新开标签页
 * - 自定义菜单 URL 驱动的本地会话状态（不注册 previewSessionService，
 *   service 的方法对未知 session 全部 no-op，无副作用）
 *
 * 标签切换会重建 webview（不同标签是不同地址，冻结的 src 不会跟着变），
 * 因此切走再切回来的页面会重新加载——与「一个内置浏览器只保留一个 guest」的取舍一致。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, ExternalLink, Globe, Loader2, Plus, RefreshCw, Sparkles, X } from 'lucide-react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { t, type Language } from '@renderer/i18n'
import { api } from '@renderer/adapters/electronBridge'
import type { PreviewSession } from '@shared/protocols/previewProtocol'
import { useWebviewController } from '@components/workspace-editor/browser/hooks/useWebviewController'
import { useElementPicker } from '@components/workspace-editor/browser/hooks/useElementPicker'
import { useDeferredMount } from '@renderer/composables/useDeferredMount'
import BrowserWebView from '@components/workspace-editor/browser/BrowserWebView'
import AIEditPanel from '@components/workspace-editor/browser/AIEditPanel'
import { BROWSER_AI_EDIT_EVENT, buildAIEditPrompt } from '@components/workspace-editor/browser/aiEditPrompt'
import { sanitizeUrl } from '@components/workspace-editor/browser/hooks/usePreviewSessionSync'

/** 新标签页默认地址 */
const NEW_TAB_URL = 'https://www.aweeclaw.com'

interface InternalTab {
  id: string
  url: string
  title: string
}

function createTabId(): string {
  return `tab-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** 标签标题：页面标题未知时用域名兜底，避免标签条上是一长串地址 */
function titleFromUrl(url: string): string {
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}


export default function InternalBrowser() {
  const { url, title, closeInternalBrowser, language } = useStore(
    useShallow((s) => ({
      url: s.internalBrowserUrl,
      title: s.internalBrowserTitle,
      closeInternalBrowser: s.closeInternalBrowser,
      language: s.language,
    })),
  )

  // 标签集合：自定义菜单打开时只有一个标签，页面弹窗请求会在这里追加
  const [tabs, setTabs] = useState<InternalTab[]>(() => [
    {
      id: createTabId(),
      url: url ?? '',
      title: title || titleFromUrl(url ?? ''),
    },
  ])
  const [activeTabId, setActiveTabId] = useState<string>(() => tabs[0]?.id ?? '')
  /** 刷新令牌：推进后由 controller 消费，触发一次真正的页面重载 */
  const [reloadToken, setReloadToken] = useState(0)
  const [address, setAddress] = useState(url ?? '')

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0]
  const activeUrl = activeTab?.url ?? ''

  /**
   * 会话对象由当前标签派生
   *
   * controller 只认一个会话，切换标签等价于「换一条会话」：id 变化让 webview 重建，
   * url 变化让未挂载的场景也能落到正确地址。
   */
  const session = useMemo<PreviewSession>(
    () => ({
      id: `internal-browser-${activeTab?.id ?? 'default'}`,
      url: activeUrl,
      title: activeTab?.title ?? '',
      source: 'manual',
      status: 'loading',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      reloadToken,
    }),
    [activeTab?.id, activeTab?.title, activeUrl, reloadToken],
  )

  const controller = useWebviewController(session)

  // AI 修改：元素拾取（切换页面 / 关闭时会自动结束上一次拾取）
  const { phase: pickPhase, picked, togglePick, clearPick, undoEdits } = useElementPicker(
    controller.guestId,
  )

  /** 提交修改指令：经 window 事件交给 PluginHostBridge 发送到当前会话 */
  const handleSubmitEdit = useCallback(
    (instruction: string) => {
      if (!picked) return
      const pageUrl = activeUrl || url || undefined
      const prompt = buildAIEditPrompt(picked, instruction, pageUrl)
      window.dispatchEvent(new CustomEvent(BROWSER_AI_EDIT_EVENT, { detail: { text: prompt } }))
      clearPick()
    },
    [picked, clearPick, activeUrl, url],
  )

  /**
   * webview 挂载推迟两帧
   *
   * 打开内置浏览器会同时改变主区域布局（内容区从聊天栏独占变为左右分栏）并创建
   * guest 渲染进程。两件事压在同一帧里，主线程一帧做不完，会出现主窗口卡顿和
   * 一次画面跳动。先让布局与首帧绘制落地，再创建 guest。
   */
  const canMount = useDeferredMount()

  /** 已在标签里落地的自定义菜单地址：用于区分「菜单换了地址」和「用户自己导航走了」 */
  const syncedMenuUrlRef = useRef<string>(url ?? '')

  // 外部 URL 变化（打开另一个自定义菜单）→ 在当前标签上导航过去
  useEffect(() => {
    if (!url || syncedMenuUrlRef.current === url) return
    syncedMenuUrlRef.current = url

    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === activeTabId ? { ...tab, url, title: title || titleFromUrl(url) } : tab,
      ),
    )
  }, [url, title, activeTabId])

  // 地址栏跟随当前标签的地址；标签切换与页面内跳转都走这里
  useEffect(() => {
    setAddress(activeUrl)
  }, [activeUrl])

  /** 新开标签页并激活 */
  const openTab = useCallback((targetUrl: string, tabTitle?: string) => {
    const next = sanitizeUrl(targetUrl)
    if (!next) return

    const tab: InternalTab = {
      id: createTabId(),
      url: next,
      title: tabTitle || titleFromUrl(next),
    }
    setTabs((prev) => [...prev, tab])
    setActiveTabId(tab.id)
  }, [])

  /**
   * 页面请求新窗口（target=_blank / window.open）
   *
   * 主进程把请求推回渲染进程，这里按 guest id 认领属于自己的那一个，以新标签页打开。
   * 原先是直接 deny 后交给系统浏览器，用户在内置浏览器里点链接会突然跳到外部程序；
   * 现在留在应用内，与工具栏的「外部打开」按钮各管一途。
   */
  useEffect(() => {
    const guestId = controller.guestId
    if (guestId === null) return

    const off = api.preview.onNewWindow?.((request) => {
      if (request.guestId !== guestId) return
      openTab(request.url)
    })
    return () => off?.()
  }, [controller.guestId, openTab])

  const handleCloseTab = useCallback(
    (tabId: string) => {
      if (tabs.length <= 1) return

      const closingIndex = tabs.findIndex((tab) => tab.id === tabId)
      const next = tabs.filter((tab) => tab.id !== tabId)
      setTabs(next)

      if (tabId === activeTabId) {
        const fallback = next[Math.min(Math.max(closingIndex, 0), next.length - 1)]
        if (fallback) setActiveTabId(fallback.id)
      }
    },
    [tabs, activeTabId],
  )

  // 地址栏提交导航
  const handleNavigate = useCallback(
    (raw: string) => {
      const next = sanitizeUrl(raw)
      if (!next) return
      setAddress(next)
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === activeTabId ? { ...tab, url: next, title: titleFromUrl(next) } : tab,
        ),
      )
    },
    [activeTabId],
  )

  // 还原地址栏为当前 URL
  const handleResetAddress = useCallback(() => {
    setAddress(activeUrl || url || '')
  }, [activeUrl, url])

  // 刷新：推进令牌，由 controller 消费后重载当前页面
  const handleReload = useCallback(() => {
    setReloadToken((value) => value + 1)
  }, [])

  const handleOpenExternal = useCallback(() => {
    try {
      void api?.file?.openExternalUrl(activeUrl || url || '')
    } catch {
      /* ignore */
    }
  }, [activeUrl, url])

  if (!url) return null

  return (
    <div className="h-full w-full flex flex-col min-h-0 overflow-hidden bg-background">
      {/* 标签条：页面弹窗新开的标签也在这里，可切换、可关闭 */}
      <div className="flex items-center gap-1 h-8 px-2 border-b border-border/40 bg-background-secondary/40 shrink-0 overflow-x-auto select-none">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId
          return (
            <div
              key={tab.id}
              className={`group flex items-center gap-1 h-6 pl-2 pr-1 rounded-md max-w-[180px] transition-colors ${
                isActive
                  ? 'bg-text-primary/[0.08] text-text-primary'
                  : 'text-text-muted hover:bg-text-primary/[0.04]'
              }`}
            >
              <button
                onClick={() => setActiveTabId(tab.id)}
                title={tab.url}
                className="flex-1 min-w-0 truncate text-[11px] text-left"
              >
                {tab.title || titleFromUrl(tab.url)}
              </button>
              {tabs.length > 1 && (
                <button
                  onClick={() => handleCloseTab(tab.id)}
                  title={t('layout.close', language as Language) || 'Close'}
                  className="w-4 h-4 rounded flex items-center justify-center text-text-muted opacity-0 group-hover:opacity-100 hover:text-text-primary hover:bg-text-primary/[0.08] transition-opacity"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          )
        })}
        <button
          onClick={() => openTab(NEW_TAB_URL)}
          title={t('layout.browsernewtab', language as Language) || 'New tab'}
          className="w-6 h-6 rounded-md flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-text-primary/[0.06] transition-colors shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

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

        {/* AI 修改：点一次进入拾取，再点一次退出 */}
        <button
          onClick={togglePick}
          disabled={controller.guestId === null}
          title={
            pickPhase === 'picking'
              ? t('editor.browser.aiEditPicking', language as Language) || 'Picking an element…'
              : t('editor.browser.aiEdit', language as Language) || 'AI Edit'
          }
          className={`w-7 h-7 rounded-md flex items-center justify-center disabled:opacity-30 transition-colors ${
            pickPhase === 'picking'
              ? 'text-accent bg-accent/10'
              : 'text-text-muted enabled:hover:text-text-primary enabled:hover:bg-text-primary/[0.06]'
          }`}
        >
          <Sparkles className="w-4 h-4" />
        </button>

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
      {/* overflow-hidden：AI 修改浮层为绝对定位，拖动时不能撑出额外的滚动区域 */}
      <div className="flex-1 min-h-0 relative overflow-hidden bg-background-editor">
        {/*
          key 由「标签 id + 重建序号」组成：
          - 刷新令牌推进时序号变化，React 重建节点，页面按 src 重新加载
          - 切换标签时 id 变化，webview 跟着换到新标签的地址
        */}
        {session && canMount && (
          <BrowserWebView
            key={`${activeTab?.id ?? 'default'}-${controller.reloadNonce}`}
            session={session}
            controller={controller}
          />
        )}

        {/* AI 修改浮层：跟随选中元素定位，浮在页面之上 */}
        {picked && (
          <AIEditPanel
            picked={picked}
            onClose={clearPick}
            onSubmit={handleSubmitEdit}
            onUndo={() => void undoEdits('all')}
          />
        )}
      </div>
    </div>
  )
}

