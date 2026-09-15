/**
 * 对外 API 网关 IPC 处理器（主进程）
 *
 * 通道清单：
 * - openapi:get-config | update-config | reset-config   配置读写
 * - openapi:get-status                                  网关运行态（含 A2A 挂载情况）
 * - openapi:generate-key                                生成准入密钥（仅生成，不落盘）
 * - openapi:restart                                     强制重绑端口（端口被占后想抢回原端口）
 *
 * 事件推送：`openapi:changed`（配置或运行态变化），由 preload 侧订阅。
 *
 * 约定：所有 handler 通过 safeIpcHandle 注册，统一返回 `{ success, data }` /
 * `{ success:false, error }`；**失败信息一律中文可读**，因为它会被直接渲染到设置页。
 *
 * @module openapi/OpenApiIpc
 */

import { safeIpcHandle } from '../../bridge/core/ipcGuard'
import { logger } from '@shared/toolkit/LogEngine'
import { getOpenApiManager } from './OpenApiManager'

/** 是否已注册（显式挡一层，语义更清晰） */
let registered = false

/** 统一错误响应 */
function fail(err: unknown): { success: false; error: string } {
  return { success: false, error: err instanceof Error ? err.message : String(err) }
}

/** 注册对外 API 网关 IPC（幂等） */
export function registerOpenApiIpc(): void {
  if (registered) return
  registered = true

  const manager = getOpenApiManager()

  safeIpcHandle('openapi:get-config', async () => {
    return { success: true, data: { config: manager.getConfig(), issues: manager.getIssues() } }
  })

  safeIpcHandle('openapi:update-config', async (_event, patch: unknown) => {
    try {
      const config = await manager.applyConfig(patch)
      return { success: true, data: { config, issues: manager.getIssues(), status: manager.getStatus() } }
    } catch (err) {
      logger.system.error('[OpenApi] update-config failed:', err)
      return fail(err)
    }
  })

  safeIpcHandle('openapi:reset-config', async () => {
    try {
      const config = await manager.resetConfig()
      return { success: true, data: { config, issues: manager.getIssues(), status: manager.getStatus() } }
    } catch (err) {
      return fail(err)
    }
  })

  safeIpcHandle('openapi:get-status', async () => {
    return { success: true, data: manager.getStatus() }
  })

  safeIpcHandle('openapi:generate-key', async () => {
    return { success: true, data: { apiKey: manager.generateKey() } }
  })

  safeIpcHandle('openapi:restart', async () => {
    try {
      return { success: true, data: { status: await manager.restart() } }
    } catch (err) {
      logger.system.error('[OpenApi] restart failed:', err)
      return fail(err)
    }
  })
}
