/**
 * 编排层 IPC
 *
 * 渲染层通过这里启动 / 观察 / 中止会话，并回传工具执行结果。
 * 会话事件走 `agent:event:<sessionId>` 动态频道，工具请求走
 * `agent:tool-call:<sessionId>`。
 */

import { ipcMain, webContents } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'
import { agentSessionRegistry } from './AgentSessionRegistry'
import { ToolExecutionBridge } from './ToolExecutionBridge'
import { AgentOrchestrator } from './AgentOrchestrator'
import type { AgentToolOutcome, StartAgentSessionParams } from './types'

/**
 * 把工具执行请求交给渲染层
 *
 * 优先发给发起窗口；它已经关掉时退到任意一个观察者 —— 这正是「任务不随
 * 窗口关闭而中断」的落点：只要还有窗口在看，工具就还有人执行。
 * 一个窗口都没有时返回 false，由桥接层立刻失败而不是干等超时。
 */
function dispatchToolRequest(
  sessionId: string,
  payload: {
    toolRequestId: string
    sessionId: string
    turn: number
    call: { id: string; name: string; arguments?: unknown }
  },
): boolean {
  const state = agentSessionRegistry.get(sessionId)
  const candidates = [state?.owner, ...agentSessionRegistry.observersOf(sessionId)]

  for (const id of candidates) {
    if (id === undefined || id === null) continue
    const wc = webContents.fromId(id)
    if (!wc || wc.isDestroyed()) continue

    try {
      wc.send(`agent:tool-call:${sessionId}`, payload)
      return true
    } catch (error) {
      logger.agent.warn('[AgentOrchestratorIpc] 工具请求投递失败', { webContentsId: id })
    }
  }

  return false
}

const toolBridge = new ToolExecutionBridge(dispatchToolRequest)
const orchestrator = new AgentOrchestrator(toolBridge)

/** 注册编排层 IPC 处理器 */
export function registerAgentOrchestratorIpc(): void {
  /**
   * 启动会话
   *
   * 立即返回 sessionId：循环在后台跑，进度通过事件推。若这里 await 整场
   * 任务，渲染层的 invoke 会一直挂着，UI 也就没法响应中止。
   */
  ipcMain.handle('agent:start', async (event, params: StartAgentSessionParams) => {
    if (!params?.sessionId || typeof params.sessionId !== 'string') {
      return { ok: false, reason: 'missing-session-id' }
    }
    if (!Array.isArray(params.messages) || params.messages.length === 0) {
      return { ok: false, reason: 'missing-messages' }
    }
    if (!params.config?.model) {
      return { ok: false, reason: 'missing-config' }
    }

    const result = orchestrator.start(params, event.sender.id)
    logger.agent.info('[AgentOrchestratorIpc] 启动会话', {
      sessionId: params.sessionId,
      ok: result.ok,
      reason: result.reason,
      owner: event.sender.id,
    })
    return result
  })

  ipcMain.handle('agent:abort', async (_event, sessionId: string) => {
    if (!sessionId) return { ok: false, reason: 'missing-session-id' }
    return { ok: orchestrator.abort(sessionId) }
  })

  /** 会话列表（不含完整消息链，避免大对象过 IPC） */
  ipcMain.handle('agent:list', async () => {
    return { sessions: agentSessionRegistry.list() }
  })

  /** 取会话完整状态，供窗口重开后恢复 */
  ipcMain.handle('agent:get', async (_event, sessionId: string) => {
    const state = agentSessionRegistry.get(sessionId)
    if (!state) return { ok: false, reason: 'not-found' }
    return { ok: true, state }
  })

  /** 观察会话事件 */
  ipcMain.handle('agent:subscribe', async (event, sessionId: string) => {
    if (!sessionId) return { ok: false, reason: 'missing-session-id' }
    agentSessionRegistry.addObserver(sessionId, event.sender.id)
    return { ok: true }
  })

  ipcMain.handle('agent:unsubscribe', async (event, sessionId: string) => {
    if (sessionId) {
      agentSessionRegistry.removeObserver(sessionId, event.sender.id)
    }
    return { ok: true }
  })

  /** 渲染层回传工具执行结果 */
  ipcMain.handle(
    'agent:tool-result',
    async (_event, toolRequestId: string, outcome: AgentToolOutcome) => {
      if (!toolRequestId) return { ok: false, reason: 'missing-tool-request-id' }
      const settled = toolBridge.settle(toolRequestId, {
        ok: Boolean(outcome?.ok),
        content: outcome?.content,
        error: outcome?.error,
      })
      return { ok: settled }
    },
  )

  /** 清理已结束会话 */
  ipcMain.handle('agent:remove', async (_event, sessionId: string) => {
    const state = agentSessionRegistry.get(sessionId)
    if (state?.status === 'running' || state?.status === 'waiting-tool') {
      return { ok: false, reason: 'still-running' }
    }
    agentSessionRegistry.remove(sessionId)
    return { ok: true }
  })

  logger.agent.info('[AgentOrchestratorIpc] 编排层 IPC 已注册')
}

/** 窗口关闭时摘除它的会话观察关系（不影响会话继续运行） */
export function cleanupAgentSessions(webContentsId: number): void {
  agentSessionRegistry.dropWindow(webContentsId)
}

/** 应用退出时清理 */
export function cleanupAllAgentSessions(): void {
  for (const session of agentSessionRegistry.list()) {
    orchestrator.abort(session.sessionId)
  }
  agentSessionRegistry.clear()
}
