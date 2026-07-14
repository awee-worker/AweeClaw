/**
 * 语音模型服务商列表（STT/TTS + Realtime）
 *
 * 一、OpenAI 兼容协议（直接走 /audio/transcriptions 和 /audio/speech）：
 *   - OpenAI、Azure OpenAI、SiliconFlow、Groq、Together AI、OpenRouter、自定义
 *
 * 二、阿里云百炼（专有协议，需在 voiceApi.ts 中特殊适配）：
 *   - STT：Paraformer（异步任务模式）
 *   - TTS：CosyVoice（同步返回 base64 音频）
 *
 * 三、端到端实时语音（WebSocket）：
 *   - OpenAI Realtime、自定义 realtime endpoint
 */

export interface VoiceProviderPreset {
  /** 服务商 ID（作为 select 的 value） */
  id: string
  /** 显示名称 */
  displayName: string
  /** 默认 Base URL（含 /v1 版本前缀，用户可修改） */
  baseUrl: string
  /** 默认 STT 模型 */
  sttModel?: string
  /** 默认 TTS 模型 */
  ttsModel?: string
  /** 默认 TTS 音色 */
  ttsVoice?: string
  /** 是否支持 STT */
  supportsStt: boolean
  /** 是否支持 TTS */
  supportsTts: boolean
  /** 官网/注册链接 */
  website?: string
  /** 备注 */
  note?: string
}

/**
 * 支持的语音服务商列表
 *
 * 国外：OpenAI、Azure、Groq、Together AI、OpenRouter
 * 国内：SiliconFlow（硅基流动）、aliyun（阿里云百炼）
 * 通用：自定义（OpenAI 兼容协议）
 *
 * 注意：
 * - 大多数 Provider 走 OpenAI 兼容协议（/audio/transcriptions、/audio/speech）
 * - aliyun 走专有协议，voiceApi.ts 中有特殊适配分支
 */
export const VOICE_PROVIDERS: VoiceProviderPreset[] = [
  {
    id: 'openai',
    displayName: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    sttModel: 'whisper-1',
    ttsModel: 'tts-1',
    ttsVoice: 'alloy',
    supportsStt: true,
    supportsTts: true,
    website: 'https://platform.openai.com',
    note: '官方 Whisper STT + TTS，质量最佳',
  },
  {
    id: 'azure',
    displayName: 'Azure OpenAI',
    baseUrl: '',
    sttModel: 'whisper-1',
    ttsModel: 'tts-1',
    ttsVoice: 'alloy',
    supportsStt: true,
    supportsTts: true,
    website: 'https://azure.microsoft.com/products/ai-services/openai-service',
    note: '需填入 Azure 部署的 endpoint（如 https://<resource>.openai.azure.com/openai/deployments/<deployment>/）',
  },
  {
    id: 'siliconflow',
    displayName: '硅基流动 SiliconFlow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    sttModel: 'FunAudioLLM/SenseVoiceSmall',
    ttsModel: 'FunAudioLLM/CosyVoice2-0.5B',
    // SiliconFlow 的 voice 格式必须是 `<model_name>:<voice_name>`
    // 8 种预置音色：alex/benjamin/charles/david（男）, anna/bella/claire/diana（女）
    ttsVoice: 'FunAudioLLM/CosyVoice2-0.5B:alex',
    supportsStt: true,
    supportsTts: true,
    website: 'https://siliconflow.cn',
    note: '国内可直连。voice 格式必须为 model:voice（如 FunAudioLLM/CosyVoice2-0.5B:anna）',
  },
  {
    id: 'groq',
    displayName: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    sttModel: 'whisper-large-v3',
    ttsModel: '',
    supportsStt: true,
    supportsTts: false,
    website: 'https://groq.com',
    note: '极速 Whisper STT（不支持 TTS）',
  },
  {
    id: 'together',
    displayName: 'Together AI',
    baseUrl: 'https://api.together.xyz/v1',
    sttModel: 'whisper-1',
    ttsModel: '',
    supportsStt: true,
    supportsTts: false,
    website: 'https://www.together.ai',
    note: '支持 Whisper STT（不支持 TTS）',
  },
  {
    id: 'openrouter',
    displayName: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    sttModel: 'openai/whisper-1',
    ttsModel: '',
    supportsStt: true,
    supportsTts: false,
    website: 'https://openrouter.ai',
    note: '聚合平台，支持多模型 STT',
  },
  {
    id: 'aliyun',
    displayName: '阿里云百炼 DashScope',
    baseUrl: 'https://dashscope.aliyuncs.com',
    sttModel: 'paraformer-v2',
    ttsModel: 'cosyvoice-v3.5-plus',
    ttsVoice: 'longxiaochun',
    supportsStt: true,
    supportsTts: true,
    website: 'https://dashscope.console.aliyun.com',
    note: '专有协议：STT 用 Paraformer（异步任务），TTS 用 CosyVoice。需在百炼控制台开通服务并获取 API Key',
  },
  {
    id: 'custom',
    displayName: '自定义 (OpenAI 兼容)',
    baseUrl: '',
    sttModel: 'whisper-1',
    ttsModel: 'tts-1',
    ttsVoice: 'alloy',
    supportsStt: true,
    supportsTts: true,
    note: '任意支持 OpenAI 语音协议的服务商',
  },
]

/** 根据 ID 获取服务商预设 */
export function getVoiceProviderPreset(id: string): VoiceProviderPreset | undefined {
  return VOICE_PROVIDERS.find(p => p.id === id)
}

/**
 * 端到端实时语音模型服务商预设
 *
 * 用于 WebSocket 实时语音对话场景。
 * baseUrl 为 WebSocket 端点（wss://）。
 */
export interface RealtimeProviderPreset {
  /** 服务商 ID */
  id: string
  /** 显示名称 */
  displayName: string
  /** WebSocket 端点（wss://） */
  baseUrl: string
  /** 默认模型 */
  model: string
  /** 默认音色 */
  voice: string
  /** 官网/注册链接 */
  website?: string
  /** 备注 */
  note?: string
}

/**
 * 端到端实时语音服务商列表
 *
 * - OpenAI Realtime：官方 gpt-4o-realtime / gpt-4o-mini-realtime
 * - 自定义 realtime endpoint：任意兼容 OpenAI Realtime API 的 WebSocket 端点
 */
export const REALTIME_PROVIDERS: RealtimeProviderPreset[] = [
  {
    id: 'openai-realtime',
    displayName: 'OpenAI Realtime',
    baseUrl: 'wss://api.openai.com/v1/realtime',
    model: 'gpt-4o-realtime',
    voice: 'alloy',
    website: 'https://platform.openai.com/docs/guides/realtime',
    note: '官方端到端实时语音，低延迟、支持打断。模型可选 gpt-4o-realtime 或 gpt-4o-mini-realtime',
  },
  {
    id: 'custom-realtime',
    displayName: '自定义 Realtime (WebSocket)',
    baseUrl: '',
    model: 'gpt-4o-realtime',
    voice: 'alloy',
    note: '任意兼容 OpenAI Realtime API 的 WebSocket 端点（wss://）',
  },
]

/** 根据 ID 获取实时语音服务商预设 */
export function getRealtimeProviderPreset(id: string): RealtimeProviderPreset | undefined {
  return REALTIME_PROVIDERS.find(p => p.id === id)
}
