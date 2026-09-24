/**
 * 插件与场景质量门验收
 *
 * 验收目标（对应 03 文档 C7）：指标劣化能被阻断；样本不足、基线不可信、
 * 指标未登记这三种情况下不得凭空造出阻断。
 */

import { describe, expect, it } from 'vitest'
import {
  compareQualityBaseline,
  renderQualityGateReport,
  type QualitySnapshot,
} from './qualityGate'

function makeSnapshot(
  metrics: Record<string, number>,
  sampleCount = 100,
  windowStart = 0,
): QualitySnapshot {
  return {
    metrics,
    sampleCount,
    windowStart,
    windowEnd: windowStart + 60 * 60 * 1000,
  }
}

describe('compareQualityBaseline', () => {
  it('首次运行没有基线时只建立基线，不阻断', () => {
    const result = compareQualityBaseline({
      scope: 'plugin',
      targetId: 'video-composer',
      baseline: null,
      current: makeSnapshot({ 'plugin.failureRate': 0.1 }),
    })

    expect(result.passed).toBe(true)
    expect(result.regressions).toEqual([])
    expect(result.notes.join()).toContain('首次运行')
  })

  it('样本量不足时不阻断，只记录', () => {
    const result = compareQualityBaseline({
      scope: 'plugin',
      targetId: 'video-composer',
      baseline: makeSnapshot({ 'plugin.failureRate': 0.05 }),
      current: makeSnapshot({ 'plugin.failureRate': 1 }, 3),
    })

    expect(result.passed).toBe(true)
    expect(result.regressions).toEqual([])
    expect(result.notes.join()).toContain('样本量不足')
  })

  it('基线样本量不足时参照点不可信，不比对', () => {
    const result = compareQualityBaseline({
      scope: 'plugin',
      targetId: 'video-composer',
      baseline: makeSnapshot({ 'plugin.failureRate': 0 }, 2),
      current: makeSnapshot({ 'plugin.failureRate': 0.9 }),
    })

    expect(result.passed).toBe(true)
    expect(result.regressions).toEqual([])
    expect(result.notes.join()).toContain('不可信')
  })

  it('失败率超出容忍幅度时阻断（C7 场景）', () => {
    const result = compareQualityBaseline({
      scope: 'plugin',
      targetId: 'video-composer',
      baseline: makeSnapshot({ 'plugin.failureRate': 0.05 }),
      current: makeSnapshot({ 'plugin.failureRate': 0.12 }),
    })

    expect(result.passed).toBe(false)
    expect(result.regressions).toHaveLength(1)
    expect(result.regressions[0].metric).toBe('plugin.failureRate')
    expect(result.regressions[0].delta).toBeCloseTo(0.07, 5)
  })

  it('容忍幅度内的上升放行，且不进告警列表', () => {
    const result = compareQualityBaseline({
      scope: 'plugin',
      targetId: 'video-composer',
      baseline: makeSnapshot({ 'plugin.failureRate': 0.05 }),
      current: makeSnapshot({ 'plugin.failureRate': 0.07 }),
    })

    expect(result.passed).toBe(true)
    expect(result.regressions).toEqual([])
    expect(result.warnings).toEqual([])
    expect(result.notes.join()).toContain('未超过容忍幅度')
  })

  it('超时率上升只告警不阻断（体验损耗）', () => {
    const result = compareQualityBaseline({
      scope: 'plugin',
      targetId: 'video-composer',
      baseline: makeSnapshot({ 'plugin.timeoutRate': 0.02 }),
      current: makeSnapshot({ 'plugin.timeoutRate': 0.1 }),
    })

    expect(result.passed).toBe(true)
    expect(result.regressions).toEqual([])
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0].metric).toBe('plugin.timeoutRate')
  })

  it('参数无效率上升只告警，不判为插件缺陷', () => {
    const result = compareQualityBaseline({
      scope: 'plugin',
      targetId: 'video-composer',
      baseline: makeSnapshot({ 'plugin.invalidArgsRate': 0.05 }),
      current: makeSnapshot({ 'plugin.invalidArgsRate': 0.4 }),
    })

    expect(result.passed).toBe(true)
    expect(result.regressions).toEqual([])
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0].metric).toBe('plugin.invalidArgsRate')
  })

  it('参数无效率在容忍幅度内时连告警都不出', () => {
    const result = compareQualityBaseline({
      scope: 'plugin',
      targetId: 'video-composer',
      baseline: makeSnapshot({ 'plugin.invalidArgsRate': 0.05 }),
      current: makeSnapshot({ 'plugin.invalidArgsRate': 0.12 }),
    })

    expect(result.warnings).toEqual([])
    expect(result.notes.join()).toContain('未超过容忍幅度')
  })

  it('平均步数上涨超过三成时告警', () => {
    const result = compareQualityBaseline({
      scope: 'scenario',
      targetId: 'dev-studio',
      baseline: makeSnapshot({ 'scenario.avgSteps': 10 }, 10),
      current: makeSnapshot({ 'scenario.avgSteps': 14 }, 10),
    })

    expect(result.passed).toBe(true)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0].metric).toBe('scenario.avgSteps')
  })

  it('人工干预次数任何上升都告警', () => {
    const result = compareQualityBaseline({
      scope: 'scenario',
      targetId: 'dev-studio',
      baseline: makeSnapshot({ 'scenario.interventionsPerSession': 1.2 }, 10),
      current: makeSnapshot({ 'scenario.interventionsPerSession': 1.3 }, 10),
    })

    expect(result.passed).toBe(true)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0].metric).toBe('scenario.interventionsPerSession')
  })

  it('人工干预次数持平时不告警', () => {
    const result = compareQualityBaseline({
      scope: 'scenario',
      targetId: 'dev-studio',
      baseline: makeSnapshot({ 'scenario.interventionsPerSession': 1.2 }, 10),
      current: makeSnapshot({ 'scenario.interventionsPerSession': 1.2 }, 10),
    })

    expect(result.warnings).toEqual([])
    expect(result.regressions).toEqual([])
  })

  it('指标下降记为改善', () => {
    const result = compareQualityBaseline({
      scope: 'plugin',
      targetId: 'video-composer',
      baseline: makeSnapshot({ 'plugin.failureRate': 0.1 }),
      current: makeSnapshot({ 'plugin.failureRate': 0.03 }),
    })

    expect(result.passed).toBe(true)
    expect(result.improvements).toHaveLength(1)
    expect(result.improvements[0].delta).toBeCloseTo(-0.07, 5)
  })

  it('未登记的指标不参与比对', () => {
    const result = compareQualityBaseline({
      scope: 'plugin',
      targetId: 'video-composer',
      baseline: makeSnapshot({ 'plugin.experimentalMetric': 1 }),
      current: makeSnapshot({ 'plugin.experimentalMetric': 99 }),
    })

    expect(result.passed).toBe(true)
    expect(result.regressions).toEqual([])
    expect(result.notes.join()).toContain('未登记指标')
  })

  it('基线中缺失的指标本次只建立，不判劣化', () => {
    const result = compareQualityBaseline({
      scope: 'plugin',
      targetId: 'video-composer',
      baseline: makeSnapshot({ 'plugin.failureRate': 0.05 }),
      current: makeSnapshot({
        'plugin.failureRate': 0.05,
        'plugin.invalidArgsRate': 0.5,
      }),
    })

    expect(result.passed).toBe(true)
    expect(result.regressions).toEqual([])
    expect(result.notes.join()).toContain('本次建立')
  })

  it('相对增幅类指标在基线为 0 时跳过，不产生无穷倍阻断', () => {
    const result = compareQualityBaseline({
      scope: 'plugin',
      targetId: 'video-composer',
      baseline: makeSnapshot({ 'plugin.p95DurationMs': 0 }),
      current: makeSnapshot({ 'plugin.p95DurationMs': 800 }),
    })

    expect(result.passed).toBe(true)
    expect(result.regressions).toEqual([])
    expect(result.notes.join()).toContain('无法换算增幅')
  })

  it('耗时上涨超过三成时告警', () => {
    const result = compareQualityBaseline({
      scope: 'plugin',
      targetId: 'video-composer',
      baseline: makeSnapshot({ 'plugin.p95DurationMs': 1000 }),
      current: makeSnapshot({ 'plugin.p95DurationMs': 1450 }),
    })

    expect(result.passed).toBe(true)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0].metric).toBe('plugin.p95DurationMs')
  })

  it('指标持平时不进任何列表', () => {
    const result = compareQualityBaseline({
      scope: 'plugin',
      targetId: 'video-composer',
      baseline: makeSnapshot({ 'plugin.failureRate': 0.05 }),
      current: makeSnapshot({ 'plugin.failureRate': 0.05 }),
    })

    expect(result.passed).toBe(true)
    expect(result.regressions).toEqual([])
    expect(result.warnings).toEqual([])
    expect(result.improvements).toEqual([])
  })

  it('容忍幅度可逐指标覆盖', () => {
    const input = {
      scope: 'plugin' as const,
      targetId: 'video-composer',
      baseline: makeSnapshot({ 'plugin.failureRate': 0.05 }),
      current: makeSnapshot({ 'plugin.failureRate': 0.12 }),
    }

    expect(compareQualityBaseline(input).passed).toBe(false)
    expect(
      compareQualityBaseline({
        ...input,
        config: { tolerances: { 'plugin.failureRate': 0.1 } },
      }).passed,
    ).toBe(true)
  })

  it('场景维度复用同一套判定，样本门槛按会话数计', () => {
    const result = compareQualityBaseline({
      scope: 'scenario',
      targetId: 'dev-studio',
      baseline: makeSnapshot({ 'scenario.futileRetryRatio': 0.1 }, 10),
      current: makeSnapshot({ 'scenario.futileRetryRatio': 0.3 }, 8),
    })

    // 场景门槛为 5 个会话，8 个已达标，因此照常判定
    expect(result.passed).toBe(false)
    expect(result.regressions[0].metric).toBe('scenario.futileRetryRatio')
  })

  it('场景维度会话数低于门槛时不阻断', () => {
    const result = compareQualityBaseline({
      scope: 'scenario',
      targetId: 'dev-studio',
      baseline: makeSnapshot({ 'scenario.futileRetryRatio': 0.1 }, 10),
      current: makeSnapshot({ 'scenario.futileRetryRatio': 0.9 }, 2),
    })

    expect(result.passed).toBe(true)
    expect(result.regressions).toEqual([])
  })

  it('结论里带上样本量，便于判断可信度', () => {
    const result = compareQualityBaseline({
      scope: 'plugin',
      targetId: 'video-composer',
      baseline: makeSnapshot({ 'plugin.failureRate': 0.05 }, 80),
      current: makeSnapshot({ 'plugin.failureRate': 0.05 }, 120),
    })

    expect(result.sampleSize).toBe(120)
    expect(result.baselineSampleSize).toBe(80)
  })
})

describe('renderQualityGateReport', () => {
  it('阻断结论里列出指标与两端取值', () => {
    const result = compareQualityBaseline({
      scope: 'plugin',
      targetId: 'video-composer',
      baseline: makeSnapshot({ 'plugin.failureRate': 0.05 }),
      current: makeSnapshot({ 'plugin.failureRate': 0.12 }),
    })

    const text = renderQualityGateReport(result)

    expect(text).toContain('质量门结论：阻断')
    expect(text).toContain('工具失败率')
    expect(text).toContain('0.0500 → 0.1200')
  })

  it('放行结论里给出通过字样', () => {
    const result = compareQualityBaseline({
      scope: 'scenario',
      targetId: 'dev-studio',
      baseline: makeSnapshot({ 'scenario.futileRetryRatio': 0.1 }, 10),
      current: makeSnapshot({ 'scenario.futileRetryRatio': 0.08 }, 10),
    })

    const text = renderQualityGateReport(result)

    expect(text).toContain('质量门结论：通过')
    expect(text).toContain('场景：dev-studio')
  })
})
