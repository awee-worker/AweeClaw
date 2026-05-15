/**
 * MCP IPC 处理器
 * 处理渲染进程与 MCP 服务的通信
 * 支持本地和远程 MCP 服务器，包括 OAuth 认证
 * [AweeClaw] 增强功能：工具沙箱策略、工具审计日志、场景权限控制
 */

import { BrowserWindow } from 'electron'
import { safeIpcHandle } from './ipcGuard'
import { logger } from '@shared/toolkit/LogEngine'
import { mcpManager, mcpRegistry } from '../modules/tool-protocol'
import type {
  McpToolCallRequest,
  McpResourceReadRequest,
  McpPromptGetRequest,
  McpServerConfig,
} from '@shared/protocols/toolProtocolBridge'
import { BRAND } from '@shared/brand'

export function registerMcpHandlers(_getMainWindow: () => BrowserWindow | null): void {
  // 初始化 MCP 管理器
  safeIpcHandle('mcp:initialize', async (_, workspaceRoots: string[]) => {
    await mcpManager.initialize(workspaceRoots)
    return { success: true }
  })

  // 获取所有服务器状态
  safeIpcHandle('mcp:getServersState', async () => {
    return { success: true, servers: await mcpManager.getServersState() }
  })

  // 获取所有可用工具
  safeIpcHandle('mcp:getAllTools', async () => {
    return { success: true, tools: mcpManager.getAllTools() }
  })

  // 连接服务器
  safeIpcHandle('mcp:connectServer', async (_, serverId: string) => {
    await mcpManager.connectServer(serverId)
    return { success: true }
  })

  // 断开服务器
  safeIpcHandle('mcp:disconnectServer', async (_, serverId: string) => {
    await mcpManager.disconnectServer(serverId)
    return { success: true }
  })

  // 重连服务器
  safeIpcHandle('mcp:reconnectServer', async (_, serverId: string) => {
    await mcpManager.reconnectServer(serverId)
    return { success: true }
  })

  // 调用工具
  safeIpcHandle('mcp:callTool', async (_, request: McpToolCallRequest) => {
    const result = await mcpManager.callTool(
      request.serverId,
      request.toolName,
      request.arguments
    )
    return result
  })

  // 读取资源
  safeIpcHandle('mcp:readResource', async (_, request: McpResourceReadRequest) => {
    const result = await mcpManager.readResource(request.serverId, request.uri)
    return result
  })

  // 获取提示
  safeIpcHandle('mcp:getPrompt', async (_, request: McpPromptGetRequest) => {
    const result = await mcpManager.getPrompt(
      request.serverId,
      request.promptName,
      request.arguments
    )
    return result
  })

  // 刷新服务器能力
  safeIpcHandle('mcp:refreshCapabilities', async (_, serverId: string) => {
    await mcpManager.refreshServerCapabilities(serverId)
    return { success: true }
  })

  // 获取配置路径
  safeIpcHandle('mcp:getConfigPaths', async () => {
    return { success: true, paths: mcpManager.getConfigPaths() }
  })

  // 重新加载配置
  safeIpcHandle('mcp:reloadConfig', async () => {
    await mcpManager.reloadConfig()
    return { success: true }
  })

  // 添加服务器（支持本地和远程）
  safeIpcHandle('mcp:addServer', async (_, config: McpServerConfig, level?: 'user' | 'workspace') => {
    await mcpManager.addServer(config, level)
    return { success: true }
  })

  // 删除服务器
  safeIpcHandle('mcp:removeServer', async (_, serverId: string, level?: 'user' | 'workspace') => {
    await mcpManager.removeServer(serverId, level)
    return { success: true }
  })

  // 切换服务器启用/禁用
  safeIpcHandle('mcp:toggleServer', async (_, serverId: string, disabled: boolean, level?: 'user' | 'workspace') => {
    await mcpManager.toggleServer(serverId, disabled, level)
    return { success: true }
  })

  // =================== OAuth 相关处理器 ===================

  // 开始 OAuth 认证流程
  safeIpcHandle('mcp:startOAuth', async (_, serverId: string) => {
    const result = await mcpManager.startOAuth(serverId)
    return result
  })

  // 完成 OAuth 认证
  safeIpcHandle('mcp:finishOAuth', async (_, serverId: string, authorizationCode: string) => {
    const result = await mcpManager.finishOAuth(serverId, authorizationCode)
    return result
  })

  // 刷新 OAuth token
  safeIpcHandle('mcp:refreshOAuthToken', async (_, serverId: string) => {
    const result = await mcpManager.refreshOAuthToken(serverId)
    return result
  })

  // 设置自动连接选项
  safeIpcHandle('mcp:setAutoConnect', async (_, enabled: boolean) => {
    mcpManager.setAutoConnectEnabled(enabled)
    return { success: true }
  })

  // =================== Registry 相关处理器 ===================

  // 搜索 Registry 中的 MCP 服务器
  safeIpcHandle('mcp:registrySearch', async (_, query?: string) => {
    const results = await mcpRegistry.search(query)
    return { success: true, servers: results }
  })

  // 获取 Registry 服务器详情
  safeIpcHandle('mcp:registryGetDetails', async (_, serverName: string) => {
    const server = await mcpRegistry.getServerDetails(serverName)
    if (!server) return { success: false, error: 'Server not found' }
    return {
      success: true,
      server,
      requiredEnvVars: mcpRegistry.getRequiredEnvVars(server),
      localConfig: mcpRegistry.toLocalConfig(server),
    }
  })

  // 从 Registry 安装 MCP 服务器
  safeIpcHandle(
    'mcp:registryInstall',
    async (_, serverName: string, envValues?: Record<string, string>) => {
      const server = await mcpRegistry.getServerDetails(serverName)
      if (!server) return { success: false, error: 'Server not found in registry' }

      const config = mcpRegistry.toLocalConfig(server)
      if (!config) return { success: false, error: 'Cannot generate config for this server' }

      // 合并用户提供的环境变量
      if (envValues && 'command' in config) {
        config.env = { ...config.env, ...envValues }
      }

      await mcpManager.addServer(config)
      logger.mcp?.info(`[McpRegistry] Installed server from registry: ${serverName}`)
      return { success: true, config }
    }
  )

  // [AweeClaw] 注册增强 IPC handlers
  registerAweeClawMcpHandlers()

  logger.mcp?.info('[MCP IPC] Handlers registered')
}

