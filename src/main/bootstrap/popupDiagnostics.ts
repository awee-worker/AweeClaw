/**
 * 内置浏览器新窗口链路诊断
 *
 * 主进程的常规日志受「文件日志」开关控制，默认关闭时现场没有任何可读记录，
 * 排查 webview 内 target=_blank / window.open 这类链路问题只能靠猜。
 * 这里开一条独立通道：主进程关节点与渲染层带 [diag] 标记的 console 一律写入
 * userData 下的 popup-diag.log，不受日志开关影响。
 *
 * 定位结束后整个文件与各处调用一并移除。
 */
import { app, BrowserWindow } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

/** 诊断文件路径：userData 根目录，便于直接查看 */
export function getPopupDiagLogPath(): string {
  return path.join(app.getPath('userData'), 'popup-diag.log')
}

/** 追加一行诊断记录；落盘失败不影响主流程 */
export function diagLog(scope: string, detail?: unknown): void {
  try {
    const text = detail === undefined ? '' : ` ${stringify(detail)}`
    fs.appendFileSync(getPopupDiagLogPath(), `[${new Date().toISOString()}] ${scope}${text}\n`)
  } catch {
    /* 诊断写入失败时静默，避免干扰正常链路 */
  }
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/**
 * 转存主窗口渲染层的 console
 *
 * 渲染层拿不到文件系统，诊断只能走 console；这里按 [diag] 前缀过滤后落盘，
 * 其余输出不落，避免把正常日志一起拖进来。
 */
export function attachRendererConsoleDiag(win: BrowserWindow): void {
  win.webContents.on('console-message', ((...args: unknown[]) => {
    // Electron 新版把参数收进 details 对象，旧版是 (event, level, message)；两种都兼容
    const payload = args[1]
    const message =
      typeof payload === 'object' && payload !== null
        ? String((payload as { message?: unknown }).message ?? '')
        : String(args[2] ?? '')

    if (!message.includes('[diag]')) return
    diagLog('renderer', message)
  }) as never)
}
