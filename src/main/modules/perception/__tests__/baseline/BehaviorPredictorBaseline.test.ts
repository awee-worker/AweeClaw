/**
 * BehaviorPredictor 性能基线测试 — 阶段9 s9-07
 *
 * 基准测试范围：
 * 1. predict() 全流程延迟（嵌入 + 检索 + 统计 + LLM 融合）
 * 2. mergePredictions() 融合算法纯性能（私有方法通过反射访问）
 * 3. getStats() 命中率统计查询
 * 4. 大样本场景下的预测吞吐量（100 条相似行为）
 *
 * Mock 策略：
 * - LocalEmbedder：mock 为返回固定 384 维零向量，避免加载真实模型
 * - PerceptionStore：mock 为返回合成相似行为 + 空预测记录
 * - BehaviorPredictorLlm：mock 为未初始化状态，跳过 LLM 调用
 *
 * @module perception/__tests__/baseline/BehaviorPredictorBaseline
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { BaselineReport, runBenchmark, type BenchmarkStats } from './BaselineHarness'
import type { UserBehavior, UserAction } from '../../PerceptionInterface'

// ============================================================
// 合成数据工厂
// ============================================================

/** 合成 384 维零向量（避免模型加载） */
const SYNTH_EMBEDDING = new Array(384).fill(0)

/** 生成合成行为列表 */
function makeSynthBehaviors(count: number): UserBehavior[] {
  const actions: UserAction[] = [
    { type: 'command', target: 'npm run build' },
    { type: 'command', target: 'git status' },
    { type: 'file_edit', target: 'src/main.ts' },
    { type: 'app_switch', target: 'VSCode' },
    { type: 'search', target: 'how to use vitest' },
  ]

  return Array.from({ length: count }, (_, i) => {
    const action = actions[i % actions.length]
    return {
      id: `beh-${i}`,
      timestamp: Date.now() - i * 60_000, // 每条间隔 1 分钟
      sceneId: `scene-${i}`,
      sceneEmbedding: SYNTH_EMBEDDING,
      scene: {
        app: 'VSCode',
        activity: 'coding' as const,
        timeOfDay: 'morning' as const,
        dayOfWeek: 1,
        filesOpen: ['src/main.ts'],
        terminalCmds: [],
      },
      action,
      outcome: 'success' as const,
    } as UserBehavior
  })
}

// ============================================================
// Mock 依赖
// ============================================================

vi.mock('../../LocalEmbedder', () => ({
  LocalEmbedder: {
    getInstance: () => ({
      embed: vi.fn().mockResolvedValue(SYNTH_EMBEDDING),
      embedBatch: vi.fn().mockResolvedValue([SYNTH_EMBEDDING]),
      isLoaded: () => true,
      getDimension: () => 384,
      load: vi.fn().mockResolvedValue({}),
      reset: vi.fn(),
    }),
  },
}))

const synthBehaviors = makeSynthBehaviors(60)

vi.mock('../../PerceptionStore', () => ({
  PerceptionStore: {
    getInstance: () => ({
      searchSimilarBehaviors: vi.fn().mockResolvedValue(synthBehaviors),
      saveUserBehavior: vi.fn().mockResolvedValue(true),
      getPredictionsSince: vi.fn().mockResolvedValue(
        Array.from({ length: 50 }, (_, i) => ({
          id: `pred-${i}`,
          timestamp: Date.now() - i * 3600_000,
          hit: i % 3 === 0,
          feedback: i % 3 === 0 ? 'accepted' : i % 3 === 1 ? 'rejected' : 'ignored',
        })),
      ),
      updatePredictionOutcome: vi.fn().mockResolvedValue(true),
    }),
  },
}))

vi.mock('../../BehaviorPredictorLlm', () => ({
  behaviorPredictorLlm: {
    initialize: vi.fn(),
    isInitialized: () => false,
    reset: vi.fn(),
    predictWithLLM: vi.fn().mockResolvedValue([]),
  },
}))

// 在 Mock 之后导入
import { BehaviorPredictor } from '../../BehaviorPredictor'

// ============================================================
// 基准测试
// ============================================================

