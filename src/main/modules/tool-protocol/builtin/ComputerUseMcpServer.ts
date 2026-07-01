/**
 * Computer Use 内置 MCP 服务器
 *
 * 进程内 MCP 服务器，通过 InMemoryTransport 与 McpClient 通信。
 * 工具实现复用项目自研的 DesktopControlManager（截图/鼠标/键盘/窗口/进程/文件）
 * 和 MacVisionOcrRouter（macOS Vision Framework 本地 OCR）。
 *
 * 核心能力：
 * - 截图 + OCR 识别（本地 Vision OCR，200-500ms，离线）
 * - click_text 按文字点击（OCR 两阶段匹配：精确 → 子串）
 * - 鼠标/键盘输入模拟
 * - 窗口/进程管理
 * - 文件读写
 *
 * 安全约束（来自项目记忆）：
 * - click_text 必须使用 OCR 精确定位，禁止 LLM 猜测坐标
 * - OCR 图片必须裁剪到目标应用窗口，避免全屏 OCR 文字串扰
 * - 所有写操作经 DesktopGuard 权限管控（弹窗确认）
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { z } from 'zod'
import * as fs from 'fs'
import * as path from 'path'
import { logger } from '@shared/toolkit/LogEngine'
import { getDesktopControlManager } from '../../desktop-control/DesktopControlManager'
import { macVisionOcrRouter } from '../../desktop-control/MacVisionOcrRouter'
import { captureForOcr, matchOcrText } from './ocrUtils'
import type { TextContent, ImageContent, CallToolResult } from '@modelcontextprotocol/sdk/types.js'

/** 读取文件最大大小（10MB），防止 OOM */
const MAX_READ_SIZE = 10 * 1024 * 1024

// ============ 工具返回值辅助函数 ============

/** 文本内容 */
function text(t: string): TextContent {
  return { type: 'text', text: t }
}

/** JSON 序列化文本内容 */
function json(data: unknown): TextContent {
  return { type: 'text', text: JSON.stringify(data, null, 2) }
}

/** 图片内容 */
function image(base64: string, mimeType: string): ImageContent {
  return { type: 'image', data: base64, mimeType }
}

/** 成功结果 */
function ok(...items: Array<TextContent | ImageContent>): CallToolResult {
  return { content: items }
}

/** 错误结果 */
function err(message: string): CallToolResult {
  return { content: [text(message)], isError: true }
}

// ============ 服务器创建 ============

/**
 * 创建 Computer Use 内置 MCP 服务器。
 *
 * 返回 InMemoryTransport 对：
 * - clientTransport：交给 McpClient，用于发起工具调用
 * - server：持有 McpServer 实例，处理工具调用
 *
 * 用法：
 * ```ts
 * const { server, clientTransport } = createComputerUseMcpServer()
 * await server.connect(serverTransport) // serverTransport 在内部已配对
 * await mcpClient.connectWithTransport(clientTransport)
 * ```
 */
export function createComputerUseMcpServer(): {
  server: McpServer
  clientTransport: InMemoryTransport
} {
  const server = new McpServer(
    { name: 'computer-use', version: '1.0.0' },
    {
      capabilities: { tools: { listChanged: false } },
      instructions: [
        'Desktop automation server. Use click_text (OCR-based) as the PRIMARY click method for any UI element with visible text.',
        'Avoid guessing pixel coordinates when text is visible. Screenshots are returned as images for your reference.',
      ].join(' '),
    },
  )

  registerScreenTools(server)
  registerInputTools(server)
  registerWindowProcessTools(server)
  registerFileTools(server)

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

  // 异步启动 server 端 transport
  server.connect(serverTransport).catch((e) => {
    logger.mcp?.error('[ComputerUseMcp] Failed to connect server transport:', e)
  })

  return { server, clientTransport }
}

// ============ 截图 + OCR 工具 ============

