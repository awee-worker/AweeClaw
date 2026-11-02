/**
 * 站点浏览器桥
 *
 * 给「站点托管」这类插件提供后台网页能力：插件声明一个站点，桥负责起一个隐藏的
 * BrowserWindow 加载该站点，插件即可在其上执行脚本、点击、输入、翻页与读取会话
 * cookie。与内置浏览器（webview）相对，这里的窗口不参与界面布局，因此可以在用户
 * 继续对话的同时跑采集任务。
 *
 * 关键设计：
 *
 * 1. 一站点一窗口。窗口按 siteId 缓存复用，重复 open 只做导航——登录态落在
 *    session 里，销毁窗口再开一次会丢掉页面内状态，也拖慢每次采集。
 * 2. 一站点一 partition。partition 由插件按 `persist:awee-site-<id>` 命名，
 *    桥只接受这一前缀，避免插件拿到默认 session 去读写用户主窗口的 cookie。
 *    内置浏览器打开同一站点时传入同一 partition，两边共享登录态。
 * 3. 导航白名单。站点第一次 open 时登记 allowedOrigins，后续 navigate 与页面内
 *    跳转都按它放行；未登记时只允许与 open 的 url 同源，防止采集脚本被跳到
 *    第三方页面。
 * 4. 弹窗与下载一律拒绝。采集窗口没有用户界面，弹窗会落成无人可见的窗口，
 *    下载会写进用户下载目录——两者都不是插件该有的副作用。
 *
 * 权限：插件需通过 `globalThis.__AWEECLAW_HOST__.siteBrowser` 访问。
 *
 * @module plugin-sdk/SiteBrowserBridge
 */

import { BrowserWindow } from 'electron'
import type { WebContents } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'

/** 单个站点窗口的登记信息 */
interface SiteEntry {
  siteId: string
  win: BrowserWindow
  partition: string
  allowedOrigins: string[]
  /**
   * 登录流程的放行截止时间（毫秒时间戳，0 表示未开）
   *
   * 登录常常要跨域：表单 action 指向独立 SSO 域、成功后由 CAS / OAuth 跳回、
   * 企业 IdP 更是另一个主域。这些跳转发生在页面内部，会被 will-navigate
   * 的白名单拦下来，页面就停在原地——用户看到的就是「点了登录但没登进去」。
   * 登录期间给一个有时限的放行窗口，结束后立刻收回。
   */
  loginFlowUntil: number
  createdAt: number
}

/** open 的参数 */
export interface SiteBrowserOpenOptions {
  /** 要加载的地址，仅 http/https */
  url: string
  /**
   * 会话分区名，形如 `persist:awee-site-<siteId>`
   *
   * 省略时按 siteId 自动生成，使「不进客户端也能跑」的简单场景不必自己拼名字。
   */
  partition?: string
  /** 允许导航的来源白名单；省略时按 open 的 url 同源 */
  allowedOrigins?: string[]
  /** 自定义 UA，部分 OA 系统会按 UA 下发不同的页面 */
  userAgent?: string
  /** 页面语言偏好，请求头 Accept-Language */
  language?: string
  /** 视口尺寸，影响页面按响应式断点渲染出的结构 */
  viewport?: { width: number; height: number }
  /** 首次加载超时，默认 30 秒 */
  timeoutMs?: number
}

/** 导航结果 */
export interface SiteNavigateResult {
  url: string
  title: string
  /** load 表示正常完成，timeout 表示超时但仍可继续操作页面 */
  status: 'load' | 'timeout'
}

/** waitFor 的参数 */
export interface SiteWaitOptions {
  /** 等待出现该选择器命中的元素 */
  selector?: string
  /** 等待页面文本包含该串（忽略大小写） */
  text?: string
  /** 等待时长，默认 10 秒，上限 60 秒 */
  timeoutMs?: number
  /** 轮询间隔，默认 300ms */
  intervalMs?: number
}

/** 点击目标 */
export interface SiteClickTarget {
  /** CSS 选择器；与 x/y 二选一 */
  selector?: string
  x?: number
  y?: number
}

/** 输入参数 */
export interface SiteTypeOptions {
  selector: string
  text: string
  /** 是否先清空，默认 true */
  clear?: boolean
  /** 输入后是否回车提交 */
  submit?: boolean
}

