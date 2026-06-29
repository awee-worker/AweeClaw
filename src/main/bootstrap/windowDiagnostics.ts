/**
 * 窗口诊断日志
 *
 * 将渲染进程的关键事件（加载失败、渲染进程崩溃、console 输出）转发到主进程日志，
 * 便于在排查渲染进程问题时无需打开 DevTools 即可看到完整上下文。
 */
import { BrowserWindow } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'

/** 渲染进程已知的良性警告，转发时过滤避免日志噪音 */
const BENIGN_RENDERER_ERRORS = [
  'ResizeObserver loop completed with undelivered notifications',
  'ResizeObserver loop limit exceeded',
]

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/** 为指定窗口注册诊断事件监听 */
export function registerWindowDiagnostics(win: BrowserWindow): void {
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
