/**
 * 轨迹级与稳定性指标验收
 *
 * 验收目标：过程指标能识别绕路，稳定性指标能区分随机失败与真实缺陷。
 */

import { describe, expect, it } from 'vitest'
import { collectTrajectorySteps, extractTrajectoryMetrics, type TrajectoryStep } from '../trajectory'
import { computeStabilityMetrics, runRepeated } from '../metrics'

function step(
  index: number,
  toolName: string,
  argsSignature: string,
  extra: Partial<TrajectoryStep> = {},
): TrajectoryStep {
  return { index, toolName, argsSignature, ...extra }
}

describe('extractTrajectoryMetrics', () => {
  it('统计总步数与首次可用步序', () => {
    const metrics = extractTrajectoryMetrics({
      steps: [
        step(1, 'read_file', 'a', { useful: false }),
        step(2, 'search_files', 'b', { useful: false }),
        step(3, 'edit_file', 'c', { useful: true }),
        step(4, 'run_command', 'd', { useful: true }),
      ],
    })

    expect(metrics.totalSteps).toBe(4)
    expect(metrics.firstUsefulStep).toBe(3)
    expect(metrics.futileRetries).toBe(0)
  })

  it('同工具同参数且前一步无进展时计为无效重试', () => {
    const metrics = extractTrajectoryMetrics({
      steps: [
        step(1, 'read_file', 'same', { useful: false }),
        step(2, 'read_file', 'same', { useful: false }),
        step(3, 'read_file', 'same', { useful: true }),
      ],
    })

    expect(metrics.futileRetries).toBe(2)
    expect(metrics.futileRetryRatio).toBeCloseTo(2 / 3, 4)
  })

  it('前一步已产出结果时，相同参数重复不计为无效重试', () => {
    const metrics = extractTrajectoryMetrics({
      steps: [
        step(1, 'read_file', 'same', { useful: true }),
        step(2, 'read_file', 'same', { useful: true }),
      ],
    })

    expect(metrics.futileRetries).toBe(0)
  })

  it('工具名相同但参数不同不计为无效重试', () => {
    const metrics = extractTrajectoryMetrics({
      steps: [
        step(1, 'read_file', 'a', { useful: false }),
        step(2, 'read_file', 'b', { useful: false }),
      ],
    })

    expect(metrics.futileRetries).toBe(0)
  })

  it('统计循环检出次数与压缩事件', () => {
    const metrics = extractTrajectoryMetrics({
      steps: [
        step(1, 'read_file', 'a', { loopDetected: true }),
        step(2, 'read_file', 'b', { loopDetected: true }),
        step(3, 'edit_file', 'c', { useful: true }),
      ],
      compressionEvents: [
        { level: 2, at: 1_700_000_000_000 },
        { level: 3, at: 1_700_000_060_000 },
      ],
    })

    expect(metrics.loopDetections).toBe(2)
    expect(metrics.compressionEvents.map((event) => event.level)).toEqual([2, 3])
  })

  it('全程无有效产出时 firstUsefulStep 为 null', () => {
    const metrics = extractTrajectoryMetrics({
      steps: [step(1, 'read_file', 'a'), step(2, 'read_file', 'b')],
    })

    expect(metrics.firstUsefulStep).toBeNull()
  })

  it('空轨迹不报错', () => {
    const metrics = extractTrajectoryMetrics({ steps: [] })

    expect(metrics.totalSteps).toBe(0)
    expect(metrics.futileRetryRatio).toBe(0)
    expect(metrics.firstUsefulStep).toBeNull()
  })
})

describe('collectTrajectorySteps', () => {
  it('按顺序生成步序，失败结果不计为可用', () => {
    const steps = collectTrajectorySteps([
      { name: 'read_file', arguments: { path: 'a.ts' } },
      { name: 'run_command', arguments: { command: 'ls' }, isError: true },
    ])

    expect(steps.map((s) => s.index)).toEqual([1, 2])
    expect(steps[0].useful).toBe(true)
    expect(steps[1].useful).toBe(false)
  })

  it('参数键序不同得到同一签名', () => {
    const a = collectTrajectorySteps([{ name: 'read_file', arguments: { path: 'a', limit: 1 } }])
    const b = collectTrajectorySteps([{ name: 'read_file', arguments: { limit: 1, path: 'a' } }])

    expect(a[0].argsSignature).toBe(b[0].argsSignature)
  })
})

describe('computeStabilityMetrics', () => {
  it('随机失败的用例被识别为噪声', () => {
    // 同一批 3 个用例跑 3 轮，其中一个时好时坏
    const metrics = computeStabilityMetrics([
      [true, true, true],
      [true, false, true],
      [true, true, true],
    ])

    expect(metrics.runs).toBe(3)
    expect(metrics.passSome).toBe(1)
    expect(metrics.passNone).toBe(0)
    expect(metrics.passAll).toBe(2)
  })

  it('稳定失败的用例被识别为真实缺陷', () => {
    const metrics = computeStabilityMetrics([
      [false, false, false],
      [false, false, false],
      [false, false, false],
    ])

    expect(metrics.passNone).toBe(metrics.runs)
    expect(metrics.passAll).toBe(0)
    expect(metrics.passSome).toBe(0)
  })

  it('通过率方差反映稳定性', () => {
    const stable = computeStabilityMetrics([
      [true, true],
      [true, true],
    ])
    const unstable = computeStabilityMetrics([
      [true, true],
      [false, false],
    ])

    expect(stable.variance).toBe(0)
    expect(unstable.variance).toBeGreaterThan(0)
  })

  it('空输入不报错', () => {
    const metrics = computeStabilityMetrics([])

    expect(metrics.runs).toBe(0)
    expect(metrics.variance).toBe(0)
  })
})

describe('runRepeated', () => {
  it('按指定轮数执行并保序返回结果', async () => {
    const calls: number[] = []
    const results = await runRepeated((round) => {
      calls.push(round)
      return round * 2
    }, 3)

    expect(results).toEqual([0, 2, 4])
    expect(calls).toEqual([0, 1, 2])
  })
})
