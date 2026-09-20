/**
 * 决策层评测契约
 *
 * 评测目标：在不依赖真实模型调用的前提下，量化决策层的三项指标——
 * 任务完成率（代理）、工具选择准确率、平均输入 Token。
 *
 * 关于「任务完成率」的说明：
 * 离线评测无法真正执行 200 个任务，因此以「任务必需工具是否被完整保留」作为
 * 代理指标。预选漏掉必需工具时，任务必然失败（AI 找不到可用工具），
 * 该代理指标与真实失败之间的因果关系是确定的。
 */

import type { CommandRiskLevel } from '../commandRisk'

/** 预选意图标签（与 toolPreselector 的规则 id 对应） */
export type PreselectIntentId =
  | 'development'
  | 'web-research'
  | 'media'
  | 'data-analysis'
  | 'office-doc'
  | 'none'

/** 单条任务样本 */
export interface TaskEvalSample {
  id: string
  /** 用户最新消息 */
  message: string
  /** 此前消息，供多轮衔接判定使用 */
  history?: string[]
  /**
   * 该消息是否应当触发工具裁剪（人工标注）
   *
   * 这是工具选择准确率的分母：把「预选是否裁剪」当作二分类判定，
   * 与人工标注比对，避免用被测代码的规则反推期望值造成循环论证。
   */
  expectedPruned: boolean
  /** 预期命中的预选意图，用于误判归因（不参与准确率计算） */
  expectedIntents?: PreselectIntentId[]
  /**
   * 任务必需工具（人工标注）
   *
   * 只标注「缺了就做不成」的工具，不追求穷举。预选必须完整保留这些工具，
   * 否则记为任务失败。
   */
  requiredTools?: string[]
  /** 场景工具意图标注，undefined 表示该项不适用 */
  expectedSceneToolsIntent?: boolean
  /** 视觉分析意图标注，undefined 表示该项不适用 */
  expectedVisualAnalysis?: boolean
  /** 样本类别，用于分组统计 */
  group: string
  /**
   * 已知缺陷说明
   *
   * 带有该字段的样本不计入断言分母，仅在报告中单独列出。
   * 用途：记录「实现已知会判错」的样本（如词表 substring 匹配的副作用），
   * 避免它们让基线长期泛红，同时不掩盖问题本身。
   */
  knownIssue?: string
}

/** 上下文裁剪样本（6.3） */
export interface PruneEvalSample {
  id: string
  /** 会话历史（按时间正序） */
  history: Array<{ role: 'user' | 'assistant'; content: string }>
  /** 当前请求 */
  request: string
  /**
   * 必须保留的历史消息下标（人工标注）
   *
   * 判定标准：与当前请求直接相关，或承载未完成任务的上下文
   * （待办、约定、用户约束等）。裁剪后若缺失这些消息，即视为丢信息。
   */
  mustKeepIndices: number[]
}

/** 工具选择指标 */
export interface ToolSelectionMetrics {
  /** 应裁剪样本中被正确裁剪的比例 */
  prunedRecall: number
  /** 判为「应裁剪」的样本中，实际应裁剪的比例 */
  prunedPrecision: number
  /** 裁剪决策的整体准确率 */
  accuracy: number
  truePositive: number
  falsePositive: number
  trueNegative: number
  falseNegative: number
}

/** 任务完成率（代理）指标 */
export interface TaskCompletionMetrics {
  /** 必需工具被完整保留的样本比例 */
  rate: number
  total: number
  failed: number
  /** 失败样本明细，便于定位漏选原因 */
  failures: Array<{ id: string; group: string; missing: string[] }>
}

/** Token 指标 */
export interface TokenMetrics {
  /** 裁剪前（全量工具描述）平均 Token */
  avgBaselineTokens: number
  /** 裁剪后平均 Token */
  avgPreselectedTokens: number
  /** 平均节省 Token */
  avgSavedTokens: number
  /** 平均节省比例（0~1） */
  avgSavingRatio: number
}

/** 意图判定指标（场景工具 / 视觉分析） */
export interface IntentMetrics {
  question: string
  total: number
  correct: number
  accuracy: number
  falsePositive: number
  falseNegative: number
}

/** 命令风险判定样本（6.1） */
export interface CommandRiskEvalSample {
  id: string
  /** 待判定的命令 */
  command: string
  /** 人工标注的风险级别 */
  expectedLevel: CommandRiskLevel
  /** 样本类别，用于分组统计 */
  group: string
  /** 已知缺陷说明，带此字段的样本只统计不断言 */
  knownIssue?: string
}

/** 命令风险判定指标（6.1） */
export interface CommandRiskMetrics {
  sampleCount: number
  /** 判定级别与人工标注完全一致的比例 */
  accuracy: number
  /** 各标注级别的召回率 */
  recallByLevel: Array<{ level: CommandRiskLevel; total: number; correct: number; recall: number }>
  /**
   * 把安全命令判成需确认的次数
   *
   * 代价是每次多一次点击，不阻断任务，属于体验损耗而非功能损坏。
   */
  overFlagged: number
  /**
   * 把危险或需确认的命令放行的次数
   *
   * 这类误判使本该确认的命令直接执行，是评测中最需要压住的数字。
   */
  underFlagged: number
  failures: Array<{
    id: string
    group: string
    command: string
    expected: CommandRiskLevel
    actual: CommandRiskLevel
  }>
}

/** 单次评测汇总 */
export interface EvalReport {
  generatedAt: string
  sampleCount: number
  toolSelection: ToolSelectionMetrics
  taskCompletion: TaskCompletionMetrics
  tokens: TokenMetrics
  intents: IntentMetrics[]
  pruning?: PruneMetrics
  commandRisk?: CommandRiskMetrics
}

/** 上下文裁剪指标（6.3） */
export interface PruneMetrics {
  sampleCount: number
  /** 标注必须保留的消息被完整保留的比例 */
  criticalRetentionRate: number
  /** 裁剪后平均 Token 减少比例（以未裁剪为基线） */
  avgTokenReduction: number
  /** 因安全阀取消裁剪的样本数 */
  skipped: number
  failures: Array<{ id: string; missing: number[] }>
}
