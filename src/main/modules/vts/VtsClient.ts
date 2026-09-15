/**
 * VTS WebSocket 客户端（握手 / 鉴权 / 指令收发）
 *
 * 握手状态机（对齐源 `vts_manager.py`）：
 *
 *   connect(url)
 *     → （有 token）AuthenticationRequest
 *     → （无 token）AuthenticationTokenRequest  ── VTS 弹授权窗，用户点「允许」
 *     → AuthenticationTokenResponse  → 回调 onToken 落盘 → 立即 AuthenticationRequest
 *     → AuthenticationResponse{ authenticated:true } → connected → refreshModelData()
 *
 * 设计取舍：
 *   - **不做退避重连**。VTS 是本机应用，掉线 99% 是「用户关了 VTS」或「没开 API」，
 *     无脑重连只会刷日志。改为：掉线即置 error，由 UI 上的「连接」按钮重试。
 *     这与直播适配器（远端服务，需要扛网络抖动）的策略不同，是有意为之。
 *   - **不回环认证失败**：token 失效时 VTS 返回 authenticated:false + reason，
 *     此时清空内存 token 并提示重新授权，避免拿废 token 反复握手。
 *   - `InjectParameterDataRequest` 是高频消息（≈29 次/秒），其响应体直接丢弃，
 *     不解析、不派发回调 —— 否则每秒 29 次 JSON.parse + 派发会白烧主进程 CPU。
 *
 * @module vts/VtsClient
 */

import { Buffer } from 'buffer'
import { WebSocket, type RawData } from 'ws'
import { logger } from '@shared/toolkit/LogEngine'
import type {
  VtsConnectionState,
  VtsExpression,
  VtsHotkey,
  VtsRequest,
  VtsResponse,
} from './types'

/** 握手总超时（含用户点授权弹窗的时间，给足） */
const HANDSHAKE_TIMEOUT_MS = 60_000

/** 口型帧消息的 requestID（用于识别并丢弃回包） */
export const LIPSYNC_REQUEST_ID = 'LipSync'

/** 一般指令的 requestID */
const GENERAL_REQUEST_ID = 'AweeClaw'

/** 客户端回调 */
export interface VtsClientCallbacks {
  /** 连接状态变化 */
  onStateChange?: (state: VtsConnectionState, message: string) => void
  /** 拿到新的授权 token（调用方负责持久化） */
  onToken?: (token: string) => void
  /** 模型表情 / 热键清单更新 */
  onModelData?: (expressions: VtsExpression[], hotkeys: VtsHotkey[]) => void
}

/** 把 ws 的 message 载荷归一化成字符串 */
function rawToString(raw: RawData): string {
  if (typeof raw === 'string') return raw
  if (Buffer.isBuffer(raw)) return raw.toString('utf8')
  if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8')
  return Buffer.from(raw as ArrayBuffer).toString('utf8')
}

export class VtsClient {
  private ws: WebSocket | null = null

  private state: VtsConnectionState = 'idle'
  private stateMessage = ''

  private authenticated = false

  /** 当前生效的连接参数（重连时复用） */
  private url = ''
  private token = ''
  private pluginName = 'AweeClaw'
  private pluginDeveloper = 'AweeClaw'

  private expressions: VtsExpression[] = []
  private hotkeys: VtsHotkey[] = []

  /** 握手 settle 句柄 */
  private connectResolve: (() => void) | null = null
  private connectReject: ((err: Error) => void) | null = null
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null

  /** 主动断开标记：用于区分「用户点了断开」与「意外掉线」 */
  private closing = false

  constructor(private readonly callbacks: VtsClientCallbacks = {}) {}

  // ============================================
  // 状态访问
  // ============================================

  getState(): VtsConnectionState {
    return this.state
  }

  getStateMessage(): string {
    return this.stateMessage
  }

  isAuthenticated(): boolean {
    return this.authenticated
  }

  getExpressions(): VtsExpression[] {
    return this.expressions
  }

  getHotkeys(): VtsHotkey[] {
    return this.hotkeys
  }

  /** 当前激活的表情名清单 */
  getActiveExpressionNames(): string[] {
    return this.expressions.filter(e => e.active).map(e => e.name)
  }

  isOpen(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN
  }

  // ============================================
  // 连接 / 断开
  // ============================================

