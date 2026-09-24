/**
 * 语音合成桥（TtsBridge）
 *
 * 把客户端的本地离线语音合成收敛成一个受控出口，供插件把文本转成音频。
 * 合成仍是「设置 → 本地语音」里那套 MOSS-TTS-Nano（ONNX）：
 * 跑在受管 Python sidecar 中，模型与依赖由客户端统一管理。
 *
 * 为什么不让插件各自去合成：
 * - 开关、优先级、音色、语速都在「设置 → 本地语音」里，插件各跑一套等于绕过用户设置
 * - 合成引擎（含数百 MB 模型）在 LocalVoiceManager 里是常驻单例，插件自行拉进程
 *   会重复加载模型，几个插件同时合成还会互相抢 CPU
 *
 * 与 AsrBridge 对称：识别走 host.asr，合成走 host.tts。
 *
 * 边界：
 * - 只做合成（文本 → 音频），不做识别
 * - 输出是 WAV 字节（16-bit PCM），不落盘——写哪个文件由调用方按自己的工作区规则决定
 * - Python 侧会按 token 预算切分长文本再拼接，但单次调用仍设长度上限，
 *   避免一个请求把 sidecar 占住几分钟
 *
 * @module plugin-sdk/TtsBridge
 */

import { logger } from '@shared/toolkit/LogEngine'
import { MOSS_BUILTIN_VOICES, resolveBuiltinVoice } from '@shared/localVoiceVoices'
import { LocalVoiceManager } from '../local-voice/LocalVoiceManager'

// ─── 常量 ──────────────────────────────────────────────────

/**
 * 单次合成的文本上限（字符）。
 *
 * MOSS-TTS-Nano 是 100M 量级的小模型，生成速度按字符数线性增长。
 * 5000 字已经接近一分钟的成片时长，再长就该由调用方自行切段，
 * 否则一个工具调用会长时间占住合成引擎。
 */
const MAX_TEXT_LENGTH = 5000

/** 语速范围：低于 0.5 明显拖沓，高于 2.0 已听不清 */
const MIN_SPEED = 0.5
const MAX_SPEED = 2.0
/** 默认语速 */
const DEFAULT_SPEED = 1.0

// ─── 类型定义 ──────────────────────────────────────────────

/** 合成结果 */
export interface TtsSynthesizeResult {
  /** 音频数据（WAV，16-bit PCM） */
  audio: Buffer
  /** 采样率 */
  sampleRate: number
  /** 音频格式，固定为 wav */
  format: 'wav'
  /** 引擎自报的音频时长（毫秒） */
  durationMs: number
  /** 端到端耗时（毫秒），含引擎初始化 */
  elapsedMs: number
  /** 使用的引擎标识 */
  engine: string
  /** 实际生效的音色 */
  voice: string
  /** 请求的音色不是内置音色、已被回退替换 */
  voiceSubstituted: boolean
  /** 调用方请求的音色（用于排查回退原因） */
  requestedVoice: string
}

/** 引擎状态快照 */
export interface TtsStatus {
  /** 当前是否可用（用户已开启本地语音 + TTS，且优先级允许本地） */
  available: boolean
  /** 本地语音总开关 */
  voiceEnabled: boolean
  /** TTS 开关 */
  ttsEnabled: boolean
  /** 引擎运行状态：uninitialized / loading / ready / error */
  status: string
  /** 引擎标识 */
  engine: string
  /** 不可用时的原因 */
  reason: string | null
  /** 配置里的默认音色 */
  defaultVoice: string
  /** 配置里的默认语速 */
  defaultSpeed: number
  /** 是否已下载可用模型（未下载时首次合成会直接失败） */
  modelReady: boolean
}

/** 内置音色信息 */
export interface TtsVoiceInfo {
  /** 传给合成引擎的音色 ID */
  voice: string
  /** 展示名 */
  displayName: string
  /** 分组（中文 · 男声 / 英文 · 女声 ……） */
  group: string
}

/** synthesize 选项 */
export interface TtsSynthesizeOptions {
  /** 音色；不是内置音色时回退到配置音色 */
  voice?: string
  /** 语速，默认取配置值 */
  speed?: number
}

// ─── 桥实现 ────────────────────────────────────────────────

/**
 * 语音合成桥
 *
 * 单例导出给 globalThis.__AWEECLAW_HOST__.tts 使用。
 */
