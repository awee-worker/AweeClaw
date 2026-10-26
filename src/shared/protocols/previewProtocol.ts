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

/**
 * 页面内容摘要（按需采集，不常驻）
 *
 * 白屏判定基于像素采样，SPA 延迟渲染等场景可能误报；这里读 DOM 的真实
 * 文本量做交叉验证：像素判空 + 文本为空才可靠判定页面没有内容。
 */
export interface PreviewContentSummary {
  /** 页面标题 */
  title: string
  /** 当前地址 */
  url: string
  /** 页面正文字符数 */
  textLength: number
  /** 正文开头采样 */
  textSample: string
  /** DOM 元素总数 */
  elementCount: number
  /** 可见标题（h1-h3）采样 */
  headings: string[]
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
  /**
   * 设备模拟档位 id（运行时态，不持久化）
   *
   * 缺省 / 'desktop' 表示桌面（不施加约束）；其余为 DEVICE_PRESETS 的档位 id，
   * 或 'custom'（自定义尺寸）。驱动渲染层的设备框尺寸与主进程的 UA 应用。
   */
  deviceId?: string
  /** 非桌面档的设备逻辑视口（已含横竖屏方向；运行时态） */
  deviceViewport?: { width: number; height: number }
}

// ============ 设备模拟 ============

/** 设备模拟档位 */
export interface DeviceProfile {
  /** 档位 id；预设为固定值，自定义为 'custom' */
  id: string
  /** 展示名 */
  name: string
  /** 逻辑视口宽（CSS px），决定页面 viewport 宽度与响应式断点 */
  width: number
  /** 逻辑视口高（CSS px） */
  height: number
  /** 设备像素比 */
  deviceScaleFactor: number
  /** 是否为触屏移动设备 */
  mobile: boolean
  /** 移动端 User-Agent；桌面档或无 UA 时缺省 */
  ua?: string
}

/** 桌面档：不施加设备约束，webview 铺满可用空间 */
export const DESKTOP_PROFILE: DeviceProfile = {
  id: 'desktop',
  name: 'Desktop',
  width: 0,
  height: 0,
  deviceScaleFactor: 1,
  mobile: false,
}

const IOS_PHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
const IOS_PAD_UA =
  'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36'

/** 内置设备预设（与主流浏览器 DevTools 档位对齐，尺寸为竖屏逻辑分辨率） */
export const DEVICE_PRESETS: DeviceProfile[] = [
  DESKTOP_PROFILE,
  { id: 'iphone-se', name: 'iPhone SE', width: 375, height: 667, deviceScaleFactor: 2, mobile: true, ua: IOS_PHONE_UA },
  { id: 'iphone-14', name: 'iPhone 14', width: 390, height: 844, deviceScaleFactor: 3, mobile: true, ua: IOS_PHONE_UA },
  { id: 'iphone-14-pro-max', name: 'iPhone 14 Pro Max', width: 430, height: 932, deviceScaleFactor: 3, mobile: true, ua: IOS_PHONE_UA },
  { id: 'iphone-16', name: 'iPhone 16', width: 393, height: 852, deviceScaleFactor: 3, mobile: true, ua: IOS_PHONE_UA },
  { id: 'iphone-16-pro-max', name: 'iPhone 16 Pro Max', width: 440, height: 956, deviceScaleFactor: 3, mobile: true, ua: IOS_PHONE_UA },
  { id: 'ipad-mini', name: 'iPad mini', width: 744, height: 1133, deviceScaleFactor: 2, mobile: true, ua: IOS_PAD_UA },
  { id: 'ipad-pro', name: 'iPad Pro 11', width: 834, height: 1194, deviceScaleFactor: 2, mobile: true, ua: IOS_PAD_UA },
  { id: 'pixel-7', name: 'Pixel 7', width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true, ua: ANDROID_UA },
  { id: 'galaxy-s20', name: 'Galaxy S20', width: 360, height: 800, deviceScaleFactor: 3, mobile: true, ua: ANDROID_UA },
]

/** 解析后的设备视图（设备框渲染 + 主进程 UA 应用共用同一份口径） */
export interface ResolvedDevice {
  id: string
  name: string
  /** 桌面档：不施加任何约束 */
  isDesktop: boolean
  width: number
  height: number
  deviceScaleFactor: number
  mobile: boolean
  ua?: string
}

function desktopResolved(): ResolvedDevice {
  return {
    id: DESKTOP_PROFILE.id,
    name: DESKTOP_PROFILE.name,
    isDesktop: true,
    width: 0,
    height: 0,
    deviceScaleFactor: 1,
    mobile: false,
  }
}

/**
 * 由会话上的设备字段解析出实际生效的设备视图
 *
 * - deviceId 缺省 / 'desktop'：桌面
 * - deviceId === 'custom'：用 deviceViewport 给定尺寸（无 UA，按移动端处理）
 * - 其余：按预设档位解析，deviceViewport 可覆盖横竖屏后的实际宽高
 */
export function resolveDevice(source: {
  deviceId?: string
  deviceViewport?: { width: number; height: number }
}): ResolvedDevice {
  const id = source.deviceId?.trim()
  if (!id || id === DESKTOP_PROFILE.id) {
    return desktopResolved()
  }

  const viewport = source.deviceViewport

  if (id === 'custom') {
    return {
      id,
      name: 'Custom',
      isDesktop: false,
      width: Math.max(200, Math.round(viewport?.width || 390)),
      height: Math.max(200, Math.round(viewport?.height || 844)),
      deviceScaleFactor: 2,
      mobile: true,
    }
  }

  const preset = DEVICE_PRESETS.find((item) => item.id === id)
  if (!preset) {
    return desktopResolved()
  }

  return {
    id: preset.id,
    name: preset.name,
    isDesktop: false,
    width: Math.round(viewport?.width || preset.width),
    height: Math.round(viewport?.height || preset.height),
    deviceScaleFactor: preset.deviceScaleFactor,
    mobile: preset.mobile,
    ua: preset.ua,
  }
}

/**
 * 设备模式切换请求（main → renderer）
 *
 * AI 通过 browser_set_device 工具发起：主进程把意图广播给承载 webview 的渲染进程，
 * 由渲染进程按「手动切换」的同一条路径应用（更新会话 → 重排设备框 → 应用 UA），
 * 保证 UI 与工具两条入口最终落到同一份状态。
 */
export const PREVIEW_DEVICE_CHANNEL = 'preview:device-changed'

export interface PreviewDeviceRequest {
  /** 目标预览会话 id */
  sessionId: string
  /** 档位 id（'desktop' | 预设 id | 'custom'） */
  deviceId: string
  /** 自定义尺寸（deviceId === 'custom' 时使用） */
  width?: number
  height?: number
}

/**
 * 页面请求打开新窗口（main → renderer）
 *
 * 页面里的 target=_blank 链接与 window.open() 不会由主进程直接建窗口：主进程把
 * 请求交回承载 webview 的渲染进程，由内置浏览器自己决定怎么开（新标签页），
 * 这样弹窗行为和用户在应用内的其他导航保持在同一个上下文里。
 */
export const PREVIEW_NEW_WINDOW_CHANNEL = 'preview:new-window-request'

/** 新窗口请求载荷 */
export interface PreviewNewWindowRequest {
  /** 发起请求的 webview guest id：渲染侧据此判断是不是自己的页面 */
  guestId: number
  /** 目标地址（已由主进程限定为 http/https） */
  url: string
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

