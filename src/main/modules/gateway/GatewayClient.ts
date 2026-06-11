/**
 * Gateway 客户端
 *
 * Electron 主进程中的 Gateway 客户端，负责：
 * 1. 启动/停止 Gateway 守护进程
 * 2. 通过 Unix Socket / Named Pipe 与 Gateway 通信
 * 3. 将 Gateway 通知转发给应用内部事件系统
 *
 * 架构优势（借鉴 OpenClaw）：
 * - Channel 连接在独立进程中运行，Electron 崩溃不影响消息收发
 * - Gateway 可独立重启，无需重启整个应用
 * - 未来可支持 Gateway 远程部署（云端运行，客户端远程连接）
 *
 * @module gateway/GatewayClient
 */

import { EventEmitter } from 'events'
import * as childProcess from 'child_process'
import * as net from 'net'
import * as path from 'path'
import { app } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
  GatewayMethodName,
  GatewayNotificationName,
  PingResult,
  GetStatusResult,
  ChannelListResult,
  ChannelConnectResult,
  ChannelDisconnectResult,
  ChannelSendMessageResult,
  ChannelGetStatusResult,
  ChannelGetAllStatusResult,
  ChannelAddAccountResult,
  ChannelRemoveAccountResult,
  ChannelUpdateAccountResult,
  ChannelGetSecretSchemaResult,
  ChannelValidateCredentialsResult,
  ChannelSetEnabledResult,
  ChannelGetConfigResult,
  ChannelGetAllConfigsResult,
  WebhookGetInfoResult,
  WebhookRestartResult,
  InboundMessageNotification,
  ConnectionStatusNotification,
  GatewayStatusNotification,
  GatewayErrorNotification,
  ChannelConnectParams,
  ChannelDisconnectParams,
  ChannelSendMessageParams,
  ChannelGetStatusParams,
  ChannelAddAccountParams,
  ChannelRemoveAccountParams,
  ChannelUpdateAccountParams,
  ChannelGetSecretSchemaParams,
  ChannelValidateCredentialsParams,
  ChannelSetEnabledParams,
  ChannelGetConfigParams,
} from '@shared/gateway/protocol'
import { GatewayMethod, GatewayNotification } from '@shared/gateway/protocol'

// ============================================
// Gateway 进程管理
// ============================================

type GatewayClientStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

class GatewayClient extends EventEmitter {
  private process: childProcess.ChildProcess | null = null
  private socket: net.Socket | null = null
  private status: GatewayClientStatus = 'disconnected'
  private requestId = 0
  private pendingRequests = new Map<string | number, {
    resolve: (value: unknown) => void
    reject: (reason: unknown) => void
    timer: ReturnType<typeof setTimeout>
  }>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private socketPath: string
  private gatewayScriptPath: string
  private startedAt = 0

  constructor() {
    super()
    this.socketPath = this.getSocketPath()
    this.gatewayScriptPath = this.getGatewayScriptPath()
  }

  // ============================================
  // 生命周期管理
  // ============================================

  /**
   * 启动 Gateway 守护进程并建立连接
   */
  async start(): Promise<void> {
    if (this.status === 'connected') return

    logger.gateway.info('[GatewayClient] Starting gateway...')

    try {
      // 1. 启动 Gateway 子进程
      await this.spawnGateway()

      // 2. 连接 Unix Socket
      await this.connectSocket()

      this.startedAt = Date.now()
      this.status = 'connected'
      this.emit('status-changed', 'connected')
      logger.gateway.info('[GatewayClient] Gateway connected')

    } catch (err) {
      this.status = 'error'
      this.emit('status-changed', 'error')
      logger.gateway.error(`[GatewayClient] Failed to start gateway: ${err}`)
      throw err
    }
  }

