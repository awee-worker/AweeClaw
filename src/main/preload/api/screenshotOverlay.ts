/**
 * 截图覆盖窗口 preload API
 *
 * 仅用于 screenshot-overlay.html 覆盖窗口，提供：
 * - requestSetup：向主进程请求屏幕信息（屏幕尺寸 + scale，用于框选坐标换算）
 * - sendCancel：取消截图
 * - sendConfirm：确认选区，回传选区坐标给主进程截图裁剪
 *
 * 注意：透明窗口方案下，requestSetup 不再返回 imageDataUrl，
 * 框选阶段用户直接看到真实桌面，截图在确认后才由主进程捕获。
 *
 * 通过 contextBridge 暴露到 window.electronAPI.screenshotOverlay
 */

import { ipcRenderer } from 'electron'

export interface SelectionRect {
  x: number
  y: number
  width: number
  height: number
}

export interface SetupPayload {
  screenWidth: number
  screenHeight: number
  scaleFactor: number
  /** 可用工作区（不含 Dock/任务栏）相对屏幕原点的 x 偏移 */
  workAreaX: number
  /** 可用工作区相对屏幕原点的 y 偏移 */
  workAreaY: number
  /** 可用工作区宽度 */
  workAreaWidth: number
  /** 可用工作区高度 */
  workAreaHeight: number
}

export function createScreenshotOverlayApi() {
  return {
    /** 向主进程请求屏幕信息（覆盖窗口挂载后调用） */
    requestSetup: () =>
      ipcRenderer.invoke('screenshot-overlay:request-setup') as Promise<SetupPayload | null>,
    /** 取消截图（关闭覆盖窗口） */
    sendCancel: () => {
      ipcRenderer.send('screenshot-overlay:cancel')
    },
    /** 确认选区，回传选区坐标给主进程截图裁剪 */
    sendConfirm: (rect: SelectionRect) => {
      ipcRenderer.send('screenshot-overlay:confirm', rect)
    },
  }
}
