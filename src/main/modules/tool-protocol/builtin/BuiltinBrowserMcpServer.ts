/**
 * 内置浏览器自动化 MCP 服务器
 *
 * 进程内 MCP 服务器，通过 InMemoryTransport 与 ToolProtocolClient 通信，
 * 把 AI 侧的浏览器自动化工具（browser_* 系列）接到客户端内置浏览器的
 * webview guest 上——不需要再拉起 Playwright 自己的独立 Chromium。
 *
 * 工具面与 Playwright MCP 对齐（子集）：
 * - 浏览：browser_list_tabs / browser_navigate / browser_back
 * - 感知：browser_snapshot / browser_take_screenshot
 * - 交互：browser_click / browser_type / browser_wait_for
 * - 设备：browser_set_device
 * - 诊断：browser_console_messages / browser_network_requests / browser_evaluate
 *
 * 数据来源：
 * - 会话定位与健康数据（console / 崩溃 / 白屏）复用 PreviewHealthMonitor 的采集记录
 * - 快照与交互通过页面侧 DOM 探测脚本（previewDomProbe）执行
 * - console/network 直接读监控已采集的数据，不重复采集
 *
 * 安全边界：
 * - 只能操控登记进健康监控的预览 guest（resolveGuest 唯一入口），
 *   主窗口等非 webview 渲染进程永远不可达
 * - 导航仅接受 http/https，与 webviewGuard 的协议白名单一致
 * - 写操作（click/type/navigate/evaluate）不进自动批准清单，走权限确认
 */

import { webContents } from 'electron'
import type { WebContents } from 'electron'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { z } from 'zod'
import { logger } from '@shared/toolkit/LogEngine'
import { DEVICE_PRESETS } from '@shared/protocols/previewProtocol'
import { previewHealthMonitor } from '../../preview/PreviewHealthMonitor'
import { requestPreviewDeviceChange } from '../../../bridge/system/preview'
import {
  SNAPSHOT_PROBE,
  buildResolveProbe,
  buildTypeProbe,
  buildTextPresentProbe,
  buildElementContextProbe,
  buildElementEditProbe,
  buildUndoEditsProbe,
  type SnapshotResult,
  type ResolvedElement,
  type ElementFilter,
  type ElementSnapshot,
  type ElementEditOp,
  type ElementEditScope,
  type ElementEditResult,
  type UndoEditsResult,
} from '../../preview/previewDomProbe'
import { captureElementImage } from '../../preview/previewElementCapture'
import type { TextContent, ImageContent, CallToolResult } from '@modelcontextprotocol/sdk/types.js'

/** 页面加载超时 */
const LOAD_TIMEOUT_MS = 30_000
/** 等待文本的轮询间隔 */
const WAIT_POLL_INTERVAL_MS = 500
/** 等待文本的默认与最大时长 */
const WAIT_DEFAULT_S = 10
const WAIT_MAX_MS = 30_000
/** 点击按下与抬起之间的间隔，保证 mousedown/mouseup 成对被页面接收 */
const CLICK_PAUSE_MS = 30
/** 截图前等待重绘的上限：后台页面的 requestAnimationFrame 可能不触发，避免截图卡死 */
const REPAINT_TIMEOUT_MS = 500

// ============ 工具返回值辅助 ============

function text(t: string): TextContent {
  return { type: 'text', text: t }
}

function image(base64: string, mimeType: string): ImageContent {
  return { type: 'image', data: base64, mimeType }
}

function ok(...items: Array<TextContent | ImageContent>): CallToolResult {
  return { content: items }
}

