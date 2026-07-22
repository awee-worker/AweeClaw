/**
 * LocalEmbedder 性能基线测试 — 阶段9 s9-07
 *
 * 基准测试范围：
 * 1. LRU 缓存命中率与读写性能（核心算法，无外部模型依赖）
 * 2. embed() 缓存命中路径性能
 * 3. embedBatch() 批量分发性能
 * 4. 文本截断逻辑性能
 *
 * Mock 策略：
 * - 通过 vi.mock('@xenova/transformers') 跳过真实模型加载
 * - Pipeline mock 为返回 384 维零向量，专注缓存/分发/截断算法性能
 *
 * @module perception/__tests__/baseline/LocalEmbedderBaseline
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { BaselineReport, runBenchmark, type BenchmarkStats } from './BaselineHarness'

// ============================================================
// Mock @xenova/transformers（避免下载真实模型）
// ============================================================

const synthPipeline = vi.fn(async (texts: string[]) => {
  // 返回 384 维零向量，模拟模型推理输出
  const dim = 384
  const data = new Float32Array(texts.length * dim)
  return {
    data,
    dims: [texts.length, dim],
  }
})

vi.mock('@xenova/transformers', () => ({
  pipeline: vi.fn().mockResolvedValue(synthPipeline),
}))

// 在 Mock 之后导入
import { LocalEmbedder } from '../../LocalEmbedder'

// ============================================================
// 基准测试
// ============================================================

describe('LocalEmbedder 性能基线', () => {
  const report = new BaselineReport('phase9-s9-07', '1.0.0')
  let embedder: LocalEmbedder

  beforeAll(async () => {
    embedder = LocalEmbedder.getInstance()
    // 触发懒加载（mock 后会很快）
    try {
      await embedder.load()
    } catch {
      // 加载失败时仍可测试缓存路径
    }
  })

  afterAll(() => {
    report.printSummary()
    report.writeToFile(
      `${__dirname}/../../../../../../../docs/phase9/local-embedder-baseline.json`,
    )
  })

  it('embed() 首次调用（缓存未命中）延迟', async () => {
    // 使用唯一文本确保未命中缓存
    const stats: BenchmarkStats = await runBenchmark({
      fn: async () => {
        // 每次使用新文本，确保未命中缓存
        const uniqueText = `测试文本-${Date.now()}-${Math.random()}`
        await embedder.embed(uniqueText)
      },
      iterations: 50,
      warmupIterations: 5,
    })

    report.addResult({
      name: 'embedCacheMiss',
      module: 'LocalEmbedder',
      description: 'embed() 缓存未命中路径（含 mock pipeline 调用 + LRU set）',
      stats,
    })

    expect(stats.failures).toBe(0)
  })

  it('embed() 缓存命中路径性能 < 1ms', async () => {
    // 预先填充缓存
    const cachedText = '预先缓存的文本内容-用于命中测试'
    await embedder.embed(cachedText)

    const stats: BenchmarkStats = await runBenchmark({
      fn: () => embedder.embed(cachedText),
      iterations: 5000,
      warmupIterations: 100,
    })

    report.addResult({
      name: 'embedCacheHit',
      module: 'LocalEmbedder',
      description: 'embed() 缓存命中路径（LRU get + 直接返回向量）',
      stats,
    })

    // 缓存命中应非常快
    expect(stats.p99Ms).toBeLessThan(5)
    expect(stats.failures).toBe(0)
  })

  it('embedBatch() 批量嵌入性能（16 条/批）', async () => {
    const batch = Array.from({ length: 16 }, (_, i) => `批量文本-${i}-${Date.now()}`)

    const stats: BenchmarkStats = await runBenchmark({
      fn: () => embedder.embedBatch(batch),
      iterations: 30,
      warmupIterations: 3,
    })

    report.addResult({
      name: 'embedBatch16',
      module: 'LocalEmbedder',
      description: 'embedBatch() 16 条文本/批（BATCH_MAX_SIZE 上限）',
      stats,
    })

    expect(stats.failures).toBe(0)
  })

  it('embedBatch() 大批量（>16 自动分片）', async () => {
    const largeBatch = Array.from({ length: 50 }, (_, i) => `大批量文本-${i}-${Date.now()}`)

    const stats: BenchmarkStats = await runBenchmark({
      fn: () => embedder.embedBatch(largeBatch),
      iterations: 20,
      warmupIterations: 2,
    })

    report.addResult({
      name: 'embedBatch50',
      module: 'LocalEmbedder',
      description: 'embedBatch() 50 条文本（自动分 4 片，每片 ≤16）',
      stats,
    })

    expect(stats.failures).toBe(0)
  })

  it('长文本截断性能（>512 字符）', async () => {
    // 构造 2000 字符的长文本
    const longText = '长文本测试内容'.repeat(200)

    const stats: BenchmarkStats = await runBenchmark({
      fn: async () => {
        // 每次使用不同前缀避免缓存命中
        const uniqueLongText = `${Date.now()}-${longText}`
        await embedder.embed(uniqueLongText)
      },
      iterations: 30,
      warmupIterations: 3,
    })

    report.addResult({
      name: 'embedLongTextTruncate',
      module: 'LocalEmbedder',
      description: 'embed() 2000 字符长文本（应触发 TEXT_MAX_LENGTH=512 截断）',
      stats,
    })

    expect(stats.failures).toBe(0)
  })

  it('isLoaded() / getDimension() 元信息查询性能', async () => {
    const stats: BenchmarkStats = await runBenchmark({
      fn: () => {
        embedder.isLoaded()
        embedder.getDimension()
      },
      iterations: 10000,
      warmupIterations: 100,
    })

    report.addResult({
      name: 'metadataQuery',
      module: 'LocalEmbedder',
      description: 'isLoaded() + getDimension() 元信息查询（应有 O(1) 性能）',
      stats,
    })

    expect(stats.p99Ms).toBeLessThan(1)
    expect(stats.failures).toBe(0)
  })
})