export class TtsBridgeService {
  /**
   * 合成一段语音
   *
   * @param text 待合成文本（纯文本，markdown 标记会被引擎侧归一化掉）
   * @param options.voice 音色，缺省用「设置 → 本地语音」里的默认音色
   * @param options.speed 语速，缺省用配置值
   * @returns WAV 音频字节与元信息
   */
  async synthesize(text: string, options: TtsSynthesizeOptions = {}): Promise<TtsSynthesizeResult> {
    const plain = typeof text === 'string' ? text.trim() : ''
    if (plain.length === 0) {
      throw new Error('[TtsBridge] 文本内容为空')
    }
    if (plain.length > MAX_TEXT_LENGTH) {
      throw new Error(
        `[TtsBridge] 文本过长（${plain.length} 字），单次合成上限 ${MAX_TEXT_LENGTH} 字，` +
          '请先按句子切分后分批调用',
      )
    }

    const manager = LocalVoiceManager.getInstance()
    if (!manager.shouldUseLocalTts()) {
      throw new Error(
        '本地语音合成未启用：请在「设置 → 本地语音」开启引擎总开关与「语音合成(TTS)」，' +
          '并确认优先级不是「仅云端」',
      )
    }

    const config = manager.getConfig()
    const speed = this.resolveSpeed(options.speed ?? config.tts.defaultSpeed)
    const { voice, substituted, requested } = resolveBuiltinVoice(
      options.voice,
      config.tts.defaultVoice,
    )

    const startedAt = Date.now()
    try {
      const result = await manager.synthesize(plain, voice, speed)
      const elapsedMs = Date.now() - startedAt
      logger.system?.info(
        `[TtsBridge] 合成完成 文本=${plain.length}字 音色=${voice}` +
          `${substituted ? `（由「${requested || '(空)'}」回退）` : ''} 语速=${speed} ` +
          `音频=${Math.round(result.audioBuffer.length / 1024)}KB 耗时=${elapsedMs}ms`,
      )
      return {
        audio: result.audioBuffer,
        sampleRate: result.sampleRate,
        format: 'wav',
        durationMs: result.durationMs,
        elapsedMs,
        engine: result.engine,
        voice,
        voiceSubstituted: substituted,
        requestedVoice: requested,
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.system?.warn(`[TtsBridge] 合成失败：${msg}`)
      throw new Error(msg)
    }
  }

  /**
   * 引擎状态快照
   *
   * 只读，不触发引擎初始化（插件做前置检查时不该顺手把数百 MB 模型拉起来）。
   */
  getStatus(): TtsStatus {
    const manager = LocalVoiceManager.getInstance()
    const status = manager.getStatus()
    const config = manager.getConfig()
    const available = manager.shouldUseLocalTts()
    const modelReady = status.tts.status === 'ready'

    let reason: string | null = null
    if (!status.enabled) reason = '本地语音总开关未开启'
    else if (!status.tts.enabled) reason = '语音合成(TTS) 未开启'
    else if (!available) reason = '语音引擎优先级为「仅云端」'
    else if (!modelReady) reason = 'TTS 模型尚未加载（首次合成时才会载入）'

    return {
      available,
      voiceEnabled: status.enabled,
      ttsEnabled: status.tts.enabled,
      status: status.tts.status,
      engine: status.tts.engine,
      reason,
      defaultVoice: config.tts.defaultVoice,
      defaultSpeed: config.tts.defaultSpeed,
      modelReady,
    }
  }

  /**
   * 可用音色列表
   *
   * 与「设置 → 本地语音」的音色下拉同源，避免插件自己写死一份会漂移的清单。
   */
  listVoices(): TtsVoiceInfo[] {
    return MOSS_BUILTIN_VOICES.map((item) => ({
      voice: item.voice,
      displayName: item.displayName,
      group: item.group,
    }))
  }

  /** 校验并归一语速 */
  private resolveSpeed(value: number | undefined): number {
    if (value === undefined) return DEFAULT_SPEED
    if (!Number.isFinite(value)) return DEFAULT_SPEED
    if (value < MIN_SPEED) return MIN_SPEED
    if (value > MAX_SPEED) return MAX_SPEED
    return Math.round(value * 100) / 100
  }
}

/** 全局单例：供 globalThis.__AWEECLAW_HOST__.tts 使用 */
export const ttsBridge = new TtsBridgeService()
