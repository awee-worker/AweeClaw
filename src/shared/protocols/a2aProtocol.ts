/**
 * A2A（Agent2Agent）协议与配置契约
 *
 * 定位：补齐「四大自定义工具接口」的最后一块（MCP ✅ / Skills ✅ / HTTP ✅ / **A2A**）。
 * A2A 与 MCP 是**两个层级**的协议，不要混淆：
 *   - MCP  → **工具级**互操作（把远端能力当一个个函数调）
 *   - A2A  → **智能体级**互操作（把一个远端 agent 当「会自己干活的同事」）
 *
 * 本文件只描述「线上长什么样」与「配置存什么」，不含任何实现：
 *   - 协议层类型：Agent Card / Message / Task / Artifact / JSON-RPC 封装
 *   - 配置层类型：A2aConfig / A2aServerEntry（落盘结构）
 *   - 视图层类型：A2aServerState / A2aStatus（IPC 返回给设置页的运行态）
 *
 * 本文件被主进程与渲染进程共用，因此**不得**引入 electron / node 专属类型。
 *
 * @module shared/protocols/a2aProtocol
 */

// ============================================
// 一、协议层：Agent Card
// ============================================

/** Agent 提供方信息（Card.provider） */
export interface A2aAgentProvider {
  organization: string
  url?: string
}

/** Agent 能力声明（决定客户端能用哪些方法） */
export interface A2aAgentCapabilities {
  /** 是否支持 message/stream（SSE） */
  streaming?: boolean
  /** 是否支持推送通知配置 */
  pushNotifications?: boolean
  /** 是否保留状态迁移历史 */
  stateTransitionHistory?: boolean
}

/** Agent 技能声明（Card.skills[]） */
export interface A2aAgentSkill {
  id: string
  name: string
  description?: string
  tags?: string[]
  examples?: string[]
  inputModes?: string[]
  outputModes?: string[]
}

/**
 * Agent Card —— `GET /.well-known/agent.json`
 *
 * 全部字段均可选：现实中的 A2A 实现版本差异很大，
 * 客户端必须能在「只有 name + url」的最小卡片下工作。
 */
export interface A2aAgentCard {
  name: string
  description?: string
  /** 该 agent 的 JSON-RPC 端点（缺省时回退到发现地址本身） */
  url?: string
  version?: string
  protocolVersion?: string
  provider?: A2aAgentProvider
  capabilities?: A2aAgentCapabilities
  defaultInputModes?: string[]
  defaultOutputModes?: string[]
  skills?: A2aAgentSkill[]
  preferredTransport?: string
}

// ============================================
// 二、协议层：Message / Task / Artifact
// ============================================

/** 文本内容块 */
export interface A2aTextPart {
  kind: 'text'
  text: string
}

/** 文件内容块（只保底识别，不做下载） */
export interface A2aFilePart {
  kind: 'file'
  file: {
    name?: string
    mimeType?: string
    bytes?: string
    uri?: string
  }
}

/** 结构化数据块 */
export interface A2aDataPart {
  kind: 'data'
  data: Record<string, unknown>
}

export type A2aPart = A2aTextPart | A2aFilePart | A2aDataPart

export type A2aRole = 'user' | 'agent'

/** A2A 消息 */
export interface A2aMessage {
  kind: 'message'
  messageId: string
  role: A2aRole
  parts: A2aPart[]
  taskId?: string
  contextId?: string
  metadata?: Record<string, unknown>
}

/** 任务状态机（对齐 A2A 规范 TaskState） */
export type A2aTaskState =
  | 'submitted'
  | 'working'
  | 'input-required'
  | 'completed'
  | 'canceled'
  | 'failed'
  | 'rejected'
  | 'auth-required'
  | 'unknown'

/** 终态集合：到达后不再轮询 */
export const A2A_TERMINAL_STATES: readonly A2aTaskState[] = [
  'completed',
  'canceled',
  'failed',
  'rejected',
] as const

export interface A2aTaskStatus {
  state: A2aTaskState
  message?: A2aMessage
  timestamp?: string
}

/** Agent 产出物 */
export interface A2aArtifact {
  artifactId: string
  name?: string
  description?: string
  parts: A2aPart[]
  metadata?: Record<string, unknown>
}

/** 任务 */
export interface A2aTask {
  kind: 'task'
  id: string
  contextId?: string
  status: A2aTaskStatus
  artifacts?: A2aArtifact[]
  history?: A2aMessage[]
  metadata?: Record<string, unknown>
}

/** `message/send` 的返回值：同步场景直接给 Message，异步场景给 Task */
export type A2aResult = A2aTask | A2aMessage

// ============================================
// 三、协议层：JSON-RPC 2.0 封装
// ============================================

export interface A2aJsonRpcError {
  code: number
  message: string
  data?: unknown
}

export interface A2aJsonRpcResponse<T = unknown> {
  jsonrpc?: string
  id?: string | number | null
  result?: T
  error?: A2aJsonRpcError
}

/**
 * 方法名常量。
 *
 * `TASKS_SEND` 是 A2A 早期草案的方法名，保留作为**兼容回退**：
 * 部分老实现（含 python-a2a 早期版本）只认它。
 */
