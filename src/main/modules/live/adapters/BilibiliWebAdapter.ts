/**
 * B站直播适配器 · 网页模式（web）
 *
 * ⚠️ **合规风险**：网页模式走的是非公开接口（`getDanmuInfo` + 私有弹幕协议），
 * 源项目免责声明专门点名过。因此本适配器的使用门槛是「三重」的：
 *   1. 配置 `bilibiliType = 'web'`
 *   2. 用户显式勾选 `bilibiliWebRiskAccepted`
 *   3. 设置页默认不渲染该选项，需先解锁高级设置
 * 连接时仍会二次校验风险确认，避免配置被手工改写绕过 UI。
 *
 * 对齐源项目 `py/blivedm/clients/web.py` + `py/live_router.py` 的 `WebSocketHandler`：
 *   nav 取 uid → www.bilibili.com 取 buvid3 → get_info 取真实房间号
 *   → wbi 签名后 getDanmuInfo 取 host_list + token → 连 wss://host:wss_port/sub
 *   → AUTH 包（protover=3 → brotli）→ 收包解压 → 递归解包 → 分发命令
 *
 * `getDanmuInfo` 失败时按源项目策略**降级**到默认弹幕服务器（不带 token），
 * 而不是直接判定连接失败 —— 该接口经常需要 wbi 签名才通。
 *
 * @module live/adapters/BilibiliWebAdapter
 */

import { createHash } from 'crypto'
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
// 端点与常量
// ============================================

const NAV_URL = 'https://api.bilibili.com/x/web-interface/nav'
const HOME_URL = 'https://www.bilibili.com/'
const ROOM_INFO_URL = 'https://api.live.bilibili.com/room/v1/Room/get_info'
const DANMU_INFO_URL = 'https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo'

/** 降级用的默认弹幕服务器（对齐源项目 DEFAULT_DANMAKU_SERVER_LIST） */
const DEFAULT_DANMAKU_HOSTS: DanmakuHost[] = [
  { host: 'broadcastlv.chat.bilibili.com', port: 2243, wss_port: 443, ws_port: 2244 },
]

/** wbi mixin key 的混淆表（源项目 WBI_KEY_INDEX_TABLE 原样保留） */
const WBI_KEY_INDEX_TABLE = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28,
  14, 39, 12, 38, 41, 13,
]

/** HTTP 超时（ms） */
const HTTP_TIMEOUT_MS = 10_000
/** 弹幕服务器心跳间隔（ms） */
const WS_HEARTBEAT_INTERVAL_MS = 30_000
/** 握手超时（ms） */
const CONNECT_TIMEOUT_MS = 30_000
/** 压缩包递归深度上限（防御性） */
const MAX_RECURSION_DEPTH = 5

/** 弹幕服务器节点 */
interface DanmakuHost {
  host: string
  port: number
  wss_port: number
  ws_port: number
}

/** getDanmuInfo 返回体 */
interface DanmuInfoData {
  host_list?: DanmakuHost[]
  token?: string
}

/** 通用 B站接口响应壳 */
interface BiliApiResponse<T> {
  code: number
  message?: string
  data?: T
}

// ============================================
// 小工具
// ============================================

