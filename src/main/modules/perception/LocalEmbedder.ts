/**
 * 本地嵌入模型 — 基于 @xenova/transformers 的向量化能力
 *
 * 职责：
 * - 加载本地嵌入模型（Xenova/all-MiniLM-L6-v2，384 维，约 22MB）
 * - 将文本转换为向量，用于场景相似检索和行为预测
 * - 支持 LRU 缓存避免重复计算
 * - 支持批量化以提升吞吐
 *
 * 设计原则：
 * - 懒加载：首次调用 embed 时才加载模型，避免影响启动速度
 * - 单例：全局唯一实例，模型只加载一次
 * - 容错：模型加载或推理失败时返回空向量，不抛异常阻断主流程
 * - 隐私：所有计算在本地完成，不上传任何文本
 *
 * @module perception/LocalEmbedder
 */

import { logger } from '@shared/toolkit/LogEngine'

// ============================================================
// 类型定义（避免直接 import transformers 的类型，保持轻量）
// ============================================================

interface PipelineSingleton {
  pipeline: (
    task: string,
    model: string,
    options?: { quantized?: boolean; progress_callback?: (info: unknown) => void },
  ) => Promise<unknown>
}

interface EmbedderPipeline {
  (texts: string[], options?: { pooling?: 'mean' | 'max' | 'cls'; normalize?: boolean }): Promise<{
    data: Float32Array | number[][]
    dims: number[]
  }>
}

// ============================================================
// 常量
// ============================================================

/** 默认嵌入模型（小、快、效果好） */
const DEFAULT_MODEL = 'Xenova/all-MiniLM-L6-v2'

/** 嵌入维度（all-MiniLM-L6-v2 输出 384 维） */
const EMBEDDING_DIM = 384

/** LRU 缓存最大条目 */
const CACHE_MAX_SIZE = 1000

/** 单批最大文本数 */
const BATCH_MAX_SIZE = 16

/** 文本最大长度（超出截断，避免 OOM） */
const TEXT_MAX_LENGTH = 512

// ============================================================
// LRU 缓存
// ============================================================

class LRUCache<K, V> {
  private map = new Map<K, V>()
  private readonly maxSize: number

  constructor(maxSize: number) {
    this.maxSize = maxSize
  }

  get(key: K): V | undefined {
    const value = this.map.get(key)
    if (value !== undefined) {
      // 命中：移到末尾（最近使用）
      this.map.delete(key)
      this.map.set(key, value)
    }
    return value
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key)
    } else if (this.map.size >= this.maxSize) {
      // 淘汰最久未使用
      const oldestKey = this.map.keys().next().value
      if (oldestKey !== undefined) {
        this.map.delete(oldestKey)
      }
    }
    this.map.set(key, value)
  }

  clear(): void {
    this.map.clear()
  }

  get size(): number {
    return this.map.size
  }
}

// ============================================================
// 本地嵌入器
// ============================================================

/**
 * 本地嵌入模型单例
 *
 * 使用方式：
 * ```ts
 * const embedder = LocalEmbedder.getInstance()
 * const vec = await embedder.embed('用户正在编辑 src/main.ts 文件')
 * ```
 */
export class LocalEmbedder {
  private static instance: LocalEmbedder | null = null

  /** 已加载的 pipeline */
  private pipeline: EmbedderPipeline | null = null

  /** 加载中 Promise（防止并发加载） */
  private loadingPromise: Promise<EmbedderPipeline> | null = null

  /** 是否加载失败（避免反复尝试） */
  private loadFailed = false

  /** LRU 缓存 */
  private cache = new LRUCache<string, number[]>(CACHE_MAX_SIZE)

  /** 模型名称 */
  private readonly modelName: string

  private constructor(modelName: string = DEFAULT_MODEL) {
    this.modelName = modelName
  }

  /** 获取单例 */
  static getInstance(modelName?: string): LocalEmbedder {
    if (!LocalEmbedder.instance) {
      LocalEmbedder.instance = new LocalEmbedder(modelName)
    }
    return LocalEmbedder.instance
  }

  /** 是否已加载 */
  isLoaded(): boolean {
    return this.pipeline !== null
  }

  /** 获取嵌入维度 */
  getDimension(): number {
    return EMBEDDING_DIM
  }