function err(message: string): CallToolResult {
  return { content: [text(message)], isError: true }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 等页面完成一次重绘
 *
 * 点击 / 输入到画面更新之间隔着一帧渲染，紧接着截图常常拿到交互前的旧帧，
 * 截出来的内容与刚执行的动作对不上。在页面里等两帧 requestAnimationFrame
 * 再交回控制权，成本可忽略。
 *
 * 页面在后台或被隐藏时 rAF 可能永不触发，因此用超时兜底：宁可截到当前帧，
 * 也不能让截图工具一直挂住。
 */
async function waitForRepaint(guest: WebContents): Promise<void> {
  try {
    await Promise.race([
      guest.executeJavaScript(
        'new Promise(function (resolve) {' +
          'requestAnimationFrame(function () {' +
          'requestAnimationFrame(function () { resolve(null); }); }); })',
        true,
      ),
      delay(REPAINT_TIMEOUT_MS),
    ])
  } catch {
    // 页面尚未就绪或脚本被阻断时忽略，截图照常进行
  }
}

// ============ 会话定位与页面探测辅助 ============

function getGuest(guestId: number): WebContents | null {
  const guest = webContents.fromId(guestId)
  return guest && !guest.isDestroyed() ? guest : null
}

/**
 * 解析目标预览标签页
 *
 * 命中返回 guest 与会话信息；未命中返回给模型的错误字符串。
 * session_id / url 都缺省时取最近使用的预览标签页。
 *
 * 找不到时不会立刻判定失败：open_preview 返回后，webview 还要走「挂载 →
 * dom-ready → 上报 guest」的链路，AI 紧接着调用必然扑空。这里在限时窗口内
 * 轮询等待，把「刚打开就调用」的时序竞争吸收成一次正常命中。
 */
async function resolveTarget(args: { session_id?: string; url?: string }):
  Promise<{ guest: WebContents; sessionId: string; tabUrl: string } | string> {
  const sessionId = typeof args.session_id === 'string' && args.session_id.trim()
    ? args.session_id.trim()
    : undefined
  const urlHint = typeof args.url === 'string' && args.url.trim()
    ? args.url.trim()
    : undefined

  const resolved = await previewHealthMonitor.waitForGuest({ sessionId, url: urlHint })
  if (!resolved) {
    return (
      'No preview tab found. The built-in browser has no registered preview page for this request. ' +
      'Call open_preview first (or browser_list_tabs to see what is open) and make sure the preview ' +
      'tab is the active editor tab, then retry.'
    )
  }

  const guest = getGuest(resolved.guestId)
  if (!guest) {
    return 'The preview tab is no longer available (it may have been closed). Re-open it and retry.'
  }

  return { guest, sessionId: resolved.sessionId, tabUrl: resolved.url }
}

/**
 * 在页面里执行探测脚本并解析 JSON 结果
 *
 * 页面侧脚本统一返回 JSON 字符串；业务失败以 { ok: false, error } 表达，
 * 这里统一转成错误通道，调用方不必重复判断。
 */
async function runProbe<T>(guest: WebContents, expr: string):
  Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const raw = await guest.executeJavaScript(expr, true)
    if (typeof raw !== 'string' || !raw) {
      return { ok: false, error: 'Page probe returned unexpected data' }
    }
    const parsed = JSON.parse(raw) as T & { ok?: boolean; error?: string }
    if (parsed && parsed.ok === false) {
      return { ok: false, error: parsed.error || 'Page probe failed' }
    }
    return { ok: true, data: parsed }
  } catch (e) {
    return { ok: false, error: `Page probe failed: ${(e as Error).message}` }
  }
}

/** 从 zod 解析结果里收敛元素定位条件 */
function pickFilter(args: { index?: number; text?: string; selector?: string }): ElementFilter | null {
  if (typeof args.index === 'number') return { index: args.index }
  if (typeof args.selector === 'string' && args.selector.trim()) return { selector: args.selector.trim() }
  if (typeof args.text === 'string' && args.text.trim()) return { text: args.text.trim() }
  return null
}

// ============ 格式化 ============

function formatElement(el: SnapshotResult['elements'][number]): string {
  const parts = [`[${el.index}] <${el.tag}>`]
  if (el.text) parts.push(`"${el.text}"`)
  if (el.id) parts.push(`id=${el.id}`)
  if (el.name) parts.push(`name=${el.name}`)
  if (el.type) parts.push(`type=${el.type}`)
  if (el.placeholder) parts.push(`placeholder="${el.placeholder}"`)
  if (el.href) parts.push(`href=${el.href}`)
  return parts.join(' ')
}

// ============ 需要用户本人介入的页面闸门 ============

/**
 * 页面闸门类型
 *
 * password：要账号密码
 * opt-code：要短信 / 动态验证码
 * qr：要扫码
 * oauth：第三方授权同意页
 */
type AuthGateKind = 'password' | 'opt-code' | 'qr' | 'oauth'

interface AuthGate {
  kind: AuthGateKind
  /** 命中的页面证据，写进提示里让模型知道凭什么判断 */
  signals: string[]
}

/** 页面文本里的验证码、扫码、授权线索 */
const OTP_HINT = /(验证码|动态码|短信码|短信验证|one[- ]?time (password|code)|verification code|\botp\b|2fa|two[- ]factor)/
const QR_HINT = /(扫码|二维码|扫描二维码|scan (the )?qr|qr code)/
const OAUTH_HINT = /(授权登录|授权访问|确认授权|authorize|authorization code|allow access|使用.{0,12}(账号|帐号)登录|sign in with|continue with (google|apple|github|wechat|microsoft))/

/**
 * 判断当前页面是不是「非得用户本人动手」的闸门
 *
 * 登录、验证码、扫码、授权这四类页面 AI 无论怎么点都过不去：账号密码不在它手里，
 * 扫码要人拿手机，验证码只发到用户手机上。命中时把理由讲清楚，模型就不会反复
 * snapshot / wait_for 干耗，而是转去 ask_user 让用户在内置浏览器里自己完成。
 *
 * 判定只用快照已有的数据，零额外页面开销；宁可漏报也不多报 —— 误判会让模型
 * 把本来能自己填的表单也推给用户。
 */
