/**
 * VLM（视觉语言模型）模型管理器 — 阶段8 s8-06
 *
 * 职责：
 * - 管理 VLM 模型的下载、缓存、加载生命周期
 * - 支持按需下载（首次 load 时自动下载）
 * - 提供下载进度回调（用于 UI 显示进度条）
 * - 缓存管理（查询缓存状态、清理缓存）
 * - 单例模式，全局唯一实例
 *
 * 设计原则：
 * - 懒加载：模型在首次 load() 时才下载（约 500MB），避免影响启动速度
 * - 容错：下载/加载失败时标记失败状态，避免反复尝试
 * - 可观测：所有操作有日志，支持进度回调
 * - 隐私：所有推理在本地完成，不上传任何图像
 *
 * 默认模型：Xenova/vit-gpt2-image-captioning
 * - 基于 ViT + GPT2 的图像描述生成模型
 * - 量化后约 500MB
 * - 支持 image-to-text 任务（图像 → 文本描述）
 *
 * @module perception/VlmModelManager
 */

import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import { logger } from '@shared/toolkit/LogEngine'

// ============================================================
// 类型定义（避免直接 import transformers 的类型，保持轻量）
// ============================================================

interface PipelineSingleton {
  pipeline: (
    task: string,
    model: string,
    options?: {
      quantized?: boolean
      progress_callback?: (info: unknown) => void
      cache_dir?: string
    },
  ) => Promise<unknown>
}

/** VLM 推理 pipeline（image-to-text） */
export interface VlmPipeline {
  (
    imageInputs: Array<string | Uint8Array | Buffer>,
    options?: { max_new_tokens?: number },
  ): Promise<{ generated_text: Array<{ generated_text: string }> }>
}

/** 下载进度信息 */
export interface DownloadProgress {
  /** 当前下载的文件名 */
  file: string
  /** 已下载字节数 */
  loaded: number
  /** 总字节数（未知时为 0） */
  total: number
  /** 进度百分比（0-1，未知时为 0） */
  progress: number
}

/** 缓存信息 */
export interface VlmCacheInfo {
  /** 模型名称 */
  modelName: string
  /** 缓存目录绝对路径 */
  cacheDir: string
  /** 是否已下载 */
  downloaded: boolean
  /** 缓存占用字节数（未下载时为 0） */
  sizeBytes: number
  /** 缓存大小（人类可读） */
  sizeReadable: string
}

// ============================================================
// 常量
// ============================================================

/** 默认 VLM 模型（ViT + GPT2 图像描述生成） */
const DEFAULT_VLM_MODEL = 'Xenova/vit-gpt2-image-captioning'

/** 支持的 VLM 模型列表 */
export const SUPPORTED_VLM_MODELS = [
  {
    id: 'Xenova/vit-gpt2-image-captioning',
    name: 'ViT-GPT2 Image Captioning',
    description: '基于 ViT + GPT2 的图像描述生成（约 500MB，推荐）',
    sizeMb: 500,
  },
  {
    id: 'Xenova/blip-image-captioning-base',
    name: 'BLIP Image Captioning Base',
    description: 'Salesforce BLIP 图像描述模型（约 500MB）',
    sizeMb: 500,
  },
] as const

// ============================================================
// VlmModelManager 单例
// ============================================================

/**
 * VLM 模型管理器单例
 *
 * 使用方式：
 * ```ts
 * const manager = VlmModelManager.getInstance()
 *
 * // 检查是否已下载
 * const info = manager.getCacheInfo()
 * if (!info.downloaded) {
 *   // 主动下载（带进度回调）
 *   await manager.downloadModel((progress) => {
 *     console.log(`下载进度: ${(progress.progress * 100).toFixed(1)}%`)
 *   })
 * }
 *
 * // 加载模型进行推理
 * const pipeline = await manager.load()
 * const result = await pipeline([imageBuffer], { max_new_tokens: 50 })
 * ```
 */
export class VlmModelManager {
  private static instance: VlmModelManager | null = null

  /** 已加载的 pipeline */
  private pipeline: VlmPipeline | null = null

  /** 加载中 Promise（防止并发加载） */
  private loadingPromise: Promise<VlmPipeline> | null = null

  /** 下载中 Promise（防止并发下载） */
  private downloadingPromise: Promise<void> | null = null

  /** 是否加载失败（避免反复尝试） */
  private loadFailed = false

  /** 当前下载进度 */
  private currentProgress: DownloadProgress | null = null

  /** 下载进度回调列表（支持多个订阅者） */
  private readonly progressCallbacks = new Set<(progress: DownloadProgress) => void>()

  /** 模型名称 */
  private readonly modelName: string

  private constructor(modelName: string = DEFAULT_VLM_MODEL) {
    this.modelName = modelName
  }

  /** 获取单例 */
  static getInstance(modelName?: string): VlmModelManager {
    if (!VlmModelManager.instance) {
      VlmModelManager.instance = new VlmModelManager(modelName)
    }
    return VlmModelManager.instance
  }

  /** 是否已加载 */
  isLoaded(): boolean {
    return this.pipeline !== null
  }

