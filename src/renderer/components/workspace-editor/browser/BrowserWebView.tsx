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
      className="w-full h-full border-0 bg-white"
      // 不设置 nodeintegration / disablewebsecurity / allowpopups：
      // - nodeIntegration 由主进程 will-attach-webview 强制为 false
      // - 弹窗由主进程 setWindowOpenHandler 统一拦截
      // 共享主窗口 session（默认 partition），保持 cookie 一致
    />
  )
}
