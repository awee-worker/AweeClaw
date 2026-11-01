/**
 * 内置浏览器 webview 容器
 *
 * 仅负责渲染 <webview> 标签并绑定 controller.webviewRef。
 *
 * 关键设计：src 属性仅在首次挂载时由 React 设置（useRef 冻结），后续 session.url
 * 变化时 React 不会更新 src 属性，避免「src 属性触发导航 + loadURL 触发导航」
 * 双重导航冲突（导致 -3 ERR_ABORTED）。所有后续导航统一由 useWebviewController
 * 的 loadURL() 处理。
 *
 * 安全：webview 的 webPreferences 与协议白名单由主进程 registerWebviewGuard 保障。
 */
import { useRef } from 'react'
import type { PreviewSession } from '@shared/protocols/previewProtocol'
import type { WebviewController } from './hooks/useWebviewController'

interface BrowserWebViewProps {
  session: PreviewSession
  controller: WebviewController
}

export default function BrowserWebView({ session, controller }: BrowserWebViewProps) {
  // 冻结初始 src：useRef(session.url).current 只取首次渲染的值，后续 re-render 不变。
  // 避免 session.url 变化时 React 更新 src 属性与 effect 的 loadURL() 冲突（-3 ERR_ABORTED）
  const initialSrc = useRef(session.url).current

  return (
    <webview
      ref={controller.webviewRef}
      src={initialSrc}
      title={session.title}
      // 会话分区：缺省沿用主窗口 session。托管类站点传入自己的 persist 分区，
      // 使其后台采集窗口与这里的登录态互通，同时不污染其他站点与主窗口。
      partition={session.partition}
      // allowpopups：页面里 target=_blank / window.open 的请求必须由 guest 转发给主进程，
      // 否则浏览器内核直接把它丢掉，点击表现为完全无响应。真正开不开窗口由主进程
      // registerWebviewGuard 的 setWindowOpenHandler 决定（一律 deny 并交回渲染层新开标签页），
      // 因此这里放开的是「请求转发」，不是「弹窗能力」。
      //
      // 值必须是字符串：allowpopups 是 Electron 自定义的「属性存在即生效」布尔属性，
      // React 只识别标准布尔属性，给这类属性传 true 会告警并丢弃，DOM 上根本不会出现
      // allowpopups——链路就此断在第一步。传空字符串让属性真正落地。
      allowpopups={'' as unknown as boolean}
      // 背景用编辑器底色而不是纯白：webview 挂载到首次绘制之间是空位图，
      // 白色会在打开标签页的瞬间闪出一块白斑，深色底与周围区域连贯。
      className="w-full h-full border-0 bg-background-editor"
      // 不设置 nodeintegration / disablewebsecurity：
      // - nodeIntegration 由主进程 will-attach-webview 强制为 false
      // 共享主窗口 session（默认 partition），保持 cookie 一致
    />
  )
}
