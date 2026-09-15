/**
 * B站直播适配器 · 开放平台（open_live）
 *
 * 对齐源项目 `py/blivedm/clients/open_live.py` + `py/live_router.py` 的
 * `OpenLiveWebSocketHandler`。**这是 B站唯一合规的接入方式**（官方授权），
 * 因此默认走这条链路，网页模式需要额外解锁。
 *
 * 完整链路：
 *   1. `POST /v2/app/start`  携带 HMAC-SHA256 签名头，换来
 *      `game_id` + `auth_body` + `wss_link[]`
 *   2. 连 `wss_link[i]`，发 AUTH 包（体为 auth_body 原样）
 *   3. 收到 `AUTH_REPLY` 且 code=0 → 立即补一个心跳包，之后每 30s 一次
 *   4. 每 20s 调 `POST /v2/app/heartbeat` 保活；code=7003 表示项目被服务端关闭 → 重新 start
 *   5. 停止时 `POST /v2/app/end` 关闭项目
 *      （不做这步会短时间内无法重复连接同一个房间）
 *
 * 报文是二进制：包头 + JSON，且开放平台仍用 zlib 压缩（ver=2），
 * 解压后又是完整包序列 → 由 `bilibiliProtocol` 负责递归解包。
 *
 * @module live/adapters/BilibiliOpenLiveAdapter
 */

import { createHash, createHmac, randomUUID } from 'crypto'
import { WebSocket } from 'ws'
import { logger } from '@shared/toolkit/LogEngine'
import type { LiveConfig, LivePlatform } from '../types'
import { BaseLiveAdapter } from './BaseLiveAdapter'
import {
  BILI_USER_AGENT,
  BiliOperation,
  BiliProtoVer,
  decompressBody,
  normalizeCmd,
  packPacket,
  parseCommands,
  readPopularity,
  splitPackets,
  toBinaryBuffer,
} from './bilibiliProtocol'

// ============================================
// 开放平台 HTTP 端点
// ============================================

const START_URL = 'https://live-open.biliapi.com/v2/app/start'
const HEARTBEAT_URL = 'https://live-open.biliapi.com/v2/app/heartbeat'
const END_URL = 'https://live-open.biliapi.com/v2/app/end'

/** HTTP 超时（ms） */
const HTTP_TIMEOUT_MS = 10_000
/** 弹幕服务器心跳间隔（ms，对齐源项目 30s） */
const WS_HEARTBEAT_INTERVAL_MS = 30_000
/** 项目心跳间隔（ms，对齐源项目 20s） */
const GAME_HEARTBEAT_INTERVAL_MS = 20_000
/** 握手超时（ms） */
const CONNECT_TIMEOUT_MS = 30_000
/** 压缩包递归深度上限（防御性） */
const MAX_RECURSION_DEPTH = 5

/** start 接口返回体 */
interface OpenLiveStartData {
  game_info: { game_id: string }
  websocket_info: { auth_body: string; wss_link: string[] }
  anchor_info: { room_id: number; uid: number; open_id: string }
}

/** 开放平台通用响应壳 */
interface OpenLiveResponse<T> {
  code: number
  message?: string
  request_id?: string
  data?: T
}

// ============================================
// 小工具
// ============================================

