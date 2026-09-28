/**
 * 工具管理器
 * 统一管理多个工具提供者，提供统一的工具访问接口
 */

import { logger } from '@toolkit/LogEngine'
import { toAppError } from '@shared/toolkit/errorCatalog'
import { getToolMetadata } from '@configuration/toolDefinitions'
import { getActiveCustomAgent, isToolAllowedForAgent } from '@renderer-configuration/customAgentTools'
import { useStore } from '@store'
import type { ToolProvider, ToolMeta } from '@intelligence/providerTypes'
import type {
  ToolDefinition,
  ToolExecutionResult,
  ToolExecutionContext,
  ToolApprovalType,
  ToolExecutionEnvelope,
  ToolExecutionOutcome,
} from '@intelligence/providerTypes'
import {
  isToolAllowedByPlanSync,
  buildToolNotAllowedMessage,
} from '@services/featureGuardService'
import { GIT_TOOL_NAMES } from '@configuration/toolCategoryDefs'
import { isGitToolsEnabled } from '../gitToolsGate'
import { buildMissingPathHint, normalizeToolPathArgs } from '../toolArgNormalizer'

class ToolManager {
  private providers = new Map<string, ToolProvider>()
  private providerPriorities = new Map<string, number>()
  private providerOrder: string[] = []

  /**
   * 注册工具提供者
   * @param provider 工具提供者
   * @param priority 优先级（数字越小优先级越高）
   */
  registerProvider(provider: ToolProvider, priority = 100): void {
    if (this.providers.has(provider.id)) {
      logger.agent.warn(`[ToolManager] Provider ${provider.id} already registered, replacing`)
    }

    this.providers.set(provider.id, provider)
    this.providerPriorities.set(provider.id, priority)

    // 按各 provider 自身的优先级排序
    this.providerOrder = Array.from(this.providers.keys()).sort((a, b) => {
      const priorityA = this.providerPriorities.get(a) ?? 100
      const priorityB = this.providerPriorities.get(b) ?? 100
      return priorityA - priorityB
    })

    logger.agent.info(`[ToolManager] Registered provider: ${provider.id} (${provider.name})`)
  }

  /**
   * 移除工具提供者
   */
  unregisterProvider(providerId: string): boolean {
    const removed = this.providers.delete(providerId)
    if (removed) {
      this.providerOrder = this.providerOrder.filter(id => id !== providerId)
      logger.agent.info(`[ToolManager] Unregistered provider: ${providerId}`)
    }
    return removed
  }

  /**
   * 获取工具提供者
   */
  getProvider(providerId: string): ToolProvider | undefined {
    return this.providers.get(providerId)
  }

  /**
   * 查找工具所属的提供者
   */
  findProviderForTool(toolName: string): ToolProvider | undefined {
    for (const providerId of this.providerOrder) {
      const provider = this.providers.get(providerId)
      if (provider?.hasTool(toolName)) {
        return provider
      }
    }
    return undefined
  }

  /**
   * 检查工具是否存在
   */
  hasTool(toolName: string): boolean {
    return this.findProviderForTool(toolName) !== undefined
  }

  /**
   * 获取所有工具定义
   */
  getAllToolDefinitions(): ToolDefinition[] {
    const definitions: ToolDefinition[] = []
    const seenNames = new Set<string>()

    for (const providerId of this.providerOrder) {
      const provider = this.providers.get(providerId)
      if (!provider) continue

      for (const def of provider.getToolDefinitions()) {
        if (!seenNames.has(def.name)) {
          definitions.push(def)
          seenNames.add(def.name)
        }
      }
    }

    return definitions
  }

  /**
   * 获取工具元信息
   */
  getToolMeta(toolName: string): ToolMeta | undefined {
    const provider = this.findProviderForTool(toolName)
    if (!provider) return undefined

    const definitions = provider.getToolDefinitions()
    const definition = definitions.find(d => d.name === toolName)
    if (!definition) return undefined

    return {
      name: toolName,
      providerId: provider.id,
      providerName: provider.name,
      definition,
      approvalType: provider.getApprovalType(toolName),
    }
  }

  /**
   * 获取工具审批类型
   */
  getApprovalType(toolName: string): ToolApprovalType {
    const provider = this.findProviderForTool(toolName)
    return provider?.getApprovalType(toolName) || 'dangerous'
  }

  /**
   * 验证工具参数
   */
  validateArgs(toolName: string, args: unknown): { valid: boolean; error?: string } {
    const provider = this.findProviderForTool(toolName)
    if (!provider) {
      return { valid: false, error: `Unknown tool: ${toolName}` }
    }
    return provider.validateArgs(toolName, args)
  }