// ============================================
// [AweeClaw] MCP 工具沙箱策略
// ============================================

interface McpToolPolicy {
  serverId: string
  toolName: string
  allowed: boolean
  maxCallsPerMinute?: number
  requireConfirmation?: boolean
  allowedScenarios?: string[]
}

const toolPolicies = new Map<string, McpToolPolicy>()
const toolCallCounts = new Map<string, { count: number; resetAt: number }>()

function getPolicyKey(serverId: string, toolName: string): string {
  return `${serverId}::${toolName}`
}

function checkToolPolicy(serverId: string, toolName: string, scenarioId?: string): { allowed: boolean; reason?: string } {
  const key = getPolicyKey(serverId, toolName)
  const policy = toolPolicies.get(key)

  if (!policy) return { allowed: true }

  if (!policy.allowed) {
    return { allowed: false, reason: `Tool ${toolName} is blocked by policy` }
  }

  if (policy.allowedScenarios && policy.allowedScenarios.length > 0 && scenarioId) {
    if (!policy.allowedScenarios.includes(scenarioId)) {
      return { allowed: false, reason: `Tool ${toolName} is not allowed in scenario ${scenarioId}` }
    }
  }

  if (policy.maxCallsPerMinute) {
    const now = Date.now()
    const callRecord = toolCallCounts.get(key)
    if (!callRecord || now > callRecord.resetAt) {
      toolCallCounts.set(key, { count: 1, resetAt: now + 60_000 })
    } else {
      callRecord.count++
      if (callRecord.count > policy.maxCallsPerMinute) {
        return { allowed: false, reason: `Tool ${toolName} exceeded rate limit (${policy.maxCallsPerMinute}/min)` }
      }
    }
  }

  return { allowed: true }
}

