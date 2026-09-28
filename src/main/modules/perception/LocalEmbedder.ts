/**
 * 本地嵌入模型 — 基于 @xenova/transformers 的向量化能力
 *
 * 职责：
 * - 加载本地嵌入模型（Xenova/all-MiniLM-L6-v2，384 维，约 22MB）
 * - 将文本转换为向量，用于场景相似检索和行为预测
 * - 模型缓存于用户配置目录下的 models/embedder，避免打包环境下写入只读目录
 * - 支持 LRU 缓存避免重复计算
 * - 支持批量化以提升吞吐
 * - 支持缓存完整性校验与磁盘清理（修复下载中断留下的半成品）
 * - 支持下载进度订阅
 *
 * 设计原则：
 * - 懒加载：首次调用 embed 时才加载模型，避免影响启动速度
 * - 单例：全局唯一实例，模型只加载一次
 * - 容错：模型加载或推理失败时返回空向量，不抛异常阻断主流程
 * - 可恢复：加载失败后按指数退避自动重试，并在加载前后剔除不合格的磁盘缓存
 * - 可观测：失败日志按类别去重，下载进度按秒节流输出
 * - 隐私：所有计算在本地完成，不上传任何文本
 *
 * @module perception/LocalEmbedder
 */

import { logger } from '@shared/toolkit/LogEngine'
import { getEmbedderCacheDir } from '../modelPaths'
import { configureTransformersEnv, resolveModelHost, type TransformersEnv } from '../transformersEnv'
import {
  EMBEDDER_META_FILES,
  EMBEDDER_WEIGHT_FILES,
  discardInvalidModelCache,
  formatBytes,
  inspectModelCache,
  removeModelCache,
  resolveModelDir,
} from '../modelCache'

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
  env: TransformersEnv
}

interface EmbedderPipeline {
  (texts: string[], options?: { pooling?: 'mean' | 'max' | 'cls'; normalize?: boolean }): Promise<{
    data: Float32Array | number[][]
    dims: number[]
  }>
}

/** 模型下载/加载进度（首次加载需下载约 22MB 权重） */
export interface EmbedderProgress {
  /** 当前处理的文件名 */
  file: string
  /** 已写入字节数 */
  loaded: number
  /** 总字节数（未知时为 0） */
  total: number
  /** 进度百分比（0-1，未知时为 0） */
  progress: number
}

/** 嵌入模型磁盘缓存信息 */
export interface EmbedderCacheInfo {
  /** 模型名称 */
  modelName: string
  /** 缓存根目录绝对路径 */
  cacheDir: string
  /** 模型目录中是否已有文件（不代表可用） */
  present: boolean
  /** 必需文件是否齐全且体积达标 */
  complete: boolean
  /** 缺失或不合格的文件（相对模型目录） */
  invalidFiles: string[]
  /** 缓存占用字节数 */
  sizeBytes: number
  /** 缓存大小（人类可读） */
  sizeReadable: string
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

/** 加载失败后的首次重试延迟 */
const RETRY_BASE_DELAY_MS = 30_000

/** 加载失败后的最大重试延迟（指数退避上限） */
const RETRY_MAX_DELAY_MS = 5 * 60_000

/** 权重文件候选：任一存在且体积达标即视为权重已就绪 */
const WEIGHT_FILES = EMBEDDER_WEIGHT_FILES

/** 必需元数据文件 */
const META_FILES = EMBEDDER_META_FILES

/** 下载进度日志的最小间隔（避免回调高频刷屏） */
const PROGRESS_LOG_INTERVAL_MS = 1000

/** 网络类加载失败的识别模式（用于在日志中补充站点与排查方向） */
const NETWORK_ERROR_PATTERN =
  /fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|network/i

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

  /** 累计加载失败次数（用于指数退避） */
  private loadFailures = 0

  /** 上次加载失败的时间戳 */
  private loadFailedAt = 0

  /** 已告警的类别（同一类失败只打一条日志，避免每轮采集刷屏） */
  private warnedKeys = new Set<string>()

  /** 当前下载/加载进度（空闲时为 null） */
  private currentProgress: EmbedderProgress | null = null

  /** 进度订阅者 */
  private readonly progressCallbacks = new Set<(progress: EmbedderProgress) => void>()

  /** 上次输出进度日志的时间（按秒节流） */
  private lastProgressLogAt = 0

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

  /** 获取模型缓存目录（与代码检索的嵌入策略共用同一路径） */
  getCacheDir(): string {
    return getEmbedderCacheDir()
  }

  /** 获取当前下载进度（空闲时为 null） */
  getCurrentProgress(): EmbedderProgress | null {
    return this.currentProgress
  }

