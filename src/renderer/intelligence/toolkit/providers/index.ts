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

// A2A 工具提供者
export { A2aToolProvider, a2aToolProvider } from './A2aToolRegistry'

// =================== 初始化 ===================

import { logger } from '@toolkit/LogEngine'
import { toolManager } from './ToolCoordinator'
import { builtinToolProvider } from './BuiltinToolRegistry'
import { mcpToolProvider } from './ProtocolToolRegistry'
import { a2aToolProvider } from './A2aToolRegistry'
import type { ToolLoadingContext } from '@configuration/toolCategoryDefs'

let initialized = false

/**
 * 初始化工具提供者系统
 */
export function initializeToolProviders(): void {
  if (initialized) return
  toolManager.registerProvider(builtinToolProvider, 0)
  toolManager.registerProvider(mcpToolProvider, 10)
  toolManager.registerProvider(a2aToolProvider, 20)
  // A2A 载荷需要异步拉取 + 订阅变更（非阻塞：失败只是工具暂不可见）
  a2aToolProvider.init()
  initialized = true

  // 对外 API 网关的工具桥（主进程来问清单 / 让它执行工具时才真正有用）。
  // 用动态 import 而不是顶层 import：工具桥反过来依赖本模块的 toolManager，
  // 顶层互相引用会让 bundler 产生 TDZ 风险；这里的初始化是幂等且可延迟的。
  void import('../openApiToolBridge')
    .then((m) => m.initOpenApiToolBridge())
    .catch((err) => logger.agent.warn('[Toolkit] OpenApi tool bridge init skipped:', err))
}

/**
 * 设置工具加载上下文
 */
export function setToolLoadingContext(context: ToolLoadingContext): void {
  builtinToolProvider.setContext(context)
  mcpToolProvider.setContext(context)
  a2aToolProvider.setContext(context)
}
