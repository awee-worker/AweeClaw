/**
 * VITS TTS 引擎（离线语音合成）
 *
 * 通过 Python sidecar 调用 sherpa-onnx 的 `OfflineTts` 完成推理。
 * 与 SherpaTtsEngine（MOSS）的差异：
 * 1. 音色是整数 speaker id，不是音色名；
 * 2. 权重、词表与分词词典由模型仓库整体提供，按目录加载；
 * 3. 依赖 sherpa-onnx，与 MOSS 所需的 onnxruntime 互不重叠。
 *
 * 设计要点：
 * 1. 懒加载：首次使用时才初始化引擎，避免启动时加载重型依赖
 * 2. 异步执行：推理任务放到 sidecar 进程，不阻塞主进程
 * 3. 音频格式：输出 WAV，采样率由模型决定（16k / 22.05k / 44.1k）
 * 4. 握手可靠：以 Python 侧 `initialized` 响应判定初始化成功
 *
 * @module local-voice/engines/VitsTtsEngine
 */

import * as path from 'path'
import * as fs from 'fs'
import { logger } from '@shared/toolkit/LogEngine'
import type { TtsEngineConfig } from '../LocalVoiceStore'
import { PythonSidecar } from '../pythonSidecar'
import { ensureSidecarDependencies, VITS_TTS_DEPENDENCIES } from '../pythonDeps'
import { normalizeTtsModelId, resolveVoiceForModel } from '@shared/localVoiceVoices'
import type { TtsResult } from './SherpaTtsEngine'

/** 引擎状态 */
export type EngineStatus = 'uninitialized' | 'loading' | 'ready' | 'error'

/** 模型加载超时：含依赖安装与模型预热 */
const INITIALIZE_TIMEOUT_MS = 300_000

/** 单次合成超时：首次合成需要加载运行时 */
const SYNTHESIZE_TIMEOUT_MS = 180_000

/** VITS TTS 引擎 */
export class VitsTtsEngine {
  private config: TtsEngineConfig
  private status: EngineStatus = 'uninitialized'
  private sidecar: PythonSidecar | null = null
  private modelLoaded = false

  constructor(config: TtsEngineConfig) {
    this.config = config
  }

  /** 获取引擎状态 */
  getStatus(): EngineStatus {
    return this.status
  }

  /** 检查引擎是否就绪 */
  isReady(): boolean {
    return this.status === 'ready' && this.modelLoaded
  }

  /**
   * 模型子目录名
   *
   * 所有 TTS 模型共用 `tts.modelDir` 作为根目录，各自占一个子目录，
   * 因此换模型不会互相覆盖权重。
   */
  getModelSubDir(): string {
    return normalizeTtsModelId(this.config.modelName)
  }

  /** 模型完整目录 */
  getModelPath(): string {
    return path.join(this.config.modelDir, this.getModelSubDir())
  }

  /** 初始化引擎（加载模型） */
  async initialize(): Promise<void> {
    if (this.status === 'ready' && this.modelLoaded) {
      return
    }

    if (this.status === 'loading') {
      throw new Error('引擎正在加载中，请稍后重试')
    }

    this.status = 'loading'

    try {
      // 1) 检查模型目录
      const modelPath = this.getModelPath()
      if (!fs.existsSync(modelPath)) {
        throw new Error(`模型目录不存在，请先下载模型。路径: ${modelPath}`)
      }

      // 2) 准备 Python 环境与依赖（已就绪时零开销）
      await ensureSidecarDependencies(VITS_TTS_DEPENDENCIES, (message) =>
        logger.system.info(`[VitsTts] ${message}`),
      )

      // 3) 启动 sidecar 并等待就绪握手
      const sidecar = this.ensureSidecar()
      await sidecar.start()

      // 4) 加载模型：必须等到 `initialized` 响应才算成功
      const response = await sidecar.request(
        'initialize',
        {
          modelDir: modelPath,
          threadCount: this.config.numThreads,
        },
        INITIALIZE_TIMEOUT_MS,
      )

      if (response.type !== 'initialized') {
        throw new Error(String(response.message || '模型加载失败'))
      }

      this.modelLoaded = true
      this.status = 'ready'
      logger.system.info(
        `[VitsTts] 引擎初始化完成（采样率 ${response.sampleRate}，音色数 ${response.numSpeakers}）`,
      )
    } catch (error) {
      this.status = 'error'
      this.modelLoaded = false
      // 丢弃可能处于坏状态的进程，确保下次重试是干净的
      this.sidecar?.dispose()
      this.sidecar = null

      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.system.error('[VitsTts] 引擎初始化失败:', errorMessage)
      throw new Error(`VITS TTS 引擎初始化失败: ${errorMessage}`)
    }
  }

  /** 合成语音 */
  async synthesize(text: string, voice?: string, speed?: number): Promise<TtsResult> {
    if (!this.isReady()) {
      throw new Error('引擎未就绪，请先调用 initialize()')
    }

    if (!text || !text.trim()) {
      throw new Error('文本内容不能为空')
    }

    const sidecar = this.sidecar
    if (!sidecar) {
      throw new Error('Python 进程未启动')
    }

    // 音色校验（重要）：
    // 调用方可能传入属于其他模型的音色（如切到 VITS 后仍带 MOSS 的 `Junhao`）
    // 或 Provider 音色（如 `alloy`）。这类值在 Python 侧会被回退成默认音色，
    // 而「仅本地」优先级下不会回退云端，若静默替换，用户会以为播报用的是自己选的音色。
    // 因此调用前显式校验，并把替换行为写进日志。
    const { voice: resolvedVoice, substituted, requested } = resolveVoiceForModel(
      this.config.modelName,
      voice || this.config.defaultVoice,
      this.config.defaultVoice,
    )
    if (substituted) {
      logger.system.warn(
        `[VitsTts] 音色「${requested || '(空)'}」不属于模型「${this.getModelSubDir()}」，已回退为「${resolvedVoice}」`,
      )
    }

    const response = await sidecar.request(
      'synthesize',
      {
        text: text.trim(),
        voice: resolvedVoice,
        speed: speed || this.config.defaultSpeed,
        modelDir: this.getModelPath(),
        threadCount: this.config.numThreads,
      },
      SYNTHESIZE_TIMEOUT_MS,
    )

    const audioData = typeof response.audioData === 'string' ? response.audioData : ''
    if (!audioData) {
      throw new Error('合成结果缺少音频数据')
    }

    return {
      audioBuffer: Buffer.from(audioData, 'base64'),
      sampleRate: typeof response.sampleRate === 'number' ? response.sampleRate : 22050,
      format: 'wav',
      durationMs: typeof response.durationMs === 'number' ? response.durationMs : 0,
      engine: 'vits-tts',
    }
  }

  /** 停止引擎 */
  async dispose(): Promise<void> {
    const sidecar = this.sidecar
    if (sidecar) {
      try {
        await sidecar.request('dispose', {}, 5_000)
      } catch {
        // 进程可能已退出，忽略即可
      }
      sidecar.dispose()
      this.sidecar = null
    }

    this.modelLoaded = false
    this.status = 'uninitialized'
    logger.system.info('[VitsTts] 引擎已停止')
  }

  /** 获取（或创建）sidecar 客户端 */
  private ensureSidecar(): PythonSidecar {
    if (!this.sidecar) {
      this.sidecar = new PythonSidecar({
        scriptFile: 'sherpa_vits_tts.py',
        label: 'VitsTts',
      })
    }
    return this.sidecar
  }
}
