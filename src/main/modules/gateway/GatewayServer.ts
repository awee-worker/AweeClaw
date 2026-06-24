/**
 * Gateway 服务端
 *
 * 独立 Node.js 守护进程，负责：
 * 1. 管理所有 Channel 连接（WebSocket / Webhook）
 * 2. 消息收发与路由
 * 3. Webhook 服务器
 * 4. 通过 Unix Socket 接受 Electron 客户端的 JSON-RPC 请求
 *
 * 生命周期：
 * - 由 GatewayClient 通过 child_process.fork() 启动
 * - 通过 process.send('gateway:ready') 通知客户端就绪
 * - 通过 Unix Socket 接收 JSON-RPC 请求
 * - 通过 JSON-RPC Notification 推送事件给客户端
 *
 * @module gateway/GatewayServer
 */

import * as net from 'net'
import * as fs from 'fs'
import * as path from 'path'
import { logger } from '@shared/toolkit/LogEngine'
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  GatewayMethodName,
} from '@shared/gateway/protocol'
import { GatewayMethod } from '@shared/gateway/protocol'

// ============================================
// Gateway 服务端
// ============================================

class GatewayServer {
  private server: net.Server | null = null
  private clients = new Set<net.Socket>()
  private startedAt = 0
  private socketPath: string

  constructor() {
    this.socketPath = process.env.GATEWAY_SOCKET_PATH || this.getDefaultSocketPath()
  }

  /**
   * 启动 Gateway 服务
   */
  async start(): Promise<void> {
    this.startedAt = Date.now()
    logger.gateway.info('[GatewayServer] Starting...')

    // 清理旧的 Socket 文件
    if (fs.existsSync(this.socketPath)) {
      try { fs.unlinkSync(this.socketPath) } catch { /* ignore */ }
    }

    // 创建 Unix Socket 服务器
    await this.createServer()

    // 通知父进程就绪
    if (process.send) {
      process.send({ type: 'gateway:ready' })
    }

    logger.gateway.info(`[GatewayServer] Listening on ${this.socketPath}`)
  }

  /**
   * 停止 Gateway 服务
   */
  async stop(): Promise<void> {
    logger.gateway.info('[GatewayServer] Stopping...')

    // 关闭所有客户端连接
    for (const client of this.clients) {
      client.destroy()
    }
    this.clients.clear()

    // 关闭服务器
    if (this.server) {
      await new Promise<void>(resolve => {
        this.server!.close(() => resolve())
      })
      this.server = null
    }

    // 清理 Socket 文件
    if (fs.existsSync(this.socketPath)) {
      try { fs.unlinkSync(this.socketPath) } catch { /* ignore */ }
    }

    logger.gateway.info('[GatewayServer] Stopped')
  }

  // ============================================
  // 服务器创建与连接管理（私有）
  // ============================================

