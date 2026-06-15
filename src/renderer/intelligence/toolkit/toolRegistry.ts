/**
 * 工具注册表
 * 
 * 职责：
 * - 注册工具执行器
 * - 验证工具参数
 * - 执行工具
 * 
 * 注意：工具的按需加载由 BuiltinToolProvider + toolGroups 负责
 */

import { z } from 'zod'
import { toAppError } from '@shared/toolkit/errorCatalog'
import { logger } from '@toolkit/LogEngine'
import { api } from '../../adapters/electronBridge'
import { TOOL_SCHEMAS, TOOL_DEFINITIONS, TOOL_CONFIGS, type ToolCategory } from '@configuration/toolDefinitions'
import type {
  ToolDefinition,
  ToolExecutionResult,
  ToolExecutionContext,
  ToolExecutor,
  ValidationResult,
  ToolApprovalType,
} from '@intelligence/providerTypes'

// ===== 类型 =====

interface RegisteredTool {
  name: string
  definition: ToolDefinition
  schema: z.ZodSchema
  /** 执行器引用（支持热重载） */
  getExecutor: () => ToolExecutor
  category: ToolCategory
  approvalType: ToolApprovalType
  parallel: boolean
  enabled: boolean
}

// ===== 注册表 =====

/** 全局执行器映射（支持热重载） */
let globalExecutors: Record<string, ToolExecutor> = {}

class ToolRegistry {
  private tools = new Map<string, RegisteredTool>()
  private initialized = false

  /**
   * 注册工具
   * @param name 工具名称
   * @param _executor 执行器（仅用于类型检查，实际从 globalExecutors 获取）
   * @param options 选项
   */
  register(name: string, _executor: ToolExecutor, options?: { override?: boolean }): boolean {
    if (this.tools.has(name) && !options?.override) return false

    const definition = TOOL_DEFINITIONS[name]
    const schema = TOOL_SCHEMAS[name]
    const config = TOOL_CONFIGS[name]

    if (!definition || !schema) {
      logger.agent.warn(`[ToolRegistry] Missing definition or schema for: ${name}`)
      return false
    }

    // 使用 getter 函数，每次执行时从 globalExecutors 获取最新的执行器
    // 这样热重载时不需要重新注册
    this.tools.set(name, {
      name,
      definition,
      schema,
      getExecutor: () => globalExecutors[name],
      category: config?.category || 'read',
      approvalType: config?.approvalType || 'none',
      parallel: config?.parallel ?? false,
      enabled: true,
    })

    return true
  }

  /**
   * 批量注册工具
   * 注意：执行器存储在 globalExecutors 中，支持热重载
   */
  registerAll(executors: Record<string, ToolExecutor>): void {
    globalExecutors = executors
    
    for (const [name, executor] of Object.entries(executors)) {
      this.register(name, executor, { override: true })
    }
    this.initialized = true
    logger.agent.info(`[ToolRegistry] Registered ${this.tools.size} tools`)
  }

  registerScenarioTool(name: string, definition: ToolDefinition, executor: ToolExecutor, options?: { override?: boolean }): boolean {
    if (this.tools.has(name) && !options?.override) return false

    const schema = z.object({}).passthrough()

    this.tools.set(name, {
      name,
      definition,
      schema,
      getExecutor: () => executor,
      category: 'interaction' as ToolCategory,
      approvalType: 'none',
      parallel: false,
      enabled: true,
    })

    logger.agent.info(`[ToolRegistry] Registered scenario tool: ${name}`)
    return true
  }

  unregisterScenarioTool(name: string): boolean {
    return this.tools.delete(name)
  }

