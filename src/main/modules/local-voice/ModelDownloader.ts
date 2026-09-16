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
import { isErrorPageContent } from './modelFileValidator'

/** 下载项 */
export interface DownloadItem {
  /** 下载地址 */
  url: string
  /** 文件名 */
  filename: string
  /** 文件校验和（MD5 或 SHA256） */
  checksum?: string
  /** 校验和类型 */
  checksumType?: 'md5' | 'sha256'
}

/**
 * 仓库级下载源（整仓快照）
 *
 * 等价于 HuggingFace / ModelScope 的 `snapshot_download`：运行时通过平台 API
 * 列出仓库内全部文件再逐个下载，避免硬编码文件清单导致的漏文件 / 404。
 *
 * 目录结构：`<模型根目录>/<dirName>/<仓库内相对路径>`
 */
export interface RepoDownloadSource {
  /** 目标子目录名（相对模型根目录） */
  dirName: string
  /** ModelScope 仓库 ID（namespace/model） */
  modelscopeRepo: string
  /** HuggingFace 仓库 ID（owner/model） */
  huggingfaceRepo: string
  /** 额外排除的文件名（默认已排除 README / LICENSE / 图片等） */
  excludeFiles?: string[]
}

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
  /** 下载地址（单个文件下载） */
  downloadUrl?: string
  /** 下载项列表（默认来源） */
  downloadItems?: DownloadItem[]
  /** 按来源分组的下载项（UI 选择源时优先使用） */
  downloadItemsBySource?: Record<'modelscope' | 'huggingface', DownloadItem[]>
  /** 仓库级下载源（整仓快照，优先级高于 downloadItems） */
  repos?: RepoDownloadSource[]
  /** 关键文件（相对模型根目录）：全部存在才视为已下载完成 */
  criticalFiles?: string[]
  /** 文件校验和（MD5 或 SHA256） */
  checksum?: string
  /** 校验和类型 */
  checksumType?: 'md5' | 'sha256'
  /** 下载文件名 */
  filename?: string
  /** 解压后目录名 */
  extractDir?: string
  /** 是否需要解压 */
  needExtract: boolean
  /** 依赖的其他模型 */
  dependencies?: string[]
  /** 平台要求 */
  platforms?: NodeJS.Platform[]
  /** 默认下载源（modelscope/huggingface） */
  source?: 'modelscope' | 'huggingface'
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
  /** 当前正在下载的文件（相对模型目录） */
  currentFile?: string
  /** 当前文件序号（从 1 开始） */
  fileIndex?: number
  /** 文件总数 */
  fileCount?: number
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
  /** 是否已结算（保证 onComplete 只回调一次：取消与完成竞争时不会既报取消又报成功） */
  settled?: boolean
}

/** 仓库内文件（运行时从平台 API 获取） */
interface RepoFile {
  /** 仓库内相对路径 */
  path: string
  /** 文件大小（字节，API 未提供时为 0） */
  size: number
  /** 下载直链 */
  url: string
}

/** 仓库中无需下载的文件扩展名（文档 / 图片 / 压缩包） */
const IGNORED_REPO_EXTS = new Set([
  '.md',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.webp',
  '.pdf',
  '.zip',
])

/** 进度推送最小间隔（毫秒）：避免高频 IPC 导致渲染卡顿 */
const PROGRESS_THROTTLE_MS = 200

/**
 * 错误页嗅探窗口（字节）
 *
 * 响应体不再整包驻留内存，只保留头部用于错误页判定。
 * 取值与 modelFileValidator 中 JSON 错误页的体积上限一致：
 * 超过该体积的响应本来就不会走「小体积 JSON」分支，语义完全等价。
 */
const SNIFF_MAX_BYTES = 64 * 1024

/** 单次请求超时（毫秒） */
const REQUEST_TIMEOUT_MS = 30 * 60 * 1000

/** 下载被用户取消（与失败区分：取消不重试、不报错、不留残文件） */
export class DownloadCancelledError extends Error {
  constructor() {
    super('下载已取消')
    this.name = 'DownloadCancelledError'
  }
}

/** 判断错误是否为「用户取消」 */
function isCancelledError(err: unknown, signal?: AbortSignal): boolean {
  if (err instanceof DownloadCancelledError) return true
  if (signal?.aborted) return true
  return (err as { name?: string } | null)?.name === 'AbortError'
}

/**
 * 合并两个中断信号（取先触发者）
 *
 * 不依赖 `AbortSignal.any`（Node 20.3+ 才有），避免版本差异导致下载直接失败。
 */
function combineAbortSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  const controller = new AbortController()

  const forward = (from: AbortSignal) => () => controller.abort(from.reason)
  const onAbortA = forward(a)
  const onAbortB = forward(b)

  if (a.aborted || b.aborted) {
    controller.abort(a.aborted ? a.reason : b.reason)
    return controller.signal
  }

  a.addEventListener('abort', onAbortA, { once: true })
  b.addEventListener('abort', onAbortB, { once: true })
  controller.signal.addEventListener(
    'abort',
    () => {
      a.removeEventListener('abort', onAbortA)
      b.removeEventListener('abort', onAbortB)
    },
    { once: true },
  )

  return controller.signal
}