function detectAuthGate(snapshot: SnapshotResult): AuthGate | null {
  const signals: string[] = []

  // 密码框是最硬的证据，优先按登录页处理
  const passwordField = snapshot.elements.find((el) => el.type === 'password')
  if (passwordField) {
    const label = passwordField.placeholder || passwordField.name || passwordField.id || ''
    signals.push(label ? `password field (${label})` : 'password field')
    return { kind: 'password', signals }
  }

  const text = [
    snapshot.textSample,
    ...snapshot.elements.map((el) => `${el.text || ''} ${el.placeholder || ''}`),
  ]
    .join(' ')
    .toLowerCase()

  // 登录 / 验证页是「窄页面」：整页就一个表单，交互元素屈指可数。
  // 内容丰富的落地页也常带「扫码登录」入口，单看关键词会误判成闸门，
  // 用元素密度把这类页面挡掉。
  const sparsePage = snapshot.interactiveCount <= 12
  if (!sparsePage) return null

  if (OTP_HINT.test(text)) {
    signals.push('one-time code prompt')
    return { kind: 'opt-code', signals }
  }
  if (QR_HINT.test(text)) {
    signals.push('QR code prompt')
    return { kind: 'qr', signals }
  }
  if (OAUTH_HINT.test(text)) {
    signals.push('third-party authorization screen')
    return { kind: 'oauth', signals }
  }

  return null
}

/** 把闸门判定结果写成给模型看的行动指令 */
function formatAuthGateHint(gate: AuthGate): string {
  const action: Record<AuthGateKind, string> = {
    password: 'the account credentials are not yours to enter',
    'opt-code': 'the code is delivered to the user, not to you',
    qr: 'scanning the QR code requires the user',
    oauth: 'granting access requires the user themselves',
  }
  return (
    `Needs the user: this page looks like a login / verification gate (${gate.signals.join(', ')}) — ` +
    `${action[gate.kind]}. ` +
    'Do NOT type credentials, do NOT try to bypass it, and do NOT call browser_wait_for in a loop. ' +
    'Call ask_user now ("请在浏览器标签页里完成登录 / 验证，完成后点继续"), then take a fresh ' +
    'browser_snapshot once the user confirms and continue from there.'
  )
}

function formatSnapshot(snapshot: SnapshotResult): string {
  const lines: string[] = []
  lines.push(`Page: ${snapshot.title || '(untitled)'}`)
  lines.push(`URL: ${snapshot.url}`)
  lines.push('')
  lines.push(`Interactive elements (${snapshot.interactiveCount}):`)
  if (snapshot.elements.length === 0) {
    lines.push('(none)')
  } else {
    for (const el of snapshot.elements) {
      lines.push(formatElement(el))
    }
    if (snapshot.interactiveCount > snapshot.elements.length) {
      lines.push(`(${snapshot.interactiveCount - snapshot.elements.length} more elements truncated)`)
    }
  }
  lines.push('')
  lines.push('Page text:')
  lines.push(snapshot.textSample || '(empty)')
  return lines.join('\n')
}

// ============ 服务器创建 ============

/**
 * 创建内置浏览器自动化 MCP 服务器。
 *
 * 返回 InMemoryTransport 对：
 * - clientTransport：交给 ToolProtocolClient
 * - server：持有 McpServer 实例，处理工具调用
 */
export function createBuiltinBrowserMcpServer(): {
  server: McpServer
  clientTransport: InMemoryTransport
} {
  const server = new McpServer(
    { name: 'builtin-browser', version: '1.0.0' },
    {
      capabilities: { tools: { listChanged: false } },
      instructions: [
        'Drives the app built-in browser preview tabs (the tabs opened via open_preview).',
        'Always call browser_snapshot before interacting, then use the returned [index] for browser_click / browser_type.',
        'browser_console_messages and browser_network_requests read the live health monitor data of the tab.',
        'Omit session_id / url to act on the most recently used preview tab.',
        'When a page needs the user themselves — logging in, scanning a QR code, entering a one-time code, approving a consent screen — stop acting and call ask_user so the user can finish it in the tab. Never invent credentials and never poll in a loop.',
      ].join(' '),
    },
  )

  registerTabTools(server)
  registerReadTools(server)
  registerInteractionTools(server)
  registerElementTools(server)
  registerDeviceTool(server)
  registerDiagnosticsTools(server)

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

  server.connect(serverTransport).catch((e) => {
    logger.mcp?.error('[BuiltinBrowserMcp] Failed to connect server transport:', e)
  })

  return { server, clientTransport }
}

// ============ 浏览工具 ============