/** 安全取字符串（协议里同一字段有时是 number 有时是 string） */
function asString(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

/** 安全取数字 */
function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

/** 从命令对象里安全取 data 子对象 */
function pickData(command: Record<string, unknown>): Record<string, unknown> {
  const data = command.data
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
}

// ============================================
// Adapter
// ============================================

export class BilibiliOpenLiveAdapter extends BaseLiveAdapter {
  readonly platform: LivePlatform = 'bilibili'

  private ws: WebSocket | null = null

  /** 项目场次 ID（start 后初始化；重连时复用，不重复 start） */
  private gameId = ''
  /** 弹幕服务器认证包体（原样透传） */
  private authBody = ''
  /** 弹幕服务器地址列表（start 返回，故障转移用） */
  private hostList: string[] = []
  /** 下一次连接用哪个 host */
  private hostIndex = 0
  /** 是否需要重新执行 start（服务端关闭项目 / 认证失败时置位） */
  private needInitRoom = false

  private wsHeartbeatTimer: ReturnType<typeof setInterval> | null = null
  private gameHeartbeatTimer: ReturnType<typeof setInterval> | null = null

  // ============================================
  // 连接
  // ============================================

  protected async connect(config: LiveConfig): Promise<void> {
    if (!this.gameId || this.needInitRoom) {
      await this.startGame(config)
    }

    if (this.hostList.length === 0) {
      this.needInitRoom = true
      throw new Error('缺少弹幕服务器地址（wss_link 为空）')
    }

    const url = this.pickHostUrl()
    await this.connectWebSocket(url)

    // 到这里说明认证已通过（AUTH_REPLY 里 resolveConnect）
    this.needInitRoom = false
  }

  /**
   * 需要重新开启项目时的统一入口。
   *
   * 这里**不能只 closeSocket()**：`closeSocket` 会先摘掉监听再关连接，
   * 因此不会再触发 close 回调，重连必须显式发起。
   */
  private reinitAndReconnect(reason: string): void {
    if (this.stopped) return
    this.needInitRoom = true
    this.closeSocket()
    this.fail(new Error(reason))
  }

  protected async disconnect(): Promise<void> {
    this.clearWsHeartbeat()
    this.clearGameHeartbeat()

    // 先停项目再断连接：否则短时间内无法重复连接同一个房间
    await this.endGame()

    this.closeSocket()
    this.gameId = ''
    this.authBody = ''
    this.hostList = []
    this.hostIndex = 0
    this.needInitRoom = false
  }

  // ============================================
  // 开放平台 REST
  // ============================================

  /** 构造带 HMAC-SHA256 签名的请求头（签名串按固定字段顺序拼 \n） */
  private buildSignedHeaders(accessKeyId: string, accessKeySecret: string, bodyBytes: Buffer): Record<string, string> {
    // ⚠️ 顺序即签名内容的一部分，不可调整
    const ordered: Array<[string, string]> = [
      ['x-bili-accesskeyid', accessKeyId],
      ['x-bili-content-md5', createHash('md5').update(bodyBytes).digest('hex')],
      ['x-bili-signature-method', 'HMAC-SHA256'],
      ['x-bili-signature-nonce', randomUUID().replace(/-/g, '')],
      ['x-bili-signature-version', '1.0'],
      ['x-bili-timestamp', String(Math.floor(Date.now() / 1000))],
    ]

    const strToSign = ordered.map(([key, value]) => `${key}:${value}`).join('\n')
    const signature = createHmac('sha256', accessKeySecret).update(strToSign, 'utf-8').digest('hex')

    const headers: Record<string, string> = {}
    for (const [key, value] of ordered) headers[key] = value
    headers.Authorization = signature
    headers['Content-Type'] = 'application/json'
    headers.Accept = 'application/json'
    return headers
  }

  /** 调用开放平台接口并校验业务 code */
  private async requestOpenLive<T>(
    url: string,
    body: Record<string, unknown>,
    accessKeyId: string,
    accessKeySecret: string,
  ): Promise<T> {
    const bodyBytes = Buffer.from(JSON.stringify(body), 'utf-8')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS)

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: this.buildSignedHeaders(accessKeyId, accessKeySecret, bodyBytes),
        body: bodyBytes,
        signal: controller.signal,
      })

      if (!res.ok) {
        throw new Error(`开放平台返回 HTTP ${res.status}`)
      }

      const json = (await res.json()) as OpenLiveResponse<T>
      if (json.code !== 0) {
        throw new Error(`开放平台返回 code=${json.code}${json.message ? `（${json.message}）` : ''}`)
      }
      return json.data as T
    } finally {
      clearTimeout(timer)
    }
  }

  /** 开启项目，初始化 game_id / auth_body / host_list */
  private async startGame(config: LiveConfig): Promise<void> {
    const appId = Number(config.bilibiliAppId)
    if (!Number.isFinite(appId)) {
      throw new Error('AppId 必须是数字')
    }

    const data = await this.requestOpenLive<OpenLiveStartData>(
      START_URL,
      { code: config.bilibiliRoomOwnerAuthCode, app_id: appId },
      config.bilibiliAccessKeyId,
      config.bilibiliAccessKeySecret,
    )

    if (!data?.game_info?.game_id || !data?.websocket_info?.auth_body || !data.websocket_info.wss_link?.length) {
      throw new Error('开放平台 start 返回体缺少 game_id / auth_body / wss_link')
    }

    this.gameId = data.game_info.game_id
    this.authBody = data.websocket_info.auth_body
    this.hostList = data.websocket_info.wss_link
    this.hostIndex = 0
    this.needInitRoom = false

    logger.system.info(
      `[Live][bilibili] 开放平台项目已开启：game_id=${this.gameId} room_id=${data.anchor_info?.room_id ?? '未知'}`,
    )

    this.startGameHeartbeat(config)
  }

  /** 项目心跳（保活；服务端判定超时会关闭项目） */
  private startGameHeartbeat(config: LiveConfig): void {
    this.clearGameHeartbeat()
    this.gameHeartbeatTimer = setInterval(() => {
      void this.sendGameHeartbeat(config)
    }, GAME_HEARTBEAT_INTERVAL_MS)
  }

  private async sendGameHeartbeat(config: LiveConfig): Promise<void> {
    if (this.stopped || !this.gameId) return

    try {
      await this.requestOpenLive<unknown>(
        HEARTBEAT_URL,
        { game_id: this.gameId },
        config.bilibiliAccessKeyId,
        config.bilibiliAccessKeySecret,
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // 7003 = 项目异常关闭（可能心跳超时）→ 重新 start；其余情况只记日志，等连接层自己退避
      if (message.includes('7003')) {
        logger.system.warn('[Live][bilibili] 项目已被服务端关闭，将重新开启项目')
        this.reinitAndReconnect('项目已被服务端关闭')
        return
      }
      logger.system.warn('[Live][bilibili] 项目心跳失败：', message)
    }
  }

  /** 关闭项目（best-effort；已关闭也算成功） */
  private async endGame(): Promise<void> {
    const config = this.config
    if (!this.gameId || !config) return

    const appId = Number(config.bilibiliAppId)
    const gameId = this.gameId

    try {
      await this.requestOpenLive<unknown>(
        END_URL,
        { app_id: appId, game_id: gameId },
        config.bilibiliAccessKeyId,
        config.bilibiliAccessKeySecret,
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // 7000 / 7003：项目本来就已经关闭，视为成功
      if (!message.includes('7000') && !message.includes('7003')) {
        logger.system.warn('[Live][bilibili] 关闭项目失败（忽略）：', message)
      }
    }
  }

  // ============================================
  // 弹幕 WebSocket
  // ============================================

  private pickHostUrl(): string {
    const index = this.hostIndex % this.hostList.length
    this.hostIndex++
    return this.hostList[index]
  }

  private connectWebSocket(url: string): Promise<void> {
    this.closeSocket()

    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url, { headers: { 'User-Agent': BILI_USER_AGENT } })
      this.ws = ws

      // 立即发起握手等待，AUTH_REPLY 里 settle
      void this.waitForConnect(CONNECT_TIMEOUT_MS).then(resolve, reject)

      ws.on('open', () => {
        if (this.ws !== ws) return
        ws.send(packPacket(this.authBody, BiliOperation.AUTH))
      })

      ws.on('message', (data: unknown) => {
        if (this.ws !== ws || this.stopped) return
        const buffer = toBinaryBuffer(data)
        if (!buffer) return
        this.handleMessage(buffer, 0)
      })

      ws.on('error', (err: Error) => {
        if (this.ws !== ws || this.stopped) return
        logger.system.warn('[Live][bilibili] 弹幕服务器连接异常：', err.message)
      })

      ws.on('close', () => {
        if (this.ws !== ws) return
        this.ws = null
        this.clearWsHeartbeat()
        if (this.stopped) return

        const reason = '弹幕服务器连接已断开'
        // 握手期掉线 → 交给 connect() 的 catch；已连接后掉线 → 走退避重连
        if (this.isConnectPending()) this.rejectConnect(new Error(reason))
        else this.fail(new Error(reason))
      })
    })
  }

  private closeSocket(): void {
    this.clearWsHeartbeat()
    const ws = this.ws
    this.ws = null
    if (!ws) return
    // 先摘掉监听再关，避免 close 回调触发多余的重连判定
    ws.removeAllListeners()
    try {
      ws.close()
    } catch {
      /* 已断开，忽略 */
    }
  }

  private startWsHeartbeat(ws: WebSocket): void {
    this.clearWsHeartbeat()
    this.wsHeartbeatTimer = setInterval(() => {
      if (this.ws !== ws || ws.readyState !== WebSocket.OPEN) return
      try {
        ws.send(packPacket('{}', BiliOperation.HEARTBEAT))
      } catch (err) {
        logger.system.warn('[Live][bilibili] 发送心跳失败：', err)
      }
    }, WS_HEARTBEAT_INTERVAL_MS)
  }

  private clearWsHeartbeat(): void {
    if (this.wsHeartbeatTimer) {
      clearInterval(this.wsHeartbeatTimer)
      this.wsHeartbeatTimer = null
    }
  }

  private clearGameHeartbeat(): void {
    if (this.gameHeartbeatTimer) {
      clearInterval(this.gameHeartbeatTimer)
      this.gameHeartbeatTimer = null
    }
  }

  // ============================================
  // 报文处理
  // ============================================

  /** 拆包 + 按操作码分发（压缩体递归回到这里） */
  private handleMessage(data: Buffer, depth: number): void {
    if (depth > MAX_RECURSION_DEPTH) return

    for (const packet of splitPackets(data)) {
      switch (packet.operation) {
        case BiliOperation.SEND_MSG_REPLY:
          this.handleBusinessPacket(packet.ver, packet.body, depth)
          break

        case BiliOperation.AUTH_REPLY:
          this.handleAuthReply(packet.body)
          break

        case BiliOperation.HEARTBEAT_REPLY:
          logger.system.debug(`[Live][bilibili] 心跳回包，人气值=${readPopularity(packet.body)}`)
          break

        default:
          break
      }
    }
  }

  /** 业务包：压缩体递归解包，明文体解析为命令并分发 */
  private handleBusinessPacket(ver: number, body: Buffer, depth: number): void {
    if (ver === BiliProtoVer.NORMAL) {
      for (const command of parseCommands(body)) this.handleCommand(command)
      return
    }

    const decompressed = decompressBody(ver, body)
    if (!decompressed) {
      logger.system.warn(`[Live][bilibili] 包体解压失败（ver=${ver}，${body.length} 字节）`)
      return
    }
    this.handleMessage(decompressed, depth + 1)
  }

  /** 认证回包：code=0 才算连上（连上后立刻补一个心跳，对齐源项目） */
  private handleAuthReply(body: Buffer): void {
    let code = -1
    try {
      const parsed = JSON.parse(body.toString('utf-8')) as { code?: number }
      code = typeof parsed.code === 'number' ? parsed.code : -1
    } catch {
      this.rejectConnect(new Error('认证回包解析失败'))
      return
    }

    if (code !== 0) {
      this.rejectConnect(new Error(`弹幕服务器认证失败（code=${code}）`))
      return
    }

    const ws = this.ws
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(packPacket('{}', BiliOperation.HEARTBEAT))
      } catch {
        /* 忽略：心跳失败不影响认证结果 */
      }
      this.startWsHeartbeat(ws)
    }
    this.resolveConnect()
  }

  /** 业务命令分发（文案模板严格对齐源项目） */
  private handleCommand(command: Record<string, unknown>): void {
    const cmd = normalizeCmd(command)
    if (!cmd) return
    const data = pickData(command)

    switch (cmd) {
      case 'LIVE_OPEN_PLATFORM_DM':
        this.emitEvent('danmaku', `${asString(data.uname)}说：${asString(data.msg)}`, command)
        break

      case 'LIVE_OPEN_PLATFORM_SEND_GIFT': {
        const coinType = data.paid ? '金瓜子' : '银瓜子'
        const totalCoin = asNumber(data.price) * asNumber(data.gift_num)
        this.emitEvent(
          'gift',
          `${asString(data.uname)} 赠送${asString(data.gift_name)}x${asNumber(data.gift_num)} （${coinType}x${totalCoin}）`,
          command,
        )
        break
      }

      case 'LIVE_OPEN_PLATFORM_GUARD': {
        const userInfo = data.user_info && typeof data.user_info === 'object' ? (data.user_info as Record<string, unknown>) : {}
        this.emitEvent(
          'buy_guard',
          `${asString(userInfo.uname)} 上舰，大航海等级=${asNumber(data.guard_level)}`,
          command,
        )
        break
      }

      case 'LIVE_OPEN_PLATFORM_SUPER_CHAT':
        this.emitEvent('super_chat', `${asString(data.uname)}发送醒目留言：${asString(data.message)}`, command)
        break

      case 'LIVE_OPEN_PLATFORM_LIKE':
        this.emitEvent('like', `${asString(data.uname)} 点赞`, command)
        break

      case 'LIVE_OPEN_PLATFORM_LIVE_ROOM_ENTER':
        this.emitEvent('enter_room', `${asString(data.uname)} 进入房间`, command)
        break

      case 'LIVE_OPEN_PLATFORM_INTERACTION_END':
        // 服务端主动停止推送（多为心跳超时）→ 重新开启项目
        logger.system.warn('[Live][bilibili] 服务端已结束互动，将重新开启项目')
        this.reinitAndReconnect('服务端已结束互动')
        break

      // SUPER_CHAT_DEL / LIVE_START / LIVE_END 等不影响弹幕流，忽略
      default:
        break
    }
  }
}
