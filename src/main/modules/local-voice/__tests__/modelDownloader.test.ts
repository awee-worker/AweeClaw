/**
 * ModelDownloader 单元测试
 *
 * 覆盖三类真实故障：
 * 1. 平台错误页以 HTTP 200 返回，被当成模型文件落盘（「下载成功」判定失真）
 * 2. 半包 / 截断文件被复用，重试时不再补齐（模型加载才报错，且难定位）
 * 3. 取消按钮只对「下一个文件」生效，当前文件仍继续占用带宽
 *
 * 全部通过 mock fetch + 临时目录完成，不产生真实网络请求。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

vi.mock('@shared/toolkit/LogEngine', () => ({
  logger: {
    system: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    ipc: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  },
}))

import {
  ModelDownloader,
  DownloadCancelledError,
  type DownloadProgress,
  type DownloadTask,
  type ModelMetadata,
} from '../ModelDownloader'
import type { LocalVoiceConfig } from '../LocalVoiceStore'

/** 最小可用配置：构造器只读取 maxConcurrentDownloads */
const CONFIG = { maxConcurrentDownloads: 2, modelDownloadDir: '' } as unknown as LocalVoiceConfig

// ------------------------------------------------------------------
// fetch 打桩
// ------------------------------------------------------------------

interface RouteResult {
  body?: string | Buffer
  json?: unknown
  status?: number
  contentType?: string
  /** 覆盖 content-length（用于模拟服务端声明大小与实际不一致） */
  contentLength?: number
}

type Route = [needle: string, handler: (url: string) => RouteResult]

/** 构造 fetch Response 的最小替身：只需 ok / status / headers.get / body.getReader / json */
function makeResponse(result: RouteResult): Record<string, unknown> {
  const buffer = Buffer.isBuffer(result.body)
    ? result.body
    : Buffer.from(result.body ?? '', 'utf8')
  const status = result.status ?? 200
  let consumed = false

  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: {
      get: (key: string): string | null => {
        const name = key.toLowerCase()
        if (name === 'content-type') return result.contentType ?? 'application/octet-stream'
        if (name === 'content-length') {
          return String(result.contentLength ?? buffer.length)
        }
        return null
      },
    },
    body: {
      getReader: () => ({
        read: async (): Promise<{ done: boolean; value?: Uint8Array }> => {
          if (consumed) return { done: true }
          consumed = true
          return { done: false, value: new Uint8Array(buffer) }
        },
        releaseLock: () => undefined,
      }),
    },
    json: async (): Promise<unknown> =>
      result.json ?? JSON.parse(buffer.toString('utf8')),
  }
}

function installFetch(routes: Route[]): { calls: string[] } {
  const calls: string[] = []
  const mock = vi.fn(async (input: unknown) => {
    const url = String(input)
    calls.push(url)

    const matched = routes.find(([needle]) => url.includes(needle))
    if (!matched) {
      return makeResponse({ body: 'not found', status: 404, contentType: 'text/plain' })
    }
    return makeResponse(matched[1](url))
  })

  vi.stubGlobal('fetch', mock)
  return { calls }
}

/** 构造元数据（字段按需覆盖，避免每个用例写全量） */
function metadata(partial: Partial<ModelMetadata>): ModelMetadata {
  return {
    id: 'test-model',
    name: 'Test',
    type: 'asr',
    version: '1.0.0',
    description: '',
    size: 0,
    needExtract: false,
    ...partial,
  }
}

function createTask(meta: ModelMetadata, targetDir: string, onProgress?: (p: DownloadProgress) => void): DownloadTask {
  return { metadata: meta, targetDir, onProgress, status: 'downloading' }
}

