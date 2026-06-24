/**
 * 智能层类型入口 — 统一导出智能层使用的所有类型
 *
 * 聚合来自多个来源的类型，使消费者可以从单一的
 * "@intelligence/providerTypes" 入口导入。
 */

// ============================================
// Shared protocol types (model, tool, message)
// ============================================

export type {
  TextContent,
  ImageContent,
  FileContent,
  MessageContent,
  MessageContentPart,
  LLMMessage,
  LLMToolCallMessage,
  LLMConfig,
  LLMParameters,
  LLMProviderOptions,
  LLMToolCall,
  LLMStreamSource,
  LLMStreamChunk,
  LLMResult,
  LLMError,
  LLMErrorCode,
  LLMSendMessageParams,
  ToolDefinition,
  ToolPropertySchema,
  ToolCall,
  ToolStatus,
  ToolApprovalType,
  ToolResultType,
  ToolConcurrencyMode,
  ToolResultSemantics,
  ToolValidationLevel,
  ToolRetryPolicy,
  ToolExecutionOutcome,
  ToolExecutionEnvelope,
  ToolStreamingPreview,
  ToolExecutionResult,
  ToolRichContentType,
  ToolRichContent,
  ToolExecutionContext,
  ToolExecutor,
  ValidationResult,
  CodeGraphNode,
  ProviderType,
} from '@shared/protocols/modelProtocol'

// ============================================
// Shared configuration types
// ============================================

export type {
  ProviderConfig,
  AutoApproveSettings,
  LoopDetectionConfig,
  AgentConfig,
  TerminalConfig,
  GitConfig,
  LspConfig,
  PerformanceConfig,
  AiCompletionConfig,
  EditorConfig,
  SecurityPolicyPanel,
  WebSearchConfig,
  McpConfig,
  PersistedLLMConfig,
  AppSettings,
} from '@shared/configuration/configTypes'

export type {
  ProviderModelConfig,
  SettingsState,
  SettingKey,
  SettingMeta,
  SettingsSchema,
  SettingValue,
} from '@shared/configuration/preferenceSchema'

export type {
  LLMConfig as PersistedLLMConfigType,
} from '@shared/configuration/configTypes'

// ============================================
// Conversation model types
// ============================================

export type {
  TextPart,
  ReasoningPart,
  ToolCallPart,
  SearchPart,
  SystemAlertPart,
  ContextSnapshotPart,
  SourcesPart,
  LintCheckPart,
  LintCheckFile,
  AssistantPart,
  FormPart,
  MultiAgentWorkflowPart,
  AgentWorkflowNode,
  TokenUsage,
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  CheckpointMessage,
  InterruptedToolMessage,
  ChatMessage,
} from './types/conversationModel'

export {
  isUserMessage,
  isAssistantMessage,
  isToolResultMessage,
  isCheckpointMessage,
  isInterruptedToolMessage,
  isTextPart,
  isReasoningPart,
  isToolCallPart,
  isSearchPart,
  isSystemAlertPart,
  isLintCheckPart,
  isContextSnapshotPart,
  isSourcesPart,
  isFormPart,
  isMultiAgentWorkflowPart,
  getMessageText,
  getMessageImages,
  getMessageFiles,
} from './types/conversationModel'

// ============================================
// Context model types
// ============================================

export type {
  ContextItemType,
  FileContext,
  CodeSelectionContext,
  FolderContext,
  CodebaseContext,
  GitContext,
  TerminalContext,
  SymbolsContext,
  WebContext,
  ProblemsContext,
  SkillContext,
  ContextItem,
} from './types/contextModel'

// ============================================
// Context management types
// ============================================

export type {
  CompressionLevel,
} from './capabilities/context/compressionUtils'

export type {
  CompressionStats,
} from './capabilities/context/ContextCompressor'

export type {
  StructuredSummary,
  HandoffDocument,
  DecisionPoint,
  FileChangeRecord as ContextFileChangeRecord,
  MessageGroup,
  OptimizedContext,
} from './capabilities/context/contextTypes'

// ============================================
// Thread model types
// ============================================

export type {
  ContextStats,
  TodoItem,
  StreamPhase,
  StreamDetail,
  WaitPhase,
  CompressionPhase,
  ThreadHandoffStatus,
  ThreadHandoffState,
  ThreadExecutionMeta,
  PendingToolApproval,
  StreamState,
  HandoffResumeMeta,
  ChatThread,
  PersistedChatThread,
} from './types/dialogThreadModel'

