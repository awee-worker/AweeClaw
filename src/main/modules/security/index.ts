/**
 * Security 模块入口
 *
 * 提供增强安全模型能力：Tool Approval + Sandbox + Secure Tool Executor。
 */

export { toolApprovalManager } from './ToolApprovalManager'
export type {
  ToolRiskLevel,
  ApprovalPolicy,
  ToolApprovalConfig,
  ToolApprovalRequest,
  ToolApprovalDecision,
  ToolApprovalResult,
} from './ToolApprovalManager'

export { sandboxExecutor } from './SandboxExecutor'
export type {
  SandboxConfig,
  SandboxValidationResult,
  SandboxExecutionResult,
} from './SandboxExecutor'
export { DEFAULT_SANDBOX_CONFIG } from './SandboxExecutor'

export { secureToolExecutor } from './SecureToolExecutor'
export type {
  SecureToolExecutionRequest,
  SecureToolExecutionResponse,
} from './SecureToolExecutor'
