import { useStore } from '@store'
import type { OpenPreviewMetadata, PreviewAutoReloadPayload, PreviewHealthSnapshot, PreviewServerCandidate, PreviewSession, PreviewSessionStatus } from '@shared/protocols/previewProtocol'
import { buildPreviewDocumentPath, parsePreviewDocumentPath } from '@shared/protocols/previewProtocol'
import { api } from '@renderer/adapters/electronBridge'
import { devServerDiscoveryService } from './devServerLocator'
import { recordPreview } from './previewHistory'

interface PreviewSessionState {
  sessions: PreviewSession[]
}

type PreviewSessionListener = (state: PreviewSessionState) => void

function createSessionTitle(candidate: PreviewServerCandidate | null, url: string): string {
  if (candidate?.title?.trim()) {
    return candidate.title.trim()
  }

  try {
    const parsed = new URL(url)
    return parsed.port ? `Preview ${parsed.port}` : `Preview ${parsed.host}`
  } catch {
    return 'Preview'
  }
}

/** 取地址的 origin（协议 + 主机 + 端口）；无法解析时返回 null */
function originOf(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

export class PreviewSessionService {
  private readonly listeners = new Set<PreviewSessionListener>()
  private readonly sessions = new Map<string, PreviewSession>()
  private readonly sessionByUrl = new Map<string, string>()
  private state: PreviewSessionState = { sessions: [] }
  /** 健康推送订阅是否已建立（只需一次） */
  /** 健康推送订阅是否已建立（只需一次） */
  private healthBridgeAttached = false
  /** 自动刷新订阅是否已建立（只需一次） */
  private autoReloadBridgeAttached = false
  subscribe(listener: PreviewSessionListener): () => void {
    this.ensureHealthBridge()
    this.ensureHealthBridge()
    this.ensureAutoReloadBridge()
    listener(this.state)
    return () => this.listeners.delete(listener)
  }

  getState(): PreviewSessionState {
    return this.state
  }

  getSession(sessionId: string): PreviewSession | null {
    return this.sessions.get(sessionId) || null
  }

  getSessionByPath(path: string): PreviewSession | null {
    const parsed = parsePreviewDocumentPath(path)
    return parsed ? this.getSession(parsed.sessionId) : null
  }

  async openPreferredPreview(workspaceRoots: string[]): Promise<PreviewSession | null> {
    await devServerDiscoveryService.refresh(workspaceRoots)
    const workspaceRoot = workspaceRoots[0] || undefined
    const candidate = devServerDiscoveryService.getPreferredCandidate(workspaceRoot)
    if (!candidate) {
      return null
    }
    return this.openCandidate(candidate)
  }

  openCandidate(candidate: PreviewServerCandidate, options?: { activate?: boolean }): PreviewSession {
    return this.openUrl(candidate.url, {
      title: createSessionTitle(candidate, candidate.url),
      source: candidate.source,
      workspaceRoot: candidate.workspaceRoot,
      candidateId: candidate.id,
      activate: options?.activate,
    })
  }

  openUrl(
    url: string,
    options: {
      title?: string
      source?: PreviewSession['source']
      workspaceRoot?: string
      candidateId?: string
      activate?: boolean
      /** 强制创建新会话，不复用同 URL 的已有会话（用于「新建标签页」） */
      forceNew?: boolean
      /** 静态预览的根目录（本地文件预览才有，用于目录变化后自动刷新） */
      previewRoot?: string
    } = {},
  ): PreviewSession {
    this.ensureHealthBridge()
    this.ensureAutoReloadBridge()
    if (!options.forceNew) {
      const existingSessionId = this.sessionByUrl.get(url)
      if (existingSessionId) {
        const existingSession = this.sessions.get(existingSessionId)
        if (existingSession) {
          this.activateSession(existingSession, options.activate)
          return existingSession
        }
      }

      // 服务类预览（非本地文件）：同一个 host:port 只该占一个标签页，地址变化走导航，
      // 免得为一个 dev server 攒出一排标签页。
      // 本地文件预览不合并：同目录下的多个页面是并列关系，各自保有标签页。
      if (!options.previewRoot) {
        const merged = this.findSessionByOrigin(url)
        if (merged) {
          this.navigate(merged.id, url)
          const next = this.sessions.get(merged.id) || merged
          this.activateSession(next, options.activate)
          return next
        }
      }
    }

    const session: PreviewSession = {
      id: crypto.randomUUID(),
      url,
      title: options.title || createSessionTitle(null, url),
      source: options.source || 'manual',
      status: 'loading',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      reloadToken: 0,
      workspaceRoot: options.workspaceRoot,
      candidateId: options.candidateId,
      previewRoot: options.previewRoot,
    }

    this.sessions.set(session.id, session)
    // forceNew 时不写入 sessionByUrl，避免多个同 URL 新标签页互相覆盖映射
    if (!options.forceNew) {
      this.sessionByUrl.set(session.url, session.id)
    }
    this.rebuildState()
    this.emit()

    this.activateSession(session, options.activate)
    recordPreview({
      url: session.url,
      title: session.title,
      source: session.source,
      previewRoot: session.previewRoot,
    })

    return session

    return session
  }

  restoreSession(preview: OpenPreviewMetadata): void {
    const existing = this.sessions.get(preview.sessionId)
    if (existing) {
      return
    }

    const session: PreviewSession = {
      id: preview.sessionId,
      url: preview.url,
      title: preview.title,
      source: preview.source,
      status: 'loading',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      reloadToken: 0,
      workspaceRoot: preview.workspaceRoot,
      candidateId: preview.candidateId,
      previewRoot: preview.previewRoot,
    }

    this.sessions.set(session.id, session)
    this.sessionByUrl.set(session.url, session.id)
    this.rebuildState()
    this.emit()

    // 本地文件预览的地址是一次性的：静态服务重启后端口会变、根目录登记也会清空，
    // 把旧地址直接喂给 webview 只会得到 404。先按旧值建会话让界面立刻有反馈，
    // 再异步凭目录重新解析出可用地址。
    if (preview.previewRoot) {
      void this.rebindLocalPreview(session.id, preview.previewRoot)
    }
  }

  /** 重新解析本地预览地址（静态服务的端口与根目录登记都是运行期状态） */
  private async rebindLocalPreview(sessionId: string, previewRoot: string): Promise<void> {
    try {
      const resolved = await api.preview.resolveLocalUrl(previewRoot)
      if (!resolved?.success || !resolved.url) {
        return
      }
      if (!this.sessions.has(sessionId)) {
        return
      }

      this.navigate(sessionId, resolved.url)
      void api.preview.watchAutoReload(previewRoot, resolved.url)
    } catch {
      // 目录已不存在等情况下保持原地址，由探活与健康状态给出提示
    }
  }

  markStatus(sessionId: string, status: PreviewSessionStatus, error?: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return
    }

    this.sessions.set(sessionId, {
      ...session,
      status,
      lastError: error,
      updatedAt: Date.now(),
    })
    this.rebuildState()
    this.emit()
  }

  updateTitle(sessionId: string, title: string): void {
    const session = this.sessions.get(sessionId)
    if (!session || !title.trim() || session.title === title.trim()) {
      return
    }

    const nextSession = {
      ...session,
      title: title.trim(),
      updatedAt: Date.now(),
    }
    this.sessions.set(sessionId, nextSession)
    this.rebuildState()
    this.emit()

    const previewPath = buildPreviewDocumentPath(sessionId)
    useStore.getState().updatePreviewMetadata(previewPath, { title: nextSession.title })
  }

  navigate(sessionId: string, url: string): void {
    const session = this.sessions.get(sessionId)
    if (!session || !url.trim()) {
      return
    }

    if (session.url !== url) {
      this.sessionByUrl.delete(session.url)
      this.sessionByUrl.set(url, session.id)
    }

    const nextSession = {
      ...session,
      url,
      status: 'loading' as const,
      updatedAt: Date.now(),
    }
    this.sessions.set(sessionId, nextSession)
    this.rebuildState()
    this.emit()

    const previewPath = buildPreviewDocumentPath(sessionId)
    useStore.getState().updatePreviewMetadata(previewPath, { url })
  }

  reload(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return
    }

    this.sessions.set(sessionId, {
      ...session,
      status: 'loading',
      reloadToken: session.reloadToken + 1,
      updatedAt: Date.now(),
    })
    this.rebuildState()
    this.emit()
  }

  /**
   * 同步 webview 派生状态（canGoBack/canGoForward/devtoolsOpen/zoomFactor）
   *
   * 仅更新内存 sessions Map，不调用 useStore.updatePreviewMetadata，
   * 避免导航状态频繁变更导致持久化抖动。这些字段为运行时态，无需持久化。
   */
  syncWebviewState(
    sessionId: string,
    partial: Pick<PreviewSession, 'canGoBack' | 'canGoForward' | 'devtoolsOpen' | 'zoomFactor'>,
  ): void {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return
    }

    this.sessions.set(sessionId, {
      ...session,
      ...partial,
      updatedAt: Date.now(),
    })
    this.rebuildState()
    this.emit()
  }

  /** 激活（或复用）标签页：统一 openPreview 的调用点 */
  private activateSession(session: PreviewSession, activate?: boolean): void {
    useStore.getState().openPreview(
      {
        sessionId: session.id,
        url: session.url,
        title: session.title,
        source: session.source,
        workspaceRoot: session.workspaceRoot,
        candidateId: session.candidateId,
        previewRoot: session.previewRoot,
      },
      { activate },
    )
  }

  /**
   * 找出与目标地址同源的「服务类」预览会话
   *
   * 本地文件预览（带 previewRoot）不参与匹配：同一个目录下的多个页面是并列关系，
   * 不该被折叠成一个标签页。
   */
  private findSessionByOrigin(url: string): PreviewSession | null {
    const origin = originOf(url)
    if (!origin) {
      return null
    }

    // state.sessions 已按 updatedAt 降序，命中的就是最近使用的那一个
    return (
      this.state.sessions.find(
        (session) => !session.previewRoot && originOf(session.url) === origin,
      ) || null
    )
  }

  /**
   * 应用健康快照
   *
   * 健康数据是运行时态：只更新内存 sessions，不写回持久化元数据，
   * 避免高频推送引起持久化抖动。
   */
  applyHealth(snapshot: PreviewHealthSnapshot): void {
    const session = this.sessions.get(snapshot.sessionId)
    if (!session) {
      return
    }

    this.sessions.set(snapshot.sessionId, {
      ...session,
      health: snapshot,
      updatedAt: Date.now(),
    })
    this.rebuildState()
    this.emit()
  }

  /**
   * 记录会话对应的 webview guest id
   *
   * 只维护在内存态：AI 侧按需采集资源瀑布时用它定位 guest，
   * 而 guest id 每次挂载都会变，不适合持久化。
   */
  setGuestId(sessionId: string, guestId: number | null): void {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return
    }

    this.sessions.set(sessionId, {
      ...session,
      guestId: guestId ?? undefined,
      updatedAt: Date.now(),
    })
    this.rebuildState()
    this.emit()
  }

  /**
   * 建立健康推送订阅（幂等）
   *
   * 主进程在采集到变化时按会话推送快照，订阅在服务首次被使用时建立。
   */
  private ensureHealthBridge(): void {
    if (this.healthBridgeAttached) {
      return
    }

    try {
      api.preview.onHealth((snapshot) => this.applyHealth(snapshot))
      this.healthBridgeAttached = true
    } catch {
      // preload 未就绪（如单测环境）时忽略，健康数据退化为不可用
    }
  }

  /**
   * 建立自动刷新订阅（幂等）
   *
   * 主进程监听预览目录，命中文件改动后推送需要重载的地址；
   * 这里按地址找回会话并走常规 reload（复用 reloadToken 机制，不新增刷新通道）。
   */
  private ensureAutoReloadBridge(): void {
    if (this.autoReloadBridgeAttached) {
      return
    }

    try {
      api.preview.onAutoReload((payload) => this.applyAutoReload(payload))
      this.autoReloadBridgeAttached = true
    } catch {
      // preload 未就绪（如单测环境）时忽略
    }
  }

  /** 目录内文件变动：按地址命中会话并重载 */
  private applyAutoReload(payload: PreviewAutoReloadPayload): void {
    const urls = payload?.urls
    if (!Array.isArray(urls) || urls.length === 0) {
      return
    }

    urls.forEach((url) => {
      const sessionId = this.sessionByUrl.get(url)
      if (sessionId) {
        this.reload(sessionId)
      }
    })
  }

  private rebuildState(): void {
    this.state = {
      sessions: [...this.sessions.values()].sort((left, right) => right.updatedAt - left.updatedAt),
    }
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener(this.state))
  }
}

export const previewSessionService = new PreviewSessionService()