  private buildEnvelope(
    executionId: string,
    startedAt: number,
    providerId?: string,
    partial?: Partial<ToolExecutionEnvelope>
  ): ToolExecutionEnvelope {
    return {
      executionId,
      providerId,
      startedAt,
      completedAt: partial?.completedAt ?? Date.now(),
      retryable: partial?.retryable ?? false,
      errorCategory: partial?.errorCategory,
    }
  }

  private inferRetryable(toolName: string, errorCategory?: ToolExecutionEnvelope['errorCategory']): boolean {
    const retryPolicy = getToolMetadata(toolName)?.retryPolicy
    if (!retryPolicy || retryPolicy.maxAttempts <= 1) {
      return false
    }
    return errorCategory === 'timeout' || errorCategory === 'execution' || errorCategory === 'dependency'
  }

  private inferOutcome(
    result: ToolExecutionResult,
    retryable: boolean
  ): ToolExecutionOutcome {
    if (result.outcome) {
      return {
        retryable,
        ...result.outcome,
      }
    }

    // 以「工具调用是否失败」为准：命令跑完但业务失败不该被当成工具故障
    const callFailed = result.callFailed ?? !result.success

    return callFailed
      ? { kind: 'error', retryable, code: result.error ? 'EXECUTION_ERROR' : 'UNKNOWN_ERROR' }
      : { kind: 'success', retryable }
  }

  private finalizeResult(
    toolName: string,
    executionId: string,
    startedAt: number,
    providerId: string | undefined,
    result: ToolExecutionResult,
    errorCategory?: ToolExecutionEnvelope['errorCategory']
  ): ToolExecutionResult {
    const retryable = result.envelope?.retryable ?? result.outcome?.retryable ?? this.inferRetryable(toolName, errorCategory ?? result.envelope?.errorCategory)
    const envelope = this.buildEnvelope(executionId, startedAt, providerId, {
      ...result.envelope,
      completedAt: result.envelope?.completedAt ?? Date.now(),
      retryable,
      errorCategory: errorCategory ?? result.envelope?.errorCategory,
    })

    return {
      ...result,
      envelope,
      outcome: this.inferOutcome(result, retryable),
    }
  }

  private semanticValidate(
    toolName: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ): { valid: boolean; error?: string } {
    const metadata = getToolMetadata(toolName)
    if (!metadata || metadata.validationLevel === 'schema') {
      return { valid: true }
    }

    if (metadata.requiresWorkspace && !context.workspacePath) {
      return { valid: false, error: 'Workspace is required for this tool' }
    }

    if ((metadata.validationLevel === 'semantic' || metadata.validationLevel === 'strict') && metadata.validate) {
      return metadata.validate(args)
    }

    return { valid: true }
  }

