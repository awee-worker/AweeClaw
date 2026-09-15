/**
 * 对外 API 网关契约（P0-5）
 *
 * 定位：把 AweeClaw 作为**服务端**暴露给第三方客户端（Cherry Studio / ChatBox 等），
 * 让它们零改造接管本地智能体。这是平台化的关键一步 —— 在此之前 AweeClaw 只能
 * 「连出去」（MCP / A2A 出站），不能「被连进来」。
 *
 * 一个 server，多个协议前缀（避免多端口管理复杂度）：
 *   /v1/*                   OpenAI 兼容（models / agents / chat/completions）
 *   /mcp                    MCP Streamable HTTP
 *   /a2a/*                  委托给 A2aServer.handle()（P0-4 已实现）
 *   /.well-known/agent.json 同上（A2A 规范要求挂在根级）
 *   /openapi/*              本网关自有端点（状态/健康）
 *
 * 本文件只描述「配置存什么」与「IPC 返回什么」，不含实现，
 * 供主进程与渲染进程共用，因此**不得**引入 electron / node 专属类型。
 *
 * @module shared/protocols/openApiProtocol
 */

// ============================================
// 一、配置层
// ============================================

/**
 * 网关配置。
 *
 * ⚠️ `apiKey` 是**唯一的准入凭证**：一旦监听非环回地址，没有它等于把本机
 * 模型额度开放给整个局域网。因此 `allowExternal` 与 `apiKey` 在 Store 层
 * 是**联动校验**的（见 OpenApiStore.mergeConfig）。
 */
export interface OpenApiConfig {
  /** 总开关：默认 false（不静默开放端口） */
  enabled: boolean
  /** 监听地址。默认 127.0.0.1；仅当 allowExternal 为 true 时才允许非环回地址 */
  host: string
  port: number
  /** 准入密钥（safeStorage 加密落盘，读取时解密返回） */
  apiKey: string
  /** 是否允许监听非环回地址（对外暴露，需用户显式开启） */
  allowExternal: boolean
  /**
   * CORS 允许来源白名单。
   *
   * 空数组 = 仅放行 localhost / 127.0.0.1（浏览器同源策略下第三方 Web 客户端
   * 从别的域名访问才会用到这个白名单；桌面客户端不受 CORS 限制）。
   */
  corsOrigins: string[]
  /**
   * 是否允许外部通过 `/mcp` 调用「非只读」工具。
   *
   * 默认 false：外部客户端能**看到**全部工具清单，但只能调用 `approvalType === 'none'`
   * 的工具（查询类）。写文件 / 执行命令这类需要本机用户确认的工具一律拒绝 ——
   * 否则等于绕过了 AweeClaw 的审批门禁。
   */
  allowDangerousToolCall: boolean
}

// ============================================
// 二、端点描述（供设置页「端点速查」渲染）
// ============================================

export interface OpenApiEndpointInfo {
  method: 'GET' | 'POST'
  path: string
  /** 中文说明 */
  description: string
  /** 所属协议组，用于设置页分组 */
  group: 'openai' | 'mcp' | 'a2a' | 'system'
}

/**
 * 网关暴露的端点清单。
 *
 * 放在契约层而不是设置页里的原因：设置页展示的端点必须与 `OpenApiServer`
 * 实际注册的路由一致，写两遍迟早会出现「文档里有、代码里没有」的偏差。
 */
export const OPEN_API_ENDPOINTS: readonly OpenApiEndpointInfo[] = [
  { method: 'GET', path: '/v1/models', description: '当前可用模型列表（OpenAI 格式）', group: 'openai' },
  { method: 'GET', path: '/v1/agents', description: '已配置的智能体 / 角色列表', group: 'openai' },
  { method: 'POST', path: '/v1/chat/completions', description: '对话补全（支持 SSE 流式）', group: 'openai' },
  { method: 'POST', path: '/mcp', description: 'MCP Streamable HTTP（initialize / tools）', group: 'mcp' },
  { method: 'POST', path: '/a2a', description: 'A2A JSON-RPC（message/send 等）', group: 'a2a' },
  { method: 'GET', path: '/a2a/health', description: 'A2A 存活探针', group: 'a2a' },
  { method: 'GET', path: '/.well-known/agent.json', description: 'A2A Agent Card（不鉴权）', group: 'a2a' },
  { method: 'GET', path: '/openapi/status', description: '网关运行状态（不鉴权，仅本机可读）', group: 'system' },
] as const

// ============================================
// 三、运行状态（IPC 返回给设置页）
// ============================================

/** 最近一次外部请求记录（排障用） */
export interface OpenApiRequestRecord {
  id: string
  method: string
  path: string
  status: number
  durationMs: number
  at: number
  error?: string
}

