/**
 * 悬浮层 WebSocket 广播器（主进程）
 *
 * 与源项目 `py/overlay_router.py` 的 DanmakuOverlayManager 等价：
 * 维护所有已连接的悬浮页面，把指令 JSON 广播出去。
 *
 * 与 HTTP 服务共用一个端口：
 *   OverlayHttpServer 负责 http.createServer，升级请求（upgrade）转发到本类。
 *
 * 设计要点（对齐源项目的两处实现细节）：
 * 1. 广播时遍历连接列表的**副本**，避免发送失败时在迭代中删元素导致状态错乱
 * 2. 发送失败即断开并移除，不抛出到调用方（悬浮层掉线不应影响业务主流程）
 *
 * @module overlay/OverlayBroadcaster
 */

import type { IncomingMessage } from 'http'
import type { Duplex } from 'stream'
import { WebSocketServer, WebSocket } from 'ws'
import { logger } from '@shared/toolkit/LogEngine'
import type { OverlayCommand, OverlayEventPayload } from './types'

/** WS 路径（与 HTTP 服务同端口，用路径区分） */
export const OVERLAY_WS_PATH = '/ws/overlay'

export class OverlayBroadcaster {
  private wss: WebSocketServer | null = null

  /** 启动 WS 服务（noServer 模式，由外部 HTTP 服务驱动升级） */
  start(): void {
    if (this.wss) return
    // noServer：不自己监听端口，只处理升级请求，便于与 HTTP 服务共端口
    this.wss = new WebSocketServer({ noServer: true })
    logger.system.info('[Overlay] WebSocket broadcaster ready on', OVERLAY_WS_PATH)
  }

  /** 停止 WS 服务并断开所有连接 */
  stop(): void {
    if (!this.wss) return
    for (const client of this.wss.clients) {
      try {
        client.close(1001, 'server shutting down')
      } catch {
        /* 连接已失效，忽略 */
      }
    }
    try {
      this.wss.close()
    } catch (err) {
      logger.system.warn('[Overlay] close wss failed:', err)
    }
    this.wss = null
  }

  /**
   * 处理 HTTP 升级请求。
   *
   * 只接受 `OVERLAY_WS_PATH`；其余路径直接销毁 socket，
   * 避免未授权路径占用长连接。
   */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    if (!this.wss) {
      socket.destroy()
      return
    }

    let pathname = ''
    try {
      pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname
    } catch {
      socket.destroy()
      return
    }

    if (pathname !== OVERLAY_WS_PATH) {
      socket.destroy()
      return
    }

    this.wss.handleUpgrade(req, socket, head, ws => {
      this.wss?.emit('connection', ws, req)
      this.attach(ws)
    })
  }

  /** 绑定单个连接的生命周期 */
  private attach(ws: WebSocket): void {
    logger.system.info('[Overlay] client connected, total =', this.getClientCount())

    ws.on('message', (raw: unknown) => {
      // 悬浮页面只接收指令，不上报业务数据；
      // 但需要响应 ping 之类的探活消息，避免 OBS 端判定连接僵死
      const text = typeof raw === 'string' ? raw : String(raw)
      if (text.trim() === 'ping') {
        try {
          ws.send(JSON.stringify({ action: 'pong' }))
        } catch {
          /* 忽略发送失败 */
        }
      }
    })

    ws.on('close', () => {
      logger.system.info('[Overlay] client disconnected, total =', this.getClientCount())
    })

    ws.on('error', err => {
      logger.system.warn('[Overlay] client error:', err instanceof Error ? err.message : err)
    })
  }

  /** 广播指令（副本遍历 + 失败即摘除） */
  broadcast(command: OverlayCommand): number {
    if (!this.wss) return 0

    const payload = JSON.stringify(command)
    let sent = 0

    for (const client of [...this.wss.clients]) {
      // 只发给已完全握手的连接，避免 OPENING 状态下 send 抛错
      if (client.readyState !== WebSocket.OPEN) continue
      try {
        client.send(payload)
        sent++
      } catch (err) {
        logger.system.warn('[Overlay] broadcast failed, dropping client:', err)
        try {
          client.terminate()
        } catch {
          /* 忽略 */
        }
      }
    }

    return sent
  }

  /** 推送一条事件（封装成 show 指令） */
  show(data: OverlayEventPayload): number {
    return this.broadcast({ action: 'show', data })
  }

  /** 清空悬浮层 */
  clear(): number {
    return this.broadcast({ action: 'clear' })
  }

  /** 当前连接数（状态接口 / 日志用） */
  getClientCount(): number {
    return this.wss ? this.wss.clients.size : 0
  }

  /** 是否已启动 */
  isRunning(): boolean {
    return this.wss !== null
  }
}

/** 单例（主进程内共享） */
let instance: OverlayBroadcaster | null = null

export function getOverlayBroadcaster(): OverlayBroadcaster {
  if (!instance) instance = new OverlayBroadcaster()
  return instance
}
