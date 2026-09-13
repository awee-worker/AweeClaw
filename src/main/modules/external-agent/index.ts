/**
 * 外部智能体 — IPC Handler 注册入口
 *
 * 频道：
 * - external-agent:preflight  可用性检测
 * - external-agent:start      启动运行（非阻塞，返回 requestId）
 * - external-agent:wait       等待结束（阻塞至 done/error/aborted）
 * - external-agent:abort      中止运行
 * - external-agent:status     查询状态
 * - external-agent:getConfig  读取配置
 * - external-agent:saveConfig 保存配置
 *
 * 推流：external-agent:stream:{requestId}（主进程 → 发起窗口）
 */

import { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import * as path from 'path'
import * as crypto from 'crypto'
import { safeIpcHandle } from '../../bridge/core/ipcGuard'
import { externalAgentService } from './ExternalAgentService'
import type {
  ExternalAgentId,
  ExternalAgentRunRequest,
  ExternalAgentConfig,
  AgentStreamEvent,
} from '@shared/externalAgents'

/**
 * 工作区根目录解析器（与 secure-terminal 一致的模式：
 * 优先取请求来源窗口绑定的工作区，回退到全局最近工作区）
 */
export type WorkspaceRootsResolver = (event: IpcMainInvokeEvent) => string[] | null

/** 校验 workdir 是否在工作区根内（根本身或其子路径） */
function workdirWithinWorkspace(workdir: string, roots: string[] | null): boolean {
  if (!roots || roots.length === 0) return false
  const normalized = path.resolve(workdir)
  return roots.some((root) => {
    const r = path.resolve(root)
    return normalized === r || normalized.startsWith(r + path.sep)
  })
}

export function registerExternalAgentHandlers(resolveWorkspaceRoots: WorkspaceRootsResolver): void {
  safeIpcHandle('external-agent:preflight', async (_event, agent: ExternalAgentId) => {
    return externalAgentService.preflight(agent)
  }, 'agent')

  safeIpcHandle('external-agent:start', async (event, request: ExternalAgentRunRequest) => {
    // requestId 在 handler 侧预生成，保证推流频道可预测
    const requestId = crypto.randomUUID()
    const win = BrowserWindow.fromWebContents(event.sender)
    const push = (evt: AgentStreamEvent) => {
      if (win && !win.isDestroyed()) {
        try {
          win.webContents.send(`external-agent:stream:${requestId}`, { requestId, event: evt })
        } catch {
          /* 窗口已销毁时忽略 */
        }
      }
    }

    const roots = resolveWorkspaceRoots(event)
    const started = await externalAgentService.start(
      { ...request, requestId },
      (workdir) => workdirWithinWorkspace(workdir, roots),
      push,
    )
    if (started.error) return { requestId, ok: false, error: started.error }
    return { requestId, ok: true }
  }, 'agent')

  safeIpcHandle('external-agent:wait', async (_event, requestId: string, timeoutMs?: number) => {
    return externalAgentService.wait(requestId, timeoutMs)
  }, 'agent')

  safeIpcHandle('external-agent:abort', async (_event, requestId: string) => {
    const aborted = externalAgentService.abort(requestId)
    return { aborted }
  }, 'agent')

  safeIpcHandle('external-agent:status', async (_event, requestId: string) => {
    return externalAgentService.status(requestId)
  }, 'agent')

  safeIpcHandle('external-agent:getConfig', async () => {
    return externalAgentService.getConfig()
  }, 'agent')

  safeIpcHandle('external-agent:saveConfig', async (_event, patch: Partial<ExternalAgentConfig>) => {
    const config = externalAgentService.updateConfig(patch)
    return { success: true, config }
  }, 'agent')

  safeIpcHandle('external-agent:recent', async () => {
    return externalAgentService.listRecentRuns()
  }, 'agent')

  safeIpcHandle('external-agent:clearRecent', async () => {
    externalAgentService.clearRecentRuns()
    return { success: true }
  }, 'agent')
}


