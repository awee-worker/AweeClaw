/**
 * 决策层统一出口
 *
 * 使用方式：
 * 1. 直接判定：decisionService.decideOne(state, booleanQuestion(id, text))
 * 2. 工具裁剪：preselectTools({ userMessage, allowedTools })
 * 3. 扩展规则：ruleProvider.register(questionId, evaluator)
 */

export type {
  BooleanQuestion,
  ChoiceOption,
  ChoiceQuestion,
  DecisionAnswer,
  DecisionOptions,
  DecisionProvider,
  DecisionQuestion,
  DecisionQuestionKind,
  DecisionResult,
  DecisionSource,
  DecisionState,
  DecisionValue,
  ScoreQuestion,
} from './types'

export {
  isLowConfidence,
  readBooleanAnswer,
  readChoiceAnswer,
  readScoreAnswer,
} from './types'

export {
  DecisionService,
  decisionService,
  booleanQuestion,
  choiceQuestion,
  scoreQuestion,
  DEFAULT_LOW_CONFIDENCE_THRESHOLD,
  type DecisionRequest,
  type SingleDecision,
} from './DecisionService'

export {
  RuleProvider,
  ruleProvider,
  QUESTION_DANGEROUS_COMMAND,
  QUESTION_COMMAND_RISK,
  QUESTION_SCENE_TOOLS_INTENT,
  QUESTION_VISUAL_ANALYSIS_INTENT,
  type RuleEvaluator,
} from './RuleProvider'

export {
  assessCommandRisk,
  needsCommandApproval,
  listReviewRuleIds,
  type CommandRiskAssessment,
  type CommandRiskLevel,
} from './commandRisk'

export { LlmProvider, llmProvider, type LlmDecisionDeps } from './LlmProvider'

export {
  preselectTools,
  DEFAULT_MIN_TOOLS_TO_PRESELECT,
  type PreselectParams,
  type ToolPreselection,
} from './toolPreselector'

export {
  resolveSceneToolsIntent,
  resolveSceneToolsIntentFromMessages,
  resolveVisualAnalysisIntent,
  resolveSceneToolsIntentAsync,
  resolveVisualAnalysisIntentAsync,
  type IntentResolution,
} from './intentResolvers'
