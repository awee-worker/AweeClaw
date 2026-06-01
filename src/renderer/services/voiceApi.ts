import { backendApi, getServerUrl, getAccessToken, tryRefreshToken } from '../adapters/backendApi';

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

export const voiceApi = {
  async speechToText(
    audioBlob: Blob,
    options?: { language?: string; noAuthRetry?: boolean },
  ): Promise<SttResult> {
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

  async textToSpeech(
    text: string,
    options?: {
      voice?: string;
      speed?: number;
      format?: 'mp3' | 'wav' | 'opus' | 'aac' | 'flac';
      language?: string;
    },
  ): Promise<Blob> {
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

  async getProviders(): Promise<VoiceProviders> {
    return backendApi.get<VoiceProviders>('/api/v1/voice/providers');
  },

  async getVoices(language?: string): Promise<VoiceInfo[]> {
    const query = language ? `?language=${encodeURIComponent(language)}` : '';
    return backendApi.get<VoiceInfo[]>(`/api/v1/voice/voices${query}`);
  },

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
