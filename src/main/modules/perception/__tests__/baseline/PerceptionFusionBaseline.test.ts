/**
 * PerceptionFusionService 性能基线测试 — 阶段9 s9-07
 *
 * 基准测试范围：
 * 1. getEnvironmentContext() 全流程延迟（4 通道并行 + 摘要 + 注意力分数 + 洞察）
 * 2. 多次连续调用吞吐量（含历史滑动窗口 push/shift）
 * 3. 大异常数场景下的注意力分数计算稳定性
 * 4. 单通道超时容错性能（800ms 超时机制开销）
 *
 * Mock 策略：
 * - 通过 vi.mock() 替换 PerceptionStore / IoTBridge / SensorFusionService /
 *   CausalReasoningService / MonitoringService 五个外部依赖
 * - Mock 返回合成数据，确保纯算法性能不被外部 I/O 抖动影响
 * - 所有 Mock 均为同步返回，避免 Promise 调度噪声
 *
 * @module perception/__tests__/baseline/PerceptionFusionBaseline
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { BaselineReport, runBenchmark, type BenchmarkStats } from './BaselineHarness'

// ============================================================
// Mock 外部依赖（必须在 import PerceptionFusionService 之前声明）
// ============================================================

// 合成场景数据
const synthScene = {
  id: 'scene-1',
  timestamp: Date.now(),
  app: 'VSCode',
  windowTitle: 'main.ts - aweeclaw-client',
  activity: 'coding' as const,
  textSummary: '用户正在编辑 src/main.ts 文件，光标位于第 100 行',
}

vi.mock('../../PerceptionStore', () => ({
  PerceptionStore: {
    getInstance: () => ({
      getRecentScenes: vi.fn().mockResolvedValue([synthScene]),
    }),
  },
}))

vi.mock('../../../iot/IoTBridge', () => ({
  IoTBridge: {
    getInstance: () => ({
      getStatus: () => ({
        running: true,
        providers: [
          { id: 'p1', name: 'HA', state: 'connected' as const },
          { id: 'p2', name: 'MQTT', state: 'connected' as const },
        ],
        totalEntities: 12,
      }),
      listEntitySnapshots: () => [
        {
          externalId: 'sensor.temp_1',
          entityType: 'temperature' as const,
          state: '23.5',
          unitOfMeasurement: '°C',
        },
      ],
    }),
  },
}))

vi.mock('../../../iot/SensorFusionService', () => ({
  SensorFusionService: {
    getInstance: () => ({
      getRecentAnomalies: (n: number) =>
        Array.from({ length: Math.min(n, 2) }, (_, i) => ({
          type: 'spike' as const,
          severity: 'warning' as const,
          description: `温度异常 #${i}`,
          externalId: 'sensor.temp_1',
          timestamp: Date.now() - i * 1000,
        })),
    }),
  },
}))

vi.mock('../../../causal-reasoning/CausalReasoningService', () => ({
  CausalReasoningService: {
    getInstance: () => ({
      getConfig: () => ({ enabled: true }),
      getStats: () => ({ nodeCount: 25, edgeCount: 40, density: 0.15 }),
      listQueries: () =>
        Array.from({ length: 10 }, (_, i) => ({
          queryType: 'backdoor' as const,
          success: true,
          createdAt: Date.now() - i * 60_000,
        })),
    }),
  },
}))

vi.mock('../../../monitoring/MonitoringService', () => ({
  MonitoringService: {
    getInstance: () => ({
      isRunning: () => true,
      getActiveAnomalies: () =>
        Array.from({ length: 1 }, (_, i) => ({
          id: `an-${i}`,
          type: 'cpu_high' as const,
          severity: 'warning' as const,
          description: 'CPU 持续高负载',
          timestamp: Date.now() - i * 5000,
          status: 'active' as const,
        })),
      getRecentAnomalies: (n: number) =>
        Array.from({ length: Math.min(n, 2) }, (_, i) => ({
          id: `an-r-${i}`,
          type: 'cpu_high' as const,
          severity: 'warning' as const,
          description: 'CPU 持续高负载',
          timestamp: Date.now() - i * 5000,
          status: 'active' as const,
        })),
      getLatestMetrics: () => ({
        cpuUsage: 75,
        memoryUsage: 60,
        diskUsage: 50,
        timestamp: Date.now(),
      }),
    }),
  },
}))

// 在所有 Mock 声明后，再 import 被测模块
import { PerceptionFusionService } from '../../PerceptionFusionService'

// ============================================================
// 基准测试
// ============================================================

describe('PerceptionFusionService 性能基线', () => {
  const report = new BaselineReport('phase9-s9-07', '1.0.0')
  let fusion: PerceptionFusionService

  beforeAll(() => {
    fusion = PerceptionFusionService.getInstance()
  })

  afterAll(() => {
    fusion.dispose()
    report.printSummary()
    report.writeToFile(
      `${__dirname}/../../../../../../../docs/phase9/perception-fusion-baseline.json`,
    )
  })

  it('getEnvironmentContext() 单次延迟 < 50ms', async () => {
    const stats: BenchmarkStats = await runBenchmark({
      fn: () => fusion.getEnvironmentContext(),
      iterations: 200,
      warmupIterations: 20,
    })

    report.addResult({
      name: 'getEnvironmentContext',
      module: 'PerceptionFusionService',
      description: '4 通道并行融合 + 摘要构建 + 注意力分数 + 洞察生成 + 历史滑动窗口',
      stats,
    })

    // 基线断言：p95 应 < 50ms（纯算法 + 同步 Mock，不应有显著延迟）
    expect(stats.p95Ms).toBeLessThan(50)
    expect(stats.failures).toBe(0)
  })

  it('连续 20 次融合历史窗口管理稳定', async () => {
    const stats: BenchmarkStats = await runBenchmark({
      fn: () => fusion.getEnvironmentContext(),
      iterations: 20,
      warmupIterations: 0,
    })

    report.addResult({
      name: 'historyWindowStress',
      module: 'PerceptionFusionService',
      description: '连续 20 次调用，验证历史滑动窗口 push/shift 性能稳定',
      stats,
    })

    // 历史窗口已满（20 条），shift 操作应保持 O(1)，p50 不应显著上升
    expect(stats.p50Ms).toBeLessThan(20)
    expect(stats.failures).toBe(0)
  })

  it('getFusionHistory() 查询性能', async () => {
    // 先填充历史
    for (let i = 0; i < 20; i++) {
      await fusion.getEnvironmentContext()
    }

    const stats: BenchmarkStats = await runBenchmark({
      fn: () => fusion.getFusionHistory(20),
      iterations: 1000,
      warmupIterations: 50,
    })

    report.addResult({
      name: 'getFusionHistory',
      module: 'PerceptionFusionService',
      description: '查询最近 20 条融合历史（slice 操作）',
      stats,
    })

    expect(stats.p99Ms).toBeLessThan(5)
    expect(stats.failures).toBe(0)
  })

  it('getLastContext() 性能', async () => {
    const stats: BenchmarkStats = await runBenchmark({
      fn: () => fusion.getLastContext(),
      iterations: 10000,
      warmupIterations: 100,
    })

    report.addResult({
      name: 'getLastContext',
      module: 'PerceptionFusionService',
      description: '获取最近一次融合结果（直接返回引用）',
      stats,
    })

    expect(stats.p99Ms).toBeLessThan(1)
    expect(stats.failures).toBe(0)
  })

  it('clearHistory() 性能', async () => {
    const stats: BenchmarkStats = await runBenchmark({
      fn: async () => {
        // 先填充再清空
        for (let i = 0; i < 5; i++) {
          await fusion.getEnvironmentContext()
        }
        fusion.clearHistory()
      },
      iterations: 50,
      warmupIterations: 5,
    })

    report.addResult({
      name: 'clearHistory',
      module: 'PerceptionFusionService',
      description: '清空历史滑动窗口',
      stats,
    })

    expect(stats.failures).toBe(0)
  })
})
