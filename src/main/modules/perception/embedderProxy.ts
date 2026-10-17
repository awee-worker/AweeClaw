/**
 * 嵌入推理子进程代理 — 主进程侧薄封装（utilityProcess 隔离 + 原进程内联回退）
 *
 * 职责：
 * - 将 embed/embedBatch 请求派发给 embedder.worker 子进程，transformers 模型
 *   常驻子进程内存，主进程不再加载 onnxruntime/transformers
 * - 模型下载进度以消息流形式转发（回调注入，LocalEmbedder 据此驱动订阅者）
 * - 子进程不可用 / 崩溃时回退到主进程内联（动态 import，行为与旧实现一致）
 * - 空闲 10 分钟自动退出子进程，释放模型常驻内存
 * - 崩溃指数退避重启（上限 3 次），超限转内联回退模式
 *
 * 注意：回退路径会在主进程加载 transformers，仅作为子进程持续不可用时兜底。
 */

import { utilityProcess } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'
import * as path from 'path'

/** 子进程请求 */
interface EmbedderRequest {
  id: number
  kind: 'embed' | 'reset'
  texts?: string[]
}

/** 任务结果响应 */
interface EmbedderResult {
  id: number
  ok: boolean
  vectors: number[][]
  error?: string
}

/** 模型下载进度事件 */
interface EmbedderProgressEvent {
  type: 'progress'
  file: string
  loaded: number
  total: number
  progress: number
}

/** 进度回调参数 */
interface ProgressPayload {
  file: string
  loaded: number
  total: number
  progress: number
}

/** 单任务超时（模型首次加载需下载约 22MB，给足余量） */
const TASK_TIMEOUT_MS = 180_000

/** 空闲自动退出阈值（模型常驻内存约 50MB，长期不用时释放） */
const IDLE_EXIT_MS = 10 * 60_000

const MAX_RESTARTS = 3

interface PendingTask {
  resolve: (res: EmbedderResult) => void
  timer: NodeJS.Timeout
}

class EmbedderProxyImpl {
  private child: Electron.UtilityProcess | null = null
  private pending = new Map<number, PendingTask>()
  private nextId = 1
  private idleTimer: NodeJS.Timeout | null = null
  private restarts = 0
  private spawnFailed = false
  private progressCallback: ((p: ProgressPayload) => void) | null = null
  private cacheDir = ''
  private modelName = ''
  /** 内联回退的 pipeline（保持与旧实现等价的降级路径） */
  private inlinePipeline: ((texts: string[]) => Promise<number[][]>) | null = null

  /** 注入模型配置（fork 前必须调用一次） */
  configure(cacheDir: string, modelName: string): void {
    this.cacheDir = cacheDir
    this.modelName = modelName
  }

  /** 订阅子进程上报的模型下载进度 */
  onProgress(cb: (p: ProgressPayload) => void): void {
    this.progressCallback = cb
  }