function registerTabTools(server: McpServer): void {
  /** browser_list_tabs：列出可操控的预览标签页 */
  server.tool(
    'browser_list_tabs',
    'List preview tabs currently open in the built-in browser, with their session ids, urls and titles.',
    {},
    async () => {
      const tabs = previewHealthMonitor.listGuests()
      if (tabs.length === 0) {
        return ok(text('No preview tabs are open. Use open_preview first.'))
      }
      const lines = tabs.map(
        (tab) => `- session_id=${tab.sessionId} title="${tab.title || '(untitled)'}" url=${tab.url}`,
      )
      return ok(text(`Preview tabs (${tabs.length}):\n${lines.join('\n')}`))
    },
  )

  /** browser_navigate：在预览标签页中加载新地址 */
  server.tool(
    'browser_navigate',
    'Navigate a preview tab in the built-in browser to an http/https URL. Waits for the page to finish loading. ' +
      'If the destination turns out to be a login / authorization wall, take a browser_snapshot and hand it to the user through ask_user.',
    {
      session_id: z.string().optional().describe('Target preview session id (default: most recent tab)'),
      url: z.string().min(1).describe('URL to load (http/https only)'),
    },
    async (args) => {
      // url 在这里是导航目标而不是匹配条件：只按 session_id（缺省取最近标签页）定位
      const target = await resolveTarget({ session_id: args.session_id })
      if (typeof target === 'string') return err(target)

      let parsed: URL
      try {
        parsed = new URL(args.url.trim())
      } catch {
        return err(`Invalid URL: ${args.url}`)
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return err(`Only http/https URLs are allowed, got: ${parsed.protocol}`)
      }

      let timer: ReturnType<typeof setTimeout> | null = null
      try {
        await Promise.race([
          target.guest.loadURL(parsed.toString()),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error(`Load timed out after ${LOAD_TIMEOUT_MS / 1000}s`)),
              LOAD_TIMEOUT_MS,
            )
          }),
        ])
      } catch (e) {
        // 导航被打断（重定向、再次导航）时页面可能已经加载成功，以最终地址为准回告
        const finalUrl = target.guest.getURL()
        if (!finalUrl.startsWith(parsed.origin)) {
          return err(`Navigation failed: ${(e as Error).message}`)
        }
      } finally {
        // loadURL 先完成时定时器必须清掉：否则它会在加载结束很久之后才 reject，
        // 变成一个无人处理的 Promise rejection
        if (timer) clearTimeout(timer)
      }
      return ok(text(`Navigated to ${target.guest.getURL()} (session ${target.sessionId}).`))
    },
  )

  /** browser_back：后退一页 */
  server.tool(
    'browser_back',
    'Go back one page in the preview tab history.',
    {
      session_id: z.string().optional().describe('Target preview session id (default: most recent tab)'),
    },
    async (args) => {
      const target = await resolveTarget(args)
      if (typeof target === 'string') return err(target)

      if (!target.guest.navigationHistory.canGoBack()) {
        return err('No previous page in this tab history.')
      }
      target.guest.goBack()
      return ok(text(`Navigated back to ${target.guest.getURL()}`))
    },
  )
}

// ============ 设备模拟 ============

/** 可选设备档位清单（工具描述与错误提示共用，避免两处维护） */
function describeDevicePresets(): string {
  return DEVICE_PRESETS.map((preset) =>
    preset.id === 'desktop' ? 'desktop' : `${preset.id} (${preset.name} ${preset.width}x${preset.height})`,
  ).join(', ')
}

function registerDeviceTool(server: McpServer): void {
  /**
   * browser_set_device：切换预览标签页的设备模拟档位
   *
   * 主进程只负责把「切成哪个档位」广播给渲染进程（见 requestPreviewDeviceChange），
   * 设备框重排与 UA 应用都在渲染层完成——与用户手点工具栏走同一条路径。
   */
  server.tool(
    'browser_set_device',
    'Switch a preview tab into mobile device emulation, or back to desktop. Use it to check responsive / mobile layouts. ' +
      `Presets: ${describeDevicePresets()}. Use "desktop" to reset, or "custom" together with width/height for an arbitrary viewport.`,
    {
      session_id: z.string().optional().describe('Target preview session id (default: most recent tab)'),
      url: z.string().optional().describe('Match tab by url substring instead'),
      device: z.string().min(1).describe('Device preset id, "desktop", or "custom"'),
      width: z.number().int().min(200).max(4000).optional().describe('Viewport width ("custom", or override a preset)'),
      height: z.number().int().min(200).max(4000).optional().describe('Viewport height ("custom", or override a preset)'),
    },
    async (args) => {
      const target = await resolveTarget(args)
      if (typeof target === 'string') return err(target)

      const device = args.device.trim().toLowerCase()
      const preset = DEVICE_PRESETS.find((item) => item.id === device)
      if (!preset && device !== 'custom') {
        return err(`Unknown device "${args.device}". Valid: ${describeDevicePresets()}, custom.`)
      }

      const delivered = requestPreviewDeviceChange(target.guest, {
        sessionId: target.sessionId,
        deviceId: device,
        width: args.width,
        height: args.height,
      })
      if (!delivered) {
        return err('Could not switch device: the preview tab host is unavailable.')
      }

      const label =
        device === 'desktop'
          ? 'desktop'
          : device === 'custom'
            ? `custom ${args.width || 390}x${args.height || 844}`
            : `${preset?.name} ${args.width || preset?.width}x${args.height || preset?.height}`

      return ok(
        text(
          `Switched preview tab (session ${target.sessionId}) to device mode: ${label}. ` +
            `The page now renders at the device viewport width; use browser_snapshot / browser_take_screenshot to verify.`,
        ),
      )
    },
  )
}

// ============ 感知工具 ============

