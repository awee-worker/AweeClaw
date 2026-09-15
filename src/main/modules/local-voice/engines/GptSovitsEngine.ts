/**
 * GPT-SoVITS 引擎（声音克隆）
 *
 * 实现方案：
 * 1. 通过 HTTP API 调用本地 GPT-SoVITS 服务
 * 2. 支持参考音频上传和声音克隆
 * 3. 支持多语言合成
 *
 * 设计要点：
 * 1. 本地服务：需要用户自行启动 GPT-SoVITS 服务
 * 2. 参考音频：支持上传参考音频进行声音克隆
 * 3. 多语言：支持中文、英文、日文等
 * 4. 错误处理：服务不可用时返回明确错误
 *
 * @module local-voice/engines/GptSovitsEngine
 */

import * as fs from 'fs'
import * as path from 'path'
import { logger } from '@shared/toolkit/LogEngine'
import type { GptSovitsEngineConfig } from '../LocalVoiceStore'

/** TTS 合成结果 */
export interface TtsResult {
  /** 音频数据（WAV 格式） */
  audioBuffer: Buffer
  /** 采样率 */
  sampleRate: number
  /** 音频格式 */
  format: 'wav'
  /** 处理时长（毫秒） */
  durationMs: number
  /** 使用的引擎 */
  engine: string
}

/** 引擎状态 */
export type EngineStatus = 'uninitialized' | 'ready' | 'error'

/** GPT-SoVITS 引擎 */
export class GptSovitsEngine {
  private config: GptSovitsEngineConfig
  private status: EngineStatus = 'uninitialized'
  private serviceAvailable = false

  constructor(config: GptSovitsEngineConfig) {
    this.config = config
  }

  /** 获取引擎状态 */
  getStatus(): EngineStatus {
    return this.status
  }

  /** 检查引擎是否就绪 */
  isReady(): boolean {
    return this.status === 'ready' && this.serviceAvailable
  }

  /** 初始化引擎（检查服务可用性） */
  async initialize(): Promise<void> {
    try {
      // 检查 GPT-SoVITS 服务是否可用
      const isAvailable = await this.checkServiceAvailability()
      
      if (!isAvailable) {
        throw new Error(`GPT-SoVITS 服务不可用，请确保服务已启动。地址: ${this.config.baseUrl}`)
      }

      this.serviceAvailable = true
      this.status = 'ready'
      logger.system.info('[GptSovits] 引擎初始化完成')
    } catch (error) {
      this.status = 'error'
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.system.error('[GptSovits] 引擎初始化失败:', errorMessage)
      throw new Error(`GPT-SoVITS 引擎初始化失败: ${errorMessage}`)
    }
  }

  /** 合成语音 */
  async synthesize(text: string, referenceAudio?: string, language?: string): Promise<TtsResult> {
    if (!this.isReady()) {
      throw new Error('引擎未就绪，请先调用 initialize()')
    }

    if (!text || !text.trim()) {
      throw new Error('文本内容不能为空')
    }

    const startTime = Date.now()

    try {
      // 构建请求参数
      const params: any = {
        text: text.trim(),
        text_language: language || this.config.defaultLanguage,
      }

      // 处理参考音频
      if (referenceAudio) {
        // 如果是文件路径，读取文件
        if (fs.existsSync(referenceAudio)) {
          const audioBuffer = fs.readFileSync(referenceAudio)
          params.reference_audio = audioBuffer.toString('base64')
          params.reference_audio_name = path.basename(referenceAudio)
        } else {
          // 假设是 base64 编码的音频数据
          params.reference_audio = referenceAudio
        }
      } else if (this.config.defaultReferenceAudio) {
        // 使用默认参考音频
        const defaultAudioPath = path.join(this.config.referenceAudioDir, this.config.defaultReferenceAudio)
        if (fs.existsSync(defaultAudioPath)) {
          const audioBuffer = fs.readFileSync(defaultAudioPath)
          params.reference_audio = audioBuffer.toString('base64')
          params.reference_audio_name = this.config.defaultReferenceAudio
        }
      }

      // 发送请求到 GPT-SoVITS 服务
      const response = await this.sendRequest('/tts', params)

      if (!response || !response.audio) {
        throw new Error('服务返回的音频数据为空')
      }

      // 解码音频数据
      const audioBuffer = Buffer.from(response.audio, 'base64')
      const durationMs = Date.now() - startTime

      return {
        audioBuffer,
        sampleRate: response.sample_rate || 24000,
        format: 'wav',
        durationMs,
        engine: 'gpt-sovits',
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.system.error('[GptSovits] 合成失败:', errorMessage)
      throw new Error(`语音合成失败: ${errorMessage}`)
    }
  }

  /** 上传参考音频 */
  async uploadReferenceAudio(audioPath: string, name?: string): Promise<string> {
    if (!this.isReady()) {
      throw new Error('引擎未就绪，请先调用 initialize()')
    }

    if (!fs.existsSync(audioPath)) {
      throw new Error(`音频文件不存在: ${audioPath}`)
    }

    try {
      const audioBuffer = fs.readFileSync(audioPath)
      const audioBase64 = audioBuffer.toString('base64')
      const fileName = name || path.basename(audioPath)

      const response = await this.sendRequest('/upload_reference', {
        audio: audioBase64,
        name: fileName,
      })

      if (!response || !response.path) {
        throw new Error('上传失败，服务未返回文件路径')
      }

      return response.path
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.system.error('[GptSovits] 上传参考音频失败:', errorMessage)
      throw new Error(`上传参考音频失败: ${errorMessage}`)
    }
  }

  /** 获取可用的参考音频列表 */
  async getReferenceAudioList(): Promise<string[]> {
    if (!this.isReady()) {
      throw new Error('引擎未就绪，请先调用 initialize()')
    }

    try {
      const response = await this.sendRequest('/list_references', {})
      return response.references || []
    } catch (error) {
      logger.system.error('[GptSovits] 获取参考音频列表失败:', error)
      return []
    }
  }

  /** 停止引擎 */
  async dispose(): Promise<void> {
    this.serviceAvailable = false
    this.status = 'uninitialized'
    logger.system.info('[GptSovits] 引擎已停止')
  }

  /** 检查服务可用性 */
  private async checkServiceAvailability(): Promise<boolean> {
    try {
      const response = await this.sendRequest('/health', {})
      return response && response.status === 'ok'
    } catch {
      return false
    }
  }

  /** 发送 HTTP 请求 */
  private async sendRequest(endpoint: string, params: any): Promise<any> {
    const url = `${this.config.baseUrl}${endpoint}`
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(30000), // 30 秒超时
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`HTTP ${response.status}: ${errorText}`)
      }

      const data = await response.json()
      return data
    } catch (error) {
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new Error(`无法连接到 GPT-SoVITS 服务，请确保服务已启动。地址: ${this.config.baseUrl}`)
      }
      throw error
    }
  }
}