  /**
   * 执行工具
   */
  async execute(
    toolName: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    const executionId = crypto.randomUUID()
    const startedAt = Date.now()

    // 自定义智能体工具权限兜底校验（执行层强制）
    // 即使工具定义被误注入，或调用方绕过上下文过滤，这里也会拒绝越权调用
    const activeAgent = getActiveCustomAgent()
    if (activeAgent && !isToolAllowedForAgent(toolName, activeAgent)) {
      logger.agent.warn(
        `[ToolManager] Tool "${toolName}" rejected: not allowed for active agent "${activeAgent.name}"`,
      )
      // 双语文案：tool result 返回给 LLM 的同时，error 会直接展示在工具卡片上，需对用户友好
      const isZh = useStore.getState().language === 'zh'
      const errorMsg = isZh
        ? `工具 "${toolName}" 未被当前智能体「${activeAgent.name}」授权使用。\n该智能体未开启此工具/技能权限，请编辑智能体并开启该工具支持后重试。`
        : `Tool "${toolName}" is not allowed for the active agent "${activeAgent.name}".\nThis agent has not enabled this tool/skill. Please edit the agent and enable it to continue.`
      return this.finalizeResult(toolName, executionId, startedAt, undefined, {
        success: false,
        result: '',
        error: errorMsg,
        outcome: { kind: 'error', code: 'TOOL_NOT_ALLOWED', retryable: false },
      }, 'validation')
    }

    // 套餐工具能力组兜底校验（执行层强制）
    // 主闸门是「可见性」—— getToolsForContext 不下发未授权工具，AI 自然不会调用；
    // 此处拦截绕过上下文过滤的直接调用（如外部 API 桥 / 渠道会话传入的工具名）。
    // 权益不可信或未配置白名单时 isToolAllowedByPlanSync() 返回 true（fail-open）。
    if (!isToolAllowedByPlanSync(toolName)) {
      logger.agent.warn(
        `[ToolManager] Tool "${toolName}" rejected: not included in current plan`,
      )
      const isZhPlan = useStore.getState().language === 'zh'
      return this.finalizeResult(toolName, executionId, startedAt, undefined, {
        success: false,
        result: '',
        error: buildToolNotAllowedMessage(toolName, isZhPlan),
        outcome: {
          kind: 'error',
          code: 'TOOL_NOT_ALLOWED_BY_PLAN',
          retryable: false,
        },
      }, 'validation')
    }

    // Git 工具兜底校验（执行层强制）
    // 主闸门是「可见性」—— getToolsForContext 在用户没有提出 Git 操作时不下发 git_*；
    // 此处拦截绕过上下文过滤的直接调用：工作区并非都是 Git 仓库，AI 自己「探路」
    // 会稳定失败，因此要求先由用户在指令中授权。
    if (GIT_TOOL_NAMES.includes(toolName) && !isGitToolsEnabled()) {
      logger.agent.warn(`[ToolManager] Tool "${toolName}" rejected: git tools are not enabled for this turn`)
      const isZhGit = useStore.getState().language === 'zh'
      const gitErrorMsg = isZhGit
        ? `工具 "${toolName}" 需要用户先提出 Git 操作才会启用。\n本轮用户消息没有提到提交、分支、合并、差异、历史等版本控制操作，请先询问用户是否需要操作仓库，不要自行探测，也不要改用命令行执行 git。`
        : `Tool "${toolName}" is enabled only after the user asks for a Git operation.\nThis turn's message does not mention commits, branches, merges, diffs or history — ask the user first instead of probing the repository, and do not fall back to running git in the terminal.`
      return this.finalizeResult(toolName, executionId, startedAt, undefined, {
        success: false,
        result: '',
        error: gitErrorMsg,
        outcome: { kind: 'error', code: 'TOOL_NOT_ALLOWED', retryable: false },
      }, 'validation')
    }

    const provider = this.findProviderForTool(toolName)

    if (!provider) {
      return this.finalizeResult(toolName, executionId, startedAt, undefined, {
        success: false,
        result: '',
        error: `Unknown tool: ${toolName}`,
        outcome: { kind: 'error', code: 'UNKNOWN_TOOL', retryable: false },
      }, 'validation')
    }

    // 路径类别名归一：把 file_path / dir 之类的写法归到工具声明的参数名上。
    // 调用方偶尔会按别的工具的参数名传路径，直接进校验会稳定失败，
    // AI 侧表现为反复重试同一个错误。
    const normalizedArgs = normalizeToolPathArgs(toolName, args)

    // 验证参数
    const validation = provider.validateArgs(toolName, normalizedArgs)
    if (!validation.valid) {
      // 失败信息里补上「该传哪个参数名」的提示，让模型能一次改对
      const error = `Validation failed: ${validation.error}${buildMissingPathHint(toolName, normalizedArgs)}`
      return this.finalizeResult(toolName, executionId, startedAt, provider.id, {
        success: false,
        result: '',
        error,
        outcome: { kind: 'error', code: 'VALIDATION_FAILED', retryable: false },
      }, 'validation')
    }

    const semanticValidation = this.semanticValidate(toolName, normalizedArgs, context)
    if (!semanticValidation.valid) {
      return this.finalizeResult(toolName, executionId, startedAt, provider.id, {
        success: false,
        result: '',
        error: `Semantic validation failed: ${semanticValidation.error}`,
        outcome: { kind: 'error', code: 'SEMANTIC_VALIDATION_FAILED', retryable: false },
      }, 'validation')
    }

    // 执行
    try {
      const result = await provider.execute(toolName, normalizedArgs, context)
      return this.finalizeResult(toolName, executionId, startedAt, provider.id, result, result.success ? undefined : 'execution')
    } catch (err) {
      logger.agent.error(`[ToolManager] Tool execution failed:`, err)
      return this.finalizeResult(toolName, executionId, startedAt, provider.id, {
        success: false,
        result: '',
        error: `Execution error: ${toAppError(err).message}`,
        outcome: { kind: 'error', code: 'EXECUTION_ERROR' },
      }, 'execution')
    }
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    providers: number
    totalTools: number
    byProvider: Record<string, number>
  } {
    const byProvider: Record<string, number> = {}
    let totalTools = 0

    for (const [id, provider] of this.providers) {
      const count = provider.getToolDefinitions().length
      byProvider[id] = count
      totalTools += count
    }

    return {
      providers: this.providers.size,
      totalTools,
      byProvider,
    }
  }
}

/** 工具管理器单例 */
export const toolManager = new ToolManager()
