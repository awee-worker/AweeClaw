/**
 * 对外 API 网关的工具桥（渲染层）
 *
 * 存在理由：`/mcp` 端点要回答「AweeClaw 有哪些工具 / 帮我执行某个工具」，
 * 而**工具清单与执行能力全在渲染进程**（内置工具、MCP 工具、场景工具、
 * 工作区沙箱、命令黑名单）。主进程只有 `mcpManager` 那一小撮 MCP 工具，
 * 拿它对外声明等于谎报能力。
 *
 * 数据流：
 *   OpenApiServer（HTTP）
 *     → OpenApiToolBridge（主进程，ipcMain + webContents.send）
 *     → 本文件（渲染层，监听 openapi:tools:request）
 *     → toolManager（真实清单 / 真实执行）
 *     → replyToolRequest → ipcMain.once → HTTP 响应
 *
 * ⚠️ 安全：这里是**第二道门禁**。主进程已按 `approvalType` 拦过一次，
 * 本文件再判一次并做两件事：
 *   1. 未授权时拒绝 terminal / dangerous / interaction 类工具
 *   2. 以 `skipMainApproval: true` 执行 —— 外部请求没有本机用户在旁边点确认，
 *      若走审批流程会永久挂起。注意这只跳过 UI 审批，**不影响**主进程的
 *      安全底线（命令黑名单、敏感路径、工作区边界）。
 *
 * @module intelligence/toolkit/openApiToolBridge
 */

import { logger } from '@toolkit/LogEngine'
import { api } from '@renderer/adapters/electronBridge'
import { toolManager } from './providers'
import type { ToolDefinition, ToolExecutionContext } from '@intelligence/providerTypes'
import type { OpenApiToolRequestPayload } from '@shared/protocols/openApiProtocol'

/** 无需审批即可被外部调用的审批类型（与主进程 MCP 路由的白名单保持一致） */
const SAFE_APPROVAL_TYPES = new Set(['none'])

/** MCP 形状的工具描述（与主进程 RemoteToolInfo 对应） */
interface BridgedTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  approvalType: string
}

/** 是否已初始化（幂等） */
let initialized = false

/** 取消订阅函数（供热重载 / 卸载时清理） */
let unsubscribe: (() => void) | null = null

/** 初始化渲染层工具桥 */
export function initOpenApiToolBridge(): void {
  if (initialized) return
  initialized = true

  try {
    unsubscribe = api.openapi.onToolRequest((payload) => {
      // 不 await：IPC 回调不应阻塞；每个分支自己负责回包
      void handleToolRequest(payload)
    })
    logger.agent.info('[OpenApiToolBridge] renderer tool bridge ready')
  } catch (err) {
    initialized = false
    logger.agent.warn('[OpenApiToolBridge] init failed (对外 API 工具桥不可用):', err)
  }
}

/** 卸载（测试 / 热重载用） */
export function disposeOpenApiToolBridge(): void {
  unsubscribe?.()
  unsubscribe = null
  initialized = false
}

// ============================================
// 请求处理
// ============================================

async function handleToolRequest(payload: OpenApiToolRequestPayload): Promise<void> {
  if (!payload || typeof payload.requestId !== 'string') return

  try {
    if (payload.action === 'list') {
      api.openapi.replyToolRequest(payload.requestId, { tools: collectTools() })
      return
    }

    if (payload.action === 'call') {
      api.openapi.replyToolRequest(payload.requestId, await executeTool(payload))
      return
    }

    api.openapi.replyToolRequest(payload.requestId, {
      success: false,
      result: '',
      error: `未知的桥接动作：${String((payload as { action?: unknown }).action)}`,
    })
  } catch (err) {
    logger.agent.error('[OpenApiToolBridge] handle request failed:', err)
    api.openapi.replyToolRequest(payload.requestId, {
      success: false,
      result: '',
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

/** 收集当前全部工具的 MCP 形状描述 */
function collectTools(): BridgedTool[] {
  let definitions: ToolDefinition[] = []
  try {
    definitions = toolManager.getAllToolDefinitions()
  } catch (err) {
    logger.agent.warn('[OpenApiToolBridge] getAllToolDefinitions failed:', err)
    return []
  }

  return definitions.map((def) => ({
    name: def.name,
    description: def.description || '',
    // ToolDefinition.parameters 已经是 JSON Schema 形状，直接作为 inputSchema
    inputSchema: {
      type: 'object',
      properties: def.parameters?.properties ?? {},
      ...(def.parameters?.required?.length ? { required: def.parameters.required } : {}),
    },
    approvalType: safeApprovalType(def.name),
  }))
}

/** 读审批类型（读取失败按最严处理：dangerous） */
function safeApprovalType(toolName: string): string {
  try {
    return toolManager.getApprovalType(toolName) || 'dangerous'
  } catch {
    return 'dangerous'
  }
}

/** 执行一次工具调用（含门禁） */
async function executeTool(
  payload: OpenApiToolRequestPayload,
): Promise<{ success: boolean; result: string; error?: string }> {
  const toolName = (payload.toolName || '').trim()
  if (!toolName) return { success: false, result: '', error: '缺少 toolName' }

  if (!toolManager.hasTool(toolName)) {
    return { success: false, result: '', error: `未知工具：${toolName}` }
  }

  // --- 门禁（第二道）---
  const approvalType = safeApprovalType(toolName)
  if (!SAFE_APPROVAL_TYPES.has(approvalType) && payload.allowDangerous !== true) {
    logger.agent.warn(
      `[OpenApiToolBridge] blocked external call to "${toolName}" (approvalType=${approvalType})`,
    )
    return {
      success: false,
      result: '',
      error:
        `工具「${toolName}」需要本机确认或涉及本机改动（类型：${approvalType}），已拒绝外部调用` +
        '（请在 AweeClaw「设置 → 对外 API」中开启「允许外部执行写操作类工具」后重试）',
    }
  }

  const args =
    payload.args && typeof payload.args === 'object' && !Array.isArray(payload.args)
      ? (payload.args as Record<string, unknown>)
      : {}

  // ⚠️ skipMainApproval 只跳过 UI 审批：命令黑名单 / 敏感路径 / 工作区边界
  // 由主进程安全层继续生效（见 configTypes.AuthorizationMode 注释）
  const context: ToolExecutionContext = {
    workspacePath: payload.workspacePath ?? null,
    chatMode: 'agent',
    requestId: `openapi-mcp-${payload.requestId}`,
    skipMainApproval: true,
  }

  logger.agent.info(`[OpenApiToolBridge] external tool call: ${toolName} (approval=${approvalType})`)

  const result = await toolManager.execute(toolName, args, context)
  return {
    success: result.success,
    result: result.result || '',
    error: result.error,
  }
}
