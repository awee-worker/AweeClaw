/**
 * Session Lifecycle IPC Bridge
 *
 * 为 Session 生命周期管理模块提供渲染进程调用通道。
 */

import { safeIpcHandle } from './ipcGuard'
import { sessionLifecycleManager } from '../modules/session/SessionLifecycleManager'
import type { SessionLifecycleConfig } from '../modules/session/SessionLifecycleManager'

export function registerSessionLifecycleHandlers(): void {
  /** 获取 Session 列表 */
  safeIpcHandle('session:getAllSessions', async () => {
    const sessions = sessionLifecycleManager.getAllSessions()
    return { success: true, sessions }
  })

  /** 获取指定 Agent 的 Session */
  safeIpcHandle('session:getSessionsForAgent', async (_, agentId: string) => {
    const sessions = sessionLifecycleManager.getSessionsForAgent(agentId)
    return { success: true, sessions }
  })

  /** 获取单个 Session */
  safeIpcHandle('session:getSession', async (_, sessionId: string) => {
    const session = sessionLifecycleManager.getSession(sessionId)
    return { success: true, session: session || null }
  })

  /** 激活 Session */
  safeIpcHandle('session:activateSession', async (_, sessionId: string) => {
    sessionLifecycleManager.activateSession(sessionId)
    return { success: true }
  })

  /** 重置 Session */
  safeIpcHandle('session:resetSession', async (_, sessionId: string) => {
    sessionLifecycleManager.resetSession(sessionId)
    return { success: true }
  })

  /** 归档 Session */
  safeIpcHandle('session:archiveSession', async (_, sessionId: string) => {
    sessionLifecycleManager.archiveSession(sessionId)
    return { success: true }
  })

  /** 获取或创建 Session */
  safeIpcHandle('session:getOrCreateSession', async (_, agentId: string, channelId?: string, dmUserId?: string) => {
    const session = sessionLifecycleManager.getOrCreateSession(agentId, channelId as any, dmUserId)
    return { success: true, session }
  })

  /** 更新 Session 配置 */
  safeIpcHandle('session:updateConfig', async (_, config: Partial<SessionLifecycleConfig>) => {
    sessionLifecycleManager.updateConfig(config)
    return { success: true }
  })

  /** 获取当前配置 */
  safeIpcHandle('session:getConfig', async () => {
    return { success: true, config: sessionLifecycleManager.getConfig() }
  })
}
