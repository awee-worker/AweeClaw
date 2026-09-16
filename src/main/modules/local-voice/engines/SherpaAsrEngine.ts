/**
 * Sherpa-ONNX ASR 引擎（离线语音识别）
 *
 * 实现方案：
 * 1. 优先评估 sherpa-onnx 的 Node.js 绑定（如果可用）
 * 2. 不可用时通过 Python sidecar 调用 sherpa-onnx Python 版本
 *
 * 设计要点：
 * 1. 懒加载：首次使用时才初始化引擎，避免启动时加载重型依赖
 * 2. 模型缓存：模型加载后缓存，避免重复加载
 * 3. 异步执行：推理任务放到 sidecar 进程，不阻塞主进程
 * 4. 错误处理：模型未就绪时返回明确错误，不崩溃
 * 5. 握手可靠：以 Python 侧 `initialized` 响应判定初始化成功，
 *    而不是「命令发出即成功」——模型加载失败必须如实上报
 *
 * @module local-voice/engines/SherpaAsrEngine
 */

import * as path from 'path'
import * as fs from 'fs'
import { logger } from '@shared/toolkit/LogEngine'
import type { AsrEngineConfig } from '../LocalVoiceStore'
import { PythonSidecar } from '../pythonSidecar'
import { ensureSidecarDependencies, ASR_DEPENDENCIES } from '../pythonDeps'

/** ASR 识别结果 */
export interface AsrResult {
  /** 识别文本 */
  text: string
  /** 语言（如果检测到） */
  language?: string
  /** 置信度（0-1） */
  confidence?: number
  /** 处理时长（毫秒） */
  durationMs: number
  /** 使用的引擎 */
  engine: string
}

/** 引擎状态 */
export type EngineStatus = 'uninitialized' | 'loading' | 'ready' | 'error'

/** 模型加载超时：228MB int8 模型首次加载 + 可能的依赖安装，给足余量 */
const INITIALIZE_TIMEOUT_MS = 180_000

/** 单次识别超时 */
const RECOGNIZE_TIMEOUT_MS = 60_000

/** Sherpa ASR 引擎 */
export class SherpaAsrEngine {
  private config: AsrEngineConfig
  private status: EngineStatus = 'uninitialized'
  private sidecar: PythonSidecar | null = null
  private modelLoaded = false

  constructor(config: AsrEngineConfig) {
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
      const modelPath = path.join(modelDir, 'model.int8.onnx')
      const tokensPath = path.join(modelDir, 'tokens.txt')

      if (!fs.existsSync(modelPath) || !fs.existsSync(tokensPath)) {
        throw new Error(`模型文件不存在，请先下载模型。路径: ${modelDir}`)
      }

      // 2) 准备 Python 环境与依赖（已就绪时零开销）
      await ensureSidecarDependencies(ASR_DEPENDENCIES, (message) =>
        logger.system.info(`[SherpaAsr] ${message}`),
      )

      // 3) 启动 sidecar 并等待就绪握手
      const sidecar = this.ensureSidecar()
      await sidecar.start()

      // 4) 加载模型：必须等到 `initialized` 响应才算成功
      const response = await sidecar.request(
        'initialize',
        {
          modelDir: this.config.modelDir,
          modelName: this.config.modelName,
          numThreads: this.config.numThreads,
          language: this.config.language,
          useItn: this.config.useItn,
        },
        INITIALIZE_TIMEOUT_MS,
      )

      if (response.type !== 'initialized') {
        throw new Error(String(response.message || '模型加载失败'))
      }

      this.modelLoaded = true
      this.status = 'ready'
      logger.system.info('[SherpaAsr] 引擎初始化完成')
    } catch (error) {
      this.status = 'error'
      this.modelLoaded = false
      // 丢弃可能处于坏状态的进程，确保下次重试是干净的
      this.sidecar?.dispose()
      this.sidecar = null

      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.system.error('[SherpaAsr] 引擎初始化失败:', errorMessage)
      throw new Error(`Sherpa ASR 引擎初始化失败: ${errorMessage}`)
    }
  }

  /** 识别音频 */
  async recognize(audioBuffer: Buffer, sampleRate: number = 16000): Promise<AsrResult> {
    if (!this.isReady()) {
      throw new Error('引擎未就绪，请先调用 initialize()')
    }

    const sidecar = this.sidecar
    if (!sidecar) {
      throw new Error('Python 进程未启动')
    }

    const response = await sidecar.request(
      'recognize',
      {
        audioData: audioBuffer.toString('base64'),
        sampleRate,
      },
      RECOGNIZE_TIMEOUT_MS,
    )

    return {
      text: typeof response.text === 'string' ? response.text : '',
      language: typeof response.language === 'string' ? response.language : undefined,
      confidence: typeof response.confidence === 'number' ? response.confidence : undefined,
      durationMs: typeof response.durationMs === 'number' ? response.durationMs : 0,
      engine: 'sherpa-asr',
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
    logger.system.info('[SherpaAsr] 引擎已停止')
  }

  /** 获取（或创建）sidecar 客户端 */
  private ensureSidecar(): PythonSidecar {
    if (!this.sidecar) {
      this.sidecar = new PythonSidecar({
        scriptFile: 'sherpa_asr.py',
        label: 'SherpaAsr',
      })
    }
    return this.sidecar
  }
}