function registerScreenTools(server: McpServer): void {
  const manager = getDesktopControlManager()

  /** screen_capture：截屏，返回图片内容供 LLM 查看 */
  server.tool(
    'screen_capture',
    'Capture a screenshot of the screen or a specific region. Returns the image for visual inspection.',
    {
      displayId: z.number().int().min(0).optional().describe('Display monitor ID (default: primary display)'),
      region: z.object({
        x: z.number(),
        y: z.number(),
        width: z.number().positive(),
        height: z.number().positive(),
      }).optional().describe('Capture only this rectangular region (screen coordinates)'),
    },
    async (args) => {
      try {
        const result = args.region
          ? await manager.captureRegion(args.region, args.displayId)
          : await manager.captureScreen(args.displayId)

        if (!result.success || !result.dataUrl) {
          return err(result.error || 'Screenshot failed')
        }

        // dataUrl 格式：data:image/png;base64,xxxx
        const base64 = result.dataUrl.split(',')[1] || result.dataUrl
        return ok(
          image(base64, 'image/png'),
          text(`Screenshot captured: ${result.region.width}x${result.region.height}, display=${result.displayId}`),
        )
      } catch (e) {
        return err(`screen_capture failed: ${(e as Error).message}`)
      }
    },
  )

  /** ocr_recognize：识别屏幕文字，返回文字列表（含坐标和置信度） */
  server.tool(
    'ocr_recognize',
    'Recognize text on screen using OCR. Returns a list of detected text items with their coordinates and confidence. Optionally crop to a specific app window to avoid text crosstalk from other windows.',
    {
      appName: z.string().optional().describe('Target app name — screenshot is cropped to this app window bounds before OCR, avoiding text from other windows'),
    },
    async (args) => {
      try {
        // 可选：裁剪到目标应用窗口
        let targetBounds = null
        if (args.appName) {
          targetBounds = await manager.getActiveWindowBounds(args.appName)
        }

        const ocrShot = await captureForOcr(manager, targetBounds)

        // 本地 Vision OCR（macOS 原生）
        if (!(await macVisionOcrRouter.isAvailable())) {
          const reason = macVisionOcrRouter.getUnavailableReason()
          return err(
            `Local Vision OCR is not available. ${reason ? `Reason: ${reason}. ` : ''}` +
            'Run: pip3 install pyobjc-framework-Vision pyobjc-framework-Quartz',
          )
        }

        const items = await macVisionOcrRouter.recognize(ocrShot.base64)
        if (items.length === 0) {
          return ok(text('OCR returned no text — image may be empty or too low quality.'))
        }

        // 还原坐标到原始屏幕
        const results = items.map((item) => ({
          text: item.text,
          x: Math.round(item.x * ocrShot.scaleX) + ocrShot.cropX,
          y: Math.round(item.y * ocrShot.scaleY) + ocrShot.cropY,
          width: item.width,
          height: item.height,
          confidence: Number(item.confidence.toFixed(3)),
        }))

        return ok(
          text(`OCR recognized ${results.length} text items:`),
          json(results),
        )
      } catch (e) {
        return err(`ocr_recognize failed: ${(e as Error).message}`)
      }
    },
  )
}

// ============ 鼠标键盘工具 ============

