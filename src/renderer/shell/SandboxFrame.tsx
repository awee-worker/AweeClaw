/**
 * 沙箱容器
 *
 * 在独立渲染进程里加载一段自定义页面，用于数据大屏、游戏化交互这类
 * 「整块界面都要自己画」的需求。
 *
 * 边界：
 * - 页面跑在 webview（独立渲染进程）里，拿不到主应用的 store 与 IPC
 * - 需要宿主能力时走 postMessage，由宿主侧显式放行（见 SANDBOX_HOST_MESSAGE）
 * - 顶栏由客户端绘制，退出入口始终在宿主手里，页面无法把自己锁死
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, RefreshCw, X } from 'lucide-react'
import { api } from '@renderer/adapters/electronBridge'

/**
 * 沙箱页面 → 宿主的能力请求消息类型。
 *
 * 页面通过 window.parent.postMessage({ type: SANDBOX_HOST_MESSAGE, ... }) 发起，
 * 宿主按 method 白名单处理，不认识的直接忽略。
 */
export const SANDBOX_HOST_MESSAGE = 'aweeclaw:sandbox-host-call'

/** 参与逻辑分区，避免与其他 webview（内置浏览器/预览页）共用 cookie 与存储 */
const SANDBOX_PARTITION = 'persist:aweeclaw-sandbox'

export interface SandboxFrameProps {
  /** 页面地址，必须是完整 URL */
  src: string
  /** 顶栏标题 */
  title?: string
  /**
   * 退出回调。
   *
   * 不传时不渲染退出按钮 —— 那种情况说明宿主没有可回退的目标，
   * 留一个点了没反应的按钮比不画更糟。
   */
  onExit?: () => void
}

export default function SandboxFrame({ src, title, onExit }: SandboxFrameProps) {
  const webviewRef = useRef<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [reloadToken, setReloadToken] = useState(0)

  // src 只在首次挂载时交给 React：后续重载统一走 reload()，
  // 避免「src 属性变化」与命令式重载同时触发造成一次 -3 ERR_ABORTED
  const initialSrc = useRef(src).current

  const handleReload = useCallback(() => {
    const view = webviewRef.current as { reload?: () => void } | null
    if (view?.reload) {
      view.reload()
      return
    }
    // webview 尚未就绪（reload 不可用）时退回重建，代价是多一次加载
    setLoading(true)
    setReloadToken((n) => n + 1)
  }, [])

  /**
   * 加载结束监听
   *
   * webview 的 did-finish-load / did-fail-load 是 DOM 事件而非回调属性，
   * React 的类型里没有对应 prop，只能在挂载后手动订阅。失败同样要收起
   * loading，否则页面挂了会一直转圈，用户看不出是加载失败。
   */
  useEffect(() => {
    const view = webviewRef.current as EventTarget | null
    if (!view) return

    const stop = () => setLoading(false)
    view.addEventListener('did-finish-load', stop)
    view.addEventListener('did-fail-load', stop)
    return () => {
      view.removeEventListener('did-finish-load', stop)
      view.removeEventListener('did-fail-load', stop)
    }
  }, [reloadToken])

  /**
   * 页面里的新窗口请求转给系统浏览器
   *
   * 沙箱页面没有地址栏和标签页，弹窗留在应用内无处安放，因此这里按 guest id 认领
   * 自己的请求后直接交给系统浏览器——与主窗口里点外链的行为保持一致。
   * guest id 要等 dom-ready 之后才可读，所以订阅挂在事件上而不是首帧。
   */
  useEffect(() => {
    const view = webviewRef.current as
      | (EventTarget & { getWebContentsId?: () => number })
      | null
    if (!view) return

    let guestId: number | null = null
    let off: (() => void) | undefined

    const bind = () => {
      if (guestId !== null) return

      let id: number
      try {
        const candidate = view.getWebContentsId?.()
        if (typeof candidate !== 'number' || candidate < 0) return
        id = candidate
      } catch {
        // webview 尚未 attach，等下一次 dom-ready
        return
      }

      guestId = id
      off = api.preview.onNewWindow?.((request) => {
        if (request.guestId !== id) return
        void api?.file?.openExternalUrl(request.url)
      })
    }

    view.addEventListener('dom-ready', bind)
    bind()

    return () => {
      view.removeEventListener('dom-ready', bind)
      off?.()
    }
  }, [reloadToken])

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background">
      {/* 顶栏：客户端绘制，退出入口不交给页面 */}
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border/60 bg-background-elevated px-3">
        <span className="truncate text-xs font-medium text-text-secondary">
          {title || '沙箱页面'}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={handleReload}
            title="重新加载"
            className="rounded p-1 text-text-tertiary transition-colors hover:bg-fill-secondary hover:text-text-primary"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          {onExit && (
            <button
              type="button"
              onClick={onExit}
              title="退出沙箱"
              className="rounded p-1 text-text-tertiary transition-colors hover:bg-fill-secondary hover:text-text-primary"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="relative flex-1 min-h-0">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background">
            <Loader2 className="h-5 w-5 animate-spin text-text-tertiary" />
          </div>
        )}
        <webview
          key={reloadToken}
          ref={webviewRef as never}
          src={initialSrc}
          title={title || 'sandbox'}
          partition={SANDBOX_PARTITION}
          className="h-full w-full border-0 bg-background-editor"
          // allowpopups：页面里 target=_blank / window.open 的请求需要先由 guest 转发出来，
          // 否则内核直接丢弃，点击表现为无响应。开不开窗口仍由主进程的
          // setWindowOpenHandler 决定（一律 deny），沙箱没有地址栏与标签页，
          // 请求由下面的订阅转给系统浏览器。
          //
          // 值必须是字符串：给自定义布尔属性传 true 会被 React 丢弃，属性不落地，
          // 内核随即吞掉弹窗请求，订阅永远收不到。
          allowpopups={'' as unknown as boolean}
          // 不设置 nodeintegration / disablewebsecurity：
          // nodeIntegration 由主进程 will-attach-webview 强制为 false
        />
      </div>
    </div>
  )
}
