/**
 * 本地语音引擎配置存储（主进程）
 *
 * 存储布局：
 *   <userData>/local-voice/local_voice_config.json   配置
 *
 * 设计要点：
 * 1. 本地语音引擎默认关闭（遵循 P1 通用要求）
 * 2. 支持多种引擎：sherpa-asr（离线 ASR）、sherpa-tts（离线 TTS）、gpt-sovits（声音克隆）
 * 3. 引擎优先级配置：本地优先/云端优先/仅本地/仅云端
 * 4. 模型路径配置：支持自定义模型目录
 *
 * @module local-voice/LocalVoiceStore
 */

import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { logger } from '@shared/toolkit/LogEngine'

// ============================================
// 常量
// ============================================

const LOCAL_VOICE_DIR_NAME = 'local-voice'
const CONFIG_FILE_NAME = 'local_voice_config.json'

/** 默认模型目录 */
export const DEFAULT_MODEL_DIR = path.join(app.getPath('userData'), 'local-voice', 'models')

/** 支持的引擎类型 */
export type EngineType = 'sherpa-asr' | 'sherpa-tts' | 'gpt-sovits' | 'none'

/** 引擎优先级模式 */
export type EnginePriority = 'local-first' | 'cloud-first' | 'local-only' | 'cloud-only'

/** ASR 引擎配置 */
export interface AsrEngineConfig {
  /** 是否启用本地 ASR */
  enabled: boolean
  /** 引擎类型 */
  engine: EngineType
  /** 模型名称（如 sherpa-onnx-sense-voice-zh-en-ja-ko-yue） */
  modelName: string
  /** 模型目录（绝对路径） */
  modelDir: string
  /** 线程数 */
  numThreads: number
  /** 是否使用 GPU（暂不支持，默认 CPU） */
  useGpu: boolean
  /** 语言（auto/zh/en/ja/ko/yue） */
  language: string
  /** 是否使用逆文本归一化 */
  useItn: boolean
}

/** TTS 引擎配置 */
export interface TtsEngineConfig {
  /** 是否启用本地 TTS */
  enabled: boolean
  /** 引擎类型 */
  engine: EngineType
  /** 模型名称（如 MOSS-TTS-Nano-100M-ONNX） */
  modelName: string
  /** 模型目录（绝对路径） */
  modelDir: string
  /** 线程数 */
  numThreads: number
  /** 默认音色 */
  defaultVoice: string
  /** 默认语速 */
  defaultSpeed: number
}

/** GPT-SoVITS 引擎配置 */
export interface GptSovitsEngineConfig {
  /** 是否启用 GPT-SoVITS */
  enabled: boolean
  /** 服务地址（本地 HTTP 服务） */
  baseUrl: string
  /** 参考音频目录 */
  referenceAudioDir: string
  /** 默认参考音频文件名 */
  defaultReferenceAudio: string
  /** 默认语言 */
  defaultLanguage: string
}

/** 本地语音引擎配置 */
export interface LocalVoiceConfig {
  /** 模块总开关 */
  enabled: boolean
  /** 引擎优先级 */
  priority: EnginePriority
  /** ASR 配置 */
  asr: AsrEngineConfig
  /** TTS 配置 */
  tts: TtsEngineConfig
  /** GPT-SoVITS 配置 */
  gptSovits: GptSovitsEngineConfig
  /** 模型下载目录 */
  modelDownloadDir: string
  /** 是否自动下载模型 */
  autoDownloadModels: boolean
  /** 最大下载并发数 */
  maxConcurrentDownloads: number
}

// ============================================
// 默认配置
// ============================================

export const DEFAULT_LOCAL_VOICE_CONFIG: LocalVoiceConfig = {
  enabled: false, // P1 通用要求：默认关闭
  priority: 'cloud-first',
  asr: {
    enabled: false,
    engine: 'sherpa-asr',
    modelName: 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue',
    modelDir: path.join(DEFAULT_MODEL_DIR, 'sherpa-asr'),
    numThreads: 4,
    useGpu: false,
    language: 'auto',
    useItn: true,
  },
  tts: {
    enabled: false,
    engine: 'sherpa-tts',
    modelName: 'MOSS-TTS-Nano-100M-ONNX',
    modelDir: path.join(DEFAULT_MODEL_DIR, 'sherpa-tts'),
    numThreads: 4,
    defaultVoice: 'Junhao',
    defaultSpeed: 1.0,
  },
  gptSovits: {
    enabled: false,
    baseUrl: 'http://127.0.0.1:9880',
    referenceAudioDir: path.join(DEFAULT_MODEL_DIR, 'gpt-sovits', 'references'),
    defaultReferenceAudio: '',
    defaultLanguage: 'zh',
  },
  modelDownloadDir: DEFAULT_MODEL_DIR,
  autoDownloadModels: false,
  maxConcurrentDownloads: 2,
}

// ============================================
// 路径工具
// ============================================

/** 模块数据目录（<userData>/local-voice） */
export function getLocalVoiceDataDir(): string {
  return path.join(app.getPath('userData'), LOCAL_VOICE_DIR_NAME)
}