  /**
   * 建立连接并完成鉴权握手。
   *
   * @throws 建连失败 / 鉴权超时 / VTS 拒绝授权（消息可读，UI 直接展示）
   */
  async connect(params: {
    url: string
    token: string
    pluginName?: string
    pluginDeveloper?: string
  }): Promise<void> {
    // 幂等：已连接同一地址则直接返回，避免 UI 重复点「连接」造成双连接
    if (this.isOpen() && this.authenticated && this.url === params.url) return

    await this.disconnect()

    this.url = params.url
    this.token = params.token
    this.pluginName = params.pluginName || 'AweeClaw'
    this.pluginDeveloper = params.pluginDeveloper || 'AweeClaw'
    this.closing = false
    this.authenticated = false
    this.expressions = []
    this.hotkeys = []

    this.setState('connecting', `正在连接 ${params.url}`)

    const ws = new WebSocket(params.url)
    this.ws = ws

    const handshake = new Promise<void>((resolve, reject) => {
      this.connectResolve = resolve
      this.connectReject = reject
      this.handshakeTimer = setTimeout(() => {
        this.handshakeTimer = null
        this.rejectHandshake(
          new Error(
            `VTS 握手超时（${HANDSHAKE_TIMEOUT_MS / 1000}s）：请确认 VTube Studio 已启动，` +
              `且在「设置 → API」中开启「允许插件访问」，并留意是否有授权弹窗待确认`,
          ),
        )
      }, HANDSHAKE_TIMEOUT_MS)
    })

    ws.on('open', () => {
      if (this.ws !== ws) return
      this.setState('authenticating', '已建连，等待授权')
      this.authenticate()
    })

    ws.on('message', (raw: RawData) => {
      if (this.ws !== ws) return
      // 单条消息解析失败不该拖垮连接（VTS 偶发发非 JSON 的心跳/日志帧）
      try {
        this.handleMessage(rawToString(raw))
      } catch (err) {
        logger.system.debug('[VTS] 消息解析失败（已忽略）：', err)
      }
    })

    ws.on('error', (err: Error) => {
      if (this.ws !== ws) return
      if (this.closing) return
      // 握手期失败 → 让 connect() reject；已连接后失败 → 只更新状态
      if (this.connectReject) {
        this.rejectHandshake(new Error(`无法连接 VTS（${params.url}）：${err.message}`))
      } else {
        this.setState('error', err.message)
      }
    })

    ws.on('close', () => {
      if (this.ws !== ws) return
      this.ws = null
      this.authenticated = false

      if (this.closing) {
        this.setState('stopped', '已断开')
        return
      }
      // 握手期被对方关掉（端口开着但不是 VTS API、或 VTS 拒绝）
      if (this.connectReject) {
        this.rejectHandshake(
          new Error(`VTS 关闭了连接（${params.url}）：请确认该端口是 VTube Studio 的公共 API`),
        )
        return
      }
      this.setState('error', '连接已被 VTS 关闭')
    })

    await handshake
  }

  /** 断开连接（幂等；会 settle 掉可能挂起的握手 Promise） */
  async disconnect(): Promise<void> {
    this.closing = true
    this.rejectHandshake(new Error('连接已取消'))

    const ws = this.ws
    this.ws = null
    this.authenticated = false

    if (ws) {
      try {
        ws.removeAllListeners()
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close()
        }
      } catch (err) {
        logger.system.debug('[VTS] close failed:', err)
      }
    }

