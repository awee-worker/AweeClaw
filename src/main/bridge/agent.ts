/**
 * Agent IPC Bridge
 *
 * 为 Agent 路由与隔离模块提供渲染进程调用通道。
 */

import { safeIpcHandle } from './ipcGuard'
import { agentRouter } from '../modules/agent'
import type { AgentBinding } from '../modules/agent/AgentRouter'
import type { ChannelId } from '@shared/protocols/channel'

export function registerAgentHandlers(): void {
  // 绑定管理
  safeIpcHandle('agent:addBinding', async (_, binding: Omit<AgentBinding, 'createdAt'>) => {
    agentRouter.addBinding({ ...binding, createdAt: Date.now() })
    return { success: true }
  })

  safeIpcHandle('agent:removeBinding', async (_, bindingId: string) => {
    const removed = agentRouter.removeBinding(bindingId)
    return { success: removed }
  })

  safeIpcHandle('agent:getBindings', async (_, agentId?: string) => {
    const bindings = agentId
      ? agentRouter.getBindingsForAgent(agentId)
      : agentRouter.getAllBindings()
    return { success: true, bindings }
  })

  safeIpcHandle('agent:getBindingsForChannel', async (_, channelId: ChannelId, accountId: string) => {
    const bindings = agentRouter.getBindingsForChannel(channelId, accountId)
    return { success: true, bindings }
  })

  // DM Pairing
  safeIpcHandle('agent:setDmPairing', async (_, channelId: ChannelId, accountId: string, userId: string, agentId: string) => {
    agentRouter.setDmPairing(channelId, accountId, userId, agentId)
    return { success: true }
  })

  safeIpcHandle('agent:removeDmPairing', async (_, channelId: ChannelId, accountId: string, userId: string) => {
    agentRouter.removeDmPairing(channelId, accountId, userId)
    return { success: true }
  })

  // Agent 实例
  safeIpcHandle('agent:getInstances', async () => {
    const instances = agentRouter.getAllInstances()
    return { success: true, instances }
  })

  safeIpcHandle('agent:getInstance', async (_, agentId: string) => {
    const instance = agentRouter.getInstance(agentId)
    return { success: true, instance: instance || null }
  })

  // 工作区
  safeIpcHandle('agent:getWorkspace', async (_, agentId: string) => {
    const workspace = agentRouter.getWorkspace(agentId)
    return { success: true, workspace: workspace || null }
  })

  // 认证上下文
  safeIpcHandle('agent:getAuthContext', async (_, agentId: string) => {
    const authContext = agentRouter.getAuthContext(agentId)
    return { success: true, authContext: authContext || null }
  })
}
