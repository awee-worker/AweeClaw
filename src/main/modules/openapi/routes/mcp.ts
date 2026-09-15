/**
 * `POST /mcp` — MCP Streamable HTTP transport
 *
 * 让 AweeClaw 作为 **MCP server** 被外部 MCP 客户端（Claude Desktop、Cursor、
 * Cherry Studio 等）接入，从而把本机工具集对外开放。
 *
 * 实现要点：
 *   - 无状态：不签发 `Mcp-Session-Id`。规范允许，且省掉「会话过期怎么清理」
 *     一整类问题；我们的工具执行本身就不依赖跨请求状态。
 *   - POST 返回值按 Accept 协商：客户端接受 JSON 就返回 JSON（最简单、最兼容），
 *     只接受 event-stream 时才用 SSE 包一条 —— 规范两者都允许。
 *   - 通知（无 `id`）按规范回 **202 + 空 body**，不能返回 JSON-RPC 响应，
 *     否则客户端会把它当成对一个不存在请求的应答。
 *
 * 安全模型（与 `allowDangerousToolCall` 联动）：
 *   工具清单**始终完整可见**（用户需要知道有哪些能力），但 `tools/call`
 *   默认只执行 `approvalType === 'none'` 的只读工具。写文件 / 执行命令这类
 *   工具一律拒绝 —— 外部请求无法弹出本机审批弹窗，放行等于绕过审批门禁。
 *   真正放行由用户在设置页显式打开开关，并在渲染层以 `skipMainApproval` 执行。
 *
 * @module openapi/routes/mcp
 */

import type * as http from 'http'
import { logger } from '@shared/toolkit/LogEngine'
import { callToolInRenderer, listToolsFromRenderer } from '../OpenApiToolBridge'
import type { RemoteToolInfo, RemoteToolResult } from '../OpenApiToolBridge'
import type { RouteContext } from './routeTypes'

/** 我们支持的 MCP 协议版本（新的在前） */
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']

/** 默认回给客户端的协议版本 */
const DEFAULT_PROTOCOL_VERSION = '2025-03-26'

/** 服务标识 */
const SERVER_INFO = { name: 'aweeclaw', title: 'AweeClaw', version: '1.0.0' }

/** 渲染层不可达时的统一提示（多处复用，避免文案漂移） */
const RENDERER_UNREACHABLE = '无法从 AweeClaw 主窗口读取工具清单：请确认应用窗口处于打开状态'

/** JSON-RPC 错误码 */
const RPC = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
} as const

/**
 * 「无需审批即可执行」的审批类型。
 *
 * 渲染层的 `getApprovalType` 会对未知工具返回 `dangerous`（保守兜底），
 * 因此这里只需白名单 `none`，其余一律不放行。
 */
const SAFE_APPROVAL_TYPES = new Set(['none'])

interface RpcRequest {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
}

// ============================================
// 入口
// ============================================

export async function handleMcp(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: RouteContext,
): Promise<void> {
  // Streamable HTTP 规范里 GET 用于打开服务端主动推送的 SSE 流；我们无主动推送
  if (req.method === 'GET') {
    ctx.respondJson(res, 405, {
      jsonrpc: '2.0',
      id: null,
      error: { code: RPC.INVALID_REQUEST, message: '本服务不支持 GET /mcp（无服务端主动推送）' },
    })
    return
  }

  const raw = await ctx.readJsonBodyRaw(req)
  if (raw === null) {
    respond(res, ctx, 400, rpcError(null, RPC.PARSE, '请求体不是合法 JSON 或超出大小限制'))
    return
  }

  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    respond(res, ctx, 200, rpcError(null, RPC.PARSE, 'Parse error：请求体不是合法 JSON'))
    return
  }

  // 批量请求（规范允许数组）
  if (Array.isArray(payload)) {
    const responses: unknown[] = []
    for (const item of payload) {
      const r = await handleSingle(item as RpcRequest, ctx)
      if (r !== null) responses.push(r)
    }
    // 全是通知 → 规范要求 202 且无 body
    if (responses.length === 0) {
      res.writeHead(202)
      res.end()
      return
    }
    respond(res, ctx, 200, responses)
    return
  }

  const single = await handleSingle(payload as RpcRequest, ctx)
  if (single === null) {
    // 通知：规范要求 202 + 空 body
    res.writeHead(202)
    res.end()
    return
  }
  respond(res, ctx, 200, single)
}

