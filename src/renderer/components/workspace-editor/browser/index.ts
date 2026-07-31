/**
 * 内置浏览器组件集合
 *
 * 入口：WebPreviewTab.tsx（懒加载入口，保持 WorkspaceEditor 引用路径不变）
 * 主组件：BrowserPreviewTab（编排器）
 */
export { default } from './BrowserPreviewTab'
export { default as BrowserPreviewTab } from './BrowserPreviewTab'
export { default as BrowserToolbar } from './BrowserToolbar'
export { default as BrowserAddressBar } from './BrowserAddressBar'
export { default as BrowserWebView } from './BrowserWebView'
export { default as BrowserEmptyState } from './BrowserEmptyState'
export { default as BrowserStatusOverlay } from './BrowserStatusOverlay'
export { useWebviewController } from './hooks/useWebviewController'
export type { WebviewController } from './hooks/useWebviewController'
export { usePreviewSessionSync, sanitizeUrl } from './hooks/usePreviewSessionSync'
export type { PreviewSessionSync } from './hooks/usePreviewSessionSync'