function registerInputTools(server: McpServer): void {
  const manager = getDesktopControlManager()

  /** click_text：按文字点击（OCR 精确定位，核心工具） */
  server.tool(
    'click_text',
    'Find and click a UI element by its visible text label using OCR. This is the PRIMARY click method — prefer it over mouse_click when the element has visible text. Uses two-stage matching: exact match first, then substring fallback.',
    {
      text: z.string().min(1).describe('The visible text label of the UI element to click'),
      appName: z.string().optional().describe('Target app name — crops screenshot to this window before OCR for accuracy'),
      button: z.enum(['left', 'right', 'middle']).default('left').describe('Mouse button (default: left)'),
      clickType: z.enum(['single', 'double']).default('single').describe('Click type (default: single)'),
    },
    async (args) => {
      try {
        // 裁剪到目标窗口，避免 OCR 误识别其他窗口文字
        let targetBounds = null
        if (args.appName) {
          targetBounds = await manager.getActiveWindowBounds(args.appName)
        }

        const ocrShot = await captureForOcr(manager, targetBounds)

        if (!(await macVisionOcrRouter.isAvailable())) {
          const reason = macVisionOcrRouter.getUnavailableReason()
          return err(
            `Local Vision OCR is not available. ${reason ? `Reason: ${reason}. ` : ''}` +
            'Run: pip3 install pyobjc-framework-Vision pyobjc-framework-Quartz',
          )
        }

        const ocrItems = await macVisionOcrRouter.recognize(ocrShot.base64)
        if (ocrItems.length === 0) {
          return err('OCR returned no text — cannot locate the target element.')
        }

        // 两阶段匹配：精确 → 子串
        const candidates = matchOcrText(ocrItems, args.text, ocrShot)
        if (candidates.length === 0) {
          const topItems = [...ocrItems]
            .sort((a, b) => b.confidence - a.confidence)
            .slice(0, 10)
            .map((i) => `"${i.text}"(conf=${i.confidence.toFixed(2)})`)
            .join(', ')
          return err(
            `Text "${args.text}" not found in ${ocrItems.length} OCR results. Top results: ${topItems}`,
          )
        }

        const match = candidates[0]
        logger.mcp?.info(
          `[ComputerUseMcp] click_text: "${args.text}" matched "${match.text}" ` +
          `at (${match.screenX},${match.screenY}) level=${match.matchLevel} conf=${match.confidence.toFixed(2)}`,
        )

        // 点击匹配位置中心
        const clickX = match.screenX + Math.round(match.width / 2)
        const clickY = match.screenY + Math.round(match.height / 2)
        await manager.mouseClick({
          x: clickX,
          y: clickY,
          button: args.button,
          clickType: args.clickType,
        })

        const matchDesc = matchLevelDesc(match.matchLevel)
        return ok(
          text(
            `Clicked "${match.text}" at (${clickX},${clickY}) — ${matchDesc}, confidence=${match.confidence.toFixed(2)}.` +
            (candidates.length > 1 ? ` (${candidates.length} candidates found, used top match.)` : ''),
          ),
        )
      } catch (e) {
        return err(`click_text failed: ${(e as Error).message}`)
      }
    },
  )

  /** mouse_click：按坐标点击 */
  server.tool(
    'mouse_click',
    'Click at the given screen coordinates. Prefer click_text when the element has visible text.',
    {
      x: z.number().int().describe('Screen X coordinate'),
      y: z.number().int().describe('Screen Y coordinate'),
      button: z.enum(['left', 'right', 'middle']).default('left'),
      clickType: z.enum(['single', 'double']).default('single'),
    },
    async (args) => {
      try {
        const result = await manager.mouseClick({
          x: args.x,
          y: args.y,
          button: args.button,
          clickType: args.clickType,
        })
        return ok(json(result))
      } catch (e) {
        return err(`mouse_click failed: ${(e as Error).message}`)
      }
    },
  )

  /** mouse_move：移动鼠标 */
  server.tool(
    'mouse_move',
    'Move the mouse cursor to the given coordinates.',
    {
      x: z.number().int(),
      y: z.number().int(),
      smooth: z.boolean().optional().describe('Animate the movement (default: false)'),
      duration: z.number().int().min(0).optional().describe('Movement duration in ms (only when smooth)'),
    },
    async (args) => {
      try {
        const result = await manager.mouseMove({
          x: args.x,
          y: args.y,
          smooth: args.smooth,
          duration: args.duration,
        })
        return ok(json(result))
      } catch (e) {
        return err(`mouse_move failed: ${(e as Error).message}`)
      }
    },
  )

  /** mouse_scroll：滚动 */
  server.tool(
    'mouse_scroll',
    'Scroll at the given coordinates. Positive amount scrolls down, negative scrolls up.',
    {
      x: z.number().int(),
      y: z.number().int(),
      amount: z.number().describe('Scroll amount (positive=down, negative=up)'),
    },
    async (args) => {
      try {
        const result = await manager.mouseScroll({
          x: args.x,
          y: args.y,
          amount: args.amount,
        })
        return ok(json(result))
      } catch (e) {
        return err(`mouse_scroll failed: ${(e as Error).message}`)
      }
    },
  )

  /** mouse_drag：拖拽 */
  server.tool(
    'mouse_drag',
    'Drag the mouse from one point to another (hold, move, release).',
    {
      fromX: z.number().int(),
      fromY: z.number().int(),
      toX: z.number().int(),
      toY: z.number().int(),
      button: z.enum(['left', 'right', 'middle']).default('left'),
      duration: z.number().int().min(0).optional().describe('Drag duration in ms'),
    },
    async (args) => {
      try {
        const result = await manager.mouseDrag({
          fromX: args.fromX,
          fromY: args.fromY,
          toX: args.toX,
          toY: args.toY,
          button: args.button,
          duration: args.duration,
        })
        return ok(json(result))
      } catch (e) {
        return err(`mouse_drag failed: ${(e as Error).message}`)
      }
    },
  )

  /** keyboard_type：输入文本 */
  server.tool(
    'keyboard_type',
    'Type a text string at the current cursor position. Click the input field first to focus it.',
    {
      text: z.string().min(1).describe('Text to type'),
      delayMs: z.number().int().min(0).optional().describe('Delay between keystrokes in ms'),
    },
    async (args) => {
      try {
        const result = await manager.typeText(args.text, args.delayMs)
        return ok(json(result))
      } catch (e) {
        return err(`keyboard_type failed: ${(e as Error).message}`)
      }
    },
  )

  /** keyboard_press：按键或组合键（如 "cmd+c"） */
  server.tool(
    'keyboard_press',
    'Press a single key or a key combination. Use "+" to combine keys, e.g. "cmd+c", "ctrl+shift+tab", "enter", "escape".',
    {
      key: z.string().min(1).describe('Key or key combo, e.g. "enter", "cmd+c", "ctrl+shift+tab"'),
    },
    async (args) => {
      try {
        // 支持组合键：包含 "+" 时拆分为 keyCombo
        if (args.key.includes('+')) {
          const keys = args.key.split('+').map((k) => k.trim()).filter(Boolean)
          if (keys.length < 2) {
            return err('Key combo must have at least 2 keys separated by "+", e.g. "cmd+c"')
          }
          const result = await manager.keyCombo(keys)
          return ok(json(result))
        }
        const result = await manager.pressKey(args.key)
        return ok(json(result))
      } catch (e) {
        return err(`keyboard_press failed: ${(e as Error).message}`)
      }
    },
  )
}

