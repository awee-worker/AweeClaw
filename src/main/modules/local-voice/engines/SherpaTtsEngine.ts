/**
 * Sherpa-ONNX TTS 引擎（离线语音合成）
 *
 * 实现方案：
 * 1. 优先评估 sherpa-onnx 的 Node.js 绑定（如果可用）
 * 2. 不可用时通过 Python sidecar 调用 MOSS TTS Python 版本
 *
 * 设计要点：
 * 1. 懒加载：首次使用时才初始化引擎，避免启动时加载重型依赖
 * 2. 模型缓存：模型加载后缓存，避免重复加载
 * 3. 异步执行：推理任务放到 sidecar 进程，不阻塞主进程
 * 4. 错误处理：模型未就绪时返回明确错误，不崩溃
 * 5. 音频格式：输出 WAV 格式，24kHz 采样率
 * 6. 握手可靠：以 Python 侧 `initialized` 响应判定初始化成功
 *
 * @module local-voice/engines/SherpaTtsEngine
 */

import * as path from 'path'
import * as fs from 'fs'
import { logger } from '@shared/toolkit/LogEngine'
import type { TtsEngineConfig } from '../LocalVoiceStore'
import { PythonSidecar } from '../pythonSidecar'
import { ensureSidecarDependencies, TTS_DEPENDENCIES } from '../pythonDeps'
import { resolveBuiltinVoice } from '@shared/localVoiceVoices'

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
export type EngineStatus = 'uninitialized' | 'loading' | 'ready' | 'error'

/** 模型加载超时：含模型预热（warmup）与可能的依赖安装 */
const INITIALIZE_TIMEOUT_MS = 300_000

/** 单次合成超时：首次合成需要加载运行时 */
const SYNTHESIZE_TIMEOUT_MS = 180_000

/** MOSS TTS 模型子目录名 */
const MOSS_MODEL_DIR = 'MOSS-TTS-Nano-100M-ONNX'

/** Sherpa TTS 引擎 */
export class SherpaTtsEngine {
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
      // 1) 检查模型文件
      const modelDir = this.config.modelDir
      const modelPath = path.join(modelDir, MOSS_MODEL_DIR)

      if (!fs.existsSync(modelPath)) {
        throw new Error(`模型目录不存在，请先下载模型。路径: ${modelDir}`)
      }

      // 2) 准备 Python 环境与依赖（已就绪时零开销）
      await ensureSidecarDependencies(TTS_DEPENDENCIES, (message) =>
        logger.system.info(`[SherpaTts] ${message}`),
      )

      // 3) 启动 sidecar 并等待就绪握手
      const sidecar = this.ensureSidecar()
      await sidecar.start()

      // 4) 加载模型：必须等到 `initialized` 响应才算成功
      const response = await sidecar.request(
        'initialize',
        {
          modelDir: this.config.modelDir,
          threadCount: this.config.numThreads,
        },
        INITIALIZE_TIMEOUT_MS,
      )

      if (response.type !== 'initialized') {
        throw new Error(String(response.message || '模型加载失败'))
      }

      this.modelLoaded = true
      this.status = 'ready'
      logger.system.info('[SherpaTts] 引擎初始化完成')
    } catch (error) {
      this.status = 'error'
      this.modelLoaded = false
      // 丢弃可能处于坏状态的进程，确保下次重试是干净的
      this.sidecar?.dispose()
      this.sidecar = null

      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.system.error('[SherpaTts] 引擎初始化失败:', errorMessage)
      throw new Error(`Sherpa TTS 引擎初始化失败: ${errorMessage}`)
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

    // 音色白名单校验（重要）：
    // 调用方可能传入 Provider 语义的音色（如 alloy / Xiaoxiao），这类音色在 MOSS
    // 内置音色表中不存在。Python 侧遇到未知音色会直接报错，而「仅本地」优先级下
    // 不会回退云端，最终表现为「点击播报毫无反应」。此处静默回退到配置音色，
    // 保证只要能初始化引擎就一定能出声，同时把替换行为写进日志便于排查。
    const { voice: resolvedVoice, substituted, requested } = resolveBuiltinVoice(
      voice || this.config.defaultVoice,
      this.config.defaultVoice,
    )
    if (substituted) {
      logger.system.warn(
        `[SherpaTts] 音色「${requested || '(空)'}」不是内置音色，已回退为「${resolvedVoice}」`,
      )
    }

    const response = await sidecar.request(
      'synthesize',
      {
        text: text.trim(),
        voice: resolvedVoice,
        speed: speed || this.config.defaultSpeed,
        modelDir: this.config.modelDir,
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
      sampleRate: typeof response.sampleRate === 'number' ? response.sampleRate : 24000,
      format: 'wav',
      durationMs: typeof response.durationMs === 'number' ? response.durationMs : 0,
      engine: 'sherpa-tts',
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
    logger.system.info('[SherpaTts] 引擎已停止')
  }

  /** 获取（或创建）sidecar 客户端 */
  private ensureSidecar(): PythonSidecar {
    if (!this.sidecar) {
      this.sidecar = new PythonSidecar({
        scriptFile: 'moss_tts.py',
        label: 'SherpaTts',
      })
    }
    return this.sidecar
  }
}
