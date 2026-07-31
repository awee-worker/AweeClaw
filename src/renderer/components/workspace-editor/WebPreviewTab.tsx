/**
 * 内置浏览器预览标签页入口（懒加载锚点）
 *
 * 实际实现已拆分至 ./browser/ 目录：
 * - BrowserPreviewTab：主编排组件
 * - BrowserToolbar / BrowserAddressBar / BrowserWebView / BrowserEmptyState / BrowserStatusOverlay
 * - hooks/useWebviewController + hooks/usePreviewSessionSync
 *
 * 此处仅做 re-export，保持 WorkspaceEditor.tsx 的懒加载引用路径不变：
 *   const BrowserPreviewTab = safeLazy(() => import('./WebPreviewTab'), ...)
 */
export { default } from './browser/BrowserPreviewTab'
