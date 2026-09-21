/**
 * 预览服务存活监控
 *
 * 预览的页面连着本地服务时，服务一停页面就变成空白或加载失败，而内置浏览器只会给
 * 一句笼统的失败提示——用户分不清是「服务挂了」还是「页面写错了」。这里对正在预览的
 * 本地地址做周期探活，把「服务停止 / 已恢复」变成明确状态，并在服务恢复后自动把页面
 * 拉回来。
 *
 * 只探活正在被预览的地址：定时器随订阅者的出现而启动、消失而停止，没有预览标签页时
 * 不做任何探测，也不去盲扫工作区里的候选服务。
 */

import { api } from '@renderer/adapters/electronBridge'
import { previewSessionService } from './previewSessionManager'

/** 探活节拍 */
const PROBE_INTERVAL_MS = 8000
/** 单次探活超时 */
const PROBE_TIMEOUT_MS = 2500
/** 连续失败达到该次数才判定服务停止：躲开构建 / 重启期的短暂不可用 */
const FAILURE_THRESHOLD = 2
/** 只探活本地回环地址 */
const LOCAL_URL_PATTERN = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:[/?#]|$)/i

export type PreviewServerState = 'unknown' | 'alive' | 'down'

export interface PreviewServerStatus {
  sessionId: string
  url: string
  state: PreviewServerState
  /** 最近一次探活时间 */
  checkedAt: number
  /** 判定为停止时的说明 */
  error?: string
}

type StatusListener = (statuses: Map<string, PreviewServerStatus>) => void

/** 是否是需要探活的本地地址 */
export function isLocalPreviewUrl(url: string): boolean {
  return LOCAL_URL_PATTERN.test(url)
}

class DevServerMonitor {
  private readonly listeners = new Set<StatusListener>()
  private readonly statuses = new Map<string, PreviewServerStatus>()
  /** 连续失败次数：一旦探活成功即清零 */
  private readonly failures = new Map<string, number>()
  private timer: ReturnType<typeof setInterval> | null = null
  /** 上一拍未结束时不再并发下一拍，避免慢服务把请求堆起来 */
  private probing = false

  subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener)
    listener(this.statuses)
    this.ensureTimer()

    return () => {
      this.listeners.delete(listener)
      this.releaseTimer()
    }
  }

  getStatus(sessionId: string): PreviewServerStatus | undefined {
    return this.statuses.get(sessionId)
  }

  /** 立即探活一轮（用户点「重新检测」时调用） */
  async probeNow(): Promise<void> {
    await this.tick()
  }

  private ensureTimer(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.tick(), PROBE_INTERVAL_MS)
    void this.tick()
  }

  private releaseTimer(): void {
    if (this.listeners.size > 0 || !this.timer) return
    clearInterval(this.timer)
    this.timer = null
  }

  private async tick(): Promise<void> {
    if (this.probing) return
    this.probing = true

    try {
      const sessions = previewSessionService.getState().sessions
      this.prune(new Set(sessions.map((session) => session.id)))

      await Promise.all(
        sessions
          .filter((session) => isLocalPreviewUrl(session.url))
          .map((session) => this.probeSession(session.id, session.url)),
      )
    } finally {
      this.probing = false
    }
  }

  private async probeSession(sessionId: string, url: string): Promise<void> {
    const previous = this.statuses.get(sessionId)
    const alive = await this.isAlive(url)

    if (alive) {
      this.failures.delete(sessionId)
      this.setStatus({ sessionId, url, state: 'alive', checkedAt: Date.now() })

      // 从「停止」恢复：页面还停在失败状态，主动拉回来
      if (previous?.state === 'down') {
        previewSessionService.reload(sessionId)
      }
      return
    }

    const failures = (this.failures.get(sessionId) || 0) + 1
    this.failures.set(sessionId, failures)

    // 首次探活就失败：没有「之前是活的」可对比（例如重启后恢复出来的标签页），
    // 直接给结论，不必让用户等满两拍才看到「服务未启动」
    const threshold = previous ? FAILURE_THRESHOLD : 1
    if (failures < threshold) return

    this.setStatus({
      sessionId,
      url,
      state: 'down',
      checkedAt: Date.now(),
      error: '本地服务无响应',
    })
  }

  /** 地址是否可达（只关心连通性，不关心返回内容） */
  private async isAlive(url: string): Promise<boolean> {
    try {
      const result = await api.http.readUrl(url, PROBE_TIMEOUT_MS)
      return Boolean(result?.success)
    } catch {
      return false
    }
  }

  /** 记录状态并通知订阅者（状态未变化时不通知，避免每拍都触发重渲染） */
  private setStatus(status: PreviewServerStatus): void {
    const previous = this.statuses.get(status.sessionId)
    this.statuses.set(status.sessionId, status)

    if (previous?.state === status.state) return
    this.listeners.forEach((listener) => listener(this.statuses))
  }

  /** 丢弃已不存在会话的状态，避免 Map 只增不减 */
  private prune(liveSessionIds: Set<string>): void {
    for (const sessionId of [...this.statuses.keys()]) {
      if (liveSessionIds.has(sessionId)) continue
      this.statuses.delete(sessionId)
      this.failures.delete(sessionId)
    }
  }
}

export const devServerMonitor = new DevServerMonitor()
