/**
 * 本地语音引擎管理器（主进程）
 *
 * 职责：
 * 1. 引擎生命周期管理：初始化、启动、停止、销毁
 * 2. 引擎选择：根据配置选择 ASR/TTS 引擎
 * 3. 优先级管理：本地优先/云端优先/仅本地/仅云端
 * 4. 模型管理：下载、校验、缓存
 * 5. 错误处理：引擎不可用时的降级策略
 *
 * 设计要点：
 * 1. 懒加载：首次使用时才初始化引擎，避免启动时加载重型依赖
 * 2. 引擎缓存：已初始化的引擎缓存，避免重复初始化
 * 3. 错误恢复：引擎失败时自动重置，下次使用重新初始化
 * 4. 配置监听：配置变化时自动更新引擎状态
 *
 * @module local-voice/LocalVoiceManager
 */

import { logger } from '@shared/toolkit/LogEngine'
import {
  readLocalVoiceConfig,
  updateLocalVoiceConfig,
  isLocalVoiceEnabled,
  isAsrEnabled,
  isTtsEnabled,
  isGptSovitsEnabled,
  shouldUseLocalEngine,
  type LocalVoiceConfig,
  type EnginePriority,
} from './LocalVoiceStore'
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { ModelMetadata } from './ModelDownloader'
import { resolveBuiltinVoice } from '@shared/localVoiceVoices'
import { SherpaAsrEngine, type AsrResult } from './engines/SherpaAsrEngine'
import { SherpaTtsEngine, type TtsResult } from './engines/SherpaTtsEngine'
import { GptSovitsEngine } from './engines/GptSovitsEngine'
import { ModelDownloader, type DownloadProgress } from './ModelDownloader'

/** 引擎状态 */
export type EngineStatus = 'uninitialized' | 'loading' | 'ready' | 'error'

/** 本地语音引擎管理器 */
export class LocalVoiceManager {
  private static instance: LocalVoiceManager | null = null

  private config: LocalVoiceConfig
  private asrEngine: SherpaAsrEngine | null = null
  private ttsEngine: SherpaTtsEngine | null = null
  private gptSovitsEngine: GptSovitsEngine | null = null
  private modelDownloader: ModelDownloader

  private asrStatus: EngineStatus = 'uninitialized'
  private ttsStatus: EngineStatus = 'uninitialized'
  private gptSovitsStatus: EngineStatus = 'uninitialized'

  /** 引擎加载时使用的配置快照（序列化），用于判断配置变化是否真的需要重建引擎 */
  private asrConfigSnapshot: string | null = null
  private ttsConfigSnapshot: string | null = null
  private gptSovitsConfigSnapshot: string | null = null

  private constructor() {
    this.config = readLocalVoiceConfig()
    this.repairTtsVoice()
    this.modelDownloader = new ModelDownloader(this.config)
  }

  /**
   * 纠正历史遗留的非法 TTS 音色并写回磁盘。
   *
   * 背景：早期设置面板只提供 Junhao / Xiaoxiao 两个选项，而 Xiaoxiao 并不在
   * MOSS 内置音色表中。一旦被存进配置，离线合成会在 Python 侧直接报
   * 「Built-in voice not found: Xiaoxiao」，与「仅本地」优先级叠加后
   * 就表现为「播报没有任何反应」。
   */
  private repairTtsVoice(): void {
    const { voice, substituted, requested } = resolveBuiltinVoice(this.config.tts.defaultVoice)
    if (!substituted) return

    logger.system.warn(
      `[LocalVoice] 配置中的 TTS 音色「${requested || '(空)'}」不在内置音色表中，已纠正为「${voice}」`,
    )
    this.config = updateLocalVoiceConfig({ tts: { ...this.config.tts, defaultVoice: voice } })
  }

  /** 获取单例实例 */
  static getInstance(): LocalVoiceManager {
    if (!LocalVoiceManager.instance) {
      LocalVoiceManager.instance = new LocalVoiceManager()
    }
    return LocalVoiceManager.instance
  }

  /** 获取当前配置 */
  getConfig(): LocalVoiceConfig {
    return { ...this.config }
  }

  /** 更新配置 */
  updateConfig(patch: Partial<LocalVoiceConfig>): LocalVoiceConfig {
    // 保存前先纠正非法音色：否则设置面板一保存，离线播报就被打回「没反应」
    if (patch.tts && !resolveBuiltinVoice(patch.tts.defaultVoice).substituted) {
      this.config = updateLocalVoiceConfig(patch)
    } else if (patch.tts) {
      const { voice, requested } = resolveBuiltinVoice(patch.tts.defaultVoice)
      logger.system.warn(
        `[LocalVoice] 保存的 TTS 音色「${requested || '(空)'}」不在内置音色表中，已纠正为「${voice}」`,
      )
      this.config = updateLocalVoiceConfig({ ...patch, tts: { ...patch.tts, defaultVoice: voice } })
    } else {
      this.config = updateLocalVoiceConfig(patch)
    }

    this.modelDownloader = new ModelDownloader(this.config)
    
    // 重新初始化引擎（如果配置变化影响引擎）
    this.resetEnginesIfNeeded()
    
    return this.config
  }