describe('ModelDownloader', () => {
  let tmpRoot: string
  let downloader: any

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aweeclaw-dl-'))
    downloader = new ModelDownloader(CONFIG)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  // ----------------------------------------------------------------
  // 断点续传：可复用文件判定
  // ----------------------------------------------------------------
  describe('getReusableFileSize（仓库下载的断点续传判定）', () => {
    it('体积与仓库声明一致时可复用', () => {
      const file = path.join(tmpRoot, 'model.onnx')
      fs.writeFileSync(file, Buffer.alloc(4096, 1))

      expect(downloader.getReusableFileSize(file, 4096)).toBe(4096)
    })

    it('体积不一致（上次被截断）时判定为不可复用', () => {
      const file = path.join(tmpRoot, 'model.onnx')
      // 上一次下载到一半就被中断：必须重下，否则模型永远加载失败
      fs.writeFileSync(file, Buffer.alloc(1024, 1))

      expect(downloader.getReusableFileSize(file, 4096)).toBe(0)
    })

    it('仓库未返回大小时退化为「不小于 1KB 即可信」', () => {
      const big = path.join(tmpRoot, 'tokens.txt')
      fs.writeFileSync(big, Buffer.alloc(2048, 1))
      const tiny = path.join(tmpRoot, 'stub.bin')
      fs.writeFileSync(tiny, Buffer.from('x'))

      expect(downloader.getReusableFileSize(big, 0)).toBe(2048)
      expect(downloader.getReusableFileSize(tiny, 0)).toBe(0)
    })

    it('文件不存在时返回 0', () => {
      expect(downloader.getReusableFileSize(path.join(tmpRoot, 'nope.bin'), 100)).toBe(0)
    })
  })

  // ----------------------------------------------------------------
  // 仓库文件过滤
  // ----------------------------------------------------------------
  describe('isIgnoredRepoFile', () => {
    const repo = { dirName: 'moss', modelscopeRepo: 'ns/m', huggingfaceRepo: 'ns/m' }

    it('文档 / 图片 / 压缩包 / 版本控制文件不下载', () => {
      for (const name of [
        'README.md',
        'LICENSE',
        'LICENSE.txt',
        'NOTICE',
        '.gitattributes',
        'assets/logo.png',
        'docs/paper.pdf',
        'weights.zip',
      ]) {
        expect(downloader.isIgnoredRepoFile(name, repo), name).toBe(true)
      }
    })

    it('模型权重与词表必须下载', () => {
      for (const name of [
        'model.onnx',
        'tokens.txt',
        'config.json',
        'moss_tts_shared_0.data',
        'sub/model.int8.onnx',
      ]) {
        expect(downloader.isIgnoredRepoFile(name, repo), name).toBe(false)
      }
    })

    it('支持仓库级 excludeFiles 额外排除', () => {
      const withExclude = { ...repo, excludeFiles: ['spk_dict.pt'] }
      expect(downloader.isIgnoredRepoFile('spk_dict.pt', withExclude)).toBe(true)
      expect(downloader.isIgnoredRepoFile('model.onnx', withExclude)).toBe(false)
    })
  })

  // ----------------------------------------------------------------
  // 进度节流
  // ----------------------------------------------------------------
  describe('createProgressEmitter', () => {
    it('高频回调被节流，百分比跃升与强制推送仍会发出', () => {
      const emitted: DownloadProgress[] = []
      const emitter = downloader.createProgressEmitter(
        (progress: DownloadProgress) => emitted.push(progress),
        'test-model',
        1000,
      )

      emitter.emit(1)
      emitter.emit(2) // 200ms 内且百分比几乎没变 → 丢弃
      emitter.emit(500) // 百分比跃升 → 发出
      emitter.emit(1000, undefined, true) // 强制末帧 → 发出

      expect(emitted).toHaveLength(3)
      expect(emitted[0].percentage).toBeCloseTo(0.1, 1)
      expect(emitted[1].percentage).toBe(50)
    })

    it('下载中的百分比封顶 99.9，避免「到点没完成」的观感问题', () => {
      const emitted: DownloadProgress[] = []
      const emitter = downloader.createProgressEmitter(
        (progress: DownloadProgress) => emitted.push(progress),
        'test-model',
        100,
      )

      emitter.emit(100, undefined, true)
      expect(emitted[0].percentage).toBe(99.9)
    })
  })

  // ----------------------------------------------------------------
  // 多文件清单下载
  // ----------------------------------------------------------------
  describe('executeMultiFileDownload', () => {
    const items = [
      { url: 'https://files.test.invalid/a.onnx', filename: 'a.onnx' },
      { url: 'https://files.test.invalid/b.onnx', filename: 'b.onnx' },
    ]

    it('逐文件下载、聚合进度并写出完整文件', async () => {
      const bodies: Record<string, Buffer> = {
        'a.onnx': Buffer.alloc(2048, 1),
        'b.onnx': Buffer.alloc(1536, 2),
      }
      installFetch([
        ['files.test.invalid/', (url) => ({ body: bodies[url.split('/').pop()!] })],
      ])

      const progress: DownloadProgress[] = []
      const task = createTask(
        metadata({ size: 3584, downloadItems: items }),
        tmpRoot,
        (p) => progress.push(p),
      )

      await downloader.executeMultiFileDownload(task)

      expect(fs.statSync(path.join(tmpRoot, 'a.onnx')).size).toBe(2048)
      expect(fs.statSync(path.join(tmpRoot, 'b.onnx')).size).toBe(1536)
      expect(progress.at(-1)).toMatchObject({
        status: 'completed',
        percentage: 100,
        downloaded: 3584,
        total: 3584,
      })
    })

    it('已存在的完整文件被复用，不再产生网络请求（重试不烧流量）', async () => {
      fs.writeFileSync(path.join(tmpRoot, 'a.onnx'), Buffer.alloc(2048, 1))

      const { calls } = installFetch([
        ['files.test.invalid/', () => ({ body: Buffer.alloc(1536, 2) })],
      ])

      await downloader.executeMultiFileDownload(
        createTask(metadata({ size: 3584, downloadItems: items }), tmpRoot),
      )

      expect(calls).toHaveLength(1)
      expect(calls[0]).toContain('b.onnx')
      expect(fs.statSync(path.join(tmpRoot, 'b.onnx')).size).toBe(1536)
    })

    it('错误页（200 + HTML）被拦截，不落盘且清理 .part', async () => {
      installFetch([
        [
          'files.test.invalid/',
          () => ({ body: '<html><body>404 Not Found</body></html>', contentType: 'text/html' }),
        ],
      ])

      await expect(
        downloader.executeMultiFileDownload(
          createTask(metadata({ size: 100, downloadItems: items }), tmpRoot),
        ),
      ).rejects.toThrow(/不是有效文件/)

      expect(fs.existsSync(path.join(tmpRoot, 'a.onnx'))).toBe(false)
      expect(fs.existsSync(path.join(tmpRoot, 'a.onnx.part'))).toBe(false)
    })

    it('下载前已取消：立即抛 DownloadCancelledError，不发起请求', async () => {
      const { calls } = installFetch([['files.test.invalid/', () => ({ body: 'x' })]])
      const controller = new AbortController()
      controller.abort()

      await expect(
        downloader.executeMultiFileDownload(
          createTask(metadata({ size: 10, downloadItems: items }), tmpRoot),
          controller.signal,
        ),
      ).rejects.toBeInstanceOf(DownloadCancelledError)

      expect(calls).toHaveLength(0)
    })

    it('下载中取消：抛出取消错误并清理临时文件', async () => {
      const controller = new AbortController()
      installFetch([
        [
          'files.test.invalid/',
          () => {
            controller.abort() // 模拟用户在下载过程中点击取消
            const err = new Error('aborted')
            err.name = 'AbortError'
            throw err
          },
        ],
      ])

      await expect(
        downloader.executeMultiFileDownload(
          createTask(metadata({ size: 10, downloadItems: items }), tmpRoot),
          controller.signal,
        ),
      ).rejects.toBeInstanceOf(DownloadCancelledError)

      expect(fs.existsSync(path.join(tmpRoot, 'a.onnx.part'))).toBe(false)
    })
  })

  // ----------------------------------------------------------------
  // 仓库快照下载
  // ----------------------------------------------------------------
  describe('executeRepoDownload', () => {
    const repo = {
      dirName: 'sensevoice',
      modelscopeRepo: 'ns/sense-voice',
      huggingfaceRepo: 'ns/sense-voice',
    }

    /** 仓库内文件 + 真实字节；同时打桩「列文件」与「CDN 解析」两个 API */
    function installRepoFetch(
      files: Array<{ Path: string; Size: number }>,
      bodies: Record<string, Buffer>,
      options: { listStatus?: number } = {},
    ): { calls: string[] } {
      return installFetch([
        [
          'modelscope.cn/api/v1/models/ns/sense-voice/repo/files',
          () =>
            options.listStatus
              ? { body: 'oops', status: options.listStatus, contentType: 'text/plain' }
              : { json: { Data: { Files: files.map((f) => ({ ...f, Type: 'blob' })) } } },
        ],
        [
          'modelscope.cn/api/v1/models/ns/sense-voice/repo?',
          (url) => {
            const matched = /FilePath=([^&]+)/.exec(url)
            const filePath = matched ? decodeURIComponent(matched[1]) : ''
            return {
              json: { Code: 200, Data: { DownloadUrl: `https://cdn.test.invalid/${filePath}` } },
            }
          },
        ],
        ['cdn.test.invalid/', (url) => ({ body: bodies[url.split('/').pop()!] })],
      ])
    }

    it('按仓库清单下载，跳过文档类文件，进度按真实字节汇总', async () => {
      const bodies = {
        'model.onnx': Buffer.alloc(4096, 1),
        'tokens.txt': Buffer.from('<unk> 0\n'),
      }
      const { calls } = installRepoFetch(
        [
          { Path: 'README.md', Size: 100 },
          { Path: 'model.onnx', Size: 4096 },
          { Path: 'tokens.txt', Size: 8 },
        ],
        bodies,
      )

      const progress: DownloadProgress[] = []
      await downloader.executeRepoDownload(
        createTask(
          metadata({ size: 4204, repos: [repo] }),
          tmpRoot,
          (p: DownloadProgress) => progress.push(p),
        ),
      )

      expect(fs.statSync(path.join(tmpRoot, 'sensevoice', 'model.onnx')).size).toBe(4096)
      expect(fs.statSync(path.join(tmpRoot, 'sensevoice', 'tokens.txt')).size).toBe(8)
      expect(calls.some((u) => u.includes('README.md'))).toBe(false)
      expect(progress.at(-1)).toMatchObject({
        status: 'completed',
        percentage: 100,
        fileCount: 2,
      })
    })

    it('体积吻合的已存在文件被复用；被截断的文件强制重下', async () => {
      const dir = path.join(tmpRoot, 'sensevoice')
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'model.onnx'), Buffer.alloc(4096, 9)) // 完整 → 复用
      fs.writeFileSync(path.join(dir, 'tokens.txt'), Buffer.alloc(3, 9)) // 截断 → 重下

      const { calls } = installRepoFetch(
        [
          { Path: 'model.onnx', Size: 4096 },
          { Path: 'tokens.txt', Size: 8 },
        ],
        { 'model.onnx': Buffer.alloc(4096, 1), 'tokens.txt': Buffer.from('<unk> 0\n') },
      )

      await downloader.executeRepoDownload(
        createTask(metadata({ size: 4104, repos: [repo] }), tmpRoot),
      )

      // model.onnx 未被重新请求（只有 tokens.txt 走了 CDN）
      const cdnCalls = calls.filter((u) => u.includes('cdn.test.invalid/'))
      expect(cdnCalls).toHaveLength(1)
      expect(cdnCalls[0]).toContain('tokens.txt')
      expect(fs.statSync(path.join(dir, 'tokens.txt')).size).toBe(8)
    })

    it('单个文件返回错误页时整体失败，不留半包文件', async () => {
      installRepoFetch(
        [{ Path: 'model.onnx', Size: 4096 }],
        { 'model.onnx': Buffer.from('<html><body>Access denied</body></html>') },
      )

      await expect(
        downloader.executeRepoDownload(createTask(metadata({ size: 4096, repos: [repo] }), tmpRoot)),
      ).rejects.toThrow(/不是有效文件/)

      expect(fs.existsSync(path.join(tmpRoot, 'sensevoice', 'model.onnx'))).toBe(false)
    })

    it('文件字节数与仓库声明不符时判定为截断并失败', async () => {
      installRepoFetch(
        [{ Path: 'model.onnx', Size: 4096 }],
        { 'model.onnx': Buffer.alloc(2048, 1) },
      )

      await expect(
        downloader.executeRepoDownload(createTask(metadata({ size: 4096, repos: [repo] }), tmpRoot)),
      ).rejects.toThrow(/文件大小不符/)
    })

    it('ModelScope 文件清单失败时自动回退 HuggingFace 镜像', async () => {
      const { calls } = installFetch([
        [
          'modelscope.cn/api/v1/models/ns/sense-voice/repo/files',
          () => ({ body: 'boom', status: 500, contentType: 'text/plain' }),
        ],
        [
          'hf-mirror.com/api/models/ns/sense-voice',
          () => ({ json: { siblings: [{ rfilename: 'model.onnx', size: 4096 }] } }),
        ],
        ['hf-mirror.com/ns/sense-voice/resolve/main/', () => ({ body: Buffer.alloc(4096, 7) })],
      ])

      await downloader.executeRepoDownload(
        createTask(metadata({ size: 4096, repos: [repo] }), tmpRoot),
      )

      expect(fs.statSync(path.join(tmpRoot, 'sensevoice', 'model.onnx')).size).toBe(4096)
      expect(calls.some((u) => u.includes('hf-mirror.com/api/models/'))).toBe(true)
    })

    it('两个源的清单都拿不到时给出可诊断错误', async () => {
      installFetch([
        ['modelscope.cn/api/v1/models/', () => ({ body: 'boom', status: 500 })],
        ['hf-mirror.com/api/models/', () => ({ body: 'boom', status: 503 })],
      ])

      await expect(
        downloader.executeRepoDownload(createTask(metadata({ size: 1, repos: [repo] }), tmpRoot)),
      ).rejects.toThrow(/无法获取仓库文件清单/)
    })

    it('仓库内没有任何可下载文件时失败（避免「假装下载成功」）', async () => {
      installFetch([
        ['modelscope.cn/api/v1/models/', () => ({ json: { Data: { Files: [] } } })],
        ['hf-mirror.com/api/models/', () => ({ json: { siblings: [] } })],
      ])

      await expect(
        downloader.executeRepoDownload(createTask(metadata({ size: 1, repos: [repo] }), tmpRoot)),
      ).rejects.toThrow(/无法获取仓库文件清单/)
    })
  })
})
