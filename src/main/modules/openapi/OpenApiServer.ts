/**
 * 对外 API 网关 HTTP 服务（主进程）
 *
 * 核心设计：**一个 server，多个协议前缀**。
 *
 *   /v1/*                    OpenAI 兼容端点（models / agents / chat/completions）
 *   /mcp                     MCP Streamable HTTP
 *   /a2a、/a2a/rpc           委托给 A2aServer.handle()（P0-4 的实现，原样复用）
 *   /a2a/health              A2A 存活探针，同上
 *   /.well-known/agent.json  A2A Agent Card，同上（规范要求挂在根级）
 *   /openapi/status          网关自有状态端点
 *
 * 为什么必须合并端口：分离端口意味着每个协议各自一套「端口占用 + 启动失败 +
 * 防火墙提示 + 用户配置」的问题。A2A 原本自带一个 http.Server（P0-4 时期的临时
 * 方案），现在统一挂在网关下 —— A2A 只在**网关未启用**时才退回独立监听。
 *
 * 路由分发刻意不在这里碰具体业务：`/v1/*` 与 `/mcp` 各自有独立 handler 文件，
 * 本类只负责「鉴权顺序 → 分发 → 记数」。
 *
 * @module openapi/OpenApiServer
 */

import * as http from 'http'
import { logger } from '@shared/toolkit/LogEngine'
import { applyCors, checkApiKey, isLocalOnlyPath, isLoopbackRequest, isPublicPath, localOnlyFailure } from './OpenApiAuth'
import { handleAgents } from './routes/agents'
import { handleChatCompletions } from './routes/chatCompletions'
import { handleMcp } from './routes/mcp'
import { handleModels } from './routes/models'
import type { RouteContext } from './routes/routeTypes'
import type { OpenApiConfig, OpenApiRequestRecord, OpenApiStatus } from '@shared/protocols/openApiProtocol'
import { OPEN_API_RECENT_LIMIT } from '@shared/protocols/openApiProtocol'

// ============================================
// 常量
// ============================================

/** 端口占用时的重试次数（与 A2A / Overlay 的策略一致） */
const PORT_PROBE_ATTEMPTS = 10

/** 请求体上限：对话可能带长上下文，4MB 足够且不至于被打爆 */
const MAX_BODY_BYTES = 4 * 1024 * 1024

/** 请求体读取超时（防慢速攻击；注意这不是「AI 生成超时」） */
const BODY_TIMEOUT_MS = 30_000

/** A2A 委托路径（精确 + 前缀两类） */
const A2A_EXACT_PATHS = new Set([
  '/a2a',
  '/a2a/rpc',
  '/a2a/health',
  '/.well-known/agent.json',
  '/.well-known/agent-card.json',
])

/** A2A handler 的最小形状（只要求有 handle，避免这里耦合 A2aServer 全貌） */
export interface A2aHandlerLike {
  handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean>
}

export interface OpenApiServerDeps {
  /** 读取当前配置（每次请求实时读取，配置改动立即生效） */
  getConfig: () => OpenApiConfig
  /** 取 A2A 入站 handler；未启用时返回 null */
  getA2aHandler: () => A2aHandlerLike | null
  /** 组装网关状态（供 GET /openapi/status） */
  getStatus: () => OpenApiStatus
}

// ============================================
// 服务
// ============================================

export class OpenApiServer {
  private server: http.Server | null = null
  private host = '127.0.0.1'
  private port = 0

  private requests = 0
  private errors = 0
  private lastRequestAt: number | null = null
  private readonly recent: OpenApiRequestRecord[] = []

