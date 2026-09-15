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
 * 3. 异步执行：推理任务放到线程池，不阻塞主进程
 * 4. 错误处理：模型未就绪时返回明确错误，不崩溃
 *
 * @module local-voice/engines/SherpaAsrEngine
 */

import { spawn, ChildProcess } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import { logger } from '@shared/toolkit/LogEngine'
import type { AsrEngineConfig } from '../LocalVoiceStore'

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

/** Sherpa ASR 引擎 */
export class SherpaAsrEngine {
  private config: AsrEngineConfig
  private status: EngineStatus = 'uninitialized'
  private pythonProcess: ChildProcess | null = null
  private modelLoaded = false
  private pendingRequests = new Map<string, {
    resolve: (result: AsrResult) => void
    reject: (error: Error) => void
    timeout: NodeJS.Timeout
  }>()

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
      // 检查模型文件是否存在
      const modelDir = this.config.modelDir
      const modelPath = path.join(modelDir, 'model.int8.onnx')
      const tokensPath = path.join(modelDir, 'tokens.txt')

      if (!fs.existsSync(modelPath) || !fs.existsSync(tokensPath)) {
        throw new Error(`模型文件不存在，请先下载模型。路径: ${modelDir}`)
      }

      // 启动 Python sidecar 进程
      await this.startPythonProcess()

      // 发送初始化命令
      await this.sendCommand('initialize', {
        modelDir: this.config.modelDir,
        modelName: this.config.modelName,
        numThreads: this.config.numThreads,
        language: this.config.language,
        useItn: this.config.useItn,
      })

      this.modelLoaded = true
      this.status = 'ready'
      logger.system.info('[SherpaAsr] 引擎初始化完成')
    } catch (error) {
      this.status = 'error'
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

    const requestId = this.generateRequestId()

    return new Promise((resolve, reject) => {
      // 设置超时
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId)
        reject(new Error('识别请求超时'))
      }, 30000) // 30 秒超时

      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        timeout,
      })

      // 发送识别命令
      this.sendCommand('recognize', {
        requestId,
        audioData: audioBuffer.toString('base64'),
        sampleRate,
      }).catch(error => {
        clearTimeout(timeout)
        this.pendingRequests.delete(requestId)
        reject(error)
      })
    })
  }

  /** 停止引擎 */
  async dispose(): Promise<void> {
    if (this.pythonProcess) {
      // 发送停止命令
      try {
        await this.sendCommand('dispose', {})
      } catch {
        // 忽略错误，直接杀死进程
      }

      // 杀死进程
      this.pythonProcess.kill('SIGTERM')
      this.pythonProcess = null
    }

    this.modelLoaded = false
    this.status = 'uninitialized'
    logger.system.info('[SherpaAsr] 引擎已停止')
  }

  /** 启动 Python sidecar 进程 */
  private async startPythonProcess(): Promise<void> {
    return new Promise((resolve, reject) => {
      // 获取 Python 路径（优先使用 PythonRuntimeManager）
      const pythonPath = this.getPythonPath()
      const scriptPath = this.getScriptPath()

      this.pythonProcess = spawn(pythonPath, [scriptPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
        },
      })

      let stderrOutput = ''

      this.pythonProcess.stdout?.on('data', (data: Buffer) => {
        this.handleStdout(data.toString())
      })

      this.pythonProcess.stderr?.on('data', (data: Buffer) => {
        stderrOutput += data.toString()
        logger.system.debug('[SherpaAsr] stderr:', data.toString())
      })

      this.pythonProcess.on('error', (error) => {
        logger.system.error('[SherpaAsr] 进程启动失败:', error)
        reject(new Error(`Python 进程启动失败: ${error.message}`))
      })

      this.pythonProcess.on('exit', (code, signal) => {
        logger.system.info(`[SherpaAsr] 进程退出: code=${code}, signal=${signal}`)
        this.pythonProcess = null
        this.modelLoaded = false
        this.status = 'uninitialized'

        // 清理所有待处理请求
        for (const [requestId, request] of this.pendingRequests) {
          clearTimeout(request.timeout)
          request.reject(new Error('Python 进程意外退出'))
          this.pendingRequests.delete(requestId)
        }
      })

      // 等待进程就绪
      setTimeout(() => {
        if (this.pythonProcess && this.status !== 'error') {
          resolve()
        } else {
          reject(new Error('Python 进程启动超时'))
        }
      }, 1000)
    })
  }

  /** 处理 stdout 输出 */
  private handleStdout(output: string): void {
    try {
      const lines = output.split('\n').filter(line => line.trim())
      
      for (const line of lines) {
        if (line.startsWith('JSON:')) {
          const jsonStr = line.substring(5).trim()
          const response = JSON.parse(jsonStr)
          this.handleResponse(response)
        } else {
          logger.system.debug('[SherpaAsr] stdout:', line)
        }
      }
    } catch (error) {
      logger.system.error('[SherpaAsr] 解析 stdout 失败:', error)
    }
  }

  /** 处理 JSON 响应 */
  private handleResponse(response: any): void {
    if (response.type === 'initialized') {
      // 初始化完成
      logger.system.info('[SherpaAsr] Python 进程初始化完成')
    } else if (response.type === 'result') {
      // 识别结果
      const requestId = response.requestId
      const pending = this.pendingRequests.get(requestId)
      if (pending) {
        clearTimeout(pending.timeout)
        this.pendingRequests.delete(requestId)

        if (response.error) {
          pending.reject(new Error(response.error))
        } else {
          pending.resolve({
            text: response.text || '',
            language: response.language,
            confidence: response.confidence,
            durationMs: response.durationMs || 0,
            engine: 'sherpa-asr',
          })
        }
      }
    } else if (response.type === 'error') {
      logger.system.error('[SherpaAsr] Python 进程错误:', response.message)
    }
  }

  /** 发送命令到 Python 进程 */
  private async sendCommand(command: string, params: any): Promise<void> {
    if (!this.pythonProcess || !this.pythonProcess.stdin) {
      throw new Error('Python 进程未启动')
    }

    const message = JSON.stringify({
      command,
      params,
      timestamp: Date.now(),
    })

    return new Promise((resolve, reject) => {
      this.pythonProcess!.stdin!.write(message + '\n', (error) => {
        if (error) {
          reject(new Error(`发送命令失败: ${error.message}`))
        } else {
          resolve()
        }
      })
    })
  }

  /** 获取 Python 路径 */
  private getPythonPath(): string {
    // 这里应该从 PythonRuntimeManager 获取
    // 暂时返回默认值，实际实现需要集成 PythonRuntimeManager
    return 'python3'
  }

  /** 获取 Python 脚本路径 */
  private getScriptPath(): string {
    // 返回 sherpa_asr.py 脚本的路径
    // 实际实现需要将源项目的 py/sherpa_asr.py 复制到本地
    return path.join(__dirname, '..', '..', '..', '..', '..', 'py', 'sherpa_asr.py')
  }

  /** 生成请求 ID */
  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }
}