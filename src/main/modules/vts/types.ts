/**
 * VTS（VTube Studio）联动协议类型
 *
 * 协议契约来自 super-ai-browser 的 `py/vts_manager.py`，字段名与消息类型保持
 * 一致（便于行为对齐、参数逐字对照调优）：
 *
 *   apiName     : VTubeStudioPublicAPI
 *   apiVersion  : 1.0
 *   messageType : AuthenticationTokenRequest / AuthenticationRequest /
 *                 HotkeysInCurrentModelRequest / ExpressionStateRequest /
 *                 ExpressionActivationRequest / HotkeyTriggerRequest /
 *                 InjectParameterDataRequest
 *
 * AweeClaw 扩展（不破坏既有消费方）：lipSyncMode / autoLipSync / 状态统计字段。
 *
 * @module vts/types
 */

/** 口型驱动模式 */
export type VtsLipSyncMode =
  /** 仅用 RMS 音量驱动（不区分元音/辅音，无需 FFT，最省 CPU） */
  | 'rms'
  /** RMS + FFT 元音/辅音能量分离（默认，与源项目算法一致） */
  | 'fft'

/** VTS 连接状态 */
export type VtsConnectionState =
  /** 未启动 */
  | 'idle'
  /** TCP/WS 建连中 */
  | 'connecting'
  /** 已建连，鉴权握手进行中 */
  | 'authenticating'
  /** 已鉴权，可收发指令 */
  | 'connected'
  /** 出错（含鉴权失败） */
  | 'error'
  /** 已停止 */
  | 'stopped'

/** 模型表情（ExpressionStateResponse.expressions 的子项） */
export interface VtsExpression {
  /** 表情名（AI 通过 <名字> 标签触发） */
  name: string
  /** 表情文件名（ExpressionActivationRequest.expressionFile 用） */
  file: string
  /** 当前是否激活 */
  active: boolean
}

/**
 * 模型热键（HotkeysInCurrentModelResponse.availableHotkeys 的子项）。
 *
 * 源项目会过滤掉 `ToggleExpression` 类型 —— 那类热键由表情通道单独处理，
 * 混在一起会出现「同一个名字触发两次」。
 */
export interface VtsHotkey {
  name: string
  hotkeyID: string
  type: string
}

/**
 * VTS 配置。
 *
 * 安全约定：`token` 在落盘前由 VtsStore 用 safeStorage 加密（禁止明文）。
 * `url` 只允许本机环回地址（VTS 是本地应用，不提供远程 API）。
 */
export interface VtsConfig {
  /** 总开关：关闭时不建立任何连接 */
  enabled: boolean
  /** VTS 公共 API 地址（默认 ws://127.0.0.1:8001） */
  url: string
  /** 鉴权 token（首次授权后由 VTS 下发，加密落盘；清空即重新授权） */
  token: string
  /** 插件名（VTS 授权弹窗中展示） */
  pluginName: string
  /** 插件开发者（VTS 授权弹窗中展示） */
  pluginDeveloper: string
  /** 口型驱动模式 */
  lipSyncMode: VtsLipSyncMode
  /** AI 回复时自动驱动口型（对接 TTS 音频链路） */
  autoLipSync: boolean
  /** 允许 AI 通过标签触发模型表情 */
  enabledExpressions: boolean
  /** 允许 AI 通过标签触发热键 */
  enabledMotions: boolean
}

/** 模块运行状态（IPC `vts:get-status` 返回） */
export interface VtsStatus {
  /** 配置总开关 */
  enabled: boolean
  /** 是否处于连接中/已连接 */
  running: boolean
  state: VtsConnectionState
  /** 状态说明（错误原因 / 授权提示） */
  message: string
  /** 当前连接地址 */
  url: string
  /** 是否已通过鉴权 */
  authenticated: boolean
  /** 最近一次发送 PCM 帧的时间（ms） */
  lastFrameAt: number | null
  /** 累计发送的口型帧数 */
  framesSent: number
  /** 累计丢弃的帧数（未连接 / 主动清空队列） */
  framesDropped: number
  /** 当前口型开合值（0~1，调试用） */
  mouthOpen: number
  /** 队列中待发送的帧数 */
  pendingFrames: number
  /** 模型表情清单 */
  expressions: VtsExpression[]
  /** 模型热键清单 */
  hotkeys: VtsHotkey[]
  /** 当前激活的表情名 */
  activeExpressions: string[]
}

// ============================================
// VTS 线上协议（wire format）
// ============================================

/** VTS 请求消息（统一信封） */
export interface VtsRequest {
  apiName: 'VTubeStudioPublicAPI'
  apiVersion: '1.0'
  requestID: string
  messageType: string
  data: Record<string, unknown>
}

/** VTS 响应消息（统一信封） */
export interface VtsResponse {
  apiName?: string
  apiVersion?: string
  requestID?: string
  messageType?: string
  data?: Record<string, unknown>
  /** APIError 时存在 */
  message?: string
}

/** AuthenticationTokenResponse.data */
export interface VtsAuthTokenData {
  authenticationToken?: string
}

/** AuthenticationResponse.data */
export interface VtsAuthData {
  authenticated?: boolean
  reason?: string
}

/** ExpressionStateResponse.data */
export interface VtsExpressionStateData {
  expressions?: Array<{ name?: string; file?: string; active?: boolean }>
}

/** HotkeysInCurrentModelResponse.data */
export interface VtsHotkeysData {
  availableHotkeys?: Array<{ name?: string; hotkeyID?: string; type?: string }>
}

// ============================================
// 口型算法常量（照搬源 vts_manager.py，已调优，勿改）
// ============================================

/** 目标采样率（Hz） */
export const VTS_SAMPLE_RATE = 24000
/** 帧节流值（秒）—— 实际帧长按 sampleRate * frameMs 计算 */
export const VTS_FRAME_MS = 0.035
/** RMS 阈值（对标 TTS 的真实高音量） */
export const VTS_RMS_THRESHOLD = 15000.0
/** 口型平滑系数 */
export const VTS_SMOOTH_FACTOR = 0.45
/** RMS 地板值：低于此值不驱动（静音段不抖嘴） */
export const VTS_RMS_FLOOR = 400