  private createServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => {
        this.handleConnection(socket)
      })

      this.server.on('error', (err) => {
        logger.gateway.error(`[GatewayServer] Server error: ${err}`)
        reject(err)
      })

      this.server.listen(this.socketPath, () => {
        resolve()
      })
    })
  }

  private handleConnection(socket: net.Socket): void {
    this.clients.add(socket)
    logger.gateway.info(`[GatewayServer] Client connected (total: ${this.clients.size})`)

    let buffer = ''

    socket.on('data', (data) => {
      buffer += data.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const request = JSON.parse(line) as JsonRpcRequest
          this.handleRequest(socket, request)
        } catch (err) {
          logger.gateway.error(`[GatewayServer] Invalid request: ${err}`)
          this.sendResponse(socket, {
            jsonrpc: '2.0',
            id: null,
            error: { code: -32700, message: 'Parse error' },
          })
        }
      }
    })

    socket.on('close', () => {
      this.clients.delete(socket)
      logger.gateway.info(`[GatewayServer] Client disconnected (total: ${this.clients.size})`)
    })

    socket.on('error', (err) => {
      logger.gateway.error(`[GatewayServer] Client socket error: ${err}`)
      this.clients.delete(socket)
    })
  }

  // ============================================
  // 请求处理（私有）
  // ============================================

  private async handleRequest(socket: net.Socket, request: JsonRpcRequest): Promise<void> {
    try {
      const result = await this.dispatch(request.method as GatewayMethodName, request.params)
      this.sendResponse(socket, {
        jsonrpc: '2.0',
        id: request.id,
        result,
      })
    } catch (err) {
      this.sendResponse(socket, {
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32000,
          message: err instanceof Error ? err.message : String(err),
        },
      })
    }
  }

  /**
   * 请求分发——根据方法名路由到对应处理器
   */
  private async dispatch(method: GatewayMethodName, params: unknown): Promise<unknown> {
    switch (method) {
      // 生命周期
      case GatewayMethod.PING:
        return { pong: true, uptime: Date.now() - this.startedAt, version: '1.0.0' }

      case GatewayMethod.SHUTDOWN:
        // 异步关闭，先返回响应
        setTimeout(() => this.stop(), 100)
        return { success: true }

      case GatewayMethod.GET_STATUS:
        return this.getGatewayStatus()

      // Channel 操作——委托给 ChannelService
      case GatewayMethod.CHANNEL_LIST:
        return this.channelList()

      case GatewayMethod.CHANNEL_CONNECT:
        return this.channelConnect(params as any)

      case GatewayMethod.CHANNEL_DISCONNECT:
        return this.channelDisconnect(params as any)

      case GatewayMethod.CHANNEL_SEND_MESSAGE:
        return this.channelSendMessage(params as any)

      case GatewayMethod.CHANNEL_GET_STATUS:
        return this.channelGetStatus(params as any)

      case GatewayMethod.CHANNEL_GET_ALL_STATUS:
        return this.channelGetAllStatus()

      case GatewayMethod.CHANNEL_ADD_ACCOUNT:
        return this.channelAddAccount(params as any)

      case GatewayMethod.CHANNEL_REMOVE_ACCOUNT:
        return this.channelRemoveAccount(params as any)

      case GatewayMethod.CHANNEL_UPDATE_ACCOUNT:
        return this.channelUpdateAccount(params as any)

      case GatewayMethod.CHANNEL_GET_SECRET_SCHEMA:
        return this.channelGetSecretSchema(params as any)

      case GatewayMethod.CHANNEL_VALIDATE_CREDENTIALS:
        return this.channelValidateCredentials(params as any)

      case GatewayMethod.CHANNEL_SET_ENABLED:
        return this.channelSetEnabled(params as any)

      case GatewayMethod.CHANNEL_GET_CONFIG:
        return this.channelGetConfig(params as any)

      case GatewayMethod.CHANNEL_GET_ALL_CONFIGS:
        return this.channelGetAllConfigs()

      // Webhook
      case GatewayMethod.WEBHOOK_GET_INFO:
        return this.webhookGetInfo()

      case GatewayMethod.WEBHOOK_RESTART:
        return this.webhookRestart()

      default:
        throw new Error(`Unknown method: ${method}`)
    }
  }

  // ============================================
  // Channel 操作实现（委托给 ChannelService）
  // ============================================

  // 注意：GatewayServer 运行在独立进程中，无法直接访问 Electron 主进程的 ChannelService。
  // Channel 操作有两种模式：
  // 1. 内嵌模式（默认）：ChannelService 在 Electron 主进程中运行，GatewayServer 不处理 Channel 请求
  // 2. Gateway 模式：Channel 连接在 Gateway 进程中管理（需要独立初始化 Channel 适配器）
  // 当前仅实现内嵌模式，Gateway 模式下的 Channel 操作返回 not-available 提示

  private getGatewayStatus() {
    const memUsage = process.memoryUsage()
    return {
      running: true,
      uptime: Date.now() - this.startedAt,
      channels: [],
      webhook: { running: false, port: 0 },
      memoryUsage: {
        rss: memUsage.rss,
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
      },
    }
  }

  private async channelList() {
    // TODO: 委托给 Gateway 内部的 ChannelService
    return { channels: [] }
  }

  private async channelConnect(_params: { channelId: string; accountId: string }) {
    // TODO: 委托给 ChannelService.connectAccount
    return { success: false, error: 'Not implemented in gateway mode' }
  }

  private async channelDisconnect(_params: { channelId: string; accountId: string }) {
    return { success: false, error: 'Not implemented in gateway mode' }
  }

  private async channelSendMessage(_params: any) {
    return { success: false, error: 'Not implemented in gateway mode' }
  }

  private async channelGetStatus(params: { channelId: string; accountId: string }) {
    return { accountId: params.accountId, name: '', enabled: false, status: 'disconnected', connected: false, lastConnectedAt: null, lastError: null }
  }

  private async channelGetAllStatus() {
    return { statuses: [] }
  }

  private async channelAddAccount(_params: any) {
    return { success: false, error: 'Not implemented in gateway mode' }
  }

  private async channelRemoveAccount(_params: any) {
    return { success: false, error: 'Not implemented in gateway mode' }
  }

  private async channelUpdateAccount(_params: any) {
    return { success: false, error: 'Not implemented in gateway mode' }
  }

  private async channelGetSecretSchema(_params: { channelId: string }) {
    return { schema: [] }
  }

  private async channelValidateCredentials(_params: { channelId: string; credentials: Record<string, string> }) {
    return { valid: false, error: 'Not implemented in gateway mode' }
  }

  private async channelSetEnabled(_params: { channelId: string; enabled: boolean }) {
    return { success: false }
  }

  private async channelGetConfig(_params: { channelId: string }) {
    return { config: null }
  }

  private async channelGetAllConfigs() {
    return { configs: [] }
  }

  private async webhookGetInfo() {
    return { running: false, port: 0, url: '' }
  }

  private async webhookRestart() {
    return { success: false, port: 0, error: 'Not implemented in gateway mode' }
  }

  // ============================================
  // 通知推送（私有）
  // ============================================

  private sendResponse(socket: net.Socket, response: JsonRpcResponse): void {
    try {
      socket.write(JSON.stringify(response) + '\n')
    } catch (err) {
      logger.gateway.error(`[GatewayServer] Failed to send response: ${err}`)
    }
  }

  private getDefaultSocketPath(): string {
    const tmpDir = process.platform === 'win32' ? '\\\\.\\pipe\\' : '/tmp'
    return path.join(tmpDir, `aweeclaw-gateway-${Date.now()}.sock`)
  }
}

// ============================================
// 启动入口
// ============================================

const server = new GatewayServer()

server.start().catch(err => {
  logger.gateway.error(`[GatewayServer] Fatal error: ${err}`)
  process.exit(1)
})

// 优雅关闭
process.on('SIGTERM', () => {
  server.stop().then(() => process.exit(0))
})

process.on('SIGINT', () => {
  server.stop().then(() => process.exit(0))
})

process.on('uncaughtException', (err) => {
  logger.gateway.error(`[GatewayServer] Uncaught exception: ${err}`)
})

process.on('unhandledRejection', (reason) => {
  logger.gateway.error(`[GatewayServer] Unhandled rejection: ${reason}`)
})