  /** 批量嵌入（单条文本等价于 embed）；空批仅探测子进程可 fork，不触发模型加载 */
  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      this.ensureChild()
      return []
    }
    const child = this.ensureChild()
    if (!child) return this.inlineEmbed(texts)
    return new Promise<number[][]>((resolve) => {
      const id = this.nextId++
      const timer = setTimeout(() => {
        this.pending.delete(id)
        logger.system.warn(`[EmbedderProxy] task ${id} timeout, fallback to inline`)
        this.inlineEmbed(texts).then(resolve)
      }, TASK_TIMEOUT_MS)
      this.pending.set(id, { resolve: (res) => resolve(res.ok ? res.vectors : []), timer })
      child.postMessage({ id, kind: 'embed', texts } satisfies EmbedderRequest)
    })
  }

  /** 重置子进程中的模型状态（磁盘缓存清理后调用） */
  async resetWorker(): Promise<void> {
    this.killIdle()
    if (this.child) {
      const child = this.child
      await new Promise<void>((resolve) => {
        const id = this.nextId++
        const timer = setTimeout(() => { this.pending.delete(id); resolve() }, 5_000)
        this.pending.set(id, { resolve: () => resolve(), timer })
        child.postMessage({ id, kind: 'reset' } satisfies EmbedderRequest)
      })
    }
    this.inlinePipeline = null
  }

  /** 内联回退：主进程动态 import transformers（与旧实现等价） */
  private async inlineEmbed(texts: string[]): Promise<number[][]> {
    try {
      if (!this.inlinePipeline) {
        const { configureTransformersEnv } = await import('../transformersEnv')
        const transformers = (await import('@xenova/transformers')) as any
        configureTransformersEnv(transformers.env, this.cacheDir || undefined)
        const extractor = await transformers.pipeline('feature-extraction', this.modelName || 'Xenova/all-MiniLM-L6-v2', {
          quantized: true,
          cache_dir: this.cacheDir || undefined,
          progress_callback: (info: unknown) => {
            const data = info as Record<string, unknown>
            if (data.status !== 'progress' && data.status !== 'done') return
            const file = (data.file as string) ?? 'unknown'
            const loaded = data.status === 'progress' ? ((data.loaded as number) ?? 0) : 0
            const total = data.status === 'progress' ? ((data.total as number) ?? 0) : 0
            const progress = data.status === 'done' ? 1 : total > 0 ? loaded / total : 0
            this.progressCallback?.({ file, loaded, total, progress })
          },
        })
        this.inlinePipeline = async (input: string[]) => {
          const out = await extractor(input, { pooling: 'mean', normalize: true })
          const data = out.data as Float32Array | number[][]
          if (Array.isArray(data)) return data.map((r) => (Array.isArray(r) ? Array.from(r) : []))
          const dim = data.length / input.length
          return Array.from({ length: input.length }, (_, i) =>
            Array.from(data.slice(i * dim, (i + 1) * dim)),
          )
        }
      }
      return this.inlinePipeline(texts)
    } catch (e) {
      logger.perception?.warn('[EmbedderProxy] inline fallback embed failed:', e)
      return texts.map(() => [])
    }
  }

  private ensureChild(): Electron.UtilityProcess | null {
    if (this.spawnFailed) return null
    if (this.child) return this.child

    try {
      const workerPath = path.join(__dirname, 'embedder.worker.js')
      this.child = utilityProcess.fork(workerPath, [], {
        stdio: 'pipe',
        env: {
          ...process.env,
          AWEECLAW_EMBEDDER_CACHE_DIR: this.cacheDir,
          AWEECLAW_EMBEDDER_MODEL: this.modelName,
        },
      })

      this.child.on('message', (raw: EmbedderResult | EmbedderProgressEvent) => {
        if ('type' in raw && raw.type === 'progress') {
          this.progressCallback?.(raw)
          return
        }
        const res = raw as EmbedderResult
        const task = this.pending.get(res.id)
        if (task) {
          this.pending.delete(res.id)
          clearTimeout(task.timer)
          task.resolve(res)
        }
        this.scheduleIdleExit()
      })

      this.child.on('exit', (code) => {
        this.failPending(`worker exited (code=${code})`)
        this.child = null
        if (this.pending.size === 0 && code === 0) {
          this.restarts = 0
          return
        }
        if (this.restarts < MAX_RESTARTS) {
          this.restarts++
          const delay = Math.min(1000 * 2 ** (this.restarts - 1), 8000)
          logger.system.warn(`[EmbedderProxy] worker crashed (code=${code}), restart #${this.restarts} in ${delay}ms`)
          setTimeout(() => { this.ensureChild() }, delay)
        } else {
          logger.system.warn('[EmbedderProxy] restart limit reached, stay in inline fallback mode')
          this.spawnFailed = true
        }
      })

      this.restarts = 0
      return this.child
    } catch (err) {
      logger.system.warn('[EmbedderProxy] fork failed, fallback to inline:', err)
      this.spawnFailed = true
      return null
    }
  }

  private scheduleIdleExit(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => this.killIdle(), IDLE_EXIT_MS)
    this.idleTimer.unref?.()
  }

  private killIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
    if (this.child && this.pending.size === 0) {
      this.child.kill()
      this.child = null
    }
  }

  /** 子进程异常退出时，等待中的任务以空向量结束（上层 LocalEmbedder 的失败语义兜底） */
  private failPending(reason: string): void {
    if (this.pending.size === 0) return
    logger.system.warn(`[EmbedderProxy] ${reason}, ${this.pending.size} pending task(s) resolve as empty`)
    for (const [id, task] of this.pending) {
      this.pending.delete(id)
      clearTimeout(task.timer)
      task.resolve({ id, ok: true, vectors: [] })
    }
  }

  dispose(): void {
    this.killIdle()
    this.pending.clear()
    this.progressCallback = null
  }
}

export const embedderProxy = new EmbedderProxyImpl()
