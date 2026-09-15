/**
 * 对外 API 网关 ↔ 渲染层「工具清单 / 工具执行」桥（主进程）
 *
 * 为什么必须绕到渲染层：
 *   AweeClaw 的工具清单与执行能力（内置工具、MCP 工具、场景工具、审批门禁、
 *   工作区沙箱）**全部在渲染进程**持有。主进程只有 `mcpManager` 里那一小撮
 *   MCP 工具，拿它当 `/mcp` 的工具集等于对外声明「AweeClaw 只有这几个工具」，
 *   与用户在客户端里看到的完全不是一回事。
 *
 * 因此这里采用「主进程发起 → 渲染层应答」的反向 IPC（与 `device-link` 的同名机制
 * 一致）：主进程发 `openapi:tools:request`，渲染层处理完回 `openapi:tools:reply:<id>`。
 *
 * ⚠️ 安全边界：外部 MCP 客户端触发的工具执行**不允许弹本机审批弹窗**
 * （渲染层会以 `skipMainApproval` 执行）。因此渲染层必须先按 `approvalType`
 * 过滤掉 terminal / dangerous 类工具 —— 否则等于给外部开了一扇绕过审批的后门。
 * 该过滤在渲染层执行（那里才知道真实的 approvalType），主进程这里再挡一道白名单。
 *
 * @module openapi/OpenApiToolBridge
 */

import { ipcMain } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'
import { getMainWindow, getWindowWorkspace } from '../../bootstrap/windowManager'
import { getConfigStore } from '../../bootstrap/stores'
import {
  OPEN_API_TOOL_REPLY_PREFIX,
  OPEN_API_TOOL_REQUEST_CHANNEL,
} from '@shared/protocols/openApiProtocol'

/** 清单请求超时：本地往返，超过这个数说明渲染层卡了 */
const LIST_TIMEOUT_MS = 8_000

/**
 * 工具调用超时。
 *
 * 给得很宽松：外部客户端可能调用长耗时工具（跑测试、抓网页）。
 * 真正的超时控制权交给 MCP 客户端自己（它会主动断开），
 * 这里只是防止渲染层彻底无响应导致主进程悬挂。
 */
const CALL_TIMEOUT_MS = 5 * 60 * 1000

/** 渲染层返回的工具描述（已按 MCP 的 JSON Schema 形状转换） */
export interface RemoteToolInfo {
  name: string
  description: string
  /** MCP 规范要求的 JSON Schema（渲染层从 ToolDefinition.parameters 转换而来） */
  inputSchema: Record<string, unknown>
  /** 审批类型：none 之外的一律不对外暴露可调用 */
  approvalType?: string
}

/** 渲染层返回的工具执行结果 */
export interface RemoteToolResult {
  success: boolean
  result: string
  error?: string
}

/** 清单请求/应答载荷 */
interface ToolRequestBody {
  requestId: string
  action: 'list' | 'call'
  toolName?: string
  args?: Record<string, unknown>
  /** 当前工作区路径（渲染层构造 ToolExecutionContext 用） */
  workspacePath: string | null
  /** 是否已授权写操作类工具（渲染层的第二道门禁） */
  allowDangerous?: boolean
}

/**
 * 解析当前工作区路径。
 *
 * 优先级与 floating-avatar 的 `getWorkspacePath` 一致：窗口绑定 > 最近会话 >
 * 最近路径。渲染层各处 store 的同步时机不一致，从主进程取能保证
 * 「外部请求用的工作区」与「窗口里看到的工作区」是同一个。
 */
function resolveWorkspacePath(): string | null {
  try {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      const roots = getWindowWorkspace(win.id)
      if (roots && roots.length > 0) return roots[0]
    }
    const session = getConfigStore().get('lastWorkspaceSession') as { roots?: string[] } | undefined
    if (session?.roots && session.roots.length > 0) return session.roots[0]
    return (getConfigStore().get('lastWorkspacePath') as string | null) ?? null
  } catch (err) {
    logger.system.warn('[OpenApi] resolve workspace path failed:', err)
    return null
  }
}

/** 向渲染层发一次请求并等待应答（workspacePath 由这里统一补齐） */
function invokeRenderer<T>(
  body: Omit<ToolRequestBody, 'requestId' | 'workspacePath'>,
  timeoutMs: number,
): Promise<T | null> {
  return new Promise((resolve) => {
    const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const replyChannel = `${OPEN_API_TOOL_REPLY_PREFIX}${requestId}`

    const cleanup = (): void => {
      clearTimeout(timer)
      ipcMain.removeListener(replyChannel, onReply)
    }

    const onReply = (_event: unknown, payload: T): void => {
      cleanup()
      resolve(payload)
    }

    const timer = setTimeout(() => {
      cleanup()
      logger.system.warn(`[OpenApi] renderer tool bridge timeout (${body.action})`)
      resolve(null)
    }, timeoutMs)

    ipcMain.once(replyChannel, onReply)

    const win = getMainWindow()
    if (!win || win.isDestroyed()) {
      cleanup()
      logger.system.warn('[OpenApi] renderer tool bridge: no main window')
      resolve(null)
      return
    }

    win.webContents.send(OPEN_API_TOOL_REQUEST_CHANNEL, {
      requestId,
      workspacePath: resolveWorkspacePath(),
      ...body,
    })
  })
}

/**
 * 拉取渲染层的工具清单。
 *
 * @returns 工具数组；渲染层不可达时返回 `null`（与「工具为空数组」区分开 ——
 *          前者应该给客户端报错，后者是合法的「没配工具」）
 */
export async function listToolsFromRenderer(timeoutMs = LIST_TIMEOUT_MS): Promise<RemoteToolInfo[] | null> {
  const res = await invokeRenderer<{ tools?: RemoteToolInfo[] }>({ action: 'list' }, timeoutMs)
  if (!res || !Array.isArray(res.tools)) return null
  return res.tools
}

/**
 * 在渲染层执行一次工具调用。
 *
 * @param allowDangerous 是否已授权写操作类工具（透传给渲染层做第二道门禁）
 */
export async function callToolInRenderer(
  toolName: string,
  args: Record<string, unknown>,
  allowDangerous = false,
  timeoutMs = CALL_TIMEOUT_MS,
): Promise<RemoteToolResult | null> {
  const res = await invokeRenderer<RemoteToolResult>(
    { action: 'call', toolName, args, allowDangerous },
    timeoutMs,
  )
  if (!res || typeof res.success !== 'boolean') return null
  return res
}
