/**
 * 悬浮层 HTTP 服务（主进程）
 *
 * 为什么必须有 HTTP 服务：
 *   OBS 的「浏览器源」是独立的浏览器环境，**无法访问 Electron IPC**，
 *   只能通过 http://127.0.0.1:<port>/... 访问页面并连 WS 收指令。
 *   这与源项目 `py/overlay_router.py`（FastAPI + 静态 HTML）职责一致。
 *
 * 路由（与源项目对齐 + AweeClaw 增强）：
 *   GET  /overlay.html?mode=subtitle|danmaku   悬浮页面本体
 *   GET  /subtitle_overlay                     302 → /overlay.html?mode=subtitle
 *   GET  /danmaku_overlay                      302 → /overlay.html?mode=danmaku
 *   POST /api/overlay/danmaku                  广播一条（body 即事件体，兼容 { data: ... }）
 *   POST /api/overlay/danmaku/clear            清空
 *   GET  /api/overlay/status                   运行状态（端口/连接数/最近事件）
 *   GET  /assets/**                            构建产物静态资源
 *
 * 安全约定：
 * 1. **只监听 127.0.0.1**（禁止 0.0.0.0）
 * 2. 静态资源限定在 dist/renderer 目录内（防路径穿越）
 * 3. POST body 限长 64KB + 5s 超时
 *
 * @module overlay/OverlayHttpServer
 */

import * as http from 'http'
import * as fs from 'fs'
import * as path from 'path'
import { logger } from '@shared/toolkit/LogEngine'
import { PORT_PROBE_ATTEMPTS, getConfig } from './OverlayStore'
import type { DanmuType, OverlayMode } from './types'

/** 仅本机监听 */
const BIND_HOST = '127.0.0.1'

const MAX_BODY_BYTES = 64 * 1024
const BODY_TIMEOUT_MS = 5_000

/** 允许的弹幕类型（入参校验，避免脏数据流到前端） */
const VALID_DANMU_TYPES = new Set<DanmuType>([
  'danmaku',
  'gift',
  'buy_guard',
  'super_chat',
  'enter_room',
  'follow',
  'like',
])

/** 静态资源 MIME 表（只覆盖悬浮页面会用到的类型） */
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
}

/** 外部注入的弹幕事件（宽松入参，服务端补全 id/type/ts） */
export interface InboundDanmakuInput {
  content: string
  danmu_type?: DanmuType
  platform?: string
  id?: string
}

export interface OverlayHttpServerDeps {
  /** 接收一条弹幕（由 OverlayManager 补齐字段并广播） */
  onDanmaku: (input: InboundDanmakuInput) => void
  /** 清空悬浮层 */
  onClear: () => void
  /** 读取运行状态（端口 / 连接数 / 最近事件摘要） */
  getStatus: () => Record<string, unknown>
  /** HTTP 升级请求转发（WS 接管） */
  onUpgrade: (req: http.IncomingMessage, socket: Duplex, head: Buffer) => void
}

type Duplex = import('stream').Duplex

export class OverlayHttpServer {
  private server: http.Server | null = null
  private port = 0
  private deps: OverlayHttpServerDeps

  constructor(deps: OverlayHttpServerDeps) {
    this.deps = deps
  }

  /**
   * 启动服务。
   *
   * 端口占用时依次 +1 重试（最多 PORT_PROBE_ATTEMPTS 次），
   * 与 WebhookReceiver 的策略一致 —— 用户机器上端口冲突是常态，不应直接失败。
   */
  async start(preferredPort: number): Promise<number> {
    if (this.server) return this.port

    for (let attempt = 0; attempt < PORT_PROBE_ATTEMPTS; attempt++) {
      const candidate = preferredPort + attempt
      try {
        await this.listenOnce(candidate)
        this.port = candidate
        logger.system.info(`[Overlay] HTTP server listening on http://${BIND_HOST}:${candidate}`)
        return candidate
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code
        if (code === 'EADDRINUSE') {
          logger.system.warn(`[Overlay] port ${candidate} in use, trying ${candidate + 1}`)
          continue
        }
        throw err
      }
    }

    throw new Error(
      `[Overlay] no available port in range ${preferredPort}~${preferredPort + PORT_PROBE_ATTEMPTS - 1}`
    )
  }

