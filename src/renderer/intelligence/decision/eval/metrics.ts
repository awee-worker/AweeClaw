/**
 * 评测指标计算（纯函数）
 *
 * 与评测运行器解耦：本模块只做算术，不触达任何被测代码，
 * 便于单独验证指标本身是否正确。
 */

import type { CommandRiskLevel } from '../commandRisk'
import type { PruneEvalSample, TaskEvalSample } from './types'
import type {
  CommandRiskEvalSample,
  CommandRiskMetrics,
  IntentMetrics,
  PruneMetrics,
  TaskCompletionMetrics,
  TokenMetrics,
  ToolSelectionMetrics,
} from './types'

/** 单条任务样本的实测结果 */
export interface TaskSampleOutcome {
  sample: TaskEvalSample
  /** 是否发生了工具裁剪（预选命中规则） */
  pruned: boolean
  /** 预选命中的意图 id */
  intents: string[]
  /** 预选后的工具集合 */
  tools: string[]
  /** 裁剪前工具描述的 Token 数 */
  baselineTokens: number
  /** 裁剪后工具描述的 Token 数 */
  preselectedTokens: number
  /** 场景工具意图判定结果（样本未标注该判定项时为 undefined） */
  sceneToolsIntent?: boolean
  /** 视觉分析意图判定结果（样本未标注该判定项时为 undefined） */
  visualAnalysis?: boolean
}

/** 是否计入断言：带已知缺陷标注的样本只统计不断言 */
export function isAssertable(sample: TaskEvalSample): boolean {
  return !sample.knownIssue
}

/**
 * 工具选择准确率
 *
 * 把「是否应当裁剪」视为二分类问题，与人工标注比对。
 * 不用被测规则反推期望值，避免循环论证。
 */
export function computeToolSelectionMetrics(outcomes: TaskSampleOutcome[]): ToolSelectionMetrics {
  let truePositive = 0
  let falsePositive = 0
  let trueNegative = 0
  let falseNegative = 0

  for (const outcome of outcomes) {
    if (!isAssertable(outcome.sample)) continue
    const expected = outcome.sample.expectedPruned
    const actual = outcome.pruned
    if (expected && actual) truePositive++
    else if (!expected && actual) falsePositive++
    else if (!expected && !actual) trueNegative++
    else falseNegative++
  }

  const total = truePositive + falsePositive + trueNegative + falseNegative
  return {
    prunedRecall: truePositive + falseNegative > 0 ? truePositive / (truePositive + falseNegative) : 1,
    prunedPrecision: truePositive + falsePositive > 0 ? truePositive / (truePositive + falsePositive) : 1,
    accuracy: total > 0 ? (truePositive + trueNegative) / total : 1,
    truePositive,
    falsePositive,
    trueNegative,
    falseNegative,
  }
}

/**
 * 任务完成率（代理）
 *
 * 判定标准：任务必需工具被预选完整保留。漏选必然导致任务失败，
 * 该代理与真实失败之间是确定的因果关系。
 */
export function computeTaskCompletion(outcomes: TaskSampleOutcome[]): TaskCompletionMetrics {
  let total = 0
  let failed = 0
  const failures: TaskCompletionMetrics['failures'] = []

  for (const outcome of outcomes) {
    const required = outcome.sample.requiredTools
    if (!required || required.length === 0) continue
    total++
    const kept = new Set(outcome.tools)
    const missing = required.filter((tool) => !kept.has(tool))
    if (missing.length > 0) {
      failed++
      failures.push({ id: outcome.sample.id, group: outcome.sample.group, missing })
    }
  }

  return {
    rate: total > 0 ? (total - failed) / total : 1,
    total,
    failed,
    failures,
  }
}

/** Token 指标：裁剪前后对比 */
export function computeTokenMetrics(outcomes: TaskSampleOutcome[]): TokenMetrics {
  if (outcomes.length === 0) {
    return { avgBaselineTokens: 0, avgPreselectedTokens: 0, avgSavedTokens: 0, avgSavingRatio: 0 }
  }

  let baseline = 0
  let preselected = 0
  for (const outcome of outcomes) {
    baseline += outcome.baselineTokens
    preselected += outcome.preselectedTokens
  }

  const avgBaselineTokens = baseline / outcomes.length
  const avgPreselectedTokens = preselected / outcomes.length
  const avgSavedTokens = avgBaselineTokens - avgPreselectedTokens

  return {
    avgBaselineTokens: round1(avgBaselineTokens),
    avgPreselectedTokens: round1(avgPreselectedTokens),
    avgSavedTokens: round1(avgSavedTokens),
    avgSavingRatio: baseline > 0 ? round4((baseline - preselected) / baseline) : 0,
  }
}