function registerReadTools(server: McpServer): void {
  /** browser_snapshot：页面结构快照（交互元素表 + 文本采样） */
  server.tool(
    'browser_snapshot',
    'Capture a structured snapshot of the preview tab: title, url, all visible interactive elements with stable [index] refs, and the page text. Use the indexes for browser_click / browser_type.',
    {
      session_id: z.string().optional().describe('Target preview session id (default: most recent tab)'),
      url: z.string().optional().describe('Match tab by url substring instead'),
    },
    async (args) => {
      const target = await resolveTarget(args)
      if (typeof target === 'string') return err(target)

      const result = await runProbe<SnapshotResult>(target.guest, SNAPSHOT_PROBE)
      if (!result.ok) return err(result.error)
      const gate = detectAuthGate(result.data)
      const body = formatSnapshot(result.data)
      return ok(text(gate ? `${body}\n\n${formatAuthGateHint(gate)}` : body))
    },
  )

  /** browser_take_screenshot：页面截图 */
  server.tool(
    'browser_take_screenshot',
    'Take a screenshot of the preview tab and return it as an image. A repaint is awaited first, so the frame reflects the interaction that just happened.',
    {
      session_id: z.string().optional().describe('Target preview session id (default: most recent tab)'),
      url: z.string().optional().describe('Match tab by url substring instead'),
      type: z.enum(['png', 'jpeg']).default('png').describe('Image format (default png; jpeg is smaller)'),
    },
    async (args) => {
      const target = await resolveTarget(args)
      if (typeof target === 'string') return err(target)

      // 交互后立即截图容易截到旧帧，先让页面把待渲染的画面刷出来
      await waitForRepaint(target.guest)

      try {
        const shot = await target.guest.capturePage()
        if (shot.isEmpty()) {
          return err(
            'Screenshot is empty: the preview tab is not rendering right now (it may be hidden, ' +
              'minimized, or still loading). Bring the tab to the front and retry, or use ' +
              'browser_snapshot when you only need the page structure.',
          )
        }

        const isJpeg = args.type === 'jpeg'
        const buffer = isJpeg ? shot.toJPEG(80) : shot.toPNG()
        const size = shot.getSize()
        return ok(
          image(buffer.toString('base64'), isJpeg ? 'image/jpeg' : 'image/png'),
          text(`Screenshot captured: ${size.width}x${size.height} (${args.type}).`),
        )
      } catch (e) {
        return err(`Screenshot failed: ${(e as Error).message}`)
      }
    },
  )
}

// ============ 交互工具 ============