/** 站点窗口状态 */
export interface SiteBrowserStatus {
  siteId: string
  url: string
  title: string
  partition: string
  loading: boolean
  createdAt: number
}

/** partition 前缀：只允许插件自己的分区 */
const PARTITION_PREFIX = 'persist:awee-site-'
/** 默认视口 */
const DEFAULT_VIEWPORT = { width: 1440, height: 900 }
/** 默认加载超时 */
const DEFAULT_LOAD_TIMEOUT_MS = 30_000
/** waitFor 上限 */
const MAX_WAIT_MS = 60_000
/** 点击按下与抬起之间的间隔，保证 mousedown/mouseup 成对到达页面 */
const CLICK_PAUSE_MS = 30
/** 登录流程放行窗口，默认 2 分钟，上限 5 分钟 */
const DEFAULT_LOGIN_FLOW_TTL_MS = 120_000
const MAX_LOGIN_FLOW_TTL_MS = 300_000

/**
 * 常见的多段公共后缀
 *
 * 用来把 `sso.example.com.cn` 和 `oa.example.com.cn` 归到同一个主域。
 * 清单不求全，命中不了时退化为「末两段」，对登录跳转判断已经够用。
 */
const MULTI_LEVEL_SUFFIXES = new Set([
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn', 'ac.cn',
  'com.hk', 'com.tw', 'com.mo', 'com.sg', 'com.au', 'com.my',
  'co.jp', 'co.kr', 'co.uk', 'co.in', 'co.nz', 'com.br', 'com.mx',
])

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 仅允许 http/https */
function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

/** 取 URL 的源；非法地址返回空串 */
function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return ''
  }
}

/**
 * 取可注册主域（eTLD+1）
 *
 * 用来判断两个 origin 是不是同一家公司的一套系统：`oa.example.com` 与
 * `sso.example.com` 都归到 `example.com`。IP 与单段主机名原样返回。
 */
function registrableDomainOf(origin: string): string {
  const host = (() => {
    try {
      return new URL(origin).hostname.toLowerCase().replace(/\.$/, '')
    } catch {
      return ''
    }
  })()
  if (!host) return ''
  // IPv4 / IPv6 没有主域概念，只能精确匹配
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) return host
  const parts = host.split('.')
  if (parts.length <= 2) return host
  const lastTwo = parts.slice(-2).join('.')
  if (MULTI_LEVEL_SUFFIXES.has(lastTwo)) return parts.slice(-3).join('.')
  return lastTwo
}

/**
 * 校验并归一化 partition
 *
 * 只接受 `persist:awee-site-<id>`：非持久分区在窗口关闭后连 cookie 一起消失，
 * 采集每次都要重新登录；而没有前缀的分区可能落到主窗口的默认 session 上。
 */
function normalizePartition(siteId: string, raw?: string): string {
  const value = String(raw || '').trim() || `${PARTITION_PREFIX}${sanitizeSiteId(siteId)}`
  if (!value.startsWith(PARTITION_PREFIX)) {
    throw new Error(`partition 必须以 ${PARTITION_PREFIX} 开头，收到：${value}`)
  }
  if (!/^persist:awee-site-[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`partition 只允许字母、数字、下划线与短横线，收到：${value}`)
  }
  return value
}

/** siteId 进 partition 名之前先收窄字符集 */
function sanitizeSiteId(siteId: string): string {
  const cleaned = String(siteId || '').replace(/[^A-Za-z0-9_-]/g, '')
  if (!cleaned) throw new Error('siteId 为空或不含可用字符')
  return cleaned
}

/**
 * 等一次导航结束
 *
 * did-fail-load 里的 errorCode -3（ERR_ABORTED）是页面内重定向的常规产物，
 * 不是失败，忽略后继续等真正的结束事件。
 */
