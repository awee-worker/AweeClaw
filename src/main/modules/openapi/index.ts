/**
 * 对外 API 网关模块入口（P0-5，主进程）
 *
 * 由 `bootstrap/moduleInitializer.ts` 在 `initializeModules()` 中调用；
 * 由 `bootstrap/globalCleanup.ts` 在退出流程中调用清理。
 *
 * ⚠️ **必须在 A2A 模块之后初始化**：网关会订阅 A2A 的入站变化（`onInboundChange`），
 * 并在启动后立即接管 A2A 的监听权。顺序反了会导致 A2A 先抢下端口，
 * 网关启动时撞 EADDRINUSE 并自动 +1 端口 —— 表现为「配置的端口和实际不一致」。
 *
 * 模块组成：
 *   OpenApiStore       配置持久化（<userData>/openapi，apiKey safeStorage 加密）
 *   OpenApiAuth        Bearer 鉴权 + CORS 白名单
 *   OpenApiServer      统一 HTTP server（一个端口挂载 /v1、/mcp、/a2a）
 *   OpenApiManager     编排：启停 + 与 A2A 协商监听归属 + 状态
 *   OpenApiModelSource 模型 / 智能体来源解析（不硬编码）
 *   OpenApiToolBridge  渲染层工具清单与执行的桥
 *   OpenApiIpc         IPC 通道
 *
 * @module openapi
 */

import { logger } from '@shared/toolkit/LogEngine'
import { getOpenApiManager } from './OpenApiManager'
import { registerOpenApiIpc } from './OpenApiIpc'

export { getOpenApiManager } from './OpenApiManager'
export { OpenApiServer } from './OpenApiServer'
export type { OpenApiServerDeps, A2aHandlerLike } from './OpenApiServer'
export {
  getConfig as getOpenApiConfig,
  updateConfig as updateOpenApiConfig,
  resetConfig as resetOpenApiConfig,
  validateConfig as validateOpenApiConfig,
  generateApiKey,
  normalizeOrigin,
  shouldFallbackToLoopback,
  isLoopbackHost,
  getOpenApiDataDir,
  createDefaultConfig,
  DEFAULT_OPEN_API_CONFIG,
} from './OpenApiStore'
export { listAvailableModels, listAgents, resolveModelRequest } from './OpenApiModelSource'
export { listToolsFromRenderer, callToolInRenderer } from './OpenApiToolBridge'
export type { RemoteToolInfo, RemoteToolResult } from './OpenApiToolBridge'
export * from '@shared/protocols/openApiProtocol'

/** 初始化对外 API 网关 */
export async function initOpenApiModule(): Promise<void> {
  registerOpenApiIpc()
  await getOpenApiManager().start()
  logger.system.info('[OpenApi] module initialized')
}

/**
 * 卸载对外 API 网关。
 *
 * stop() 内部会停掉 HTTP 服务并把监听权交还 A2A —— 不交还的话，
 * 用户下次只启用 A2A 时会发现端口没人监听（因为 A2A 还以为自己托管着）。
 */
export async function cleanupOpenApiModule(): Promise<void> {
  await getOpenApiManager().stop()
  logger.system.info('[OpenApi] module cleaned up')
}
