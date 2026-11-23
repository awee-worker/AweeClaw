/**
 * 预览服务存活监控
 *
 * 预览的页面连着本地服务时，服务一停页面就变成空白或加载失败，而内置浏览器只会给
 * 一句笼统的失败提示——用户分不清是「服务挂了」还是「页面写错了」。这里对正在预览的
 * 本地地址做周期探活，把「服务停止 / 已恢复」变成明确状态，并在服务恢复后自动把页面
 * 拉回来。
 *
 * 只探活正在被预览的地址：定时器随订阅者的出现而启动、消失而停止，没有预览标签页时
 * 不做任何探测，也不去盲扫工作空间里的候选服务。
 */

import { api } from '@renderer/adapters/electronBridge'
import type { PreviewSession } from '@shared/protocols/previewProtocol'
import { normalizeFilePath } from '@shared/toolkit/pathHelper'
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

  /**
   * 立即探活一轮，并要求单次失败即下定论
   *
   * 主动停止进程（stop_terminal / Ctrl+C）后调用：这次不可达是确定的结果，
   * 不是在构建或重启，没必要再攒够两次失败才承认服务已经停了。
   */
  async probeNowStrict(): Promise<void> {
    await this.tick(true)
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

  private async tick(strict = false): Promise<void> {
    if (this.probing) return
    this.probing = true

    try {
      const sessions = previewSessionService.getState().sessions
      this.prune(new Set(sessions.map((session) => session.id)))

      await Promise.all(
        sessions
          .filter((session) => isLocalPreviewUrl(session.url))
          .map((session) => this.probeSession(session, strict)),
      )
    } finally {
      this.probing = false
    }
  }

  private async probeSession(session: PreviewSession, strict: boolean): Promise<void> {
    const sessionId = session.id
    const url = session.url
    const previous = this.statuses.get(sessionId)
    const verdict = await this.checkTarget(session)

    if (verdict.alive) {
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
    // 直接给结论，不必让用户等满两拍才看到「服务未启动」。
    // strict 用于主动停止进程后的复核：那一次不可达是确定结果，不需要再攒次数。
    const threshold = strict || !previous ? 1 : FAILURE_THRESHOLD
    if (failures < threshold) return

    this.setStatus({
      sessionId,
      url,
      state: 'down',
      checkedAt: Date.now(),
      error: verdict.error || '本地服务无响应',
    })
  }

  /**
   * 判断一次预览是否仍然有效
   *
   * 本地静态页面走磁盘核对：静态服务在页面文件被删之后照样回 404 正文，
   * 而 404 在内容读取里同样算「读到了东西」——探活读不出服务与页面的差别。
   * 服务类预览（dev server）仍按连通性判断。
   */
  private async checkTarget(session: PreviewSession): Promise<{ alive: boolean; error?: string }> {
    const localTarget = session.localPath || session.previewRoot
    if (localTarget) {
      if (!(await this.exists(localTarget))) {
        return {
          alive: false,
          error: session.localPath ? '预览的页面已被删除' : '预览目录已不存在',
        }
      }

      // 目录预览还要核对当前地址对应的页面文件：目录还在、index.html 被删掉时
      // 上面那一步是查不出来的，而那正是「AI 删掉页面」最常见的样子
      const pageFile = this.resolveLocalPageFile(session)
      if (pageFile && !(await this.exists(pageFile))) {
        return { alive: false, error: '预览的页面已被删除' }
      }
      return { alive: true }
    }

    const alive = await this.isAlive(session.url)
    return { alive, error: alive ? undefined : '本地服务无响应' }
  }

  /** 目标路径是否仍然存在（目录或可预览的页面文件） */
  private async exists(target: string): Promise<boolean> {
    try {
      const resolved = await api.preview.resolveLocalUrl(target)
      return Boolean(resolved?.success)
    } catch {
      return false
    }
  }

  /**
   * 由预览地址反推它在预览根目录下的页面文件
   *
   * 只认页面类扩展名：地址落在别的资源上（图片/接口）时无法据此判断页面是否被删，
   * 交给目录存在性那一步即可，避免误判成失效。
   */
  private resolveLocalPageFile(session: PreviewSession): string | null {
    if (!session.previewRoot) return null

    let pathname: string
    try {
      pathname = decodeURIComponent(new URL(session.url).pathname)
    } catch {
      return null
    }

    const relative = !pathname || pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
    if (!/\.(html?|svg)$/i.test(relative)) return null

    return `${normalizeFilePath(session.previewRoot)}/${relative}`
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
