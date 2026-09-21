/**
 * 评测回归门禁
 *
 * 职责：把评测结果从「仅供观察」变成「可以阻断劣化」。
 *
 * 与 harness.ts 的分工：
 * - harness.ts 负责跑出当前结果
 * - 本模块负责与上次基线比对，给出放行/阻断结论
 *
 * 判定原则：
 * - 只对「功能损坏」类指标设硬红线，对「体验损耗」类只警告
 * - 阈值可配置且默认宽松，门禁过严会阻碍正常迭代
 * - 首次运行没有基线，只建立基线不阻断
 */

import type { EvalReport } from './types'

/** 门禁配置 */
export interface GateConfig {
  /** 工具选择准确率允许的最大下降幅度（0~1），默认 0.03 */
  accuracyDropTolerance: number
  /** 需确认命令被放行的次数增加时是否直接阻断，默认 true */
  failOnUnderFlaggedIncrease: boolean
  /** 安全命令被要求确认的次数增加时是否告警（不阻断），默认 true */
  warnOnOverFlaggedIncrease: boolean
  /** 关键消息保留率允许的最小值，默认 1（不允许下降） */
  criticalRetentionFloor: number
}

export const DEFAULT_GATE_CONFIG: GateConfig = {
  accuracyDropTolerance: 0.03,
  failOnUnderFlaggedIncrease: true,
  warnOnOverFlaggedIncrease: true,
  criticalRetentionFloor: 1,
}

/**
 * 数值越低越好的指标
 *
 * 误判计数类指标上升是坏事，不能按「上升即改善」处理，
 * 否则数量增加会被记成改善项而掩盖劣化。
 */
const LOWER_IS_BETTER = new Set<string>([
  'commandRisk.underFlagged',
  'commandRisk.overFlagged',
])

/** 单条指标变化 */
export interface MetricDelta {
  metric: string
  baseline: number
  current: number
}

/** 门禁结论 */
export interface GateResult {
  passed: boolean
  /** 触发阻断的原因 */
  regressions: MetricDelta[]
  /** 不阻断但需要留意的变化 */
  warnings: Array<MetricDelta & { reason: string }>
  /** 有改善的指标 */
  improvements: MetricDelta[]
  /** 结论说明，用于人类可读输出 */
  notes: string[]
}

/**
 * 抽取参与门禁比对的指标
 *
 * 只抽取有明确好坏方向的指标；纯描述性指标（样本数等）不参与比对，
 * 避免样本集扩充被误判为回归。
 */
export function extractGateMetrics(report: EvalReport): Record<string, number> {
  const metrics: Record<string, number> = {
    'toolSelection.accuracy': report.toolSelection.accuracy,
    'toolSelection.prunedRecall': report.toolSelection.prunedRecall,
    'toolSelection.prunedPrecision': report.toolSelection.prunedPrecision,
    'taskCompletion.rate': report.taskCompletion.rate,
    'tokens.avgSavingRatio': report.tokens.avgSavingRatio,
  }

  if (report.commandRisk) {
    metrics['commandRisk.accuracy'] = report.commandRisk.accuracy
    metrics['commandRisk.underFlagged'] = report.commandRisk.underFlagged
    metrics['commandRisk.overFlagged'] = report.commandRisk.overFlagged
  }

  if (report.pruning) {
    metrics['pruning.criticalRetentionRate'] = report.pruning.criticalRetentionRate
    metrics['pruning.avgTokenReduction'] = report.pruning.avgTokenReduction
  }

  return metrics
}

/**
 * 基线比对
 *
 * @param baseline 上次结果，null 表示首次运行
 * @param current 本次结果
 * @param config 门禁配置，缺省用 DEFAULT_GATE_CONFIG
 */
