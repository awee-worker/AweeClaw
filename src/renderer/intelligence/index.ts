/**
 * Intelligence 模块统一入口
 *
 * 按领域分组聚合导出，消费方按需引用对应分组。
 */

/* ------------------------------------------------------------------ */
/* 类型定义                                                           */
/* ------------------------------------------------------------------ */
export * from '@intelligence/providerTypes'

/* ------------------------------------------------------------------ */
/* 状态存储                                                           */
/* ------------------------------------------------------------------ */
export {
  useAgentStore,
  selectCurrentThread,
  selectMessages,
  selectMessageListState,
  selectMessageCount,
  selectStreamState,
  selectContextItems,
  selectIsStreaming,
  selectIsAwaitingApproval,
  selectBranches,
  selectActiveBranch,
  selectIsOnBranch,
  selectContextStats,
  selectInputPrompt,
  selectCurrentSessionId,
  selectCompressionStats,
  selectHandoffState,
  selectHandoffDocument,
  selectHandoffRequired,
  selectContextSummary,
  selectCompressionPhase,
  selectIsCompacting,
} from './state/IntelligenceStore'
export type { ContextStats } from './state/IntelligenceStore'

/* ------------------------------------------------------------------ */
/* 核心引擎                                                           */
/* ------------------------------------------------------------------ */
export { Agent, EventBus, approvalService } from '@intelligence/engine'
export type { LLMConfig, AgentEvent, EventType } from '@intelligence/engine'

/* ------------------------------------------------------------------ */
/* 工具系统                                                           */
/* ------------------------------------------------------------------ */
export { toolRegistry, TOOL_DEFINITIONS, TOOL_DISPLAY_NAMES } from './toolkit'
export { getToolApprovalType, getToolDisplayName } from '@configuration/toolDefinitions'

/* ------------------------------------------------------------------ */
/* 运行时服务                                                         */
/* ------------------------------------------------------------------ */
export { lintService } from './runtime/codeAnalysisService'
export { streamingEditService } from './runtime/streamingEditor'
export { rulesService } from './runtime/ruleEngine'
export { memoryService } from './runtime/recallService'
export type { MemoryItem } from './runtime/recallService'
export { knowledgeService } from './runtime/knowledgeService'
export { knowledgeExtractor } from './runtime/knowledgeService/extractor'
export type {
  KnowledgeEntry,
  KnowledgeCategory,
  KnowledgeSource,
  KnowledgeSearchParams,
  KnowledgeSearchResult,
  KnowledgeEntryInput,
} from './runtime/knowledgeService/providerTypes'
export { longTermMemoryService } from './runtime/longTermMemoryService'
export { dreamingScheduler } from './runtime/longTermMemoryService/dreamingScheduler'
export type {
  MemoryEntry,
  MemorySource,
  MemoryStatus,
  MemorySearchParams,
  MemorySearchResult,
  DreamingConfig,
} from './runtime/longTermMemoryService/providerTypes'
export { skillService } from './runtime/skillRepository'
export type { SkillItem } from './runtime/skillRepository'
export { composerService } from './runtime/composerEngine'

/* ------------------------------------------------------------------ */
/* 上下文管理                                                         */
/* ------------------------------------------------------------------ */
export {
  prepareMessages,
  updateStats,
  calculateLevel,
  LEVEL_NAMES,
  buildHandoffContext,
  buildWelcomeMessage,
} from './contextModel'
export type {
  CompressionLevel,
  CompressionStats,
  StructuredSummary,
  HandoffDocument,
} from './contextModel'

/* ------------------------------------------------------------------ */
/* 工具函数                                                           */
/* ------------------------------------------------------------------ */
export { MentionParser } from '@intelligence/utils/mentionDecoder'
export type { MentionCandidate, MentionParseResult } from '@intelligence/utils/mentionDecoder'

/* ------------------------------------------------------------------ */
/* 配置                                                               */
/* ------------------------------------------------------------------ */
export { getAgentConfig } from './utils/intelligenceConfig'

/* ------------------------------------------------------------------ */
/* 引擎初始化                                                         */
/* ------------------------------------------------------------------ */
export {
  initializeEngines,
  initializeBehaviorEngine,
  initializeSubAgentEngine,
  disposeEngines,
  getInitializedBehaviorEngine,
  getInitializedSubAgentEngine,
} from './engine/engineInitializer'
export { BehaviorEngine } from './runtime/BehaviorEngine'
export type { BehaviorRule, TriggerType, ActionType } from './runtime/BehaviorEngine'
export { SubAgentEngine } from './engine/SubAgentEngine'
export type { BackgroundTask, TaskStatus, TaskProgressEvent, TaskResultEvent } from './engine/SubAgentEngine'

/* ------------------------------------------------------------------ */
/* 错误处理                                                           */
/* ------------------------------------------------------------------ */
export { isRetryableError } from '@toolkit'

/* ------------------------------------------------------------------ */
/* 提示词                                                             */
/* ------------------------------------------------------------------ */
export { buildAgentSystemPrompt } from './prompt-engine/PromptComposer'

/* ------------------------------------------------------------------ */
/* 会话分支                                                           */
/* ------------------------------------------------------------------ */
export type { Branch } from './state/slices/conversationBranch'
