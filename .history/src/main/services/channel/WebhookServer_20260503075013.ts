import * as http from 'http'
import * as crypto from 'crypto'
import { logger } from '@shared/utils/Logger'
import { wechatChannelPlugin } from './adapters/WechatChannelPlugin'
import { whatsappChannelPlugin } from './adapters/WhatsAppChannelPlugin'
import { channelConfigStore } from './ChannelConfigStore'

const DEFAULT_WEBHOOK_PORT = 3456

class WebhookServer {
  private server: http.Server | null = null
  private port: number = DEFAULT_WEBHOOK_PORT
  private running = false

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

    if (path === '/webhook/wechat' && req.method === 'GET') {
      this.handleWechatVerification(url, res)
      return
    }

    if (path === '/webhook/wechat' && req.method === 'POST') {
      this.handleWechatMessage(req, url, res)
      return
    }

    if (path === '/webhook/whatsapp' && req.method === 'GET') {
      this.handleWhatsappVerification(url, res)
      return
    }

    if (path === '/webhook/whatsapp' && req.method === 'POST') {
      this.handleWhatsappMessage(req, res)
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

  private handleWechatVerification(url: URL, res: http.ServerResponse): void {
    const msgSignature = url.searchParams.get('msg_signature') || ''
    const timestamp = url.searchParams.get('timestamp') || ''
    const nonce = url.searchParams.get('nonce') || ''
    const echostr = url.searchParams.get('echostr') || ''

    const wechatConfig = channelConfigStore.get('wechat')
    if (!wechatConfig) {
      res.writeHead(403)
      res.end('No wechat config')
      return
    }

    for (const account of wechatConfig.accounts) {
      const token = account.credentials.token
      if (!token) continue

      const valid = wechatChannelPlugin.verifyCallbackSignature(
        token, timestamp, nonce, echostr, msgSignature
      )
      if (valid) {
        try {
          const encodingAesKey = account.credentials.encodingAesKey || ''
          if (encodingAesKey) {
            const aesKey = Buffer.from(encodingAesKey + '=', 'base64')
            const iv = aesKey.subarray(0, 16)
            const decipher = crypto.createDecipheriv('aes-256-cbc', aesKey, iv)
            decipher.setAutoPadding(false)
            let decrypted = decipher.update(echostr, 'base64', 'utf8')
            decrypted += decipher.final('utf8')
            const pad = decrypted.charCodeAt(decrypted.length - 1)
            decrypted = decrypted.substring(0, decrypted.length - pad)
            const contentLen = decrypted.charCodeAt(16) << 24
              | decrypted.charCodeAt(17) << 16
              | decrypted.charCodeAt(18) << 8
              | decrypted.charCodeAt(19)
            const replyEchostr = decrypted.substring(20, 20 + contentLen)
            res.writeHead(200)
            res.end(replyEchostr)
          } else {
            res.writeHead(200)
            res.end(echostr)
          }
          return
        } catch {
          res.writeHead(200)
          res.end(echostr)
          return
        }
      }
    }

    res.writeHead(403)
    res.end('Verification failed')
  }

  private handleWechatMessage(req: http.IncomingMessage, url: URL, res: http.ServerResponse): void {
    const msgSignature = url.searchParams.get('msg_signature') || ''
    const timestamp = url.searchParams.get('timestamp') || ''
    const nonce = url.searchParams.get('nonce') || ''

    this.readBody(req).then(body => {
      const wechatConfig = channelConfigStore.get('wechat')
      if (!wechatConfig) {
        res.writeHead(200)
        res.end('')
        return
      }

      for (const account of wechatConfig.accounts) {
        if (!account.enabled) continue
        const token = account.credentials.token
        if (!token) continue

        const valid = wechatChannelPlugin.verifyCallbackSignature(
          token, timestamp, nonce, body, msgSignature
        )
        if (valid) {
          wechatChannelPlugin.handleWebhookEvent(account.id, body, {
            msg_signature: msgSignature,
            timestamp,
            nonce,
          })
          break
        }
      }

      res.writeHead(200)
      res.end('')
    }).catch(() => {
      res.writeHead(500)
      res.end('Error')
    })
  }

  private handleWhatsappVerification(url: URL, res: http.ServerResponse): void {
    const mode = url.searchParams.get('hub.mode') || ''
    const challenge = url.searchParams.get('hub.challenge') || ''
    const verifyToken = url.searchParams.get('hub.verify_token') || ''

    const whatsappConfig = channelConfigStore.get('whatsapp')
    if (!whatsappConfig) {
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

    res.writeHead(403)
    res.end('Verification failed')
  }

  private handleWhatsappMessage(req: http.IncomingMessage, res: http.ServerResponse): void {
    this.readBody(req).then(body => {
      try {
        const payload = JSON.parse(body)
        const whatsappConfig = channelConfigStore.get('whatsapp')
        if (whatsappConfig) {
          for (const account of whatsappConfig.accounts) {
            if (!account.enabled) continue
            whatsappChannelPlugin.handleWebhookEvent(account.id, payload)
          }
        }
      } catch {}

      res.writeHead(200)
      res.end('EVENT_RECEIVED')
    }).catch(() => {
      res.writeHead(500)
      res.end('Error')
    })
  }

  private readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      req.on('error', reject)
    })
  }
}

export const webhookServer = new WebhookServer()
