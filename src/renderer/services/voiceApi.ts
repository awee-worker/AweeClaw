/**
 * 语音服务 API
 *
 * 双路径分流（运行时根据 cloudMode 决策）：
 *
 * 1. 云端模式（cloud）
 *    - 转发到后端 /api/v1/voice/*
 *    - 后端负责 Provider 调用、用量记录、Token 计费
 *    - 用户无需本地配置
 *
 * 2. 自定义模式（custom）
 *    - 客户端直连用户配置的语音 Provider（OpenAI 兼容协议）
 *    - STT 调用 POST {baseUrl}/audio/transcriptions
 *    - TTS 调用 POST {baseUrl}/audio/speech
 *    - 不计 Token 配额（用户自付费）
 *    - 配置存储在本地 SQLite voice_model_config 表
 */

import { backendApi, getServerUrl, getAccessToken, tryRefreshToken } from '../adapters/backendApi';
import { api } from '../adapters/electronBridge';

/**
 * 云端模式状态（模块级缓存，避免对全局 store 的依赖）
 *
 * 设计原因：
 * 原实现 `useStore.getState().cloudMode` 会将 `@store`（聚合 12 个 slice、含 MCP/Monaco/插件等重依赖）
 * 拉入本模块。悬浮头像窗口作为轻量独立 renderer，不能导入 `@store`（会重复启动 MCP 连接等副作用），
 * 因此改用「初始化器注入」模式解耦：
 *
 * - 主窗口 `AweeApp.tsx` 在初始化及 `cloudMode` 变化时调用 `setVoiceCloudMode(mode)` 注入最新值。
 * - 头像窗口通过 IPC 取得 cloudMode 后同样调用 `setVoiceCloudMode(mode)` 注入。
 * - 默认值 `'cloud'` 保持与原行为一致（未注入时按云端模式处理）。
 */
let currentCloudMode: 'cloud' | 'local' = 'cloud';

/**
 * 语音设置独立的云端/自定义模式（来自 voice_model_config.cloud_mode）。
 * null 表示未设置，此时回退到服务商 cloudMode（currentCloudMode）。
 *
 * 与服务商 cloudMode 解耦：用户可在「设置 → 语音设置」中独立切换，
 * 不受服务商全局云端/自定义模式影响。
 */
let currentVoiceCloudMode: 'cloud' | 'local' | null = null;

/** 注入云端模式状态（由主窗口/头像窗口在初始化时调用，语义为「服务商 cloudMode」） */
export function setVoiceCloudMode(mode: 'cloud' | 'local'): void {
  if (mode !== currentCloudMode) {
    currentCloudMode = mode;
  }
}

/** 获取当前服务商云端模式状态（供外部读取，主要用于日志/调试） */
export function getVoiceCloudMode(): 'cloud' | 'local' {
  return currentCloudMode;
}

/** 注入语音设置独立的云端/自定义模式（来自 voice_model_config.cloud_mode） */
export function setVoiceConfigCloudMode(mode: 'cloud' | 'local' | null): void {
  currentVoiceCloudMode = mode;
}

/** 获取语音设置独立的云端/自定义模式（null = 未设置，回退服务商模式） */
export function getVoiceConfigCloudMode(): 'cloud' | 'local' | null {
  return currentVoiceCloudMode;
}

/** 从本地设置数据库加载语音独立云端模式并注入（主窗口初始化/语音设置保存后调用） */
export async function reloadVoiceCloudModeFromDb(): Promise<void> {
  try {
    const result = await api.settings.dbGetVoiceModelConfig()
    const config = result as { cloudMode?: 'cloud' | 'local' } | null
    if (config && typeof config.cloudMode === 'string') {
      setVoiceConfigCloudMode(config.cloudMode)
    }
  } catch (err) {
    console.error('[voiceApi] Reload voice cloud mode failed:', err)
  }
}

export interface SttResult {
  text: string;
  language: string;
  duration: number;
  provider: string;
  confidence?: number;
}

export interface VoiceInfo {
  id: string;
  name: string;
  language: string;
  gender: 'male' | 'female' | 'neutral';
  provider: string;
  previewUrl?: string;
}

export interface VoiceProviders {
  stt: string[];
  tts: string[];
}