// ============================================
// [AweeClaw] MCP 工具审计日志
// ============================================

interface McpToolAuditEntry {
  timestamp: number
  serverId: string
  toolName: string
  arguments?: any
  result?: any
  error?: string
  duration: number
  scenarioId?: string
  windowId?: number
}

const auditEntries: McpToolAuditEntry[] = []
const MAX_AUDIT_ENTRIES = 1000

function appendAudit(entry: McpToolAuditEntry): void {
  auditEntries.push(entry)
  if (auditEntries.length > MAX_AUDIT_ENTRIES) {
    auditEntries.splice(0, auditEntries.length - MAX_AUDIT_ENTRIES)
  }
}

// ============================================
// [AweeClaw] 独有 MCP IPC Handlers
// ============================================

function registerAweeClawMcpHandlers(): void {
  // 工具策略管理
  safeIpcHandle('mcp:setToolPolicy', async (_, policy: McpToolPolicy) => {
    const key = getPolicyKey(policy.serverId, policy.toolName)
    toolPolicies.set(key, policy)
    logger.mcp?.info(`[MCP] Tool policy set: ${key} -> allowed=${policy.allowed}`)
    return { success: true }
  })

  safeIpcHandle('mcp:getToolPolicy', async (_, serverId: string, toolName: string) => {
    const key = getPolicyKey(serverId, toolName)
    return { success: true, policy: toolPolicies.get(key) || null }
  })

  safeIpcHandle('mcp:removeToolPolicy', async (_, serverId: string, toolName: string) => {
    const key = getPolicyKey(serverId, toolName)
    toolPolicies.delete(key)
    return { success: true }
  })

  safeIpcHandle('mcp:listToolPolicies', async () => {
    return { success: true, policies: Array.from(toolPolicies.values()) }
  })

  // 审计日志查询
  safeIpcHandle('mcp:getAuditLog', async (_, filter?: {
    serverId?: string
    toolName?: string
    since?: number
    limit?: number
  }) => {
    let results = [...auditEntries]
    if (filter?.serverId) results = results.filter(e => e.serverId === filter.serverId)
    if (filter?.toolName) results = results.filter(e => e.toolName === filter.toolName)
    if (filter?.since) results = results.filter(e => e.timestamp >= filter.since!)
    if (filter?.limit) results = results.slice(-filter.limit)
    return { success: true, entries: results }
  })

  safeIpcHandle('mcp:clearAuditLog', async () => {
    auditEntries.length = 0
    return { success: true }
  })

  // 带策略检查和审计的工具调用
  safeIpcHandle('mcp:callToolWithPolicy', async (_, request: McpToolCallRequest, scenarioId?: string) => {
    const policyCheck = checkToolPolicy(request.serverId, request.toolName, scenarioId)
    if (!policyCheck.allowed) {
      return { success: false, error: policyCheck.reason, blocked: true }
    }

    const startTime = Date.now()
    try {
      const result = await mcpManager.callTool(
        request.serverId,
        request.toolName,
        request.arguments
      )

      appendAudit({
        timestamp: Date.now(),
        serverId: request.serverId,
        toolName: request.toolName,
        arguments: request.arguments,
        result: result,
        duration: Date.now() - startTime,
        scenarioId,
      })

      return result
    } catch (error) {
      appendAudit({
        timestamp: Date.now(),
        serverId: request.serverId,
        toolName: request.toolName,
        arguments: request.arguments,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
        scenarioId,
      })
      throw error
    }
  })

  logger.mcp?.info(`[MCP] ${BRAND.name} enhanced IPC handlers registered (tool policy, audit, scenario control)`)
}

export function cleanupMcpHandlers(): void {
  mcpManager.cleanup().catch(err => {
    logger.mcp?.error('[MCP IPC] Cleanup failed:', err)
  })
}

export { mcpManager }
