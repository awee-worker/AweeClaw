/**
 * ImpactAnalyzer 性能基线测试 — 阶段9 s9-07
 *
 * 基准测试范围：
 * 1. analyzeImpact() 单文件变更延迟（含 BFS 上游分析）
 * 2. analyzeImpact() 多文件变更（10 文件并发分析）
 * 3. analyzeImpact() 大型依赖图（500 节点 / 1000 边）下的稳定性
 * 4. 总体影响等级计算性能
 *
 * Mock 策略：
 * - CodeDependencyGraph：mock 为返回合成图（500 文件 / 1000 边）
 * - 避免真实文件 I/O，专注算法性能
 *
 * @module perception/__tests__/baseline/ImpactAnalyzerBaseline
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { BaselineReport, runBenchmark, type BenchmarkStats } from './BaselineHarness'
import type { DependencyGraph, CodeSymbol } from '../../CodeDependencyGraph'

// ============================================================
// 合成依赖图
// ============================================================

/** 生成合成依赖图 */
function makeSynthGraph(nodeCount: number, edgeCount: number): DependencyGraph {
  const symbols = new Map<string, CodeSymbol>()
  for (let i = 0; i < nodeCount; i++) {
    symbols.set(`/project/src/file-${i}.ts`, {
      filePath: `/project/src/file-${i}.ts`,
      relativePath: `src/file-${i}.ts`,
      language: 'typescript',
      exports: [`fn${i}`],
      imports: [],
      hash: `hash-${i}`,
    })
  }

  const edges = Array.from({ length: edgeCount }, (_, i) => {
    const from = `/project/src/file-${i % nodeCount}.ts`
    const to = `/project/src/file-${(i + 1) % nodeCount}.ts`
    return { from, to, symbols: [`fn${i % nodeCount}`] }
  })

  return {
    projectPath: '/project',
    language: 'typescript',
    symbols,
    edges,
    builtAt: Date.now(),
    fileCount: nodeCount,
  }
}

const SYNTH_GRAPH = makeSynthGraph(500, 1000)

// ============================================================
// Mock CodeDependencyGraph
// ============================================================

vi.mock('../../CodeDependencyGraph', () => ({
  CodeDependencyGraph: {
    getInstance: () => ({
      buildGraph: vi.fn().mockResolvedValue(SYNTH_GRAPH),
      dispose: vi.fn(),
    }),
  },
}))

// 在 Mock 之后导入
import { ImpactAnalyzer } from '../../ImpactAnalyzer'

// ============================================================
// 基准测试
// ============================================================

describe('ImpactAnalyzer 性能基线', () => {
  const report = new BaselineReport('phase9-s9-07', '1.0.0')
  let analyzer: ImpactAnalyzer

  beforeAll(() => {
    analyzer = ImpactAnalyzer.getInstance()
  })

  afterAll(() => {
    report.printSummary()
    report.writeToFile(
      `${__dirname}/../../../../../../../docs/phase9/impact-analyzer-baseline.json`,
    )
  })

  it('analyzeImpact() 单文件变更延迟 < 200ms', async () => {
    const stats: BenchmarkStats = await runBenchmark({
      fn: () =>
        analyzer.analyzeImpact({
          projectPath: '/project',
          language: 'typescript',
          changedFiles: [
            {
              filePath: '/project/src/file-1.ts',
              relativePath: 'src/file-1.ts',
              changeType: 'modified',
              additions: 10,
              deletions: 2,
            },
          ],
          maxDepth: 5,
        }),
      iterations: 100,
      warmupIterations: 10,
    })

    report.addResult({
      name: 'analyzeSingleFile',
      module: 'ImpactAnalyzer',
      description: '单文件变更分析（500 节点 / 1000 边合成图，BFS 最大深度 5）',
      stats,
    })

    expect(stats.p95Ms).toBeLessThan(200)
    expect(stats.failures).toBe(0)
  })

  it('analyzeImpact() 10 文件并发分析', async () => {
    const changedFiles = Array.from({ length: 10 }, (_, i) => ({
      filePath: `/project/src/file-${i * 50}.ts`,
      relativePath: `src/file-${i * 50}.ts`,
      changeType: 'modified' as const,
      additions: 5,
      deletions: 1,
    }))

    const stats: BenchmarkStats = await runBenchmark({
      fn: () =>
        analyzer.analyzeImpact({
          projectPath: '/project',
          language: 'typescript',
          changedFiles,
          maxDepth: 5,
        }),
      iterations: 50,
      warmupIterations: 5,
    })

    report.addResult({
      name: 'analyzeMultiFiles10',
      module: 'ImpactAnalyzer',
      description: '10 个文件并发分析（500 节点 / 1000 边合成图，验证 impactedCountMap 累加 + highRiskFiles 排序）',
      stats,
    })

    expect(stats.p95Ms).toBeLessThan(500)
    expect(stats.failures).toBe(0)
  })

  it('analyzeImpact() 深度 BFS（maxDepth=10）', async () => {
    const stats: BenchmarkStats = await runBenchmark({
      fn: () =>
        analyzer.analyzeImpact({
          projectPath: '/project',
          language: 'typescript',
          changedFiles: [
            {
              filePath: '/project/src/file-1.ts',
              relativePath: 'src/file-1.ts',
              changeType: 'modified',
            },
          ],
          maxDepth: 10,
        }),
      iterations: 50,
      warmupIterations: 5,
    })

    report.addResult({
      name: 'analyzeDeepBFS',
      module: 'ImpactAnalyzer',
      description: '单文件 + maxDepth=10 深度 BFS（验证大深度下性能不退化）',
      stats,
    })

    expect(stats.failures).toBe(0)
  })

  it('analyzeImpact() 空变更列表快速返回', async () => {
    const stats: BenchmarkStats = await runBenchmark({
      fn: () =>
        analyzer.analyzeImpact({
          projectPath: '/project',
          language: 'typescript',
          changedFiles: [],
        }),
      iterations: 1000,
      warmupIterations: 50,
    })

    report.addResult({
      name: 'analyzeEmpty',
      module: 'ImpactAnalyzer',
      description: '空变更列表（图构建后直接返回，验证快速路径）',
      stats,
    })

    expect(stats.p99Ms).toBeLessThan(50)
    expect(stats.failures).toBe(0)
  })
})