export interface VoiceUsageSummary {
  usages: Array<{
    id: string;
    type: 'STT' | 'TTS';
    provider: string;
    durationSeconds: number;
    characterCount: number;
    language: string | null;
    createdAt: string;
  }>;
  summary: {
    totalRequests: number;
    totalDurationSeconds: number;
    totalCharacterCount: number;
  };
  period: {
    days: number;
    since: string;
  };
}

/** 本地语音模型配置（与 SettingsDb.VoiceModelConfig 对齐） */
interface LocalVoiceModelConfig {
  sttEnabled: boolean
  sttProvider: string
  sttModel: string
  sttApiKey: string
  sttBaseUrl: string
  sttLanguage: string
  ttsEnabled: boolean
  ttsProvider: string
  ttsModel: string
  ttsVoice: string
  ttsApiKey: string
  ttsBaseUrl: string
  ttsSpeed: number
}

async function fetchWithAuthRetry(
  url: string,
  init: RequestInit,
): Promise<Response> {
  let res = await fetch(url, init);

  if (res.status === 401) {
    const refreshed = await tryRefreshToken();
    if (refreshed) {
      const newToken = getAccessToken();
      const retryHeaders = { ...init.headers } as Record<string, string>;
      if (newToken) {
        retryHeaders['Authorization'] = `Bearer ${newToken}`;
      }
      res = await fetch(url, { ...init, headers: retryHeaders });
    }
  }

  return res;
}

async function fetchWithoutAuthRetry(
  url: string,
  init: RequestInit,
): Promise<Response> {
  return fetch(url, init);
}

/** 读取语音分流模式：优先使用语音设置独立的云端/自定义模式，未设置时回退服务商 cloudMode */
function isCloudMode(): boolean {
  return currentVoiceCloudMode !== null
    ? currentVoiceCloudMode === 'cloud'
    : currentCloudMode === 'cloud'
}

/** 加载本地语音模型配置（自定义模式使用） */
async function loadLocalVoiceConfig(): Promise<LocalVoiceModelConfig | null> {
  try {
    const result = await api.settings.dbGetVoiceModelConfig()
    return result as LocalVoiceModelConfig | null
  } catch (err) {
    console.error('[voiceApi] Load local voice config failed:', err)
    return null
  }
}

/** 规范化 baseUrl，去除末尾斜杠，补全默认值 */
function normalizeBaseUrl(baseUrl: string, provider: string): string {
  const trimmed = (baseUrl || '').trim().replace(/\/+$/, '')
  if (trimmed) return trimmed
  // 默认 baseUrl
  if (provider === 'openai') return 'https://api.openai.com/v1'
  return ''
}