  /**
   * 订阅模型下载进度
   *
   * 首次加载需下载约 22MB 权重，期间不会阻塞调用方（embed 会等待加载完成）。
   * 调用方可据此向界面反馈进度，避免长时间无输出。
   *
   * @returns 取消订阅函数
   */
  onProgress(callback: (progress: EmbedderProgress) => void): () => void {
    this.progressCallbacks.add(callback)
    return () => {
      this.progressCallbacks.delete(callback)
    }
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

    // 失败退避：未到重试时间窗时直接拒绝，避免每个采集周期都重跑一遍加载流程
    const waitMs = this.getRetryDelayMs() - (Date.now() - this.loadFailedAt)
    if (waitMs > 0) {
      throw new Error(
        `LocalEmbedder model load failed previously. Retry in ${Math.ceil(waitMs / 1000)}s.`,
      )
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
    const cacheDir = this.getCacheDir()

    // 下载中断会把错误页或截断内容写成正式文件，这类残留无法靠重试自愈，
    // 因此加载前先剔除不合格的缓存，保证本次拿到的要么是完整模型，要么是空目录。
    this.discardInvalidCache('加载前')

    try {
      logger.perception?.info(
        `[LocalEmbedder] 加载模型: ${this.modelName}（缓存目录: ${cacheDir}）`,
      )

      // 动态 import transformers（避免启动时加载）
      const transformers = (await import('@xenova/transformers')) as unknown as PipelineSingleton

      // transformers 默认直连 huggingface.co，国内网络下必然 fetch failed；
      // 统一改走镜像站点后再下载，否则这个模型永远加载不出来。
      const modelHost = configureTransformersEnv(transformers.env, cacheDir)
      logger.perception?.info(`[LocalEmbedder] 模型站点: ${modelHost}`)

      // 创建 feature-extraction pipeline
      const extractor = (await transformers.pipeline(
        'feature-extraction',
        this.modelName,
        {
          quantized: true, // 使用量化模型减小体积
          cache_dir: cacheDir, // 显式指定缓存目录，避免默认写入不可写位置
          progress_callback: (info: unknown) => this.handleProgress(info),
        },
      )) as unknown as EmbedderPipeline

      logger.perception?.info(`[LocalEmbedder] 模型加载成功: ${this.modelName}`)
      this.loadFailures = 0
      this.loadFailedAt = 0
      this.warnedKeys.clear()
      return extractor
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      this.loadFailures += 1
      this.loadFailedAt = Date.now()
      const nextRetrySec = Math.ceil(this.getRetryDelayMs() / 1000)
      // 网络类失败补上站点信息：只看到 "fetch failed" 时无从判断是镜像不可用还是本机断网
      const hint = NETWORK_ERROR_PATTERN.test(msg)
        ? `；模型站点 ${resolveModelHost()} 不可访问，请检查网络或代理（可用环境变量 HF_ENDPOINT 更换站点）`
        : ''
      // 加载失败属根因级错误：首次带堆栈，后续按退避节奏记录，不随采集频率放大
      const summary = `[LocalEmbedder] 模型加载失败（第 ${this.loadFailures} 次，${nextRetrySec}s 后重试，缓存目录: ${cacheDir}）: ${msg}${hint}`
      if (this.loadFailures === 1) {
        logger.perception?.error(summary, e)
      } else {
        logger.perception?.error(summary)
      }
      // 失败常由本轮写入的半成品引起：清掉后下次退避重试才有机会成功
      this.discardInvalidCache('加载失败后')
      throw e
    } finally {
      this.currentProgress = null
    }
  }

  /**
   * 剔除不合格的磁盘缓存
   *
   * 只在"目录存在但必需文件缺失或体积不达标"时删除：网络故障导致的缓存若本身完整，
   * 不受影响，避免把完好模型误删造成重复下载。
   */
  private discardInvalidCache(stage: string): void {
    try {
      const cacheDir = this.getCacheDir()
      const { removed, invalidFiles } = discardInvalidModelCache(
        cacheDir,
        this.modelName,
        WEIGHT_FILES,
        META_FILES,
      )
      if (invalidFiles.length === 0) return

      logger.perception?.warn(
        `[LocalEmbedder] ${stage}发现不完整缓存（异常: ${invalidFiles.join(', ')}），` +
          `${removed ? '已清理，下次加载将重新下载' : '清理失败，需要手动删除'}: ${resolveModelDir(cacheDir, this.modelName)}`,
      )
    } catch (e) {
      logger.perception?.warn('[LocalEmbedder] 检查磁盘缓存异常:', e)
    }
  }

  /** 处理 transformers.js 的上报（下载进度 / 单个文件完成） */
  private handleProgress(info: unknown): void {
    try {
      const data = info as Record<string, unknown>
      const status = data.status as string | undefined
      if (status !== 'progress' && status !== 'done') return

      const file = (data.file as string) ?? 'unknown'
      const loaded = status === 'progress' ? ((data.loaded as number) ?? 0) : 0
      const total = status === 'progress' ? ((data.total as number) ?? 0) : 0
      const progress = status === 'done' ? 1 : total > 0 ? loaded / total : 0

      this.currentProgress = { file, loaded, total, progress }
      this.notifyProgress(this.currentProgress)

      // 权重下载持续数秒到数十秒，回调频率很高，按秒节流记录
      const now = Date.now()
      if (status === 'done' || now - this.lastProgressLogAt >= PROGRESS_LOG_INTERVAL_MS) {
        this.lastProgressLogAt = now
        const detail =
          total > 0
            ? `${(progress * 100).toFixed(0)}%（${formatBytes(loaded)}/${formatBytes(total)}）`
            : formatBytes(loaded)
        logger.perception?.info(
          status === 'done'
            ? `[LocalEmbedder] 下载完成: ${file}`
            : `[LocalEmbedder] 下载中: ${file} ${detail}`,
        )
      }
    } catch (e) {
      logger.perception?.warn('[LocalEmbedder] 进度回调处理异常:', e)
    }
  }

  /** 通知所有进度订阅者（单个订阅者异常不影响其他订阅者） */
  private notifyProgress(progress: EmbedderProgress): void {
    for (const cb of this.progressCallbacks) {
      try {
        cb(progress)
      } catch (e) {
        logger.perception?.warn('[LocalEmbedder] 进度订阅回调异常:', e)
      }
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
      this.warnOnce('embed', `[LocalEmbedder] embed 失败: ${msg}`)
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
        this.warnOnce('embedBatch', `[LocalEmbedder] embedBatch 批次失败: ${msg}`)
        // 失败的批次保持空数组
      }
    }

    return results
  }