/** 网关运行态 */
export interface OpenApiStatus {
  enabled: boolean
  running: boolean
  host: string
  port: number
  /** 对外基址（如 http://127.0.0.1:8790），供设置页拼请求示例 */
  baseUrl: string
  /** 是否要求 apiKey */
  apiKeyRequired: boolean
  /** CORS 实际生效的来源列表 */
  corsOrigins: string[]
  /** A2A 入站是否挂在本网关上（true = 共用端口） */
  a2aMounted: boolean
  /** A2A 是否已按配置启用（用于解释「为什么 /a2a 返回 404」） */
  a2aEnabled: boolean
  requests: number
  errors: number
  lastRequestAt: number | null
  recent: OpenApiRequestRecord[]
}

/** IPC 统一包装（与其它模块保持一致的形状） */
export interface OpenApiIpcResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

/** getConfig / updateConfig 的返回体 */
export interface OpenApiConfigPayload {
  config: OpenApiConfig
  /** 缺失项提示（不阻断保存，仅用于 UI 引导） */
  issues: string[]
}

/** `openapi:changed` 事件载荷 */
export interface OpenApiChangePayload {
  status: OpenApiStatus
}

/** 主进程 → 渲染层的工具请求载荷 */
export interface OpenApiToolRequestPayload {
  requestId: string
  action: 'list' | 'call'
  /** action='call' 时的工具名 */
  toolName?: string
  /** action='call' 时的调用参数 */
  args?: Record<string, unknown>
  /**
   * 当前工作区路径。
   *
   * 由主进程下发而不是渲染层自己查：主进程持有「窗口 ↔ 工作区」的实际绑定
   * （`getWindowWorkspace`），渲染层各处 store 的同步时机不一致，
   * 从这里取值能保证「外部请求用的工作区」与「窗口里看到的工作区」是同一个。
   */
  workspacePath?: string | null
  /**
   * 是否已授权执行写操作类工具（来自 `OpenApiConfig.allowDangerousToolCall`）。
   *
   * 渲染层据此做**第二道**门禁：主进程已按 approvalType 拦过一次，
   * 这里再判一次是因为「闸门只设一道」在安全设计上等于没设 ——
   * 将来若有新的调用入口忘了判，渲染层仍会拒绝。
   */
  allowDangerous?: boolean
}

// ============================================
// 四、OpenAI 兼容端点的线格式
// ============================================

/** GET /v1/models 的单项 */
export interface OpenAiModelObject {
  id: string
  object: 'model'
  created: number
  owned_by: string
}

/** GET /v1/models 的响应 */
export interface OpenAiModelList {
  object: 'list'
  data: OpenAiModelObject[]
}

/** GET /v1/agents 的单项 */
export interface OpenAiAgentObject {
  id: string
  name: string
  description: string
  model: string
}

/** GET /v1/agents 的响应 */
export interface OpenAiAgentList {
  object: 'list'
  data: OpenAiAgentObject[]
}

/** POST /v1/chat/completions 的请求体（只声明我们会读取的字段） */
export interface OpenAiChatRequest {
  model?: string
  messages?: Array<{ role?: string; content?: unknown; name?: string }>
  stream?: boolean
  temperature?: number
  top_p?: number
  max_tokens?: number
  stop?: string | string[]
  /** 非标：直接指定系统提示词（部分客户端会发） */
  system?: string
}

/** 流式 chunk 的 choices[0] */
export interface OpenAiChatChunkChoice {
  index: number
  delta: { role?: string; content?: string }
  finish_reason: string | null
}

/** 非流式响应里的 choices[0] */
export interface OpenAiChatChoice {
  index: number
  message: { role: 'assistant'; content: string }
  finish_reason: string
}

/** 用量统计（缺失时如实置 0，不伪造） */
export interface OpenAiUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

// ============================================
// 五、常量
// ============================================

/** 网关默认端口（与 A2A 默认端口一致，便于启用后直接共用） */
export const DEFAULT_OPEN_API_PORT = 8790

/** 网关默认监听地址：只允许本机 */
export const DEFAULT_OPEN_API_HOST = '127.0.0.1'

/** 环回地址白名单（非白名单地址必须显式 allowExternal） */
export const OPEN_API_LOOPBACK_HOSTS: readonly string[] = ['127.0.0.1', 'localhost', '::1', '[::1]']

/** 默认 CORS 白名单（空 = 仅本机来源） */
export const DEFAULT_CORS_ORIGINS: readonly string[] = []

/** `model` 字段的 Agent 路由前缀：`agent:<agentId>` */
export const OPEN_API_AGENT_MODEL_PREFIX = 'agent:'

/** 网关事件推送通道 */
export const OPEN_API_CHANGED_CHANNEL = 'openapi:changed'

/**
 * 主进程 → 渲染层：请求工具清单 / 执行工具。
 *
 * 放在共享契约里而不是主进程模块里：preload 需要引用它做转发，
 * 而 preload 反向依赖 main/modules/* 会让构建边界变脏。
 */
export const OPEN_API_TOOL_REQUEST_CHANNEL = 'openapi:tools:request'

/** 渲染层 → 主进程：工具请求应答前缀（后接 requestId） */
export const OPEN_API_TOOL_REPLY_PREFIX = 'openapi:tools:reply:'

/** 最近请求记录上限 */
export const OPEN_API_RECENT_LIMIT = 30
