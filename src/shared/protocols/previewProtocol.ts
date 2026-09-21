export type PreviewServerSource = 'terminal' | 'workspace-script' | 'port-probe' | 'manual'

export type PreviewServerStatus = 'idle' | 'probing' | 'ready' | 'unreachable'

export interface PreviewServerCandidate {
  id: string
  url: string
  source: PreviewServerSource
  status: PreviewServerStatus
  label?: string
  title?: string
  terminalId?: string
  workspaceRoot?: string
  detectedAt: number
  lastSeenAt: number
  lastCheckedAt?: number
  error?: string
}

export type PreviewSessionStatus = 'idle' | 'loading' | 'ready' | 'error'

/** 控制台记录级别：只收 warning / error，info 类噪音不入库 */
export type PreviewConsoleLevel = 'warning' | 'error'

/** 单条控制台记录 */
export interface PreviewConsoleEntry {
  level: PreviewConsoleLevel
  message: string
  /** 源码行号，未知为 0 */
  line: number
  /** 来源：脚本地址或页面地址 */
  source: string
  at: number
  /** 重复出现次数（同一错误刷屏时只保留一条并累加） */
  count: number
}

/** 单条资源加载失败记录 */
export interface PreviewLoadFailure {
  url: string
  errorCode: number
  errorDescription: string
  at: number
}

/**
 * 页面健康等级
 *
 * - healthy：既无告警也无错误
 * - warning：只有告警，或渲染结果接近空白
 * - error：存在加载失败 / 控制台错误 / 渲染进程崩溃
 */
export type PreviewHealthLevel = 'healthy' | 'warning' | 'error'

/** 页面健康快照（运行时态，不持久化） */
export interface PreviewHealthSnapshot {
  sessionId: string
  level: PreviewHealthLevel
  /** 快照对应的页面地址 */
  url: string
  /** 页面标题（取自 webview，可能为空） */
  title?: string
  consoleMessages: PreviewConsoleEntry[]
  loadFailures: PreviewLoadFailure[]
  /** 页面渲染完成后几乎没有可见内容 */
  blank: boolean
  /** 渲染进程已崩溃 */
  crashed: boolean
  /** 累计错误条数（含因上限被丢弃的） */
  errorCount: number
  updatedAt: number
}

/** 资源瀑布单条记录（按需采集，不常驻） */
export interface PreviewNetworkEntry {
  url: string
  /** 发起方类型：script / css / img / fetch / xmlhttprequest 等 */
  type: string
  /** 耗时（毫秒） */
  duration: number
  /** 传输字节数 */
  size: number
  /** HTTP 状态码，未知为 0 */
  status: number
}

/** 健康状态推送频道（main → renderer） */
export const PREVIEW_HEALTH_CHANNEL = 'preview:health-changed'

/** 目录内容变化后的自动刷新通知（main → renderer） */
export const PREVIEW_AUTO_RELOAD_CHANNEL = 'preview:auto-reload'

/** 自动刷新通知载荷 */
export interface PreviewAutoReloadPayload {
  /** 需要重载的预览地址 */
  urls: string[]
}

/**
 * DevTools 面板矩形
 *
 * 渲染进程按 CSS 像素给出（相对自身视口），主进程按页面缩放换算成 DIP 后定位原生视图。
 */
export interface DevToolsRect {
  x: number
  y: number
  width: number
  height: number
}

export interface PreviewSession {
  id: string
  url: string
  title: string
  source: PreviewServerSource
  status: PreviewSessionStatus
  createdAt: number
  updatedAt: number
  reloadToken: number
  workspaceRoot?: string
  candidateId?: string
  lastError?: string
  /** 是否可后退（由 webview canGoBack 同步，运行时态，不持久化） */
  canGoBack?: boolean
  /** 是否可前进（由 webview canGoForward 同步，运行时态，不持久化） */
  canGoForward?: boolean
  /** DevTools 是否打开（运行时态，不持久化） */
  devtoolsOpen?: boolean
  /** 当前缩放因子（1.0 = 100%，运行时态） */
  zoomFactor?: number
  /** 页面健康快照（运行时态，不持久化） */
  health?: PreviewHealthSnapshot
  /** webview 的 guest webContents id（运行时态，供按需采集资源瀑布） */
  guestId?: number
  /** 静态预览的根目录（运行时态；本地文件预览才有，供自动刷新登记用） */
  previewRoot?: string
}


export interface OpenPreviewMetadata {
  sessionId: string
  url: string
  title: string
  source: PreviewServerSource
  workspaceRoot?: string
  candidateId?: string
  /**
   * 本地文件预览的根目录
   *
   * 持久化下来是为了重启后能重建：本地预览的地址是一次性的（端口与根目录登记都在
   * 运行期），只能凭目录重新解析。
   */
  previewRoot?: string
}

export function buildPreviewDocumentPath(sessionId: string): string {
  return `preview://session/${sessionId}`
}

export function isPreviewDocumentPath(path: string): boolean {
  return typeof path === 'string' && path.startsWith('preview://session/')
}

export function parsePreviewDocumentPath(path: string): { sessionId: string } | null {
  if (!isPreviewDocumentPath(path)) {
    return null
  }

  const sessionId = path.slice('preview://session/'.length)
  return sessionId ? { sessionId } : null
}

