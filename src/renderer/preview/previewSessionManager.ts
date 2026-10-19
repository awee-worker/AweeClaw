import { useStore } from '@store'
import { DESKTOP_PROFILE, DEVICE_PRESETS } from '@shared/protocols/previewProtocol'
import type { OpenPreviewMetadata, PreviewAutoReloadPayload, PreviewDeviceRequest, PreviewHealthSnapshot, PreviewServerCandidate, PreviewSession, PreviewSessionStatus } from '@shared/protocols/previewProtocol'
import { buildPreviewDocumentPath, parsePreviewDocumentPath } from '@shared/protocols/previewProtocol'
import { api } from '@renderer/adapters/electronBridge'
import { devServerDiscoveryService } from './devServerLocator'
import { recordPreview } from './previewHistory'
import { logger } from '@renderer/toolkit/LogEngine'

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

/**
 * 把设备档位规整成会话字段
 *
 * 建会话（openUrl）与后续切换（setDevice）必须用同一份口径，否则「打开即带设备档」
 * 与「打开后再切」得到的视口可能不一致，表现为设备框尺寸跳一下。
 *
 * 桌面档返回空对象：不往会话上写 deviceId/deviceViewport，渲染层据缺省值铺满。
 */
function resolveDeviceFields(options: {
  deviceId?: string
  width?: number
  height?: number
}): Pick<PreviewSession, 'deviceId' | 'deviceViewport'> {
  const deviceId = options.deviceId?.trim() || DESKTOP_PROFILE.id
  if (deviceId === DESKTOP_PROFILE.id) return {}

  const preset = DEVICE_PRESETS.find((item) => item.id === deviceId)
  return {
    deviceId,
    deviceViewport: {
      width: Math.max(200, Math.round(options.width || preset?.width || 390)),
      height: Math.max(200, Math.round(options.height || preset?.height || 844)),
    },
  }
}