// ============================================
// 单条消息
// ============================================

/**
 * 处理一条 JSON-RPC 消息。
 *
 * @returns 响应对象；`null` 表示这是通知（不需要响应）
 */
async function handleSingle(msg: RpcRequest, ctx: RouteContext): Promise<unknown | null> {
  if (!msg || typeof msg !== 'object' || typeof msg.method !== 'string') {
    return rpcError(msg?.id ?? null, RPC.INVALID_REQUEST, 'Invalid Request：缺少 method')
  }

  const method = msg.method

  // 通知（无 id）：处理副作用后不响应
  if (msg.id === undefined || msg.id === null) {
    if (method.startsWith('notifications/')) {
      logger.system.info(`[OpenApi] MCP notification: ${method}`)
      return null
    }
    // 规范里非通知方法必须带 id，缺了按无效请求处理
    return rpcError(null, RPC.INVALID_REQUEST, `Invalid Request：方法 ${method} 需要 id`)
  }

  // 走到这里 id 必非 null（上面的通知分支已提前返回）；
  // 显式收窄类型，免得每个 rpcResult/rpcError 调用点都断言一次
  const id: string | number = msg.id

  switch (method) {
    case 'initialize':
      return rpcResult(id, buildInitializeResult(msg.params))
    case 'ping':
      return rpcResult(id, {})
    case 'tools/list': {
      // 渲染层不可达 ≠ 没有工具。返回空列表会让客户端以为「服务正常但没工具」，
      // 报内部错误才能让用户意识到「AweeClaw 主窗口可能没开」
      const tools = await listToolsFromRenderer()
      if (tools === null) return rpcError(id, RPC.INTERNAL, RENDERER_UNREACHABLE)
      return rpcResult(id, { tools: tools.map(toMcpTool) })
    }
    case 'tools/call':
      return await buildToolsCall(id, msg.params, ctx)
    case 'prompts/list':
      return rpcResult(id, { prompts: [] })
    case 'resources/list':
      return rpcResult(id, { resources: [] })
    case 'resources/templates/list':
      return rpcResult(id, { resourceTemplates: [] })
    default:
      return rpcError(id, RPC.METHOD_NOT_FOUND, `不支持的方法：${method}`)
  }
}

/** `initialize` 响应 */
function buildInitializeResult(params: Record<string, unknown> | undefined): Record<string, unknown> {
  const requested = typeof params?.protocolVersion === 'string' ? params.protocolVersion : ''
  // 客户端版本我们支持就回显（保持双方一致），否则回我们默认的
  const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : DEFAULT_PROTOCOL_VERSION

  return {
    protocolVersion,
    capabilities: {
      // listChanged: false —— 工具清单不随会话变化，客户端无需重新拉取
      tools: { listChanged: false },
    },
    serverInfo: SERVER_INFO,
    instructions:
      '这是 AweeClaw 本机工具集。默认仅允许调用只读工具（approvalType=none），' +
      '写文件与执行命令类工具需在 AweeClaw「设置 → 对外 API」中显式放行。',
  }
}

/** 内部工具描述 → MCP 工具描述（主要差别是 `parameters` → `inputSchema`） */
function toMcpTool(tool: RemoteToolInfo): Record<string, unknown> {
  return {
    name: tool.name,
    description: tool.description || '',
    inputSchema: tool.inputSchema || { type: 'object', properties: {} },
  }
}