  /** 清空内存 LRU 缓存（不影响磁盘上的模型文件） */
  clearCache(): void {
    this.cache.clear()
    logger.perception?.info('[LocalEmbedder] 内存缓存已清空')
  }

  /**
   * 获取磁盘缓存信息
   *
   * present 表示模型目录中已有文件，complete 表示权重与元数据齐全；
   * 只有二者同时为 true 才说明缓存可安全复用，仅有 present 则是半成品残留。
   */
  getCacheInfo(): EmbedderCacheInfo {
    const cacheDir = this.getCacheDir()
    const inspection = inspectModelCache(cacheDir, this.modelName, WEIGHT_FILES, META_FILES)
    return {
      modelName: this.modelName,
      cacheDir,
      present: inspection.present,
      complete: inspection.complete,
      invalidFiles: inspection.invalidFiles,
      sizeBytes: inspection.sizeBytes,
      sizeReadable: formatBytes(inspection.sizeBytes),
    }
  }

  /**
   * 清理磁盘模型缓存
   *
   * 用于修复下载中断留下的半成品：删除后下次 embed 会重新下载完整权重。
   * 同时重置加载状态，避免内存中继续持有失效的 pipeline。
   */
  async clearDiskCache(): Promise<void> {
    const cacheDir = this.getCacheDir()
    const modelDir = resolveModelDir(cacheDir, this.modelName)

    this.reset()

    let removed = false
    try {
      removed = removeModelCache(cacheDir, this.modelName)
    } catch (e) {
      logger.perception?.error('[LocalEmbedder] 清理磁盘模型缓存失败:', e)
      throw e
    }

    logger.perception?.info(
      removed
        ? `[LocalEmbedder] 已清理磁盘模型缓存: ${modelDir}`
        : `[LocalEmbedder] 磁盘模型缓存不存在，无需清理: ${modelDir}`,
    )
  }

  /** 重置状态（清空失败退避与进度，立即允许重新加载） */
  reset(): void {
    this.pipeline = null
    this.loadingPromise = null
    this.loadFailures = 0
    this.loadFailedAt = 0
    this.warnedKeys.clear()
    this.cache.clear()
    this.currentProgress = null
    this.lastProgressLogAt = 0
    // 进度订阅者保留：重置加载状态不应让已注册的订阅失效
  }

  /** 释放资源 */
  async dispose(): Promise<void> {
    this.reset()
    LocalEmbedder.instance = null
  }

  // ============================================================
  // 私有方法
  // ============================================================

  /**
   * 计算距离下次可重试的等待时长（指数退避）
   *
   * 首次失败后 30s 重试，之后逐次翻倍，上限 5 分钟。
   * 模型长期不可用（如离线）时不会每个采集周期都重跑加载流程。
   */
  private getRetryDelayMs(): number {
    if (this.loadFailures <= 0) return 0
    return Math.min(RETRY_BASE_DELAY_MS * 2 ** (this.loadFailures - 1), RETRY_MAX_DELAY_MS)
  }

  /**
   * 同一类失败只告警一次
   *
   * embed 在模型不可用时每轮采集都会失败，逐条打印会把真正的根因淹掉，
   * 因此按类别去重；加载成功后重置，下次故障仍能看到完整信息。
   */
  private warnOnce(key: string, message: string): void {
    if (this.warnedKeys.has(key)) return
    this.warnedKeys.add(key)
    logger.perception?.warn(message)
  }

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