export function compareBaseline(
  baseline: EvalReport | null,
  current: EvalReport,
  config: Partial<GateConfig> = {},
): GateResult {
  const resolved: GateConfig = { ...DEFAULT_GATE_CONFIG, ...config }

  if (!baseline) {
    return {
      passed: true,
      regressions: [],
      warnings: [],
      improvements: [],
      notes: ['首次运行，建立基线，不做阻断'],
    }
  }

  const baselineMetrics = extractGateMetrics(baseline)
  const currentMetrics = extractGateMetrics(current)

  const worsened: MetricDelta[] = []
  const warnings: Array<MetricDelta & { reason: string }> = []
  const improvements: MetricDelta[] = []
  const notes: string[] = []

  for (const [metric, currentValue] of Object.entries(currentMetrics)) {
    if (!(metric in baselineMetrics)) {
      notes.push(`${metric}：基线中不存在该指标，本次建立，不参与比对`)
      continue
    }

    const baselineValue = baselineMetrics[metric]
    const delta: MetricDelta = { metric, baseline: baselineValue, current: currentValue }
    const lowerIsBetter = LOWER_IS_BETTER.has(metric)

    if (lowerIsBetter ? currentValue > baselineValue : currentValue < baselineValue) worsened.push(delta)
    else if (lowerIsBetter ? currentValue < baselineValue : currentValue > baselineValue) improvements.push(delta)
  }

  const blocking: MetricDelta[] = []

  // 硬红线一：需确认的命令被放行次数增加
  const underFlaggedDelta = findDelta(worsened, 'commandRisk.underFlagged')
  if (underFlaggedDelta && resolved.failOnUnderFlaggedIncrease) {
    blocking.push(underFlaggedDelta)
    notes.push('需确认的命令被静默放行的次数增加，属高危漏放行，直接阻断')
  }

  // 硬红线二：工具选择准确率下降超过容忍幅度
  const accuracyDelta = findDelta(worsened, 'toolSelection.accuracy')
  if (accuracyDelta) {
    const drop = accuracyDelta.baseline - accuracyDelta.current
    if (drop > resolved.accuracyDropTolerance) {
      blocking.push(accuracyDelta)
      notes.push(
        `工具选择准确率下降 ${(drop * 100).toFixed(2)}%，超过容忍上限 ${(resolved.accuracyDropTolerance * 100).toFixed(2)}%`,
      )
    } else {
      notes.push(`工具选择准确率下降 ${(drop * 100).toFixed(2)}%，在容忍范围内`)
    }
  }

  // 硬红线三：关键消息保留率低于下限
  const retentionDelta = findDelta(worsened, 'pruning.criticalRetentionRate')
  if (retentionDelta && retentionDelta.current < resolved.criticalRetentionFloor) {
    blocking.push(retentionDelta)
    notes.push('关键消息保留率跌破下限，上下文裁剪有丢关键信息的风险')
  }

  // 非阻断项：安全命令被要求确认的次数增加，代价只是多一次点击
  const overFlaggedDelta = findDelta(worsened, 'commandRisk.overFlagged')
  if (overFlaggedDelta && resolved.warnOnOverFlaggedIncrease) {
    warnings.push({ ...overFlaggedDelta, reason: '体验损耗，不阻断；若持续增加应检查命令风险判定规则' })
  }

  const passed = blocking.length === 0
  if (passed && worsened.length > 0) {
    notes.push('存在指标下降，但均未触及硬红线，放行')
  }
  if (passed && worsened.length === 0) {
    notes.push('与基线一致或更优，放行')
  }

  return {
    passed,
    regressions: blocking,
    warnings,
    improvements,
    notes,
  }
}

/** 单轮基线存档 */
export interface BaselineEntry {
  generatedAt: string
  report: EvalReport
}

/** 基线存档（保留最近若干次，便于纵向对比与回溯） */
export interface BaselineArchive {
  version: number
  entries: BaselineEntry[]
}

export const BASELINE_ARCHIVE_VERSION = 1
/** 默认保留的基线轮数 */
export const DEFAULT_BASELINE_KEEP = 5

/** 追加一轮结果到存档，超出容量时丢弃最旧的记录 */
export function appendBaseline(
  archive: BaselineArchive | null,
  report: EvalReport,
  keep = DEFAULT_BASELINE_KEEP,
): BaselineArchive {
  const entries = [...(archive?.entries ?? []), { generatedAt: report.generatedAt, report }]
  return {
    version: BASELINE_ARCHIVE_VERSION,
    entries: keep > 0 ? entries.slice(-keep) : entries,
  }
}

/** 取最新一次基线结果，无记录时返回 null */
export function readLatestBaseline(archive: BaselineArchive | null | undefined): EvalReport | null {
  if (!archive || !Array.isArray(archive.entries) || archive.entries.length === 0) return null
  return archive.entries[archive.entries.length - 1].report
}

/** 把门禁结论渲染为人类可读文本 */
export function renderGateReport(gate: GateResult): string {
  const lines: string[] = []
  lines.push(`门禁结论：${gate.passed ? '通过' : '阻断'}`)
  lines.push('')

  if (gate.regressions.length > 0) {
    lines.push('阻断项：')
    for (const delta of gate.regressions) {
      lines.push(`- ${delta.metric}：${format(delta.baseline)} → ${format(delta.current)}`)
    }
    lines.push('')
  }

  if (gate.warnings.length > 0) {
    lines.push('告警项：')
    for (const warning of gate.warnings) {
      lines.push(`- ${warning.metric}：${format(warning.baseline)} → ${format(warning.current)}（${warning.reason}）`)
    }
    lines.push('')
  }

  if (gate.improvements.length > 0) {
    lines.push('改善项：')
    for (const delta of gate.improvements) {
      lines.push(`- ${delta.metric}：${format(delta.baseline)} → ${format(delta.current)}`)
    }
    lines.push('')
  }

  if (gate.notes.length > 0) {
    lines.push('说明：')
    for (const note of gate.notes) lines.push(`- ${note}`)
    lines.push('')
  }

  return lines.join('\n')
}

/** 把门禁关注的核心指标转为观测总线可写入的序列 */
export function toObservabilityMetrics(
  report: EvalReport,
  gate: GateResult,
): Array<{ name: string; value: number; labels?: Record<string, string> }> {
  const metrics = extractGateMetrics(report)
  const series: Array<{ name: string; value: number; labels?: Record<string, string> }> = []

  for (const [metric, value] of Object.entries(metrics)) {
    series.push({ name: `eval.${metric}`, value, labels: { source: 'eval_report' } })
  }

  series.push({
    name: 'eval.gate.passed',
    value: gate.passed ? 1 : 0,
    labels: { source: 'eval_report' },
  })
  series.push({
    name: 'eval.gate.regressions',
    value: gate.regressions.length,
    labels: { source: 'eval_report' },
  })

  return series
}

function findDelta(deltas: MetricDelta[], metric: string): MetricDelta | undefined {
  return deltas.find((delta) => delta.metric === metric)
}

function format(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(4)
}