/** 配置文件绝对路径 */
export function getLocalVoiceConfigPath(): string {
  return path.join(getLocalVoiceDataDir(), CONFIG_FILE_NAME)
}

/** 确保目录存在 */
function ensureDir(dir: string): void {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  } catch (err) {
    logger.system.warn('[LocalVoice] ensureDir failed:', dir, err)
  }
}

// ============================================
// 深合并
// ============================================

/**
 * 深合并：只覆盖 fallback 中已声明的键，且类型必须一致。
 */
function mergeConfig<T>(fallback: T, patch: unknown): T {
  if (patch === null || patch === undefined || typeof patch !== 'object') return fallback
  if (Array.isArray(fallback)) return fallback

  const source = patch as Record<string, unknown>
  const base = fallback as unknown as Record<string, unknown>
  const out: Record<string, unknown> = { ...base }

  for (const key of Object.keys(base)) {
    if (!(key in source)) continue
    const srcVal = source[key]
    const baseVal = base[key]
    if (srcVal === null || srcVal === undefined) continue
    if (typeof baseVal !== typeof srcVal) {
      // 类型不匹配的字段必须记录，否则「设置保存成功但不生效」会静默发生
      logger.system.warn(
        `[LocalVoice] 配置字段类型不匹配，已忽略: key=${key} 期望=${typeof baseVal} 实际=${typeof srcVal}`,
      )
      continue
    }
    if (typeof baseVal === 'object' && !Array.isArray(baseVal)) {
      out[key] = mergeConfig(baseVal, srcVal)
    } else {
      out[key] = srcVal
    }
  }

  return out as T
}

// ============================================
// 读写
// ============================================

/** 读取配置（缺失字段用默认值补全） */
export function readLocalVoiceConfig(): LocalVoiceConfig {
  const configPath = getLocalVoiceConfigPath()
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf-8')
      const parsed = JSON.parse(raw) as unknown
      return mergeConfig(DEFAULT_LOCAL_VOICE_CONFIG, parsed)
    }
  } catch (err) {
    logger.system.warn('[LocalVoice] readConfig failed, using defaults:', err)
  }
  return { ...DEFAULT_LOCAL_VOICE_CONFIG }
}

/** 写入配置 */
export function writeLocalVoiceConfig(config: LocalVoiceConfig): void {
  const dir = getLocalVoiceDataDir()
  ensureDir(dir)
  const configPath = getLocalVoiceConfigPath()
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
  } catch (err) {
    logger.system.error('[LocalVoice] writeConfig failed:', err)
    throw err
  }
}

/** 更新配置（合并写入） */
export function updateLocalVoiceConfig(patch: Partial<LocalVoiceConfig>): LocalVoiceConfig {
  const current = readLocalVoiceConfig()
  const merged = mergeConfig(current, patch)
  writeLocalVoiceConfig(merged)
  return merged
}

/** 重置为默认配置 */
export function resetLocalVoiceConfig(): LocalVoiceConfig {
  writeLocalVoiceConfig(DEFAULT_LOCAL_VOICE_CONFIG)
  return { ...DEFAULT_LOCAL_VOICE_CONFIG }
}

/** 检查模块是否启用 */
export function isLocalVoiceEnabled(): boolean {
  const config = readLocalVoiceConfig()
  return config.enabled
}

/** 检查 ASR 是否启用 */
export function isAsrEnabled(): boolean {
  const config = readLocalVoiceConfig()
  return config.enabled && config.asr.enabled
}

/** 检查 TTS 是否启用 */
export function isTtsEnabled(): boolean {
  const config = readLocalVoiceConfig()
  return config.enabled && config.tts.enabled
}

/** 检查 GPT-SoVITS 是否启用 */
export function isGptSovitsEnabled(): boolean {
  const config = readLocalVoiceConfig()
  return config.enabled && config.gptSovits.enabled
}

/** 获取当前有效的引擎优先级 */
export function getEffectivePriority(): EnginePriority {
  const config = readLocalVoiceConfig()
  return config.priority
}

/**
 * 判断本地引擎是否可以参与本次调用（即「允许被使用」）。
 *
 * 语义边界（重要）：本函数只回答「能不能用本地引擎」，不回答「先用谁」。
 * 「先用谁 + 失败如何回退」由渲染层按 priority 决策
 * （见 `renderer/services/localVoiceEngine.ts` 的 resolveVoiceRoute）。
 *
 * 之所以不能在这里把 cloud-first 一刀切为 false：
 * 设置面板文案明确写的是「默认使用云端引擎，**不可用时回退到本地**」，
 * 若此处返回 false，云端不可用时的本地回退会被主进程直接拒绝（曾导致
 * 「Cloud First 选了本地回退也永远用不上本地引擎」）。
 */
export function shouldUseLocalEngine(type: 'asr' | 'tts'): boolean {
  const config = readLocalVoiceConfig()
  if (!config.enabled) return false

  // 仅云端：明确禁用本地引擎
  if (config.priority === 'cloud-only') return false

  // 其余优先级（local-first / local-only / cloud-first）都允许调用本地引擎
  const engineConfig = type === 'asr' ? config.asr : config.tts
  return engineConfig.enabled
}