export const A2A_METHODS = {
  SEND: 'message/send',
  STREAM: 'message/stream',
  TASKS_SEND: 'tasks/send',
  GET: 'tasks/get',
  CANCEL: 'tasks/cancel',
} as const

/** 标准 JSON-RPC 错误码（用于入站响应） */
export const A2A_RPC_ERRORS = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
} as const

// ============================================
// 四、配置层：落盘结构
// ============================================

/**
 * 单个外部 A2A 智能体的配置项。
 *
 * 以 **URL 为键**存在 `A2aConfig.servers` 里（与源项目 `settings["a2aServers"]` 同构）。
 */
export interface A2aServerEntry {
  /** 是否参与工具暴露（关闭后模型看不到它） */
  enabled: boolean
  /** 给模型看的用途描述（会拼进工具 description） */
  description: string
  /** 技能标签（仅用于工具体描述与 UI 展示） */
  skills: string[]
  /** Bearer token（safeStorage 加密落盘，读取时解密返回） */
  token?: string
  /** 额外请求头（如 X-API-Key） */
  headers?: Record<string, string>
  /** 添加时间（ms） */
  addedAt?: number
}

/** Agent Card 缓存（成功探测后写入，避免每次进设置页都请求） */
export interface A2aCardCache {
  card: A2aAgentCard
  fetchedAt: number
}

/** 入站（把 AweeClaw 暴露为 A2A server）配置 */
export interface A2aInboundConfig {
  enabled: boolean
  /** 监听地址。默认 127.0.0.1；仅当 allowExternal 为 true 时才允许非环回地址 */
  host: string
  port: number
  /** Bearer token：为空表示不校验（仅限本机监听） */
  token: string
  /** 是否允许监听非环回地址（对外暴露，需用户显式开启） */
  allowExternal: boolean
  /** 对外声明的 agent 名称 */
  agentName: string
  /** 对外声明的 agent 描述 */
  agentDescription: string
}

/** A2A 模块总配置 */
export interface A2aConfig {
  /** 出站总开关：默认 false（不静默向外部服务发消息） */
  enabled: boolean
  /** 外部 agent 列表，key = 规范化后的 agent URL */
  servers: Record<string, A2aServerEntry>
  inbound: A2aInboundConfig
}

// ============================================
// 五、视图层：IPC 返回结构
// ============================================

/** 单个 agent 的运行时状态（配置 + 探测结果） */
export interface A2aServerState {
  url: string
  enabled: boolean
  description: string
  skills: string[]
  /** 是否配置了 token */
  hasToken: boolean
  addedAt: number | null
  /** 最近一次探测结果；null = 尚未探测 */
  reachable: boolean | null
  /** 最近一次探测耗时（ms） */
  latencyMs: number | null
  lastCheckedAt: number | null
  /** 探测失败原因（已翻译为中文） */
  lastError: string | null
  /** Agent Card（来自缓存） */
  card: A2aAgentCard | null
}

/** 最近一次调用的记录（排障用） */
export interface A2aCallRecord {
  id: string
  url: string
  /** 查询摘要（截断，避免把长 prompt 全塞进状态面板） */
  query: string
  ok: boolean
  durationMs: number
  at: number
  error?: string
}

/** 入站服务运行态 */
export interface A2aInboundStatus {
  enabled: boolean
  running: boolean
  host: string
  port: number
  /** 对外可访问的 JSON-RPC 端点 */
  url: string
  /** Agent Card 地址 */
  cardUrl: string
  tokenRequired: boolean
  requests: number
  errors: number
  lastRequestAt: number | null
}

/** 模块整体运行态 */
export interface A2aStatus {
  enabled: boolean
  /** 已配置总数 */
  totalCount: number
  /** 已启用（会进工具描述）总数 */
  enabledCount: number
  servers: A2aServerState[]
  inbound: A2aInboundStatus
  recent: A2aCallRecord[]
}

/** IPC 统一包装（与其它模块保持一致的形状） */
export interface A2aIpcResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

/** getConfig / updateConfig / upsertServer 的返回体 */
export interface A2aConfigPayload {
  config: A2aConfig
  /** 缺失项提示（不阻断保存，仅用于 UI 引导） */
  issues: string[]
}

/** 单次调用结果（可直接展示在设置页） */
export interface A2aCallResult {
  ok: boolean
  text: string
  error?: string
  durationMs: number
}

/** 工具暴露载荷（渲染层工具提供者据此生成 a2a_tool_call 定义） */
export interface A2aToolPayload {
  enabled: boolean
  agents: Array<{ url: string; description: string; skills: string[] }>
}

/** `a2a:changed` 事件载荷（配置或探测结果变化时推送） */
export interface A2aChangePayload {
  status: A2aStatus
  tool: A2aToolPayload
}

/** 出站工具名（模型可见） */
export const A2A_TOOL_NAME = 'a2a_tool_call'

/**
 * 工具描述里最多列出的 agent 数量。
 *
 * 超过后截断并在末尾提示「还有 N 个未列出」—— 工具描述会占用每一次请求的
 * 输入 token，agent 数量无上限地拼进去等于给每一轮对话加税。
 */
export const A2A_TOOL_DESCRIPTION_LIMIT = 10
