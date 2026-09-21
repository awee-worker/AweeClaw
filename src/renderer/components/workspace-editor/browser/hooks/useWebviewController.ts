/**
 * webview 控制器 Hook
 *
 * 封装 <webview> 标签的全部命令式操作与状态同步：
 * - 事件绑定（did-start-loading / did-navigate / page-title-updated / devtools-opened 等）
 * - URL / reloadToken 变化 → webview.loadURL / reload（不使用 key 强制 remount）
 * - 命令操作（后退/前进/停止/DevTools/缩放）
 * - 派生状态（canGoBack/canGoForward/isLoading/devtoolsOpen/zoomFactor）同步到 previewSessionService
 *
 * 关键设计：
 * - 用 callback ref + webviewMounted state 解决「webview 晚于 useEffect 挂载」的时序问题
 *   （初始无 session 时不渲染 webview，session 出现后 webview 挂载，callback ref 触发事件绑定）
 * - sessionId 通过 ref 保持最新，事件回调始终读取当前会话
 * - goBack/goForward 触发 webview 内部导航，did-navigate 事件回写 session.url
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useStableCallback } from '@renderer/composables/usePerformance'
import { api } from '@renderer/adapters/electronBridge'
import { previewSessionService } from '@renderer/preview/previewSessionManager'
import type { PreviewSession } from '@shared/protocols/previewProtocol'

/** 缩放范围与步长（与 Chrome DevTools 行为一致） */
const MIN_ZOOM = 0.5
const MAX_ZOOM = 3.0
const ZOOM_STEP = 0.1

/** ERR_ABORTED：通常由导航中止/重定向引起，不计为加载失败 */
const ERR_ABORTED = -3

/** webview 导航事件参数（Electron webview 标签将参数直接挂在 Event 上） */
interface NavigateEvent {
  url: string
  isMainFrame?: boolean
}
interface FailLoadEvent {
  errorCode: number
  errorDescription: string
  validatedURL: string
  isMainFrame: boolean
}
interface PageTitleEvent {
  title: string
  explicitSet: boolean
}

export interface WebviewController {
  /** 绑定到 <webview ref={...}> 的 callback ref */
  webviewRef: (el: HTMLWebViewElement | null) => void
  /** 是否可后退 */
  canGoBack: boolean
  /** 是否可前进 */
  canGoForward: boolean
  /** 是否正在加载 */
  isLoading: boolean
  /** DevTools 是否打开 */
  devtoolsOpen: boolean
  /** guest webContents id；null 表示 webview 尚未就绪，此时无法内嵌 DevTools */
  guestId: number | null
  /** webview 标签是否已挂载（未挂载时命令类按钮无效果） */
  webviewReady: boolean
  /** 当前缩放因子（1 = 100%） */
  zoomFactor: number
  /** 后退 */
  goBack: () => void
  /** 前进 */
  goForward: () => void
  /** 停止加载 */
  stop: () => void
  /** 刷新（走 previewSessionService.reload → reloadToken 变化 → webview.reload） */
  reload: () => void
  /** 切换 DevTools（优先内嵌到右侧面板，条件不满足时退回独立窗口） */
  toggleDevtools: () => void
  /** 内嵌面板是否可用：false 时不再占位，DevTools 走独立窗口 */
  dockUsable: boolean
  /** 标记内嵌不可用，收起占位面板 */
  collapseDock: () => void
  /** 以独立窗口打开 DevTools（内嵌不可用时的回退路径） */
  openDetachedDevTools: () => void
  /** 放大（+10%，上限 300%） */
  zoomIn: () => void
  /** 缩小（-10%，下限 50%） */
  zoomOut: () => void
  /** 重置缩放为 100% */
  resetZoom: () => void
}

/**
 * @param session 当前预览会话（null 时表示空状态，webview 不渲染）
 */