function waitForLoad(
  wc: WebContents,
  timeoutMs: number,
): { promise: Promise<SiteNavigateResult>; cancel: () => void } {
  let settled = false
  let resolveFn: (value: SiteNavigateResult) => void = () => {}
  let timer: NodeJS.Timeout | null = null

  const cleanup = (): void => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    wc.removeListener('did-finish-load', onFinish)
    wc.removeListener('did-fail-load', onFail)
  }

  const settle = (status: SiteNavigateResult['status']): void => {
    if (settled) return
    settled = true
    cleanup()
    resolveFn({
      url: wc.getURL(),
      title: wc.getTitle(),
      status,
    })
  }

  const onFinish = (): void => settle('load')

  const onFail = (
    _event: unknown,
    errorCode: number,
    _errorDescription: string,
    _validatedURL: string,
    isMainFrame?: boolean,
  ): void => {
    // -3 是重定向打断，子框架失败不影响主文档；两种情况都继续等
    if (errorCode === -3) return
    if (isMainFrame === false) return
    settle('load')
  }

  wc.on('did-finish-load', onFinish)
  wc.on('did-fail-load', onFail)
  timer = setTimeout(() => settle('timeout'), Math.max(1000, timeoutMs))

  const promise = new Promise<SiteNavigateResult>((resolve) => {
    resolveFn = resolve
  })

  return { promise, cancel: () => settle('timeout') }
}

class SiteBrowserBridge {
  private entries = new Map<string, SiteEntry>()
  /**
   * 已挂过下载拦截的分区
   *
   * 监听器挂在 session 上而不是窗口上：同一个 persist 分区关闭窗口后重建，
   * session 还是同一个，重复注册会让一次下载被拦多次、监听器越积越多。
   */
  private downloadGuarded = new Set<string>()

  /**
   * 打开或复用站点窗口并导航
   *
   * 已存在的窗口只做导航与白名单更新，返回时页面已完成首次加载（或超时）。
   */
  async open(siteId: string, options: SiteBrowserOpenOptions): Promise<SiteNavigateResult & { siteId: string }> {
    const id = String(siteId || '').trim()
    if (!id) throw new Error('siteId 不能为空')
    const url = String(options?.url || '').trim()
    if (!isHttpUrl(url)) throw new Error(`只支持 http/https 地址，收到：${url || '(空)'}`)

    const partition = normalizePartition(id, options.partition)
    const origins = this.resolveOrigins(url, options.allowedOrigins)

    let entry = this.entries.get(id)
    if (entry && !entry.win.isDestroyed()) {
      // 复用窗口：白名单只增不减，避免同一站点先后用不同入口打开时互相顶掉
      entry.allowedOrigins = Array.from(new Set([...entry.allowedOrigins, ...origins]))
      if (options.userAgent) entry.win.webContents.setUserAgent(options.userAgent)
    } else {
      entry = this.createEntry(id, partition, origins, options)
      this.entries.set(id, entry)
    }

    const result = await this.navigateInternal(entry, url, options.timeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS)
    logger.system?.info('[SiteBrowser] open', { siteId: id, url: result.url, status: result.status })
    return { ...result, siteId: id }
  }

  /**
   * 导航到指定地址
   *
   * 目标不在白名单内时直接拒绝：采集脚本拼出外部链接属于配置错误，
   * 让它在导航这一步失败，比跳到第三方页面再报错更好定位。
   */
  async navigate(siteId: string, url: string, timeoutMs?: number): Promise<SiteNavigateResult> {
    const entry = this.requireEntry(siteId)
    const target = String(url || '').trim()
    if (!isHttpUrl(target)) throw new Error(`只支持 http/https 地址，收到：${target || '(空)'}`)
    this.assertAllowed(entry, target)
    return this.navigateInternal(entry, target, timeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS)
  }

  /** 在页面里执行脚本，返回值需可 JSON 序列化 */
  async evaluate(siteId: string, script: string, timeoutMs = 15_000): Promise<unknown> {
    const entry = this.requireEntry(siteId)
    if (typeof script !== 'string' || !script.trim()) throw new Error('script 不能为空')

    const run = entry.win.webContents.executeJavaScript(script, true)
    if (!timeoutMs || timeoutMs <= 0) return run

    return Promise.race([
      run,
      delay(timeoutMs).then(() => {
        throw new Error(`页面脚本执行超时（${timeoutMs}ms）`)
      }),
    ])
  }