  /**
   * 加载模型（懒加载）
   *
   * 首次调用会从 npm 缓存或远程下载模型（约 22MB）。
   * 后续调用直接返回已加载的 pipeline。
   */
  async load(): Promise<EmbedderPipeline> {
    // 已加载
    if (this.pipeline) return this.pipeline

    // 加载中（并发请求合并）
    if (this.loadingPromise) return this.loadingPromise

    // 已失败（避免反复尝试，需手动 reset）
    if (this.loadFailed) {
      throw new Error('LocalEmbedder model load failed previously. Call reset() to retry.')
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
  private async doLoad(): Promise<EmbedderPipeline> {
    try {
      logger.perception?.info(`[LocalEmbedder] 加载模型: ${this.modelName}`)

      // 动态 import transformers（避免启动时加载）
      const transformers = (await import('@xenova/transformers')) as unknown as PipelineSingleton

      // 创建 feature-extraction pipeline
      const extractor = (await transformers.pipeline(
        'feature-extraction',
        this.modelName,
        { quantized: true }, // 使用量化模型减小体积
      )) as unknown as EmbedderPipeline

      logger.perception?.info(`[LocalEmbedder] 模型加载成功: ${this.modelName}`)
      this.loadFailed = false
      return extractor
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.perception?.error(`[LocalEmbedder] 模型加载失败: ${msg}`, e)
      this.loadFailed = true
      throw e
    }
  }

  /**
   * 嵌入单条文本
   *
   * @param text 待向量化的文本
   * @returns 384 维浮点数组；失败时返回空数组
   */
  async embed(text: string): Promise<number[]> {
    const trimmed = this.truncate(text.trim())
    if (!trimmed) return []

    // 命中缓存
    const cached = this.cache.get(trimmed)
    if (cached) return cached

    try {
      const extractor = await this.load()
      const output = await extractor([trimmed], { pooling: 'mean', normalize: true })
      const vec = this.toFloatArray(output.data)
      this.cache.set(trimmed, vec)
      return vec
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.perception?.warn(`[LocalEmbedder] embed 失败: ${msg}`)
      return []
    }
  }

  /**
   * 批量嵌入
   *
   * @param texts 文本数组
   * @returns 向量数组（与输入顺序一致）；失败的项目返回空数组
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    const trimmed = texts.map((t) => this.truncate(t.trim()))
    const results: number[][] = new Array(trimmed.length).fill([])

    // 分离需要计算的和命中缓存的
    const pending: { index: number; text: string }[] = []
    for (let i = 0; i < trimmed.length; i++) {
      const t = trimmed[i]
      if (!t) continue
      const cached = this.cache.get(t)
      if (cached) {
        results[i] = cached
      } else {
        pending.push({ index: i, text: t })
      }
    }

    // 分批处理
    for (let i = 0; i < pending.length; i += BATCH_MAX_SIZE) {
      const batch = pending.slice(i, i + BATCH_MAX_SIZE)
      try {
        const extractor = await this.load()
        const batchTexts = batch.map((b) => b.text)
        const output = await extractor(batchTexts, { pooling: 'mean', normalize: true })

        // output.data 可能是 Float32Array（一维）或 number[][]（二维）
        const vecs = this.batchToFloatArrays(output.data, batchTexts.length)
        for (let j = 0; j < batch.length; j++) {
          const vec = vecs[j] ?? []
          results[batch[j].index] = vec
          this.cache.set(batch[j].text, vec)
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        logger.perception?.warn(`[LocalEmbedder] embedBatch 批次失败: ${msg}`)
        // 失败的批次保持空数组
      }
    }

    return results
  }

  /** 清空缓存 */
  clearCache(): void {
    this.cache.clear()
    logger.perception?.info('[LocalEmbedder] 缓存已清空')
  }

  /** 重置（用于模型加载失败后重试） */
  reset(): void {
    this.pipeline = null
    this.loadFailed = false
    this.loadingPromise = null
    this.cache.clear()
  }

  /** 释放资源 */
  async dispose(): Promise<void> {
    this.pipeline = null
    this.loadFailed = false
    this.loadingPromise = null
    this.cache.clear()
    LocalEmbedder.instance = null
  }

  // ============================================================
  // 私有方法
  // ============================================================

  /** 截断文本（按字符数，避免 OOM） */
  private truncate(text: string): string {
    if (text.length <= TEXT_MAX_LENGTH) return text
    return text.slice(0, TEXT_MAX_LENGTH)
  }

  /** 将输出转换为 number[] */
  private toFloatArray(data: Float32Array | number[][]): number[] {
    if (Array.isArray(data)) {
      // 二维数组取第一个
      return data[0] ? Array.from(data[0] as number[]) : []
    }
    // Float32Array 一维
    return Array.from(data)
  }

  /** 批量输出转换为 number[][] */
  private batchToFloatArrays(
    data: Float32Array | number[][],
    batchSize: number,
  ): number[][] {
    if (Array.isArray(data)) {
      // 二维数组
      return data.map((row) => (Array.isArray(row) ? Array.from(row) : []))
    }
    // 一维 Float32Array，按维度切分
    const totalLen = data.length
    const dim = totalLen / batchSize
    const result: number[][] = []
    for (let i = 0; i < batchSize; i++) {
      const start = i * dim
      const end = start + dim
      result.push(Array.from(data.slice(start, end)))
    }
    return result
  }
}

// ============================================================
// 便捷函数
// ============================================================

/**
 * 快速嵌入单条文本
 *
 * 使用默认单例实例，适合一次性调用。
 * 频繁调用建议先 getInstance 再复用。
 */
export async function embedText(text: string): Promise<number[]> {
  return LocalEmbedder.getInstance().embed(text)
}

/**
 * 快速批量嵌入
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  return LocalEmbedder.getInstance().embedBatch(texts)
}