export function useWebviewController(session: PreviewSession | null): WebviewController {
  const sessionRef = useRef<PreviewSession | null>(session)
  sessionRef.current = session
  const sessionIdRef = useRef<string | undefined>(session?.id)
  sessionIdRef.current = session?.id

  const nodeRef = useRef<HTMLWebViewElement | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)
  /** 当前 webview 的 guest webContents id：页面健康采集的关联键 */
  const guestIdRef = useRef<number | null>(null)
  // 记录已加载的 url / reloadToken，避免与 webview src 初始加载重复
  const lastLoadedUrlRef = useRef<string>('')
  const lastReloadTokenRef = useRef<number>(0)
  const [webviewMounted, setWebviewMounted] = useState(false)

  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [devtoolsOpen, setDevtoolsOpen] = useState(false)
  /** guest id 同步到 state：内嵌 DevTools 面板要据此判断能否挂载 */
  const [guestId, setGuestId] = useState<number | null>(null)
  const [zoomFactor, setZoomFactor] = useState(1)
  /** 内嵌面板是否可用；不可用时 DevTools 退回独立窗口，不再占位 */
  const [dockUsable, setDockUsable] = useState(true)
  /** 命令回调里要读到最新的打开状态，state 在闭包里会滞后 */
  const devtoolsOpenRef = useRef(false)

  /** 同步 webview 导航状态到本地 state + previewSessionService（内存态） */
  const syncNavState = useStableCallback((webview: HTMLWebViewElement) => {
    const back = webview.canGoBack()
    const forward = webview.canGoForward()
    setCanGoBack(back)
    setCanGoForward(forward)
    const sid = sessionIdRef.current
    if (sid) {
      previewSessionService.syncWebviewState(sid, { canGoBack: back, canGoForward: forward })
    }
  })

  /** 绑定 webview 事件，返回解绑函数 */
  const bindEvents = useStableCallback((webview: HTMLWebViewElement): (() => void) => {
    const handleStartLoading = () => {
      setIsLoading(true)
      const sid = sessionIdRef.current
      if (sid) previewSessionService.markStatus(sid, 'loading')
    }
    const handleStopLoading = () => {
      setIsLoading(false)
      // did-finish-load 在某些 SPA / 持续加载页面可能不触发，此处兜底置 ready
      const sid = sessionIdRef.current
      if (sid) previewSessionService.markStatus(sid, 'ready')
      syncNavState(webview)
    }
    const handleFinishLoad = () => {
      setIsLoading(false)
      const sid = sessionIdRef.current
      if (sid) previewSessionService.markStatus(sid, 'ready')
      syncNavState(webview)
    }
    const handleFailLoad = (event: Event) => {
      const detail = event as unknown as FailLoadEvent
      if (!detail.isMainFrame) return
      if (detail.errorCode === ERR_ABORTED) return
      setIsLoading(false)
      const sid = sessionIdRef.current
      if (sid) {
        previewSessionService.markStatus(sid, 'error', detail.errorDescription || 'Failed to load')
      }
    }
    const handleNavigate = (event: Event) => {
      const detail = event as unknown as NavigateEvent
      const sid = sessionIdRef.current
      if (sid && detail.url) {
        previewSessionService.navigate(sid, detail.url)
      }
      syncNavState(webview)
    }
    const handleNavigateInPage = (event: Event) => {
      const detail = event as unknown as NavigateEvent
      if (!detail.isMainFrame) return
      const sid = sessionIdRef.current
      if (sid && detail.url) {
        previewSessionService.navigate(sid, detail.url)
      }
    }
    const handlePageTitle = (event: Event) => {
      const detail = event as unknown as PageTitleEvent
      if (!detail.explicitSet) return
      const sid = sessionIdRef.current
      if (sid && detail.title) {
        previewSessionService.updateTitle(sid, detail.title)
      }
    }
    const handleDevtoolsOpened = () => {
      devtoolsOpenRef.current = true
      setDevtoolsOpen(true)
      const sid = sessionIdRef.current
      if (sid) previewSessionService.syncWebviewState(sid, { devtoolsOpen: true })
    }
    const handleDevtoolsClosed = () => {
      devtoolsOpenRef.current = false
      setDevtoolsOpen(false)
      const sid = sessionIdRef.current
      if (sid) previewSessionService.syncWebviewState(sid, { devtoolsOpen: false })
    }

    /**
     * 上报 guest 给主进程，开始采集页面健康数据
     *
     * dom-ready 在每次导航完成后都会触发，主进程以最新会话为准重建采集状态，
     * 因此这里无需额外的导航判断。
     */
    const registerHealth = () => {
      const sid = sessionIdRef.current
      if (!sid) return
      try {
        const id = webview.getWebContentsId()
        if (typeof id !== 'number' || id < 0) return
        guestIdRef.current = id
        setGuestId(id)
        // 会话上记一份 guest id，AI 侧按需采集资源瀑布时需要它
        previewSessionService.setGuestId(sid, id)
        void api.preview.healthAttach(id, sid, sessionRef.current?.url || '')
      } catch {
        // webview 尚未 attach 时 getWebContentsId 会抛错，留给下一次 dom-ready
      }
    }

    const listeners: Array<[string, EventListener]> = [
      ['did-start-loading', handleStartLoading as EventListener],
      ['did-stop-loading', handleStopLoading as EventListener],
      ['did-finish-load', handleFinishLoad as EventListener],
      ['did-fail-load', handleFailLoad as EventListener],
      ['did-navigate', handleNavigate as EventListener],
      ['did-navigate-in-page', handleNavigateInPage as EventListener],
      ['page-title-updated', handlePageTitle as EventListener],
      ['devtools-opened', handleDevtoolsOpened as EventListener],
      ['devtools-closed', handleDevtoolsClosed as EventListener],
    ]
    listeners.forEach(([name, handler]) => webview.addEventListener(name, handler))
    webview.addEventListener('dom-ready', registerHealth)

    return () => {
      listeners.forEach(([name, handler]) => webview.removeEventListener(name, handler))
      webview.removeEventListener('dom-ready', registerHealth)

      // 停止健康采集：guest 可能已销毁，主进程按 id 直接释放记录
      const detachedGuestId = guestIdRef.current
      if (detachedGuestId !== null) {
        guestIdRef.current = null
        setGuestId(null)
        const sid = sessionIdRef.current
        if (sid) previewSessionService.setGuestId(sid, null)
        void api.preview.healthDetach(detachedGuestId)
      }

      // 取消目录监听：标签页关掉后不必再为它做自动刷新
      const previewRoot = sessionRef.current?.previewRoot
      const currentUrl = sessionRef.current?.url
      if (previewRoot && currentUrl) {
        void api.preview.unwatchAutoReload(previewRoot, currentUrl)
      }
    }
  })


  /** callback ref：webview 挂载时绑定事件，卸载时解绑 */
  const webviewRef = useCallback((el: HTMLWebViewElement | null) => {
    // 先清理旧节点
    if (cleanupRef.current) {
      cleanupRef.current()
      cleanupRef.current = null
    }
    nodeRef.current = el
    setWebviewMounted(el !== null)
    if (el) {
      // webview 的 src 已由 React 设置为 session.url，标记为已加载，避免 effect 重复 loadURL
      lastLoadedUrlRef.current = sessionRef.current?.url || ''
      lastReloadTokenRef.current = sessionRef.current?.reloadToken || 0
      // 读取初始缩放
      try {
        setZoomFactor(el.getZoomFactor())
      } catch {
        // webview 未就绪时忽略
      }
      cleanupRef.current = bindEvents(el)
    }
  }, [bindEvents])

  // webview 卸载时确保清理
  useEffect(() => {
    return () => {
      if (cleanupRef.current) {
        cleanupRef.current()
        cleanupRef.current = null
      }
    }
  }, [])

  // session.url 变化 → 增量 loadURL（避免 key remount 重建 webview 进程）
  useEffect(() => {
    if (!webviewMounted || !session) return
    const webview = nodeRef.current
    if (!webview) return
    if (session.url && session.url !== lastLoadedUrlRef.current) {
      lastLoadedUrlRef.current = session.url
      // catch 兜底：-3 ERR_ABORTED 等错误由 did-fail-load 事件处理，
      // 避免未捕获的 Promise rejection 被 GlobalErrorHandler 弹窗
      webview.loadURL(session.url).catch(() => {})
    }
  }, [session?.url, webviewMounted, session])

  // session.reloadToken 变化 → reload
  useEffect(() => {
    if (!webviewMounted || !session) return
    const webview = nodeRef.current
    if (!webview) return
    if (session.reloadToken !== lastReloadTokenRef.current) {
      lastReloadTokenRef.current = session.reloadToken
      try {
        webview.reload()
      } catch {
        // reload 在未加载完成时可能抛出，忽略
      }
    }
  }, [session?.reloadToken, webviewMounted, session])

  // ---- 命令方法（useStableCallback 保证引用稳定，子组件 memo 不失效）----

  const goBack = useStableCallback(() => {
    const webview = nodeRef.current
    if (webview?.canGoBack()) {
      webview.goBack()
    }
  })

  const goForward = useStableCallback(() => {
    const webview = nodeRef.current
    if (webview?.canGoForward()) {
      webview.goForward()
    }
  })

  const stop = useStableCallback(() => {
    nodeRef.current?.stop()
  })

  const reload = useStableCallback(() => {
    const sid = sessionIdRef.current
    if (sid) {
      previewSessionService.reload(sid)
    }
  })

  /**
   * 切换 DevTools
   *
   * 打开时先置状态让右侧占位面板出现，真正的挂载由面板自己发起（只有它知道自己的矩形）；
   * 关闭时两条路径都走一遍：内嵌面板归主进程管，独立窗口归 webview 管。
   *
   * 内嵌面板需要 guest id 才能把 DevTools 挂上去，拿不到时直接以独立窗口打开，
   * 避免点击后既没有面板也没有窗口、看起来「按钮没反应」。
   */
  const toggleDevtools = useStableCallback(() => {
    const webview = nodeRef.current
    if (!webview) return

    if (devtoolsOpenRef.current) {
      const openGuestId = guestIdRef.current
      if (openGuestId !== null) {
        void api.preview.closeDevTools(openGuestId)
      }
      // 先复位本地状态：内嵌 DevTools 由主进程承载，guest 的 isDevToolsOpened()
      // 在这种模式下并不为真，事件也不一定回传，长期挂在「已打开」会让按钮失灵
      devtoolsOpenRef.current = false
      setDevtoolsOpen(false)
      try {
        webview.closeDevTools()
      } catch {
        // 未打开时 closeDevTools 可能抛错，忽略
      }
      return
    }

    if (guestIdRef.current === null) {
      try {
        webview.openDevTools()
      } catch {
        // webview 未就绪时忽略
      }
      return
    }

    setDockUsable(true)
    setDevtoolsOpen(true)
  })

  /** 内嵌不可用：收起占位面板，DevTools 改由独立窗口承载 */
  const collapseDock = useStableCallback(() => {
    setDockUsable(false)
  })

  /** 以独立窗口打开 DevTools（webview 的默认行为） */
  const openDetachedDevTools = useStableCallback(() => {
    const webview = nodeRef.current
    if (!webview) return
    try {
      webview.openDevTools()
    } catch {
      // webview 未就绪时忽略
    }
  })

  const applyZoom = useStableCallback((next: number) => {
    const webview = nodeRef.current
    if (!webview) return
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(next.toFixed(2))))
    webview.setZoomFactor(clamped)
    setZoomFactor(clamped)
    const sid = sessionIdRef.current
    if (sid) previewSessionService.syncWebviewState(sid, { zoomFactor: clamped })
  })

  const zoomIn = useStableCallback(() => applyZoom(zoomFactor + ZOOM_STEP))
  const zoomOut = useStableCallback(() => applyZoom(zoomFactor - ZOOM_STEP))
  const resetZoom = useStableCallback(() => applyZoom(1))

  return {
    webviewRef,
    canGoBack,
    canGoForward,
    isLoading,
    devtoolsOpen,
    zoomFactor,
    goBack,
    goForward,
    stop,
    reload,
    toggleDevtools,
    guestId,
    webviewReady: webviewMounted,
    dockUsable,
    collapseDock,
    openDetachedDevTools,
    zoomIn,
    zoomOut,
    resetZoom,
  }
}