  /** 获取模块状态 */
  getStatus(): {
    enabled: boolean
    priority: EnginePriority
    asr: { status: EngineStatus; enabled: boolean; engine: string }
    tts: { status: EngineStatus; enabled: boolean; engine: string }
    gptSovits: { status: EngineStatus; enabled: boolean }
  } {
    return {
      enabled: this.config.enabled,
      priority: this.config.priority,
      asr: {
        status: this.asrStatus,
        enabled: this.config.asr.enabled,
        engine: this.config.asr.engine,
      },
      tts: {
        status: this.ttsStatus,
        enabled: this.config.tts.enabled,
        engine: this.config.tts.engine,
      },
      gptSovits: {
        status: this.gptSovitsStatus,
        enabled: this.config.gptSovits.enabled,
      },
    }
  }

  /** 检查是否应该使用本地 ASR */
  shouldUseLocalAsr(): boolean {
    return isLocalVoiceEnabled() && isAsrEnabled() && shouldUseLocalEngine('asr')
  }

  /** 检查是否应该使用本地 TTS */
  shouldUseLocalTts(): boolean {
    return isLocalVoiceEnabled() && isTtsEnabled() && shouldUseLocalEngine('tts')
  }

  /** 检查是否应该使用 GPT-SoVITS */
  shouldUseGptSovits(): boolean {
    return isLocalVoiceEnabled() && isGptSovitsEnabled()
  }

  /** 初始化 ASR 引擎 */
  async initializeAsr(): Promise<void> {
    if (this.asrStatus === 'ready') {
      return
    }

    if (this.asrStatus === 'loading') {
      throw new Error('ASR 引擎正在加载中')
    }

    this.asrStatus = 'loading'

    try {
      if (!this.asrEngine) {
        this.asrEngine = new SherpaAsrEngine(this.config.asr)
      }

      await this.asrEngine.initialize()
      this.asrStatus = 'ready'
      this.asrConfigSnapshot = JSON.stringify(this.config.asr)
      logger.system.info('[LocalVoice] ASR 引擎初始化完成')
    } catch (error) {
      this.asrStatus = 'error'
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.system.error('[LocalVoice] ASR 引擎初始化失败:', errorMessage)
      throw error
    }
  }

  /** 初始化 TTS 引擎 */
  async initializeTts(): Promise<void> {
    if (this.ttsStatus === 'ready') {
      return
    }

    if (this.ttsStatus === 'loading') {
      throw new Error('TTS 引擎正在加载中')
    }

    this.ttsStatus = 'loading'

    try {
      if (!this.ttsEngine) {
        this.ttsEngine = new SherpaTtsEngine(this.config.tts)
      }

      await this.ttsEngine.initialize()
      this.ttsStatus = 'ready'
      this.ttsConfigSnapshot = JSON.stringify(this.config.tts)
      logger.system.info('[LocalVoice] TTS 引擎初始化完成')
    } catch (error) {
      this.ttsStatus = 'error'
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.system.error('[LocalVoice] TTS 引擎初始化失败:', errorMessage)
      throw error
    }
  }

  /** 初始化 GPT-SoVITS 引擎 */
  async initializeGptSovits(): Promise<void> {
    if (this.gptSovitsStatus === 'ready') {
      return
    }

    if (this.gptSovitsStatus === 'loading') {
      throw new Error('GPT-SoVITS 引擎正在加载中')
    }

    this.gptSovitsStatus = 'loading'

    try {
      if (!this.gptSovitsEngine) {
        this.gptSovitsEngine = new GptSovitsEngine(this.config.gptSovits)
      }

      await this.gptSovitsEngine.initialize()
      this.gptSovitsStatus = 'ready'
      this.gptSovitsConfigSnapshot = JSON.stringify(this.config.gptSovits)
      logger.system.info('[LocalVoice] GPT-SoVITS 引擎初始化完成')
    } catch (error) {
      this.gptSovitsStatus = 'error'
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.system.error('[LocalVoice] GPT-SoVITS 引擎初始化失败:', errorMessage)
      throw error
    }
  }

  /** 语音识别 */
  async recognize(audioBuffer: Buffer, sampleRate: number = 16000): Promise<AsrResult> {
    if (!this.shouldUseLocalAsr()) {
      throw new Error(
        '离线语音识别不可用：请在「设置 → 本地语音」中开启引擎总开关与「语音识别(ASR)」，并确认优先级不是「仅云端」',
      )
    }

    try {
      await this.initializeAsr()
      return await this.asrEngine!.recognize(audioBuffer, sampleRate)
    } catch (error) {
      // 标记引擎为错误状态，下次使用重新初始化
      this.asrStatus = 'error'
      throw error
    }
  }

