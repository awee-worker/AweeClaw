/**
 * 预览失效自动关闭
 *
 * AI 执行过程中打开的预览，依赖的东西一旦没了——本地服务被停掉、页面文件或目录
 * 被删除——标签页里只剩一片空白或一句加载失败。这样的标签页没有任何用处，却要
 * 用户自己动手清理，任务结束时往往还挂在编辑器里。
 *
 * 判定分两段：
 * 1. 探活给出「不可用」结论。devServerMonitor 自带失败计数，能躲开构建与重启的
 *    短暂抖动；主动停止进程的路径会要求单次失败即定论。
 * 2. 再等一段宽限期重新复核一次，仍然不可用才真正关闭。宽限期是为「服务正在
 *    重启」「文件正被重写」这类瞬时状态留的恢复窗口。
 *
 * 只处理本地地址：外部站点的网络抖动不该让用户的标签页凭空消失。
 */

import { toast } from '@components/foundation/NotificationProvider'
import { logger } from '@renderer/toolkit/LogEngine'
import { devServerMonitor, type PreviewServerStatus } from './devServerMonitor'
import { previewSessionService } from './previewSessionManager'

/** 判定失效后到真正关闭之间的宽限期 */
const CLOSE_GRACE_MS = 5000

class PreviewAutoClose {
  private started = false
  /** 探活订阅的注销函数；没有预览标签页时保持为 null，计时器随之停掉 */
  private stopMonitor: (() => void) | null = null
  /** 已排期的关闭任务（sessionId → 定时器） */
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>()

  /**
   * 启动守卫（幂等）
   *
   * 首帧还没有预览标签页，这里先只盯会话集合：等真的有标签页了再订阅探活，
   * 避免应用常驻一个每几秒空转的定时器。
   */
  start(): void {
    if (this.started) return
    this.started = true

    previewSessionService.subscribe((state) => {
      if (state.sessions.length > 0) {
        this.attach()
      } else {
        this.detach()
      }
    })
  }

  private attach(): void {
    if (this.stopMonitor) return
    this.stopMonitor = devServerMonitor.subscribe((statuses) => this.sync(statuses))
  }

  private detach(): void {
    this.stopMonitor?.()
    this.stopMonitor = null
    this.pending.forEach((timer) => clearTimeout(timer))
    this.pending.clear()
  }

  /** 按最新探活结论排期或撤销关闭 */
  private sync(statuses: Map<string, PreviewServerStatus>): void {
    statuses.forEach((status, sessionId) => {
      if (status.state === 'down') {
        this.schedule(sessionId, status.error)
      } else {
        this.cancel(sessionId)
      }
    })

    // 会话已经关掉（用户手动关闭等）：挂着的定时器一并撤销
    for (const sessionId of [...this.pending.keys()]) {
      if (!statuses.has(sessionId)) this.cancel(sessionId)
    }
  }

  private schedule(sessionId: string, error?: string): void {
    if (this.pending.has(sessionId)) return

    const timer = setTimeout(() => {
      this.pending.delete(sessionId)
      void this.confirmAndClose(sessionId, error)
    }, CLOSE_GRACE_MS)
    this.pending.set(sessionId, timer)
  }

  private cancel(sessionId: string): void {
    const timer = this.pending.get(sessionId)
    if (!timer) return
    clearTimeout(timer)
    this.pending.delete(sessionId)
  }

  /** 宽限期到点：再复核一次，仍然不可用才关闭标签页 */
  private async confirmAndClose(sessionId: string, error?: string): Promise<void> {
    if (!previewSessionService.getSession(sessionId)) return

    try {
      await devServerMonitor.probeNowStrict()
    } catch {
      // 复核失败按「无法确认恢复」处理，继续走下面的状态判断
    }

    const status = devServerMonitor.getStatus(sessionId)
    if (status?.state !== 'down') return

    const reason = status.error || error || '预览目标已不可用'
    if (!previewSessionService.closeSession(sessionId, 'target-unavailable')) return

    logger.system.info('[PreviewAutoClose] closed unavailable preview', { sessionId, reason })
    toast.info('预览已自动关闭', reason)
  }
}

export const previewAutoClose = new PreviewAutoClose()
