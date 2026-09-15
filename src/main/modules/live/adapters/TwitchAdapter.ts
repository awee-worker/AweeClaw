/**
 * Twitch 直播适配器（IRC over WebSocket）
 *
 * 对齐源项目 `py/twitch_service.py`。无合规风险：Twitch 官方提供公开的
 * IRC 聊天入口，只读弹幕**无需 token**（匿名 `justinfanNNNNN` 登录即可）。
 *
 * 连接：`wss://irc-ws.chat.twitch.tv:443`
 *   CAP REQ :twitch.tv/tags twitch.tv/commands   ← tags 是拿到 display-name 的关键
 *   PASS oauth:<token>（仅当同时提供登录名时；NICK 必须与 token 归属一致）
 *   NICK <login|justinfanNNNNN>
 *   JOIN #<channel>
 *
 * 保活：必须响应服务端 `PING` → `PONG`，否则约 5 分钟被断开；
 * 另外每 4 分钟主动发一次 `PING` 让链路保持活跃。
 *
 * 类型映射（与源项目一致，把 Twitch 语义对齐到 B站的七类）：
 *   PRIVMSG                        → danmaku
 *   USERNOTICE sub / resub         → buy_guard（订阅 ⇔ 上舰）
 *   USERNOTICE subgift / …         → gift
 *   USERNOTICE raid                → enter_room
 *   USERNOTICE announcement        → danmaku（带 [Announcement] 前缀）
 *
 * @module live/adapters/TwitchAdapter
 */

import { WebSocket } from 'ws'
import { logger } from '@shared/toolkit/LogEngine'
import type { LiveConfig, LiveDanmuType, LivePlatform } from '../types'
import { BaseLiveAdapter } from './BaseLiveAdapter'

// ============================================
// 常量
// ============================================

const TWITCH_IRC_URL = 'wss://irc-ws.chat.twitch.tv:443'

/** 握手超时（ms） */
const CONNECT_TIMEOUT_MS = 20_000
/** 主动保活间隔（ms） */
const KEEPALIVE_INTERVAL_MS = 4 * 60 * 1000

/** 订阅类 msg-id → buy_guard */
const GUARD_MSG_IDS = new Set(['sub', 'resub'])
/** 赠礼类 msg-id → gift */
const GIFT_MSG_IDS = new Set(['subgift', 'anonsubgift', 'submysterygift'])

// ============================================
// 工具
// ============================================

/** IRCv3 标签值反转义（\\s → 空格，\\: → 分号，\\r / \\n 同理） */
function unescapeTagValue(value: string): string {
  return value
    .replace(/\\s/g, ' ')
    .replace(/\\:/g, ';')
    .replace(/\\r/g, '\r')
    .replace(/\\n/g, '\n')
}

/** 解析 `key=value;key=value` 形式的 IRCv3 标签串 */
function parseTags(tagString: string): Record<string, string> {
  const tags: Record<string, string> = {}
  for (const pair of tagString.split(';')) {
    if (!pair) continue
    const eq = pair.indexOf('=')
    if (eq === -1) continue
    tags[pair.slice(0, eq)] = unescapeTagValue(pair.slice(eq + 1))
  }
  return tags
}

// ============================================
// Adapter
// ============================================

export class TwitchAdapter extends BaseLiveAdapter {
  readonly platform: LivePlatform = 'twitch'

  private ws: WebSocket | null = null
  private channel = ''

  private keepaliveTimer: ReturnType<typeof setInterval> | null = null

  // ============================================
  // 连接
  // ============================================

