/**
 * 防休眠模块入口（主进程）
 *
 * 由 `bootstrap/moduleInitializer.ts` 在 `initializeModules()` 中调用；
 * 由 `bootstrap/globalCleanup.ts` 在退出流程中调用清理。
 *
 * 模块组成：
 *   PowerGuardStore     配置 + 残留守护进程记录（<userData>/power-guard）
 *   PowerGuardPlatform  平台实现（caffeinate / systemd-inhibit / PowerShell P/Invoke）
 *   PowerGuardManager   引用计数 + 去抖 + 串行状态机 + 残留清理
 *   PowerGuardIpc       IPC 通道
 *
 * 语义来源：源项目 `py/sleep_guard.py`（269 行，零依赖）。
 * AweeClaw 版保留其三个关键语义：**引用计数**、**进程守护**（`-w <pid>`）、
 * **异常自恢复**（启动时定向清理残留），并额外拆出强度档位与去抖窗口。
 *
 * 与其他模块的关系：**完全独立**。它不依赖 Agent / 工具执行 / 直播任何模块，
 * 只提供一对 `acquire(reason)` / `release(reason)` 供上层按需使用。
 *
 * @module power-guard
 */

import { logger } from '@shared/toolkit/LogEngine'
import { getPowerGuardManager } from './PowerGuardManager'
import { registerPowerGuardIpc } from './PowerGuardIpc'

export { getPowerGuardManager } from './PowerGuardManager'
export { POWER_GUARD_STATUS_CHANNEL, MANUAL_HOLD_REASON } from './types'
export {
  getConfig as getPowerGuardConfig,
  updateConfig as updatePowerGuardConfig,
  resetConfig as resetPowerGuardConfig,
  validateConfig as validatePowerGuardConfig,
  getPowerGuardDataDir,
  DEFAULT_POWER_GUARD_CONFIG,
} from './PowerGuardStore'
export {
  detectPlatform as detectPowerGuardPlatform,
  isProcessAlive,
  killProcess,
  matchesGuardSignature,
} from './PowerGuardPlatform'
export * from './types'

/** 初始化防休眠模块 */
export async function initPowerGuardModule(): Promise<void> {
  registerPowerGuardIpc()
  await getPowerGuardManager().start()
  logger.system.info('[PowerGuard] module initialized')
}

/**
 * 卸载防休眠模块。
 *
 * `stop()` 会清空持有者、清定时器、终止守护子进程并删除 `guard.json`。
 * 缺任何一步的后果：
 *   · 漏杀子进程 → 应用退出后系统仍然无法休眠（最严重）
 *   · 漏删记录文件 → 下次启动做一次无意义的残留清理
 */
export async function cleanupPowerGuardModule(): Promise<void> {
  await getPowerGuardManager().stop()
  logger.system.info('[PowerGuard] module cleaned up')
}
