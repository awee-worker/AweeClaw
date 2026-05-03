import * as http from 'http'
import { logger } from '@shared/utils/Logger'
import { wechatChannelPlugin } from './adapters/WechatChannelPlugin'
import { whatsappChannelPlugin } from './adapters/WhatsAppChannelPlugin'
import { channelConfigStore } from './ChannelConfigStore'

const DEFAULT_WEBHOOK_PORT = 3456

const WEBHOOK_PREAUTH_MAX_BODY_BYTES = 64 * 1024
const WEBHOOK_POSTAUTH_MAX_BODY_BYTES = 1024 * 1024
const WEBHOOK_BODY_TIMEOUT_MS = 5_000
const WEBHOOK_POSTAUTH_BODY_TIMEOUT_MS = 30_000

const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX_REQUESTS = 120
const RATE_LIMIT_MAX_TRACKED_KEYS = 4_096

const IN_FLIGHT_MAX_PER_KEY = 8
const IN_FLIGHT_MAX_TRACKED_KEYS = 4_096

const ANOMALY_TTL_MS = 6 * 60 * 60_000
const ANOMALY_LOG_EVERY = 25
const ANOMALY_TRACKED_STATUS_CODES = new Set([400, 401, 408, 413, 415, 429])

interface FixedWindowState {
  count: number
  windowStartMs: number
}

class FixedWindowRateLimiter {
  private state = new Map<string, FixedWindowState>()
  private lastPruneMs = 0

  isRateLimited(key: string, nowMs = Date.now()): boolean {
    if (!key) return false
    if (nowMs - this.lastPruneMs >= RATE_LIMIT_WINDOW_MS) {
      this.prune(nowMs)
      this.lastPruneMs = nowMs
    }
    const existing = this.state.get(key)
    if (!existing || nowMs - existing.windowStartMs >= RATE_LIMIT_WINDOW_MS) {
      this.state.delete(key)
      this.state.set(key, { count: 1, windowStartMs: nowMs })
      this.pruneToMaxSize()
      return false
    }
    const nextCount = existing.count + 1
    this.state.delete(key)
    this.state.set(key, { count: nextCount, windowStartMs: existing.windowStartMs })
    this.pruneToMaxSize()
    return nextCount > RATE_LIMIT_MAX_REQUESTS
  }

  private prune(nowMs: number): void {
    for (const [key, entry] of this.state) {
      if (nowMs - entry.windowStartMs >= RATE_LIMIT_WINDOW_MS) {
        this.state.delete(key)
      }
    }
  }

  private pruneToMaxSize(): void {
    if (this.state.size <= RATE_LIMIT_MAX_TRACKED_KEYS) return
    const keys = Array.from(this.state.keys())
    const toDelete = keys.slice(0, keys.length - RATE_LIMIT_MAX_TRACKED_KEYS)
    for (const k of toDelete) this.state.delete(k)
  }
}

class InFlightLimiter {
  private active = new Map<string, number>()

  tryAcquire(key: string): boolean {
    if (!key) return true
    const current = this.active.get(key) ?? 0
    if (current >= IN_FLIGHT_MAX_PER_KEY) return false
    this.active.set(key, current + 1)
    this.pruneToMaxSize()
    return true
  }

  release(key: string): void {
    if (!key) return
    const current = this.active.get(key)
    if (current === undefined) return
    if (current <= 1) {
      this.active.delete(key)
      return
    }
    this.active.set(key, current - 1)
  }

  private pruneToMaxSize(): void {
    if (this.active.size <= IN_FLIGHT_MAX_TRACKED_KEYS) return
    const keys = Array.from(this.active.keys())
    const toDelete = keys.slice(0, keys.length - IN_FLIGHT_MAX_TRACKED_KEYS)
    for (const k of toDelete) this.active.delete(k)
  }
}

interface CounterState {
  count: number
  updatedAtMs: number
}

class AnomalyTracker {
  private counters = new Map<string, CounterState>()
  private lastPruneMs = 0

