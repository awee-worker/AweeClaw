/**
 * Tool Approval - 工具执行审批系统
 *
 * 借鉴 OpenClaw 的安全模型，实现工具执行前的审批机制：
 * 1. 工具分级：根据风险等级自动决定是否需要审批
 * 2. 审批策略：allow / ask / deny 三级
 * 3. 审批缓存：同一操作在短时间内可自动批准
 * 4. Agent 隔离：不同 Agent 可有不同的工具权限
 *
 * @module security/ToolApprovalManager
 */

import { EventEmitter } from 'events'
import { logger } from '@shared/toolkit/LogEngine'

// ============================================
// 工具风险等级
// ============================================

export type ToolRiskLevel = 'safe' | 'moderate' | 'dangerous' | 'critical'

/** 工具风险等级映射 */
const TOOL_RISK_MAP: Record<string, ToolRiskLevel> = {
  // 安全：只读操作
  read_file: 'safe',
  read_multiple_files: 'safe',
  list_directory: 'safe',
  get_dir_tree: 'safe',
  search_files: 'safe',
  codebase_search: 'safe',
  find_references: 'safe',
  grep_search: 'safe',
  get_document_symbols: 'safe',
  get_definition: 'safe',
  get_hover_info: 'safe',
  get_lint_errors: 'safe',

  // 中等：可能产生副作用的操作
  edit_file: 'moderate',
  replace_file_content: 'moderate',
  write_file: 'moderate',
  create_file: 'moderate',
  git_commit: 'moderate',
  git_diff: 'safe',
  git_log: 'safe',

  // 危险：可能破坏性操作
  delete_file: 'dangerous',
  run_command: 'dangerous',
  execute_command: 'dangerous',
  shell_execute: 'dangerous',
  npm_install: 'dangerous',
  npm_run: 'dangerous',

  // 严重：不可逆操作
  rm_rf: 'critical',
  format_disk: 'critical',
  sudo: 'critical',
}

// ============================================
// 审批策略
// ============================================

export type ApprovalPolicy = 'allow' | 'ask' | 'deny'

export interface ToolApprovalConfig {
  /** 按风险等级的默认策略 */
  riskPolicies: Record<ToolRiskLevel, ApprovalPolicy>
  /** 按工具名的覆盖策略 */
  toolOverrides: Record<string, ApprovalPolicy>
  /** 审批缓存有效期（毫秒），0=不缓存 */
  cacheTtlMs: number
  /** 是否启用审批 */
  enabled: boolean
}

export const DEFAULT_TOOL_APPROVAL_CONFIG: ToolApprovalConfig = {
  riskPolicies: {
    safe: 'allow',
    moderate: 'ask',
    dangerous: 'ask',
    critical: 'deny',
  },
  toolOverrides: {},
  cacheTtlMs: 5 * 60 * 1000, // 5 分钟
  enabled: true,
}

// ============================================
// 审批请求与结果
// ============================================

export interface ToolApprovalRequest {
  /** 请求 ID */
  id: string
  /** Agent ID */
  agentId: string
  /** 工具名 */
  toolName: string
  /** 工具参数 */
  toolArgs: Record<string, unknown>
  /** 风险等级 */
  riskLevel: ToolRiskLevel
  /** 请求时间 */
  timestamp: number
  /** 策略决定的初始结果 */
  policyDecision: ApprovalPolicy
}

export type ToolApprovalDecision = 'approved' | 'denied' | 'timeout'

export interface ToolApprovalResult {
  requestId: string
  decision: ToolApprovalDecision
  reason: string
  approvedBy: 'policy' | 'cache' | 'user'
}

// ============================================
// 审批缓存条目
// ============================================

interface ApprovalCacheEntry {
  decision: ToolApprovalDecision
  timestamp: number
  toolName: string
  argsHash: string
}

// ============================================
// Tool Approval 管理器
// ============================================

class ToolApprovalManager extends EventEmitter {
  private config: ToolApprovalConfig
  /** Agent 级别的配置覆盖 */
  private agentOverrides = new Map<string, Partial<ToolApprovalConfig>>()
  /** 审批缓存 */
  private cache = new Map<string, ApprovalCacheEntry>()
  /** 等待用户审批的请求 */
  private pendingRequests = new Map<string, {
    request: ToolApprovalRequest
    resolve: (result: ToolApprovalResult) => void
    timer: ReturnType<typeof setTimeout>
  }>()

  constructor(config?: Partial<ToolApprovalConfig>) {
    super()
    this.config = { ...DEFAULT_TOOL_APPROVAL_CONFIG, ...config }
  }

  // ============================================
  // 审批流程
  // ============================================