  /** 获取模型名称 */
  getModelName(): string {
    return this.modelName
  }

  /** 获取当前下载进度（无下载时为 null） */
  getCurrentProgress(): DownloadProgress | null {
    return this.currentProgress
  }

  // ============================================================
  // 缓存管理
  // ============================================================

  /**
   * 获取缓存目录路径
   *
   * 优先使用 app.getPath('userData')/models/vlm，
   * 在 app 未就绪时降级到系统默认缓存目录。
   */
  getCacheDir(): string {
    try {
      const userData = app.getPath('userData')
      return path.join(userData, 'models', 'vlm')
    } catch {
      // app 未就绪时降级（仅用于查询，不用于实际下载）
      return path.join(process.env.HOME || process.env.USERPROFILE || '/tmp', '.aweeclaw', 'models', 'vlm')
    }
  }

  /**
   * 获取缓存信息
   *
   * 扫描缓存目录，统计模型文件总大小。
   */
  getCacheInfo(): VlmCacheInfo {
    const cacheDir = this.getCacheDir()
    const modelDir = path.join(cacheDir, ...this.modelName.split('/'))

    let downloaded = false
    let sizeBytes = 0

    try {
      if (fs.existsSync(modelDir)) {
        const stat = fs.statSync(modelDir)
        if (stat.isDirectory()) {
          sizeBytes = this.calculateDirSize(modelDir)
          // 模型目录存在且有文件 → 视为已下载
          downloaded = sizeBytes > 0
        }
      }
    } catch (e) {
      logger.perception?.warn('[VlmModelManager] 缓存信息查询失败:', e)
    }

    return {
      modelName: this.modelName,
      cacheDir,
      downloaded,
      sizeBytes,
      sizeReadable: formatBytes(sizeBytes),
    }
  }

  /**
   * 清理缓存
   *
   * 删除模型缓存目录。如果模型已加载，先重置内存中的 pipeline。
   */
  async clearCache(): Promise<void> {
    // 重置内存状态
    this.pipeline = null
    this.loadFailed = false

    const cacheDir = this.getCacheDir()
    const modelDir = path.join(cacheDir, ...this.modelName.split('/'))

    try {
      if (fs.existsSync(modelDir)) {
        fs.rmSync(modelDir, { recursive: true, force: true })
        logger.perception?.info(`[VlmModelManager] 已清理缓存: ${modelDir}`)
      }
    } catch (e) {
      logger.perception?.error('[VlmModelManager] 清理缓存失败:', e)
      throw e
    }
  }

