/**
 * 性能基线测试工具集 — 阶段9 s9-07
 *
 * 提供统一的性能测量与报告生成能力，供各模块基线测试复用：
 * - measure()：单次测量异步操作的耗时（ms）
 * - measureSync()：单次测量同步操作的耗时（ms）
 * - runBenchmark()：批量执行 N 次采样，输出 p50/p95/p99/mean/min/max/throughput
 * - BaselineReport：聚合多个基准测试结果，输出 JSON 报告
 *
 * 设计原则：
 * - 零依赖：仅依赖 vitest + Node 标准 API
 * - 可重现：固定迭代次数 + 预热阶段，降低 GC/系统抖动影响
 * - 结构化：所有结果以 JSON 输出，便于后续对比与回归检测
 * - 容错：单次测量异常不影响整体基准结果
 *
 * @module perception/__tests__/baseline/BaselineHarness
 */

import { writeFileSync, mkdirSync } from 'fs'
import { dirname, resolve } from 'path'

// ============================================================
// 类型定义
// ============================================================

/** 单次采样结果 */
export interface Sample {
  /** 耗时（ms） */
  durationMs: number
  /** 是否成功（未抛异常） */
  success: boolean
  /** 错误信息（失败时） */
  error?: string
}

/** 基准测试统计结果 */
export interface BenchmarkStats {
  /** 采样总数 */
  samples: number
  /** 成功次数 */
  successes: number
  /** 失败次数 */
  failures: number
  /** 平均耗时（ms） */
  meanMs: number
  /** 最小耗时（ms） */
  minMs: number
  /** 最大耗时（ms） */
  maxMs: number
  /** 中位数（p50，ms） */
  p50Ms: number
  /** p95 耗时（ms） */
  p95Ms: number
  /** p99 耗时（ms） */
  p99Ms: number
  /** 标准差（ms） */
  stdDevMs: number
  /** 吞吐量（ops/sec，仅成功次数） */
  throughputOpsPerSec: number
}

/** 单个基准测试结果 */
export interface BenchmarkResult {
  /** 基准测试名称 */
  name: string
  /** 模块名 */
  module: string
  /** 描述 */
  description: string
  /** 统计结果 */
  stats: BenchmarkStats
  /** 测量时间戳 */
  timestamp: string
  /** 运行环境信息 */
  environment: {
    nodeVersion: string
    platform: string
    arch: string
  }
}

/** 完整基线报告 */
export interface BaselineReportData {
  /** 报告生成时间 */
  generatedAt: string
  /** 报告版本 */
  version: string
  /** 阶段标识 */
  phase: string
  /** 所有基准测试结果 */
  results: BenchmarkResult[]
  /** 系统摘要 */
  summary: {
    totalBenchmarks: number
    allPassed: boolean
    failingBenchmarks: string[]
  }
}

// ============================================================
// 核心测量函数
// ============================================================

/**
 * 测量异步操作的单次耗时
 *
 * @param fn 待测量的异步函数
 * @returns 采样结果
 */
export async function measure<T>(fn: () => Promise<T>): Promise<{ sample: Sample; result?: T }> {
  const start = process.hrtime.bigint()
  try {
    const result = await fn()
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000
    return { sample: { durationMs, success: true }, result }
  } catch (e) {
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000
    return {
      sample: {
        durationMs,
        success: false,
        error: e instanceof Error ? e.message : String(e),
      },
    }
  }
}

/**
 * 测量同步操作的单次耗时
 *
 * @param fn 待测量的同步函数
 * @returns 采样结果
 */
export function measureSync<T>(fn: () => T): { sample: Sample; result?: T } {
  const start = process.hrtime.bigint()
  try {
    const result = fn()
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000
    return { sample: { durationMs, success: true }, result }
  } catch (e) {
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000
    return {
      sample: {
        durationMs,
        success: false,
        error: e instanceof Error ? e.message : String(e),
      },
    }
  }
}

/**
 * 批量执行基准测试
 *
 * 流程：
 * 1. 预热阶段（warmupIterations 次）：执行但不计入统计，触发 JIT 优化
 * 2. 正式采样阶段（iterations 次）：记录每次耗时
 * 3. 计算统计指标
 *
 * @param options 基准测试选项
 * @returns 统计结果
 */
export async function runBenchmark(options: {
  /** 待测函数 */
  fn: () => Promise<unknown> | unknown
  /** 正式采样次数（默认 100） */
  iterations?: number
  /** 预热次数（默认 10） */
  warmupIterations?: number
  /** 每次迭代间的延迟（ms，默认 0） */
  delayMs?: number
}): Promise<BenchmarkStats> {
  const iterations = options.iterations ?? 100
  const warmupIterations = options.warmupIterations ?? 10
  const delayMs = options.delayMs ?? 0

  // 预热阶段
  for (let i = 0; i < warmupIterations; i++) {
    try {
      await options.fn()
    } catch {
      // 预热异常忽略
    }
    if (delayMs > 0) await sleep(delayMs)
  }

  // 正式采样
  const samples: Sample[] = []
  for (let i = 0; i < iterations; i++) {
    const start = process.hrtime.bigint()
    let success = true
    let error: string | undefined
    try {
      await options.fn()
    } catch (e) {
      success = false
      error = e instanceof Error ? e.message : String(e)
    }
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000
    samples.push({ durationMs, success, error })
    if (delayMs > 0) await sleep(delayMs)
  }

  return computeStats(samples)
}