  /**
   * 请求工具执行审批
   *
   * 流程：
   * 1. 检查是否启用审批
   * 2. 确定风险等级
   * 3. 查找策略（Agent 覆盖 > 工具覆盖 > 风险等级默认）
   * 4. 检查缓存
   * 5. 根据策略返回结果（allow=直接批准, ask=等待用户, deny=直接拒绝）
   */
  async requestApproval(
    agentId: string,
    toolName: string,
    toolArgs: Record<string, unknown>
  ): Promise<ToolApprovalResult> {
    if (!this.config.enabled) {
      return {
        requestId: this.generateRequestId(),
        decision: 'approved',
        reason: 'Approval system disabled',
        approvedBy: 'policy',
      }
    }

    const riskLevel = this.getRiskLevel(toolName)
    const policy = this.getPolicy(agentId, toolName, riskLevel)
    const requestId = this.generateRequestId()

    const request: ToolApprovalRequest = {
      id: requestId,
      agentId,
      toolName,
      toolArgs,
      riskLevel,
      timestamp: Date.now(),
      policyDecision: policy,
    }

    // 策略为 allow，直接批准
    if (policy === 'allow') {
      logger.security.info(`[ToolApproval] Auto-approved: ${toolName} (risk=${riskLevel}, agent=${agentId})`)
      return {
        requestId,
        decision: 'approved',
        reason: `Policy allows ${riskLevel} risk tools`,
        approvedBy: 'policy',
      }
    }

    // 策略为 deny，直接拒绝
    if (policy === 'deny') {
      logger.security.warn(`[ToolApproval] Denied by policy: ${toolName} (risk=${riskLevel}, agent=${agentId})`)
      return {
        requestId,
        decision: 'denied',
        reason: `Policy denies ${riskLevel} risk tools`,
        approvedBy: 'policy',
      }
    }

    // 策略为 ask，检查缓存
    const cacheKey = this.getCacheKey(agentId, toolName, toolArgs)
    const cached = this.cache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < this.config.cacheTtlMs) {
      logger.security.info(`[ToolApproval] Cache hit: ${toolName} → ${cached.decision} (agent=${agentId})`)
      return {
        requestId,
        decision: cached.decision,
        reason: 'Cached approval',
        approvedBy: 'cache',
      }
    }

    // 需要用户审批
    logger.security.info(`[ToolApproval] Awaiting user approval: ${toolName} (risk=${riskLevel}, agent=${agentId})`)
    this.emit('approval-requested', request)

    return new Promise<ToolApprovalResult>((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId)
        logger.security.warn(`[ToolApproval] Request timed out: ${requestId}`)
        resolve({
          requestId,
          decision: 'timeout',
          reason: 'User approval timed out',
          approvedBy: 'user',
        })
      }, 60000) // 60 秒超时

      this.pendingRequests.set(requestId, { request, resolve, timer: timeout })
    })
  }

  /**
   * 用户审批响应
   */
  respondApproval(requestId: string, approved: boolean, reason?: string): void {
    const pending = this.pendingRequests.get(requestId)
    if (!pending) return

    clearTimeout(pending.timer)
    this.pendingRequests.delete(requestId)

    const decision: ToolApprovalDecision = approved ? 'approved' : 'denied'
    const result: ToolApprovalResult = {
      requestId,
      decision,
      reason: reason || (approved ? 'User approved' : 'User denied'),
      approvedBy: 'user',
    }

    // 缓存结果
    if (this.config.cacheTtlMs > 0) {
      const cacheKey = this.getCacheKey(pending.request.agentId, pending.request.toolName, pending.request.toolArgs)
      this.cache.set(cacheKey, {
        decision,
        timestamp: Date.now(),
        toolName: pending.request.toolName,
        argsHash: cacheKey,
      })
    }

    logger.security.info(`[ToolApproval] User ${decision}: ${pending.request.toolName} (reason=${reason || 'N/A'})`)
    pending.resolve(result)
    this.emit('approval-responded', result)
  }

  // ============================================
  // 配置管理
  // ============================================

  /**
   * 设置 Agent 级别的配置覆盖
   */
  setAgentOverride(agentId: string, override: Partial<ToolApprovalConfig>): void {
    this.agentOverrides.set(agentId, override)
    logger.security.info(`[ToolApproval] Set agent override for: ${agentId}`)
  }

  /**
   * 移除 Agent 级别的配置覆盖
   */
  removeAgentOverride(agentId: string): void {
    this.agentOverrides.delete(agentId)
  }

  /**
   * 更新全局配置
   */
  updateConfig(config: Partial<ToolApprovalConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * 清除审批缓存
   */
  clearCache(): void {
    this.cache.clear()
  }

  /**
   * 获取待审批的请求列表
   */
  getPendingRequests(): ToolApprovalRequest[] {
    return Array.from(this.pendingRequests.values()).map(p => p.request)
  }

  // ============================================
  // 私有方法
  // ============================================

  private getRiskLevel(toolName: string): ToolRiskLevel {
    return TOOL_RISK_MAP[toolName] || 'moderate' // 未知工具默认中等风险
  }

  private getPolicy(agentId: string, toolName: string, riskLevel: ToolRiskLevel): ApprovalPolicy {
    // 1. Agent 级别的工具覆盖
    const agentConfig = this.agentOverrides.get(agentId)
    if (agentConfig?.toolOverrides?.[toolName]) {
      return agentConfig.toolOverrides[toolName]
    }

    // 2. 全局工具覆盖
    if (this.config.toolOverrides[toolName]) {
      return this.config.toolOverrides[toolName]
    }

    // 3. Agent 级别的风险策略
    if (agentConfig?.riskPolicies?.[riskLevel]) {
      return agentConfig.riskPolicies[riskLevel]
    }

    // 4. 全局风险策略
    return this.config.riskPolicies[riskLevel]
  }

  private getCacheKey(agentId: string, toolName: string, args: Record<string, unknown>): string {
    // 简单的参数哈希（生产环境应使用更可靠的哈希）
    const argsStr = JSON.stringify(args)
    let hash = 0
    for (let i = 0; i < argsStr.length; i++) {
      const char = argsStr.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash |= 0
    }
    return `${agentId}:${toolName}:${hash}`
  }

  private generateRequestId(): string {
    return `approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }
}

/** 全局 Tool Approval 管理器实例 */
export const toolApprovalManager = new ToolApprovalManager()
