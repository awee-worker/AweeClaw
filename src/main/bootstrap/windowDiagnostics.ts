/**
 * 窗口诊断日志
 *
 * 将渲染进程的关键事件（加载失败、渲染进程崩溃、console 输出）转发到主进程日志，
 * 便于在排查渲染进程问题时无需打开 DevTools 即可看到完整上下文。
 */
import { app, BrowserWindow } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'
import { registerGpuDiagnostics } from './gpuDiagnostics'

/** 渲染进程已知的良性警告，转发时过滤避免日志噪音 */
const BENIGN_RENDERER_ERRORS = [
  'ResizeObserver loop completed with undelivered notifications',
  'ResizeObserver loop limit exceeded',
]

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/**
 * app 级子进程诊断是否已注册
 *
 * `child-process-gone` 是应用级事件，每创建一次窗口就挂一份会让同一次崩溃
 * 被重复记录 N 遍，因此用模块级标志保证只注册一次。
 */
let childProcessDiagnosticsRegistered = false

/**
 * 注册 GPU / Utility 子进程崩溃诊断
 *
 * 白屏最常见的两种成因在日志里是完全不同的证据：
 * - 渲染进程卡死 → 窗口有内容但不再更新（renderer unresponsive）
 * - GPU 进程崩溃 → 窗口整片空白，渲染进程本身是健康的（child-process-gone）
 * 只有把两者都记下来，才能区分「页面卡住」和「合成器没了」。
 */
function registerChildProcessDiagnostics(): void {
  if (childProcessDiagnosticsRegistered) return
  childProcessDiagnosticsRegistered = true

  app.on('child-process-gone', (_event, details) => {
    logger.system.error('[Main] child-process-gone', {
      type: details.type,
      reason: details.reason,
      exitCode: details.exitCode,
      serviceName: details.serviceName ?? '',
    })
  })
}

/** 为指定窗口注册诊断事件监听 */
export function registerWindowDiagnostics(win: BrowserWindow): void {
  registerChildProcessDiagnostics()
  // GPU 渲染路径是应用级状态，与子进程诊断一样只注册一次（内部幂等）。
  // 首次建窗时 app 已 ready，此时查询才是有效值。
  registerGpuDiagnostics()

  // 渲染进程卡死：执行期出现长同步任务时主线程被占满，窗口表现为白屏/无响应。
  // 此前只记录崩溃事件，卡死没有任何留痕，白屏反馈无法定位到具体窗口与时机。
  win.webContents.on('unresponsive', () => {
    logger.system.warn('[Window] renderer unresponsive', {
      windowId: win.id,
      visible: win.isVisible(),
      minimized: win.isMinimized(),
    })
  })

  win.webContents.on('responsive', () => {
    logger.system.info('[Window] renderer responsive again', { windowId: win.id })
  })

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    logger.system.error('[Window] did-fail-load', {
      windowId: win.id,
      errorCode,
      errorDescription,
      validatedURL,
      isMainFrame,
    })
  })

  win.webContents.on('render-process-gone', (_event, details) => {
    logger.system.error('[Window] render-process-gone', {
      windowId: win.id,
      reason: details.reason,
      exitCode: details.exitCode,
    })
  })

  // Electron 35+ console-message 签名：(event: { level, message, lineNumber, sourceId, frame })
  // level 为字符串：'debug' | 'info' | 'warning' | 'error'
  win.webContents.on('console-message', (event: unknown) => {
    const details = event as {
      level?: string
      message?: string
      lineNumber?: number
      sourceId?: string
    }

    const rawMessage = String(details.message ?? '')
    if (BENIGN_RENDERER_ERRORS.some((e) => rawMessage.includes(e))) return

    // 清理 console.log 携带的 CSS 样式前缀（如 %c 时间戳）
    const message = rawMessage
      .replace(/%c[^]*?(?=\s\[|$)/g, '')
      .replace(/%c/g, '')
      .replace(/\s+/g, ' ')
      .trim()

    if (!message) return

    const levelStr = details.level ?? 'info'
    const logLevel: LogLevel =
      levelStr === 'error' ? 'error' :
      levelStr === 'warning' ? 'warn' :
      levelStr === 'debug' ? 'debug' : 'info'

    logger.system[logLevel](`[Renderer] ${message}`, {
      sourceId: details.sourceId ?? '',
      line: details.lineNumber ?? 0,
    })
  })
}
