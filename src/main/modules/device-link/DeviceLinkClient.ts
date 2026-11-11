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
  handlePermissionState,
  handlePermissionRequest,
  handleInputClick,
  handleInputMove,
  handleInputScroll,
  handleInputDrag,
  handleInputType,
  handleInputKey,
  handleInputEmergencyStop,
  handleScreenFrame,
  preferenceKeyForScope,
  tempGrantDurationMs,
  PERMISSION_SCOPES,
  type PermissionScope,
  type DeviceHandlerContext,
  type DeviceLinkPreferences,
} from './DeviceLinkHandlers'
import { deviceLinkEventBridge } from './DeviceLinkEventBridge'
import { taskControlHub, type QueuedSteer, type IncomingTakeoverResolve } from './TaskControlHub'
import type { TakeoverRequest, TaskFrame } from '@shared/protocols/deviceTaskProtocol'
import type Store from 'electron-store'

const HEARTBEAT_INTERVAL_MS = 15000
const INITIAL_RECONNECT_DELAY_MS = 5000
const MAX_RECONNECT_DELAY_MS = 30000
const MAX_RECONNECT_ATTEMPTS = 10
const RECONNECT_BACKOFF_FACTOR = 1.5

const PREFERENCES_KEY = 'deviceLink'
/** 各权限范围的临时授权到期时间戳（scope → expiresAt） */
const TEMP_GRANTS_KEY = 'deviceLinkTempGrants'

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
    // 移动端发来的补充说明与接管处置都经 hub 中转：执行层在工具边界取走 steer，
    // 接管处置则立刻推给 renderer（它正卡在等待上）
    taskControlHub.setSink({
      onSteer: (taskId, steer) => this.forwardTaskControl('steer', { taskId, steer }),
      onTakeoverResolve: (taskId, resolve) =>
        this.forwardTaskControl('takeover-resolve', { taskId, resolve }),
    })
  }

  /** 执行画面采集开关的回调：由 ipc 层注入，避免与本模块循环依赖 */
  private frameStreamSink: ((taskId: string, action: 'start' | 'stop') => void) | null = null

  /**
   * 注入执行画面采集开关
   *
   * TaskFrameStreamer 反过来依赖本模块（上报帧要拿 client），直接在此 import
   * 会形成循环。改为由 ipc 层初始化时注入一个回调，方向保持单向。
   */
  setFrameStreamSink(sink: ((taskId: string, action: 'start' | 'stop') => void) | null): void {
    this.frameStreamSink = sink
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

    // 执行中补充说明：先入队，等工具边界再取
    if (msg?.type === 'task.steer') {
      this.handleTaskSteer(msg)
      return
    }

    // 执行画面采集开关：移动端打开/关闭任务详情时下发。
    // 只在有人看时才采集，关闭后立刻停，避免无观看者时空转截图。
    if (msg?.type === 'frame-stream') {
      const taskId = String(msg?.taskId ?? '')
      const action = msg?.action === 'stop' ? 'stop' : 'start'
      if (taskId && this.frameStreamSink) {
        try {
          this.frameStreamSink(taskId, action)
        } catch (err) {
          logger.deviceLink.warn(`[Client] Frame stream ${action} failed: ${(err as Error).message}`)
        }
      }
      return
    }

    // 接管处置：用户已在移动端处理完（或跳过 / 放弃）
    if (msg?.type === 'task.takeover.resolve') {
      this.handleTakeoverResolve(msg)
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
        // ── 远程控制：画面拉帧 + 输入注入 ──
        case 'screen.frame.req':
          payload = await handleScreenFrame(ctx, {
            maxWidth: req.maxWidth,
            quality: req.quality,
          })
          break
        case 'input.click.req':
          payload = await handleInputClick(ctx, {
            x: req.x,
            y: req.y,
            button: req.button,
            clickType: req.clickType,
          })
          break
        case 'input.move.req':
          payload = await handleInputMove(ctx, { x: req.x, y: req.y })
          break
        case 'input.scroll.req':
          payload = await handleInputScroll(ctx, {
            x: req.x,
            y: req.y,
            amount: req.amount,
          })
          break
        case 'input.drag.req':
          payload = await handleInputDrag(ctx, {
            fromX: req.fromX,
            fromY: req.fromY,
            toX: req.toX,
            toY: req.toY,
            button: req.button,
            duration: req.duration,
          })
          break
        case 'input.type.req':
          payload = await handleInputType(ctx, { text: req.text, delayMs: req.delayMs })
          break
        case 'input.key.req':
          payload = await handleInputKey(ctx, { key: req.key, keys: req.keys })
          break
        case 'input.emergency-stop.req':
          payload = await handleInputEmergencyStop(ctx, {
            action: req.action,
            reason: req.reason,
          })
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
        case 'permission.state.req':
          payload = handlePermissionState(ctx)
          break
        case 'permission.request':
          payload = await handlePermissionRequest(ctx, {
            scope: String(req.scope ?? 'shell'),
            reason: String(req.reason ?? ''),
          })
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
  // 任务控制（steer / 接管处置）
  // ===========================================================================

  /**
   * 补充说明入队
   *
   * 不做任何执行动作：队列由执行层在工具批次边界取走，
   * 取走时才回执 adopted（见 consumeSteers）。
   */
  private handleTaskSteer(msg: any): void {
    const taskId = String(msg?.taskId ?? '')
    const steerId = String(msg?.steerId ?? '')
    const text = String(msg?.text ?? '')
    const result = taskControlHub.enqueueSteer(taskId, steerId, text)
    if (!result.accepted) {
      logger.deviceLink.warn(
        `[Client] Steer rejected task=${taskId} steerId=${steerId} reason=${result.reason}`,
      )
    }
  }

  /** 接管处置：直接交给执行层，由它重新核实界面状态 */
  private handleTakeoverResolve(msg: any): void {
    const taskId = String(msg?.taskId ?? '')
    const outcome = msg?.outcome
    if (!taskId) return
    if (outcome !== 'resolved' && outcome !== 'skipped' && outcome !== 'aborted') {
      logger.deviceLink.warn(`[Client] Unknown takeover outcome: ${String(outcome)}`)
      return
    }
    taskControlHub.pushTakeoverResolve(taskId, outcome, msg?.note ? String(msg.note) : undefined)
  }

  /** 把任务控制事件推给 renderer（执行层在这里处理） */
  private forwardTaskControl(
    kind: 'steer' | 'takeover-resolve',
    payload: { taskId: string; steer?: QueuedSteer; resolve?: IncomingTakeoverResolve },
  ): void {
    const win = this.getMainWindow()
    if (!win || win.isDestroyed()) {
      logger.deviceLink.debug(`[Client] No window for task control ${kind}, kept in queue`)
      return
    }
    win.webContents.send('device-link:task-control', { kind, ...payload })
  }

  /**
   * 取走该任务待处理的补充说明（工具批次边界调用）
   *
   * 取走即视为已注入：逐条回执 adopted，移动端据此把状态从 pending 改为 adopted。
   */
  consumeSteers(taskId: string): QueuedSteer[] {
    const steers = taskControlHub.drainSteers(taskId)
    for (const steer of steers) {
      this.reportSteerAdopted(taskId, steer.steerId)
    }
    return steers
  }

  /** 任务结束：清掉该任务的队列与残留状态 */
  clearTaskControl(taskId: string): void {
    taskControlHub.clearTask(taskId)
  }

  /** 上报接管请求（桌面端 → 移动端） */
  reportTaskTakeover(taskId: string, request: TakeoverRequest): void {
    this.reportEvent('task-takeover', { taskId, request })
  }

  /** 回执：补充说明已被取走并注入 */
  reportSteerAdopted(taskId: string, steerId: string): void {
    this.reportEvent('task-steer-adopted', { taskId, steerId, at: Date.now() })
  }

  /** 上报执行画面帧（只给用户看，不进模型上下文） */
  reportTaskFrame(frame: TaskFrame): void {
    this.reportEvent('task-frame', frame as unknown as Record<string, unknown>)
  }


  private buildHandlerContext(): DeviceHandlerContext {
    return {
      resolveWorkspaceRoot: this.resolveWorkspaceRoot,
      preferences: () => this.loadPreferences(),
      getMainWindow: this.getMainWindow,
      tempGrantRemaining: (scope) => this.tempGrantRemaining(scope),
      applyPermission: (scope, mode) => this.applyPermission(scope, mode),
    }
  }

  private loadPreferences(): DeviceLinkPreferences {
    const data = this.configStore.get(PREFERENCES_KEY) as DeviceLinkPreferences | undefined
    const temp = this.loadTempGrants()
    const active = (scope: PermissionScope) => (temp[scope] || 0) > Date.now()
    return {
      // 默认全开：设备联动本身已由登录态与设备绑定把关，用户主动打开远程控制
      // 时不该再被一个从未设置过的开关挡在门外。
      // 注意 ?? 只作用于「从未设置过」的情况：用户在设置里明确关掉的项仍保持关闭。
      // 临时授权有效期内视为开启，到期自动回落到本机设置值。
      allowRemoteCommand: (data?.allowRemoteCommand ?? true) || active('shell'),
      allowClipboardPush: (data?.allowClipboardPush ?? true) || active('clipboard'),
      allowScreenshot: (data?.allowScreenshot ?? true) || active('screenshot'),
      allowPowerControl: (data?.allowPowerControl ?? true) || active('power'),
      // 远程控制同理：漏掉这一行会让 permission.state.req 恒报未授权，
      // 移动端每次都重新申请，且授权后输入注入仍被 forbidden_by_policy 拒绝
      allowRemoteInput: (data?.allowRemoteInput ?? true) || active('input'),
    }
  }

  private loadTempGrants(): Partial<Record<PermissionScope, number>> {
    return (this.configStore.get(TEMP_GRANTS_KEY) as Partial<Record<PermissionScope, number>>) || {}
  }

  /** 某范围临时授权剩余毫秒 */
  private tempGrantRemaining(scope: PermissionScope): number {
    const until = this.loadTempGrants()[scope] || 0
    return Math.max(0, until - Date.now())
  }

  /** 落地权限决策：temp 写 10 分钟到期时间，always 永久写入偏好 */
  private applyPermission(scope: PermissionScope, mode: 'temp' | 'always'): void {
    if (mode === 'temp') {
      const temp = { ...this.loadTempGrants(), [scope]: Date.now() + tempGrantDurationMs() }
      this.configStore.set(TEMP_GRANTS_KEY, temp)
      logger.deviceLink.info(`[Client] Temp permission granted: ${scope} (10m)`)
      return
    }
    this.updatePreferences({ [preferenceKeyForScope(scope)]: true })
  }

  /** 当前是否允许远程截图（执行画面采集沿用该开关） */
  isScreenshotAllowed(): boolean {
    return this.loadPreferences().allowScreenshot === true
  }

  /**
   * 远程权限快照（设置界面读取）
   *
   * 不能直接把 configStore 里的原值丢给界面：临时授权是叠加在偏好之上的，
   * 若界面只看原值，就会把「10 分钟授权进行中」显示成「已关闭」，
   * 用户按这个错误状态再点一次开关，反而把刚拿到的授权覆盖掉。
   */
  getPermissionSnapshot(): {
    preferences: Required<DeviceLinkPreferences>
    tempRemaining: Record<PermissionScope, number>
  } {
    const prefs = this.loadPreferences()
    const tempRemaining = {} as Record<PermissionScope, number>
    for (const scope of PERMISSION_SCOPES) {
      tempRemaining[scope] = this.tempGrantRemaining(scope)
    }
    return {
      preferences: {
        allowRemoteCommand: !!prefs.allowRemoteCommand,
        allowClipboardPush: prefs.allowClipboardPush ?? true,
        allowScreenshot: prefs.allowScreenshot ?? true,
        allowPowerControl: !!prefs.allowPowerControl,
        allowRemoteInput: !!prefs.allowRemoteInput,
      },
      tempRemaining,
    }
  }

  /**
   * 撤销某范围的临时授权
   *
   * 只清临时授权，不动永久偏好：用户只是想立刻收回这次限时放行，
   * 不该连带把「始终允许」的开关也关掉。
   */
  clearTempGrant(scope: PermissionScope): boolean {
    const temp = this.loadTempGrants()
    if (!temp[scope]) return false
    delete temp[scope]
    this.configStore.set(TEMP_GRANTS_KEY, temp)
    logger.deviceLink.info(`[Client] Temp permission revoked: ${scope}`)
    return true
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
