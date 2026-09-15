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

  private constructor() {
    this.config = readLocalVoiceConfig()
    this.modelDownloader = new ModelDownloader(this.config)
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
    this.config = updateLocalVoiceConfig(patch)
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
      throw new Error('本地 ASR 未启用')
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
      throw new Error('本地 TTS 未启用')
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

  /** 下载模型 */
  async downloadModel(modelId: string, onProgress?: (progress: DownloadProgress) => void): Promise<boolean> {
    return this.modelDownloader.downloadModel(modelId, onProgress)
  }

  /** 取消下载 */
  cancelDownload(modelId: string): void {
    this.modelDownloader.cancelDownload(modelId)
  }

  /** 检查模型是否已下载 */
  isModelDownloaded(_modelId: string): boolean {
    // 注意：异步检查，为简化返回 false，实际实现应 await
    return false
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

    logger.system.info('[LocalVoice] 所有引擎已停止')
  }

  /** 重置引擎（如果配置变化影响引擎） */
  private resetEnginesIfNeeded(): void {
    // 检查 ASR 配置是否变化
    if (this.asrEngine && this.asrStatus === 'ready') {
      // 这里可以添加更详细的配置比较逻辑
      // 暂时简单重置
      this.asrEngine = null
      this.asrStatus = 'uninitialized'
    }

    // 检查 TTS 配置是否变化
    if (this.ttsEngine && this.ttsStatus === 'ready') {
      this.ttsEngine = null
      this.ttsStatus = 'uninitialized'
    }

    // 检查 GPT-SoVITS 配置是否变化
    if (this.gptSovitsEngine && this.gptSovitsStatus === 'ready') {
      this.gptSovitsEngine = null
      this.gptSovitsStatus = 'uninitialized'
    }
  }
}