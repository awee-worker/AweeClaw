/**
 * VTS（VTube Studio）联动 preload API
 *
 * 暴露到 `window.electronAPI.vts`，服务于两个消费者：
 * 1. 设置页：连接/授权、口型模式、表情热键清单、自测
 * 2. 音频旁路：TTS 音频 → 主进程做口型分析（`pushAudio`）
 *
 * 注意：`token` 由主进程 VtsStore 用 safeStorage 加密落盘，
 * 但**读取时会解密返回**（与 LiveStore 的凭证行为一致），
 * 因此设置页必须用 password 输入框承载，不要明文平铺展示。
 *
 * @module preload/api/vts
 */

import { ipcRenderer } from 'electron'
import { invoke, on } from '../ipcHelpers'

/** 统一 IPC 响应结构（与 ipcGuard 的 IpcGuardResponse 对齐） */
export interface VtsIpcResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

/** 口型驱动模式 */
export type VtsLipSyncMode = 'rms' | 'fft'

/** VTS 连接状态 */
export type VtsConnectionState =
  | 'idle'
  | 'connecting'
  | 'authenticating'
  | 'connected'
  | 'error'
  | 'stopped'

/** 模型表情 */
export interface VtsExpression {
  name: string
  file: string
  active: boolean
}

/** 模型热键 */
export interface VtsHotkey {
  name: string
  hotkeyID: string
  type: string
}

/** VTS 配置（结构与主进程 VtsConfig 一致） */
export interface VtsConfigShape {
  enabled: boolean
  url: string
  token: string
  pluginName: string
  pluginDeveloper: string
  lipSyncMode: VtsLipSyncMode
  autoLipSync: boolean
  enabledExpressions: boolean
  enabledMotions: boolean
}

/** 模块运行状态 */
export interface VtsStatusShape {
  enabled: boolean
  running: boolean
  state: VtsConnectionState
  message: string
  url: string
  authenticated: boolean
  lastFrameAt: number | null
  framesSent: number
  framesDropped: number
  mouthOpen: number
  pendingFrames: number
  expressions: VtsExpression[]
  hotkeys: VtsHotkey[]
  activeExpressions: string[]
}

/** getConfig / updateConfig 的返回体（附配置完整性提示） */
export interface VtsConfigPayload {
  config: VtsConfigShape
  /** 缺失项提示（不阻断保存，仅用于 UI 引导） */
  issues: string[]
}

/** 状态推送载荷（`vts:status` 事件） */
export interface VtsStatusPayload {
  status: VtsStatusShape
  expressions?: VtsExpression[]
  hotkeys?: VtsHotkey[]
}

/** 创建 VTS 联动 API 集合 */
export function createVtsApi() {
  return {
    // --------------------------------------------
    // 配置
    // --------------------------------------------
    getConfig: invoke<VtsIpcResponse<VtsConfigPayload>>('vts:get-config'),
    updateConfig: (patch: Partial<VtsConfigShape>) =>
      ipcRenderer.invoke('vts:update-config', patch) as Promise<VtsIpcResponse<VtsConfigPayload>>,
    resetConfig: invoke<VtsIpcResponse<VtsConfigPayload>>('vts:reset-config'),

    // --------------------------------------------
    // 连接生命周期
    // --------------------------------------------
    connect: invoke<VtsIpcResponse<VtsStatusShape>>('vts:connect'),
    disconnect: invoke<VtsIpcResponse<VtsStatusShape>>('vts:disconnect'),
    /** 断开后重连：用于清掉失效 token、重新发起授权 */
    reconnect: invoke<VtsIpcResponse<VtsStatusShape>>('vts:reconnect'),
    getStatus: invoke<VtsIpcResponse<VtsStatusShape>>('vts:get-status'),
    refreshData: invoke<VtsIpcResponse<VtsStatusShape>>('vts:refresh-data'),

    // --------------------------------------------
    // 表情 / 热键
    // --------------------------------------------
    trigger: (name: string) =>
      ipcRenderer.invoke('vts:trigger', name) as Promise<
        VtsIpcResponse<{ triggered: { kind: 'expression' | 'hotkey'; name: string } | null }>
      >,
    /**
     * 从整段回复里提取 `<名字>` 标签并依次触发。
     *
     * 只在回复收尾时调用（不是流式每个 token 都调），否则一句话里会反复切表情。
     */
    triggerText: (text: string) =>
      ipcRenderer.invoke('vts:trigger-text', text) as Promise<
        VtsIpcResponse<{ hits: Array<{ kind: 'expression' | 'hotkey'; name: string }> }>
      >,

    // --------------------------------------------
    // 口型驱动
    // --------------------------------------------
    /**
     * 推入一段 TTS 音频（主口型通道）。
     *
     * 载荷走 structured clone：传 `Uint8Array` 或 `ArrayBuffer` 均可，
     * 主进程统一转成 Buffer 交给 ffmpeg。mimeType 用于提升格式探测准确率，
     * 不确定时可省略。
     */
    pushAudio: (data: Uint8Array | ArrayBuffer, mimeType?: string) =>
      ipcRenderer.invoke('vts:push-audio', data, mimeType) as Promise<
        VtsIpcResponse<{ queued: number }>
      >,

    /** 按音量驱动（降级通道：拿不到完整音频体时使用） */
    pushVolume: (volume: number) =>
      ipcRenderer.invoke('vts:push-volume', volume) as Promise<VtsIpcResponse<void>>,

    /** 中断口型（用户点「停止」/ 新回复打断旧音频） */
    clearAudio: invoke<VtsIpcResponse<VtsStatusShape>>('vts:clear-audio'),

    // --------------------------------------------
    // 自测
    // --------------------------------------------
    /** 合成一段正弦波走完整口型链路（不依赖 TTS，用于验收） */
    selfTest: (durationMs?: number) =>
      ipcRenderer.invoke('vts:self-test', durationMs) as Promise<
        VtsIpcResponse<{ queued: number }>
      >,

    // --------------------------------------------
    // 事件订阅
    // --------------------------------------------
    /** 订阅状态变化（连接态 / 模型数据），返回取消订阅函数 */
    onStatus: (callback: (payload: VtsStatusPayload) => void) => on<VtsStatusPayload>('vts:status')(callback),
  }
}
