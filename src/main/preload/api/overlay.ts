/**
 * 悬浮层（字幕 / 弹幕）preload API
 *
 * 暴露到 `window.electronAPI.overlay`，服务于两个消费者：
 * 1. 悬浮页面本身（应用内窗口模式）：订阅 `overlay:event` 渲染内容
 * 2. 设置页：读写配置、查看状态、拿到 OBS 可用的地址
 *
 * 注意：OBS 通过 HTTP 加载的悬浮页面**没有 preload**（不是 Electron 环境），
 * 页面会自行降级到 WebSocket 通道，因此这里的方法都是「应用内模式」专用。
 *
 * @module preload/api/overlay
 */

import { ipcRenderer } from 'electron'
import { invoke, on } from '../ipcHelpers'

/** 统一 IPC 响应结构（与 ipcGuard 的 IpcGuardResponse 对齐） */
export interface OverlayIpcResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

/** 弹幕类型（与主进程 types.ts 保持一致） */
export type OverlayDanmuType =
  | 'danmaku'
  | 'gift'
  | 'buy_guard'
  | 'super_chat'
  | 'enter_room'
  | 'follow'
  | 'like'

export interface OverlayEventPayload {
  id: string
  type: 'message'
  content: string
  danmu_type: OverlayDanmuType
  platform?: string
  ts?: number
}

/** 主进程下发的指令 */
export type OverlayCommand =
  | { action: 'show'; data: OverlayEventPayload }
  | { action: 'clear' }

/** 悬浮层配置（结构与主进程 OverlayConfig 一致，此处按需最小化声明） */
export interface OverlayConfigShape {
  enabled: boolean
  serverEnabled: boolean
  port: number
  windowEnabled: boolean
  windowMode: 'subtitle' | 'danmaku'
  window: {
    width: number
    height: number
    positionX: number | null
    positionY: number | null
    opacity: number
    alwaysOnTop: boolean
    clickThrough: boolean
    locked: boolean
  }
  subtitle: {
    fontSize: number
    durationMs: number
    maxLines: number
    strokeWidth: number
    bgOpacity: number
  }
  danmaku: {
    fontSize: number
    speed: number
    tracks: number
    opacity: number
    filterLowPriority: boolean
  }
}

/** 运行状态 */
export interface OverlayStatus {
  serverRunning: boolean
  port: number
  wsClients: number
  windowCreated: boolean
  windowVisible: boolean
  windowMode: 'subtitle' | 'danmaku'
  urls: { subtitle: string; danmaku: string; ws: string }
  recentEvents: OverlayEventPayload[]
}

/** 创建悬浮层 API 集合 */
export function createOverlayApi() {
  return {
    // --------------------------------------------
    // 配置
    // --------------------------------------------
    getConfig: invoke<OverlayIpcResponse<OverlayConfigShape>>('overlay:get-config'),
    updateConfig: (patch: Partial<OverlayConfigShape>) =>
      ipcRenderer.invoke('overlay:update-config', patch) as Promise<
        OverlayIpcResponse<OverlayConfigShape>
      >,
    resetConfig: invoke<OverlayIpcResponse<OverlayConfigShape>>('overlay:reset-config'),
    setEnabled: (enabled: boolean) =>
      ipcRenderer.invoke('overlay:set-enabled', enabled) as Promise<
        OverlayIpcResponse<OverlayConfigShape>
      >,

    // --------------------------------------------
    // 状态
    // --------------------------------------------
    getStatus: invoke<OverlayIpcResponse<OverlayStatus>>('overlay:get-status'),

    // --------------------------------------------
    // 推送
    // --------------------------------------------
    showSubtitle: (content: string) =>
      ipcRenderer.invoke('overlay:show-subtitle', content) as Promise<
        OverlayIpcResponse<{ delivered: number }>
      >,
    pushDanmaku: (payload: Partial<OverlayEventPayload> & { content: string }) =>
      ipcRenderer.invoke('overlay:push-danmaku', payload) as Promise<
        OverlayIpcResponse<{ delivered: number }>
      >,
    clear: invoke<OverlayIpcResponse<{ ok: boolean }>>('overlay:clear'),

    // --------------------------------------------
    // 应用内窗口
    // --------------------------------------------
    showWindow: invoke<OverlayIpcResponse<{ visible: boolean }>>('overlay:show-window'),
    hideWindow: invoke<OverlayIpcResponse<{ visible: boolean }>>('overlay:hide-window'),
    toggleWindow: invoke<OverlayIpcResponse<{ visible: boolean }>>('overlay:toggle-window'),
    setWindowMode: (mode: 'subtitle' | 'danmaku') =>
      ipcRenderer.invoke('overlay:set-window-mode', mode) as Promise<
        OverlayIpcResponse<{ mode: 'subtitle' | 'danmaku' }>
      >,
    setClickThrough: (enabled: boolean) =>
      ipcRenderer.invoke('overlay:set-click-through', enabled) as Promise<
        OverlayIpcResponse<{ clickThrough: boolean }>
      >,

    // --------------------------------------------
    // 辅助
    // --------------------------------------------
    openExternalUrl: (url: string) =>
      ipcRenderer.invoke('overlay:open-external-url', url) as Promise<
        OverlayIpcResponse<{ opened: string }>
      >,
    copyText: (text: string) =>
      ipcRenderer.invoke('overlay:copy-text', text) as Promise<OverlayIpcResponse<{ copied: string }>>,

    // --------------------------------------------
    // 事件订阅（悬浮页面专用）
    // --------------------------------------------
    /** 订阅主进程下发的指令（show / clear），返回取消订阅函数 */
    onEvent: (callback: (command: OverlayCommand) => void) =>
      on<OverlayCommand>('overlay:event')(callback),
    /** 订阅穿透状态变化（页面据此显隐拖拽条） */
    onClickThroughChanged: (callback: (payload: { clickThrough: boolean }) => void) =>
      on<{ clickThrough: boolean }>('overlay:click-through-changed')(callback),
  }
}