  /** 语音合成 */
  async synthesize(text: string, voice?: string, speed?: number): Promise<TtsResult> {
    if (!this.shouldUseLocalTts()) {
      throw new Error(
        '离线语音合成不可用：请在「设置 → 本地语音」中开启引擎总开关与「语音合成(TTS)」，并确认优先级不是「仅云端」',
      )
    }

    try {
      await this.initializeTts()
      return await this.ttsEngine!.synthesize(text, voice, speed)
    } catch (error) {
      // 标记引擎为错误状态，下次使用重新初始化
      this.ttsStatus = 'error'
      throw error
    }
  }

  /** GPT-SoVITS 语音合成 */
  async synthesizeWithGptSovits(text: string, referenceAudio?: string, language?: string): Promise<TtsResult> {
    if (!this.shouldUseGptSovits()) {
      throw new Error('GPT-SoVITS 未启用')
    }

    try {
      await this.initializeGptSovits()
      return await this.gptSovitsEngine!.synthesize(text, referenceAudio, language)
    } catch (error) {
      // 标记引擎为错误状态，下次使用重新初始化
      this.gptSovitsStatus = 'error'
      throw error
    }
  }

  /** 获取可用模型列表 */
  async getAvailableModels(): Promise<ModelMetadata[]> {
    return this.modelDownloader.getAvailableModels()
  }

  /** 下载模型（可选来源：modelscope | huggingface） */
  async downloadModel(
    modelId: string,
    onProgress?: (progress: DownloadProgress) => void,
    source?: 'modelscope' | 'huggingface',
  ): Promise<boolean> {
    return this.modelDownloader.downloadModel(modelId, onProgress, source)
  }

  /** 取消下载 */
  cancelDownload(modelId: string): void {
    this.modelDownloader.cancelDownload(modelId)
  }

  /** 检查模型是否已下载 */
  async isModelDownloaded(modelId: string): Promise<boolean> {
    try {
      const metadata = await this.modelDownloader.getModelDownloadInfo(modelId)
      if (!metadata) return false
      return this.modelDownloader.isModelDownloaded(metadata)
    } catch {
      return false
    }
  }

  /** 获取模型目录（已下载时返回目录路径，否则返回 null） */
  async getModelDir(modelId: string): Promise<string | null> {
    return this.modelDownloader.getModelDir(modelId)
  }

  /** 删除已下载模型目录 */
  async deleteModel(modelId: string): Promise<boolean> {
    return this.modelDownloader.deleteModel(modelId)
  }


  /** 停止所有引擎 */
  async dispose(): Promise<void> {
    const promises: Promise<void>[] = []

    if (this.asrEngine) {
      promises.push(this.asrEngine.dispose())
    }

    if (this.ttsEngine) {
      promises.push(this.ttsEngine.dispose())
    }

    if (this.gptSovitsEngine) {
      promises.push(this.gptSovitsEngine.dispose())
    }

    await Promise.allSettled(promises)

    this.asrEngine = null
    this.ttsEngine = null
    this.gptSovitsEngine = null

    this.asrStatus = 'uninitialized'
    this.ttsStatus = 'uninitialized'
    this.gptSovitsStatus = 'uninitialized'

    this.asrConfigSnapshot = null
    this.ttsConfigSnapshot = null
    this.gptSovitsConfigSnapshot = null

    logger.system.info('[LocalVoice] 所有引擎已停止')
  }

  /** 重置引擎（仅当影响引擎加载的配置真正变化时） */
  private resetEnginesIfNeeded(): void {
    // 保存设置（哪怕是无关字段）不应卸载已就绪的引擎，
    // 否则用户会看到「测试成功 → 保存 → 状态回到未初始化」。
    if (this.asrEngine && this.asrStatus === 'ready') {
      if (this.asrConfigSnapshot !== JSON.stringify(this.config.asr)) {
        void this.asrEngine.dispose()
        this.asrEngine = null
        this.asrStatus = 'uninitialized'
        this.asrConfigSnapshot = null
      }
    }

    // 检查 TTS 配置是否变化
    if (this.ttsEngine && this.ttsStatus === 'ready') {
      if (this.ttsConfigSnapshot !== JSON.stringify(this.config.tts)) {
        void this.ttsEngine.dispose()
        this.ttsEngine = null
        this.ttsStatus = 'uninitialized'
        this.ttsConfigSnapshot = null
      }
    }

    // 检查 GPT-SoVITS 配置是否变化
    if (this.gptSovitsEngine && this.gptSovitsStatus === 'ready') {
      if (this.gptSovitsConfigSnapshot !== JSON.stringify(this.config.gptSovits)) {
        void this.gptSovitsEngine.dispose()
        this.gptSovitsEngine = null
        this.gptSovitsStatus = 'uninitialized'
        this.gptSovitsConfigSnapshot = null
      }
    }
  }
}