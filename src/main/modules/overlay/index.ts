/**
 * 悬浮层模块入口（主进程）
 *
 * 由 `bootstrap/moduleInitializer.ts` 在 `initializeModules()` 中调用。
 *
 * 模块组成：
 *   OverlayStore       配置持久化（<userData>/overlay/overlay_config.json）
 *   OverlayHttpServer  HTTP 服务（OBS 浏览器源 / 外部脚本注入）
 *   OverlayBroadcaster WS 广播（页面指令下发）
 *   OverlayWindow      应用内透明窗口（可拖动 / 点击穿透）
 *   OverlayManager     编排 + 统一推送入口
 *   OverlayIpc         IPC 通道
 *
 * @module overlay
 */

import { logger } from '@shared/toolkit/LogEngine'
import { getOverlayManager } from './OverlayManager'
import { registerOverlayIpc } from './OverlayIpc'

export { getOverlayManager } from './OverlayManager'
export { getOverlayBroadcaster } from './OverlayBroadcaster'
export * from './types'
export {
  getConfig as getOverlayConfig,
  updateConfig as updateOverlayConfig,
  resetConfig as resetOverlayConfig,
  DEFAULT_OVERLAY_CONFIG,
  getOverlayDataDir,
} from './OverlayStore'

/** 初始化悬浮层模块 */
export async function initOverlayModule(): Promise<void> {
  registerOverlayIpc()
  await getOverlayManager().start()
  logger.system.info('[Overlay] module initialized')
}

/** 卸载悬浮层模块（释放端口 / 连接 / 窗口） */
export async function cleanupOverlayModule(): Promise<void> {
  await getOverlayManager().stop()
}