export class PreviewSessionService {
  private readonly listeners = new Set<PreviewSessionListener>()
  private readonly sessions = new Map<string, PreviewSession>()
  private readonly sessionByUrl = new Map<string, string>()
  /** 预览标签页的 guest 重报回调（sessionId → report）：标签页挂载时登记，卸载时移除 */
  private readonly guestReporters = new Map<string, () => boolean>()
  private state: PreviewSessionState = { sessions: [] }
  /** 健康推送订阅是否已建立（只需一次） */
  private healthBridgeAttached = false
  /** 自动刷新订阅是否已建立（只需一次） */
  private autoReloadBridgeAttached = false
  /** 设备模式切换订阅是否已建立（只需一次） */
  private deviceBridgeAttached = false
  /**
   * 订阅会话状态变化
   *
   * 订阅时先同步一次当前状态（调用方无需自行初始化），之后每次 emit 都会收到
   * 最新快照。监听器必须登记进 listeners，否则 emit 遍历不到，订阅形同虚设。
   */
  subscribe(listener: PreviewSessionListener): () => void {
    this.ensureHealthBridge()
    this.ensureAutoReloadBridge()
    this.ensureDeviceBridge()
    this.listeners.add(listener)
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
      /**
       * 建会话时就确定的设备档位
       *
       * 打开即带设备档的场景（open_preview 的 device 参数）必须走这里，不能先建
       * 桌面会话再调 setDevice：那会让界面先按「铺满」渲染一轮、再整体缩成设备框，
       * 视觉上就是整个页面猛地缩一下，且 webview 要重挂一次。
       */
      deviceId?: string
      /** 设备视口宽高覆盖（自定义档位 / 横竖屏切换时使用） */
      deviceWidth?: number
      deviceHeight?: number
    } = {},
  ): PreviewSession {
    this.ensureHealthBridge()
    this.ensureAutoReloadBridge()
    this.ensureDeviceBridge()
    if (!options.forceNew) {
      const existingSessionId = this.sessionByUrl.get(url)
      if (existingSessionId) {
        const existingSession = this.sessions.get(existingSessionId)
        if (existingSession) {
          this.applyRequestedDevice(existingSession.id, options)
          this.activateSession(existingSession, options.activate)
          return this.sessions.get(existingSession.id) || existingSession
        }
      }

      // 服务类预览（非本地文件）：同一个 host:port 只该占一个标签页，地址变化走导航，
      // 免得为一个 dev server 攒出一排标签页。
      // 本地文件预览不合并：同目录下的多个页面是并列关系，各自保有标签页。
      if (!options.previewRoot) {
        const merged = this.findSessionByOrigin(url)
        if (merged) {
          this.navigate(merged.id, url)
          this.applyRequestedDevice(merged.id, options)
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
      // 设备档位随会话一起落定：首帧就是最终形态，不存在「先铺满再缩放」
      ...resolveDeviceFields({
        deviceId: options.deviceId,
        width: options.deviceWidth,
        height: options.deviceHeight,
      }),
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

    // 状态没变就不广播：一次页面加载会连着触发 did-stop-loading 与 did-finish-load，
    // 两者都记 ready。每次 emit 都会让整棵预览组件树（含 webview 容器）重渲染，而
    // 页面刚加载完正是主线程最忙的时刻，重复的这一轮渲染会直接表现成卡顿。
    if (session.status === status && session.lastError === error) {
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

    const urlChanged = session.url !== url

    // 同址且已在加载中：这是 did-navigate 的回执，页面正在加载，状态无需再改。
    // 继续往下走会把它重置成 loading 广播一次，随后 did-finish-load 又广播回 ready，
    // 页面加载完成那一刻凭空多出两轮整树重渲染。
    if (!urlChanged && session.status === 'loading') {
      return
    }

    if (urlChanged) {
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

    // 地址没变就不回写持久化元数据
    //
    // 页面自身重载、以及 webview 重挂载后的 did-navigate 回执都会走到这里，此时地址
    // 与当前会话完全一致，写元数据只会把 openFiles 换成新的对象（lastAccessed 变了），
    // 触发工作空间状态落盘。而落盘文件一旦位于预览根目录内（预览工作空间根目录时就是这种
    // 情况），自动刷新监听会把它当成「页面文件变了」再拉一次页面，于是形成
    // 重载 → 落盘 → 重载 的自持回环，会话结束后也停不下来。
    if (!urlChanged) {
      return
    }

    const previewPath = buildPreviewDocumentPath(sessionId)
    useStore.getState().updatePreviewMetadata(previewPath, { url })
  }

  reload(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return
    }

    const nextToken = session.reloadToken + 1
    this.sessions.set(sessionId, {
      ...session,
      status: 'loading',
      reloadToken: nextToken,
      updatedAt: Date.now(),
    })
    this.rebuildState()
    this.emit()
    logger.system.info('[PreviewRefresh] token bumped', { sessionId, token: nextToken })
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

    // 值没变就不广播：canGoBack/canGoForward 在每次导航后都会重新同步，多数时候
    // 前后两个值完全一样，照旧 emit 只会让预览组件树白重渲染一轮。
    const unchanged = (Object.keys(partial) as Array<keyof typeof partial>).every(
      (key) => session[key] === partial[key],
    )
    if (unchanged) return

    this.sessions.set(sessionId, {
      ...session,
      ...partial,
      updatedAt: Date.now(),
    })
    this.rebuildState()
    this.emit()
  }

  /**
   * 关闭全部内置浏览器预览标签页（浏览器互斥）
   *
   * 外部浏览器即将被打开时调用：同一份内容不应在内置与外部两处同时展示，
   * 打开外部的一侧负责先收掉内置标签页。关闭走 openFiles 的标准移除通道，
   * 与用户手点标签页 × 按钮等价。
   *
   * @returns 实际关闭的标签页数量（无预览标签页时返回 0）
   */
  closeAllSessions(reason?: string): number {
    const paths = [...this.sessions.keys()].map((id) => buildPreviewDocumentPath(id))
    if (!paths.length) return 0

    useStore.getState().closeFiles(paths)
    logger.system.info('[PreviewSession] closed all preview tabs (browser exclusivity)', {
      count: paths.length,
      reason: reason || 'external-browser-opened',
    })
    return paths.length
  }

  /**
   * 复用已有会话时补应用本次请求的设备档
   *
   * 同一地址再次打开不会再走建会话分支，若不在这里补一次，`open_preview` 带的
   * device 参数就被静默丢弃了。setDevice 自身有去重，重复调用不会产生多余广播。
   */
  private applyRequestedDevice(
    sessionId: string,
    options: { deviceId?: string; deviceWidth?: number; deviceHeight?: number },
  ): void {
    if (!options.deviceId) return
    this.setDevice(sessionId, {
      deviceId: options.deviceId,
      width: options.deviceWidth,
      height: options.deviceHeight,
    })
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
      // 会话已关闭或 id 不匹配：快照直接丢弃，留一条记录便于排查
      logger.system.warn('[PreviewHealth] drop snapshot, session not found:', snapshot.sessionId)
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
   * 登记一个预览标签页的 guest 重报回调
   *
   * 主进程的浏览器自动化（browser_snapshot 等）靠「webview 主动上报 guest」建立
   * 关联。上报挂在 webview 的 dom-ready 上，一旦这一步早于事件监听注册、或绑定
   * 被中途解绑，主进程侧就没有该会话的记录，AI 会报「No preview tab found」。
   *
   * 这里把每个预览标签页的上报入口集中登记，打开预览的场景可在等待窗口内主动
   * 触发一次重报，把这类时序竞争吸收成一次正常命中。
   *
   * @returns 注销函数（标签页卸载时调用）
   */
  registerGuestReporter(sessionId: string, report: () => boolean): () => void {
    this.guestReporters.set(sessionId, report)
    return () => {
      if (this.guestReporters.get(sessionId) === report) {
        this.guestReporters.delete(sessionId)
      }
    }
  }

  /**
   * 请求预览标签页重新上报 guest
   *
   * @param sessionId 目标会话；缺省时对所有已登记的标签页触发
   * @returns 是否至少有一个标签页完成了上报（webview 尚未就绪时其回调返回 false）
   */
  requestGuestReport(sessionId?: string): boolean {
    let delivered = false
    for (const [id, report] of this.guestReporters) {
      if (sessionId && id !== sessionId) continue
      try {
        delivered = report() || delivered
      } catch {
        // 单个标签页上报失败不影响其余
      }
    }
    return delivered
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

  /**
   * 设置会话的设备模拟档位
   *
   * 只改内存态（deviceId / deviceViewport）：设备框由渲染层据 session 重排，
   * UA 由 webview controller 读到档位后调主进程应用。两者都随 session 变化自动跟进。
   *
   * @param options.deviceId 档位 id（'desktop' | 预设 id | 'custom'）
   * @param options.width/height 实际视口尺寸；预设档位可传横竖屏后的宽高覆盖默认值
   */
  setDevice(
    sessionId: string,
    options: { deviceId: string; width?: number; height?: number },
  ): void {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return
    }

    const fields = resolveDeviceFields(options)

    // 档位与视口都没变就不广播：工具栏重挂、标签页切换都会调到这里，
    // 每次 emit 都是一轮整树重渲染，而尺寸本来就没动。
    const unchanged =
      (session.deviceId ?? DESKTOP_PROFILE.id) === (fields.deviceId ?? DESKTOP_PROFILE.id) &&
      session.deviceViewport?.width === fields.deviceViewport?.width &&
      session.deviceViewport?.height === fields.deviceViewport?.height
    if (unchanged) return

    const next: PreviewSession = { ...session, ...fields, updatedAt: Date.now() }

    // 切回桌面档时 fields 是空对象，展开不会覆盖旧值：不清掉的话旧档位与旧视口
    // 原样留在会话上，表现就是「点了桌面没有任何反应」。所以显式删除这两个字段。
    if (fields.deviceId === undefined) {
      delete next.deviceId
      delete next.deviceViewport
    }

    this.sessions.set(sessionId, next)
    this.rebuildState()
    this.emit()
  }

  /**
   * 建立设备模式切换订阅（幂等）
   *
   * AI 的 browser_set_device 工具在主进程发起，广播到这个信道；这里按广播的
   * 会话与档位走 setDevice，与用户手点工具栏完全同一条路径。
   */
  private ensureDeviceBridge(): void {
    if (this.deviceBridgeAttached) {
      return
    }

    try {
      api.preview.onDevice((request) => this.applyDeviceRequest(request))
      this.deviceBridgeAttached = true
    } catch {
      // preload 未就绪（如单测环境）时忽略
    }
  }

  /** 处理主进程推来的设备切换请求 */
  private applyDeviceRequest(request: PreviewDeviceRequest): void {
    if (!request?.sessionId || !request.deviceId) {
      return
    }
    this.setDevice(request.sessionId, {
      deviceId: request.deviceId,
      width: request.width,
      height: request.height,
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
