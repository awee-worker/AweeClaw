/**
 * 本地语音引擎（离线 ASR / TTS）路由与调用层
 *
 * 背景（为什么需要这一层）：
 * `voiceApi` 原有的「本地/云端」分流里的 local 指的是**用户自配置的云端 Provider 直连**
 * （配置在 `voice_model_config`），而不是「设置 → 本地语音」里的**离线引擎**
 * （sherpa-onnx ASR / MOSS TTS，配置在主进程 `local_voice_config.json`）。
 * 结果是：离线引擎即使已启用、优先级设为「本地优先」，运行时也从不经过它，
 * 语音输入与播报仍然打到云端（表现为 FREE_TRIAL_EXPIRED 之类的云端报错）。
 *
 * 本模块补齐这一环：把离线引擎接进 `voiceApi` 的分流链路。
 *
 * 优先级语义（与设置面板文案保持一致）：
 * - `local-first`：本地可用则用本地，失败回退云端
 * - `cloud-first`：默认走云端，失败回退本地
 * - `local-only` ：只用本地，不回退云端
 * - `cloud-only` ：只用云端，不回退本地
 *
 * 设计约束：
 * 1. 不依赖 `@store`：悬浮头像窗口 / 伴侣窗口作为轻量 renderer 需要复用本模块，
 *    只允许通过 `adapters/electronBridge` 的 `api` 访问主进程。
 * 2. 配置读取带短 TTL 缓存：STT 增量识别可能每 1~2 秒调用一次，
 *    但配置变更（设置面板保存）需要尽快生效，故 TTL 取 2s 并额外提供显式失效入口。
 *
 * @module services/localVoiceEngine
 */

import { api } from '../adapters/electronBridge';

/** 引擎优先级 */
export type LocalEnginePriority = 'local-first' | 'cloud-first' | 'local-only' | 'cloud-only';

/** 引擎种类 */
export type VoiceEngineKind = 'local' | 'cloud';

/** 离线引擎路由决策 */
export interface VoiceRoute {
  /** 首选引擎 */
  primary: VoiceEngineKind;
  /** 首选失败时是否允许回退到另一引擎 */
  fallback: boolean;
  /** 决策依据（日志用） */
  reason: string;
}

/** 离线引擎识别结果 */
export interface LocalSttResult {
  text: string;
  language: string;
  /** 秒 */
  duration: number;
  provider: string;
}

/** 主进程 local_voice_config.json 的形状（仅取本模块关心的字段） */
interface LocalVoiceConfigShape {
  enabled?: boolean;
  priority?: LocalEnginePriority;
  asr?: { enabled?: boolean; numThreads?: number };
  tts?: { enabled?: boolean; defaultVoice?: string; defaultSpeed?: number };
}

/** 主进程引擎运行状态 */
interface LocalVoiceStatusShape {
  asr?: { status?: string };
  tts?: { status?: string };
}

/** 配置缓存 TTL：兼顾「设置保存后尽快生效」与「增量识别高频调用」 */
const CONFIG_CACHE_TTL_MS = 2000;

let configCache: { at: number; value: LocalVoiceConfigShape | null } | null = null;

/** 显式失效缓存（设置面板保存 / 重置 / 初始化引擎后调用） */
export function invalidateLocalVoiceRuntime(): void {
  configCache = null;
}

/** 读取离线引擎配置（带 TTL 缓存；读取失败按「未启用」处理，不影响云端链路） */
export async function loadLocalEngineConfig(force = false): Promise<LocalVoiceConfigShape | null> {
  if (!force && configCache && Date.now() - configCache.at < CONFIG_CACHE_TTL_MS) {
    return configCache.value;
  }

  let value: LocalVoiceConfigShape | null = null;
  try {
    const res = await api.localVoice.getConfig();
    if (res?.success && res.data) {
      value = res.data as LocalVoiceConfigShape;
    }
  } catch (err) {
    console.warn('[localVoiceEngine] 读取本地语音配置失败，按未启用处理:', err);
  }

  configCache = { at: Date.now(), value };
  return value;
}

/**
 * 根据优先级推导路由。
 *
 * 注意 `local-only` 与「引擎未启用」的冲突：用户只想要本地但没打开子开关时，
 * 若严格执行会导致语音功能完全不可用，这里降级到云端并给出警告（不静默失败）。
 */
function decideRoute(
  priority: LocalEnginePriority,
  engineEnabled: boolean,
): { primary: VoiceEngineKind; fallback: boolean; reason: string } {
  if (!engineEnabled) {
    return {
      primary: 'cloud',
      fallback: false,
      reason: priority === 'local-only' || priority === 'local-first'
        ? '优先级偏向本地，但对应引擎未启用（子开关关闭），降级云端'
        : '本地引擎未启用',
    };
  }

  switch (priority) {
    case 'local-only':
      return { primary: 'local', fallback: false, reason: 'priority=local-only' };
    case 'cloud-only':
      return { primary: 'cloud', fallback: false, reason: 'priority=cloud-only' };
    case 'local-first':
      return { primary: 'local', fallback: true, reason: 'priority=local-first' };
    case 'cloud-first':
    default:
      return { primary: 'cloud', fallback: true, reason: 'priority=cloud-first' };
  }
}

