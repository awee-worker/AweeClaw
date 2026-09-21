/**
 * 内置预览 API
 *
 * 覆盖 IPC 频道：
 * - preview:resolveLocalUrl   本地静态文件 → 内置浏览器可加载的 http 地址
 * - preview:health-attach     webview guest 绑定到预览会话（开始健康采集）
 * - preview:health-detach     解绑 guest（停止健康采集）
 * - preview:health-get        读取指定会话的健康快照
 * - preview:network-collect   采集页面资源瀑布
 * - preview:health-changed    健康状态推送（main → render）
 * - preview:auto-reload-watch   登记预览目录的自动刷新
 * - preview:auto-reload-unwatch 取消预览目录的自动刷新
 * - preview:auto-reload      目录变化触发的刷新通知（main → render）
 */
import { invoke, on } from '../ipcHelpers'
import {
  PREVIEW_AUTO_RELOAD_CHANNEL,
  PREVIEW_HEALTH_CHANNEL,
  type DevToolsRect,
  type PreviewAutoReloadPayload,
  type PreviewHealthSnapshot,
  type PreviewNetworkEntry,
} from '../../../shared/protocols/previewProtocol'

/** 统一 IPC 响应格式 */
interface PreviewIpcResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

export function createPreviewApi() {
  return {
    /**
     * 把本地文件（或目录）解析成内置浏览器可加载的地址
     *
     * @param localPath 绝对路径
     */
    resolveLocalUrl: (localPath: string) =>
      invoke<{ success: boolean; url?: string; error?: string }>('preview:resolveLocalUrl')(localPath),

    /** 绑定 webview guest 到预览会话，返回初始健康快照 */
    healthAttach: (guestId: number, sessionId: string, url: string) =>
      invoke<PreviewIpcResponse<PreviewHealthSnapshot>>('preview:health-attach')(
        guestId,
        sessionId,
        url,
      ),

    /** 解绑 webview guest，停止健康采集 */
    healthDetach: (guestId: number) => invoke<PreviewIpcResponse>('preview:health-detach')(guestId),

    /** 读取指定会话的健康快照 */
    healthGet: (sessionId: string) =>
      invoke<PreviewIpcResponse<PreviewHealthSnapshot | null>>('preview:health-get')(sessionId),

    /** 采集页面资源瀑布（排查加载问题时按需调用） */
    collectNetwork: (guestId: number) =>
      invoke<PreviewIpcResponse<PreviewNetworkEntry[]>>('preview:network-collect')(guestId),

    /** 订阅健康状态推送 */
    onHealth: on<PreviewHealthSnapshot>(PREVIEW_HEALTH_CHANNEL),

    /** 登记预览目录的自动刷新（本地静态页面专用，dev server 自带 HMR） */
    watchAutoReload: (rootDir: string, url: string) =>
      invoke<PreviewIpcResponse>('preview:auto-reload-watch')(rootDir, url),

    /** 取消预览目录的自动刷新 */
    unwatchAutoReload: (rootDir: string, url: string) =>
      invoke<PreviewIpcResponse>('preview:auto-reload-unwatch')(rootDir, url),

    /** 订阅目录变化触发的自动刷新 */
    onAutoReload: on<PreviewAutoReloadPayload>(PREVIEW_AUTO_RELOAD_CHANNEL),

    /** 把预览 webview 的 DevTools 内嵌到应用内（条件不满足时 docked=false，调用方回退独立窗口） */
    openDevTools: (guestId: number, rect: DevToolsRect) =>
      invoke<PreviewIpcResponse<{ docked: boolean }>>('preview:devtools-open')(guestId, rect),

    /** 同步内嵌 DevTools 的面板矩形 */
    setDevToolsBounds: (guestId: number, rect: DevToolsRect) =>
      invoke<PreviewIpcResponse>('preview:devtools-bounds')(guestId, rect),

    /** 关闭内嵌 DevTools */
    closeDevTools: (guestId: number) =>
      invoke<PreviewIpcResponse>('preview:devtools-close')(guestId),
  }
}