function registerInteractionTools(server: McpServer): void {
  /** browser_click：按快照序号 / 文本 / 选择器点击元素 */
  server.tool(
    'browser_click',
    'Click an element in the preview tab. Locate it by [index] from browser_snapshot (preferred), visible text, or CSS selector. Real input events are dispatched, so React/Vue handlers fire normally.',
    {
      session_id: z.string().optional().describe('Target preview session id (default: most recent tab)'),
      url: z.string().optional().describe('Match tab by url substring instead'),
      index: z.number().int().min(0).optional().describe('Element index from the latest browser_snapshot'),
      text: z.string().optional().describe('Visible text of the element (exact match first, then substring)'),
      selector: z.string().optional().describe('CSS selector'),
      button: z.enum(['left', 'right', 'middle']).default('left').describe('Mouse button (default: left)'),
      double_click: z.boolean().default(false).describe('Double click instead of single'),
    },
    async (args) => {
      const target = await resolveTarget(args)
      if (typeof target === 'string') return err(target)

      const filter = pickFilter(args)
      if (!filter) {
        return err('Provide one of `index` (from browser_snapshot), `text`, or `selector`.')
      }

      const resolved = await runProbe<ResolvedElement>(target.guest, buildResolveProbe(filter))
      if (!resolved.ok) return err(resolved.error)

      // 定位坐标是页面 CSS 像素，sendInputEvent 走的是 DIP：页面被缩放时两者不等，
      // 不换算就会点到元素外面（工具栏的放大/缩小会改变 zoomFactor）
      const zoom = target.guest.getZoomFactor() || 1
      const x = Math.round(resolved.data.x * zoom)
      const y = Math.round(resolved.data.y * zoom)
      const button = args.button

      target.guest.sendInputEvent({ type: 'mouseMove', x, y })

      // 双击按两次「完整单击」发出：Chromium 依 down/up 的 clickCount 递增识别
      // dblclick，只发一次 clickCount=2 的按压不会触发页面上的双击处理
      const clickCounts = args.double_click ? [1, 2] : [1]
      for (const clickCount of clickCounts) {
        target.guest.sendInputEvent({ type: 'mouseDown', x, y, button, clickCount })
        await delay(CLICK_PAUSE_MS)
        target.guest.sendInputEvent({ type: 'mouseUp', x, y, button, clickCount })
        if (clickCounts.length > 1) await delay(CLICK_PAUSE_MS)
      }

      const label = resolved.data.text ? ` "${resolved.data.text}"` : ''
      return ok(text(`Clicked <${resolved.data.tag}>${label} at (${x}, ${y}).`))
    },
  )

  /** browser_type：向输入元素写入文本 */
  server.tool(
    'browser_type',
    'Type text into an input element in the preview tab. Locates the element like browser_click; the value is set through native setters so framework (React/Vue) state updates correctly. Default replaces existing text; set clear=false to append.',
    {
      session_id: z.string().optional().describe('Target preview session id (default: most recent tab)'),
      url: z.string().optional().describe('Match tab by url substring instead'),
      text: z.string().describe('Text to enter'),
      index: z.number().int().min(0).optional().describe('Element index from the latest browser_snapshot'),
      text_target: z.string().optional().describe('Visible text or label of the element'),
      selector: z.string().optional().describe('CSS selector'),
      submit: z.boolean().default(false).describe('Press Enter after typing (e.g. submit a search box)'),
      clear: z.boolean().default(true).describe('Replace existing value (default) or append'),
    },
    async (args) => {
      const target = await resolveTarget(args)
      if (typeof target === 'string') return err(target)

      const filter = pickFilter({ index: args.index, text: args.text_target, selector: args.selector })
      if (!filter) {
        return err('Provide one of `index` (from browser_snapshot), `text_target`, or `selector`.')
      }

      const result = await runProbe<{ ok: true; tag: string; value: string }>(
        target.guest,
        buildTypeProbe(filter, args.text, args.clear),
      )
      if (!result.ok) return err(result.error)

      if (args.submit) {
        target.guest.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' })
        await delay(CLICK_PAUSE_MS)
        target.guest.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' })
      }

      const suffix = args.submit ? ' and pressed Enter' : ''
      return ok(text(`Typed into <${result.data.tag}> (value: "${result.data.value}")${suffix}.`))
    },
  )

  /** browser_wait_for：等待文本出现或固定时长 */
  server.tool(
    'browser_wait_for',
    'Wait until the given text appears in the preview tab (polling the page text), or just wait a fixed time. ' +
      'Only for page-side timing. If you are waiting on the USER (login, QR scan, one-time code, consent), ' +
      'call ask_user instead of polling.',
    {
      session_id: z.string().optional().describe('Target preview session id (default: most recent tab)'),
      url: z.string().optional().describe('Match tab by url substring instead'),
      text: z.string().optional().describe('Text to wait for'),
      time: z.number().min(0).max(30).optional().describe('Fixed wait in seconds (used when `text` is omitted)'),
      timeout: z.number().min(1).max(30).default(WAIT_DEFAULT_S).describe(`Max seconds to wait for the text (default ${WAIT_DEFAULT_S})`),
    },
    async (args) => {
      const target = await resolveTarget(args)
      if (typeof target === 'string') return err(target)

      if (!args.text) {
        const seconds = args.time ?? 1
        await delay(seconds * 1000)
        return ok(text(`Waited ${seconds}s.`))
      }

      const deadline = Date.now() + Math.min(args.timeout, WAIT_MAX_MS) * 1000
      while (Date.now() < deadline) {
        const result = await runProbe<{ present: boolean }>(
          target.guest,
          buildTextPresentProbe(args.text),
        )
        if (result.ok && result.data.present) {
          return ok(text(`Text appeared: "${args.text}"`))
        }
        await delay(WAIT_POLL_INTERVAL_MS)
      }

      return err(
        `Timed out after ${args.timeout}s waiting for text: "${args.text}". ` +
          'If that text only appears after the user acts (signing in, scanning a QR code, ' +
          'entering a one-time code, approving a consent screen), stop polling and call ask_user ' +
          'so the user can finish it in this tab, then retry once they confirm.',
      )
    },
  )
}

// ============ 元素修改工具 ============

/**
 * 格式化元素快照
 *
 * 按「先结论、后细节」排：选择器与尺寸在最前（决定怎么改），样式与 HTML 在后
 * （决定改成什么）。
 */
function formatElementSnapshot(snapshot: ElementSnapshot): string {
  const lines: string[] = []
  lines.push(`Element: <${snapshot.tag}>`)
  lines.push(`Selector: ${snapshot.selector}`)
  if (snapshot.id) lines.push(`Id: ${snapshot.id}`)
  if (snapshot.classes.length > 0) lines.push(`Classes: ${snapshot.classes.join(' ')}`)
  lines.push(
    `Rect: ${snapshot.rect.w}x${snapshot.rect.h} at (${snapshot.rect.x}, ${snapshot.rect.y}) ` +
      `in viewport ${snapshot.viewport.w}x${snapshot.viewport.h}`,
  )
  if (snapshot.sameSiblings > 1) {
    lines.push(
      `Identical siblings: ${snapshot.sameSiblings} ` +
        '(pass scope="similar" to browser_edit_element to change them together)',
    )
  }
  if (snapshot.embeddedFrame) {
    lines.push(
      'Note: this element is an embedded frame. Its inner DOM is not reachable — only the container itself can be changed.',
    )
  }
  if (snapshot.selectedText) {
    lines.push('')
    lines.push(`User selected this text: "${snapshot.selectedText}"`)
  }

  lines.push('')
  lines.push(`Text: ${snapshot.text || '(empty)'}`)

  lines.push('')
  lines.push('Computed styles:')
  const styleEntries = Object.entries(snapshot.styles)
  if (styleEntries.length === 0) {
    lines.push('(none)')
  } else {
    for (const [key, value] of styleEntries) lines.push(`  ${key}: ${value}`)
  }

  lines.push('')
  lines.push(`Ancestors: ${snapshot.ancestors.length > 0 ? snapshot.ancestors.join(' < ') : '(none)'}`)

  lines.push('')
  lines.push('HTML:')
  lines.push(snapshot.html || '(empty)')

  return lines.join('\n')
}