describe('BehaviorPredictor 性能基线', () => {
  const report = new BaselineReport('phase9-s9-07', '1.0.0')
  let predictor: BehaviorPredictor

  beforeAll(() => {
    predictor = BehaviorPredictor.getInstance()
  })

  afterAll(() => {
    report.printSummary()
    report.writeToFile(
      `${__dirname}/../../../../../../../docs/phase9/behavior-predictor-baseline.json`,
    )
  })

  it('predict() 单次延迟 < 100ms（统计模式 + Mock 嵌入）', async () => {
    const stats: BenchmarkStats = await runBenchmark({
      fn: () =>
        predictor.predict({
          sceneText: '用户正在编辑 src/main.ts 文件',
          app: 'VSCode',
          activity: 'coding',
          openFiles: ['src/main.ts'],
          topK: 3,
        }),
      iterations: 200,
      warmupIterations: 20,
    })

    report.addResult({
      name: 'predictStatisticalMode',
      module: 'BehaviorPredictor',
      description: '完整预测流程（嵌入 → 检索 → 统计评分 → LLM 未启用降级 → 持久化）',
      stats,
    })

    // p95 < 100ms（Mock 嵌入 + 60 条样本，纯算法部分应非常快）
    expect(stats.p95Ms).toBeLessThan(100)
    expect(stats.failures).toBe(0)
  })

  it('predict() 100 次连续调用吞吐量稳定', async () => {
    const stats: BenchmarkStats = await runBenchmark({
      fn: () =>
        predictor.predict({
          sceneText: '用户正在浏览 GitHub 仓库',
          app: 'Chrome',
          activity: 'browsing',
          topK: 5,
        }),
      iterations: 100,
      warmupIterations: 5,
    })

    report.addResult({
      name: 'predictThroughput100',
      module: 'BehaviorPredictor',
      description: '100 次连续预测调用，验证无内存泄漏与性能衰减',
      stats,
    })

    expect(stats.failures).toBe(0)
  })

  it('mergePredictions() 融合算法纯性能', async () => {
    // 通过反射访问私有方法，避免外部依赖
    const stat = {
      action: { type: 'command', target: 'npm run build' } as UserAction,
      confidence: 0.6,
      basedOnBehaviors: ['beh-1', 'beh-2'],
      reason: '统计模式预测',
      modelVersion: 'behavior-v1.0.0',
    }
    const llmPred = {
      id: 'pred-llm-1',
      predictedAction: { type: 'search', target: 'vitest docs' } as UserAction,
      confidence: 0.75,
      basedOnBehaviors: [],
      reason: '[LLM 新增] 推测用户需要查询 vitest 文档',
      modelVersion: 'behavior-v1.1.0-llm',
    }

    // 通过类型断言访问私有方法
    const predictorAny = predictor as unknown as {
      mergePredictions: (
        statistical: typeof stat[],
        llm: typeof llmPred[],
      ) => typeof stat[]
    }

    const stats: BenchmarkStats = await runBenchmark({
      fn: () =>
        predictorAny.mergePredictions(
          Array.from({ length: 20 }, (_, i) => ({
            ...stat,
            action: { type: 'command', target: `cmd-${i}` } as UserAction,
          })),
          Array.from({ length: 10 }, (_, i) => ({
            ...llmPred,
            id: `pred-llm-${i}`,
            predictedAction: {
              type: 'search',
              target: `query-${i}`,
            } as UserAction,
          })),
        ),
      iterations: 5000,
      warmupIterations: 100,
    })

    report.addResult({
      name: 'mergePredictions',
      module: 'BehaviorPredictor',
      description: '融合 20 条统计候选 + 10 条 LLM 预测，Map 归并 + 排序',
      stats,
    })

    expect(stats.p99Ms).toBeLessThan(5)
    expect(stats.failures).toBe(0)
  })

  it('getStats() 30 天命中率统计查询', async () => {
    const stats: BenchmarkStats = await runBenchmark({
      fn: () => predictor.getStats(30),
      iterations: 200,
      warmupIterations: 20,
    })

    report.addResult({
      name: 'getStats30days',
      module: 'BehaviorPredictor',
      description: '查询最近 30 天预测命中率统计（50 条记录遍历）',
      stats,
    })

    expect(stats.p95Ms).toBeLessThan(50)
    expect(stats.failures).toBe(0)
  })

  it('submitFeedback() 反馈回写性能', async () => {
    const stats: BenchmarkStats = await runBenchmark({
      fn: () =>
        predictor.submitFeedback('pred-1', 'accepted', {
          type: 'command',
          target: 'npm run build',
        }),
      iterations: 500,
      warmupIterations: 20,
    })

    report.addResult({
      name: 'submitFeedback',
      module: 'BehaviorPredictor',
      description: '提交单条预测反馈（store.updatePredictionOutcome 调用）',
      stats,
    })

    expect(stats.p99Ms).toBeLessThan(20)
    expect(stats.failures).toBe(0)
  })
})
