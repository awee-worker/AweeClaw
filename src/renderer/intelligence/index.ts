/**
 * Agent 模块统一导出
 */

// 类型（统一来源）
export * from '@intelligence/providerTypes'

// Store
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

// 核心模块（新架构）
export { Agent, EventBus, approvalService } from '@intelligence/engine'
export type { LLMConfig, AgentEvent, EventType } from '@intelligence/engine'

// 工具系统
export {
    toolRegistry,
    TOOL_DEFINITIONS,
    TOOL_DISPLAY_NAMES,
} from './toolkit'
export { getToolApprovalType, getToolDisplayName } from '@configuration/toolDefinitions'

// 其他服务
export { lintService } from './runtime/codeAnalysisService'
export { streamingEditService } from './runtime/streamingEditor'
export { rulesService } from './runtime/ruleEngine'
export { memoryService } from './runtime/recallService'
export type { MemoryItem } from './runtime/recallService'
export { knowledgeService } from './runtime/knowledgeService'
export { knowledgeExtractor } from './runtime/knowledgeService/extractor'
export type { KnowledgeEntry, KnowledgeCategory, KnowledgeSource, KnowledgeSearchParams, KnowledgeSearchResult, KnowledgeEntryInput } from './runtime/knowledgeService/providerTypes'
export { longTermMemoryService } from './runtime/longTermMemoryService'
export { dreamingScheduler } from './runtime/longTermMemoryService/dreamingScheduler'
export type { MemoryEntry, MemorySource, MemoryStatus, MemorySearchParams, MemorySearchResult, DreamingConfig } from './runtime/longTermMemoryService/providerTypes'
export { skillService } from './runtime/skillRepository'
export type { SkillItem } from './runtime/skillRepository'
export { composerService } from './runtime/composerEngine'

// 上下文管理
export {
    prepareMessages,
    updateStats,
    calculateLevel,
    LEVEL_NAMES,
    buildHandoffContext,
    buildWelcomeMessage,
} from './contextModel'
export type { CompressionLevel, CompressionStats, StructuredSummary, HandoffDocument } from './contextModel'

// 工具函数
export { MentionParser, SPECIAL_MENTIONS } from '@intelligence/utils/mentionDecoder'
export type { MentionCandidate, MentionParseResult } from '@intelligence/utils/mentionDecoder'

// 配置
export { getAgentConfig } from './utils/intelligenceConfig'

// 重试工具（从 shared 导出）
export { isRetryableError } from '@toolkit'

// Prompts
export { buildAgentSystemPrompt } from './prompt-engine/PromptComposer'

// 分支类型
export type { Branch } from './state/slices/conversationBranch'
