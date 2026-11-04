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
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Globe,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  X,
} from 'lucide-react'
import { useStore } from '@store'
import { useAgentStore, selectIsStreaming, selectMessages } from '@intelligence/state/IntelligenceStore'
import { useShallow } from 'zustand/react/shallow'
import { t, type Language } from '@renderer/i18n'
import { api } from '@renderer/adapters/electronBridge'
import type { PreviewSession } from '@shared/protocols/previewProtocol'
import { useWebviewController } from '@components/workspace-editor/browser/hooks/useWebviewController'
import { useDeferredMount } from '@renderer/composables/useDeferredMount'
import BrowserWebView from '@components/workspace-editor/browser/BrowserWebView'
import { sanitizeUrl } from '@components/workspace-editor/browser/hooks/usePreviewSessionSync'

/** 新标签页默认地址 */
const NEW_TAB_URL = 'https://www.aweeclaw.com'

/**
 * 站点页面同步的合并窗口（毫秒）
 *
 * 采集翻页时后台窗口会在几秒内连跳多页，逐条跟随会让可见页面反复整页重载。
 * 收一小段窗口再同步，用户看到的是「AI 走到哪一页」，而不是一路闪屏。
 */
const SITE_PAGE_MIRROR_DEBOUNCE_MS = 350

/** 标签标题：页面标题未知时用域名兜底，避免标签条上是一长串地址 */
function titleFromUrl(url: string): string {
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}


