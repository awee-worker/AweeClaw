/**
 * DeviceLinkClient — 桌面客户端 ↔ 后端 WebSocket 长连接
 *
 * 端点：{serverUrl}/api/v1/devices/ws?token=<>&deviceId=<>&name=<>...
 *
 * 协议：
 * - 心跳：每 15s 发送 {type:'ping'}，后端回 {type:'pong'}，同时续期在线状态
 * - RPC 响应：后端 → 桌面端的请求带 rpcId，桌面端执行后回 {rpcId, payload?, error?}
 * - 主动事件上报：桌面端 → 后端 {type:'event.<Type>', deviceId, payload, timestamp}
 *
 * 重连策略：
 * - 断线后 5s 自动重连，指数退避（最多 30s）
 * - 最多连续失败 10 次，超过后停止（需用户主动重新登录或重启应用）
 * - 凭据失效（鉴权失败）时立即停止，等 renderer 推送新 token
 *
 * @module device-link/DeviceLinkClient
 */
import { app, BrowserWindow } from 'electron'
import WebSocket from 'ws'
import { logger } from '@shared/toolkit/LogEngine'
import { credentialsHolder, type DeviceLinkCredentials } from './DeviceLinkCredentials'
import { getOrCreateDeviceId } from './DeviceLinkId'
import {
  handleWorkspaceTree,
  handleWorkspaceFile,
  handleWorkspaceSearch,
  handleWorkspaceDownload,
  handleWorkspaceUpload,
  handleClipboardPush,
  handleCommand,
  handleScreenshot,
  handlePowerControl,
  handleTaskTransferPull,
  handleTaskTransferDeliver,
  handleKnowledgeExport,
  handleChatExport,
  type DeviceHandlerContext,
  type DeviceLinkPreferences,
} from './DeviceLinkHandlers'
import { deviceLinkEventBridge } from './DeviceLinkEventBridge'
import type Store from 'electron-store'

const HEARTBEAT_INTERVAL_MS = 15000
const INITIAL_RECONNECT_DELAY_MS = 5000
const MAX_RECONNECT_DELAY_MS = 30000
const MAX_RECONNECT_ATTEMPTS = 10
const RECONNECT_BACKOFF_FACTOR = 1.5

const PREFERENCES_KEY = 'deviceLink'

/**
 * 设备联动客户端
 *
 * 单例：在 app ready 后由 bootstrap/moduleInitializer 创建并启动
 */
class DeviceLinkClient {
  private ws: WebSocket | null = null
  private heartbeatTimer: NodeJS.Timeout | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private reconnectAttempts = 0
  private isStarted = false
  private deviceId: string
  private isConnecting = false
  private getMainWindow: () => BrowserWindow | null
  private configStore: Store<Record<string, unknown>>
  private resolveWorkspaceRoot: () => string | null

  constructor(opts: {
    configStore: Store<Record<string, unknown>>
    getMainWindow: () => BrowserWindow | null
    resolveWorkspaceRoot: () => string | null
  }) {
    this.configStore = opts.configStore
    this.getMainWindow = opts.getMainWindow
    this.resolveWorkspaceRoot = opts.resolveWorkspaceRoot
    this.deviceId = getOrCreateDeviceId(opts.configStore)
    logger.deviceLink.info(`[Client] Device ID: ${this.deviceId}`)
  }

  // ===========================================================================
  // 生命周期
  // ===========================================================================

  /**
   * 启动：检查凭据，若有则连接
   */
  start(): void {
    if (this.isStarted) return
    this.isStarted = true
    logger.deviceLink.info('[Client] Starting')
    this.tryConnect()
  }