  /** 递归计算目录大小 */
  private calculateDirSize(dirPath: string): number {
    let totalSize = 0
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name)
        if (entry.isDirectory()) {
          totalSize += this.calculateDirSize(fullPath)
        } else if (entry.isFile()) {
          try {
            const stat = fs.statSync(fullPath)
            totalSize += stat.size
          } catch {
            // 文件可能被并发删除，忽略
          }
        }
      }
    } catch {
      // 目录可能被并发删除，忽略
    }
    return totalSize
  }

  // ============================================================
  // 下载进度订阅
  // ============================================================

  /**
   * 订阅下载进度
   *
   * @returns 取消订阅函数
   */
  onProgress(callback: (progress: DownloadProgress) => void): () => void {
    this.progressCallbacks.add(callback)
    return () => {
      this.progressCallbacks.delete(callback)
    }
  }

  /** 通知所有订阅者 */
  private notifyProgress(progress: DownloadProgress): void {
    for (const cb of this.progressCallbacks) {
      try {
        cb(progress)
      } catch (e) {
        logger.perception?.warn('[VlmModelManager] 进度回调异常:', e)
      }
    }
  }

  // ============================================================
  // 模型下载
  // ============================================================

  /**
   * 主动下载模型
   *
   * 如果模型已下载，直接返回。
   * 如果正在下载，返回进行中的 Promise（合并并发请求）。
   *
   * @param progressCallback 可选的进度回调（与 onProgress 订阅等效，但一次性）
   */
  async downloadModel(
    progressCallback?: (progress: DownloadProgress) => void,
  ): Promise<void> {
    // 已下载
    const info = this.getCacheInfo()
    if (info.downloaded) {
      logger.perception?.info('[VlmModelManager] 模型已下载，跳过')
      return
    }

    // 并发请求合并
    if (this.downloadingPromise) {
      if (progressCallback) {
        const unsub = this.onProgress(progressCallback)
        this.downloadingPromise.finally(unsub)
      }
      return this.downloadingPromise
    }

    // 注册一次性回调
    let unsub: (() => void) | null = null
    if (progressCallback) {
      unsub = this.onProgress(progressCallback)
    }

    this.downloadingPromise = this.performDownload()

    try {
      await this.downloadingPromise
    } finally {
      this.downloadingPromise = null
      this.currentProgress = null
      if (unsub) unsub()
    }
  }

  /** 执行实际下载（通过 transformers.js pipeline 触发下载） */
  private async performDownload(): Promise<void> {
    try {
      logger.perception?.info(`[VlmModelManager] 开始下载模型: ${this.modelName}`)

      const transformers = (await import('@xenova/transformers')) as unknown as PipelineSingleton

      // 通过 pipeline 调用触发下载（不会执行推理，仅下载权重）
      // 使用 progress_callback 接收下载进度
      await transformers.pipeline('image-to-text', this.modelName, {
        quantized: true,
        cache_dir: this.getCacheDir(),
        progress_callback: (info: unknown) => {
          this.handleDownloadCallback(info)
        },
      })

      logger.perception?.info(`[VlmModelManager] 模型下载完成: ${this.modelName}`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.perception?.error(`[VlmModelManager] 模型下载失败: ${msg}`, e)
      throw e
    }
  }

  /** 处理 transformers.js 下载进度回调 */
  private handleDownloadCallback(info: unknown): void {
    try {
      const data = info as Record<string, unknown>
      const status = data.status as string | undefined
      if (!status) return

      // transformers.js 下载回调格式：
      // { status: 'progress', file, loaded, total, progress } — 下载进度
      // { status: 'done', file } — 单个文件完成
      // { status: 'ready', file } — 模型就绪
      if (status === 'progress') {
        const file = (data.file as string) ?? 'unknown'
        const loaded = (data.loaded as number) ?? 0
        const total = (data.total as number) ?? 0
        const progress = total > 0 ? loaded / total : 0

        this.currentProgress = { file, loaded, total, progress }
        this.notifyProgress(this.currentProgress)
      } else if (status === 'done') {
        const file = (data.file as string) ?? 'unknown'
        this.currentProgress = {
          file,
          loaded: 0,
          total: 0,
          progress: 1,
        }
        this.notifyProgress(this.currentProgress)
      }
    } catch (e) {
      logger.perception?.warn('[VlmModelManager] 进度回调处理异常:', e)
    }
  }

  // ============================================================
  // 模型加载与推理
  // ============================================================

  /**
   * 加载模型（懒加载，首次调用时下载）
   *
   * - 已加载：直接返回 pipeline
   * - 加载中：返回进行中的 Promise（合并并发请求）
   * - 未加载：触发下载 → 创建 pipeline
   * - 已失败：抛错（需调用 reset() 后重试）
   */
  async load(): Promise<VlmPipeline> {
    // 已加载
    if (this.pipeline) return this.pipeline

    // 加载中（并发请求合并）
    if (this.loadingPromise) return this.loadingPromise

    // 已失败（避免反复尝试，需手动 reset）
    if (this.loadFailed) {
      throw new Error('VLM 模型加载失败。请调用 reset() 后重试。')
    }

    this.loadingPromise = this.doLoad()
    try {
      this.pipeline = await this.loadingPromise
      return this.pipeline
    } finally {
      this.loadingPromise = null
    }
  }

  /** 实际加载逻辑 */
  private async doLoad(): Promise<VlmPipeline> {
    try {
      logger.perception?.info(`[VlmModelManager] 加载模型: ${this.modelName}`)

      const transformers = (await import('@xenova/transformers')) as unknown as PipelineSingleton

      // 创建 image-to-text pipeline（首次会触发下载）
      const pipeline = (await transformers.pipeline(
        'image-to-text',
        this.modelName,
        {
          quantized: true,
          cache_dir: this.getCacheDir(),
          progress_callback: (info: unknown) => {
            this.handleDownloadCallback(info)
          },
        },
      )) as unknown as VlmPipeline

      logger.perception?.info(`[VlmModelManager] 模型加载成功: ${this.modelName}`)
      this.loadFailed = false
      return pipeline
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.perception?.error(`[VlmModelManager] 模型加载失败: ${msg}`, e)
      this.loadFailed = true
      throw e
    }
  }

  /**
   * 图像描述生成
   *
   * @param imageInput 图像输入（data URL / base64 / Buffer）
   * @param maxNewTokens 生成的最大 token 数
   * @returns 图像描述文本；失败时返回空字符串
   */
  async describeImage(
    imageInput: string | Uint8Array | Buffer,
    maxNewTokens: number = 50,
  ): Promise<string> {
    try {
      const pipeline = await this.load()
      const result = await pipeline([imageInput], { max_new_tokens: maxNewTokens })
      if (result?.generated_text?.[0]?.generated_text) {
        return result.generated_text[0].generated_text.trim()
      }
      return ''
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.perception?.warn(`[VlmModelManager] 图像描述失败: ${msg}`)
      return ''
    }
  }

  // ============================================================
  // 重置与释放
  // ============================================================

  /** 重置状态（清除 pipeline 和失败标记，但不删除缓存） */
  reset(): void {
    this.pipeline = null
    this.loadFailed = false
    this.loadingPromise = null
    this.downloadingPromise = null
    this.currentProgress = null
  }

  /** 释放资源（重置状态 + 清空回调） */
  dispose(): void {
    this.reset()
    this.progressCallbacks.clear()
  }
}

// ============================================================
// 工具函数
// ============================================================

/** 格式化字节数为人类可读字符串 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
}
