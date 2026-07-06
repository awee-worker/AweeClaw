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
import { useStore } from '@store';

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

/** 读取云端模式状态（避免循环依赖，每次调用时实时读取） */
function isCloudMode(): boolean {
  return useStore.getState().cloudMode === 'cloud'
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
    options?: { language?: string; noAuthRetry?: boolean },
  ): Promise<SttResult> {
    // 自定义模式：本地直连
    if (!isCloudMode()) {
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
   * 仅支持 OpenAI Whisper 兼容协议：POST {baseUrl}/audio/transcriptions
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
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.sttApiKey}`,
      },
      body: formData,
    })

    if (!res.ok) {
      const errorText = await res.text().catch(() => '')
      throw new Error(`STT request failed: ${res.status} ${errorText}`)
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
    },
  ): Promise<Blob> {
    // 自定义模式：本地直连
    if (!isCloudMode()) {
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
   * 仅支持 OpenAI TTS 兼容协议：POST {baseUrl}/audio/speech
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

    const baseUrl = normalizeBaseUrl(config.ttsBaseUrl, config.ttsProvider)
    if (!baseUrl) {
      throw new Error('TTS 配置不完整：请填写 Base URL')
    }

    // 优先使用调用参数，否则用本地配置
    const voice = options?.voice || config.ttsVoice || 'alloy'
    const speed = options?.speed ?? config.ttsSpeed ?? 1.0
    // OpenAI TTS 仅支持 mp3/opus/aac/flac，本地默认 mp3
    const format = options?.format || 'mp3'

    const url = `${baseUrl}/audio/speech`
    const res = await fetch(url, {
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

    if (!res.ok) {
      const errorText = await res.text().catch(() => '')
      throw new Error(`TTS request failed: ${res.status} ${errorText}`)
    }

    return res.blob()
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