export {
  createIdleHandoffState,
  createRuntimeThreadState,
  toPersistedChatThread,
  fromPersistedChatThread,
  getThreadDisplayTitle,
} from './types/dialogThreadModel'

// ============================================
// Interactive session types
// ============================================

export type {
  InteractiveOption,
  InteractiveContent,
} from './types/interactiveSession'

// ============================================
// Form types
// ============================================

export type {
  FormFieldType,
  FormFieldOption,
  FormField,
  FormContent,
} from './types/form'

// ============================================
// File mutation types
// ============================================

export type {
  ChangeType,
  FileChangeDescriptor,
  FileChangeStatus,
  FileChangeRecord,
} from './types/fileMutation'

// ============================================
// Session snapshot types
// ============================================

export type {
  FileSnapshot,
  CheckpointImage,
  PendingChange,
  MessageCheckpoint,
  Checkpoint,
} from './types/sessionSnapshot'

// ============================================
// Service contract types
// ============================================

export type {
  LintError,
  StreamingEditState,
} from './types/serviceContracts'

// ============================================
// Plan types
// ============================================

export type {
  PlanState,
  TaskStatus,
  ExecutionMode,
  PlanStatus,
  TaskExecutionClass,
  TaskResourceScope,
  DependencySummary,
  PlanTask,
  TaskPlan,
  TaskExecutionContext,
  TaskExecutionResult,
  ExecutionStats,
  ExecutionSessionTaskBinding,
  ExecutionSession,
  PlanEvent,
  PlanConfig,
} from './planner/planTypes'

export {
  DEFAULT_PLAN_CONFIG,
} from './planner/planTypes'

// ============================================
// Memory types
// ============================================

export type {
  MemorySource,
  MemoryStatus,
  VerificationStatus,
  CorrectionChain,
  MemoryEntry,
  MemoryEntryInput,
  MemorySearchParams,
  MemorySearchResult,
  MemoryStore,
  DreamingConfig,
  ReflectionInsight,
  ReflectionResult,
  LearningEventType,
  SelfLearningRecord,
  BehavioralPattern,
  LearningResult,
  KnowledgeDomain,
  KnowledgeGap,
  MetacognitiveState,
  TaskType,
  MemoryRetrievalContext,
} from './runtime/longTermMemoryService/types'

// ============================================
// Knowledge types
// ============================================

export type {
  KnowledgeSource,
  KnowledgeCategory,
  KnowledgeEntry,
  KnowledgeEntryInput,
  KnowledgeSearchParams,
  KnowledgeSearchResult,
  KnowledgeStore,
  VectorIndexStats,
  CrossProjectSearchResult,
  IndexHealthReport,
} from './runtime/knowledgeService/types'

export {
  KNOWLEDGE_CATEGORIES,
} from './runtime/knowledgeService/types'

// ============================================
// Local model types
// ============================================

export type {
  LocalProviderType,
  LocalProviderEndpoint,
  LocalModelInfo,
  LocalModelCapabilities,
  LocalProviderStatus,
  LocalModelConfig,
} from './localModel/types'

export {
  getDefaultPort,
  getDefaultBaseUrl,
  getApiPaths,
  toLLMConfig,
  detectLocalProviderFromUrl,
} from './localModel/types'

// ============================================
// Plugin types
// ============================================

export type {
  PluginManifest,
  PluginPermission,
  PluginContributes,
  PluginToolDefinition,
  PluginParameterDef,
  PluginCommandDefinition,
  PluginHookDefinition,
  PluginHookEvent,
  PluginSettingDefinition,
  PluginContext,
  PluginStorage,
  PluginLogger,
  PluginSandbox,
  PluginExecuteHandler,
  PluginHookHandler,
  PluginInstance,
} from './plugins/types'

// ============================================
// UI/UX toolkit types
// ============================================

export type {
  UiuxDomain,
  UiuxSearchDomain,
  TechStack,
  UiuxSearchResult,
  DomainConfig,
} from './toolkit/uiux/interactionTypes'

export {
  DOMAIN_CONFIGS,
  STACK_CONFIG,
  AVAILABLE_STACKS,
} from './toolkit/uiux/interactionTypes'

// ============================================
// Engine types
// ============================================

export type {
  LLMCallResult,
  LoopCheckResult,
  AgentToolExecutionResult,
  ExecutionContext,
} from './engine/intelligenceTypes'

// ============================================
// Tool provider types
// ============================================

export type {
  ToolProvider,
  ToolMeta,
} from './toolkit/providers/toolProviderTypes'