  constructor(private readonly deps: OpenApiServerDeps) {}

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
        logger.system.info(`[OpenApi] gateway listening on http://${host}:${candidate}`)
        return candidate
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
          logger.system.warn(`[OpenApi] port ${candidate} in use, trying ${candidate + 1}`)
          continue
        }
        throw err
      }
    }

    throw new Error(
      `[OpenApi] 无可用端口（已尝试 ${preferredPort}~${preferredPort + PORT_PROBE_ATTEMPTS - 1}）`,
    )
  }

  private listenOnce(host: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        void this.handleRequest(req, res)
      })

      const onError = (err: NodeJS.ErrnoException): void => {
        server.removeListener('listening', onListening)
        server.close()
        reject(err)
      }
      const onListening = (): void => {
        server.removeListener('error', onError)
        this.server = server
        // AI 流式生成可能持续很久，不能有「请求超时」把正在跑的对话掐断
        // （与 P0-5 实现注意第 5 条一致：只有客户端断开和用户停止能中止）
        server.headersTimeout = 0
        server.requestTimeout = 0
        resolve()
      }

      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(port, host)
    })
  }

  /** 停止服务并释放端口 */
  async stop(): Promise<void> {
    const server = this.server
    this.server = null
    const previousPort = this.port
    this.port = 0

    if (!server) return
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
      // SSE / keep-alive 连接会阻塞 close，主动销毁
      server.closeAllConnections?.()
    })
    logger.system.info(`[OpenApi] gateway stopped (was port ${previousPort})`)
  }

  isRunning(): boolean {
    return this.server !== null
  }

  getAddress(): { host: string; port: number } {
    return { host: this.host, port: this.port }
  }

  getCounters(): { requests: number; errors: number; lastRequestAt: number | null } {
    return { requests: this.requests, errors: this.errors, lastRequestAt: this.lastRequestAt }
  }

  getRecent(): OpenApiRequestRecord[] {
    return [...this.recent]
  }

  // --------------------------------------------
  // 路由
  // --------------------------------------------

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const startedAt = Date.now()
    let pathname = '/'

    try {
      const url = new URL(req.url || '/', `http://${this.host || '127.0.0.1'}`)
      pathname = url.pathname
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: { message: 'bad url', type: 'invalid_request_error', code: 'bad_request' } }))
      return
    }

    const method = req.method || 'GET'
    const config = this.deps.getConfig()

    // 所有响应都带 CORS 头（含 404），否则浏览器端只能看到无关的 CORS 报错
    applyCors(req, res, config)

    // 记数：挂在 finish 上而不是各分支里 —— A2A 委托的响应也要计入同一端口的统计
    res.on('finish', () => this.record(method, pathname, res.statusCode, Date.now() - startedAt))

    try {
      // --- 预检 ---
      if (method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        return
      }

      // --- A2A 委托（鉴权由 A2aServer 自己用 inbound.token 处理）---
      if (this.isA2aPath(pathname)) {
        const a2a = this.deps.getA2aHandler()
        if (!a2a) {
          this.respondJson(res, 404, {
            error: { message: 'A2A 入站未启用（设置 → A2A 协议）', type: 'invalid_request_error', code: 'not_found' },
          })
          return
        }
        const handled = await a2a.handle(req, res)
        if (!handled && !res.writableEnded) {
          this.respondJson(res, 404, { error: { message: 'Not Found', type: 'invalid_request_error', code: 'not_found' } })
        }
        return
      }

      // --- 仅本机可访问的排障端点 ---
      if (isLocalOnlyPath(pathname)) {
        if (!isLoopbackRequest(req)) {
          const failure = localOnlyFailure()
          this.respondJson(res, failure.status, failure.body)
          return
        }
        if (pathname === '/openapi/status' && method === 'GET') {
          this.respondJson(res, 200, this.deps.getStatus())
          return
        }
      }

      // --- 鉴权（Agent Card 之外全部要求 apiKey）---
      if (!isPublicPath(pathname)) {
        const failure = checkApiKey(req, config)
        if (failure) {
          this.respondJson(res, failure.status, failure.body)
          return
        }
      }

      // --- OpenAI 兼容端点 ---
      const ctx = this.buildRouteContext()
      if (pathname === '/v1/models' && method === 'GET') {
        handleModels(req, res, ctx)
        return
      }
      if (pathname === '/v1/agents' && method === 'GET') {
        handleAgents(req, res, ctx)
        return
      }
      if (pathname === '/v1/chat/completions' && method === 'POST') {
        await handleChatCompletions(req, res, ctx)
        return
      }

      // --- MCP ---
      if (pathname === '/mcp') {
        await handleMcp(req, res, ctx)
        return
      }

      this.respondJson(res, 404, {
        error: {
          message: `未找到端点：${method} ${pathname}。可用端点见「设置 → 对外 API」的端点速查`,
          type: 'invalid_request_error',
          code: 'not_found',
        },
      })
    } catch (err) {
      this.errors += 1
      logger.system.error('[OpenApi] handle request failed:', err)
      if (!res.headersSent) {
        this.respondJson(res, 500, {
          error: { message: '网关内部错误', type: 'server_error', code: 'internal_error' },
        })
      } else if (!res.writableEnded) {
        res.end()
      }
    }
  }

  /** 是否 A2A 路径（精确匹配 + `/a2a/` 子路径） */
  private isA2aPath(pathname: string): boolean {
    return A2A_EXACT_PATHS.has(pathname) || pathname.startsWith('/a2a/')
  }

  // --------------------------------------------
  // 请求体与响应
  // --------------------------------------------

  /** 构造路由上下文（routes/* 的公共依赖） */
  private buildRouteContext(): RouteContext {
    return {
      config: this.deps.getConfig(),
      readJsonBody: async (r) => {
        const raw = await this.readBody(r)
        if (raw === null) return null
        try {
          const parsed = JSON.parse(raw || '{}')
          return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : null
        } catch {
          return null
        }
      },
      readJsonBodyRaw: (r) => this.readBody(r),
      respondJson: (r, status, body) => this.respondJson(r, status, body),
      reportError: (err, note) => {
        this.errors += 1
        logger.system.error(`[OpenApi] ${note} failed:`, err)
      },
    }
  }

  /** 读取请求体（限长 + 超时） */
  private readBody(req: http.IncomingMessage): Promise<string | null> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = []
      let size = 0
      let settled = false

      const finish = (value: string | null): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      }

      const timer = setTimeout(() => {
        logger.system.warn('[OpenApi] request body read timeout')
        finish(null)
      }, BODY_TIMEOUT_MS)

      req.on('data', (chunk: Buffer) => {
        if (settled) return
        size += chunk.length
        if (size > MAX_BODY_BYTES) {
          logger.system.warn('[OpenApi] request body too large')
          finish(null)
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => finish(Buffer.concat(chunks).toString('utf-8')))
      req.on('error', (err) => {
        logger.system.warn('[OpenApi] request body read error:', err)
        finish(null)
      })
      req.on('aborted', () => finish(null))
    })
  }

  private respondJson(res: http.ServerResponse, status: number, body: unknown): void {
    if (res.headersSent) {
      if (!res.writableEnded) res.end()
      return
    }
    // 4xx/5xx 由调用方自己加 this.errors（避免双重计数）——这里只管发响应
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(body))
  }

  /** 记一次请求（含排障用的最近记录） */
  private record(method: string, path: string, status: number, durationMs: number): void {
    this.requests += 1
    this.lastRequestAt = Date.now()

    // 静态探测（客户端进来先探 /v1/models）不进排障列表，否则会把真正的调用挤掉
    const recordable = status >= 400 || (method === 'POST' && path !== '/openapi/status')
    if (!recordable) return

    this.recent.unshift({
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      method,
      path,
      status,
      durationMs,
      at: Date.now(),
    })
    if (this.recent.length > OPEN_API_RECENT_LIMIT) this.recent.length = OPEN_API_RECENT_LIMIT
  }
}
