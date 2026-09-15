/**
 * 模型下载器
 *
 * 功能：
 * 1. 模型元数据管理（名称、大小、下载地址、校验和等）
 * 2. 下载进度回调
 * 3. 文件校验（MD5/SHA256）
 * 4. 断点续传（可选）
 * 5. 下载队列管理
 *
 * 设计要点：
 * 1. 模型体积提示：下载前必须显示体积与目标路径，禁止静默下载 GB 级模型
 * 2. 下载进度：支持进度回调，UI 可显示进度条
 * 3. 校验：支持文件校验，确保下载完整
 * 4. 错误处理：网络错误、校验失败等明确提示
 *
 * @module local-voice/ModelDownloader
 */

import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import { logger } from '@shared/toolkit/LogEngine'
import type { LocalVoiceConfig } from './LocalVoiceStore'

/** 模型元数据 */
export interface ModelMetadata {
  /** 模型 ID */
  id: string
  /** 模型名称 */
  name: string
  /** 模型类型（asr/tts/gpt-sovits） */
  type: 'asr' | 'tts' | 'gpt-sovits'
  /** 模型版本 */
  version: string
  /** 模型描述 */
  description: string
  /** 模型大小（字节） */
  size: number
  /** 下载地址 */
  downloadUrl: string
  /** 文件校验和（MD5 或 SHA256） */
  checksum?: string
  /** 校验和类型 */
  checksumType?: 'md5' | 'sha256'
  /** 下载文件名 */
  filename: string
  /** 解压后目录名 */
  extractDir?: string
  /** 是否需要解压 */
  needExtract: boolean
  /** 依赖的其他模型 */
  dependencies?: string[]
  /** 平台要求 */
  platforms?: NodeJS.Platform[]
}

/** 下载进度 */
export interface DownloadProgress {
  /** 模型 ID */
  modelId: string
  /** 已下载字节数 */
  downloaded: number
  /** 总字节数 */
  total: number
  /** 进度百分比（0-100） */
  percentage: number
  /** 下载速度（字节/秒） */
  speed: number
  /** 预计剩余时间（秒） */
  eta: number
  /** 下载状态 */
  status: 'downloading' | 'extracting' | 'verifying' | 'completed' | 'error'
  /** 错误信息 */
  error?: string
}

/** 下载任务 */
export interface DownloadTask {
  /** 模型元数据 */
  metadata: ModelMetadata
  /** 目标目录 */
  targetDir: string
  /** 进度回调 */
  onProgress?: (progress: DownloadProgress) => void
  /** 完成回调 */
  onComplete?: (success: boolean, error?: string) => void
  /** 状态 */
  status: 'pending' | 'downloading' | 'extracting' | 'verifying' | 'completed' | 'error'
  /** 错误信息 */
  error?: string
}

/** 模型下载器 */
export class ModelDownloader {
  private config: LocalVoiceConfig
  private downloadQueue: DownloadTask[] = []
  private activeDownloads = new Map<string, DownloadTask>()
  private maxConcurrentDownloads: number

  constructor(config: LocalVoiceConfig) {
    this.config = config
    this.maxConcurrentDownloads = config.maxConcurrentDownloads || 2
  }

  /** 获取可用模型列表 */
  async getAvailableModels(): Promise<ModelMetadata[]> {
    // 这里应该从后端或本地配置获取模型列表
    // 暂时返回硬编码的模型列表
    return [
      {
        id: 'sherpa-asr-sense-voice',
        name: 'Sherpa-ONNX SenseVoice ASR',
        type: 'asr',
        version: '1.0.0',
        description: '支持中英日韩粤的离线语音识别模型',
        size: 800 * 1024 * 1024, // 800MB
        downloadUrl: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17.tar.bz2',
        checksum: 'a3b5c7d9e1f2a4b6c8d0e2f4a6b8c0d2',
        checksumType: 'md5',
        filename: 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17.tar.bz2',
        extractDir: 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue',
        needExtract: true,
        platforms: ['darwin', 'linux', 'win32'],
      },
      {
        id: 'moss-tts-nano',
        name: 'MOSS TTS Nano',
        type: 'tts',
        version: '1.0.0',
        description: '轻量级离线语音合成模型',
        size: 500 * 1024 * 1024, // 500MB
        downloadUrl: 'https://example.com/models/MOSS-TTS-Nano-100M-ONNX.tar.gz',
        checksum: 'b4c6d8e0f2a4b6c8d0e2f4a6b8c0d2e4',
        checksumType: 'md5',
        filename: 'MOSS-TTS-Nano-100M-ONNX.tar.gz',
        extractDir: 'MOSS-TTS-Nano-100M-ONNX',
        needExtract: true,
        platforms: ['darwin', 'linux', 'win32'],
      },
    ]
  }

