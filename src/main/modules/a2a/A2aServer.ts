/**
 * A2A 入站服务（把 AweeClaw 暴露为一个 A2A agent）
 *
 * 端点：
 *   GET  /.well-known/agent.json         Agent Card（新规范也提供 agent-card.json）
 *   POST /                                JSON-RPC 2.0（message/send · tasks/get · tasks/cancel）
 *   POST /a2a                            同上（路径别名，便于把服务挂在子路径）
 *   GET  /a2a/health                     存活探针（非规范，仅本机排障用）
 *
 * 安全约定（默认值即最安全）：
 *   1. **默认关闭**，且默认只监听 `127.0.0.1`；
 *   2. 监听非环回地址需 `allowExternal` 显式开启（由 A2aManager 在执行前降级校验）；
 *   3. 配置了 token 时，**JSON-RPC 一律要求** `Authorization: Bearer <token>`；
 *      Card 保持开放 —— 否则标准客户端连「这个 agent 会什么」都发现不了。
 *
 * 与 P0-5 的关系：本类的 `handle()` 是不依赖自身 http.Server 的纯路由函数，
 * 后续可直接挂到统一 HTTP server 的 `/a2a` 前缀下，避免多开端口。
 * 目前 P0-5 尚未落地，故先自带一个最小 http.Server（`start/stop`）。
 *
 * @module a2a/A2aServer
 */

import * as crypto from 'crypto'
import * as http from 'http'
import type { Duplex } from 'stream'
import { logger } from '@shared/toolkit/LogEngine'
import {
  A2A_METHODS,
  A2A_RPC_ERRORS,
} from '@shared/protocols/a2aProtocol'
import type {
  A2aAgentCard,
  A2aMessage,
  A2aPart,
  A2aTask,
  A2aTaskState,
} from '@shared/protocols/a2aProtocol'

// ============================================
// 常量
// ============================================

const MAX_BODY_BYTES = 1024 * 1024 // 1MB：A2A 请求可能带长上下文
const BODY_TIMEOUT_MS = 30_000

/** 端口占用时的重试次数（与 Overlay 的策略一致） */
const PORT_PROBE_ATTEMPTS = 10

/** 任务保留上限与 TTL */
const TASK_LIMIT = 200
const TASK_TTL_MS = 30 * 60 * 1000

/** 单个 contextId 保留的历史消息条数（超出丢弃最旧） */
const CONTEXT_HISTORY_LIMIT = 20

/** 我们的协议实现版本（写在 Card 里，便于对端判断能力） */
const A2A_PROTOCOL_VERSION = '0.2.5'

// ============================================
// 类型
// ============================================

/** 入站对话的上下文（交回上层，由上层决定怎么拼 prompt） */
export interface A2aChatContext {
  taskId: string
  contextId: string
  /** 同一 contextId 的历史消息（含本轮），已按时间升序 */
  history: A2aMessage[]
  /** 调用方标识（取 Authorization 头或 UA，仅用于日志与审计） */
  caller: string
}

export interface A2aServerDeps {
  /** 读取卡片元信息（name / description / version）；url 由服务自己填 */
  getCardMeta: () => { name: string; description: string; version: string }
  /** 处理一次对话，返回纯文本回复 */
  handleChat: (text: string, ctx: A2aChatContext) => Promise<string>
  /** 读取当前要求的访问 token（空字符串 = 不校验） */
  getAuthToken: () => string
  /** 对外声明的技能清单（id/name/description） */
  getSkills: () => Array<{ id: string; name: string; description: string; tags?: string[] }>
  /** 请求计数回调（状态面板用） */
  onRequest?: (info: { method: string; ok: boolean; durationMs: number }) => void
}

interface TaskRecord {
  task: A2aTask
  createdAt: number
  abort: (() => void) | null
}

// ============================================
// 服务
// ============================================

export class A2aServer {
  private server: http.Server | null = null
  private host = '127.0.0.1'
  private port = 0

  /**
   * 对外公开地址（P0-5 托管模式）。
   *
   * 当本模块被统一网关（OpenApiServer）挂到 `/a2a` 前缀下时，请求实际由网关的
   * http.Server 接收 —— 此时 `this.host/this.port` 是 0（自己没监听），
   * Agent Card 里若回 `http://127.0.0.1:0` 会让对端连不上。
   * 因此由网关注入真实地址与 basePath，Card 与状态面板都以此为准。
   */
  private publicEndpoint: { host: string; port: number; basePath: string } | null = null