// ============ 窗口/进程工具 ============

function registerWindowProcessTools(server: McpServer): void {
  const manager = getDesktopControlManager()

  /** list_windows：列出所有窗口 */
  server.tool(
    'list_windows',
    'List all open windows with their titles, app names, bounds, and focus state.',
    {},
    async () => {
      try {
        const windows = await manager.listWindows()
        return ok(json(windows))
      } catch (e) {
        return err(`list_windows failed: ${(e as Error).message}`)
      }
    },
  )

  /** focus_window：聚焦窗口 */
  server.tool(
    'focus_window',
    'Bring a window to the foreground by its window ID (from list_windows).',
    {
      windowId: z.string().min(1).describe('Window ID from list_windows'),
    },
    async (args) => {
      try {
        const result = await manager.focusWindow(args.windowId)
        return ok(json(result))
      } catch (e) {
        return err(`focus_window failed: ${(e as Error).message}`)
      }
    },
  )

  /** launch_app：启动应用 */
  server.tool(
    'launch_app',
    'Launch an application by name (e.g. "Safari", "Terminal", "Visual Studio Code").',
    {
      name: z.string().min(1).describe('Application name'),
      args: z.array(z.string()).optional().describe('Command-line arguments'),
    },
    async (args) => {
      try {
        const result = await manager.launchApp(args.name, args.args)
        return ok(json(result))
      } catch (e) {
        return err(`launch_app failed: ${(e as Error).message}`)
      }
    },
  )

  /** quit_app：退出应用 */
  server.tool(
    'quit_app',
    'Quit an application by name.',
    {
      name: z.string().min(1).describe('Application name'),
    },
    async (args) => {
      try {
        const result = await manager.quitApp(args.name)
        return ok(json(result))
      } catch (e) {
        return err(`quit_app failed: ${(e as Error).message}`)
      }
    },
  )

  /** list_processes：列出进程 */
  server.tool(
    'list_processes',
    'List running processes with PID, name, CPU and memory usage.',
    {},
    async () => {
      try {
        const processes = await manager.listProcesses()
        return ok(json(processes))
      } catch (e) {
        return err(`list_processes failed: ${(e as Error).message}`)
      }
    },
  )

  /** kill_process：结束进程 */
  server.tool(
    'kill_process',
    'Terminate a process by PID. Requires confirmation for safety.',
    {
      pid: z.number().int().positive().describe('Process ID'),
      force: z.boolean().default(false).describe('Force kill (SIGKILL instead of SIGTERM)'),
    },
    async (args) => {
      try {
        const result = await manager.killProcess(args.pid, args.force)
        return ok(json(result))
      } catch (e) {
        return err(`kill_process failed: ${(e as Error).message}`)
      }
    },
  )
}