  record(params: {
    key: string
    statusCode: number
    message: (count: number) => string
    nowMs?: number
  }): number {
    const { key, statusCode, message, nowMs = Date.now() } = params
    if (!ANOMALY_TRACKED_STATUS_CODES.has(statusCode)) return 0
    if (nowMs - this.lastPruneMs >= ANOMALY_TTL_MS) {
      this.prune(nowMs)
      this.lastPruneMs = nowMs
    }
    const existing = this.counters.get(key)
    const baseCount = existing && (nowMs - existing.updatedAtMs < ANOMALY_TTL_MS) ? existing.count : 0
    const nextCount = baseCount + 1
    this.counters.delete(key)
    this.counters.set(key, { count: nextCount, updatedAtMs: nowMs })
    this.pruneToMaxSize()
    if (nextCount === 1 || nextCount % ANOMALY_LOG_EVERY === 0) {
      logger.channel.warn(message(nextCount))
    }
    return nextCount
  }

  private prune(nowMs: number): void {
    for (const [key, entry] of this.counters) {
      if (nowMs - entry.updatedAtMs >= ANOMALY_TTL_MS) {
        this.counters.delete(key)
      }
    }
  }

  private pruneToMaxSize(): void {
    if (this.counters.size <= RATE_LIMIT_MAX_TRACKED_KEYS) return
    const keys = Array.from(this.counters.keys())
    const toDelete = keys.slice(0, keys.length - RATE_LIMIT_MAX_TRACKED_KEYS)
    for (const k of toDelete) this.counters.delete(k)
  }
}

class WebhookServer {
  private server: http.Server | null = null
  private port: number = DEFAULT_WEBHOOK_PORT
  private running = false
  private rateLimiter = new FixedWindowRateLimiter()
  private inFlightLimiter = new InFlightLimiter()
  private anomalyTracker = new AnomalyTracker()

  async start(port?: number): Promise<void> {
    if (this.running) return
    this.port = port || DEFAULT_WEBHOOK_PORT

    this.server = http.createServer((req, res) => this.handleRequest(req, res))

    return new Promise((resolve, reject) => {
      this.server!.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          logger.channel.warn(`[Webhook] Port ${this.port} in use, trying ${this.port + 1}`)
          this.port++
          this.server!.close()
          this.server!.listen(this.port, () => {
            this.running = true
            logger.channel.info(`[Webhook] Server started on port ${this.port}`)
            resolve()
          })
        } else {
          reject(err)
        }
      })

