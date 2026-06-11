/**
 * Gateway IPC Bridge
 *
 * 为 Gateway 守护进程模块提供渲染进程调用通道。
 */

import { safeIpcHandle } from './ipcGuard'
import { gatewayClient } from '../modules/gateway'

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
