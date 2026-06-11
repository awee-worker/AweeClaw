/**
 * Plugin SDK - 统一入口
 *
 * AweeClaw 插件开发工具包，提供插件注册、发现、加载和生命周期管理。
 *
 * @module plugin-sdk
 */

// 核心类型
export type {
  PluginType,
  PluginLifecycle,
  PluginManifest,
  PluginPlatform,
  PluginCapabilities,
  PluginConfigSchema,
  PluginConfigField,
  PluginPermission,
  PluginContext,
  PluginLogger,
  PluginRuntime,
  PluginHealthResult,
  PluginRegistration,
  PluginStatus,
  PluginSystemEvent,
  PluginSystemEventListener,
  HookEventName,
  HookHandler,
  HookResult,
  HookRegistration,
  IPluginRegistry,
  IPluginLoader,
} from './types'

// Channel 插件类型
export type {
  ChannelPluginManifest,
  ChannelSetupWizard,
  ChannelSetupStep,
  ChannelPluginRuntime,
  ChannelBinding,
  ChannelBindingScope,
  BindingResolution,
  ChannelPluginFactory,
} from './channel'

// Provider 插件类型
export type {
  ProviderPluginManifest,
  ProviderModelInfo,
  ProviderModelCapabilities,
  ProviderCredentialField,
  ProviderPluginRuntime,
  ProviderCompleteParams,
  ProviderCompleteResult,
  ProviderStreamChunk,
  ProviderPluginFactory,
} from './provider'

// Hook 引擎
export { hookEngine } from './hooks'

// Tool 插件类型
export type {
  ToolParamType,
  ToolParamSchema,
  ToolRiskLevel,
  ToolConcurrency,
  ToolDefinition,
  ToolCategory,
  ToolExecutionResult,
  ToolPluginManifest,
  ToolPluginRuntime,
  ToolExecutionContext,
  ToolValidationResult,
  ToolPluginFactory,
} from './tool'

// Memory 插件类型
export type {
  MemoryEntry,
  MemoryType,
  MemoryQuery,
  MemoryQueryResult,
  MemoryStoreOptions,
  MemoryStats,
  KnowledgeEntry,
  KnowledgeBase,
  KnowledgeQuery,
  KnowledgeQueryResult,
  MemoryCapabilities,
  MemoryPluginManifest,
  MemoryPluginRuntime,
  MemoryPluginFactory,
} from './memory'
