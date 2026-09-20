/**
 * 评测运行器
 *
 * 职责：把数据集喂给被测链路，收集实测结果并计算指标。
 * 不包含断言——断言在测试文件中，便于同一份结果既用于回归门禁，也用于生成报告。
 *
 * 被测范围：
 * - 工具预选（tokenPreselector）：是否裁剪、裁剪后工具集、Token 变化
 * - 意图判定出口（intentResolvers）：场景工具意图、视觉分析意图
 * - 历史裁剪（contextPruner）：是否丢关键消息、Token 减少比例
 */

import { TOOL_CONFIGS, generateToolsPromptDescriptionFiltered } from '@configuration/toolDefinitions'
import { countTokens } from '@shared/toolkit/tokenEstimator'
import { pruneHistory, type PrunableMessage } from '@intelligence/capabilities/context/contextPruner'
import { assessCommandRisk } from '../commandRisk'
import {
  resolveSceneToolsIntent,
  resolveVisualAnalysisIntent,
} from '../intentResolvers'
import { preselectTools } from '../toolPreselector'
import {
  COMMAND_RISK_EVAL_SAMPLES,
  PRUNE_EVAL_SAMPLES,
  TASK_EVAL_SAMPLES,
} from './dataset'
import {
  computeCommandRiskMetrics,
  computeIntentMetrics,
  computePruneMetrics,
  computeTaskCompletion,
  computeTokenMetrics,
  computeToolSelectionMetrics,
  type CommandRiskOutcome,
  type PruneSampleOutcome,
  type TaskSampleOutcome,
} from './metrics'
import type { EvalReport } from './types'

/** 评测所使用的工具全集：取所有启用的工具，模拟最坏情况（不做任何维度过滤） */
export function resolveAllEnabledTools(): string[] {
  return Object.values(TOOL_CONFIGS)
    .filter((config) => config.enabled)
    .map((config) => config.name)
}

/** 工具描述文本的 Token 数 */
export function measureToolPromptTokens(tools: string[]): number {
  return countTokens(generateToolsPromptDescriptionFiltered([], tools))
}

/** 运行任务样本评测 */
export function runTaskEval(): TaskSampleOutcome[] {
  const allowedTools = resolveAllEnabledTools()
  const baselineTokens = measureToolPromptTokens(allowedTools)

  return TASK_EVAL_SAMPLES.map((sample) => {
    const preselection = preselectTools({ userMessage: sample.message, allowedTools })
    const pruned = preselection.source === 'rule'

    return {
      sample,
      pruned,
      intents: preselection.intents,
      tools: preselection.tools,
      baselineTokens,
      preselectedTokens: pruned ? measureToolPromptTokens(preselection.tools) : baselineTokens,
      sceneToolsIntent: sample.expectedSceneToolsIntent === undefined
        ? undefined
        : resolveSceneToolsIntent({ userMessage: sample.message }).value,
      visualAnalysis: sample.expectedVisualAnalysis === undefined
        ? undefined
        : resolveVisualAnalysisIntent({ userMessage: sample.message }).value,
    }
  })
}

/** 运行上下文裁剪评测 */
export function runPruneEval(): PruneSampleOutcome[] {
  return PRUNE_EVAL_SAMPLES.map((sample) => {
    const messages: Array<PrunableMessage & { sourceIndex: number }> = sample.history.map(
      (message, index) => ({ role: message.role, content: message.content, sourceIndex: index }),
    )

    const result = pruneHistory(messages, sample.request)
    const keptIndices = result.messages.map((message) => (message as { sourceIndex: number }).sourceIndex)

    return {
      sample,
      keptIndices,
      baselineTokens: result.stats.baselineTokens,
      prunedTokens: result.stats.prunedTokens,
      skipped: result.stats.skipped,
    }
  })
}

/** 运行命令风险判定评测 */
export function runCommandRiskEval(): CommandRiskOutcome[] {
  return COMMAND_RISK_EVAL_SAMPLES.map((sample) => ({
    sample,
    actual: assessCommandRisk(sample.command).level,
  }))
}

/** 汇总为完整评测报告 */
export function buildEvalReport(
  outcomes: TaskSampleOutcome[] = runTaskEval(),
  pruneOutcomes: PruneSampleOutcome[] = runPruneEval(),
  commandRiskOutcomes: CommandRiskOutcome[] = runCommandRiskEval(),
): EvalReport {
  return {
    generatedAt: new Date().toISOString(),
    sampleCount: outcomes.length,
    toolSelection: computeToolSelectionMetrics(outcomes),
    taskCompletion: computeTaskCompletion(outcomes),
    tokens: computeTokenMetrics(outcomes),
    intents: [
      computeIntentMetrics(
        'scene_tools_intent',
        outcomes
          .filter((outcome) => !outcome.sample.knownIssue)
          .map((outcome) => ({
            expected: outcome.sample.expectedSceneToolsIntent as boolean,
            actual: outcome.sceneToolsIntent,
          })),
      ),
      computeIntentMetrics(
        'visual_analysis_intent',
        outcomes
          .filter((outcome) => !outcome.sample.knownIssue)
          .map((outcome) => ({
            expected: outcome.sample.expectedVisualAnalysis as boolean,
            actual: outcome.visualAnalysis,
          })),
      ),
    ],
    pruning: computePruneMetrics(pruneOutcomes),
    commandRisk: computeCommandRiskMetrics(commandRiskOutcomes),
  }
}