/** 模型下载器 */
export class ModelDownloader {
  private config: LocalVoiceConfig
  private downloadQueue: DownloadTask[] = []
  private activeDownloads = new Map<string, DownloadTask>()
  private maxConcurrentDownloads: number
  /** ModelScope API 地址缓存（namespace/model → CDN URL 映射） */
  private modelscopeUrlCache = new Map<string, string>()
  /** 进行中下载的中断控制器（modelId → controller）：取消时真正中断 HTTP 请求 */
  private abortControllers = new Map<string, AbortController>()

  constructor(config: LocalVoiceConfig) {
    this.config = config
    this.maxConcurrentDownloads = config.maxConcurrentDownloads || 2
  }

  /**
   * 解析下载 URL，处理 ModelScope / HuggingFace 等平台的特殊逻辑
   *
   * - ModelScope: 通过 API 获取真实 CDN 下载地址
   * - HuggingFace: 替换为 hf-mirror.com 镜像（国内可访问）
   */
  private async resolveDownloadUrl(url: string): Promise<string> {
    // ModelScope: 需要通过 API 获取真实下载地址
    const modelscopeMatch = url.match(
      /modelscope\.cn\/(?:api\/v1\/)?models\/([^/]+)\/([^/]+)\/(?:resolve|repo)(?:\/([^/]*))?\/(.+)/
    )
    if (modelscopeMatch) {
      const namespace = modelscopeMatch[1]
      const modelName = modelscopeMatch[2]
      const revision = modelscopeMatch[3] || 'master'
      const filePath = modelscopeMatch[4]
      const cacheKey = `${namespace}/${modelName}/${revision}/${filePath}`

      if (this.modelscopeUrlCache.has(cacheKey)) {
        return this.modelscopeUrlCache.get(cacheKey)!
      }

      const apiUrl = `https://modelscope.cn/api/v1/models/${namespace}/${modelName}/repo?Revision=${revision}&FilePath=${encodeURIComponent(filePath)}`
      logger.system.info(`[ModelDownloader] 解析 ModelScope 下载地址: ${apiUrl}`)

      const resp = await fetch(apiUrl, {
        headers: { 'User-Agent': 'AweeClaw/1.0' },
        signal: AbortSignal.timeout(30000), // 30 秒超时
      })
      if (!resp.ok) {
        throw new Error(`ModelScope API 请求失败: HTTP ${resp.status}`)
      }

      const json = await resp.json() as any
      // ModelScope API 返回格式: { Code: 200, Data: { DownloadUrl: "..." } }
      // 也可能返回: { Data: { Url: "..." } } 或其他格式
      const cdnUrl = json?.Data?.DownloadUrl || json?.Data?.Url || json?.data?.downloadUrl
      if (!cdnUrl) {
        logger.system.warn(`[ModelDownloader] ModelScope API 响应格式异常: ${JSON.stringify(json).slice(0, 300)}`)
        throw new Error(`ModelScope API 未返回下载地址`)
      }

      this.modelscopeUrlCache.set(cacheKey, cdnUrl)
      logger.system.info(`[ModelDownloader] ModelScope CDN 地址: ${cdnUrl.slice(0, 100)}...`)
      return cdnUrl
    }

    // HuggingFace: 替换为镜像
    if (url.includes('huggingface.co')) {
      const mirrorUrl = url.replace('huggingface.co', 'hf-mirror.com')
      logger.system.info(`[ModelDownloader] HuggingFace 镜像地址: ${mirrorUrl}`)
      return mirrorUrl
    }

    return url
  }

  /**
   * 下载单个文件到指定路径（带重试、内容校验、可取消）
   *
   * 设计要点：
   * 1. **流式落盘**：边下边写入 `<file>.part`，不再把整个响应体拼成 Buffer。
   *    MOSS-TTS 的 `.data` 权重可达数百 MB，整包驻留内存（chunks + concat 双份）
   *    会把主进程内存顶到 GB 级并造成界面卡顿。
   * 2. **原子替换**：只有校验通过才 rename 成目标文件；中途失败只留下 `.part`，
   *    不会污染模型目录（避免「看起来下完了其实是半包」）。
   * 3. **可取消**：接受外部 AbortSignal，取消立即中断请求并清理 `.part`，且不重试。
   * 4. **内容校验**：错误页（HTML / 平台错误 JSON / "Entry not found"）常以 200
   *    状态返回，只保留有限嗅探窗口判定，语义与整包校验一致。
   */
  private async downloadFile(
    url: string,
    filePath: string,
    onProgress?: (downloaded: number, total: number) => void,
    expectedSize?: number,
    signal?: AbortSignal,
  ): Promise<void> {
    // 构建候选 URL 列表
    // HuggingFace 直连在国内网络下通常长时间挂起（不是立即失败），因此镜像优先、直连兜底
    const candidateUrls: string[] = []
    if (url.includes('huggingface.co')) {
      candidateUrls.push(url.replace('huggingface.co', 'hf-mirror.com'))
      candidateUrls.push(url)
    } else {
      candidateUrls.push(url)
    }

    try {
      const resolvedUrl = await this.resolveDownloadUrl(url)
      if (!candidateUrls.includes(resolvedUrl)) {
        candidateUrls.push(resolvedUrl)
      }
    } catch (err) {
      logger.system.warn(`[ModelDownloader] URL 解析失败，将使用原始 URL: ${err}`)
    }

    const fileDir = path.dirname(filePath)
    if (!fs.existsSync(fileDir)) {
      fs.mkdirSync(fileDir, { recursive: true })
    }

    /** 临时文件与目标文件同目录，保证 rename 是同一文件系统内的原子操作 */
    const tempPath = `${filePath}.part`

    let lastError: Error | null = null

    // 尝试每个候选 URL
    for (const tryUrl of candidateUrls) {
      if (signal?.aborted) throw new DownloadCancelledError()

      try {
        logger.system.info(`[ModelDownloader] 尝试下载: ${tryUrl.slice(0, 120)}...`)

        const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        const requestSignal = signal ? combineAbortSignals(timeoutSignal, signal) : timeoutSignal

        const response = await fetch(tryUrl, {
          headers: { 'User-Agent': 'AweeClaw/1.0' },
          signal: requestSignal,
        })
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }

        const contentType = response.headers.get('content-type') || ''
        const totalBytes = parseInt(response.headers.get('content-length') || '0', 10)

        const reader = response.body?.getReader()
        if (!reader) {
          throw new Error('无法读取响应体')
        }

        // 嗅探窗口固定大小，不随文件体积增长
        const sniffChunks: Buffer[] = []
        let sniffBytes = 0

        let downloadedBytes = 0
        const handle = await fs.promises.open(tempPath, 'w')

        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            if (!value || value.length === 0) continue

            if (sniffBytes < SNIFF_MAX_BYTES) {
              const take = Math.min(value.length, SNIFF_MAX_BYTES - sniffBytes)
              const head = Buffer.from(value.subarray(0, take))
              sniffChunks.push(head)
              sniffBytes += head.length
            }

            // 逐块 await 写入：天然退避，内存占用与单个数据块同阶
            await handle.write(value)

            downloadedBytes += value.length
            onProgress?.(downloadedBytes, totalBytes)
          }
        } finally {
          await handle.close()
        }