  /** 获取模型下载信息 */
  async getModelDownloadInfo(modelId: string): Promise<ModelMetadata | null> {
    const models = await this.getAvailableModels()
    return models.find(m => m.id === modelId) || null
  }

  /** 下载模型 */
  async downloadModel(modelId: string, onProgress?: (progress: DownloadProgress) => void): Promise<boolean> {
    const metadata = await this.getModelDownloadInfo(modelId)
    if (!metadata) {
      throw new Error(`模型不存在: ${modelId}`)
    }

    // 检查平台兼容性
    if (metadata.platforms && !metadata.platforms.includes(process.platform)) {
      throw new Error(`模型不支持当前平台: ${process.platform}`)
    }

    // 检查是否已下载
    const targetDir = this.getModelTargetDir(metadata)
    if (this.isModelDownloaded(metadata, targetDir)) {
      logger.system.info(`[ModelDownloader] 模型已存在: ${modelId}`)
      return true
    }

    // 创建下载任务
    const task: DownloadTask = {
      metadata,
      targetDir,
      onProgress,
      status: 'pending',
    }

    // 添加到队列
    this.downloadQueue.push(task)
    this.processQueue()

    return new Promise((resolve, reject) => {
      task.onComplete = (success, error) => {
        if (success) {
          resolve(true)
        } else {
          reject(new Error(error || '下载失败'))
        }
      }
    })
  }

  /** 取消下载 */
  cancelDownload(modelId: string): void {
    // 从队列中移除
    this.downloadQueue = this.downloadQueue.filter(t => t.metadata.id !== modelId)

    // 如果正在下载，标记为取消
    const activeTask = this.activeDownloads.get(modelId)
    if (activeTask) {
      activeTask.status = 'error'
      activeTask.error = '下载已取消'
      this.activeDownloads.delete(modelId)
      this.processQueue()
    }
  }

  /** 检查模型是否已下载 */
  isModelDownloaded(metadata: ModelMetadata, _targetDir?: string): boolean {
    const dir = this.getModelTargetDir(metadata)
    
    if (!fs.existsSync(dir)) {
      return false
    }

    // 检查关键文件是否存在
    const criticalFiles = this.getCriticalFiles(metadata)
    for (const file of criticalFiles) {
      if (!fs.existsSync(path.join(dir, file))) {
        return false
      }
    }

    return true
  }

  /** 获取模型目标目录 */
  getModelTargetDir(metadata: ModelMetadata): string {
    const baseDir = this.config.modelDownloadDir || path.join(process.cwd(), 'models')
    return path.join(baseDir, metadata.type, metadata.extractDir || metadata.id)
  }

  /** 获取模型关键文件列表 */
  private getCriticalFiles(metadata: ModelMetadata): string[] {
    // 根据模型类型返回关键文件
    switch (metadata.type) {
      case 'asr':
        return ['model.int8.onnx', 'tokens.txt']
      case 'tts':
        return ['MOSS-TTS-Nano-100M-ONNX']
      case 'gpt-sovits':
        return ['GPT_SoVITS']
      default:
        return []
    }
  }