  protected async connect(config: LiveConfig): Promise<void> {
    const channel = config.twitchChannel.trim().replace(/^#/, '').toLowerCase()
    if (!channel) throw new Error('缺少 Twitch 频道名')

    this.channel = channel
    await this.connectWebSocket(TWITCH_IRC_URL, config)
  }

  protected async disconnect(): Promise<void> {
    this.clearKeepalive()
    this.closeSocket()
    this.channel = ''
  }

  /** 决定用哪个 NICK，以及是否需要发 PASS */
  private resolveCredentials(config: LiveConfig): { nick: string; pass: string | null } {
    const login = config.twitchUsername.trim().replace(/^#/, '').toLowerCase()
    const token = config.twitchAccessToken.trim().replace(/^oauth:/, '')

    if (token && login) {
      return { nick: login, pass: `oauth:${token}` }
    }

    if (token && !login) {
      logger.system.warn(
        '[Live][twitch] 提供了 Token 但未填写登录名，已按匿名只读模式连接（NICK 必须与 Token 归属一致）',
      )
    }

    // 匿名只读：Twitch 要求形如 justinfan12345 的昵称
    return { nick: `justinfan${Math.floor(10000 + Math.random() * 89999)}`, pass: null }
  }

  private connectWebSocket(url: string, config: LiveConfig): Promise<void> {
    this.closeSocket()

    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url)
      this.ws = ws

      void this.waitForConnect(CONNECT_TIMEOUT_MS).then(resolve, reject)

      let buffer = ''

      ws.on('open', () => {
        if (this.ws !== ws) return

        const { nick, pass } = this.resolveCredentials(config)
        ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands\r\n')
        if (pass) ws.send(`PASS ${pass}\r\n`)
        ws.send(`NICK ${nick}\r\n`)
        ws.send(`JOIN #${this.channel}\r\n`)

        this.startKeepalive(ws)
      })

      ws.on('message', (data: unknown) => {
        if (this.ws !== ws || this.stopped) return

        buffer += typeof data === 'string' ? data : Buffer.from(data as ArrayBuffer).toString('utf-8')

        // IRC 以 \r\n 分行；最后一段可能是半行，留在 buffer 里等下一帧
        let index = buffer.indexOf('\r\n')
        while (index !== -1) {
          const line = buffer.slice(0, index)
          buffer = buffer.slice(index + 2)
          if (line) this.handleLine(ws, line)
          index = buffer.indexOf('\r\n')
        }
      })

      ws.on('error', (err: Error) => {
        if (this.ws !== ws || this.stopped) return
        logger.system.warn('[Live][twitch] 连接异常：', err.message)
      })

      ws.on('close', () => {
        if (this.ws !== ws) return
        this.ws = null
        this.clearKeepalive()
        if (this.stopped) return

        const reason = 'Twitch 连接已断开'
        if (this.isConnectPending()) this.rejectConnect(new Error(reason))
        else this.fail(new Error(reason))
      })
    })
  }

  private closeSocket(): void {
    this.clearKeepalive()
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

  private startKeepalive(ws: WebSocket): void {
    this.clearKeepalive()
    this.keepaliveTimer = setInterval(() => {
      if (this.ws !== ws || ws.readyState !== WebSocket.OPEN) return
      try {
        // 主动 PING 让链路保持活跃（服务端 PING 由 handleLine 里的 PONG 响应）
        ws.send('PING :keepalive\r\n')
      } catch (err) {
        logger.system.warn('[Live][twitch] 保活失败：', err)
      }
    }, KEEPALIVE_INTERVAL_MS)
  }

  private clearKeepalive(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer)
      this.keepaliveTimer = null
    }
  }

  // ============================================
  // IRC 行处理
  // ============================================

  private handleLine(ws: WebSocket, rawLine: string): void {
    let line = rawLine

    // 1. 服务端 PING：必须立刻 PONG，否则被断开
    if (line.startsWith('PING')) {
      this.sendRaw(ws, `PONG ${line.slice(4)}`)
      return
    }

    // 2. IRCv3 标签（@tags 前缀）
    let tags: Record<string, string> = {}
    if (line.startsWith('@')) {
      const spaceIndex = line.indexOf(' ')
      if (spaceIndex === -1) return
      tags = parseTags(line.slice(1, spaceIndex))
      line = line.slice(spaceIndex + 1)
    }

    // 3. 识别命令
    const parts = line.split(' ')
    let command = ''
    for (const part of parts) {
      if (part === 'PRIVMSG' || part === 'USERNOTICE' || part === 'CLEARCHAT' || part === 'NOTICE') {
        command = part
        break
      }
    }

    // 4. 登录成功（`:tmi.twitch.tv 001 <nick> :Welcome, GLHF!`）→ 握手完成
    if (parts[1] === '001') {
      this.resolveConnect()
      return
    }

    if (!command) return

    if (command === 'NOTICE') {
      const text = this.extractTrailing(line)
      if (/login authentication failed|improperly formatted auth/i.test(text)) {
        const error = new Error(`Twitch 登录失败：${text}`)
        if (this.isConnectPending()) this.rejectConnect(error)
        else this.fail(error)
        return
      }
      // 其余 NOTICE（例如频道不存在）只记日志
      if (text) logger.system.warn(`[Live][twitch] NOTICE：${text}`)
      return
    }

    if (command === 'CLEARCHAT') return

    const user = tags['display-name'] || tags.login || 'System'

    if (command === 'PRIVMSG') {
      const message = this.extractTrailing(line)
      this.emitEvent('danmaku', `${user}: ${message}`, { tags, raw: rawLine })
      return
    }

    // USERNOTICE：订阅 / 赠礼 / 突袭 / 公告
    this.handleUserNotice(tags, line, user, rawLine)
  }

  private handleUserNotice(
    tags: Record<string, string>,
    line: string,
    user: string,
    rawLine: string,
  ): void {
    const msgId = tags['msg-id'] ?? ''
    const systemMsg = tags['system-msg'] ?? ''
    const userText = this.extractTrailing(line)

    let danmuType: LiveDanmuType = 'danmaku'
    let content = ''

    if (GUARD_MSG_IDS.has(msgId)) {
      // 订阅 / 续订 → 对齐 B站「上舰」
      danmuType = 'buy_guard'
      content = userText ? `${systemMsg} | Message: ${userText}` : systemMsg
    } else if (GIFT_MSG_IDS.has(msgId)) {
      // 赠送订阅 → 对齐 B站「礼物」
      danmuType = 'gift'
      content = systemMsg
    } else if (msgId === 'raid') {
      // 突袭（其它主播带人进场）→ 对齐 B站「进场」
      danmuType = 'enter_room'
      content = systemMsg
    } else if (msgId === 'announcement') {
      danmuType = 'danmaku'
      content = `[Announcement] ${userText}`
    } else {
      danmuType = 'danmaku'
      content = systemMsg || userText
    }

    this.emitEvent(danmuType, content, { tags, user, raw: rawLine })
  }

  /** 取 IRC 行里 ` :` 之后的全部内容（消息体） */
  private extractTrailing(line: string): string {
    const index = line.indexOf(' :')
    return index === -1 ? '' : line.slice(index + 2)
  }

  private sendRaw(ws: WebSocket, payload: string): void {
    if (ws.readyState !== WebSocket.OPEN) return
    try {
      ws.send(`${payload}\r\n`)
    } catch (err) {
      logger.system.warn('[Live][twitch] 发送失败：', err)
    }
  }
}