        if (downloadedBytes === 0) {
          throw new Error('下载内容为空（0 字节）')
        }

        // 内容校验：错误页可能以 200 状态返回，必须在落盘前拦截
        const sniff = Buffer.concat(sniffChunks, sniffBytes)
        if (isErrorPageContent(sniff, contentType)) {
          throw new Error(
            `下载内容不是有效文件（${downloadedBytes} 字节），可能是错误页或链接失效`,
          )
        }

        // 大小校验：与仓库声明的文件大小比对，尽早发现截断 / 失效链接
        if (expectedSize && expectedSize > 0 && downloadedBytes !== expectedSize) {
          throw new Error(
            `文件大小不符：期望 ${expectedSize} 字节，实际 ${downloadedBytes} 字节（下载可能被中断）`,
          )
        }

        // 校验通过才原子替换：半包文件永远不会被当成「已下载完成」
        fs.renameSync(tempPath, filePath)
        logger.system.info(
          `[ModelDownloader] 文件已保存: ${filePath} (${(downloadedBytes / 1024 / 1024).toFixed(1)} MB)`,
        )
        return // 成功，退出
      } catch (err) {
        this.removeFileQuietly(tempPath)

        // 取消是用户意图：不重试、不走「所有源都失败」的错误文案
        if (isCancelledError(err, signal)) {
          throw new DownloadCancelledError()
        }

        lastError = err instanceof Error ? err : new Error(String(err))
        logger.system.warn(`[ModelDownloader] 下载失败 (${tryUrl.slice(0, 80)}): ${lastError.message}`)
      }
    }

    // 所有候选 URL 都失败
    throw new Error(`所有下载源都失败，最后错误: ${lastError?.message || '未知错误'}`)
  }

  /** 静默删除文件（不存在 / 被占用都不抛错） */
  private removeFileQuietly(filePath: string): void {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    } catch {
      /* 忽略清理错误 */
    }
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
        size: 239 * 1024 * 1024, // 239MB（与 super-ai-browser 一致）
        downloadItems: [
          {
            url: 'https://modelscope.cn/models/pengzhendong/sherpa-onnx-sense-voice-zh-en-ja-ko-yue/resolve/master/model.int8.onnx',
            filename: 'model.int8.onnx',
          },
          {
            url: 'https://modelscope.cn/models/pengzhendong/sherpa-onnx-sense-voice-zh-en-ja-ko-yue/resolve/master/tokens.txt',
            filename: 'tokens.txt',
          },
        ],
        downloadItemsBySource: {
          modelscope: [
            {
              url: 'https://modelscope.cn/models/pengzhendong/sherpa-onnx-sense-voice-zh-en-ja-ko-yue/resolve/master/model.int8.onnx',
              filename: 'model.int8.onnx',
            },
            {
              url: 'https://modelscope.cn/models/pengzhendong/sherpa-onnx-sense-voice-zh-en-ja-ko-yue/resolve/master/tokens.txt',
              filename: 'tokens.txt',
            },
          ],
          huggingface: [
            {
              url: 'https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09/resolve/main/model.int8.onnx?download=true',
              filename: 'model.int8.onnx',
            },
            {
              url: 'https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09/resolve/main/tokens.txt?download=true',
              filename: 'tokens.txt',
            },
          ],
        },
        needExtract: false,
        platforms: ['darwin', 'linux', 'win32'],
        source: 'modelscope',
      },
      {
        id: 'moss-tts-nano',
        name: 'MOSS TTS Nano',
        type: 'tts',
        version: '1.0.0',
        description: '轻量级离线语音合成模型（含 MOSS-TTS-Nano-100M-ONNX + MOSS-Audio-Tokenizer-Nano-ONNX）',
        // 两个仓库文件合计约 764MB（实际下载总量以平台 API 返回的文件大小为准）
        size: 763_698_255,
        // 整仓快照下载（等价于 super-ai-browser 的 snapshot_download）：
        // 运行时通过平台 API 列出仓库内全部文件再逐个下载，
        // 避免硬编码清单漏文件（.data 权重 / manifest / meta）或文件名不符导致的 404
        repos: [
          {
            dirName: 'MOSS-TTS-Nano-100M-ONNX',
            modelscopeRepo: 'openmoss/MOSS-TTS-Nano-100M-ONNX',
            huggingfaceRepo: 'OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX',
          },
          {
            dirName: 'MOSS-Audio-Tokenizer-Nano-ONNX',
            modelscopeRepo: 'openmoss/MOSS-Audio-Tokenizer-Nano-ONNX',
            huggingfaceRepo: 'OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano-ONNX',
          },
        ],
        // 关键文件：用于判断模型是否已完整下载（含最大的 .data 权重，避免"半包"被判定为已完成）
        criticalFiles: [
          'MOSS-TTS-Nano-100M-ONNX/browser_poc_manifest.json',
          'MOSS-TTS-Nano-100M-ONNX/tts_browser_onnx_meta.json',
          'MOSS-TTS-Nano-100M-ONNX/moss_tts_global_shared.data',
          'MOSS-Audio-Tokenizer-Nano-ONNX/codec_browser_onnx_meta.json',
          'MOSS-Audio-Tokenizer-Nano-ONNX/moss_audio_tokenizer_decode_shared.data',
        ],
        needExtract: false,
        platforms: ['darwin', 'linux', 'win32'],
        source: 'modelscope',
      },
    ]
  }



  /** 获取模型下载信息 */
  async getModelDownloadInfo(modelId: string): Promise<ModelMetadata | null> {
    const models = await this.getAvailableModels()
    return models.find(m => m.id === modelId) || null
  }

  /** 下载模型（可指定来源：modelscope | huggingface） */
  async downloadModel(
    modelId: string,
    onProgress?: (progress: DownloadProgress) => void,
    source?: 'modelscope' | 'huggingface',
  ): Promise<boolean> {
    const baseMetadata = await this.getModelDownloadInfo(modelId)
    if (!baseMetadata) {
      throw new Error(`模型不存在: ${modelId}`)
    }

    const metadata: ModelMetadata = {
      ...baseMetadata,
      downloadItems:
        source && baseMetadata.downloadItemsBySource?.[source]
          ? baseMetadata.downloadItemsBySource[source]
          : baseMetadata.downloadItems,
      source: source ?? baseMetadata.source,
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

    // 同一模型的重复请求会让 activeDownloads 记录互相覆盖（进度、取消都会错乱），
    // 直接拒绝第二次请求；UI 侧按钮本来也会在下载中禁用。
    if (
      this.activeDownloads.has(modelId) ||
      this.downloadQueue.some((t) => t.metadata.id === modelId)
    ) {
      throw new Error(`模型正在下载中: ${modelId}`)
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
    // 1) 仍在排队、尚未开始的任务：移除并即时结算。
    //    只从队列里删掉而不结算，会让 downloadModel 返回的 promise 永远不 settle，
    //    UI 就卡在「下载中」再也不会结束。
    const queued = this.downloadQueue.filter((t) => t.metadata.id === modelId)
    if (queued.length > 0) {
      this.downloadQueue = this.downloadQueue.filter((t) => t.metadata.id !== modelId)
      for (const task of queued) {
        task.status = 'error'
        task.error = '下载已取消'
        this.finishTask(task, false, '下载已取消')
      }
    }

    // 2) 正在下载的任务：必须中断 HTTP 请求。
    //    只改任务状态不会让 reader 停下来，后台仍会跑满带宽并把残文件写进模型目录。
    const activeTask = this.activeDownloads.get(modelId)
    if (!activeTask) {
      if (queued.length > 0) this.processQueue()
      return
    }

    this.abortControllers.get(modelId)?.abort()
    this.abortControllers.delete(modelId)
    this.activeDownloads.delete(modelId)

    activeTask.status = 'error'
    activeTask.error = '下载已取消'
    logger.system.info(`[ModelDownloader] 已取消下载: ${modelId}`)

    // 先结算 promise，用户无需等待余下清理
    this.finishTask(activeTask, false, '下载已取消')

    this.processQueue()
  }

  /** 检查模型是否已下载 */
  isModelDownloaded(metadata: ModelMetadata, _targetDir?: string): boolean {
    const dir = this.getModelTargetDir(metadata)
    
    if (!fs.existsSync(dir)) {
      return false
    }

    // 检查关键文件是否存在且大小合理
    const criticalFiles = this.getCriticalFiles(metadata)
    for (const file of criticalFiles) {
      const filePath = path.join(dir, file)
      if (!fs.existsSync(filePath)) {
        return false
      }
      // 检查文件大小：模型文件不应小于 1KB（排除空文件或错误页面）
      try {
        const stat = fs.statSync(filePath)
        if (stat.size < 1024) {
          logger.system.warn(`[ModelDownloader] 模型文件过小，可能无效: ${filePath} (${stat.size} bytes)`)
          return false
        }
      } catch {
        return false
      }
    }

    return true
  }

  /** 获取模型目标目录 */
  getModelTargetDir(metadata: ModelMetadata): string {
    const baseDir = this.config.modelDownloadDir || path.join(process.cwd(), 'models')

    // 若有下载项 / 仓库快照且未指定 extractDir，使用引擎目录作为目标
    // （文件结构已在下载项 / 仓库目录名中体现）
    const hasItems =
      (metadata.downloadItems?.length ?? 0) > 0 || (metadata.repos?.length ?? 0) > 0
    if (hasItems && metadata.extractDir === undefined) {
      switch (metadata.type) {
        case 'asr':
          return path.join(baseDir, 'sherpa-asr')
        case 'tts':
          return path.join(baseDir, 'sherpa-tts')
        case 'gpt-sovits':
          return path.join(baseDir, 'gpt-sovits')
        default:
          return path.join(baseDir, metadata.type)
      }
    }
    
    // 根据模型类型返回对应的目录
    switch (metadata.type) {
      case 'asr':
        return path.join(baseDir, 'sherpa-asr', metadata.extractDir || metadata.id)
      case 'tts':
        return path.join(baseDir, 'sherpa-tts', metadata.extractDir || metadata.id)
      case 'gpt-sovits':
        return path.join(baseDir, 'gpt-sovits', metadata.extractDir || metadata.id)
      default:
        return path.join(baseDir, metadata.type, metadata.extractDir || metadata.id)
    }
  }

  /** 获取模型目录（已下载时返回目录路径，否则返回 null） */
  async getModelDir(modelId: string): Promise<string | null> {
    const metadata = await this.getModelDownloadInfo(modelId)
    if (!metadata) {
      return null
    }
    const dir = this.getModelTargetDir(metadata)
    return fs.existsSync(dir) ? dir : null
  }

  /** 删除已下载模型目录 */
  async deleteModel(modelId: string): Promise<boolean> {
    const metadata = await this.getModelDownloadInfo(modelId)
    if (!metadata) {
      throw new Error(`模型不存在: ${modelId}`)
    }

    const targetDir = this.getModelTargetDir(metadata)
    if (!fs.existsSync(targetDir)) {
      return false
    }

    fs.rmSync(targetDir, { recursive: true, force: true })
    logger.system.info(`[ModelDownloader] 已删除模型目录: ${targetDir}`)
    return true
  }


  /** 获取模型关键文件列表 */
  private getCriticalFiles(metadata: ModelMetadata): string[] {
    // 显式声明的关键文件优先（仓库快照下载的场景）
    if (metadata.criticalFiles && metadata.criticalFiles.length > 0) {
      return metadata.criticalFiles
    }

    // 如果有 downloadItems，使用 downloadItems 中的文件名
    if (metadata.downloadItems && metadata.downloadItems.length > 0) {
      return metadata.downloadItems.map(item => item.filename)
    }

    // 仓库快照：目录存在即视为关键路径
    if (metadata.repos && metadata.repos.length > 0) {
      return metadata.repos.map(repo => repo.dirName)
    }
    
    // 否则根据模型类型返回关键文件
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

    const modelId = task.metadata.id

    // 排队期间已被取消的任务不再启动（否则会白下载几百 MB）
    if (task.settled) {
      this.processQueue()
      return
    }

    // 标记为活跃下载
    this.activeDownloads.set(modelId, task)
    task.status = 'downloading'

    // 每个任务一个中断控制器：取消时真正中断 HTTP 请求
    const controller = new AbortController()
    this.abortControllers.set(modelId, controller)

    try {
      // 开始下载
      await this.executeDownload(task, controller.signal)

      // 下载完成
      task.status = 'completed'
      this.finishTask(task, true)
    } catch (error) {
      // 下载失败
      task.status = 'error'
      task.error = error instanceof Error ? error.message : String(error)
      this.finishTask(task, false, task.error)
    } finally {
      // 从活跃下载中移除
      this.abortControllers.delete(modelId)
      this.activeDownloads.delete(modelId)

      // 继续处理队列
      this.processQueue()
    }
  }

  /**
   * 结算任务：保证 onComplete 恰好回调一次
   *
   * 「取消」与「下载完成」会竞争：如果两边都回调，
   * 上层 promise 会先 reject 又被 resolve，UI 上表现为「取消后又提示成功」。
   */
  private finishTask(task: DownloadTask, success: boolean, error?: string): void {
    if (task.settled) return
    task.settled = true
    task.onComplete?.(success, error)
  }

  /** 执行下载 */
  private async executeDownload(task: DownloadTask, signal?: AbortSignal): Promise<void> {
    const { metadata, targetDir } = task

    // 确保目标目录存在
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true })
    }

    try {
      // 下载方式优先级：仓库快照 > 多文件清单 > 单文件
      if (metadata.repos && metadata.repos.length > 0) {
        await this.executeRepoDownload(task, signal)
      } else if (metadata.downloadItems && metadata.downloadItems.length > 0) {
        await this.executeMultiFileDownload(task, signal)
      } else if (metadata.downloadUrl) {
        // 单文件下载（兼容旧逻辑）
        await this.executeSingleFileDownload(task, signal)
      } else {
        throw new Error('没有配置下载地址')
      }

      logger.system.info(`[ModelDownloader] 模型下载完成: ${metadata.id}`)
    } catch (error) {
      // 取消属于用户意图，不按失败记日志
      if (error instanceof DownloadCancelledError) {
        logger.system.info(`[ModelDownloader] 下载已取消: ${metadata.id}`)
      } else {
        logger.system.error(`[ModelDownloader] 模型下载失败: ${metadata.id}`, error)
      }
      throw error
    }
  }

  /** 执行单文件下载（兼容旧逻辑） */
  private async executeSingleFileDownload(task: DownloadTask, signal?: AbortSignal): Promise<void> {
    const { metadata, targetDir, onProgress } = task

    if (!metadata.downloadUrl || !metadata.filename) {
      throw new Error('单文件下载缺少 downloadUrl 或 filename')
    }

    const downloadPath = path.join(targetDir, metadata.filename)
    const startTime = Date.now()

    await this.downloadFile(
      metadata.downloadUrl,
      downloadPath,
      (downloaded, total) => {
        const elapsed = (Date.now() - startTime) / 1000
        const speed = downloaded / elapsed
        const percentage = total > 0 ? (downloaded / total) * 100 : 0
        const eta = total > 0 ? (total - downloaded) / speed : 0
        onProgress?.({
          modelId: metadata.id,
          downloaded,
          total,
          percentage,
          speed,
          eta,
          status: 'downloading',
        })
      },
      undefined,
      signal,
    )

    // 校验文件
    if (metadata.checksum) {
      task.status = 'verifying'
      onProgress?.({
        modelId: metadata.id,
        downloaded: 0,
        total: 0,
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
        downloaded: 0,
        total: 0,
        percentage: 100,
        speed: 0,
        eta: 0,
        status: 'extracting',
      })

      await this.extractFile(downloadPath, targetDir)
      
      if (fs.existsSync(downloadPath)) {
        fs.unlinkSync(downloadPath)
      }
    }

    onProgress?.({
      modelId: metadata.id,
      downloaded: 0,
      total: 0,
      percentage: 100,
      speed: 0,
      eta: 0,
      status: 'completed',
    })
  }

  /** 执行多文件下载 */
  /**
   * 创建节流后的进度推送器
   *
   * 为什么需要节流：下载时每个数据块都会触发回调，239MB 文件可产生上千次推送，
   * 高频 IPC + 渲染进程 setState 会造成界面卡顿，进度条观感上「不动」。
   * 这里限制最快 200ms 或百分比变化 ≥1% 才推送，并保证首帧与末帧一定发出。
   */
  private createProgressEmitter(
    onProgress: ((progress: DownloadProgress) => void) | undefined,
    modelId: string,
    totalBytes: number,
  ): {
    emit: (
      downloaded: number,
      info?: {
        currentFile?: string
        fileIndex?: number
        fileCount?: number
        status?: DownloadProgress['status']
      },
      force?: boolean,
    ) => void
  } {
    const startTime = Date.now()
    let lastEmitTime = 0
    let lastPercentage = -1

    return {
      emit: (downloaded, info, force = false): void => {
        const now = Date.now()
        const percentage = totalBytes > 0 ? Math.min((downloaded / totalBytes) * 100, 99.9) : 0

        if (
          !force &&
          now - lastEmitTime < PROGRESS_THROTTLE_MS &&
          Math.abs(percentage - lastPercentage) < 1
        ) {
          return
        }

        lastEmitTime = now
        lastPercentage = percentage

        const elapsed = (now - startTime) / 1000
        const speed = elapsed > 0 ? downloaded / elapsed : 0

        onProgress?.({
          modelId,
          downloaded,
          total: totalBytes,
          percentage: Number(percentage.toFixed(1)),
          speed,
          eta: speed > 0 && totalBytes > downloaded ? (totalBytes - downloaded) / speed : 0,
          status: info?.status ?? 'downloading',
          currentFile: info?.currentFile,
          fileIndex: info?.fileIndex,
          fileCount: info?.fileCount,
        })
      },
    }
  }

  /**
   * 执行仓库级下载（整仓快照）
   *
   * 等价于 HuggingFace / ModelScope 的 snapshot_download：
   * 1. 通过平台 API 列出仓库全部文件（选定源失败自动回退另一源）
   * 2. 以真实文件字节总和计算进度，保证进度条准确
   * 3. 逐文件下载并按声明大小校验，任一失败即整体失败
   * 4. **已存在且体积吻合的文件直接复用**：MOSS-TTS 整仓 764MB，
   *    一旦中途断网，重试若从头再下会把用户流量和时间全烧掉
   */
  private async executeRepoDownload(task: DownloadTask, signal?: AbortSignal): Promise<void> {
    const { metadata, targetDir, onProgress } = task
    const repos = metadata.repos
    if (!repos || repos.length === 0) {
      throw new Error('没有配置仓库下载源')
    }

    const source: 'modelscope' | 'huggingface' =
      metadata.source === 'huggingface' ? 'huggingface' : 'modelscope'

    // 1. 规划文件清单
    const planned: Array<{ repo: RepoDownloadSource; files: RepoFile[] }> = []
    for (const repo of repos) {
      const files = await this.listRepoFiles(repo, source)
      logger.system.info(`[ModelDownloader] 仓库 ${repo.dirName} 待下载文件 ${files.length} 个`)
      planned.push({ repo, files })
    }

    const totalFiles = planned.reduce((sum, p) => sum + p.files.length, 0)
    const declaredBytes = planned.reduce(
      (sum, p) => sum + p.files.reduce((s, f) => s + (f.size || 0), 0),
      0,
    )

    // 以真实总字节为准；平台未返回大小时退回元数据声明值
    const totalBytes = declaredBytes > 0 ? declaredBytes : metadata.size
    const emitter = this.createProgressEmitter(onProgress, metadata.id, totalBytes)

    let downloadedBytes = 0
    let fileIndex = 0

    // 2. 逐文件下载
    for (const { repo, files } of planned) {
      for (const file of files) {
        if (signal?.aborted) throw new DownloadCancelledError()

        fileIndex++
        const filePath = path.join(targetDir, repo.dirName, file.path)
        const fileLabel = `${repo.dirName}/${file.path}`

        // 断点续传：上一次跑了一半的文件直接复用，不再重下
        const reusableSize = this.getReusableFileSize(filePath, file.size)
        if (reusableSize > 0) {
          downloadedBytes += reusableSize
          logger.system.info(
            `[ModelDownloader] 复用已存在文件 ${fileIndex}/${totalFiles}: ${fileLabel} ` +
              `(${(reusableSize / 1024 / 1024).toFixed(1)} MB)`,
          )
          emitter.emit(
            downloadedBytes,
            { currentFile: fileLabel, fileIndex, fileCount: totalFiles },
            true,
          )
          continue
        }

        let fileDownloaded = 0

        logger.system.info(`[ModelDownloader] 下载中 ${fileIndex}/${totalFiles}: ${fileLabel}`)

        await this.downloadFile(
          file.url,
          filePath,
          (downloaded) => {
            downloadedBytes += downloaded - fileDownloaded
            fileDownloaded = downloaded

            emitter.emit(downloadedBytes, {
              currentFile: fileLabel,
              fileIndex,
              fileCount: totalFiles,
            })
          },
          file.size,
          signal,
        )

        // 对齐声明大小，避免累计值因校验误差产生漂移
        if (file.size > 0 && file.size !== fileDownloaded) {
          downloadedBytes += file.size - fileDownloaded
        }

        emitter.emit(
          downloadedBytes,
          { currentFile: `${repo.dirName}/${file.path}`, fileIndex, fileCount: totalFiles },
          true,
        )
      }
    }

    // 3. 完成
    onProgress?.({
      modelId: metadata.id,
      downloaded: downloadedBytes,
      total: totalBytes,
      percentage: 100,
      speed: 0,
      eta: 0,
      status: 'completed',
      fileIndex: totalFiles,
      fileCount: totalFiles,
    })
  }

  /** 列出仓库文件（选定源失败时自动回退到另一源） */
  private async listRepoFiles(
    repo: RepoDownloadSource,
    source: 'modelscope' | 'huggingface',
  ): Promise<RepoFile[]> {
    const order: Array<'modelscope' | 'huggingface'> =
      source === 'huggingface' ? ['huggingface', 'modelscope'] : ['modelscope', 'huggingface']

    let lastError: Error | null = null

    for (const trySource of order) {
      try {
        const files =
          trySource === 'modelscope'
            ? await this.listModelscopeRepoFiles(repo)
            : await this.listHuggingFaceRepoFiles(repo)
        if (files.length > 0) {
          return files
        }
        lastError = new Error('仓库文件列表为空')
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        logger.system.warn(
          `[ModelDownloader] 列举仓库文件失败 (${trySource}/${repo.dirName}): ${lastError.message}`,
        )
      }
    }

    throw new Error(
      `无法获取仓库文件清单: ${repo.dirName}（${lastError?.message || '未知错误'}）`,
    )
  }

  /** 列出 ModelScope 仓库文件 */
  private async listModelscopeRepoFiles(repo: RepoDownloadSource): Promise<RepoFile[]> {
    const apiUrl = `https://modelscope.cn/api/v1/models/${repo.modelscopeRepo}/repo/files?Revision=master&Recursive=true`
    logger.system.info(`[ModelDownloader] 获取 ModelScope 仓库文件列表: ${repo.modelscopeRepo}`)

    const resp = await fetch(apiUrl, {
      headers: { 'User-Agent': 'AweeClaw/1.0' },
      signal: AbortSignal.timeout(30_000),
    })
    if (!resp.ok) {
      throw new Error(`ModelScope 仓库 API 失败: HTTP ${resp.status}`)
    }

    const json = (await resp.json()) as {
      Data?: { Files?: Array<{ Path: string; Size: number; Type?: string }> }
    }
    const items = json.Data?.Files || []

    return items
      .filter((f) => f.Type !== 'tree' && !this.isIgnoredRepoFile(f.Path, repo))
      .map((f) => ({
        path: f.Path,
        size: f.Size,
        url: `https://modelscope.cn/models/${repo.modelscopeRepo}/resolve/master/${f.Path}`,
      }))
  }

  /** 列出 HuggingFace 仓库文件（经 hf-mirror 镜像，国内可直连） */
  private async listHuggingFaceRepoFiles(repo: RepoDownloadSource): Promise<RepoFile[]> {
    const apiUrl = `https://hf-mirror.com/api/models/${repo.huggingfaceRepo}?blobs=true`
    logger.system.info(`[ModelDownloader] 获取 HuggingFace 仓库文件列表: ${repo.huggingfaceRepo}`)

    const resp = await fetch(apiUrl, {
      headers: { 'User-Agent': 'AweeClaw/1.0' },
      signal: AbortSignal.timeout(30_000),
    })
    if (!resp.ok) {
      throw new Error(`HuggingFace 仓库 API 失败: HTTP ${resp.status}`)
    }

    const json = (await resp.json()) as {
      siblings?: Array<{ rfilename: string; size?: number; lfs?: { size?: number } }>
    }
    const siblings = json.siblings || []

    return siblings
      .filter((s) => !this.isIgnoredRepoFile(s.rfilename, repo))
      .map((s) => ({
        path: s.rfilename,
        size: s.size ?? s.lfs?.size ?? 0,
        url: `https://hf-mirror.com/${repo.huggingfaceRepo}/resolve/main/${s.rfilename}`,
      }))
  }

  /** 判断是否为仓库中无需下载的文件（文档 / 图片 / 版本控制文件） */
  private isIgnoredRepoFile(filePath: string, repo: RepoDownloadSource): boolean {
    if (repo.excludeFiles?.includes(filePath)) return true

    const name = path.basename(filePath)
    if (name === '.gitattributes' || name.startsWith('LICENSE') || name === 'NOTICE') {
      return true
    }

    return IGNORED_REPO_EXTS.has(path.extname(name).toLowerCase())
  }

  /**
   * 执行多文件下载
   *
   * signal 必须一路透传：取消按钮依赖它中断正在进行的 HTTP 请求，
   * 否则「取消」只对下一个文件生效，当前文件仍会继续占用带宽。
   */
  private async executeMultiFileDownload(task: DownloadTask, signal?: AbortSignal): Promise<void> {
    const { metadata, targetDir, onProgress } = task

    if (!metadata.downloadItems || metadata.downloadItems.length === 0) {
      throw new Error('没有配置下载项')
    }

    const totalItems = metadata.downloadItems.length
    let completedItems = 0
    let totalDownloadedBytes = 0

    // 进度节流：大文件会产生上千次回调，统一经 emitter 限制推送频率
    const emitter = this.createProgressEmitter(onProgress, metadata.id, metadata.size)

    // 下载每个文件
    for (const item of metadata.downloadItems) {
      if (signal?.aborted) throw new DownloadCancelledError()

      const filePath = path.join(targetDir, item.filename)

      // 已存在且可信的文件直接复用：
      // 多文件清单中若后续文件失败（如词表 404），重试时不应重新拉取已完成的
      // 200MB+ 权重；下载失败清理逻辑保证了不会留下截断的残文件。
      const existingSize = this.getUsableExistingFileSize(filePath)
      if (existingSize > 0) {
        totalDownloadedBytes += existingSize
        completedItems++
        logger.system.info(
          `[ModelDownloader] 复用已存在文件: ${item.filename} (${(existingSize / 1024 / 1024).toFixed(1)} MB)`,
        )
        emitter.emit(
          totalDownloadedBytes,
          { currentFile: item.filename, fileIndex: completedItems, fileCount: totalItems },
          true,
        )
        continue
      }

      let lastDownloaded = 0

      await this.downloadFile(
        item.url,
        filePath,
        (downloaded, _total) => {
          totalDownloadedBytes += downloaded - lastDownloaded
          lastDownloaded = downloaded

          emitter.emit(totalDownloadedBytes, {
            currentFile: item.filename,
            fileIndex: completedItems + 1,
            fileCount: totalItems,
          })
        },
        undefined,
        signal,
      )

      // 校验文件
      if (item.checksum) {
        task.status = 'verifying'
        const isValid = await this.verifyFile(filePath, item.checksum, item.checksumType || 'md5')
        if (!isValid) {
          throw new Error(`文件 ${item.filename} 校验失败，下载可能不完整`)
        }
      }

      completedItems++
      // 每个文件结束后强制推送一次，避免节流吞掉末帧
      emitter.emit(
        totalDownloadedBytes,
        { currentFile: item.filename, fileIndex: completedItems, fileCount: totalItems },
        true,
      )
      logger.system.info(`[ModelDownloader] 文件下载完成: ${item.filename} (${completedItems}/${totalItems})`)
    }

    // 下载完成
    onProgress?.({
      modelId: metadata.id,
      downloaded: totalDownloadedBytes,
      total: metadata.size,
      percentage: 100,
      speed: 0,
      eta: 0,
      status: 'completed',
    })
  }

  /**
   * 获取已存在且可信文件的大小（字节）
   *
   * 小于 1KB 视为无效（空文件 / 错误页残留），返回 0 表示不可复用。
   */
  /**
   * 获取「可复用的断点续传文件」大小（字节），返回 0 表示必须重下
   *
   * 与 getUsableExistingFileSize 的区别：这里拿得到仓库声明的大小，
   * 就可以做严格比对——尺寸不一致的文件说明上次下载被截断，必须重下，
   * 否则会把半包文件当成「已下载完成」复用到模型目录里。
   * 平台未返回大小时（expectedSize <= 0）退化为「不小于 1KB 即可信」。
   */
  private getReusableFileSize(filePath: string, expectedSize: number): number {
    try {
      if (!fs.existsSync(filePath)) return 0
      const size = fs.statSync(filePath).size

      if (expectedSize > 0) return size === expectedSize ? size : 0
      return size >= 1024 ? size : 0
    } catch {
      return 0
    }
  }
  private getUsableExistingFileSize(filePath: string): number {
    try {
      if (!fs.existsSync(filePath)) return 0
      const size = fs.statSync(filePath).size
      return size >= 1024 ? size : 0
    } catch {
      return 0
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