/**
 * 本地嵌入推理子进程入口 — transformers 模型加载与推理在 utilityProcess 中执行
 *
 * 职责：
 * - 接收主进程派发的 embed / embedBatch / reset 请求
 * - 在子进程中加载 @xenova/transformers 模型（懒加载、常驻子进程内存）
 * - 模型下载进度回传主进程，由 LocalEmbedder 门面转发给订阅者
 *
 * 说明：作为 CJS 单独入口构建（embedder.worker.js），不进主 bundle；
 * transformers 相关依赖全部 external，由子进程从 node_modules 解析。
 */

import {
  configureTransformersEnv,
  type TransformersEnv,
} from '../transformersEnv'

if (!process.parentPort) {
  throw new Error('This file must be run as a utility process.')
}

/** 主进程 → 子进程消息 */
export type EmbedderRequest =
  | { id: number; kind: 'embed'; texts: string[] }
  | { id: number; kind: 'reset' }

/** 子进程 → 主进程消息 */
export type EmbedderResponse =
  | { id: number; ok: true; vectors: number[][] }
  | { id: number; ok: false; error: string }
  | { type: 'progress'; file: string; loaded: number; total: number; progress: number }

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

interface FeaturePipeline {
  (texts: string[], options?: { pooling?: 'mean' | 'max' | 'cls'; normalize?: boolean }): Promise<{
    data: Float32Array | number[][]
    dims: number[]
  }>
}

/** 子进程从环境变量获取缓存目录（主进程 fork 时注入，避免路径耦合） */
const CACHE_DIR = process.env.AWEECLAW_EMBEDDER_CACHE_DIR || ''
const MODEL_NAME = process.env.AWEECLAW_EMBEDDER_MODEL || 'Xenova/all-MiniLM-L6-v2'

let pipeline: FeaturePipeline | null = null
let loading: Promise<FeaturePipeline> | null = null

async function loadPipeline(): Promise<FeaturePipeline> {
  if (pipeline) return pipeline
  if (loading) return loading

  loading = (async () => {
    const transformers = (await import('@xenova/transformers')) as unknown as PipelineSingleton
    configureTransformersEnv(transformers.env, CACHE_DIR || undefined)
    const extractor = (await transformers.pipeline('feature-extraction', MODEL_NAME, {
      quantized: true,
      cache_dir: CACHE_DIR || undefined,
      progress_callback: (info: unknown) => {
        try {
          const data = info as Record<string, unknown>
          const status = data.status as string | undefined
          if (status !== 'progress' && status !== 'done') return
          const file = (data.file as string) ?? 'unknown'
          const loaded = status === 'progress' ? ((data.loaded as number) ?? 0) : 0
          const total = status === 'progress' ? ((data.total as number) ?? 0) : 0
          const progress = status === 'done' ? 1 : total > 0 ? loaded / total : 0
          process.parentPort!.postMessage({ type: 'progress', file, loaded, total, progress } satisfies EmbedderResponse)
        } catch {
          // 进度回传失败不影响下载
        }
      },
    })) as unknown as FeaturePipeline
    pipeline = extractor
    return extractor
  })()

  try {
    return await loading
  } finally {
    loading = null
  }
}

function toFloatArrays(data: Float32Array | number[][], batchSize: number): number[][] {
  if (Array.isArray(data)) {
    return data.map((row) => (Array.isArray(row) ? Array.from(row) : []))
  }
  const dim = data.length / batchSize
  const result: number[][] = []
  for (let i = 0; i < batchSize; i++) {
    result.push(Array.from(data.slice(i * dim, (i + 1) * dim)))
  }
  return result
}

process.parentPort.on('message', (e: Electron.MessageEvent) => {
  const req = e.data as EmbedderRequest

  if (req.kind === 'reset') {
    pipeline = null
    loading = null
    process.parentPort!.postMessage({ id: req.id, ok: true, vectors: [] } satisfies EmbedderResponse)
    return
  }

  loadPipeline()
    .then(async (extractor) => {
      const output = await extractor(req.texts, { pooling: 'mean', normalize: true })
      const vectors = toFloatArrays(output.data, req.texts.length)
      process.parentPort!.postMessage({ id: req.id, ok: true, vectors } satisfies EmbedderResponse)
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      process.parentPort!.postMessage({ id: req.id, ok: false, error: message } satisfies EmbedderResponse)
    })
})
