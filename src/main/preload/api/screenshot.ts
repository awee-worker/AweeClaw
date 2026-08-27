/**
 * 主窗口截图 preload API
 *
 * 提供主窗口聊天输入框的截图功能：
 * - start：触发主进程全屏区域选择覆盖窗口（与悬浮球截图共用 ScreenshotAskManager）
 * - onResult：监听截图完成事件，收到截图 base64 + 落盘路径后作为附件添加到输入框
 *
 * 注意：与悬浮球的 api.floatingAvatar.startScreenshotAsk / onScreenshotResult 完全独立：
 * - 独立的 IPC 通道（screenshot:start-for-main-window / main-window:screenshot-result）
 * - 独立的 ScreenshotAskManager 实例
 * - 结果推送到主窗口 webContents（而非头像窗口）
 *
 * 通过 contextBridge 暴露到 window.electronAPI.screenshot
 */

import { ipcRenderer } from 'electron'

/** 截图完成事件 payload */
export interface ScreenshotResultPayload {
  /** 裁剪后的截图 base64（不含 data: 前缀） */
  base64: string
  /** 图片 MIME 类型 */
  mediaType: string
  /** 截图宽度（像素） */
  width: number
  /** 截图高度（像素） */
  height: number
  /** 截图保存到工作区的绝对路径 */
  filePath: string
  /** 截图文件名 */
  fileName: string
}

/** IPC 调用结果 */
interface IpcResponse {
  success: boolean
  error?: string
}

/** 创建 on 事件监听器（与 floatingAvatar 的 on 工具函数一致） */
function on<T>(channel: string) {
  return (callback: (payload: T) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: T): void => callback(payload)
    ipcRenderer.on(channel, listener)
    return () => {
      ipcRenderer.removeListener(channel, listener)
    }
  }
}

export function createScreenshotApi() {
  return {
    /** 启动截图（主窗口→main：触发全屏区域选择覆盖窗口） */
    start: () =>
      ipcRenderer.invoke('screenshot:start-for-main-window') as Promise<IpcResponse>,
    /** 截图完成事件（main→主窗口：截图 base64 + 落盘路径，主窗口作为附件添加到输入框） */
    onResult: on<ScreenshotResultPayload>('main-window:screenshot-result'),
    /** 打开 macOS「隐私与安全性 → 屏幕录制」系统设置（权限引导弹窗按钮调用） */
    openPermissionSettings: () =>
      ipcRenderer.invoke('screenshot:open-permission-settings') as Promise<IpcResponse>,
  }
}