  /**
   * 等待页面出现某个元素或某段文本
   *
   * 轮询页面而不是监听事件：采集场景里等待的往往是 AJAX 渲染出来的内容，
   * 没有可用的导航事件可以挂。
   */
  async waitFor(siteId: string, options: SiteWaitOptions): Promise<{ found: boolean; elapsedMs: number }> {
    const entry = this.requireEntry(siteId)
    const selector = typeof options?.selector === 'string' ? options.selector.trim() : ''
    const text = typeof options?.text === 'string' ? options.text.trim() : ''
    if (!selector && !text) throw new Error('waitFor 需要 selector 或 text 之一')

    const timeoutMs = Math.min(Math.max(500, options.timeoutMs ?? 10_000), MAX_WAIT_MS)
    const intervalMs = Math.min(Math.max(100, options.intervalMs ?? 300), 2000)
    const started = Date.now()

    const probe = this.buildWaitProbe(selector, text)
    while (Date.now() - started < timeoutMs) {
      try {
        const hit = await entry.win.webContents.executeJavaScript(probe, true)
        if (hit === true) return { found: true, elapsedMs: Date.now() - started }
      } catch {
        // 页面正在导航时脚本会失败，属正常时序，继续轮询
      }
      await delay(intervalMs)
    }
    return { found: false, elapsedMs: Date.now() - started }
  }

  /**
   * 点击元素或坐标
   *
   * 走 sendInputEvent 而不是页面内的 element.click()：真实鼠标事件能触发
   * mousedown/blur 等副作用，表单校验、下拉收起这些行为才与用户操作一致。
   */
  async click(siteId: string, target: SiteClickTarget): Promise<{ x: number; y: number }> {
    const entry = this.requireEntry(siteId)
    const point = await this.resolvePoint(entry, target)
    const wc = entry.win.webContents

    wc.sendInputEvent({ type: 'mouseDown', x: point.x, y: point.y, button: 'left', clickCount: 1 })
    await delay(CLICK_PAUSE_MS)
    wc.sendInputEvent({ type: 'mouseUp', x: point.x, y: point.y, button: 'left', clickCount: 1 })
    return point
  }

  /**
   * 向输入框填值
   *
   * 值通过原生 setter 写入再派发 input/change：React 受控组件靠 value 属性
   * 的 setter 拦截来感知变化，直接赋 el.value 不会触发它的 onChange，
   * 表单看起来填上了、提交却是空的。
   */
  async type(siteId: string, options: SiteTypeOptions): Promise<void> {
    const entry = this.requireEntry(siteId)
    const selector = String(options?.selector || '').trim()
    if (!selector) throw new Error('type 需要 selector')
    const text = String(options?.text ?? '')
    const clear = options.clear !== false

    const script = this.buildTypeProbe(selector, text, clear)
    const result = (await entry.win.webContents.executeJavaScript(script, true)) as
      | { ok: true }
      | { ok: false; error: string }
    if (!result || result.ok !== true) {
      throw new Error((result as { error?: string } | null)?.error || '输入失败：目标元素不可编辑')
    }

    if (options.submit) {
      await delay(CLICK_PAUSE_MS)
      entry.win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' })
      entry.win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' })
    }
  }

  /** 滚动到页面底部并返回当前滚动高度，供无限滚动采集判断是否还有新内容 */
  async scrollToBottom(siteId: string): Promise<{ scrollTop: number; scrollHeight: number }> {
    const entry = this.requireEntry(siteId)
    const script =
      '(() => { window.scrollTo(0, document.body.scrollHeight);' +
      ' return { scrollTop: Math.round(window.scrollY || 0),' +
      ' scrollHeight: Math.round(document.body.scrollHeight || 0) }; })()'
    const result = (await entry.win.webContents.executeJavaScript(script, true)) as
      | { scrollTop: number; scrollHeight: number }
      | null
    return result || { scrollTop: 0, scrollHeight: 0 }
  }

  /**
   * 截取当前页面
   *
   * 隐藏窗口的绘制是惰性的：上一次绘制之后页面若已更新，抓到的会是旧帧。
   * 抓之前先 invalidate 一次逼它重绘；仍拿不到图时返回 null，由调用方决定
   * 是否降级——截图只服务于人工核对，不该让采集因为截图失败而中断。
   */
  async screenshot(siteId: string): Promise<{ base64: string; mimeType: string } | null> {
    const entry = this.requireEntry(siteId)
    try {
      const wc = entry.win.webContents
      wc.invalidate()
      await delay(120)
      const image = await wc.capturePage()
      if (image.isEmpty()) return null
      return { base64: image.toPNG().toString('base64'), mimeType: 'image/png' }
    } catch (e) {
      logger.system?.warn('[SiteBrowser] screenshot failed', { siteId, error: (e as Error).message })
      return null
    }
  }

