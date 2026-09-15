/**
 * A2A（Agent2Agent）协议模块入口（主进程）
 *
 * 由 `bootstrap/moduleInitializer.ts` 在 `initializeModules()` 中调用；
 * 由 `bootstrap/globalCleanup.ts` 在退出流程中调用清理。
 *
 * 模块组成：
 *   A2aStore    配置持久化（<userData>/a2a，token safeStorage 加密）
 *   A2aClient   JSON-RPC 2.0 over HTTP 客户端（发现 / 调用 / 轮询 / 取消）
 *   A2aServer   入站服务：把 AweeClaw 暴露为 A2A agent（默认仅 127.0.0.1）
 *   A2aManager  编排：卡片缓存 / 连通性测试 / 入站生命周期 / 状态
 *   A2aIpc      IPC 通道
 *
 * 双向能力：
 *   - **出站**：外部 A2A agent → 模型工具 `a2a_tool_call`（渲染层工具提供者注册）
 *   - **入站**：外部 agent → 本机 LLM（走 SyncService，不进多步 Agent 循环）
 *
 * 与 P0-5（对外 OpenAI 兼容 API）的关系：入站的 `A2aServer.handle()` 是纯路由函数，
 * P0-5 落地后应把入站挂到统一 HTTP server 的 `/a2a` 前缀下，复用同一个监听端口。
 *
 * @module a2a
 */

import { logger } from '@shared/toolkit/LogEngine'
import { getA2aManager } from './A2aManager'
import { registerA2aIpc } from './A2aIpc'

export { getA2aManager, A2A_CHANGED_CHANNEL } from './A2aManager'
export type { A2aChangePayload } from './A2aManager'
export { A2aClient, A2aError, A2A_CALL_TIMEOUT_MS, A2A_CARD_TIMEOUT_MS, extractTextFromResult } from './A2aClient'
export { A2aServer } from './A2aServer'
export type { A2aChatContext, A2aServerDeps } from './A2aServer'
export {
  getConfig as getA2aConfig,
  updateConfig as updateA2aConfig,
  resetConfig as resetA2aConfig,
  validateConfig as validateA2aConfig,
  upsertServer as upsertA2aServer,
  removeServer as removeA2aServer,
  normalizeAgentUrl,
  getA2aDataDir,
  createDefaultConfig,
  DEFAULT_A2A_CONFIG,
  DEFAULT_A2A_PORT,
  DEFAULT_INBOUND_HOST,
} from './A2aStore'
export * from '@shared/protocols/a2aProtocol'

/** 初始化 A2A 模块 */
export async function initA2aModule(): Promise<void> {
  registerA2aIpc()
  await getA2aManager().start()
  logger.system.info('[A2A] module initialized')
}

/**
 * 卸载 A2A 模块。
 *
 * 必须停掉入站 HTTP 服务：它是常驻监听端口，退出时不关会留下
 * 「应用已退出但端口仍被占用」的假死窗口。
 */
export async function cleanupA2aModule(): Promise<void> {
  await getA2aManager().stop()
  logger.system.info('[A2A] module cleaned up')
}