/**
 * 把工具参数收敛成页面侧编辑指令
 *
 * 校验失败返回错误字符串。op=style/attr 缺 prop 时必须在入口拦住：
 * 页面脚本拿到空属性名不会报错，只会静默写一个无效内联样式，用户看到的是
 * 「AI 说改好了，但页面没变」。
 */
function buildEditPayload(
  op: 'text' | 'style' | 'attr' | 'html' | 'hide',
  prop: string | undefined,
  value: string | undefined,
): ElementEditOp | string {
  if (op === 'hide') return { op: 'hide' }

  if (op === 'text' || op === 'html') {
    if (typeof value !== 'string') return `op=${op} requires a value`
    return { op, value }
  }

  const name = typeof prop === 'string' ? prop.trim() : ''
  if (!name) {
    return `op=${op} requires prop (a CSS property name for style, an attribute name for attr)`
  }

  if (op === 'style') {
    if (typeof value !== 'string' || !value) return 'op=style requires a non-empty value'
    return { op: 'style', prop: name, value }
  }

  // attr：空字符串表示移除该属性
  if (value === undefined) {
    return 'op=attr requires a value (pass an empty string to remove the attribute)'
  }
  return { op: 'attr', prop: name, value: value === '' ? null : value }
}

function registerElementTools(server: McpServer): void {
  /** browser_element_context：读取单个元素的完整上下文 */
  server.tool(
    'browser_element_context',
    'Read one element in a preview tab in full: unique CSS selector, tag/classes, text, outerHTML excerpt, viewport rect, ' +
      'whitelisted computed styles, ancestor chain, and how many identical siblings it has. ' +
      'Use it before editing a picked element, or to inspect an element located via browser_snapshot. ' +
      'Set include_screenshot to also get a cropped image of the element — the reliable way to judge spacing, alignment and colour.',
    {
      session_id: z.string().optional().describe('Target preview session id (default: most recent tab)'),
      url: z.string().optional().describe('Match tab by url substring instead'),
      selector: z.string().min(1).describe('CSS selector of the target element'),
      include_screenshot: z
        .boolean()
        .optional()
        .describe('Also return a cropped screenshot of the element'),
    },
    async (args) => {
      const target = await resolveTarget(args)
      if (typeof target === 'string') return err(target)

      const selector = args.selector.trim()
      const result = await runProbe<ElementSnapshot>(
        target.guest,
        buildElementContextProbe(selector),
      )
      if (!result.ok) return err(result.error)

      const items: Array<TextContent | ImageContent> = [text(formatElementSnapshot(result.data))]

      if (args.include_screenshot) {
        const shot = await captureElementImage(target.guest, selector)
        if (shot) items.push(image(shot.base64, shot.mimeType))
        else items.push(text('(screenshot unavailable: the element is outside the visible viewport)'))
      }

      return ok(...items)
    },
  )

  /**
   * browser_edit_element：就地修改元素
   *
   * 工具描述里明确要求「优先改源码」：本工具改的是运行时 DOM，刷新即失效；
   * 页面来自本地项目时，改源码才是用户真正要的结果。
   */
  server.tool(
    'browser_edit_element',
    'Change one element in a preview tab at runtime: text, style, attribute, inner HTML, or hide it. ' +
      'Every change is recorded in a page-side edit log so browser_undo_edits can roll it back; reloading the page discards all of them.\n' +
      'PREFER EDITING THE SOURCE FILE when the page comes from the local project: search the workspace for the element text or class name, ' +
      'edit the component there, and let HMR re-render. Use this runtime tool when there is no local source, or when the user wants to preview a change before touching code.\n' +
      'scope="similar" applies the same change to identical siblings (cards, list items) instead of only the one element.',
    {
      session_id: z.string().optional().describe('Target preview session id (default: most recent tab)'),
      url: z.string().optional().describe('Match tab by url substring instead'),
      selector: z.string().min(1).describe('CSS selector of the target element'),
      op: z.enum(['text', 'style', 'attr', 'html', 'hide']).describe('Operation to apply'),
      prop: z
        .string()
        .optional()
        .describe('CSS property name for op=style, attribute name for op=attr'),
      value: z
        .string()
        .optional()
        .describe('New value. Ignored for op=hide. For op=attr an empty string removes the attribute.'),
      scope: z
        .enum(['one', 'similar'])
        .optional()
        .describe('one (default) changes only this element, similar changes identical siblings too'),
    },
    async (args) => {
      const target = await resolveTarget(args)
      if (typeof target === 'string') return err(target)

      const edit = buildEditPayload(args.op, args.prop, args.value)
      if (typeof edit === 'string') return err(edit)

      const scope: ElementEditScope = args.scope === 'similar' ? 'similar' : 'one'
      const result = await runProbe<ElementEditResult>(
        target.guest,
        buildElementEditProbe(args.selector.trim(), edit, scope),
      )
      if (!result.ok) return err(result.error)

      const data = result.data
      return ok(
        text(
          `Applied "${data.op}" to ${data.affected} element(s). New value: ${data.applied || '(none)'}\n` +
            `The edit log now holds ${data.editCount} entr${data.editCount === 1 ? 'y' : 'ies'} — call browser_undo_edits to roll back.`,
        ),
      )
    },
  )

  /** browser_undo_edits：回滚运行时修改 */
  server.tool(
    'browser_undo_edits',
    'Roll back runtime element edits made by browser_edit_element in a preview tab. ' +
      'mode="last" undoes the most recent change, mode="all" (default) restores every change made since the page loaded.',
    {
      session_id: z.string().optional().describe('Target preview session id (default: most recent tab)'),
      url: z.string().optional().describe('Match tab by url substring instead'),
      mode: z
        .enum(['last', 'all'])
        .optional()
        .describe('last = undo the most recent change, all = restore everything (default)'),
    },
    async (args) => {
      const target = await resolveTarget(args)
      if (typeof target === 'string') return err(target)

      const mode = args.mode === 'last' ? 'last' : 'all'
      const result = await runProbe<UndoEditsResult>(target.guest, buildUndoEditsProbe(mode))
      if (!result.ok) return err(result.error)

      const data = result.data
      if (data.undone === 0 && data.skipped === 0) {
        return ok(text('No runtime edits to roll back in this tab.'))
      }

      return ok(
        text(
          `Rolled back ${data.undone} edit(s).` +
            (data.skipped > 0 ? ` ${data.skipped} skipped (their elements no longer exist).` : '') +
            ` Remaining in the log: ${data.remaining}.`,
        ),
      )
    },
  )
}

