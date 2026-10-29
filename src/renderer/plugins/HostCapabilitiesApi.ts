/**
 * 宿主能力通道协议
 *
 * 场景与插件都跑在渲染进程的同一个 window 里，但它们拿不到客户端内部服务：
 * 语音合成走 voiceApi、设置页与插件市场由 layout / dialog slice 控制，这些都不在
 * 它们的可见范围内。这里用 CustomEvent 定一组「请求 + 应答」事件，调用方派发请求
 * 并自行按 requestId 配对结果，宿主侧的 HostCapabilitiesBridge 负责转译。
 *
 * 通道刻意做成哑管道：事件的 detail 里只有业务参数，没有客户端内部对象。
 * 调用方无法借它拿到 store、api 或任何可写句柄，能力边界由宿主单方面决定。
 *
 * @module renderer/plugins/HostCapabilitiesApi
 */

/**
 * 语音合成请求 / 应答
 *
 * 合成的是「单句配音」这种量级，正文上限 4000 字符。请求按到达顺序串行执行，
 * 并发打同一家 TTS 服务容易被限流，而且客户端本来也没有并发配额。
 */
export const HOST_TTS_REQUEST_EVENT = 'aweeclaw:host-tts-request'
export const HOST_TTS_RESULT_EVENT = 'aweeclaw:host-tts-result'

export interface HostTtsRequestDetail {
  /** 调用方生成的请求标识，应答时原样带回 */
  requestId: string
  text: string
  /** Provider 音色；离线引擎会忽略它（音色由「设置 → 本地语音」决定） */
  voice?: string
  speed?: number
  format?: 'mp3' | 'wav'
  language?: string
}

export interface HostTtsResultDetail {
  requestId: string
  success: boolean
  /** 音频内容，base64，不含 data: 前缀 */
  base64?: string
  /** 音频 MIME，调用方据此决定落盘扩展名 */
  mime?: string
  error?: string
}

/** 语音能力状态查询 / 应答 */
export const HOST_VOICE_STATUS_REQUEST_EVENT = 'aweeclaw:host-voice-status-request'
export const HOST_VOICE_STATUS_RESULT_EVENT = 'aweeclaw:host-voice-status-result'

/** 合成实际走的引擎 */
export type HostVoiceEngine = 'local' | 'cloud' | 'direct' | 'none'

/** 音色选项 */
export interface HostVoiceOption {
  id: string
  name: string
  group?: string
}

export interface HostVoiceStatusDetail {
  requestId: string
  /** 是否已具备可用的合成链路 */
  configured: boolean
  engine: HostVoiceEngine
  /** Provider id（cloud / direct 时有值） */
  provider: string
  /** Provider 展示名 */
  providerLabel: string
  model: string
  /** 当前默认音色 */
  voice: string
  /** 可选音色；离线引擎下为空，音色由本地设置决定 */
  voices: HostVoiceOption[]
  /** 不可用时的原因与处理办法 */
  reason?: string
  /** 引导用户去哪个设置页 */
  settingsTarget: 'voice' | 'local-voice'
}

/**
 * 界面导航请求
 *
 * 场景把「去装插件」「去配语音」这类动作交给宿主执行：它不知道侧栏面板 id，
 * 也不该直接改客户的布局状态。
 */
export const HOST_NAVIGATE_REQUEST_EVENT = 'aweeclaw:host-navigate-request'
export const HOST_NAVIGATE_RESULT_EVENT = 'aweeclaw:host-navigate-result'

export type HostNavigateTarget =
  /** 插件与技能市场（侧栏面板） */
  | 'plugin-market'
  /** 场景应用市场 */
  | 'scenario-market'
  /** 设置 → 语音设置 */
  | 'voice-settings'
  /** 设置 → 本地语音 */
  | 'local-voice-settings'
  /** 设置首页 */
  | 'settings'
  /** 环境检测弹窗（ffmpeg 等本地依赖） */
  | 'environment'

export interface HostNavigateRequestDetail {
  requestId: string
  target: HostNavigateTarget
  /** 插件市场 / 场景市场里的搜索词，用于直接落到目标条目 */
  query?: string
}

export interface HostNavigateResultDetail {
  requestId: string
  success: boolean
  error?: string
}