  isInitialized(): boolean {
    return this.initialized
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name)
  }

  has(name: string): boolean {
    return this.tools.has(name)
  }

  /**
   * 获取所有已注册的工具
   */
  getAll(): RegisteredTool[] {
    return Array.from(this.tools.values()).filter(t => t.enabled)
  }

  getApprovalType(name: string): ToolApprovalType {
    return this.tools.get(name)?.approvalType || 'none'
  }

  /**
   * 验证工具参数
   */
  validate<T = unknown>(name: string, args: unknown): ValidationResult<T> {
    const tool = this.tools.get(name)
    if (!tool) return { success: false, error: `Unknown tool: ${name}` }

    // 确保 args 是一个对象
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      args = {}
    }

    const result = tool.schema.safeParse(args)
    if (result.success) return { success: true, data: result.data as T }

    const errors = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')
    return { success: false, error: `Invalid parameters: ${errors}` }
  }

  /**
   * 执行工具
   */
  async execute(
    name: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    const tool = this.tools.get(name)
    if (!tool) return { success: false, result: '', error: `Unknown tool: ${name}` }
    if (!tool.enabled) return { success: false, result: '', error: `Tool "${name}" is disabled` }

    // 确保 args 是一个对象
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      args = {}
    }

    const validation = this.validate(name, args)
    if (!validation.success) {
      logger.agent.warn(`[ToolRegistry] Validation failed for ${name}:`, validation.error)
      return { success: false, result: '', error: `Validation failed: ${validation.error}` }
    }

    // 安全预检查：审批 + 沙箱验证
    const securityResult = await this.securityPreCheck(name, validation.data as Record<string, unknown>, context)
    if (!securityResult.allowed) {
      logger.agent.warn(`[ToolRegistry] Security pre-check blocked ${name}: ${securityResult.reason}`)
      return { success: false, result: '', error: securityResult.reason || 'Tool execution blocked by security policy' }
    }

    // 通过 getter 获取最新的执行器（支持热重载）
    const executor = tool.getExecutor()
    if (!executor) {
      return { success: false, result: '', error: `Executor not found for tool: ${name}` }
    }

    try {
      return await executor(validation.data as Record<string, unknown>, context)
    } catch (err) {
      logger.agent.error(`[ToolRegistry] Execution error for ${name}:`, err)
      return { success: false, result: '', error: `Execution error: ${toAppError(err).message}` }
    }
  }

  /**
   * 安全预检查（审批 + 沙箱）
   * 通过 IPC 调用主进程的 SecureToolExecutor
   *
   * 优化：如果工具的 approvalType 为 'none'，直接放行，
   * 避免主进程审批系统（缺少渲染进程审批 UI）导致工具卡住。
   */
  private async securityPreCheck(
    toolName: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<{ allowed: boolean; reason?: string }> {
    // 如果工具的 approvalType 为 'none'，直接放行
    const tool = this.tools.get(toolName)
    if (tool && tool.approvalType === 'none') {
      return { allowed: true }
    }

    try {
      // 判断是否为命令类工具
      const commandTools = new Set([
        'execute_command', 'shell', 'terminal', 'run_command',
        'bash', 'sh', 'powershell', 'cmd',
      ])
      const isCommandTool = commandTools.has(toolName)

      const result = await api.security.preCheckTool({
        toolName,
        toolArgs: args,
        agentId: context.assistantId || context.currentAssistantId || 'default',
        cwd: context.workspacePath || '',
        isCommandTool,
        command: isCommandTool ? (args.command as string || args.cmd as string) : undefined,
        skipApproval: context.skipMainApproval ?? false,
      })

      return {
        allowed: result.allowed !== false,
        reason: result.reason,
      }
    } catch (err) {
      // 安全检查失败时默认放行，避免安全模块不可用导致工具全部不可用
      logger.agent.warn(`[ToolRegistry] Security pre-check error for ${toolName}:`, err)
      return { allowed: true }
    }
  }

  setEnabled(name: string, enabled: boolean): boolean {
    const tool = this.tools.get(name)
    if (!tool) return false
    tool.enabled = enabled
    return true
  }
}

export const toolRegistry = new ToolRegistry()