/** `tools/call` 响应 */
async function buildToolsCall(
  id: string | number,
  params: Record<string, unknown> | undefined,
  ctx: RouteContext,
): Promise<unknown> {
  const toolName = typeof params?.name === 'string' ? params.name.trim() : ''
  if (!toolName) return rpcError(id, RPC.INVALID_PARAMS, '缺少 params.name')

  const args =
    params?.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments)
      ? (params.arguments as Record<string, unknown>)
      : {}

  // 先查清单：既拿到 approvalType 做门禁，也能把「未知工具」和「工具被策略拦下」
  // 区分开 —— 前者是客户端 bug，后者是配置问题，排障方向完全不同
  let tools: RemoteToolInfo[] | null
  try {
    tools = await listToolsFromRenderer()
  } catch (err) {
    ctx.reportError(err, 'POST /mcp tools/call (list)')
    return rpcError(id, RPC.INTERNAL, '读取工具清单失败')
  }
  if (tools === null) {
    return rpcError(id, RPC.INTERNAL, RENDERER_UNREACHABLE)
  }

  const target = tools.find((t) => t.name === toolName)
  if (!target) {
    // 按 MCP 规范，工具级错误应放在 result.content + isError，而不是 JSON-RPC error
    return rpcResult(id, toolErrorContent(`未知工具：${toolName}`))
  }

  const approvalType = (target.approvalType || 'dangerous') as string
  if (!SAFE_APPROVAL_TYPES.has(approvalType) && !ctx.config.allowDangerousToolCall) {
    return rpcResult(
      id,
      toolErrorContent(
        `工具「${toolName}」需要本机确认或涉及本机改动（类型：${approvalType}），已拒绝外部调用。` +
          '如确需放行，请在 AweeClaw「设置 → 对外 API」中开启「允许外部执行写操作类工具」。',
      ),
    )
  }

  let result: RemoteToolResult | null
  try {
    result = await callToolInRenderer(toolName, args, ctx.config.allowDangerousToolCall)
  } catch (err) {
    ctx.reportError(err, `POST /mcp tools/call (${toolName})`)
    return rpcResult(id, toolErrorContent(`执行失败：${err instanceof Error ? err.message : String(err)}`))
  }

  if (result === null) {
    return rpcResult(id, toolErrorContent('执行超时或无响应：请确认 AweeClaw 主窗口处于打开状态'))
  }

  logger.system.info(
    `[OpenApi] MCP tools/call ${toolName} → ${result.success ? 'ok' : 'error'}`,
  )
  return rpcResult(id, {
    content: [{ type: 'text', text: result.success ? result.result : result.error || '执行失败' }],
    isError: !result.success,
  })
}

/** 工具级错误（按 MCP 规范放在 content 里，不占用 JSON-RPC error 通道） */
function toolErrorContent(message: string): Record<string, unknown> {
  return { content: [{ type: 'text', text: message }], isError: true }
}

// ============================================
// 响应工具
// ============================================

function rpcResult(id: string | number, result: unknown): Record<string, unknown> {
  return { jsonrpc: '2.0', id, result }
}

function rpcError(id: string | number | null, code: number, message: string): Record<string, unknown> {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

/**
 * 发送响应，按 Accept 协商 JSON / SSE。
 *
 * 默认走 JSON：绝大多数 MCP 客户端两者都接受，JSON 少一层解析。
 * 只在客户端**明确只要** event-stream 时才包 SSE（否则客户端会解析失败）。
 */
function respond(
  res: http.ServerResponse,
  ctx: RouteContext,
  status: number,
  body: unknown,
): void {
  const accept = String(res.req?.headers.accept || '')
  const wantsSse = accept.includes('text/event-stream') && !accept.includes('application/json')

  if (!wantsSse) {
    ctx.respondJson(res, status, body)
    return
  }

  res.writeHead(status, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
  })
  res.socket?.setNoDelay(true)
  res.end(`event: message\ndata: ${JSON.stringify(body)}\n\n`)
}