// ============ 诊断工具 ============

function registerDiagnosticsTools(server: McpServer): void {
  /** browser_console_messages：读取控制台告警与错误（健康监控实时数据） */
  server.tool(
    'browser_console_messages',
    'Read console warnings and errors collected from the preview tab by the app health monitor.',
    {
      session_id: z.string().optional().describe('Target preview session id (default: most recent tab)'),
      url: z.string().optional().describe('Match tab by url substring instead'),
      level: z.enum(['warning', 'error']).optional().describe('Filter by level (default: all)'),
    },
    async (args) => {
      const target = await resolveTarget(args)
      if (typeof target === 'string') return err(target)

      const snapshot = previewHealthMonitor.getSnapshot(target.sessionId)
      if (!snapshot) {
        return ok(text('No health data collected yet for this tab.'))
      }

      const entries = snapshot.consoleMessages.filter(
        (entry) => !args.level || entry.level === args.level,
      )
      if (entries.length === 0) {
        return ok(text(`No console ${args.level || 'warnings or errors'} recorded for this tab.`))
      }

      const lines = entries.map((entry) => {
        const repeat = entry.count > 1 ? ` (x${entry.count})` : ''
        return `[${entry.level}] ${entry.message}${repeat} (${entry.source}:${entry.line})`
      })
      return ok(text(`Console messages (${entries.length}):\n${lines.join('\n')}`))
    },
  )

  /** browser_network_requests：读取页面资源瀑布 */
  server.tool(
    'browser_network_requests',
    'Collect the resource waterfall (url, type, duration, size, status) of the preview tab from the page Performance API.',
    {
      session_id: z.string().optional().describe('Target preview session id (default: most recent tab)'),
      url: z.string().optional().describe('Match tab by url substring instead'),
    },
    async (args) => {
      const target = await resolveTarget(args)
      if (typeof target === 'string') return err(target)

      const entries = await previewHealthMonitor.collectNetwork(target.guest.id)
      if (entries.length === 0) {
        return ok(text('No resource entries recorded (page may still be loading).'))
      }

      const lines = entries.map(
        (entry) => `[${entry.type}] ${entry.status || '-'} ${entry.duration}ms ${entry.size}B ${entry.url}`,
      )
      return ok(text(`Resource waterfall (${entries.length}):\n${lines.join('\n')}`))
    },
  )

  /** browser_evaluate：在预览页面执行 JS 表达式 */
  server.tool(
    'browser_evaluate',
    'Evaluate a JavaScript expression in the preview tab and return its JSON-serializable result. Only the preview page is reachable — never the app itself.',
    {
      session_id: z.string().optional().describe('Target preview session id (default: most recent tab)'),
      url: z.string().optional().describe('Match tab by url substring instead'),
      script: z.string().min(1).describe('JavaScript expression or async IIFE to evaluate'),
    },
    async (args) => {
      const target = await resolveTarget(args)
      if (typeof target === 'string') return err(target)

      // 包一层 async IIFE：表达式与 Promise 都能拿到结果，异常也收敛成 JSON
      const wrapped = `(async function () {
        try {
          var result = await (${args.script});
          return JSON.stringify({ ok: true, value: result === undefined ? null : result });
        } catch (e) {
          return JSON.stringify({ ok: false, error: String((e && e.message) || e) });
        }
      })()`

      const result = await runProbe<{ value: unknown }>(target.guest, wrapped)
      if (!result.ok) return err(result.error)
      return ok(text(JSON.stringify(result.data.value, null, 2)))
    },
  )
}