  /** 任务表（内存；进程退出即失效，符合「无持久化任务队列」的定位） */
  private readonly tasks = new Map<string, TaskRecord>()

  /** contextId → 历史消息（多轮对话） */
  private readonly contexts = new Map<string, A2aMessage[]>()

  private requests = 0
  private errors = 0
  private lastRequestAt: number | null = null

  constructor(private readonly deps: A2aServerDeps) {}

  // --------------------------------------------
  // 生命周期
  // --------------------------------------------

  /**
   * 启动监听。
   *
   * 端口被占用时依次 +1 重试（用户机器上端口冲突是常态，不应直接失败），
   * 返回真正生效的端口。
   */
  async start(host: string, preferredPort: number): Promise<number> {
    if (this.server) return this.port

    for (let attempt = 0; attempt < PORT_PROBE_ATTEMPTS; attempt++) {
      const candidate = preferredPort + attempt
      try {
        await this.listenOnce(host, candidate)
        this.host = host
        this.port = candidate
        logger.system.info(`[A2A] inbound server listening on http://${host}:${candidate}`)
        return candidate
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
          logger.system.warn(`[A2A] port ${candidate} in use, trying ${candidate + 1}`)
          continue
        }
        throw err
      }
    }

    throw new Error(
      `[A2A] 无可用端口（已尝试 ${preferredPort}~${preferredPort + PORT_PROBE_ATTEMPTS - 1}）`,
    )
  }

  private listenOnce(host: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        void this.handle(req, res)
      })

      const onError = (err: NodeJS.ErrnoException): void => {
        server.removeListener('listening', onListening)
        server.close()
        reject(err)
      }
      const onListening = (): void => {
        server.removeListener('error', onError)
        this.server = server
        // A2A 的 LLM 调用可能很慢，不能有「请求超时」把正在跑的任务掐断
        server.headersTimeout = 0
        server.requestTimeout = 0
        resolve()
      }

      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(port, host)
    })
  }

  /** 停止监听并清空任务表 */
  async stop(): Promise<void> {
    const server = this.server
    this.server = null
    const previousPort = this.port
    this.port = 0

    // 先取消在跑的任务，避免 handleChat 在服务关闭后仍往 res 写数据
    for (const record of this.tasks.values()) {
      try {
        record.abort?.()
      } catch {
        /* 忽略 */
      }
    }
    this.tasks.clear()
    this.contexts.clear()

    if (!server) return
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
      // keep-alive 连接会阻塞 close，主动销毁
      server.closeAllConnections?.()
    })
    logger.system.info(`[A2A] inbound server stopped (was port ${previousPort})`)
  }

  isRunning(): boolean {
    return this.server !== null
  }

  getAddress(): { host: string; port: number } {
    return { host: this.host, port: this.port }
  }

  /**
   * 设置 / 清除对外公开地址（P0-5 网关托管时调用）。
   *
   * @param endpoint 网关的监听地址与 A2A 挂载前缀；传 null 表示脱离网关（自己监听）
   */
  setPublicEndpoint(endpoint: { host: string; port: number; basePath: string } | null): void {
    this.publicEndpoint = endpoint
  }

  /**
   * 生效的对外地址。
   *
   * 托管时返回网关地址（host/port 用网关的，basePath 用于拼 JSON-RPC 端点），
   * 独立监听时返回自己 bind 的地址。
   */
  getEffectiveEndpoint(): { host: string; port: number; basePath: string; managed: boolean } {
    if (this.publicEndpoint) {
      return { ...this.publicEndpoint, managed: true }
    }
    return { host: this.host, port: this.port, basePath: '', managed: false }
  }

  getCounters(): { requests: number; errors: number; lastRequestAt: number | null } {
    return { requests: this.requests, errors: this.errors, lastRequestAt: this.lastRequestAt }
  }

  /** 供未来挂载到 P0-5 统一 HTTP server 的升级钩子占位（当前无 WS 需求） */
  handleUpgrade(_req: http.IncomingMessage, socket: Duplex): void {
    socket.destroy()
  }

  // --------------------------------------------
  // 路由
  // --------------------------------------------

  /**
   * 处理一次请求。
   *
   * 返回 `true` 表示本模块已接管（供 P0-5 统一 server 复用）；
   * 当前 `listenOnce` 里忽略了返回值 —— 自己就是 server，不需要分流。
   */
  async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
    const startedAt = Date.now()
    let method = req.method || 'GET'

    try {
      const url = new URL(req.url || '/', `http://${this.host || '127.0.0.1'}`)
      const pathname = url.pathname

      if (method === 'OPTIONS') {
        this.applyCors(res)
        res.writeHead(204)
        res.end()
        return true
      }

      // --- Agent Card（开放，不鉴权） ---
      if (method === 'GET' && (pathname === '/.well-known/agent.json' || pathname === '/.well-known/agent-card.json')) {
        this.respondJson(res, 200, this.buildCard())
        this.count(method, startedAt, true)
        return true
      }

      if (method === 'GET' && pathname === '/a2a/health') {
        this.respondJson(res, 200, {
          status: 'ok',
          name: this.deps.getCardMeta().name,
          protocolVersion: A2A_PROTOCOL_VERSION,
        })
        this.count(method, startedAt, true)
        return true
      }

      // --- JSON-RPC ---
      if (method === 'POST' && (pathname === '/' || pathname === '/a2a' || pathname === '/a2a/rpc')) {
        const authError = this.checkAuth(req)
        if (authError) {
          this.respondJson(res, 401, authError, { 'WWW-Authenticate': 'Bearer' })
          this.count(method, startedAt, false)
          return true
        }
        await this.handleRpc(req, res)
        this.count(method, startedAt, true)
        return true
      }

      this.respondJson(res, 404, { error: 'Not Found', pathname })
      this.count(method, startedAt, false)
      return true
    } catch (err) {
      logger.system.error('[A2A] handle request failed:', err)
      this.count(method, startedAt, false)
      if (!res.headersSent) this.respondJson(res, 500, { error: 'internal error' })
      else res.end()
      return true
    } finally {
      method = method || 'GET'
    }
  }

  // --------------------------------------------
  // JSON-RPC
  // --------------------------------------------

  private async handleRpc(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const raw = await this.readBody(req)
    if (raw === null) {
      this.respondRpcError(res, null, A2A_RPC_ERRORS.INVALID_REQUEST, '请求体过大或读取超时')
      return
    }

    let payload: { id?: string | number | null; method?: unknown; params?: unknown }
    try {
      payload = JSON.parse(raw) as typeof payload
    } catch {
      this.respondRpcError(res, null, A2A_RPC_ERRORS.PARSE, '请求体不是合法 JSON')
      return
    }

    const id = payload.id ?? null
    const method = typeof payload.method === 'string' ? payload.method : ''
    const params = (payload.params ?? {}) as Record<string, unknown>

    if (!method) {
      this.respondRpcError(res, id, A2A_RPC_ERRORS.INVALID_REQUEST, '缺少 method 字段')
      return
    }

    switch (method) {
      case A2A_METHODS.SEND:
      case A2A_METHODS.TASKS_SEND:
        await this.handleSend(id, params, req, res)
        return
      case A2A_METHODS.GET:
        this.handleTaskGet(id, params, res)
        return
      case A2A_METHODS.CANCEL:
        this.handleTaskCancel(id, params, res)
        return
      case A2A_METHODS.STREAM:
        // Card 里 capabilities.streaming = false，标准客户端不会调用；
        // 真调用了就如实报「不支持」，而不是假装成功再断开连接
        this.respondRpcError(res, id, A2A_RPC_ERRORS.METHOD_NOT_FOUND, '本服务未启用 message/stream（streaming=false）')
        return
      default:
        this.respondRpcError(res, id, A2A_RPC_ERRORS.METHOD_NOT_FOUND, `不支持的方法：${method}`)
    }
  }

  private async handleSend(
    id: string | number | null,
    params: Record<string, unknown>,
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const message = params.message as A2aMessage | undefined
    const text = joinTextParts(message?.parts)
    if (!text) {
      this.respondRpcError(res, id, A2A_RPC_ERRORS.INVALID_PARAMS, 'message.parts 中没有任何 text 内容')
      return
    }

    const contextId = typeof message?.contextId === 'string' && message.contextId ? message.contextId : crypto.randomUUID()
    const taskId = typeof message?.taskId === 'string' && message.taskId ? message.taskId : crypto.randomUUID()

    const history = this.appendContext(contextId, {
      kind: 'message',
      messageId: typeof message?.messageId === 'string' ? message.messageId : crypto.randomUUID(),
      role: 'user',
      parts: [{ kind: 'text', text }],
      taskId,
      contextId,
    })

    const task: A2aTask = {
      kind: 'task',
      id: taskId,
      contextId,
      status: { state: 'submitted', timestamp: new Date().toISOString() },
      history,
    }
    const record: TaskRecord = { task, createdAt: Date.now(), abort: null }
    this.storeTask(taskId, record)

    const controller = new AbortController()
    record.abort = () => controller.abort()

    task.status = { state: 'working', timestamp: new Date().toISOString() }

    try {
      const caller = describeCaller(req)
      const replyText = await this.deps.handleChat(text, { taskId, contextId, history, caller })

      // 用户可能在此期间把任务取消了
      if (task.status.state === 'canceled') {
        this.respondRpcResult(res, id, task)
        return
      }

      task.status = { state: 'completed', timestamp: new Date().toISOString() }
      task.artifacts = [
        {
          artifactId: crypto.randomUUID(),
          name: 'reply',
          description: 'AweeClaw 回复',
          parts: [{ kind: 'text', text: replyText }],
        },
      ]
      this.respondRpcResult(res, id, task)
    } catch (err) {
      if (task.status.state === 'canceled') {
        this.respondRpcResult(res, id, task)
        return
      }
      const reason = err instanceof Error ? err.message : String(err)
      logger.system.warn('[A2A] inbound chat failed:', reason)
      task.status = {
        state: 'failed',
        timestamp: new Date().toISOString(),
        message: {
          kind: 'message',
          messageId: crypto.randomUUID(),
          role: 'agent',
          parts: [{ kind: 'text', text: `处理失败：${reason}` }],
          taskId,
          contextId,
        },
      }
      this.respondRpcResult(res, id, task)
    } finally {
      record.abort = null
    }
  }

  private handleTaskGet(id: string | number | null, params: Record<string, unknown>, res: http.ServerResponse): void {
    const taskId = typeof params.id === 'string' ? params.id : ''
    const record = taskId ? this.tasks.get(taskId) : undefined
    if (!record) {
      this.respondRpcError(res, id, -32001, `任务不存在或已过期：${taskId || '(缺少 id)'}`)
      return
    }
    this.respondRpcResult(res, id, record.task)
  }

  private handleTaskCancel(id: string | number | null, params: Record<string, unknown>, res: http.ServerResponse): void {
    const taskId = typeof params.id === 'string' ? params.id : ''
    const record = taskId ? this.tasks.get(taskId) : undefined
    if (!record) {
      this.respondRpcError(res, id, -32001, `任务不存在或已过期：${taskId || '(缺少 id)'}`)
      return
    }

    if (!isFinal(record.task.status.state)) {
      record.task.status = { state: 'canceled', timestamp: new Date().toISOString() }
      try {
        record.abort?.()
      } catch {
        /* 忽略取消失败 */
      }
    }
    this.respondRpcResult(res, id, record.task)
  }

  // --------------------------------------------
  // 任务与上下文
  // --------------------------------------------

  private storeTask(taskId: string, record: TaskRecord): void {
    this.tasks.set(taskId, record)
    this.pruneTasks()
  }

  /** 清理过期与超量任务（避免长期运行内存无界增长） */
  private pruneTasks(): void {
    const now = Date.now()
    for (const [id, record] of this.tasks) {
      if (now - record.createdAt > TASK_TTL_MS) this.tasks.delete(id)
    }
    if (this.tasks.size <= TASK_LIMIT) return

    // 超出上限：按创建时间从旧到新删
    const sorted = [...this.tasks.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)
    for (const [id] of sorted.slice(0, this.tasks.size - TASK_LIMIT)) this.tasks.delete(id)
  }

  /** 追加一条上下文消息，返回截断后的历史 */
  private appendContext(contextId: string, message: A2aMessage): A2aMessage[] {
    const list = this.contexts.get(contextId) ?? []
    list.push(message)
    while (list.length > CONTEXT_HISTORY_LIMIT) list.shift()
    this.contexts.set(contextId, list)
    return [...list]
  }

  /** 记录一条 agent 回复到上下文（保持多轮对话连续） */
  recordAgentReply(contextId: string, text: string): void {
    if (!contextId || !text) return
    const list = this.contexts.get(contextId)
    if (!list) return
    list.push({
      kind: 'message',
      messageId: crypto.randomUUID(),
      role: 'agent',
      parts: [{ kind: 'text', text }],
    })
  }

  // --------------------------------------------
  // Card / 鉴权 / 工具
  // --------------------------------------------

  /** 生成 Agent Card */
  buildCard(): A2aAgentCard {
    const meta = this.deps.getCardMeta()
    // 用生效地址而不是自己 bind 的地址：托管到 P0-5 网关时自己没监听（port=0），
    // 回显 :0 会让对端拿到一个连不上的 url
    const { host, port, basePath } = this.getEffectiveEndpoint()
    const base = `http://${host}:${port}${basePath}`
    return {
      name: meta.name,
      description: meta.description,
      url: base,
      version: meta.version,
      protocolVersion: A2A_PROTOCOL_VERSION,
      provider: { organization: 'AweeClaw' },
      capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
      defaultInputModes: ['text/plain'],
      defaultOutputModes: ['text/plain'],
      skills: this.deps.getSkills().map((s) => ({ ...s })),
      preferredTransport: 'JSONRPC',
    }
  }

  /** 校验 Bearer token；返回 null 表示通过，否则返回错误响应体 */
  private checkAuth(req: http.IncomingMessage): Record<string, unknown> | null {
    const required = this.deps.getAuthToken()
    if (!required) return null

    const header = req.headers.authorization || ''
    const match = /^Bearer\s+(.+)$/i.exec(header.trim())
    if (match && match[1].trim() === required) return null

    return { error: 'unauthorized', message: '缺少或无效的 Authorization: Bearer <token>' }
  }

  /** 调用方标识（仅审计用途） */
  private count(method: string, startedAt: number, ok: boolean): void {
    this.requests += 1
    if (!ok) this.errors += 1
    this.lastRequestAt = Date.now()
    try {
      this.deps.onRequest?.({ method, ok, durationMs: Date.now() - startedAt })
    } catch {
      /* 回调异常不影响服务 */
    }
  }

  // --------------------------------------------
  // 响应工具
  // --------------------------------------------

  private respondRpcResult(res: http.ServerResponse, id: string | number | null, result: unknown): void {
    this.respondJson(res, 200, { jsonrpc: '2.0', id, result })
  }

  private respondRpcError(
    res: http.ServerResponse,
    id: string | number | null,
    code: number,
    message: string,
  ): void {
    this.respondJson(res, 200, { jsonrpc: '2.0', id, error: { code, message } })
  }

  private respondJson(
    res: http.ServerResponse,
    status: number,
    payload: unknown,
    extraHeaders: Record<string, string> = {},
  ): void {
    if (res.headersSent) return
    this.applyCors(res)
    const body = JSON.stringify(payload)
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
      ...extraHeaders,
    })
    res.end(body)
  }

  private applyCors(res: http.ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  }

  private readBody(req: http.IncomingMessage): Promise<string | null> {
    return new Promise((resolve) => {
      let size = 0
      const chunks: Buffer[] = []
      let settled = false

      const done = (value: string | null): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      }

      const timer = setTimeout(() => {
        req.destroy()
        done(null)
      }, BODY_TIMEOUT_MS)

      req.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > MAX_BODY_BYTES) {
          req.destroy()
          done(null)
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => done(Buffer.concat(chunks).toString('utf-8')))
      req.on('error', () => done(null))
    })
  }
}

// ============================================
// 工具函数
// ============================================

function isFinal(state: A2aTaskState | undefined): boolean {
  return state === 'completed' || state === 'canceled' || state === 'failed' || state === 'rejected'
}

/** 拼接文本块（与 A2aClient 的提取逻辑保持一致） */
function joinTextParts(parts: A2aPart[] | undefined): string {
  if (!Array.isArray(parts)) return ''
  return parts
    .filter((p) => p?.kind === 'text' && typeof (p as { text?: unknown }).text === 'string')
    .map((p) => (p as { text: string }).text)
    .join('\n')
    .trim()
}

/** 生成调用方标识（不解析 IP，避免把内网地址写进日志） */
function describeCaller(req: http.IncomingMessage): string {
  const ua = req.headers['user-agent']
  return typeof ua === 'string' && ua ? ua.slice(0, 120) : 'unknown'
}