/** 意图判定准确率（场景工具 / 视觉分析） */
export function computeIntentMetrics(
  question: string,
  rows: Array<{ expected: boolean; actual: boolean | undefined }>,
): IntentMetrics {
  let correct = 0
  let falsePositive = 0
  let falseNegative = 0
  let total = 0

  for (const row of rows) {
    if (row.actual === undefined) continue
    total++
    if (row.actual === row.expected) correct++
    else if (row.actual && !row.expected) falsePositive++
    else falseNegative++
  }

  return {
    question,
    total,
    correct,
    accuracy: total > 0 ? round4(correct / total) : 1,
    falsePositive,
    falseNegative,
  }
}

/** 上下文裁剪结果 */
export interface PruneSampleOutcome {
  sample: PruneEvalSample
  /** 裁剪后保留的历史消息下标 */
  keptIndices: number[]
  /** 裁剪前 Token */
  baselineTokens: number
  /** 裁剪后 Token */
  prunedTokens: number
  /** 是否因安全阀取消了裁剪 */
  skipped: boolean
}

/**
 * 上下文裁剪指标
 *
 * 关注两件事：是否丢失了人工标注为「必须保留」的消息（安全性），
 * 以及实际减少了多少 Token（有效性）。
 */
export function computePruneMetrics(outcomes: PruneSampleOutcome[]): PruneMetrics {
  let fullyRetained = 0
  let skipped = 0
  let reductionSum = 0
  let reductionCount = 0
  const failures: PruneMetrics['failures'] = []

  for (const outcome of outcomes) {
    const kept = new Set(outcome.keptIndices)
    const missing = outcome.sample.mustKeepIndices.filter((index) => !kept.has(index))
    if (missing.length === 0) fullyRetained++
    else failures.push({ id: outcome.sample.id, missing })

    if (outcome.skipped) skipped++
    if (outcome.baselineTokens > 0) {
      reductionSum += (outcome.baselineTokens - outcome.prunedTokens) / outcome.baselineTokens
      reductionCount++
    }
  }

  return {
    sampleCount: outcomes.length,
    criticalRetentionRate: outcomes.length > 0 ? round4(fullyRetained / outcomes.length) : 1,
    avgTokenReduction: reductionCount > 0 ? round4(reductionSum / reductionCount) : 0,
    skipped,
    failures,
  }
}

/** 命令风险判定结果 */
export interface CommandRiskOutcome {
  sample: CommandRiskEvalSample
  /** 实际判定出的风险级别 */
  actual: CommandRiskLevel
}

/**
 * 命令风险判定指标
 *
 * 两类误判分开计数，因为代价不对等：
 * - overFlagged（安全判成需确认）只是多一次点击
 * - underFlagged（危险或需确认判成安全）会让命令在无人确认的情况下执行
 */
export function computeCommandRiskMetrics(
  outcomes: CommandRiskOutcome[],
): CommandRiskMetrics {
  const levels: CommandRiskLevel[] = ['blocked', 'review', 'safe']
  const counters = new Map<CommandRiskLevel, { total: number; correct: number }>(
    levels.map((level) => [level, { total: 0, correct: 0 }]),
  )

  let correct = 0
  let overFlagged = 0
  let underFlagged = 0
  const failures: CommandRiskMetrics['failures'] = []

  for (const outcome of outcomes) {
    if (outcome.sample.knownIssue) continue

    const { expectedLevel } = outcome.sample
    const actual = outcome.actual
    const bucket = counters.get(expectedLevel)
    if (bucket) {
      bucket.total++
      if (actual === expectedLevel) bucket.correct++
    }

    if (actual === expectedLevel) {
      correct++
      continue
    }

    if (expectedLevel === 'safe' && actual !== 'safe') overFlagged++
    else if (expectedLevel !== 'safe' && actual === 'safe') underFlagged++

    failures.push({
      id: outcome.sample.id,
      group: outcome.sample.group,
      command: outcome.sample.command,
      expected: expectedLevel,
      actual,
    })
  }

  const total = outcomes.filter((outcome) => !outcome.sample.knownIssue).length

  return {
    sampleCount: total,
    accuracy: total > 0 ? round4(correct / total) : 1,
    recallByLevel: levels.map((level) => {
      const bucket = counters.get(level) ?? { total: 0, correct: 0 }
      return {
        level,
        total: bucket.total,
        correct: bucket.correct,
        recall: bucket.total > 0 ? round4(bucket.correct / bucket.total) : 1,
      }
    }),
    overFlagged,
    underFlagged,
    failures,
  }
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000
}