function asString(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

/** 从 `key.ext` 形式的 URL 中取去扩展名的文件名（wbi key 提取用） */
function filenameWithoutExt(url: string): string {
  const last = url.split('/').pop() ?? ''
  const dot = last.indexOf('.')
  return dot === -1 ? last : last.slice(0, dot)
}

// ============================================
// Adapter
// ============================================

export class BilibiliWebAdapter extends BaseLiveAdapter {
  readonly platform: LivePlatform = 'bilibili'

  private ws: WebSocket | null = null

  private sessdata = ''
  private uid = 0
  private buvid = ''
  private realRoomId = 0

  private hostList: DanmakuHost[] = []
  private hostToken: string | null = null
  private hostIndex = 0

  /** wbi mixin key（空 = 未取到，签名退化为不带 w_rid） */
  private wbiKey = ''

  private wsHeartbeatTimer: ReturnType<typeof setInterval> | null = null

  // ============================================
  // 连接
  // ============================================

  protected async connect(config: LiveConfig): Promise<void> {
    // 二次校验：即使有人手工改了配置文件，也必须过风险确认这一关
    if (!config.bilibiliWebRiskAccepted) {
      throw new Error('网页模式需先在设置中确认合规风险')
    }

    this.sessdata = config.bilibiliSessdata

    await this.initUid()
    await this.initBuvid()
    await this.initRoomId()
    await this.initHostServer()

    const url = this.pickHostUrl()
    await this.connectWebSocket(url)
  }

  protected async disconnect(): Promise<void> {
    this.clearWsHeartbeat()
    this.closeSocket()

    this.sessdata = ''
    this.uid = 0
    this.buvid = ''
    this.realRoomId = 0
    this.hostList = []
    this.hostToken = null
    this.hostIndex = 0
    this.wbiKey = ''
  }

  // ============================================
  // 初始化（HTTP）
  // ============================================

  /** 请求头：带上 SESSDATA / buvid3（网页模式的接口都依赖 cookie 身份） */
  private buildHeaders(): Record<string, string> {
    const cookies = [`SESSDATA=${this.sessdata}`]
    if (this.buvid) cookies.push(`buvid3=${this.buvid}`)
    return {
      'User-Agent': BILI_USER_AGENT,
      Cookie: cookies.join('; '),
    }
  }

  /** 请求并解包 B站接口响应（code !== 0 → throw，信息里带 code 便于定位） */
  private async requestJson<T>(url: string): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS)

    try {
      const res = await fetch(url, { headers: this.buildHeaders(), signal: controller.signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const json = (await res.json()) as BiliApiResponse<T>
      if (json.code !== 0) {
        throw new Error(`B站接口返回 code=${json.code}${json.message ? `（${json.message}）` : ''}`)
      }
      return json.data as T
    } finally {
      clearTimeout(timer)
    }
  }

  /** 取 uid（未登录时 uid=0）并顺带缓存 wbi key */
  private async initUid(): Promise<void> {
    interface NavData {
      isLogin?: boolean
      mid?: number
      wbi_img?: { img_url?: string; sub_url?: string }
    }

    const data = await this.requestJson<NavData>(NAV_URL)
    this.uid = data?.isLogin && data.mid ? data.mid : 0
    this.wbiKey = this.deriveWbiKey(data?.wbi_img?.img_url, data?.wbi_img?.sub_url)

    if (!this.uid) {
      logger.system.warn(
        '[Live][bilibili] SESSDATA 未登录或已失效，将以游客身份连接（部分事件收不到）',
      )
    }
  }

  /** 由 img_url / sub_url 推导 wbi mixin key（32 位） */
  private deriveWbiKey(imgUrl?: string, subUrl?: string): string {
    if (!imgUrl || !subUrl) return ''
    const shuffled = filenameWithoutExt(imgUrl) + filenameWithoutExt(subUrl)
    let key = ''
    for (const index of WBI_KEY_INDEX_TABLE) {
      if (index < shuffled.length) key += shuffled[index]
    }
    return key
  }

  /** 访问主站拿 buvid3（弹幕接口会校验该风控标识） */
  private async initBuvid(): Promise<void> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS)
    try {
      const res = await fetch(HOME_URL, { headers: this.buildHeaders(), signal: controller.signal })
      const setCookies =
        typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
      for (const raw of setCookies) {
        const match = /(?:^|;\s*)buvid3=([^;]+)/.exec(raw)
        if (match) {
          this.buvid = match[1]
          break
        }
      }
      if (!this.buvid) {
        logger.system.warn('[Live][bilibili] 未能获取 buvid3，弹幕接口可能被风控拦截')
      }
    } catch (err) {
      logger.system.warn('[Live][bilibili] 获取 buvid3 失败：', err)
    } finally {
      clearTimeout(timer)
    }
  }

  /** 短号 → 真实房间号 */
  private async initRoomId(): Promise<void> {
    const tmpRoomId = this.config?.bilibiliRoomId ?? ''
    if (!tmpRoomId) throw new Error('缺少直播间号')

    interface RoomInitData {
      room_id?: number
      uid?: number
    }

    const data = await this.requestJson<RoomInitData>(
      `${ROOM_INFO_URL}?room_id=${encodeURIComponent(tmpRoomId)}`,
    )
    if (!data?.room_id) throw new Error('直播间号无效（get_info 未返回 room_id）')
    this.realRoomId = data.room_id
  }

  /** 取弹幕服务器列表 + token；失败降级到默认节点 */
  private async initHostServer(): Promise<void> {
    try {
      // wbi key 拿不到（未登录）时退化为不带 w_rid 的请求，仍有机会成功
      const query = this.buildWbiQuery({ id: String(this.realRoomId), type: '0' })
      const data = await this.requestJson<DanmuInfoData>(`${DANMU_INFO_URL}?${query}`)

      const hosts = Array.isArray(data?.host_list) ? data.host_list : []
      if (hosts.length === 0) throw new Error('getDanmuInfo 未返回 host_list')

      this.hostList = hosts
      this.hostToken = data.token ?? null
      this.hostIndex = 0
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.system.warn(`[Live][bilibili] 获取弹幕服务器失败，降级到默认节点：${message}`)
      this.hostList = DEFAULT_DANMAKU_HOSTS
      this.hostToken = null
      this.hostIndex = 0
    }
  }

  /** 构造带 wbi 签名的 query（源项目 add_wbi_sign 的等价实现） */
  private buildWbiQuery(params: Record<string, string>): string {
    const wts = String(Math.floor(Date.now() / 1000))
    const toSign: Record<string, string> = { ...params, wts }

    // 1. 过滤 B站 明确要求剔除的字符
    // 2. 按 key 字典序排序后拼成 query（排序即签名内容的一部分）
    const search = new URLSearchParams()
    for (const key of Object.keys(toSign).sort()) {
      search.set(key, toSign[key].replace(/[!'()*]/g, ''))
    }

    if (!this.wbiKey) return search.toString()

    const wRid = createHash('md5').update(search.toString() + this.wbiKey, 'utf-8').digest('hex')
    search.set('w_rid', wRid)
    return search.toString()
  }

  // ============================================
  // 弹幕 WebSocket
  // ============================================

  private pickHostUrl(): string {
    const index = this.hostIndex % this.hostList.length
    this.hostIndex++
    const node = this.hostList[index]
    return `wss://${node.host}:${node.wss_port}/sub`
  }

  private connectWebSocket(url: string): Promise<void> {
    this.closeSocket()

    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url, { headers: { 'User-Agent': BILI_USER_AGENT } })
      this.ws = ws

      void this.waitForConnect(CONNECT_TIMEOUT_MS).then(resolve, reject)

      ws.on('open', () => {
        if (this.ws !== ws) return
        const authParams: Record<string, unknown> = {
          uid: this.uid,
          roomid: this.realRoomId,
          protover: 3, // 3 = brotli：网页端实际使用的压缩方式
          platform: 'web',
          type: 2,
          buvid: this.buvid,
        }
        if (this.hostToken) authParams.key = this.hostToken
        ws.send(packPacket(JSON.stringify(authParams), BiliOperation.AUTH))
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

  // ============================================
  // 报文处理
  // ============================================

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

    switch (cmd) {
      case 'DANMU_MSG':
        this.handleDanmaku(command)
        break

      case 'SEND_GIFT': {
        const data = this.pickObject(command.data)
        this.emitEvent(
          'gift',
          `${asString(data.uname)} 赠送${asString(data.giftName)}x${asNumber(data.num)} （${asString(
            data.coin_type,
          )}瓜子x${asNumber(data.total_coin)}）`,
          command,
        )
        break
      }

      case 'GUARD_BUY': {
        const data = this.pickObject(command.data)
        this.emitEvent(
          'buy_guard',
          `${asString(data.username)} 上舰，大航海等级=${asNumber(data.guard_level)}`,
          command,
        )
        break
      }

      case 'SUPER_CHAT_MESSAGE': {
        const data = this.pickObject(command.data)
        const userInfo = this.pickObject(data.user_info)
        this.emitEvent(
          'super_chat',
          `${asString(userInfo.uname)}发送醒目留言：${asString(data.message)}`,
          command,
        )
        break
      }

      case 'INTERACT_WORD':
        this.handleInteractWord(command)
        break

      default:
        // ONLINE_RANK_* / ENTRY_EFFECT / WIDGET_BANNER 等与弹幕流无关，忽略
        break
    }
  }

  /** DANMU_MSG 的弹幕体是「位置数组」，取值下标固定（对齐源项目 DanmakuMessage.from_command） */
  private handleDanmaku(command: Record<string, unknown>): void {
    const info = command.info
    if (!Array.isArray(info)) return

    const msg = asString(info[1])
    const userPart = info[2]
    const uname = Array.isArray(userPart) ? asString(userPart[1]) : ''
    this.emitEvent('danmaku', `${uname}说：${msg}`, command)
  }

  /** 进场 / 关注（msg_type：1=进入 2=关注，其余类型源项目未处理） */
  private handleInteractWord(command: Record<string, unknown>): void {
    const data = this.pickObject(command.data)
    const uinfo = this.pickObject(data.uinfo)
    const base = this.pickObject(uinfo.base)
    const username = asString(base.name) || asString(data.uname)

    const msgType = asNumber(data.msg_type)
    if (msgType === 1) {
      this.emitEvent('enter_room', `${username} 进入房间`, command)
    } else if (msgType === 2) {
      this.emitEvent('follow', `${username} 关注了你`, command)
    }
  }

  private pickObject(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  }
}
