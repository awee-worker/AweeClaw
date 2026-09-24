/**
 * 语音识别桥（AsrBridge）
 *
 * 把客户端的本地离线语音识别收敛成一个受控出口，供插件把音频转成文本。
 * 识别本身仍是「设置 → 本地语音」里那套 sherpa-onnx / SenseVoice：
 * 跑在受管 Python sidecar 中，模型与依赖由客户端统一管理。
 *
 * 为什么不让插件自己去调 Python：
 * - 用户的开关、模型、优先级都在「设置 → 本地语音」里，插件各跑一套等于绕过开关
 * - 识别器（含模型）在 LocalVoiceManager 里是常驻单例，插件自行拉进程会重复
 *   加载数百 MB 的模型
 *
 * 边界：
 * - 只做识别（音频 → 文本），不做语音合成
 * - 输入是**音频文件字节**（wav 最稳，底层用 soundfile 解码），不是裸 PCM
 * - 输出不带时间轴：SenseVoice 只给整段文本，时间轴由调用方按文本与音频时长对齐
 *
 * @module plugin-sdk/AsrBridge
 */

import { logger } from '@shared/toolkit/LogEngine'
import { LocalVoiceManager } from '../local-voice/LocalVoiceManager'

// ─── 常量 ──────────────────────────────────────────────────

/** 单次识别的音频上限（64MB，约 33 分钟 16kHz 单声道 WAV） */
const MAX_AUDIO_BYTES = 64 * 1024 * 1024
/** 采样率范围：低于 8k 语音信息已损失，高于 48k 无意义且拖慢重采样 */
const MIN_SAMPLE_RATE = 8000
const MAX_SAMPLE_RATE = 48000
/** 默认采样率（SenseVoice 训练采样率） */
const DEFAULT_SAMPLE_RATE = 16000

// ─── 类型定义 ──────────────────────────────────────────────

/** 识别结果 */
export interface AsrRecognizeResult {
  /** 识别文本 */
  text: string
  /** 语言（引擎检测到时给出） */
  language: string | null
  /** 置信度（0~1），引擎不提供时为 null */
  confidence: number | null
  /** 识别耗时（毫秒） */
  elapsedMs: number
  /** 引擎自报的处理耗时（毫秒） */
  durationMs: number
  /** 使用的引擎标识 */
  engine: string
}

/** 引擎状态快照 */
export interface AsrStatus {
  /** 当前是否可用（用户已开启本地语音 + ASR，且优先级允许本地） */
  available: boolean
  /** 本地语音总开关 */
  voiceEnabled: boolean
  /** ASR 开关 */
  asrEnabled: boolean
  /** 引擎运行状态：uninitialized / loading / ready / error */
  status: string
  /** 引擎标识 */
  engine: string
  /** 不可用时的原因 */
  reason: string | null
}

/** recognize 选项 */
export interface AsrRecognizeOptions {
  /** 目标采样率，默认 16000 */
  sampleRate?: number
}

// ─── 桥实现 ────────────────────────────────────────────────

/**
 * 语音识别桥
 *
 * 单例导出给 globalThis.__AWEECLAW_HOST__.asr 使用。
 */
export class AsrBridgeService {
  /**
   * 识别一段音频
   *
   * @param audio 音频文件字节（wav / flac / ogg；mp3 取决于底层 libsndfile 版本，建议先转 wav）
   * @param options.sampleRate 目标采样率
   * @returns 识别结果
   */
  async recognize(
    audio: Buffer | Uint8Array,
    options: AsrRecognizeOptions = {},
  ): Promise<AsrRecognizeResult> {
    const buffer = Buffer.isBuffer(audio) ? audio : Buffer.from(audio)

    if (buffer.length === 0) {
      throw new Error('[AsrBridge] 音频数据为空')
    }
    if (buffer.length > MAX_AUDIO_BYTES) {
      throw new Error(
        `[AsrBridge] 音频过大（${Math.round(buffer.length / 1024 / 1024)}MB），` +
          `单次识别上限 ${MAX_AUDIO_BYTES / 1024 / 1024}MB`,
      )
    }

    const sampleRate = this.resolveSampleRate(options.sampleRate)

    const manager = LocalVoiceManager.getInstance()
    if (!manager.shouldUseLocalAsr()) {
      throw new Error(
        '本地语音识别未启用：请在「设置 → 本地语音」开启引擎总开关与「语音识别(ASR)」，' +
          '并确认优先级不是「仅云端」',
      )
    }

    const startedAt = Date.now()
    try {
      const result = await manager.recognize(buffer, sampleRate)
      const elapsedMs = Date.now() - startedAt
      logger.system?.info(
        `[AsrBridge] 识别完成 音频=${Math.round(buffer.length / 1024)}KB ` +
          `采样率=${sampleRate} 耗时=${elapsedMs}ms 文本长度=${result.text?.length ?? 0}`,
      )
      return {
        text: result.text ?? '',
        language: result.language ?? null,
        confidence: result.confidence ?? null,
        elapsedMs,
        durationMs: result.durationMs ?? elapsedMs,
        engine: result.engine ?? 'local',
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.system?.warn(`[AsrBridge] 识别失败：${msg}`)
      throw new Error(msg)
    }
  }

  /**
   * 引擎状态快照
   *
   * 只读，不触发引擎初始化（插件做前置检查时不该顺手把模型拉起来）。
   */
  getStatus(): AsrStatus {
    const manager = LocalVoiceManager.getInstance()
    const status = manager.getStatus()
    const available = manager.shouldUseLocalAsr()

    let reason: string | null = null
    if (!status.enabled) reason = '本地语音总开关未开启'
    else if (!status.asr.enabled) reason = '语音识别(ASR) 未开启'
    else if (!available) reason = '语音引擎优先级为「仅云端」'

    return {
      available,
      voiceEnabled: status.enabled,
      asrEnabled: status.asr.enabled,
      status: status.asr.status,
      engine: status.asr.engine,
      reason,
    }
  }

  /** 校验并归一采样率 */
  private resolveSampleRate(value: number | undefined): number {
    if (value === undefined) return DEFAULT_SAMPLE_RATE
    if (!Number.isFinite(value)) return DEFAULT_SAMPLE_RATE
    const rounded = Math.round(value)
    if (rounded < MIN_SAMPLE_RATE || rounded > MAX_SAMPLE_RATE) {
      throw new Error(
        `[AsrBridge] 采样率超出支持范围（${MIN_SAMPLE_RATE}~${MAX_SAMPLE_RATE}）：${value}`,
      )
    }
    return rounded
  }
}

/** 全局单例：供 globalThis.__AWEECLAW_HOST__.asr 使用 */
export const asrBridge = new AsrBridgeService()