/**
 * 解析某个能力（asr / tts）应优先使用哪个引擎。
 *
 * 判定条件：模块总开关开启 + 对应子开关开启 + 优先级允许；
 * 优先级为「云端优先」时依然把本地作为回退候选（与设置面板文案一致）。
 */
export async function resolveVoiceRoute(type: 'asr' | 'tts'): Promise<VoiceRoute> {
  const config = await loadLocalEngineConfig();

  if (!config || !config.enabled) {
    return { primary: 'cloud', fallback: false, reason: '本地语音引擎总开关未启用' };
  }

  const engineEnabled = Boolean(type === 'asr' ? config.asr?.enabled : config.tts?.enabled);
  const priority = (config.priority || 'cloud-first') as LocalEnginePriority;
  const decided = decideRoute(priority, engineEnabled);

  if (decided.reason.includes('降级云端')) {
    console.warn(
      `[localVoiceEngine] ${type}: 优先级=${priority} 但引擎未启用，已降级云端。` +
      `请在「设置 → 本地语音」中打开${type === 'asr' ? '语音识别(ASR)' : '语音合成(TTS)'}开关。`,
    );
  }

  return { primary: decided.primary, fallback: decided.fallback, reason: decided.reason };
}

/** 读取引擎运行状态（失败返回 null，仅用于日志与提示，不参与路由） */
export async function getLocalEngineStatus(): Promise<LocalVoiceStatusShape | null> {
  try {
    const res = await api.localVoice.getStatus();
    if (res?.success && res.data) return res.data as LocalVoiceStatusShape;
  } catch {
    // 状态仅用于诊断，忽略失败
  }
  return null;
}

// ============================================
// 音频辅助
// ============================================

/**
 * 从 WAV 头读取真实采样率。
 *
 * `convertBlobToWav` 会请求 16kHz，但浏览器可能按设备采样率重采样，
 * 因此不能假定一定是 16000——采样率传错会让离线识别结果变成乱码。
 */
function readWavSampleRate(buffer: ArrayBuffer): number | null {
  try {
    if (buffer.byteLength < 44) return null;
    const view = new DataView(buffer);
    const isRiff = view.getUint32(0, false) === 0x52494646; // 'RIFF'
    const isWave = view.getUint32(8, false) === 0x57415645; // 'WAVE'
    if (!isRiff || !isWave) return null;
    // fmt 块紧随 WAVE 之后（非 PCM 扩展块时位置固定）
    const sampleRate = view.getUint32(24, true);
    return sampleRate > 0 ? sampleRate : null;
  } catch {
    return null;
  }
}

/** ArrayBuffer → base64（分块避免超长参数导致栈溢出） */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** base64 → Blob */
function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

// ============================================
// 离线引擎调用
// ============================================

/** 离线 ASR：WAV Blob → 文本（主进程按需懒加载模型） */
export async function recognizeWithLocalEngine(
  audioBlob: Blob,
  options?: { language?: string },
): Promise<LocalSttResult> {
  const arrayBuffer = await audioBlob.arrayBuffer();
  const sampleRate = readWavSampleRate(arrayBuffer) ?? 16000;

  const res = await api.localVoice.recognize({
    audioData: arrayBufferToBase64(arrayBuffer),
    sampleRate,
  });

  if (!res?.success) {
    throw new Error(res?.error || '本地语音识别失败');
  }

  const data = (res.data || {}) as {
    text?: string;
    language?: string;
    durationMs?: number;
  };

  return {
    text: String(data.text || ''),
    language: String(data.language || options?.language || 'auto'),
    duration: typeof data.durationMs === 'number' ? data.durationMs / 1000 : 0,
    provider: 'local-sherpa',
  };
}

/** 离线 TTS：文本 → WAV Blob（主进程按需懒加载模型） */
export async function synthesizeWithLocalEngine(
  text: string,
  options?: { voice?: string; speed?: number },
): Promise<Blob> {
  const res = await api.localVoice.synthesize({
    text,
    voice: options?.voice,
    speed: options?.speed,
  });

  if (!res?.success) {
    throw new Error(res?.error || '本地语音合成失败');
  }

  const data = (res.data || {}) as { audioData?: string; format?: string };
  if (!data.audioData) {
    throw new Error('本地语音合成未返回音频数据');
  }

  return base64ToBlob(data.audioData, 'audio/wav');
}