  /** 读取该站点分区下的 cookie，供「进入管理」时同步登录态 */
  async getCookies(
    siteId: string,
    filter?: { url?: string; name?: string },
  ): Promise<Array<{ name: string; value: string; domain: string; path: string; expires: number; httpOnly: boolean; secure: boolean }>> {
    const entry = this.requireEntry(siteId)
    const cookies = await entry.win.webContents.session.cookies.get({
      url: filter?.url,
      name: filter?.name,
    })
    return cookies.map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain || '',
      path: cookie.path || '/',
      expires: cookie.expirationDate ?? -1,
      httpOnly: Boolean(cookie.httpOnly),
      secure: Boolean(cookie.secure),
    }))
  }

  /** 写入 cookie，返回成功写入的条数 */
  async setCookies(
    siteId: string,
    cookies: Array<{
      name: string
      value: string
      domain: string
      path?: string
      secure?: boolean
      httpOnly?: boolean
      expires?: number
    }>,
  ): Promise<number> {
    const entry = this.requireEntry(siteId)
    const jar = entry.win.webContents.session.cookies
    let applied = 0
    for (const cookie of cookies || []) {
      if (!cookie?.name || !cookie?.domain) continue
      try {
        await jar.set({
          url: `${cookie.secure ? 'https' : 'http'}://${cookie.domain.replace(/^\./, '')}${cookie.path || '/'}`,
          name: cookie.name,
          value: cookie.value ?? '',
          domain: cookie.domain,
          path: cookie.path || '/',
          secure: Boolean(cookie.secure),
          httpOnly: Boolean(cookie.httpOnly),
          expirationDate: cookie.expires && cookie.expires > 0 ? cookie.expires : undefined,
        })
        applied++
      } catch (e) {
        logger.system?.warn('[SiteBrowser] setCookie failed', { siteId, name: cookie.name, error: (e as Error).message })
      }
    }
    return applied
  }

  /** 清空该站点分区的全部存储（退出登录 / 换账号） */
  async clearSession(siteId: string): Promise<void> {
    const entry = this.requireEntry(siteId)
    await entry.win.webContents.session.clearStorageData()
    await entry.win.webContents.session.clearCache()
  }

  /** 关闭站点窗口并释放分区句柄 */
  close(siteId: string): boolean {
    const entry = this.entries.get(siteId)
    if (!entry) return false
    this.entries.delete(siteId)
    if (!entry.win.isDestroyed()) entry.win.destroy()
    logger.system?.info('[SiteBrowser] closed', { siteId })
    return true
  }

  /** 列出已打开的站点窗口 */
  list(): SiteBrowserStatus[] {
    const result: SiteBrowserStatus[] = []
    for (const [siteId, entry] of this.entries) {
      if (entry.win.isDestroyed()) continue
      const wc = entry.win.webContents
      result.push({
        siteId,
        url: wc.getURL(),
        title: wc.getTitle(),
        partition: entry.partition,
        loading: wc.isLoading(),
        createdAt: entry.createdAt,
      })
    }
    return result
  }

  /** 查询单个站点窗口状态 */
  status(siteId: string): SiteBrowserStatus | null {
    return this.list().find((item) => item.siteId === siteId) ?? null
  }

  /** 应用退出时统一销毁，避免残留的无头窗口拖慢退出 */
  destroyAll(): void {
    for (const [siteId, entry] of this.entries) {
      if (!entry.win.isDestroyed()) entry.win.destroy()
      logger.system?.info('[SiteBrowser] destroyed on shutdown', { siteId })
    }
    this.entries.clear()
  }

  // ============ 内部实现 ============

  private resolveOrigins(url: string, allowed?: string[]): string[] {
    const fromOption = (allowed || [])
      .map((item) => String(item || '').trim())
      .filter((item) => isHttpUrl(item))
      .map((item) => originOf(item))
      .filter(Boolean)
    if (fromOption.length > 0) return Array.from(new Set(fromOption))
    const own = originOf(url)
    return own ? [own] : []
  }

  private createEntry(
    siteId: string,
    partition: string,
    allowedOrigins: string[],
    options: SiteBrowserOpenOptions,
  ): SiteEntry {
    const viewport = options.viewport || DEFAULT_VIEWPORT
    const win = new BrowserWindow({
      show: false,
      width: Math.max(800, Math.round(viewport.width)),
      height: Math.max(600, Math.round(viewport.height)),
      // 不显示也不能被当作后台页节流：定时器一停，页面里的轮询与懒加载就停摆
      webPreferences: {
        partition,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        backgroundThrottling: false,
        spellcheck: false,
      },
    })

    win.setMenuBarVisibility(false)
    if (options.userAgent) win.webContents.setUserAgent(options.userAgent)
    if (options.language) {
      win.webContents.session.setUserAgent(
        win.webContents.getUserAgent(),
        options.language,
      )
    }

    // 采集窗口没有界面：新窗口一律拒绝，否则会留下一堆无人可见的窗口
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    // 下载写的是用户下载目录，不是插件该有的副作用
    if (!this.downloadGuarded.has(partition)) {
      this.downloadGuarded.add(partition)
      win.webContents.session.on('will-download', (event) => {
        event.preventDefault()
      })
    }

    // 页面内的跳转（点链接、表单提交、location 赋值）都按白名单放行。
    // 必须读活的白名单：open 复用窗口时会把新来源并进 entry.allowedOrigins，
    // 而建窗那一刻的数组引用不会跟着更新。
    win.webContents.on('will-navigate', (event, url) => {
      const entry = this.entries.get(siteId)
      const origins = entry?.allowedOrigins ?? allowedOrigins
      if (this.isNavigationAllowed(siteId, origins, url)) {
        const origin = originOf(url)
        // 登录期间放行的跨域跳转（SSO / CAS / IdP）记进白名单：
        // 登录成功后它就是站点的常驻页面，后续导航不再依赖放行窗口。
        if (entry && origin && !entry.allowedOrigins.includes(origin)) {
          entry.allowedOrigins.push(origin)
          logger.system?.info('[SiteBrowser] learn login origin', { siteId, origin })
        }
        return
      }
      event.preventDefault()
      logger.system?.warn('[SiteBrowser] blocked navigation', { siteId, url })
    })

    win.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL) => {
      if (errorCode === -3) return
      logger.system?.warn('[SiteBrowser] load failed', { siteId, errorCode, errorDescription, url: validatedURL })
    })

    return { siteId, win, partition, allowedOrigins, loginFlowUntil: 0, createdAt: Date.now() }
  }


  private isAllowed(origins: string[], url: string): boolean {
    const origin = originOf(url)
    if (!origin) return false
    return origins.some((item) => item === origin)
  }

  /**
   * 页面内跳转是否放行
   *
   * 比 navigate() 的显式白名单宽一层：显式导航是插件自己拼的地址，拼错就该失败；
   * 页面内跳转则由目标系统决定，登录流程几乎必然跨域，一律按同源拒绝会让登录
   * 卡在提交那一刻。
   */
  private isNavigationAllowed(siteId: string, origins: string[], url: string): boolean {
    if (!isHttpUrl(url)) return false
    const origin = originOf(url)
    if (!origin) return false
    if (origins.some((item) => item === origin)) return true
    // 同主域放行：oa.example.com 与 sso.example.com 之间的跳转在企业系统里是常态
    const targetSite = registrableDomainOf(origin)
    if (targetSite && origins.some((item) => registrableDomainOf(item) === targetSite)) return true
    // 登录流程内放行跨主域跳转（CAS / OAuth / 企业 IdP / 门户跳板）
    const entry = this.entries.get(siteId)
    return Boolean(entry && entry.loginFlowUntil > Date.now())
  }

  /**
   * 开启登录放行窗口
   *
   * 由插件在开始登录前调用、结束时关闭。窗口有时限：插件异常退出时放行不会一直留着。
   */
  beginLoginFlow(siteId: string, ttlMs?: number): { ttlMs: number } {
    const entry = this.requireEntry(siteId)
    const ttl = Math.min(
      Math.max(5_000, Number(ttlMs) || DEFAULT_LOGIN_FLOW_TTL_MS),
      MAX_LOGIN_FLOW_TTL_MS,
    )
    entry.loginFlowUntil = Date.now() + ttl
    logger.system?.info('[SiteBrowser] login flow opened', { siteId, ttl })
    return { ttlMs: ttl }
  }

  /** 关闭登录放行窗口（登录结束后立即收回，不必等 TTL） */
  endLoginFlow(siteId: string): void {
    const entry = this.entries.get(siteId)
    if (!entry) return
    entry.loginFlowUntil = 0
  }

  private assertAllowed(entry: SiteEntry, url: string): void {
    if (!this.isAllowed(entry.allowedOrigins, url)) {
      throw new Error(
        `目标地址不在站点白名单内：${url}（允许：${entry.allowedOrigins.join(', ') || '无'}）。` +
          '如果是站点的合法页面，请在添加站点时补充允许来源。',
      )
    }
  }

  private async navigateInternal(
    entry: SiteEntry,
    url: string,
    timeoutMs: number,
  ): Promise<SiteNavigateResult> {
    const wc = entry.win.webContents
    const waiter = waitForLoad(wc, timeoutMs)
    try {
      await wc.loadURL(url)
    } catch {
      // loadURL 在 did-fail-load 时会 reject；真正的结论由 waiter 给出，
      // 这里吞掉以免把「页面已渲染但主文档报错」误判成导航失败
    }
    return waiter.promise
  }

  private async resolvePoint(
    entry: SiteEntry,
    target: SiteClickTarget,
  ): Promise<{ x: number; y: number }> {
    if (typeof target?.x === 'number' && typeof target?.y === 'number') {
      return { x: Math.round(target.x), y: Math.round(target.y) }
    }
    const selector = String(target?.selector || '').trim()
    if (!selector) throw new Error('click 需要 selector 或 x/y 坐标')

    const script =
      `(() => { const el = document.querySelector(${JSON.stringify(selector)});` +
      ' if (!el) return null;' +
      " el.scrollIntoView({ block: 'center', inline: 'center' });" +
      ' const r = el.getBoundingClientRect();' +
      ' if (r.width === 0 && r.height === 0) return null;' +
      ' return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()'
    const point = (await entry.win.webContents.executeJavaScript(script, true)) as
      | { x: number; y: number }
      | null
    if (!point) throw new Error(`点击目标不存在或不可见：${selector}`)
    return point
  }

  private buildWaitProbe(selector: string, text: string): string {
    const parts: string[] = []
    if (selector) parts.push(`!!document.querySelector(${JSON.stringify(selector)})`)
    if (text) {
      parts.push(
        `(document.body ? document.body.innerText.toLowerCase().includes(${JSON.stringify(
          text.toLowerCase(),
        )}) : false)`,
      )
    }
    return `(() => { try { return (${parts.join(') || (')}); } catch (e) { return false; } })()`
  }

  /**
   * 填值探针
   *
   * value 必须经过原型上的 setter 写入：直接赋值会被 React 的 value 拦截器
   * 记为「已经是这个值」，它随后派发的 input 事件里读到的还是旧值。
   */
  private buildTypeProbe(selector: string, text: string, clear: boolean): string {
    return `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { ok: false, error: '目标元素不存在' };
      if (!('value' in el)) return { ok: false, error: '目标元素不是输入控件' };
      const proto = el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : el instanceof HTMLInputElement
          ? HTMLInputElement.prototype
          : Object.getPrototypeOf(el);
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      el.focus();
      const next = ${clear ? `${JSON.stringify(text)}` : `(el.value || '') + ${JSON.stringify(text)}`};
      if (setter) setter.call(el, next); else el.value = next;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true };
    })()`
  }

  private requireEntry(siteId: string): SiteEntry {
    const entry = this.entries.get(siteId)
    if (!entry || entry.win.isDestroyed()) {
      throw new Error(`站点窗口未打开：${siteId}。请先调用 siteBrowser.open。`)
    }
    return entry
  }
}

/** 全局单例：供 globalThis.__AWEECLAW_HOST__ 使用 */
export const siteBrowserBridge = new SiteBrowserBridge()
export type { SiteBrowserBridge }
