/**
 * Secure Tool Executor - 安全工具执行器
 *
 * 将安全模型（ToolApproval + Sandbox）集成到工具执行管线：
 * 1. 工具执行前：请求 ToolApproval 审批
 * 2. 命令类工具：通过 Sandbox 执行
 * 3. 审批结果缓存：减少重复审批
 *
 * 工作流程：
 * 渲染进程 toolExecutors → IPC → SecureToolExecutor → ToolApproval → Sandbox → 执行
 *
 * @module security/SecureToolExecutor
 */

import { toolApprovalManager } from './ToolApprovalManager'
import { sandboxExecutor } from './SandboxExecutor'

// ============================================
// 安全工具执行请求
// ============================================

export interface SecureToolExecutionRequest {
  /** 工具名 */
  toolName: string
  /** 工具参数 */
  toolArgs: Record<string, unknown>
  /** Agent ID */
  agentId: string
  /** 工作目录 */
  cwd: string
  /** 是否为命令类工具（需要沙箱执行） */
  isCommandTool: boolean
  /** 要执行的命令（isCommandTool=true 时） */
  command?: string
  /** 是否跳过主进程审批（渲染进程已处理审批时设为 true） */
  skipApproval?: boolean
}

export interface SecureToolExecutionResponse {
  /** 是否允许执行 */
  allowed: boolean
  /** 拒绝原因 */
  reason?: string
  /** 审批请求 ID（需要用户审批时） */
  approvalRequestId?: string
  /** 沙箱执行结果（命令类工具） */
  sandboxResult?: {
    success: boolean
    stdout: string
    stderr: string
    exitCode: number | null
    timedOut: boolean
    duration: number
  }
}

// ============================================
// 需要沙箱执行的命令类工具
// ============================================

const COMMAND_TOOLS = new Set([
  'run_command',
  'execute_command',
  'shell_execute',
  'npm_install',
  'npm_run',
])

// ============================================
// Secure Tool Executor
// ============================================

class SecureToolExecutor {
  /**
   * 预检查工具执行（在渲染进程发起工具调用前）
   *
   * 返回结果：
   * - allowed=true: 允许执行，渲染进程可继续
   * - allowed=false + approvalRequestId: 需要用户审批，等待响应
   * - allowed=false + reason: 直接拒绝
   */
  async preCheck(request: SecureToolExecutionRequest): Promise<SecureToolExecutionResponse> {
    const { toolName, toolArgs, agentId, isCommandTool, command, skipApproval } = request

    // 1. 请求审批（如果渲染进程已审批通过，跳过主进程审批）
    if (!skipApproval) {
      const approvalResult = await toolApprovalManager.requestApproval(agentId, toolName, toolArgs)

      if (approvalResult.decision === 'denied') {
        return {
          allowed: false,
          reason: approvalResult.reason,
        }
      }

      if (approvalResult.decision === 'timeout') {
        return {
          allowed: false,
          reason: 'Approval request timed out',
          approvalRequestId: approvalResult.requestId,
        }
      }
    }

    // 2. 命令类工具：通过沙箱执行
    if (isCommandTool || COMMAND_TOOLS.has(toolName)) {
      const cmd = command || toolArgs.command as string || toolArgs.cmd as string
      if (!cmd) {
        return {
          allowed: false,
          reason: 'No command specified for command tool',
        }
      }

      // 验证命令
      const cmdValidation = sandboxExecutor.validateCommand(cmd, agentId)
      if (!cmdValidation.allowed) {
        return {
          allowed: false,
          reason: cmdValidation.reason,
        }
      }

      // 通过沙箱执行
      const sandboxResult = await sandboxExecutor.execute(cmd, request.cwd, agentId)
      return {
        allowed: true,
        sandboxResult: {
          success: sandboxResult.success,
          stdout: sandboxResult.stdout,
          stderr: sandboxResult.stderr,
          exitCode: sandboxResult.exitCode,
          timedOut: sandboxResult.timedOut,
          duration: sandboxResult.duration,
        },
      }
    }

    // 3. 非命令类工具：审批通过后由渲染进程自行执行
    return {
      allowed: true,
    }
  }

  /**
   * 验证文件路径是否在安全范围内
   */
  validateFilePath(filePath: string, agentId?: string): SecureToolExecutionResponse {
    const result = sandboxExecutor.validatePath(filePath, agentId)
    return {
      allowed: result.allowed,
      reason: result.reason,
    }
  }
}

/** 全局安全工具执行器实例 */
export const secureToolExecutor = new SecureToolExecutor()