export const voiceApi = {
  /**
   * 语音识别（STT）：将音频转为文本
   *
   * - 云端模式：转发到后端 /api/v1/voice/stt（计 Token）
   * - 自定义模式：直连用户配置的 STT Provider（不计 Token）
   *
   * @throws 自定义模式下未启用 STT 时抛出错误
   */
  async speechToText(
    audioBlob: Blob,
    options?: { language?: string; noAuthRetry?: boolean; forceLocal?: boolean },
  ): Promise<SttResult> {
    // 拆分式语音模式或自定义模式：使用本地配置直连
    if (!isCloudMode() || options?.forceLocal) {
      return this._sttViaLocal(audioBlob, options)
    }

    // 云端模式：走后端代理
    const serverUrl = getServerUrl();
    const token = getAccessToken();
    if (!serverUrl) throw new Error('Server URL not configured');

    const formData = new FormData();
    const filename = audioBlob.type.includes('wav') ? 'audio.wav' : 'audio.webm';
    formData.append('file', audioBlob, filename);

    const params = new URLSearchParams();
    if (options?.language) {
      params.set('language', options.language);
    }

    const query = params.toString() ? `?${params.toString()}` : '';
    const url = `${serverUrl}/api/v1/voice/stt${query}`;

    const doFetch = options?.noAuthRetry ? fetchWithoutAuthRetry : fetchWithAuthRetry;

    const res = await doFetch(url, {
      method: 'POST',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: formData,
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      throw new Error(`STT request failed: ${res.status} ${errorText}`);
    }

    const json = await res.json();
    return json.data as SttResult;
  },

  /**
   * 自定义模式下的本地 STT 调用
   *
   * - aliyun：走专有 Paraformer 异步任务流程（_sttViaAliyun）
   * - 其他：走 OpenAI Whisper 兼容协议 POST {baseUrl}/audio/transcriptions
   */
  async _sttViaLocal(
    audioBlob: Blob,
    options?: { language?: string },
  ): Promise<SttResult> {
    const config = await loadLocalVoiceConfig()
    if (!config || !config.sttEnabled) {
      throw new Error('STT 未启用：请在「设置 → 模型配置 → 语音模型」中启用并配置 STT')
    }
    if (!config.sttApiKey) {
      throw new Error('STT 配置不完整：请填写 API Key')
    }

    // 阿里云百炼走专有协议
    if (config.sttProvider === 'aliyun') {
      return this._sttViaAliyun(audioBlob, config, options)
    }

    const baseUrl = normalizeBaseUrl(config.sttBaseUrl, config.sttProvider)
    if (!baseUrl) {
      throw new Error('STT 配置不完整：请填写 Base URL')
    }

    const formData = new FormData()
    const filename = audioBlob.type.includes('wav') ? 'audio.wav' : 'audio.webm'
    formData.append('file', audioBlob, filename)
    formData.append('model', config.sttModel)

    // 语言选择优先级：调用参数 > 本地配置 > 不传（让 API 自动检测）
    const language = options?.language && options.language !== 'auto'
      ? options.language
      : (config.sttLanguage !== 'auto' ? config.sttLanguage : undefined)
    if (language) {
      formData.append('language', language)
    }

    const url = `${baseUrl}/audio/transcriptions`
    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.sttApiKey}`,
        },
        body: formData,
      })
    } catch (err) {
      throw new Error(
        `STT 网络请求失败：${err instanceof Error ? err.message : String(err)}（URL: ${url}）`,
      )
    }

    if (!res.ok) {
      const errorText = await res.text().catch(() => '')
      // 404 通常是 baseUrl 不正确或该 Provider 不支持 STT
      if (res.status === 404) {
        throw new Error(
          `STT 接口不存在（404）：请检查「设置 → 语音模型」中 STT 的 Base URL 是否正确。\n` +
          `当前 Provider: ${config.sttProvider}，Base URL: ${baseUrl}\n` +
          `提示：Base URL 应包含版本前缀，如 https://api.openai.com/v1；` +
          `且该 Provider 必须支持 OpenAI Whisper 兼容的 /audio/transcriptions 接口。`,
        )
      }
      if (res.status === 401 || res.status === 403) {
        const keyHint = config.sttApiKey
          ? `（API Key: ${config.sttApiKey.slice(0, 4)}****${config.sttApiKey.slice(-4)}）`
          : '（未配置 API Key）'
        throw new Error(
          `STT 鉴权失败（${res.status}）：请检查 API Key 是否正确${keyHint}`,
        )
      }
      throw new Error(
        `STT 请求失败（${res.status}）：${errorText || '无错误详情'}（URL: ${url}）`,
      )
    }

    const data = await res.json()
    return {
      text: data.text || '',
      language: language || 'auto',
      duration: data.duration || 0,
      provider: config.sttProvider,
    }
  },

  /**
   * 语音合成（TTS）：将文本转为音频
   *
   * - 云端模式：转发到后端 /api/v1/voice/tts（计 Token）
   * - 自定义模式：直连用户配置的 TTS Provider（不计 Token）
   *
   * @throws 自定义模式下未启用 TTS 时抛出错误
   */
  async textToSpeech(
    text: string,
    options?: {
      voice?: string;
      speed?: number;
      format?: 'mp3' | 'wav' | 'opus' | 'aac' | 'flac';
      language?: string;
      forceLocal?: boolean;
    },
  ): Promise<Blob> {
    // 拆分式语音模式或自定义模式：使用本地配置直连
    if (!isCloudMode() || options?.forceLocal) {
      return this._ttsViaLocal(text, options)
    }

    // 云端模式：走后端代理
    const serverUrl = getServerUrl();
    const token = getAccessToken();
    if (!serverUrl) throw new Error('Server URL not configured');

    const url = `${serverUrl}/api/v1/voice/tts`;
    const res = await fetchWithAuthRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ text, ...options }),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      throw new Error(`TTS request failed: ${res.status} ${errorText}`);
    }

    return res.blob();
  },

  /**
   * 自定义模式下的本地 TTS 调用
   *
   * - aliyun：走专有 CosyVoice 流程（_ttsViaAliyun）
   * - 其他：走 OpenAI TTS 兼容协议 POST {baseUrl}/audio/speech
   */
  async _ttsViaLocal(
    text: string,
    options?: {
      voice?: string;
      speed?: number;
      format?: 'mp3' | 'wav' | 'opus' | 'aac' | 'flac';
    },
  ): Promise<Blob> {
    const config = await loadLocalVoiceConfig()
    if (!config || !config.ttsEnabled) {
      throw new Error('TTS 未启用：请在「设置 → 模型配置 → 语音模型」中启用并配置 TTS')
    }
    if (!config.ttsApiKey) {
      throw new Error('TTS 配置不完整：请填写 API Key')
    }

    // 阿里云百炼走专有协议
    if (config.ttsProvider === 'aliyun') {
      return this._ttsViaAliyun(text, config, options)
    }

    const baseUrl = normalizeBaseUrl(config.ttsBaseUrl, config.ttsProvider)
    if (!baseUrl) {
      throw new Error('TTS 配置不完整：请填写 Base URL')
    }

    // 优先使用调用参数，否则用本地配置
    const rawVoice = options?.voice || config.ttsVoice || 'alloy'
    const speed = options?.speed ?? config.ttsSpeed ?? 1.0
    // OpenAI TTS 仅支持 mp3/opus/aac/flac，本地默认 mp3
    const format = options?.format || 'mp3'

    // SiliconFlow 的 voice 格式必须是 `<model_name>:<voice_name>`
    // 用户可能只填了音色名（如 "alex"），自动拼接模型前缀
    let voice = rawVoice
    if (config.ttsProvider === 'siliconflow' && config.ttsModel && !voice.includes(':')) {
      voice = `${config.ttsModel}:${voice}`
    }

    const url = `${baseUrl}/audio/speech`
    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.ttsApiKey}`,
        },
        body: JSON.stringify({
          model: config.ttsModel,
          input: text,
          voice,
          speed,
          response_format: format,
        }),
      })
    } catch (err) {
      throw new Error(
        `TTS 网络请求失败：${err instanceof Error ? err.message : String(err)}（URL: ${url}）`,
      )
    }

    if (!res.ok) {
      const errorText = await res.text().catch(() => '')
      if (res.status === 404) {
        throw new Error(
          `TTS 接口不存在（404）：请检查「设置 → 语音模型」中 TTS 的 Base URL 是否正确。\n` +
          `当前 Provider: ${config.ttsProvider}，Base URL: ${baseUrl}\n` +
          `提示：Base URL 应包含版本前缀，如 https://api.openai.com/v1；` +
          `且该 Provider 必须支持 OpenAI TTS 兼容的 /audio/speech 接口。`,
        )
      }
      if (res.status === 401 || res.status === 403) {
        const keyHint = config.ttsApiKey
          ? `（API Key: ${config.ttsApiKey.slice(0, 4)}****${config.ttsApiKey.slice(-4)}）`
          : '（未配置 API Key）'
        throw new Error(
          `TTS 鉴权失败（${res.status}）：请检查 API Key 是否正确${keyHint}`,
        )
      }
      throw new Error(
        `TTS 请求失败（${res.status}）：${errorText || '无错误详情'}（URL: ${url}）`,
      )
    }

    return res.blob()
  },

  /**
   * 阿里云百炼 STT 适配（Paraformer 异步任务模式）
   *
   * 流程：
   * 1. 上传音频文件到阿里云临时存储：POST {baseUrl}/api/v1/uploads（multipart/form-data）
   *    返回 output.uploaded_file.url（公网可访问 URL）
   * 2. 提交异步识别任务：POST {baseUrl}/api/v1/services/audio/asr/transcription
   *    Header: X-DashScope-Async: enable
   *    Body: { model, input: { file_urls: [url] } }
   *    返回 output.task_id
   * 3. 轮询任务：GET {baseUrl}/api/v1/tasks/{task_id}
   *    直到 output.task_status === 'SUCCEEDED'
   * 4. 拉取 output.results[].transcription_url 的 JSON，提取 transcripts[].text
   *
   * 失败时抛出包含排查建议的友好错误。
   */
  async _sttViaAliyun(
    audioBlob: Blob,
    config: LocalVoiceModelConfig,
    options?: { language?: string },
  ): Promise<SttResult> {
    const baseUrl = normalizeBaseUrl(config.sttBaseUrl, 'aliyun') || 'https://dashscope.aliyuncs.com'
    const apiKey = config.sttApiKey
    const model = config.sttModel || 'paraformer-v2'

    console.info('[voiceApi] Aliyun STT start', { baseUrl, model, audioBytes: audioBlob.size })

    // ===== 1. 上传音频文件 =====
    const uploadUrl = `${baseUrl}/api/v1/uploads`
    const uploadForm = new FormData()
    const filename = audioBlob.type.includes('wav') ? 'audio.wav' : 'audio.webm'
    uploadForm.append('file', audioBlob, filename)
    uploadForm.append('model', model)
    uploadForm.append('purpose', 'file-extract')

    let fileUrl: string
    try {
      const uploadRes = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: uploadForm,
      })
      if (!uploadRes.ok) {
        const errText = await uploadRes.text().catch(() => '')
        throw new Error(
          `阿里云文件上传失败（${uploadRes.status}）：${errText || '无错误详情'}\n` +
          `请检查 API Key 是否已开通百炼服务，以及 baseUrl 是否正确（应为 https://dashscope.aliyuncs.com）`,
        )
      }
      const uploadJson = await uploadRes.json()
      // 兼容多种返回结构
      fileUrl = uploadJson?.output?.uploaded_file?.url
        || uploadJson?.output?.url
        || uploadJson?.data?.url
        || ''
      if (!fileUrl) {
        throw new Error(
          `阿里云文件上传响应未包含文件 URL：${JSON.stringify(uploadJson).slice(0, 500)}`,
        )
      }
      console.info('[voiceApi] Aliyun STT file uploaded', fileUrl)
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('阿里云')) {
        throw err
      }
      throw new Error(
        `阿里云文件上传网络错误：${err instanceof Error ? err.message : String(err)}\n` +
        `请检查网络连接和 baseUrl（${baseUrl}）是否可访问`,
      )
    }

    // ===== 2. 提交异步识别任务 =====
    const taskUrl = `${baseUrl}/api/v1/services/audio/asr/transcription`
    const taskBody: Record<string, unknown> = {
      model,
      input: {
        file_urls: [fileUrl],
      },
      parameters: {
        disfluency_removal: true,
        output_sentence_with_timestamp: false,
      },
    }
    // 语言提示（paraformer-v2 支持 language_hints 数组）
    const language = options?.language && options.language !== 'auto'
      ? options.language
      : (config.sttLanguage !== 'auto' ? config.sttLanguage : '')
    if (language) {
      ;(taskBody.parameters as Record<string, unknown>).language_hints = [language]
    }

    let taskId: string
    try {
      const taskRes = await fetch(taskUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'X-DashScope-Async': 'enable',
        },
        body: JSON.stringify(taskBody),
      })
      if (!taskRes.ok) {
        const errText = await taskRes.text().catch(() => '')
        throw new Error(
          `阿里云 STT 任务提交失败（${taskRes.status}）：${errText || '无错误详情'}\n` +
          `请确认模型名（${model}）正确，且该 API Key 已开通 Paraformer 服务`,
        )
      }
      const taskJson = await taskRes.json()
      taskId = taskJson?.output?.task_id || ''
      if (!taskId) {
        throw new Error(
          `阿里云 STT 任务提交响应未包含 task_id：${JSON.stringify(taskJson).slice(0, 500)}`,
        )
      }
      console.info('[voiceApi] Aliyun STT task submitted', taskId)
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('阿里云')) {
        throw err
      }
      throw new Error(
        `阿里云 STT 任务提交网络错误：${err instanceof Error ? err.message : String(err)}`,
      )
    }

    // ===== 3. 轮询任务结果 =====
    const pollUrl = `${baseUrl}/api/v1/tasks/${taskId}`
    const maxAttempts = 60 // 最多 60 次
    const intervalMs = 1000 // 每秒一次
    let taskStatus = 'PENDING'
    let transcriptionUrl = ''

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise(resolve => setTimeout(resolve, intervalMs))
      let pollJson: any
      try {
        const pollRes = await fetch(pollUrl, {
          method: 'GET',
          headers: { Authorization: `Bearer ${apiKey}` },
        })
        if (!pollRes.ok) {
          const errText = await pollRes.text().catch(() => '')
          throw new Error(`轮询失败（${pollRes.status}）：${errText}`)
        }
        pollJson = await pollRes.json()
      } catch (err) {
        // 单次轮询失败不致命，继续重试
        console.warn(`[voiceApi] Aliyun STT poll attempt ${attempt + 1} failed:`, err)
        continue
      }

      taskStatus = pollJson?.output?.task_status || 'PENDING'
      console.info(`[voiceApi] Aliyun STT poll attempt ${attempt + 1}: ${taskStatus}`)

      if (taskStatus === 'SUCCEEDED') {
        const results = pollJson?.output?.results || []
        transcriptionUrl = results[0]?.transcription_url || ''
        break
      }
      if (taskStatus === 'FAILED') {
        const errMsg = pollJson?.output?.message || pollJson?.message || '无错误详情'
        throw new Error(
          `阿里云 STT 识别任务失败：${errMsg}\n` +
          `task_id: ${taskId}。请检查音频格式是否受支持（推荐 wav/mp3），以及模型权限`,
        )
      }
    }

    if (taskStatus !== 'SUCCEEDED' || !transcriptionUrl) {
      throw new Error(
        `阿里云 STT 识别任务超时（${maxAttempts * intervalMs / 1000}s），` +
        `当前状态：${taskStatus}。task_id: ${taskId}。请稍后重试或检查音频时长`,
      )
    }

    // ===== 4. 拉取识别结果 JSON =====
    let text = ''
    try {
      const resultRes = await fetch(transcriptionUrl)
      if (!resultRes.ok) {
        throw new Error(`HTTP ${resultRes.status}`)
      }
      const resultJson = await resultRes.json()
      const transcripts = resultJson?.transcripts || []
      if (transcripts.length > 0) {
        // 优先用顶层 text 字段，否则用 content 拼接
        text = transcripts
          .map((t: any) => {
            if (typeof t.text === 'string' && t.text) return t.text
            if (Array.isArray(t.content)) {
              return t.content.map((c: any) => c?.text || '').join('')
            }
            return ''
          })
          .join('\n')
      } else if (typeof resultJson?.text === 'string') {
        text = resultJson.text
      }
      console.info('[voiceApi] Aliyun STT succeeded, text length:', text.length)
    } catch (err) {
      throw new Error(
        `阿里云 STT 识别结果拉取失败：${err instanceof Error ? err.message : String(err)}\n` +
        `transcription_url: ${transcriptionUrl}`,
      )
    }

    return {
      text,
      language: language || 'auto',
      duration: 0,
      provider: 'aliyun',
    }
  },

  /**
   * 阿里云百炼 TTS 适配（CosyVoice）
   *
   * POST {baseUrl}/api/v1/services/audio/tts/SpeechSynthesizer
   * Body: { model, input: { text }, parameters: { voice, format, sample_rate } }
   * 返回：{ output: { audio: "base64编码的音频" } }
   *
   * 同步返回 base64 数据，解码为 Blob。
   */
  async _ttsViaAliyun(
    text: string,
    config: LocalVoiceModelConfig,
    options?: {
      voice?: string;
      speed?: number;
      format?: 'mp3' | 'wav' | 'opus' | 'aac' | 'flac';
    },
  ): Promise<Blob> {
    const baseUrl = normalizeBaseUrl(config.ttsBaseUrl, 'aliyun') || 'https://dashscope.aliyuncs.com'
    const apiKey = config.ttsApiKey
    const model = config.ttsModel || 'cosyvoice-v3.5-plus'
    const voice = options?.voice || config.ttsVoice || 'longxiaochun'
    // CosyVoice 仅支持 mp3/wav/pcm，其余格式降级到 mp3
    const requestedFormat = options?.format || 'mp3'
    const format: 'mp3' | 'wav' = (requestedFormat === 'wav') ? 'wav' : 'mp3'
    // 采样率（CosyVoice 默认 22050）
    const sampleRate = 22050

    console.info('[voiceApi] Aliyun TTS start', {
      baseUrl, model, voice, format, textLength: text.length,
    })

    const url = `${baseUrl}/api/v1/services/audio/tts/SpeechSynthesizer`
    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          input: { text },
          parameters: {
            voice,
            format,
            sample_rate: sampleRate,
          },
        }),
      })
    } catch (err) {
      throw new Error(
        `阿里云 TTS 网络请求失败：${err instanceof Error ? err.message : String(err)}\n` +
        `请检查网络连接和 baseUrl（${baseUrl}）是否可访问`,
      )
    }

    if (!res.ok) {
      const errorText = await res.text().catch(() => '')
      if (res.status === 404) {
        throw new Error(
          `阿里云 TTS 接口不存在（404）：请检查 baseUrl 是否正确（应为 https://dashscope.aliyuncs.com）\n` +
          `当前 Base URL: ${baseUrl}`,
        )
      }
      if (res.status === 401 || res.status === 403) {
        const keyHint = apiKey
          ? `（API Key: ${apiKey.slice(0, 4)}****${apiKey.slice(-4)}）`
          : '（未配置 API Key）'
        throw new Error(
          `阿里云 TTS 鉴权失败（${res.status}）：请检查 API Key 是否正确${keyHint}\n` +
          `并确认该 Key 已开通 CosyVoice 服务`,
        )
      }
      if (res.status === 400) {
        throw new Error(
          `阿里云 TTS 请求参数错误（400）：${errorText || '无错误详情'}\n` +
          `请检查模型名（${model}）、音色（${voice}）是否受支持`,
        )
      }
      throw new Error(
        `阿里云 TTS 请求失败（${res.status}）：${errorText || '无错误详情'}（URL: ${url}）`,
      )
    }

    // 解析返回的 base64 音频
    let audioBase64 = ''
    try {
      const json = await res.json()
      audioBase64 = json?.output?.audio || ''
      if (!audioBase64) {
        throw new Error(
          `阿里云 TTS 响应未包含音频数据：${JSON.stringify(json).slice(0, 500)}`,
        )
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('阿里云')) {
        throw err
      }
      throw new Error(
        `阿里云 TTS 响应解析失败：${err instanceof Error ? err.message : String(err)}`,
      )
    }

    // base64 → Blob
    try {
      const binaryStr = atob(audioBase64)
      const bytes = new Uint8Array(binaryStr.length)
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i)
      }
      const mimeType = format === 'wav' ? 'audio/wav' : 'audio/mpeg'
      console.info('[voiceApi] Aliyun TTS succeeded, bytes:', bytes.length)
      return new Blob([bytes], { type: mimeType })
    } catch (err) {
      throw new Error(
        `阿里云 TTS 音频解码失败：${err instanceof Error ? err.message : String(err)}`,
      )
    }
  },

  /** 获取已启用的语音 Provider 列表（仅云端模式有意义） */
  async getProviders(): Promise<VoiceProviders> {
    return backendApi.get<VoiceProviders>('/api/v1/voice/providers');
  },

  /** 获取可用音色列表（仅云端模式有意义） */
  async getVoices(language?: string): Promise<VoiceInfo[]> {
    const query = language ? `?language=${encodeURIComponent(language)}` : '';
    return backendApi.get<VoiceInfo[]>(`/api/v1/voice/voices${query}`);
  },

  /** 获取语音用量统计（云端模式：后端 voice_usages 表） */
  async getUsageStats(
    options?: { type?: 'STT' | 'TTS'; provider?: string; days?: number },
  ): Promise<VoiceUsageSummary> {
    const params = new URLSearchParams();
    if (options?.type) params.set('type', options.type);
    if (options?.provider) params.set('provider', options.provider);
    if (options?.days) params.set('days', String(options.days));
    const query = params.toString() ? `?${params.toString()}` : '';
    return backendApi.get<VoiceUsageSummary>(`/api/v1/voice/usage${query}`);
  },
};
