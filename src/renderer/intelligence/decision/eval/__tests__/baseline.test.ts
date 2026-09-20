/**
 * 决策层评测基线
 *
 * 该测试既是回归门禁，也是收益度量的唯一依据：
 * 任何改动若降低了任务完成率或意图判定准确率，都会在这里失败。
 *
 * 报告输出到 docs/decision-baseline.json 与 docs/decision-baseline.md，
 * 便于纵向对比与评审。
 */

import { describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildEvalReport, runPruneEval, runTaskEval, resolveAllEnabledTools } from '../harness'
import { renderEvalReportMarkdown } from '../report'

const DOCS_DIR = resolve(__dirname, '../../../../../../docs')

describe('决策层评测基线', () => {
  const outcomes = runTaskEval()
  const pruneOutcomes = runPruneEval()
  const report = buildEvalReport(outcomes, pruneOutcomes)

  it('数据集规模符合基线要求', () => {
    expect(report.sampleCount).toBeGreaterThanOrEqual(200)
    expect(report.pruning?.sampleCount).toBeGreaterThanOrEqual(12)
  })

  it('工具描述裁剪后不漏选必需工具（任务完成率 100%）', () => {
    const { rate, failed, failures } = report.taskCompletion
    if (failed > 0) {
      // 失败明细直接打进报错信息，避免定位时再跑一遍
      console.error('漏选必需工具的样本：', failures)
    }
    expect(report.taskCompletion.total).toBeGreaterThanOrEqual(100)
    expect(rate).toBe(1)
  })

  it('裁剪决策与人工标注的一致性达标', () => {
    // 阈值取 0.9：剩余误差来自词表 substring 匹配等已知行为
    expect(report.toolSelection.accuracy).toBeGreaterThanOrEqual(0.9)
    expect(report.toolSelection.prunedRecall).toBeGreaterThanOrEqual(0.9)
    expect(report.toolSelection.prunedPrecision).toBeGreaterThanOrEqual(0.95)
  })

  it('意图判定准确率达标', () => {
    for (const intent of report.intents) {
      expect(intent.total, `${intent.question} 缺少标注样本`).toBeGreaterThan(0)
      expect(intent.accuracy, `${intent.question} 准确率不足`).toBeGreaterThanOrEqual(0.9)
    }
  })

  it('工具预选带来可量化的上下文压缩', () => {
    expect(report.tokens.avgPreselectedTokens).toBeLessThan(report.tokens.avgBaselineTokens)
    expect(report.tokens.avgSavingRatio).toBeGreaterThan(0)
  })

  it('上下文裁剪不丢关键消息且确有收益', () => {
    expect(report.pruning?.criticalRetentionRate).toBe(1)
    expect(report.pruning?.avgTokenReduction ?? 0).toBeGreaterThan(0.15)
  })

  it('命令风险判定不放过需要确认的命令', () => {
    const risk = report.commandRisk
    expect(risk, '报告缺少命令风险指标').toBeDefined()
    if (!risk) return

    if (risk.failures.length > 0) {
      console.error('命令风险判定不一致的样本：', risk.failures)
    }

    expect(risk.sampleCount).toBeGreaterThanOrEqual(36)
    // 硬拦截漏判的代价最高，必须零遗漏
    expect(risk.recallByLevel.find((level) => level.level === 'blocked')?.recall).toBe(1)
    // 把需确认判成安全会让命令静默执行，是第二严重的一类误判
    expect(risk.underFlagged).toBe(0)
    expect(risk.accuracy).toBeGreaterThanOrEqual(0.9)
  })

  it('报告落盘', () => {
    mkdirSync(DOCS_DIR, { recursive: true })
    writeFileSync(
      resolve(DOCS_DIR, 'decision-baseline.json'),
      JSON.stringify(report, null, 2),
      'utf-8',
    )
    writeFileSync(
      resolve(DOCS_DIR, 'decision-baseline.md'),
      renderEvalReportMarkdown(report),
      'utf-8',
    )
    expect(resolveAllEnabledTools().length).toBeGreaterThan(30)
  })
})
