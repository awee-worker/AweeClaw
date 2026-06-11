/**
 * Security IPC Bridge
 *
 * 为安全模型模块（Tool Approval + Sandbox）提供渲染进程调用通道。
 */

import { safeIpcHandle } from './ipcGuard'
import { toolApprovalManager } from '../modules/security/ToolApprovalManager'
import { sandboxExecutor } from '../modules/security/SandboxExecutor'
import { secureToolExecutor } from '../modules/security/SecureToolExecutor'
import type { ToolApprovalConfig } from '../modules/security/ToolApprovalManager'
import type { SandboxConfig } from '../modules/security/SandboxExecutor'
import type { SecureToolExecutionRequest } from '../modules/security/SecureToolExecutor'
import type { BrowserWindow } from 'electron'

let mainWindowGetter: (() => BrowserWindow | null) | null = null

export function registerSecurityHandlers(getMainWindow?: () => BrowserWindow | null): void {
  if (getMainWindow) {
    mainWindowGetter = getMainWindow

    // 监听审批请求事件，转发到渲染进程
    toolApprovalManager.on('approval-requested', (request) => {
      const win = mainWindowGetter?.()
      if (win && !win.isDestroyed()) {
        win.webContents.send('security:approvalRequested', request)
      }
    })
  }
  // ---- Tool Approval ----

  /** 请求工具审批 */
  safeIpcHandle('security:requestApproval', async (_, agentId: string, toolName: string, toolArgs: Record<string, unknown>) => {
    const result = await toolApprovalManager.requestApproval(agentId, toolName, toolArgs)
    return { success: true, ...result }
  })

  /** 用户审批响应 */
  safeIpcHandle('security:respondApproval', async (_, requestId: string, approved: boolean, reason?: string) => {
    toolApprovalManager.respondApproval(requestId, approved, reason)
    return { success: true }
  })

  /** 获取待审批请求 */
  safeIpcHandle('security:getPendingRequests', async () => {
    const requests = toolApprovalManager.getPendingRequests()
    return { success: true, requests }
  })

  /** 更新审批配置 */
  safeIpcHandle('security:updateApprovalConfig', async (_, config: Partial<ToolApprovalConfig>) => {
    toolApprovalManager.updateConfig(config)
    return { success: true }
  })

  /** 设置 Agent 级别审批覆盖 */
  safeIpcHandle('security:setAgentApprovalOverride', async (_, agentId: string, override: Partial<ToolApprovalConfig>) => {
    toolApprovalManager.setAgentOverride(agentId, override)
    return { success: true }
  })

  /** 移除 Agent 级别审批覆盖 */
  safeIpcHandle('security:removeAgentApprovalOverride', async (_, agentId: string) => {
    toolApprovalManager.removeAgentOverride(agentId)
    return { success: true }
  })

  /** 清除审批缓存 */
  safeIpcHandle('security:clearApprovalCache', async () => {
    toolApprovalManager.clearCache()
    return { success: true }
  })

  // ---- Sandbox ----

  /** 验证路径是否允许 */
  safeIpcHandle('security:validatePath', async (_, filePath: string, agentId?: string) => {
    const result = sandboxExecutor.validatePath(filePath, agentId)
    return { success: true, ...result }
  })

  /** 验证命令是否允许 */
  safeIpcHandle('security:validateCommand', async (_, command: string, agentId?: string) => {
    const result = sandboxExecutor.validateCommand(command, agentId)
    return { success: true, ...result }
  })

  /** 沙箱执行命令 */
  safeIpcHandle('security:sandboxExecute', async (_, command: string, cwd: string, agentId?: string) => {
    const result = await sandboxExecutor.execute(command, cwd, agentId)
    return { success: result.success, stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode, timedOut: result.timedOut, duration: result.duration }
  })

  /** 更新沙箱配置 */
  safeIpcHandle('security:updateSandboxConfig', async (_, config: Partial<SandboxConfig>) => {
    sandboxExecutor.updateConfig(config)
    return { success: true }
  })

  /** 设置 Agent 级别沙箱覆盖 */
  safeIpcHandle('security:setAgentSandboxOverride', async (_, agentId: string, override: Partial<SandboxConfig>) => {
    sandboxExecutor.setAgentOverride(agentId, override)
    return { success: true }
  })

  /** 移除 Agent 级别沙箱覆盖 */
  safeIpcHandle('security:removeAgentSandboxOverride', async (_, agentId: string) => {
    sandboxExecutor.removeAgentOverride(agentId)
    return { success: true }
  })

  // ---- Secure Tool Executor ----

  /** 工具执行预检查（审批 + 沙箱） */
  safeIpcHandle('security:preCheckTool', async (_, request: SecureToolExecutionRequest) => {
    const result = await secureToolExecutor.preCheck(request)
    return { success: true, ...result }
  })

  /** 验证文件路径安全性 */
  safeIpcHandle('security:validateFilePath', async (_, filePath: string, agentId?: string) => {
    const result = secureToolExecutor.validateFilePath(filePath, agentId)
    return { success: true, ...result }
  })
}