  private listenOnce(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => this.handleRequest(req, res))

      const onError = (err: NodeJS.ErrnoException): void => {
        server.removeListener('listening', onListening)
        server.close()
        reject(err)
      }
      const onListening = (): void => {
        server.removeListener('error', onError)
        this.server = server
        server.on('upgrade', (req, socket, head) => {
          this.deps.onUpgrade(req, socket as Duplex, head)
        })
        // 长连接场景禁用 listen backlog 之外的超时（WS 需要长连）
        server.headersTimeout = 0
        server.requestTimeout = 0
        resolve()
      }

      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(port, BIND_HOST)
    })
  }

  /** 停止服务并释放端口 */
  async stop(): Promise<void> {
    const server = this.server
    if (!server) return
    this.server = null
    this.port = 0

    await new Promise<void>(resolve => {
      server.close(() => resolve())
      // 未完成的连接（keep-alive / WS）会阻塞 close，主动销毁
      server.closeAllConnections?.()
    })
    logger.system.info('[Overlay] HTTP server stopped')
  }

  /** 当前监听端口（0 = 未启动） */
  getPort(): number {
    return this.port
  }

  isRunning(): boolean {
    return this.server !== null
  }

  // ============================================
  // 路由
  // ============================================

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    let url: URL
    try {
      url = new URL(req.url || '/', `http://${BIND_HOST}:${this.port}`)
    } catch {
      this.respondJson(res, 400, { error: 'bad url' })
      return
    }

    const pathname = url.pathname
    const method = req.method || 'GET'

    // 预检（第三方脚本注入弹幕时会触发）
    if (method === 'OPTIONS') {
      this.applyCors(res)
      res.writeHead(204)
      res.end()
      return
    }

    // --- 页面 ---
    if (pathname === '/overlay.html' && method === 'GET') {
      this.serveOverlayPage(url, res)
      return
    }
    if (pathname === '/subtitle_overlay' && method === 'GET') {
      this.redirect(res, '/overlay.html?mode=subtitle')
      return
    }
    if (pathname === '/danmaku_overlay' && method === 'GET') {
      this.redirect(res, '/overlay.html?mode=danmaku')
      return
    }

    // --- 指令 API ---
    if (pathname === '/api/overlay/danmaku' && method === 'POST') {
      this.handleDanmakuPost(req, res)
      return
    }
    if (pathname === '/api/overlay/danmaku/clear' && method === 'POST') {
      this.deps.onClear()
      this.respondJson(res, 200, { status: 'ok' })
      return
    }
    if (pathname === '/api/overlay/status' && method === 'GET') {
      this.respondJson(res, 200, { status: 'ok', port: this.port, ...this.deps.getStatus() })
      return
    }

    // --- 静态资源 ---
    if (method === 'GET' && this.tryServeStatic(pathname, res)) return

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Not Found')
  }

  /** 返回悬浮页面（开发态跳转到 Vite devServer，生产态读构建产物） */
  private serveOverlayPage(url: URL, res: http.ServerResponse): void {
    const modeParam = url.searchParams.get('mode')
    const mode: OverlayMode = modeParam === 'danmaku' ? 'danmaku' : 'subtitle'

    const devServerUrl = process.env.VITE_DEV_SERVER_URL
    if (devServerUrl) {
      // 开发态不在主进程托管前端资源，直接跳到 devServer（OBS 也能访问本机 5173）
      const target = `${devServerUrl.replace(/\/$/, '')}/overlay.html?mode=${mode}&port=${this.port}`
      res.writeHead(302, { Location: target })
      res.end()
      return
    }

    const filePath = path.join(__dirname, '../renderer/overlay.html')
    try {
      if (!fs.existsSync(filePath)) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end(`overlay.html not found: ${filePath}`)
        return
      }
      const rawHtml = fs.readFileSync(filePath, 'utf-8')
      // 注入运行时配置：OBS 场景没有 preload/IPC，页面只能从 HTML 里拿样式参数
      let html = rawHtml
      try {
        const config = getConfig()
        const injected = JSON.stringify({
          windowMode: config.windowMode,
          window: config.window,
          subtitle: config.subtitle,
          danmaku: config.danmaku,
        })
        html = rawHtml.replace(
          '/* OVERLAY_CONFIG_PLACEHOLDER */',
          `window.__OVERLAY_CONFIG__ = ${injected};`
        )
      } catch (err) {
        // 注入失败不阻塞页面：前端会退化为默认样式
        logger.system.warn('[Overlay] inject config failed:', err)
      }

      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache',
      })
      res.end(html)
    } catch (err) {
      logger.system.error('[Overlay] serve overlay page failed:', err)
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('failed to read overlay.html')
    }
  }

  /** 处理外部注入的弹幕 */
  private handleDanmakuPost(req: http.IncomingMessage, res: http.ServerResponse): void {
    this.readBody(req)
      .then(body => {
        if (body === null) {
          this.respondJson(res, 413, { error: 'payload too large or timeout' })
          return
        }

        let parsed: unknown
        try {
          parsed = body.trim() ? JSON.parse(body) : {}
        } catch {
          this.respondJson(res, 400, { error: 'invalid json' })
          return
        }

        // 兼容两种写法：直接传事件体，或 { data: 事件体 }
        const raw = parsed as Record<string, unknown>
        const payload = (raw && typeof raw.data === 'object' && raw.data !== null
          ? raw.data
          : raw) as Record<string, unknown>

        const content = typeof payload.content === 'string' ? payload.content.trim() : ''
        if (!content) {
          this.respondJson(res, 400, { error: 'content is required' })
          return
        }

        const danmuType = payload.danmu_type
        this.deps.onDanmaku({
          content,
          danmu_type:
            typeof danmuType === 'string' && VALID_DANMU_TYPES.has(danmuType as DanmuType)
              ? (danmuType as DanmuType)
              : 'danmaku',
          platform: typeof payload.platform === 'string' ? payload.platform : 'local',
          id: typeof payload.id === 'string' ? payload.id : undefined,
        })

        this.respondJson(res, 200, { status: 'ok' })
      })
      .catch(err => {
        logger.system.error('[Overlay] handle danmaku post failed:', err)
        this.respondJson(res, 500, { error: 'internal error' })
      })
  }

  // ============================================
  // 工具
  // ============================================

  /** 读取请求体（限长 + 超时） */
  private readBody(req: http.IncomingMessage): Promise<string | null> {
    return new Promise(resolve => {
      const chunks: Buffer[] = []
      let size = 0
      let settled = false

      const finish = (value: string | null): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      }

      const timer = setTimeout(() => finish(null), BODY_TIMEOUT_MS)

      req.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > MAX_BODY_BYTES) {
          finish(null)
          req.destroy()
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => finish(Buffer.concat(chunks).toString('utf-8')))
      req.on('error', () => finish(null))
    })
  }

  /** 提供构建产物静态资源（限定在 dist/renderer 内） */
  private tryServeStatic(pathname: string, res: http.ServerResponse): boolean {
    // 只服务看起来像文件的路径，避免把未知路由吞掉
    if (pathname === '/' || pathname.includes('..')) return false

    const rendererDir = path.resolve(__dirname, '../renderer')
    const target = path.resolve(rendererDir, `.${pathname}`)
    if (!target.startsWith(rendererDir)) return false

    try {
      if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return false
      const ext = path.extname(target).toLowerCase()
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        // 构建产物带 hash，可长缓存；overlay.html 本身不缓存（见 serveOverlayPage）
        'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
      })
      fs.createReadStream(target).pipe(res)
      return true
    } catch {
      return false
    }
  }

  private redirect(res: http.ServerResponse, location: string): void {
    res.writeHead(302, { Location: location })
    res.end()
  }

  private applyCors(res: http.ServerResponse): void {
    // 服务只监听 127.0.0.1，来源放开以便本地脚本/OBS 插件注入
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  }

  private respondJson(res: http.ServerResponse, status: number, body: unknown): void {
    this.applyCors(res)
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(body))
  }
}
