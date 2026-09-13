/**
 * 应用生命周期 API
 *
 * 覆盖 IPC 频道：
 * - app:*          应用就绪 / 版本 / 关闭流程
 * - window:*       窗口控制（最小化 / 最大化 / 新建 / 主题）
 * - i18n:*         语言切换
 * - system:resume  系统从睡眠唤醒
 * - app:error      主进程错误通知
 */
import { invoke, send, on } from '../ipcHelpers'
import type { Language } from '../types'

export function createAppLifecycleApi() {
  return {
    // ── 应用就绪 / 版本 ──
    appReady: send('app:ready'),
    getAppVersion: invoke<string>('app:getVersion'),

    // ── 关闭流程协调 ──
    respondToShutdownRequest: (requestId: string, success: boolean) =>
      invoke('app:shutdown-response')(requestId, success),
    onShutdownRequested: on<{ requestId: string; reason: 'window-close' | 'app-quit' }>(
      'app:shutdown-requested',
    ),

    // ── 窗口控制 ──
    minimize: send('window:minimize'),
    maximize: send('window:maximize'),
    close: send('window:close'),
    toggleDevTools: send('window:toggleDevTools'),
    newWindow: invoke('window:new'),
    getWindowId: invoke<number>('window:getId'),
    // 自绘菜单（Windows/Linux）执行原生角色：undo/copy/zoomIn/minimize...
    executeMenuRole: (role: string) => send('menu:execute-role')(role),
    resizeWindow: (width: number, height: number, minWidth?: number, minHeight?: number) =>
      invoke('window:resize')(width, height, minWidth, minHeight),
    setTheme: (theme: 'light' | 'dark' | 'system', bgColor?: string) =>
      invoke<boolean>('window:setTheme')(theme, bgColor),

    // ── 语言切换 ──
    setLanguage: (lang: Language) => send('i18n:changed')(lang),

    // ── 系统事件 ──
    onSystemResume: on<void>('system:resume'),
    onAppError: on<{ title: string; message: string; variant?: string }>('app:error'),
  }
}