  /**
   * 停止 Gateway 守护进程
   */
  async stop(): Promise<void> {
    logger.gateway.info('[GatewayClient] Stopping gateway...')

    // 清理重连定时器
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    // 通知 Gateway 优雅关闭
    try {
      await this.request(GatewayMethod.SHUTDOWN, {}, 3000)
    } catch {
      // 忽略，Gateway 可能已经关闭
    }

    // 断开 Socket
    this.disconnectSocket()

    // 强制杀进程
    if (this.process && !this.process.killed) {
      this.process.kill('SIGTERM')
      setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.process.kill('SIGKILL')
        }
      }, 5000)
      this.process = null
    }

    this.status = 'disconnected'
    this.emit('status-changed', 'disconnected')
    logger.gateway.info('[GatewayClient] Gateway stopped')
  }

  /**
   * 获取 Gateway 状态
   */
  getStatus(): { status: GatewayClientStatus; uptime: number } {
    return {
      status: this.status,
      uptime: this.startedAt ? Date.now() - this.startedAt : 0,
    }
  }

  // ============================================
  // Channel 操作代理
  // ============================================

  async channelList(): Promise<ChannelListResult> {
    return this.request(GatewayMethod.CHANNEL_LIST, {})
  }

  async channelConnect(params: ChannelConnectParams): Promise<ChannelConnectResult> {
    return this.request(GatewayMethod.CHANNEL_CONNECT, params)
  }

  async channelDisconnect(params: ChannelDisconnectParams): Promise<ChannelDisconnectResult> {
    return this.request(GatewayMethod.CHANNEL_DISCONNECT, params)
  }

  async channelSendMessage(params: ChannelSendMessageParams): Promise<ChannelSendMessageResult> {
    return this.request(GatewayMethod.CHANNEL_SEND_MESSAGE, params)
  }

  async channelGetStatus(params: ChannelGetStatusParams): Promise<ChannelGetStatusResult> {
    return this.request(GatewayMethod.CHANNEL_GET_STATUS, params)
  }

  async channelGetAllStatus(): Promise<ChannelGetAllStatusResult> {
    return this.request(GatewayMethod.CHANNEL_GET_ALL_STATUS, {})
  }

  async channelAddAccount(params: ChannelAddAccountParams): Promise<ChannelAddAccountResult> {
    return this.request(GatewayMethod.CHANNEL_ADD_ACCOUNT, params)
  }

  async channelRemoveAccount(params: ChannelRemoveAccountParams): Promise<ChannelRemoveAccountResult> {
    return this.request(GatewayMethod.CHANNEL_REMOVE_ACCOUNT, params)
  }

  async channelUpdateAccount(params: ChannelUpdateAccountParams): Promise<ChannelUpdateAccountResult> {
    return this.request(GatewayMethod.CHANNEL_UPDATE_ACCOUNT, params)
  }

  async channelGetSecretSchema(params: ChannelGetSecretSchemaParams): Promise<ChannelGetSecretSchemaResult> {
    return this.request(GatewayMethod.CHANNEL_GET_SECRET_SCHEMA, params)
  }

  async channelValidateCredentials(params: ChannelValidateCredentialsParams): Promise<ChannelValidateCredentialsResult> {
    return this.request(GatewayMethod.CHANNEL_VALIDATE_CREDENTIALS, params)
  }

  async channelSetEnabled(params: ChannelSetEnabledParams): Promise<ChannelSetEnabledResult> {
    return this.request(GatewayMethod.CHANNEL_SET_ENABLED, params)
  }

  async channelGetConfig(params: ChannelGetConfigParams): Promise<ChannelGetConfigResult> {
    return this.request(GatewayMethod.CHANNEL_GET_CONFIG, params)
  }

  async channelGetAllConfigs(): Promise<ChannelGetAllConfigsResult> {
    return this.request(GatewayMethod.CHANNEL_GET_ALL_CONFIGS, {})
  }

  async webhookGetInfo(): Promise<WebhookGetInfoResult> {
    return this.request(GatewayMethod.WEBHOOK_GET_INFO, {})
  }

  async webhookRestart(): Promise<WebhookRestartResult> {
    return this.request(GatewayMethod.WEBHOOK_RESTART, {})
  }

  async ping(): Promise<PingResult> {
    return this.request(GatewayMethod.PING, {})
  }

  async getGatewayStatus(): Promise<GetStatusResult> {
    return this.request(GatewayMethod.GET_STATUS, {})
  }

  // ============================================
  // 进程管理（私有）
  // ============================================

  private async spawnGateway(): Promise<void> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now()

      this.process = childProcess.fork(this.gatewayScriptPath, [], {
        env: {
          ...process.env,
          GATEWAY_SOCKET_PATH: this.socketPath,
          GATEWAY_MODE: 'daemon',
        },
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      })

      this.process.on('error', (err) => {
        logger.gateway.error(`[GatewayClient] Gateway process error: ${err}`)
        reject(err)
      })

      this.process.on('exit', (code, signal) => {
        logger.gateway.info(`[GatewayClient] Gateway process exited: code=${code}, signal=${signal}`)
        this.process = null
        this.handleGatewayExit()
      })

      // 等待 Gateway 就绪信号
      const readyTimeout = setTimeout(() => {
        reject(new Error('Gateway startup timeout'))
      }, 15000)

      this.process.on('message', (msg: { type: string }) => {
        if (msg.type === 'gateway:ready') {
          clearTimeout(readyTimeout)
          logger.gateway.info(`[GatewayClient] Gateway process ready in ${Date.now() - startTime}ms`)
          resolve()
        }
      })
    })
  }

  private async connectSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket()
      let buffer = ''

      socket.connect(this.socketPath, () => {
        logger.gateway.info('[GatewayClient] Socket connected')
        resolve()
      })

      socket.on('data', (data) => {
        buffer += data.toString()
        // 按换行符分割 JSON-RPC 消息
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const response = JSON.parse(line) as JsonRpcResponse | JsonRpcNotification
            if ('id' in response && response.id !== null) {
              this.handleResponse(response as JsonRpcResponse)
            } else {
              this.handleNotification(response as JsonRpcNotification)
            }
          } catch (err) {
            logger.gateway.error(`[GatewayClient] Failed to parse message: ${err}`)
          }
        }
      })

      socket.on('error', (err) => {
        logger.gateway.error(`[GatewayClient] Socket error: ${err}`)
        if (this.status === 'connecting') {
          reject(err)
        }
        this.handleSocketError()
      })

      socket.on('close', () => {
        logger.gateway.info('[GatewayClient] Socket closed')
        this.handleSocketError()
      })

      this.socket = socket
    })
  }

  private disconnectSocket(): void {
    if (this.socket) {
      this.socket.destroy()
      this.socket = null
    }

    // 拒绝所有待处理的请求
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer)
      pending.reject(new Error('Connection closed'))
      this.pendingRequests.delete(id)
    }
  }

  // ============================================
  // JSON-RPC 通信（私有）
  // ============================================

  private request(method: GatewayMethodName, params: unknown, timeout = 10000): Promise<any> {
    return new Promise((resolve, reject) => {
      if (this.status !== 'connected' || !this.socket) {
        reject(new Error('Gateway not connected'))
        return
      }

      const id = ++this.requestId
      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      }

      const timer = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`Request timeout: ${method}`))
      }, timeout)

      this.pendingRequests.set(id, { resolve, reject, timer })

      try {
        this.socket.write(JSON.stringify(request) + '\n')
      } catch (err) {
        clearTimeout(timer)
        this.pendingRequests.delete(id)
        reject(new Error(`Failed to send request: ${err}`))
      }
    })
  }

  private handleResponse(response: JsonRpcResponse): void {
    const pending = this.pendingRequests.get(response.id!)
    if (!pending) return

    clearTimeout(pending.timer)
    this.pendingRequests.delete(response.id!)

    if (response.error) {
      pending.reject(new Error(`Gateway error [${response.error.code}]: ${response.error.message}`))
    } else {
      pending.resolve(response.result)
    }
  }

  private handleNotification(notification: JsonRpcNotification): void {
    switch (notification.method as GatewayNotificationName) {
      case GatewayNotification.INBOUND_MESSAGE:
        this.emit('inbound-message', notification.params as InboundMessageNotification)
        break
      case GatewayNotification.CONNECTION_STATUS_CHANGED:
        this.emit('connection-status-changed', notification.params as ConnectionStatusNotification)
        break
      case GatewayNotification.GATEWAY_STATUS_CHANGED:
        this.emit('gateway-status-changed', notification.params as GatewayStatusNotification)
        break
      case GatewayNotification.GATEWAY_ERROR:
        this.emit('gateway-error', notification.params as GatewayErrorNotification)
        break
    }
  }

  // ============================================
  // 错误处理与重连（私有）
  // ============================================

  private handleGatewayExit(): void {
    if (this.status === 'disconnected') return

    logger.gateway.warn('[GatewayClient] Gateway process exited unexpectedly, scheduling reconnect...')
    this.disconnectSocket()
    this.status = 'error'
    this.emit('status-changed', 'error')

    // 5 秒后自动重连
    this.reconnectTimer = setTimeout(() => {
      this.start().catch(err => {
        logger.gateway.error(`[GatewayClient] Reconnect failed: ${err}`)
      })
    }, 5000)
  }

  private handleSocketError(): void {
    if (this.status === 'disconnected') return

    this.disconnectSocket()
    this.status = 'error'
    this.emit('status-changed', 'error')

    // 3 秒后尝试重连 Socket
    this.reconnectTimer = setTimeout(() => {
      this.connectSocket().then(() => {
        this.status = 'connected'
        this.emit('status-changed', 'connected')
      }).catch(err => {
        logger.gateway.error(`[GatewayClient] Socket reconnect failed: ${err}`)
      })
    }, 3000)
  }

  // ============================================
  // 路径工具（私有）
  // ============================================

  private getSocketPath(): string {
    const userDataPath = app.getPath('userData')
    if (process.platform === 'win32') {
      return `\\\\.\\pipe\\aweeclaw-gateway-${app.getVersion()}`
    }
    return path.join(userDataPath, 'gateway.sock')
  }

  private getGatewayScriptPath(): string {
    // Gateway 入口脚本路径（编译后）
    const appPath = app.getAppPath()
    return path.join(appPath, 'main', 'gateway', 'index.js')
  }
}

/** 全局 Gateway 客户端实例 */
export const gatewayClient = new GatewayClient()
