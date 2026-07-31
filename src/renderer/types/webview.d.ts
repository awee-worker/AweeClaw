/**
 * <webview> 标签类型增强
 *
 * @types/react 已为 JSX.IntrinsicElements.webview 定义了 HTMLWebViewElement，
 * 但该类型仅含 HTMLElement 基础能力，缺少 Electron WebviewTag 的命令方法
 * （loadURL/reload/goBack/goForward/canGoBack/canGoForward/stop/openDevTools/
 * closeDevTools/isDevToolsOpened/setZoomFactor/getZoomFactor 等）。
 *
 * 此处通过 interface 合并，让 HTMLWebViewElement 继承 WebviewTag 的全部方法，
 * 使 `<webview ref={...}>` 拿到的 DOM 节点可直接调用命令式 API，无需类型断言。
 *
 * 安全说明：webview 的启用由主窗口 webPreferences.webviewTag 控制，
 * 并由 will-attach-webview 守卫强制覆盖 webPreferences（nodeIntegration:false 等）。
 */
import type { WebviewTag } from 'electron'

declare global {
  interface HTMLWebViewElement extends WebviewTag {}
}

export {}