    if (this.state !== 'idle') this.setState('stopped', '已断开')
  }

  // ============================================
  // 鉴权
  // ============================================

  /** 发起鉴权：有 token 走登录，无 token 走授权申请 */
  private authenticate(): void {
    if (!this.isOpen()) return

    if (this.token) {
      this.send('AuthenticationRequest', { authenticationToken: this.token })
      return
    }

    this.setState('authenticating', '已发起授权申请，请在 VTS 弹窗中点击「允许」')
    this.send('AuthenticationTokenRequest', {
      pluginName: this.pluginName,
      pluginDeveloper: this.pluginDeveloper,
    })
  }

  // ============================================
  // 消息分发
  // ============================================

  private handleMessage(text: string): void {
    const resp = JSON.parse(text) as VtsResponse
    const type = resp.messageType
    if (!type) return

    // 高频回包直接丢弃（口型帧），避免每帧一次 JSON 解析后的无效派发
    if (resp.requestID === LIPSYNC_REQUEST_ID && type !== 'APIError') return

    switch (type) {
      // VTS 首次授权：拿到 token 立即落盘，然后用它正式登录
      case 'AuthenticationTokenResponse': {
        const token = String((resp.data?.authenticationToken as string) ?? '')
        if (!token) {
          this.rejectHandshake(new Error('VTS 未返回授权 token，请重新在弹窗中点击「允许」'))
          return
        }
        this.token = token
        this.callbacks.onToken?.(token)
        this.authenticate()
        return
      }

      case 'AuthenticationResponse': {
        const ok = resp.data?.authenticated === true
        if (ok) {
          this.authenticated = true
          this.setState('connected', '已连接')
          this.resolveHandshake()
          this.refreshModelData()
          return
        }
        // token 失效（VTS 重启后换密钥 / 用户在 VTS 里撤销了本插件）
        const reason = String(resp.data?.reason ?? resp.message ?? '未知原因')
        this.token = ''
        this.callbacks.onToken?.('')
        this.rejectHandshake(
          new Error(`VTS 拒绝授权：${reason}（已清除本地 token，请重新连接以发起授权）`),
        )
        return
      }

      case 'ExpressionStateResponse': {
        const list = resp.data?.expressions
        if (Array.isArray(list)) {
          this.expressions = list
            .map(item => ({
              name: String(item?.name ?? ''),
              file: String(item?.file ?? ''),
              active: item?.active === true,
            }))
            .filter(item => item.name || item.file)
          this.callbacks.onModelData?.(this.expressions, this.hotkeys)
        }
        return
      }

      case 'HotkeysInCurrentModelResponse': {
        const list = resp.data?.availableHotkeys
        if (Array.isArray(list)) {
          this.hotkeys = list
            .map(item => ({
              name: String(item?.name ?? ''),
              hotkeyID: String(item?.hotkeyID ?? ''),
              type: String(item?.type ?? ''),
            }))
            // 与源项目一致：滤掉 ToggleExpression，那类热键由表情通道处理，
            // 留在列表里会导致同一个名字被触发两次
            .filter(item => item.name && item.hotkeyID && item.type !== 'ToggleExpression')
          this.callbacks.onModelData?.(this.expressions, this.hotkeys)
        }
        return
      }

      case 'APIError': {
        const msg = String(resp.data?.message ?? resp.message ?? '未知 API 错误')
        const errorId = resp.data?.errorID
        logger.system.warn(`[VTS] APIError(${errorId ?? '-'})：${msg}`)

        // 鉴权阶段的 APIError 必须让 connect() 失败，否则 UI 会一直转圈
        if (this.connectReject) {
          this.rejectHandshake(new Error(`VTS 返回错误：${msg}`))
        }
        return
      }

      default:
        // 其它响应（ParameterCreation/InjectParameter 回包等）无需处理
        return
    }
  }

  // ============================================
  // 指令
  // ============================================

  /**
   * 发送一条 VTS 指令。
   *
   * @returns 是否真正写出（未连接时返回 false，调用方据此统计丢帧）
   */
  send(messageType: string, data: Record<string, unknown>, requestId = GENERAL_REQUEST_ID): boolean {
    if (!this.isOpen()) return false

    const payload: VtsRequest = {
      apiName: 'VTubeStudioPublicAPI',
      apiVersion: '1.0',
      requestID: requestId,
      messageType,
      data,
    }

    try {
      this.ws?.send(JSON.stringify(payload))
      return true
    } catch (err) {
      logger.system.debug('[VTS] 发送失败：', err)
      return false
    }
  }

  /**
   * 注入一个参数值（口型驱动主通道）。
   *
   * 载荷严格对齐源项目：
   *   { faceFound:false, mode:'set', parameterValues:[{ id, value }] }
   *
   * `faceFound:false` 是**有意为之** —— 表示「值由插件注入，不是摄像头追踪结果」，
   * VTS 才会采用该值而不是回退到追踪数据。改成 true 会导致口型被摄像头覆盖。
   */
  injectParameter(parameterId: string, value: number): boolean {
    return this.send(
      'InjectParameterDataRequest',
      {
        faceFound: false,
        mode: 'set',
        parameterValues: [
          {
            id: parameterId,
            // 对齐源项目 round(value, 3)：3 位小数足够，且能显著减小帧体积
            value: Math.round(value * 1000) / 1000,
          },
        ],
      },
      LIPSYNC_REQUEST_ID,
    )
  }

  /** 拉取模型表情与热键清单 */
  refreshModelData(): void {
    if (!this.authenticated) return
    this.send('HotkeysInCurrentModelRequest', {})
    this.send('ExpressionStateRequest', {})
  }

  /**
   * 按名字触发（表情优先，回退热键）。
   *
   * 对齐源 `trigger_hotkey`：
   *   - 名字统一 strip `<`/`>` 且忽略大小写（AI 输出的标签常带尖括号）
   *   - 表情命中时：**清掉其它表情**，只激活目标（VTS 的表情是互斥的开关集合）
   *   - 表情未命中才尝试热键
   *
   * @param rawName 原始名字（可含 `<` `>`）
   * @param enabledExpressions 是否允许触发表情
   * @param enabledMotions 是否允许触发热键
   * @returns 实际触发的类型与名字；未命中返回 null
   */
  trigger(
    rawName: string,
    enabledExpressions: boolean,
    enabledMotions: boolean,
  ): { kind: 'expression' | 'hotkey'; name: string } | null {
    if (!this.authenticated) return null

    const clean = rawName.replace(/</g, '').replace(/>/g, '').trim().toLowerCase()
    if (!clean) return null

    if (enabledExpressions) {
      const target = this.expressions.find(e => e.name.trim().toLowerCase() === clean)
      if (target) {
        for (const exp of this.expressions) {
          const shouldActive = exp.name === target.name
          if (exp.active !== shouldActive) {
            this.send('ExpressionActivationRequest', {
              expressionFile: exp.file,
              active: shouldActive,
            })
            // 本地同步状态：不等 VTS 回推 ExpressionStateResponse，
            // 否则连续两次触发之间会读到过期状态、重复下发指令
            exp.active = shouldActive
          }
        }
        return { kind: 'expression', name: target.name }
      }
    }

    if (enabledMotions) {
      const hotkey = this.hotkeys.find(h => h.name.trim().toLowerCase() === clean)
      if (hotkey) {
        this.send('HotkeyTriggerRequest', { hotkeyID: hotkey.hotkeyID })
        return { kind: 'hotkey', name: hotkey.name }
      }
    }

    return null
  }

  /**
   * 从文本中提取 `<名字>` 标签并依次触发。
   *
   * 只在**回复收尾**时调用（不是流式每个 token 都调），避免一句话里反复切表情。
   *
   * @returns 实际触发的条目
   */
  triggerFromText(
    text: string,
    enabledExpressions: boolean,
    enabledMotions: boolean,
  ): Array<{ kind: 'expression' | 'hotkey'; name: string }> {
    const hits: Array<{ kind: 'expression' | 'hotkey'; name: string }> = []
    const re = /<([^<>]{1,64})>/g
    let match: RegExpExecArray | null
    while ((match = re.exec(text)) !== null) {
      const triggered = this.trigger(match[1], enabledExpressions, enabledMotions)
      if (triggered) hits.push(triggered)
    }
    return hits
  }

  // ============================================
  // 内部：握手 settle
  // ============================================

  private resolveHandshake(): void {
    const resolve = this.connectResolve
    this.clearHandshakeSettle()
    resolve?.()
  }

  private rejectHandshake(err: Error): void {
    const reject = this.connectReject
    this.clearHandshakeSettle()
    if (reject) {
      reject(err)
    } else if (err.message !== '连接已取消') {
      // 握手已结束（或压根没开始）时的错误 → 只更新状态供 UI 展示
      this.setState('error', err.message)
    }
  }

  private clearHandshakeSettle(): void {
    this.connectResolve = null
    this.connectReject = null
    if (this.handshakeTimer) {
      clearTimeout(this.handshakeTimer)
      this.handshakeTimer = null
    }
  }

  private setState(state: VtsConnectionState, message = ''): void {
    if (this.state === state && this.stateMessage === message) return
    this.state = state
    this.stateMessage = message

    const text = `[VTS] ${state}${message ? `：${message}` : ''}`
    if (state === 'error') logger.system.warn(text)
    else logger.system.info(text)

    this.callbacks.onStateChange?.(state, message)
  }
}
