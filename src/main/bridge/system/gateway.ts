/**
 * Gateway 守护进程桥接 — Gateway 服务的 IPC 接口
 *
 * 职责：
 * - 暴露 Gateway 启动、停止、状态查询等 IPC 接口
 * - 桥接渲染进程与 gatewayClient 模块
 */

import { safeIpcHandle } from '../core/ipcGuard'
import { gatewayClient } from '../../modules/gateway'

export function registerGatewayHandlers(): void {
  /** 启动 Gateway */
  safeIpcHandle('gateway:start', async () => {
    await gatewayClient.start()
    return { success: true }
  })

  /** 停止 Gateway */
  safeIpcHandle('gateway:stop', async () => {
    await gatewayClient.stop()
    return { success: true }
  })

  /** 重启 Gateway */
  safeIpcHandle('gateway:restart', async () => {
    await gatewayClient.stop()
    await gatewayClient.start()
    return { success: true }
  })

  /** 获取 Gateway 状态 */
  safeIpcHandle('gateway:getStatus', async () => {
    const status = gatewayClient.getStatus()
    return { success: true, ...status }
  })

  /** Ping Gateway */
  safeIpcHandle('gateway:ping', async () => {
    const result = await gatewayClient.ping()
    return { success: true, ...result }
  })
}
