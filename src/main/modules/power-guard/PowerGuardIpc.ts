/**
 * 防休眠 IPC 处理器（主进程）
 *
 * 通道清单：
 * - power-guard:get-config | update-config | reset-config   配置读写
 * - power-guard:get-status                                  运行状态
 * - power-guard:acquire | release                            持有者引用计数（渲染层驱动）
 * - power-guard:release-all                                  清空全部持有者（排障 / 退出前兜底）
 *
 * 事件推送：`power-guard:status`，由 preload 侧订阅。
 *
 * ── 为什么 acquire/release 要暴露给渲染层 ──
 *
 * Agent 主循环（`IntelligenceCore.send`）跑在渲染进程，主进程无法窥见它的
 * 起止时刻。与其在主进程里另造一套「任务是否在跑」的推断（必然与真实状态漂移），
 * 不如让唯一知道真相的一侧显式上报。主进程只负责引用计数与平台落地。
 *
 * 约定：所有 handler 通过 safeIpcHandle 注册，统一返回 `{ success, data }` / `{ success:false, error }`。
 *
 * @module power-guard/PowerGuardIpc
 */

import { safeIpcHandle } from '../../bridge/core/ipcGuard'
import { logger } from '@shared/toolkit/LogEngine'
import { getPowerGuardManager } from './PowerGuardManager'
import { getConfig } from './PowerGuardStore'
import type { PowerGuardConfigPayload } from './types'

/** 是否已注册（显式挡一层，语义更清晰） */
let registered = false

/** 统一的错误响应 */
function fail(err: unknown): { success: false; error: string } {
  return { success: false, error: err instanceof Error ? err.message : String(err) }
}

/** 组装配置载荷（配置 + 状态 + 提示，三件套） */
function configPayload(): PowerGuardConfigPayload {
  const manager = getPowerGuardManager()
  return {
    config: getConfig(),
    status: manager.getStatus(),
    issues: manager.validate(),
  }
}

/** 注册防休眠 IPC（幂等） */
export function registerPowerGuardIpc(): void {
  if (registered) return
  registered = true

  const manager = getPowerGuardManager()

  // --------------------------------------------
  // 配置
  // --------------------------------------------
  safeIpcHandle('power-guard:get-config', async () => {
    return { success: true, data: configPayload() }
  })

  safeIpcHandle('power-guard:update-config', async (_event, patch: unknown) => {
    try {
      await manager.applyConfig(patch)
      return { success: true, data: configPayload() }
    } catch (err) {
      logger.system.error('[PowerGuard] update-config failed:', err)
      return fail(err)
    }
  })

  safeIpcHandle('power-guard:reset-config', async () => {
    try {
      await manager.handleResetConfig()
      return { success: true, data: configPayload() }
    } catch (err) {
      return fail(err)
    }
  })

  // --------------------------------------------
  // 状态
  // --------------------------------------------
  safeIpcHandle('power-guard:get-status', async () => {
    return { success: true, data: manager.getStatus() }
  })

  // --------------------------------------------
  // 持有者
  // --------------------------------------------
  safeIpcHandle('power-guard:acquire', async (_event, reason: unknown) => {
    try {
      manager.acquire(reason)
      return { success: true, data: manager.getStatus() }
    } catch (err) {
      return fail(err)
    }
  })

  safeIpcHandle('power-guard:release', async (_event, reason: unknown) => {
    try {
      manager.release(reason)
      return { success: true, data: manager.getStatus() }
    } catch (err) {
      return fail(err)
    }
  })

  safeIpcHandle('power-guard:release-all', async () => {
    try {
      manager.releaseAll()
      return { success: true, data: manager.getStatus() }
    } catch (err) {
      return fail(err)
    }
  })
}