      this.server!.listen(this.port, () => {
        this.running = true
        logger.channel.info(`[Webhook] Server started on port ${this.port}`)
        resolve()
      })
    })
  }

  async stop(): Promise<void> {
    if (!this.server) return
    return new Promise(resolve => {
      this.server!.close(() => {
        this.running = false
        this.server = null
        logger.channel.info('[Webhook] Server stopped')
        resolve()
      })
    })
  }

  getPort(): number {
    return this.port
  }

  isRunning(): boolean {
    return this.running
  }

  getWebhookUrl(): string {
    return `http://localhost:${this.port}`
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = new URL(req.url || '/', `http://localhost:${this.port}`)
    const path = url.pathname

    if (path === '/webhook/wechat') {
      if (req.method === 'GET') {
        this.handleWechatVerification(req, url, res)
      } else if (req.method === 'POST') {
        this.handleWechatMessage(req, url, res)
      } else {
        this.respondMethodNotAllowed(res, ['GET', 'POST'])
      }
      return
    }

    if (path === '/webhook/whatsapp') {
      if (req.method === 'GET') {
        this.handleWhatsappVerification(req, url, res)
      } else if (req.method === 'POST') {
        this.handleWhatsappMessage(req, res)
      } else {
        this.respondMethodNotAllowed(res, ['GET', 'POST'])
      }
      return
    }

    if (path === '/webhook/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok', port: this.port }))
      return
    }

    res.writeHead(404)
    res.end('Not Found')
  }

  private checkRateLimit(req: http.IncomingMessage, path: string): boolean {
    const clientIp = req.socket.remoteAddress || 'unknown'
    const key = `${path}:${clientIp}`
    return this.rateLimiter.isRateLimited(key)
  }

  private handleWechatVerification(
    req: http.IncomingMessage,
    url: URL,
    res: http.ServerResponse
  ): void {
    if (this.checkRateLimit(req, '/webhook/wechat')) {
      this.recordAnomaly(req, '/webhook/wechat', 429)
      res.writeHead(429)
      res.end('Too Many Requests')
      return
    }

    const msgSignature = url.searchParams.get('msg_signature') || ''
    const timestamp = url.searchParams.get('timestamp') || ''
    const nonce = url.searchParams.get('nonce') || ''
    const echostr = url.searchParams.get('echostr') || ''

    const wechatConfig = channelConfigStore.get('wechat')
    if (!wechatConfig) {
      this.recordAnomaly(req, '/webhook/wechat', 401)
      res.writeHead(403)
      res.end('No wechat config')
      return
    }

    const account = wechatChannelPlugin.findAccountBySignature(
      wechatConfig.accounts,
      timestamp,
      nonce,
      echostr,
      msgSignature
    )

    if (!account) {
      this.recordAnomaly(req, '/webhook/wechat', 401)
      res.writeHead(403)
      res.end('Verification failed')
      return
    }

    try {
      const encodingAesKey = account.credentials.encodingAesKey || ''
      if (encodingAesKey) {
        const replyEchostr = wechatChannelPlugin.decryptEchostr(encodingAesKey, echostr)
        res.writeHead(200)
        res.end(replyEchostr)
      } else {
        res.writeHead(200)
        res.end(echostr)
      }
    } catch {
      res.writeHead(200)
      res.end(echostr)
    }
  }

  private handleWechatMessage(
    req: http.IncomingMessage,
    url: URL,
    res: http.ServerResponse
  ): void {
    if (this.checkRateLimit(req, '/webhook/wechat')) {
      this.recordAnomaly(req, '/webhook/wechat', 429)
      res.writeHead(429)
      res.end('Too Many Requests')
      return
    }

    const clientIp = req.socket.remoteAddress || 'unknown'
    const inFlightKey = `/webhook/wechat:${clientIp}`
    if (!this.inFlightLimiter.tryAcquire(inFlightKey)) {
      this.recordAnomaly(req, '/webhook/wechat', 429)
      res.writeHead(429)
      res.end('Too Many Requests')
      return
    }

    const msgSignature = url.searchParams.get('msg_signature') || ''
    const timestamp = url.searchParams.get('timestamp') || ''
    const nonce = url.searchParams.get('nonce') || ''

    this.readBodyWithLimit(req, WEBHOOK_PREAUTH_MAX_BODY_BYTES, WEBHOOK_BODY_TIMEOUT_MS)
      .then(body => {
        if (body === null) {
          this.recordAnomaly(req, '/webhook/wechat', 413)
          res.writeHead(413)
          res.end('Payload Too Large')
          return
        }

        const wechatConfig = channelConfigStore.get('wechat')
        if (!wechatConfig) {
          res.writeHead(200)
          res.end('')
          return
        }

        const encryptedMsg = this.extractXmlEncrypt(body)

        const account = wechatChannelPlugin.findAccountBySignature(
          wechatConfig.accounts.filter(a => a.enabled),
          timestamp,
          nonce,
          encryptedMsg || body,
          msgSignature
        )

        if (!account) {
          this.recordAnomaly(req, '/webhook/wechat', 401)
          res.writeHead(200)
          res.end('')
          return
        }

        wechatChannelPlugin.handleWebhookEvent(account.id, encryptedMsg || body, {
          msg_signature: msgSignature,
          timestamp,
          nonce,
        })

        res.writeHead(200)
        res.end('')
      })
      .catch(() => {
        this.recordAnomaly(req, '/webhook/wechat', 500)
        res.writeHead(500)
        res.end('Error')
      })
      .finally(() => {
        this.inFlightLimiter.release(inFlightKey)
      })
  }

  private handleWhatsappVerification(
    req: http.IncomingMessage,
    url: URL,
    res: http.ServerResponse
  ): void {
    if (this.checkRateLimit(req, '/webhook/whatsapp')) {
      this.recordAnomaly(req, '/webhook/whatsapp', 429)
      res.writeHead(429)
      res.end('Too Many Requests')
      return
    }

    const mode = url.searchParams.get('hub.mode') || ''
    const challenge = url.searchParams.get('hub.challenge') || ''
    const verifyToken = url.searchParams.get('hub.verify_token') || ''

    const whatsappConfig = channelConfigStore.get('whatsapp')
    if (!whatsappConfig) {
      this.recordAnomaly(req, '/webhook/whatsapp', 401)
      res.writeHead(403)
      res.end('No whatsapp config')
      return
    }

    for (const account of whatsappConfig.accounts) {
      const expectedToken = account.credentials.webhookVerifyToken
      if (!expectedToken) continue
      const result = whatsappChannelPlugin.verifyWebhookMode(mode, challenge, verifyToken, expectedToken)
      if (result !== null) {
        res.writeHead(200)
        res.end(result)
        return
      }
    }

    this.recordAnomaly(req, '/webhook/whatsapp', 401)
    res.writeHead(403)
    res.end('Verification failed')
  }

  private handleWhatsappMessage(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (this.checkRateLimit(req, '/webhook/whatsapp')) {
      this.recordAnomaly(req, '/webhook/whatsapp', 429)
      res.writeHead(429)
      res.end('Too Many Requests')
      return
    }

    const clientIp = req.socket.remoteAddress || 'unknown'
    const inFlightKey = `/webhook/whatsapp:${clientIp}`
    if (!this.inFlightLimiter.tryAcquire(inFlightKey)) {
      this.recordAnomaly(req, '/webhook/whatsapp', 429)
      res.writeHead(429)
      res.end('Too Many Requests')
      return
    }

    this.readBodyWithLimit(req, WEBHOOK_PREAUTH_MAX_BODY_BYTES, WEBHOOK_BODY_TIMEOUT_MS)
      .then(body => {
        if (body === null) {
          this.recordAnomaly(req, '/webhook/whatsapp', 413)
          res.writeHead(413)
          res.end('Payload Too Large')
          return
        }

        try {
          const payload = JSON.parse(body)
          const whatsappConfig = channelConfigStore.get('whatsapp')
          if (whatsappConfig) {
            for (const account of whatsappConfig.accounts) {
              if (!account.enabled) continue
              whatsappChannelPlugin.handleWebhookEvent(account.id, payload)
            }
          }
        } catch {
          this.recordAnomaly(req, '/webhook/whatsapp', 400)
        }

        res.writeHead(200)
        res.end('EVENT_RECEIVED')
      })
      .catch(() => {
        this.recordAnomaly(req, '/webhook/whatsapp', 500)
        res.writeHead(500)
        res.end('Error')
      })
      .finally(() => {
        this.inFlightLimiter.release(inFlightKey)
      })
  }

  private readBodyWithLimit(
    req: http.IncomingMessage,
    maxBytes: number,
    timeoutMs: number
  ): Promise<string | null> {
    return new Promise((resolve, reject) => {
      let byteLength = 0
      const chunks: Buffer[] = []
      let settled = false

      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        req.destroy()
        reject(new Error('REQUEST_BODY_TIMEOUT'))
      }, timeoutMs)

      const cleanup = () => {
        clearTimeout(timer)
        req.removeListener('data', onData)
        req.removeListener('end', onEnd)
        req.removeListener('error', onError)
      }

      const onData = (chunk: Buffer) => {
        if (settled) return
        byteLength += chunk.length
        if (byteLength > maxBytes) {
          settled = true
          cleanup()
          req.destroy()
          resolve(null)
          return
        }
        chunks.push(chunk)
      }

      const onEnd = () => {
        if (settled) return
        settled = true
        cleanup()
        resolve(Buffer.concat(chunks).toString('utf8'))
      }

      const onError = (err: Error) => {
        if (settled) return
        settled = true
        cleanup()
        reject(err)
      }

      req.on('data', onData)
      req.on('end', onEnd)
      req.on('error', onError)
    })
  }

  private extractXmlEncrypt(xml: string): string | null {
    const match = xml.match(/<Encrypt><!\[CDATA\[(.*?)\]\]><\/Encrypt>/)
      || xml.match(/<Encrypt>(.*?)<\/Encrypt>/)
    return match ? match[1] : null
  }

  private recordAnomaly(req: http.IncomingMessage, path: string, statusCode: number): void {
    const clientIp = req.socket.remoteAddress || 'unknown'
    const key = `${path}:${clientIp}`
    this.anomalyTracker.record({
      key,
      statusCode,
      message: (count) => `[Webhook] Anomaly: ${path} from ${clientIp} - ${statusCode} (${count} times)`,
    })
  }

  private respondMethodNotAllowed(res: http.ServerResponse, allow: string[]): void {
    res.writeHead(405, { Allow: allow.join(', ') })
    res.end('Method Not Allowed')
  }
}

export const webhookServer = new WebhookServer()
