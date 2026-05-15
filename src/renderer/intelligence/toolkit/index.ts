/**
 * 工具模块
 */

// =================== 类型 ===================
export type {
  ToolDefinition,
  ToolExecutionResult,
  ToolExecutionContext,
  ToolExecutor,
  ValidationResult,
  ToolStatus,
  ToolResultType,
  ToolCall,
  ToolApprovalType,
} from '@intelligence/providerTypes'

// =================== 工具配置 ===================
export type { ToolCategory, ToolConfig } from '@configuration/toolDefinitions'
export {
  TOOL_CONFIGS,
  TOOL_DEFINITIONS,
  TOOL_SCHEMAS,
  TOOL_DISPLAY_NAMES,
  getToolApprovalType,
  getToolDisplayName,
  getReadOnlyTools,
  getWriteTools,
  getParallelTools,
  isParallelTool,
  isWriteTool,
} from '@configuration/toolDefinitions'

// =================== 工具分组 ===================
export type { ToolLoadingContext } from '@configuration/toolCategoryDefs'
export { getToolsForContext, isToolAvailable } from '@configuration/toolCategoryDefs'

// =================== 工具注册表 ===================
export { toolRegistry } from './toolRegistry'

// =================== 工具执行器 ===================
export { toolExecutors, initializeTools } from './toolExecutors'

// =================== 工具提供者 ===================
export type { ToolProvider, ToolMeta } from './providers/toolProviderTypes'
export {
  toolManager,
  builtinToolProvider,
  mcpToolProvider,
  McpToolProvider,
  initializeToolProviders,
  setToolLoadingContext,
} from './providers'
