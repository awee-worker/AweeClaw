/**
 * 评测回归门禁验收
 *
 * 验收目标：劣化能被阻断，正常波动不被误伤，首次运行不阻断。
 */

import { describe, expect, it } from 'vitest'
import {
  appendBaseline,
  compareBaseline,
  extractGateMetrics,
  readLatestBaseline,
  renderGateReport,
  toObservabilityMetrics,
  type BaselineArchive,
} from '../gate'
import type { EvalReport } from '../types'

function makeReport(overrides: Partial<EvalReport> = {}): EvalReport {
  return {
    generatedAt: '2026-09-21T00:00:00.000Z',
    sampleCount: 200,
    toolSelection: {
      prunedRecall: 0.95,
      prunedPrecision: 0.98,
      accuracy: 0.95,
      truePositive: 100,
      falsePositive: 2,
      trueNegative: 90,
      falseNegative: 8,
    },
    taskCompletion: { rate: 1, total: 120, failed: 0, failures: [] },
    tokens: {
      avgBaselineTokens: 8000,
      avgPreselectedTokens: 3000,
      avgSavedTokens: 5000,
      avgSavingRatio: 0.62,
    },
    intents: [],
    pruning: {
      sampleCount: 12,
      criticalRetentionRate: 1,
      avgTokenReduction: 0.3,
      skipped: 0,
      failures: [],
    },
    commandRisk: {
      sampleCount: 40,
      accuracy: 0.95,
      recallByLevel: [],
      overFlagged: 2,
      underFlagged: 0,
      failures: [],
    },
    ...overrides,
  }
}

describe('compareBaseline', () => {
  it('首次运行没有基线时不阻断，只建立基线', () => {
    const gate = compareBaseline(null, makeReport())

    expect(gate.passed).toBe(true)
    expect(gate.regressions).toHaveLength(0)
    expect(gate.notes.join()).toContain('首次运行')
  })

  it('需确认命令被放行次数增加时阻断', () => {
    const baseline = makeReport()
    const current = makeReport({
      commandRisk: { ...baseline.commandRisk!, underFlagged: 1 },
    })

    const gate = compareBaseline(baseline, current)

    expect(gate.passed).toBe(false)
    expect(gate.regressions.map((delta) => delta.metric)).toContain('commandRisk.underFlagged')
  })

  it('工具选择准确率下降超过容忍幅度时阻断', () => {
    const baseline = makeReport()
    const current = makeReport({
      toolSelection: { ...baseline.toolSelection, accuracy: 0.9 },
    })

    const gate = compareBaseline(baseline, current)

    expect(gate.passed).toBe(false)
    expect(gate.regressions.map((delta) => delta.metric)).toContain('toolSelection.accuracy')
  })

  it('准确率下降在容忍范围内时放行', () => {
    const baseline = makeReport()
    const current = makeReport({
      toolSelection: { ...baseline.toolSelection, accuracy: 0.94 },
    })

    const gate = compareBaseline(baseline, current)

    expect(gate.passed).toBe(true)
    expect(gate.regressions).toHaveLength(0)
    expect(gate.notes.join()).toContain('容忍范围内')
  })

  it('安全命令被要求确认的次数增加只告警不阻断', () => {
    const baseline = makeReport()
    const current = makeReport({
      commandRisk: { ...baseline.commandRisk!, overFlagged: 5 },
    })

    const gate = compareBaseline(baseline, current)

    expect(gate.passed).toBe(true)
    expect(gate.warnings.map((warning) => warning.metric)).toContain('commandRisk.overFlagged')
    // 误判计数上升不是改善，不能记入改善项
    expect(gate.improvements.map((delta) => delta.metric)).not.toContain('commandRisk.overFlagged')
  })

  it('关键消息保留率跌破下限时阻断', () => {
    const baseline = makeReport()
    const current = makeReport({
      pruning: { ...baseline.pruning!, criticalRetentionRate: 0.9 },
    })

    const gate = compareBaseline(baseline, current)

    expect(gate.passed).toBe(false)
    expect(gate.regressions.map((delta) => delta.metric)).toContain('pruning.criticalRetentionRate')
  })

  it('指标改善记入改善项且不阻断', () => {
    const baseline = makeReport()
    const current = makeReport({
      toolSelection: { ...baseline.toolSelection, accuracy: 0.99 },
      commandRisk: { ...baseline.commandRisk!, underFlagged: 0, overFlagged: 0 },
    })

    const gate = compareBaseline(baseline, current)

    expect(gate.passed).toBe(true)
    expect(gate.improvements.map((delta) => delta.metric)).toContain('toolSelection.accuracy')
  })

  it('阈值可配置', () => {
    const baseline = makeReport()
    const current = makeReport({
      toolSelection: { ...baseline.toolSelection, accuracy: 0.94 },
    })

    expect(compareBaseline(baseline, current, { accuracyDropTolerance: 0.001 }).passed).toBe(false)
    expect(compareBaseline(baseline, current, { accuracyDropTolerance: 0.1 }).passed).toBe(true)
  })
})

describe('基线存档', () => {
  it('保留最近 N 次结果', () => {
    let archive: BaselineArchive | null = null
    for (let i = 0; i < 7; i++) {
      archive = appendBaseline(archive, makeReport({ generatedAt: `2026-09-2${i}T00:00:00.000Z` }), 5)
    }

    expect(archive!.entries).toHaveLength(5)
    expect(archive!.entries[0].generatedAt).toBe('2026-09-22T00:00:00.000Z')
    expect(archive!.entries[4].generatedAt).toBe('2026-09-26T00:00:00.000Z')
  })

  it('取最新一轮作为基线', () => {
    let archive: BaselineArchive | null = null
    archive = appendBaseline(archive, makeReport({ generatedAt: 'a' }))
    archive = appendBaseline(archive, makeReport({ generatedAt: 'b' }))

    expect(readLatestBaseline(archive)?.generatedAt).toBe('b')
    expect(readLatestBaseline(null)).toBeNull()
  })

  it('存档版本号随写入维护', () => {
    const archive = appendBaseline(null, makeReport())

    expect(archive.version).toBe(1)
  })
})

describe('输出', () => {
  it('门禁报告含结论与阻断项', () => {
    const baseline = makeReport()
    const current = makeReport({
      commandRisk: { ...baseline.commandRisk!, underFlagged: 2 },
    })
    const text = renderGateReport(compareBaseline(baseline, current))

    expect(text).toContain('阻断')
    expect(text).toContain('commandRisk.underFlagged')
  })

  it('观测序列带 eval 前缀并含门禁结论', () => {
    const report = makeReport()
    const gate = compareBaseline(null, report)
    const series = toObservabilityMetrics(report, gate)

    expect(series.every((item) => item.name.startsWith('eval.'))).toBe(true)
    expect(series.find((item) => item.name === 'eval.gate.passed')?.value).toBe(1)
  })

  it('抽取的门禁指标不包含描述性字段', () => {
    const metrics = extractGateMetrics(makeReport())

    expect(Object.keys(metrics)).not.toContain('sampleCount')
    expect(metrics['toolSelection.accuracy']).toBe(0.95)
  })
})