  /**
   * 停止：关闭连接 + 清理定时器
   * 用于应用退出或用户登出
   */
  stop(): void {
    this.isStarted = false
    this.cleanupTimers()
    if (this.ws) {
      try {
        this.ws.removeAllListeners()
        if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
          this.ws.close(1000, 'client_shutdown')
        }
      } catch { /* ignore */ }
      this.ws = null
    }
    deviceLinkEventBridge.pushConnectivity('offline', 'client_stopped')
    logger.deviceLink.info('[Client] Stopped')
  }

  /**
   * 凭据更新（renderer 推送或刷新 token 时调用）
   * 若已在连接中，会重启用新 token
   *
   * 注：creds 已由调用方写入 credentialsHolder，此处只触发重连；
   *     tryConnect 会从 holder 读取最新值。
   */
  onCredentialsUpdated(_creds: DeviceLinkCredentials): void {
    const wasConnected = this.ws?.readyState === WebSocket.OPEN
    logger.deviceLink.info('[Client] Credentials updated, reconnecting', { wasConnected })
    if (wasConnected) {
      // 关闭旧连接，下一轮 connect 用新 token
      try { this.ws?.close(4001, 'credentials_refresh') } catch { /* ignore */ }
    }
    this.reconnectAttempts = 0
    this.tryConnect()
  }

  /**
   * 凭据清除（用户登出）
   */
  onCredentialsCleared(): void {
    logger.deviceLink.info('[Client] Credentials cleared, stopping')
    this.cleanupTimers()
    if (this.ws) {
      try { this.ws.close(1000, 'logout') } catch { /* ignore */ }
      this.ws = null
    }
    this.reconnectAttempts = 0
  }

  /** 设备 ID（用于诊断、设置界面展示） */
  getDeviceId(): string {
    return this.deviceId
  }

  /** WebSocket 是否已连接（供 IPC get-status 查询） */
  isConnected(): boolean {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN
  }

  /** 当前重连次数（供 IPC get-status 查询） */
  getReconnectAttempts(): number {
    return this.reconnectAttempts
  }

  // ===========================================================================
  // 连接管理
  // ===========================================================================

  private tryConnect(): void {
    if (!this.isStarted) return
    if (this.isConnecting) return
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
      return
    }

    const creds = credentialsHolder.get()
    if (!creds?.accessToken || !creds?.serverUrl) {
      logger.deviceLink.debug('[Client] No valid credentials, skipping connect')
      return
    }
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      logger.deviceLink.warn(
        `[Client] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached, giving up until next credentials update`,
      )
      deviceLinkEventBridge.pushConnectivity('error', 'max_reconnect_reached')
      return
    }

    this.isConnecting = true
    deviceLinkEventBridge.pushConnectivity('connecting', `attempt=${this.reconnectAttempts + 1}`)
    this.connect(creds).catch((err) => {
      logger.deviceLink.error(`[Client] Connect failed: ${err?.message || err}`)
      this.isConnecting = false
      deviceLinkEventBridge.pushConnectivity('error', err?.message || 'connect_failed')
      this.scheduleReconnect()
    })
  }

  private connect(creds: DeviceLinkCredentials): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = this.buildWsUrl(creds)
      logger.deviceLink.info(`[Client] Connecting to ${url.replace(/token=[^&]+/, 'token=***')}`)

      let ws: WebSocket
      try {
        ws = new WebSocket(url, {
          handshakeTimeout: 15000,
          maxPayload: 16 * 1024 * 1024, // 16MB（截图等大消息）
        })
      } catch (err) {
        return reject(err)
      }

      ws.once('open', () => {
        this.isConnecting = false
        this.reconnectAttempts = 0
        this.ws = ws
        this.attachMessageHandlers(ws)
        this.startHeartbeat()
        logger.deviceLink.info('[Client] WebSocket connected')
        deviceLinkEventBridge.pushConnectivity('online', 'connected')
        resolve()
      })

      ws.once('error', (err: Error) => {
        this.isConnecting = false
        reject(err)
      })

      ws.once('close', (code, reason) => {
        this.isConnecting = false
        const reasonStr = reason?.toString() || ''
        logger.deviceLink.info(`[Client] WebSocket closed: code=${code} reason=${reasonStr}`)
        deviceLinkEventBridge.pushConnectivity('offline', `code=${code} reason=${reasonStr}`)
        // 4001 凭据刷新、1000 用户登出 → 不重连
        if (code === 4001 || code === 1000) return
        // 4003 鉴权失败 → 不重连（等新 token）
        if (code === 4003) {
          logger.deviceLink.warn('[Client] Auth failed, stopping until new credentials')
          deviceLinkEventBridge.pushConnectivity('error', 'auth_failed')
          return
        }
        this.scheduleReconnect()
      })

      // 设置连接超时
      setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          try { ws.terminate() } catch { /* ignore */ }
          reject(new Error('connect_timeout'))
        }
      }, 15000)
    })
  }

  private scheduleReconnect(): void {
    if (!this.isStarted) return
    if (this.reconnectTimer) return

    this.reconnectAttempts += 1
    if (this.reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      logger.deviceLink.warn(`[Client] Reconnect attempts exhausted (${this.reconnectAttempts})`)
      return
    }

    const delay = Math.min(
      INITIAL_RECONNECT_DELAY_MS * Math.pow(RECONNECT_BACKOFF_FACTOR, this.reconnectAttempts - 1),
      MAX_RECONNECT_DELAY_MS,
    )
    logger.deviceLink.info(`[Client] Reconnect scheduled in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts})`)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.tryConnect()
    }, delay)
  }

  private cleanupTimers(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  // ===========================================================================
  // 心跳
  // ===========================================================================

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this.sendRaw({ type: 'ping' })
    }, HEARTBEAT_INTERVAL_MS)
  }

  // ===========================================================================
  // 消息处理
  // ===========================================================================

  private attachMessageHandlers(ws: WebSocket): void {
    ws.on('message', (raw: WebSocket.RawData, isBinary: boolean) => {
      void this.handleMessage(raw, isBinary).catch((err) => {
        logger.deviceLink.error(`[Client] Message handler threw: ${err?.stack || err}`)
      })
    })
    ws.on('pong', () => {
      logger.deviceLink.debug('[Client] Received pong (ws-level)')
    })
  }

  private async handleMessage(raw: WebSocket.RawData, _isBinary: boolean): Promise<void> {
    const text = raw.toString()
    let msg: any
    try {
      msg = JSON.parse(text)
    } catch {
      logger.deviceLink.warn(`[Client] Invalid JSON received: ${text.substring(0, 200)}`)
      return
    }

    // 心跳响应（后端发的 pong）
    if (msg?.type === 'pong') {
      return
    }

    // RPC 请求：必须带 rpcId 和 type
    if (msg?.rpcId && msg?.type) {
      await this.handleRpc(msg)
      return
    }

    // 任务接续下行（后端推送会话上下文到目标设备）
    if (msg?.type === 'task.transfer.deliver') {
      await this.handleTaskTransferDeliverMessage(msg)
      return
    }

    // 方向4：场景模式同步（移动端→PC）
    if (msg?.type === 'scene_mode.sync') {
      const mode = String(msg?.mode ?? '')
      if (mode) {
        logger.deviceLink.info(`[Client] Received scene mode sync from mobile: ${mode}`)
        const win = this.getMainWindow()
        if (win && !win.isDestroyed()) {
          win.webContents.send('device-link:scene-mode-sync', { mode })
        }
      }
      return
    }

    logger.deviceLink.debug(`[Client] Unhandled message type: ${msg?.type}`)
  }

  /**
   * RPC 请求分发
   */
  private async handleRpc(req: { rpcId: string; type: string; [k: string]: unknown }): Promise<void> {
    const ctx = this.buildHandlerContext()
    let payload: unknown
    try {
      switch (req.type) {
        case 'workspace.tree.req':
          payload = await handleWorkspaceTree(ctx, { path: String(req.path ?? '') })
          break
        case 'workspace.file.req':
          payload = await handleWorkspaceFile(ctx, { path: String(req.path ?? '') })
          break
        case 'workspace.search.req':
          payload = await handleWorkspaceSearch(ctx, { keyword: String(req.keyword ?? '') })
          break
        case 'workspace.download.req':
          payload = await handleWorkspaceDownload(ctx, { path: String(req.path ?? '') })
          break
        case 'workspace.upload.req':
          payload = await handleWorkspaceUpload(ctx, {
            uploadUrl: String(req.uploadUrl ?? ''),
            targetDir: String(req.targetDir ?? ''),
            fileName: String(req.fileName ?? ''),
            overwrite: Boolean(req.overwrite),
          })
          break
        case 'clipboard.push.req':
          payload = await handleClipboardPush(ctx, req.payload as any)
          break
        case 'command.req':
          payload = await handleCommand(ctx, req.cmd as any)
          break
        case 'screenshot.req':
          payload = await handleScreenshot(ctx)
          break
        case 'power.control.req':
          payload = await handlePowerControl(ctx, { action: String(req.action) as any })
          break
        case 'task.transfer.req':
          // 作为源设备：导出会话上下文
          payload = await handleTaskTransferPull(ctx, { threadId: String(req.threadId ?? '') })
          break
        case 'knowledge.export.req':
          payload = await handleKnowledgeExport(ctx)
          break
        case 'chat.export.req':
          payload = await handleChatExport(ctx)
          break
        default:
          throw new Error(`unsupported_rpc_type: ${req.type}`)
      }
      this.sendRaw({ rpcId: req.rpcId, payload })
    } catch (err: any) {
      const code = err?.message || 'internal_error'
      logger.deviceLink.warn(`[Client] RPC ${req.type} failed: ${code}`)
      this.sendRaw({ rpcId: req.rpcId, error: code })
    }
  }

  private async handleTaskTransferDeliverMessage(msg: any): Promise<void> {
    try {
      await handleTaskTransferDeliver(this.buildHandlerContext(), {
        fromDeviceId: String(msg.fromDeviceId ?? ''),
        threadId: String(msg.threadId ?? ''),
        snippet: String(msg.snippet ?? ''),
      })
      // 通知 renderer 加载会话（让前端 UI 切换到对应 threadId）
      const win = this.getMainWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send('device-link:task-transfer', {
          fromDeviceId: msg.fromDeviceId,
          threadId: msg.threadId,
          snippet: msg.snippet,
        })
      }
    } catch (err: any) {
      logger.deviceLink.warn(`[Client] Task transfer deliver failed: ${err.message}`)
    }
  }

  // ===========================================================================
  // 上下文与工具
  // ===========================================================================

  private buildHandlerContext(): DeviceHandlerContext {
    return {
      resolveWorkspaceRoot: this.resolveWorkspaceRoot,
      preferences: () => this.loadPreferences(),
      getMainWindow: this.getMainWindow,
    }
  }

  private loadPreferences(): DeviceLinkPreferences {
    const data = this.configStore.get(PREFERENCES_KEY) as DeviceLinkPreferences | undefined
    return {
      allowRemoteCommand: data?.allowRemoteCommand ?? false,
      allowClipboardPush: data?.allowClipboardPush ?? true,
      allowScreenshot: data?.allowScreenshot ?? true,
      allowPowerControl: data?.allowPowerControl ?? false,
    }
  }

  /** 更新偏好（设置界面调用） */
  updatePreferences(patch: Partial<DeviceLinkPreferences>): void {
    const current = this.loadPreferences()
    const next = { ...current, ...patch }
    this.configStore.set(PREFERENCES_KEY, next)
    logger.deviceLink.info('[Client] Preferences updated', patch)
  }

  private buildWsUrl(creds: DeviceLinkCredentials): string {
    const base = creds.serverUrl.replace(/\/+$/, '').replace(/^http/, 'ws')
    const params = new URLSearchParams({
      token: creds.accessToken,
      deviceId: this.deviceId,
      name: creds.deviceName || 'Desktop',
      os: this.detectOs(),
      osVersion: this.detectOsVersion(),
      appVersion: app.getVersion(),
      type: 'desktop',
    })
    if (creds.workspacePath) params.set('workspacePath', creds.workspacePath)
    if (creds.workspaceName) params.set('workspaceName', creds.workspaceName)
    return `${base}/api/v1/devices/ws?${params.toString()}`
  }

  private detectOs(): string {
    switch (process.platform) {
      case 'darwin': return 'macos'
      case 'win32': return 'windows'
      case 'linux': return 'linux'
      default: return 'unknown'
    }
  }

  private detectOsVersion(): string {
    const sysVer = typeof process.getSystemVersion === 'function' ? process.getSystemVersion() : ''
    return sysVer || process.version || ''
  }

  /**
   * 发送原始 JSON 消息（自动序列化 + 容错）
   */
  private sendRaw(obj: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    try {
      this.ws.send(JSON.stringify(obj))
    } catch (err) {
      logger.deviceLink.error(`[Client] Send failed: ${(err as Error).message}`)
    }
  }

  // ===========================================================================
  // 主动事件上报（供事件源调用）
  // ===========================================================================

  /**
   * 上报事件给后端
   * @param type 事件类型（不带 event. 前缀，自动添加）
   * @param payload 事件数据
   */
  reportEvent(type: string, payload: Record<string, unknown>): void {
    this.sendRaw({
      type: `event.${type}`,
      deviceId: this.deviceId,
      payload,
      timestamp: Date.now(),
    })
  }
}

// ============================================================================
// 单例管理
// ============================================================================

let instance: DeviceLinkClient | null = null

/**
 * 初始化设备联动客户端（app ready 后调用）
 */
export function initDeviceLinkClient(opts: {
  configStore: Store<Record<string, unknown>>
  getMainWindow: () => BrowserWindow | null
  resolveWorkspaceRoot: () => string | null
}): DeviceLinkClient {
  if (instance) return instance
  instance = new DeviceLinkClient(opts)
  instance.start()
  return instance
}

/**
 * 获取已初始化的客户端实例
 * 在 init 之前调用会返回 null
 */
export function getDeviceLinkClient(): DeviceLinkClient | null {
  return instance
}

/**
 * 关闭并释放客户端（应用退出时调用）
 */
export function shutdownDeviceLinkClient(): void {
  instance?.stop()
  instance = null
}
