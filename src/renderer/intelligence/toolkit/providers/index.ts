/**
 * 工具提供者模块
 */

// 类型
export type { ToolProvider, ToolMeta } from '@intelligence/providerTypes'
export type { ToolLoadingContext } from '@configuration/toolCategoryDefs'

// 工具管理器
export { toolManager } from './ToolCoordinator'

// 内置工具提供者
export { BuiltinToolProvider, builtinToolProvider } from './BuiltinToolRegistry'

// MCP 工具提供者
export { McpToolProvider, mcpToolProvider } from './ProtocolToolRegistry'

// =================== 初始化 ===================

import { toolManager } from './ToolCoordinator'
import { builtinToolProvider } from './BuiltinToolRegistry'
import { mcpToolProvider } from './ProtocolToolRegistry'
import type { ToolLoadingContext } from '@configuration/toolCategoryDefs'

let initialized = false

/**
 * 初始化工具提供者系统
 */
export function initializeToolProviders(): void {
  if (initialized) return
  toolManager.registerProvider(builtinToolProvider, 0)
  toolManager.registerProvider(mcpToolProvider, 10)
  initialized = true
}

/**
 * 设置工具加载上下文
 */
export function setToolLoadingContext(context: ToolLoadingContext): void {
  builtinToolProvider.setContext(context)
  mcpToolProvider.setContext(context)
}