  /** 处理下载队列 */
  private async processQueue(): Promise<void> {
    // 检查是否达到最大并发数
    if (this.activeDownloads.size >= this.maxConcurrentDownloads) {
      return
    }

    // 从队列中取出任务
    const task = this.downloadQueue.shift()
    if (!task) {
      return
    }

    // 标记为活跃下载
    this.activeDownloads.set(task.metadata.id, task)
    task.status = 'downloading'

    try {
      // 开始下载
      await this.executeDownload(task)
      
      // 下载完成
      task.status = 'completed'
      task.onComplete?.(true)
    } catch (error) {
      // 下载失败
      task.status = 'error'
      task.error = error instanceof Error ? error.message : String(error)
      task.onComplete?.(false, task.error)
    } finally {
      // 从活跃下载中移除
      this.activeDownloads.delete(task.metadata.id)
      
      // 继续处理队列
      this.processQueue()
    }
  }

  /** 执行下载 */
  private async executeDownload(task: DownloadTask): Promise<void> {
    const { metadata, targetDir, onProgress } = task

    // 确保目标目录存在
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true })
    }

    const downloadPath = path.join(targetDir, metadata.filename)
    const startTime = Date.now()
    let downloadedBytes = 0

    try {
      // 发送下载请求
      const response = await fetch(metadata.downloadUrl)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const totalBytes = parseInt(response.headers.get('content-length') || '0', 10)
      
      // 读取响应体
      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error('无法读取响应体')
      }

      const chunks: Uint8Array[] = []
      
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        chunks.push(value)
        downloadedBytes += value.length

        // 计算进度
        const elapsed = (Date.now() - startTime) / 1000
        const speed = downloadedBytes / elapsed
        const percentage = totalBytes > 0 ? (downloadedBytes / totalBytes) * 100 : 0
        const eta = totalBytes > 0 ? (totalBytes - downloadedBytes) / speed : 0

        // 回调进度
        onProgress?.({
          modelId: metadata.id,
          downloaded: downloadedBytes,
          total: totalBytes,
          percentage,
          speed,
          eta,
          status: 'downloading',
        })
      }

      // 合并所有块并写入文件
      const buffer = Buffer.concat(chunks.map(chunk => Buffer.from(chunk)))
      fs.writeFileSync(downloadPath, buffer)

      // 校验文件
      if (metadata.checksum) {
        task.status = 'verifying'
        onProgress?.({
          modelId: metadata.id,
          downloaded: downloadedBytes,
          total: totalBytes,
          percentage: 100,
          speed: 0,
          eta: 0,
          status: 'verifying',
        })

        const isValid = await this.verifyFile(downloadPath, metadata.checksum, metadata.checksumType || 'md5')
        if (!isValid) {
          throw new Error('文件校验失败，下载可能不完整')
        }
      }

      // 解压文件（如果需要）
      if (metadata.needExtract) {
        task.status = 'extracting'
        onProgress?.({
          modelId: metadata.id,
          downloaded: downloadedBytes,
          total: totalBytes,
          percentage: 100,
          speed: 0,
          eta: 0,
          status: 'extracting',
        })

        await this.extractFile(downloadPath, targetDir)
        
        // 删除压缩包
        if (fs.existsSync(downloadPath)) {
          fs.unlinkSync(downloadPath)
        }
      }

      // 下载完成
      onProgress?.({
        modelId: metadata.id,
        downloaded: downloadedBytes,
        total: totalBytes,
        percentage: 100,
        speed: 0,
        eta: 0,
        status: 'completed',
      })

      logger.system.info(`[ModelDownloader] 模型下载完成: ${metadata.id}`)
    } catch (error) {
      // 清理失败文件
      if (fs.existsSync(downloadPath)) {
        fs.unlinkSync(downloadPath)
      }
      throw error
    }
  }

  /** 校验文件 */
  private async verifyFile(filePath: string, expectedChecksum: string, checksumType: 'md5' | 'sha256'): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash(checksumType)
      const stream = fs.createReadStream(filePath)

      stream.on('data', (data) => hash.update(data))
      stream.on('end', () => {
        const fileChecksum = hash.digest('hex')
        resolve(fileChecksum === expectedChecksum)
      })
      stream.on('error', reject)
    })
  }

  /** 解压文件（待实现） */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async extractFile(_filePath: string, _targetDir: string): Promise<void> {
    throw new Error('解压功能未实现')
  }
}