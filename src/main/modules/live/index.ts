/**
 * 直播互动模块入口（主进程）
 *
 * 由 `bootstrap/moduleInitializer.ts` 在 `initializeModules()` 中调用；
 * 由 `bootstrap/globalCleanup.ts` 在退出流程中调用清理。
 *
 * 模块组成：
 *   LiveStore      配置持久化（<userData>/live/live_config.json，凭证 safeStorage 加密）
 *   LiveEventBus   统一事件总线（去重 + 洪水保护 + 最近事件）
 *   adapters/*     四个平台适配器（B站开放平台 / B站网页 / YouTube / Twitch）
 *   LiveManager    启停编排 + 向悬浮层与渲染层转发
 *   LiveIpc        IPC 通道
 *
 * @module live
 */

import { logger } from '@shared/toolkit/LogEngine'
import { getLiveManager } from './LiveManager'
import { registerLiveIpc } from './LiveIpc'

export { getLiveManager, LIVE_EVENT_CHANNEL } from './LiveManager'
export { getLiveEventBus, createLiveEvent } from './LiveEventBus'
export {
  getConfig as getLiveConfig,
  updateConfig as updateLiveConfig,
  resetConfig as resetLiveConfig,
  validateConfig as validateLiveConfig,
  DEFAULT_LIVE_CONFIG,
  getLiveDataDir,
} from './LiveStore'
export * from './types'

/** 初始化直播互动模块 */
export async function initLiveModule(): Promise<void> {
  registerLiveIpc()
  await getLiveManager().start()
  logger.system.info('[Live] module initialized')
}

/**
 * 卸载直播互动模块。
 *
 * 必须彻底：`stop()` 会关闭全部 WebSocket、清空心跳 / 轮询 / 重连定时器，
 * 之后才摘掉总线订阅 —— 顺序反了会导致「关连接的回调还要再转发一次」。
 */
export async function cleanupLiveModule(): Promise<void> {
  const manager = getLiveManager()
  await manager.stop()
  manager.dispose()
  logger.system.info('[Live] module cleaned up')
}