// ============ 文件操作工具 ============

function registerFileTools(server: McpServer): void {
  const manager = getDesktopControlManager()

  /** read_file：读取文件内容（限制 10MB） */
  server.tool(
    'read_file',
    'Read the content of a text file. Returns the file content as a string. Max size: 10MB.',
    {
      path: z.string().min(1).describe('Absolute file path'),
      encoding: z.string().default('utf-8').describe('Text encoding (default: utf-8)'),
    },
    async (args) => {
      try {
        const filePath = args.path
        if (!path.isAbsolute(filePath)) {
          return err('Path must be absolute.')
        }
        if (!fs.existsSync(filePath)) {
          return err(`File not found: ${filePath}`)
        }
        const stat = fs.statSync(filePath)
        if (stat.isDirectory()) {
          return err(`Path is a directory, not a file: ${filePath}`)
        }
        if (stat.size > MAX_READ_SIZE) {
          return err(`File too large (${stat.size} bytes, max ${MAX_READ_SIZE} bytes).`)
        }
        const content = fs.readFileSync(filePath, args.encoding as BufferEncoding)
        return ok(text(content))
      } catch (e) {
        return err(`read_file failed: ${(e as Error).message}`)
      }
    },
  )

  /** write_file：写入文件内容 */
  server.tool(
    'write_file',
    'Write content to a file. Creates the file if it does not exist, overwrites if it does. Parent directories must exist.',
    {
      path: z.string().min(1).describe('Absolute file path'),
      content: z.string().describe('Content to write'),
      encoding: z.string().default('utf-8').describe('Text encoding (default: utf-8)'),
    },
    async (args) => {
      try {
        const filePath = args.path
        if (!path.isAbsolute(filePath)) {
          return err('Path must be absolute.')
        }
        const dir = path.dirname(filePath)
        if (!fs.existsSync(dir)) {
          return err(`Parent directory does not exist: ${dir}`)
        }
        fs.writeFileSync(filePath, args.content, args.encoding as BufferEncoding)
        return ok(text(`File written: ${filePath} (${args.content.length} chars)`))
      } catch (e) {
        return err(`write_file failed: ${(e as Error).message}`)
      }
    },
  )

  /** list_directory：列出目录内容 */
  server.tool(
    'list_directory',
    'List files and subdirectories in a directory.',
    {
      path: z.string().min(1).describe('Absolute directory path'),
    },
    async (args) => {
      try {
        const entries = await manager.listDirectory(args.path)
        return ok(json(entries))
      } catch (e) {
        return err(`list_directory failed: ${(e as Error).message}`)
      }
    },
  )

  /** get_file_info：获取文件信息 */
  server.tool(
    'get_file_info',
    'Get metadata of a file or directory (size, timestamps, permissions).',
    {
      path: z.string().min(1).describe('Absolute file or directory path'),
    },
    async (args) => {
      try {
        const info = await manager.getFileInfo(args.path)
        return ok(json(info))
      } catch (e) {
        return err(`get_file_info failed: ${(e as Error).message}`)
      }
    },
  )

  /** wait：等待指定时间（让 UI 动画/加载完成后再继续操作） */
  server.tool(
    'wait',
    'Wait for a specified duration. Useful for waiting for UI animations, page loading, or application startup to complete before the next action.',
    {
      ms: z.number().int().min(0).max(60_000).describe('Duration to wait in milliseconds (0-60000)'),
    },
    async (args) => {
      await new Promise(resolve => setTimeout(resolve, args.ms))
      return ok(text(`Waited ${args.ms}ms`))
    },
  )
}

// ============ 辅助函数 ============

/** 匹配级别描述文本 */
function matchLevelDesc(level: number): string {
  switch (level) {
    case 1: return 'exact match'
    case 2: return 'substring match'
    case 3: return 'contained match'
    case 4: return 'no-space match'
    default: return `level-${level}`
  }
}
