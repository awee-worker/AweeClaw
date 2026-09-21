/**
 * 评测报告渲染
 *
 * 输出 Markdown，便于直接落盘到 docs/ 供评审与纵向对比。
 */

import type { EvalReport } from './types'

/** 明细列表中每类最多展示的条数 */
const MAX_LISTED_FAILURES = 20

export function renderEvalReportMarkdown(report: EvalReport): string {
  const lines: string[] = []

  lines.push('# 决策层评测基线')
  lines.push('')
  lines.push(`生成时间：${report.generatedAt}`)
  lines.push(
    `样本数：${report.sampleCount}（任务）+ ${report.pruning?.sampleCount ?? 0}（上下文裁剪）` +
      ` + ${report.commandRisk?.sampleCount ?? 0}（命令风险）`,
  )
  lines.push('')

  lines.push('## 总体指标')
  lines.push('')
  lines.push('| 指标 | 数值 | 说明 |')
  lines.push('| --- | --- | --- |')
  lines.push(`| 任务完成率（代理） | ${percent(report.taskCompletion.rate)} | 必需工具被完整保留的比例，目标 100% |`)
  lines.push(`| 工具选择准确率 | ${percent(report.toolSelection.accuracy)} | 裁剪决策与人工标注一致的比例 |`)
  lines.push(`| 裁剪召回率 | ${percent(report.toolSelection.prunedRecall)} | 应裁剪样本中实际被裁剪的比例 |`)
  lines.push(`| 裁剪精确率 | ${percent(report.toolSelection.prunedPrecision)} | 判为应裁剪的样本中确实应裁剪的比例 |`)
  lines.push(`| 平均输入 Token（裁剪前） | ${report.tokens.avgBaselineTokens} | 工具描述部分 |`)
  lines.push(`| 平均输入 Token（裁剪后） | ${report.tokens.avgPreselectedTokens} | 同上 |`)
  lines.push(`| 平均节省 Token | ${report.tokens.avgSavedTokens} | 全量样本均值 |`)
  lines.push(`| 平均节省比例 | ${percent(report.tokens.avgSavingRatio)} | 同上 |`)
  lines.push('')

  lines.push('## 混淆矩阵（裁剪决策）')
  lines.push('')
  lines.push('| | 实际应裁剪 | 实际应保留 |')
  lines.push('| --- | --- | --- |')
  lines.push(`| 判定为裁剪 | ${report.toolSelection.truePositive} | ${report.toolSelection.falsePositive} |`)
  lines.push(`| 判定为保留 | ${report.toolSelection.falseNegative} | ${report.toolSelection.trueNegative} |`)
  lines.push('')

  lines.push('## 意图判定')
  lines.push('')
  lines.push('| 判定项 | 样本数 | 正确 | 准确率 | 误判为正 | 误判为负 |')
  lines.push('| --- | --- | --- | --- | --- | --- |')
  for (const intent of report.intents) {
    lines.push(
      `| ${intent.question} | ${intent.total} | ${intent.correct} | ${percent(intent.accuracy)} | ` +
        `${intent.falsePositive} | ${intent.falseNegative} |`,
    )
  }
  lines.push('')
  if (report.commandRisk) {
    lines.push('## 命令风险判定')
    lines.push('')
    lines.push('| 指标 | 数值 | 说明 |')
    lines.push('| --- | --- | --- |')
    lines.push(`| 判定准确率 | ${percent(report.commandRisk.accuracy)} | 判定级别与人工标注一致的比例 |`)
    lines.push(`| 误判为需确认 | ${report.commandRisk.overFlagged} | 安全命令被要求确认，代价是一次多余点击 |`)
    lines.push(`| 误判为放行 | ${report.commandRisk.underFlagged} | 需确认的命令被静默执行，代价最高 |`)
    lines.push('')
    lines.push('| 标注级别 | 样本数 | 正确 | 召回率 |')
    lines.push('| --- | --- | --- | --- |')
    for (const level of report.commandRisk.recallByLevel) {
      lines.push(`| ${level.level} | ${level.total} | ${level.correct} | ${percent(level.recall)} |`)
    }
    lines.push('')
    if (report.commandRisk.failures.length > 0) {
      lines.push('判定不一致明细：')
      lines.push('')
      for (const failure of report.commandRisk.failures.slice(0, MAX_LISTED_FAILURES)) {
        lines.push(
          `- ${failure.id}：标注 ${failure.expected}，实际 ${failure.actual} —— \`${failure.command}\``,
        )
      }
      lines.push('')
    }
  }


  if (report.pruning) {
    lines.push('## 上下文裁剪')
    lines.push('')
    lines.push('| 指标 | 数值 | 说明 |')
    lines.push('| --- | --- | --- |')
    lines.push(`| 关键消息保留率 | ${percent(report.pruning.criticalRetentionRate)} | 标注必须保留的消息未被丢弃的比例，目标 100% |`)
    lines.push(`| 平均 Token 减少 | ${percent(report.pruning.avgTokenReduction)} | 相对未裁剪基线 |`)
    lines.push(`| 安全阀跳过 | ${report.pruning.skipped} | 因收益不足或风险过高取消裁剪的样本数 |`)
    lines.push('')
    if (report.pruning.failures.length > 0) {
      lines.push('关键消息丢失明细：')
      lines.push('')
      for (const failure of report.pruning.failures.slice(0, MAX_LISTED_FAILURES)) {
        lines.push(`- ${failure.id}：丢失下标 ${failure.missing.join(', ')}`)
      }
      lines.push('')
    }
  }

  if (report.trajectory) {
    const trajectory = report.trajectory
    lines.push('## 执行轨迹')
    lines.push('')
    lines.push('| 指标 | 数值 | 说明 |')
    lines.push('| --- | --- | --- |')
    lines.push(`| 工具调用总步数 | ${trajectory.totalSteps} | 本次执行的实际步数 |`)
    lines.push(`| 无效重试次数 | ${trajectory.futileRetries} | 同工具同参数重复且前一步无进展的额外次数 |`)
    lines.push(`| 无效重试占比 | ${percent(trajectory.futileRetryRatio)} | 相对总步数 |`)
    lines.push(`| 循环检出次数 | ${trajectory.loopDetections} | 被循环检测拦截的步数 |`)
    lines.push(
      `| 首次可用结果步序 | ${trajectory.firstUsefulStep ?? '未产出'} | 越小越好，null 表示全程无有效产出 |`,
    )
    lines.push(`| 压缩触发次数 | ${trajectory.compressionEvents.length} | 上下文压缩事件的次数 |`)
    lines.push('')
    if (trajectory.compressionEvents.length > 0) {
      lines.push('压缩事件分布：')
      lines.push('')
      lines.push('| 级别 | 触发时刻 |')
      lines.push('| --- | --- |')
      for (const event of trajectory.compressionEvents) {
        lines.push(`| L${event.level} | ${new Date(event.at).toISOString()} |`)
      }
      lines.push('')
    }
  }

  if (report.stability) {
    const stability = report.stability
    lines.push('## 运行稳定性')
    lines.push('')
    lines.push('| 指标 | 数值 | 说明 |')
    lines.push('| --- | --- | --- |')
    lines.push(`| 重复次数 | ${stability.runs} | 同一批用例的执行轮数 |`)
    lines.push(`| 全部通过 | ${stability.passAll} | 该轮全部用例通过 |`)
    lines.push(`| 部分通过 | ${stability.passSome} | 存在随机性，单独看某一轮会误判 |`)
    lines.push(`| 全部失败 | ${stability.passNone} | 真实缺陷信号 |`)
    lines.push(`| 通过率方差 | ${stability.variance} | 数值越大说明结果越不稳定 |`)
    lines.push('')
    lines.push(`各轮通过率：${stability.passRates.map((rate) => percent(rate)).join(' / ')}`)
    lines.push('')
  }

  lines.push('## 失败明细')
  lines.push('')
  if (report.taskCompletion.failures.length === 0) {
    lines.push('无：所有标注必需的工具均被完整保留。')
  } else {
    for (const failure of report.taskCompletion.failures.slice(0, MAX_LISTED_FAILURES)) {
      lines.push(`- ${failure.id}（${failure.group}）：缺少 ${failure.missing.join(', ')}`)
    }
  }
  lines.push('')

  return lines.join('\n')
}

function percent(ratio: number): string {
  return `${(ratio * 100).toFixed(2)}%`
}
