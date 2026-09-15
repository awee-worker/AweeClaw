/**
 * 直播互动 preload API
 *
 * 暴露到 `window.electronAPI.live`，服务于两个消费者：
 * 1. 设置页：三平台配置、连接状态、风险确认、自测推送
 * 2. 主窗口弹幕流面板：订阅 `live:event` 实时渲染
 *
 * 注意：凭证字段由主进程 LiveStore 用 safeStorage 加密落盘，
 * 但**读取时会解密返回**（与 SettingsDb 的 apiKey 行为一致），
 * 因此设置页必须用 password 输入框 + 显隐开关承载，不要明文平铺展示。
 *
 * @module preload/api/live
 */

import { ipcRenderer } from 'electron'
import { invoke, on } from '../ipcHelpers'

/** 统一 IPC 响应结构（与 ipcGuard 的 IpcGuardResponse 对齐） */
export interface LiveIpcResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

/** 直播平台 */
export type LivePlatform = 'bilibili' | 'youtube' | 'twitch'

/** 弹幕类型（与主进程 types.ts 保持一致） */
export type LiveDanmuType =
  | 'danmaku'
  | 'gift'
  | 'buy_guard'
  | 'super_chat'
  | 'enter_room'
  | 'follow'
  | 'like'

/** B站接入方式 */
export type BilibiliLiveMode = 'open_live' | 'web'

/** 归一化直播事件（主进程 → 渲染层的推送体） */
export interface LiveEvent {
  id: string
  type: 'message'
  content: string
  danmu_type: LiveDanmuType
  platform: LivePlatform
  ts: number
  raw?: unknown
}

/** 直播配置（结构与主进程 LiveConfig 一致） */
export interface LiveConfigShape {
  enabled: boolean

  bilibiliEnabled: boolean
  bilibiliType: BilibiliLiveMode
  bilibiliRoomId: string
  bilibiliAccessKeyId: string
  bilibiliAccessKeySecret: string
  bilibiliAppId: string
  bilibiliRoomOwnerAuthCode: string
  bilibiliSessdata: string
  bilibiliWebRiskAccepted: boolean

  youtubeEnabled: boolean
  youtubeVideoId: string
  youtubeApiKey: string

  twitchEnabled: boolean
  twitchChannel: string
  twitchAccessToken: string
  twitchUsername: string
}

/** 单平台连接状态 */
export interface LiveAdapterStatusShape {
  platform: LivePlatform
  running: boolean
  state: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error' | 'stopped'
  message: string
  eventCount: number
  lastEventAt: number | null
  retryCount: number
}

/** 模块运行状态 */
export interface LiveStatusShape {
  enabled: boolean
  running: boolean
  platforms: LiveAdapterStatusShape[]
  totalEvents: number
  droppedEvents: number
  duplicatedEvents: number
  recentEvents: LiveEvent[]
}

/** getConfig / updateConfig 的返回体（附配置完整性提示） */
export interface LiveConfigPayload {
  config: LiveConfigShape
  /** 缺失项提示（不阻断保存，仅用于 UI 引导） */
  issues: string[]
}

/** 创建直播互动 API 集合 */
export function createLiveApi() {
  return {
    // --------------------------------------------
    // 配置
    // --------------------------------------------
    getConfig: invoke<LiveIpcResponse<LiveConfigPayload>>('live:get-config'),
    updateConfig: (patch: Partial<LiveConfigShape>) =>
      ipcRenderer.invoke('live:update-config', patch) as Promise<
        LiveIpcResponse<LiveConfigPayload>
      >,
    resetConfig: invoke<LiveIpcResponse<LiveConfigPayload>>('live:reset-config'),
    setEnabled: (enabled: boolean) =>
      ipcRenderer.invoke('live:set-enabled', enabled) as Promise<
        LiveIpcResponse<LiveConfigPayload>
      >,

    // --------------------------------------------
    // 生命周期
    // --------------------------------------------
    start: invoke<LiveIpcResponse<LiveStatusShape>>('live:start'),
    stop: invoke<LiveIpcResponse<LiveStatusShape>>('live:stop'),
    reload: invoke<LiveIpcResponse<LiveStatusShape>>('live:reload'),
    getStatus: invoke<LiveIpcResponse<LiveStatusShape>>('live:get-status'),

    // --------------------------------------------
    // 自测：合成事件走完整链路（总线 → 悬浮层 + 渲染层）
    // --------------------------------------------
    pushTest: (payload: { content: string; danmu_type?: LiveDanmuType; platform?: LivePlatform }) =>
      ipcRenderer.invoke('live:push-test', payload) as Promise<
        LiveIpcResponse<{ delivered: boolean }>
      >,

    // --------------------------------------------
    // 事件订阅（弹幕流面板专用）
    // --------------------------------------------
    /** 订阅归一化直播事件，返回取消订阅函数 */
    onEvent: (callback: (event: LiveEvent) => void) => on<LiveEvent>('live:event')(callback),
  }
}