export default function InternalBrowser() {
  const {
    url,
    partition,
    siteContext,
    reloadTokenExternal,
    closeInternalBrowser,
    openChatDrawer,
    closeChatDrawer,
    chatAsDrawer,
    language,
    tabs,
    activeTabId,
    appendTab,
    selectTab,
    closeTab,
    updateTabUrl,
  } = useStore(
    useShallow((s) => ({
      url: s.internalBrowserUrl,
      partition: s.internalBrowserPartition,
      siteContext: s.internalBrowserSite,
      reloadTokenExternal: s.internalBrowserReloadToken,
      closeInternalBrowser: s.closeInternalBrowser,
      openChatDrawer: s.openChatDrawer,
      closeChatDrawer: s.closeChatDrawer,
      chatAsDrawer: s.chatAsDrawer,
      language: s.language,
      tabs: s.internalBrowserTabs,
      activeTabId: s.activeInternalBrowserTabId,
      appendTab: s.openInternalBrowserTab,
      selectTab: s.selectInternalBrowserTab,
      closeTab: s.closeInternalBrowserTab,
      updateTabUrl: s.updateInternalBrowserTabUrl,
    })),
  )

  /**
   * 刷新令牌：推进后由 controller 消费，触发一次真正的页面重载
   *
   * 留在组件里而不是 store：它只服务于当前挂载的 webview，浏览器关掉就该归零。
   */
  const [reloadToken, setReloadToken] = useState(0)
  const [address, setAddress] = useState(url ?? '')

  /**
   * 外部刷新请求（插件在自己的站点分区里登录完成后调用）
   *
   * 登录态写在分区里，页面本身不会跟着更新，必须由外部把当前页重载一次，
   * 用户才看得到登录后的界面。用 ref 记住已消费的计数，首次挂载不会多刷一次。
   */
  const consumedReloadTokenRef = useRef(reloadTokenExternal)
  useEffect(() => {
    if (reloadTokenExternal === consumedReloadTokenRef.current) return
    consumedReloadTokenRef.current = reloadTokenExternal
    setReloadToken((value) => value + 1)
  }, [reloadTokenExternal])

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
      // id 里带分区：Electron 的 partition 只在 webview 创建时生效，换了站点分区
      // 就必须重建节点，否则仍沿用上一个分区的 cookie，看起来像「登录了却没登录」。
      id: `internal-browser-${activeTab?.id ?? 'default'}-${partition ?? 'main'}`,
      url: activeUrl,
      title: activeTab?.title ?? '',
      source: 'manual',
      status: 'loading',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      reloadToken,
      // 托管站点带来的独立分区；undefined 时沿用主窗口 session
      partition: partition ?? undefined,
    }),
    [activeTab?.id, activeTab?.title, activeUrl, reloadToken, partition],
  )

  const controller = useWebviewController(session)

  /**
   * 把「用户在哪个站点的哪一页」写进对话上下文
   *
   * 不发送消息、不触发 AI 回复，只把事实摆进上下文：用户接着提问时，
   * AI 已经知道自己在服务哪个系统、当前停在哪一页，不必再反问。
   * 站点信息走 site-hosting 插件的上下文项，插件工具清单会随之一起注入。
   */
  const injectPageContext = useCallback(() => {
    const pageUrl = activeUrl || url || ''
    if (!pageUrl) return
    const pageTitle = activeTab?.title || titleFromUrl(pageUrl)
    const site = siteContext

    const lines: string[] = []
    if (site) {
      lines.push(
        `用户正在内置浏览器里使用托管站点「${site.name}」（分类：${site.category || 'other'}，入口：${site.entryUrl}）。`,
        '站点已在独立登录分区中打开，登录态与站点托管插件的后台窗口共享。',
      )
    } else {
      lines.push('用户正在内置浏览器里查看一个网页。')
    }
    lines.push(`当前页面：${pageTitle} — ${pageUrl}`)

    if (site) {
      lines.push(
        '',
        '需要读取或操作这一页时，按下面的顺序来：',
        `- site_navigate({ site: "${site.id}", url: "${pageUrl}" })：先把站点窗口带到这个地址；`,
        `- site_snapshot({ site: "${site.id}" })：读取页面结构、可点击元素与可见文本；`,
        '- site_click / site_type / site_wait_for：点击、填表这类交互自动化；',
        '- site_learn → recipe_save → crawl_start：列表页批量抓取；dataset_preview / dataset_stats：对结果做统计。',
        '回答与操作请围绕这个站点，未经用户确认不要切换到其它站点。',
      )
    } else {
      lines.push('需要页面内容时，先自行打开同一地址读取，不要臆测页面上有什么。')
    }

    const pluginId = site ? 'site-hosting' : 'internal-browser'
    const displayName = site ? '站点托管' : '内置浏览器'
    const label = site ? `站点：${site.name} · ${pageTitle}` : `页面：${pageTitle}`
    useAgentStore
      .getState()
      .setPluginStateNote(
        pluginId,
        lines.join('\n'),
        displayName,
        label,
        site ? `site:${site.id}` : 'internal-browser:page',
      )
  }, [activeUrl, url, activeTab?.title, siteContext])

  /**
   * 打开站点后立刻注入一次上下文
   *
   * 用户点「管理」进到页面往往直接就开口提问，先点 AI 按钮才注入就晚了。
   * 同一站点同一地址只注入一次，避免每次重渲染都覆盖上下文项。
   */
  const injectedKeyRef = useRef('')
  useEffect(() => {
    if (!siteContext || !url) return
    const key = `${siteContext.id}:${url}`
    if (injectedKeyRef.current === key) return
    injectedKeyRef.current = key
    injectPageContext()
  }, [siteContext, url, injectPageContext])

  /**
   * AI 助手：把当前页面交给 AI，并以抽屉形式拉出对话面板
   *
   * 已经开着就收起，按钮本身充当开关，不会在页面上留下第二层浮层。
   * 每次从页面唤起都开一项新任务：页面上下文是那一刻的事实，接着旧对话继续聊会把
   * 两个任务的上下文搅在一起。两种情况不新建——当前会话还是空白（只会多一条空会话）、
   * 或正在应答（切走线程会打断输出）。
   */
  const handleAskAi = useCallback(() => {
    if (chatAsDrawer) {
      closeChatDrawer()
      return
    }

    const agent = useAgentStore.getState()
    if (!selectIsStreaming(agent) && selectMessages(agent).length > 0) {
      agent.createThread()
    }

    injectPageContext()
    openChatDrawer()
  }, [chatAsDrawer, closeChatDrawer, injectPageContext, openChatDrawer])

  /** 工具栏按钮文案：中文界面短标签，英文界面用 Ask AI */
  const aiLabel = language === 'en' ? 'Ask AI' : 'AI 助手'
  const aiButtonTitle =
    language === 'en'
      ? chatAsDrawer
        ? 'Close AI assistant'
        : 'Ask AI about this page — starts a new task: read data, run statistics or automate it'
      : chatAsDrawer
        ? '收起 AI 助手'
        : '用 AI 处理当前页面（每次点击都会新建任务）：读数据、做统计、自动化操作'

  /**
   * webview 挂载推迟两帧
   *
   * 打开内置浏览器会同时改变主区域布局（内容区从聊天栏独占变为左右分栏）并创建
   * guest 渲染进程。两件事压在同一帧里，主线程一帧做不完，会出现主窗口卡顿和
   * 一次画面跳动。先让布局与首帧绘制落地，再创建 guest。
   */
  const canMount = useDeferredMount()

  // 地址栏跟随当前标签的地址；标签切换与标签内跳转都走这里
  useEffect(() => {
    setAddress(activeUrl)
  }, [activeUrl])

  /** 新开标签页并激活：页面里的 target=_blank 与工具栏的「+」共用 */
  const openTab = useCallback(
    (targetUrl: string, tabTitle?: string) => {
      const next = sanitizeUrl(targetUrl)
      if (!next) return
      appendTab(next, tabTitle || titleFromUrl(next))
    },
    [appendTab],
  )

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

  /**
   * 跟随站点后台窗口的页面变化
   *
   * AI 的站点自动化跑在主进程的隐藏窗口里，用户看的是这一侧的 webview。不跟随的话，
   * 对话里说「已打开订单统计页」，屏幕上的页面纹丝不动，只能关掉浏览器重新进入才看到。
   *
   * 只更新站点入口标签：报告、帮助页这类新标签是用户自己要对照看的，不该被带着跑。
   * 连续导航（采集翻页）合并成一次，避免可见页面反复整页重载。
   */
  const siteId = siteContext?.id ?? null
  const mirrorTimerRef = useRef<number | null>(null)
  const pendingMirrorRef = useRef<{ url: string; title: string } | null>(null)

  useEffect(() => {
    if (!siteId) return

    const flush = (): void => {
      mirrorTimerRef.current = null
      const pending = pendingMirrorRef.current
      pendingMirrorRef.current = null
      if (!pending) return

      const state = useStore.getState()
      const target =
        state.internalBrowserTabs.find((tab) => tab.siteBound) ??
        state.internalBrowserTabs.find((tab) => tab.id === state.activeInternalBrowserTabId)
      // 地址由 store 去重：同一页被多次推送时不会重复导航
      if (target) state.updateInternalBrowserTabUrl(target.id, pending.url, pending.title)
    }

    const off = api.siteBrowser?.onPage?.((event) => {
      if (event.siteId !== siteId || !event.url) return
      pendingMirrorRef.current = { url: event.url, title: event.title }
      if (mirrorTimerRef.current !== null) return
      mirrorTimerRef.current = window.setTimeout(flush, SITE_PAGE_MIRROR_DEBOUNCE_MS)
    })

    return () => {
      off?.()
      if (mirrorTimerRef.current !== null) {
        window.clearTimeout(mirrorTimerRef.current)
        mirrorTimerRef.current = null
      }
      pendingMirrorRef.current = null
    }
  }, [siteId])

  // 地址栏提交导航
  const handleNavigate = useCallback(
    (raw: string) => {
      const next = sanitizeUrl(raw)
      if (!next) return
      setAddress(next)
      if (activeTab) updateTabUrl(activeTab.id, next, titleFromUrl(next))
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
                onClick={() => selectTab(tab.id)}
                title={tab.url}
                className="flex-1 min-w-0 truncate text-[11px] text-left"
              >
                {tab.title || titleFromUrl(tab.url)}
              </button>
              {tabs.length > 1 && (
                <button
                  onClick={() => closeTab(tab.id)}
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

        {/*
          AI 助手

          用途是「拉出对话，并把当前页面交给 AI」：数据统计、批量操作、页面自动化
          都在对话里说一句就行。抽屉开合由全局状态决定，按钮兼作开关。
          页面所在的站点与地址已提前写进对话上下文，点开即可直接提问。
        */}
        <button
          onClick={handleAskAi}
          disabled={!activeUrl}
          title={aiButtonTitle}
          aria-label={aiLabel}
          aria-pressed={chatAsDrawer}
          className={`group inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:pointer-events-none disabled:opacity-40 ${
            chatAsDrawer
              ? 'bg-accent/12 text-accent ring-1 ring-accent/40'
              : 'text-text-secondary hover:text-text-primary hover:bg-text-primary/[0.06]'
          }`}
        >
          <MessageSquare className="h-3.5 w-3.5 shrink-0" />
          <span className="text-[12px] font-medium whitespace-nowrap">{aiLabel}</span>
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
      <div className="flex-1 min-h-0 relative overflow-hidden bg-background-editor">
        {/*
          key 由「标签 id + 重建序号」组成：
          - 刷新令牌推进时序号变化，React 重建节点，页面按 src 重新加载
          - 切换标签时 id 变化，webview 跟着换到新标签的地址
        */}
        {session && canMount && (
          <BrowserWebView
            key={`${activeTab?.id ?? 'default'}-${partition ?? 'main'}-${controller.reloadNonce}`}
            session={session}
            controller={controller}
          />
        )}
      </div>
    </div>
  )
}