/**
 * 计算统计指标
 *
 * @param samples 采样数组
 * @returns 统计结果
 */
export function computeStats(samples: Sample[]): BenchmarkStats {
  const successSamples = samples.filter((s) => s.success)
  const durations = successSamples.map((s) => s.durationMs).sort((a, b) => a - b)

  const n = durations.length
  if (n === 0) {
    return {
      samples: samples.length,
      successes: 0,
      failures: samples.length,
      meanMs: 0,
      minMs: 0,
      maxMs: 0,
      p50Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
      stdDevMs: 0,
      throughputOpsPerSec: 0,
    }
  }

  const sum = durations.reduce((acc, d) => acc + d, 0)
  const mean = sum / n
  const variance = durations.reduce((acc, d) => acc + (d - mean) ** 2, 0) / n
  const stdDev = Math.sqrt(variance)

  return {
    samples: samples.length,
    successes: n,
    failures: samples.length - n,
    meanMs: round(mean, 4),
    minMs: round(durations[0], 4),
    maxMs: round(durations[n - 1], 4),
    p50Ms: round(percentile(durations, 0.5), 4),
    p95Ms: round(percentile(durations, 0.95), 4),
    p99Ms: round(percentile(durations, 0.99), 4),
    stdDevMs: round(stdDev, 4),
    throughputOpsPerSec: mean > 0 ? round(1000 / mean, 2) : 0,
  }
}

// ============================================================
// 基线报告生成器
// ============================================================

/**
 * 基线报告聚合器
 *
 * 收集多个基准测试结果，生成完整的 JSON 报告。
 */
export class BaselineReport {
  private results: BenchmarkResult[] = []
  private readonly phase: string
  private readonly version: string

  constructor(phase: string, version = '1.0.0') {
    this.phase = phase
    this.version = version
  }

  /**
   * 添加一个基准测试结果
   */
  addResult(result: Omit<BenchmarkResult, 'timestamp' | 'environment'>): void {
    this.results.push({
      ...result,
      timestamp: new Date().toISOString(),
      environment: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
      },
    })
  }

  /**
   * 生成完整报告数据
   */
  toJSON(): BaselineReportData {
    const failingBenchmarks = this.results
      .filter((r) => r.stats.failures > 0)
      .map((r) => r.name)

    return {
      generatedAt: new Date().toISOString(),
      version: this.version,
      phase: this.phase,
      results: this.results,
      summary: {
        totalBenchmarks: this.results.length,
        allPassed: failingBenchmarks.length === 0,
        failingBenchmarks,
      },
    }
  }

  /**
   * 写入 JSON 文件
   *
   * @param filePath 输出文件路径
   */
  writeToFile(filePath: string): void {
    const absolutePath = resolve(filePath)
    mkdirSync(dirname(absolutePath), { recursive: true })
    writeFileSync(absolutePath, JSON.stringify(this.toJSON(), null, 2), 'utf-8')
  }

  /**
   * 打印人类可读的摘要
   */
  printSummary(): void {
    const data = this.toJSON()
    console.log('\n========================================')
    console.log(`  性能基线报告 - ${data.phase}`)
    console.log('========================================')
    console.log(`生成时间: ${data.generatedAt}`)
    console.log(`基准总数: ${data.summary.totalBenchmarks}`)
    console.log(`全部通过: ${data.summary.allPassed ? '✅' : '❌'}`)
    if (!data.summary.allPassed) {
      console.log(`失败基准: ${data.summary.failingBenchmarks.join(', ')}`)
    }
    console.log('----------------------------------------')
    for (const r of data.results) {
      const status = r.stats.failures === 0 ? '✅' : '❌'
      console.log(
        `${status} [${r.module}] ${r.name}: ` +
          `p50=${r.stats.p50Ms}ms p95=${r.stats.p95Ms}ms p99=${r.stats.p99Ms}ms ` +
          `mean=${r.stats.meanMs}ms throughput=${r.stats.throughputOpsPerSec}ops/s`,
      )
    }
    console.log('========================================\n')
  }
}

// ============================================================
// 辅助函数
// ============================================================

/** 计算百分位数（输入需已排序） */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  if (sorted.length === 1) return sorted[0]
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))
  return sorted[idx]
}

/** 保留指定小数位数 */
function round(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/** 异步延迟 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
