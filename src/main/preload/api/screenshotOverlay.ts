/**
 * 截图覆盖窗口 preload API
 *
 * 仅用于 screenshot-overlay.html 覆盖窗口，提供：
 * - requestSetup：向主进程请求屏幕信息（屏幕尺寸 + scale，用于框选坐标换算）
 * - requestCapture：请求-响应式提交选区，直接拿到裁剪后的图片
 * - sendAnnotateSave / sendAnnotateCopy / sendAnnotateDownload：标注完成后的三种收尾方式
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
  /** 可用工作空间（不含 Dock/任务栏）相对屏幕原点的 x 偏移 */
  workAreaX: number
  /** 可用工作空间相对屏幕原点的 y 偏移 */
  workAreaY: number
  /** 可用工作空间宽度 */
  workAreaWidth: number
  /** 可用工作空间高度 */
  workAreaHeight: number
}

/** 主进程回传的待标注截图 */
export interface EditImagePayload {
  /** 裁剪后的截图 base64（不含 data: 前缀） */
  base64: string
  /** 截图物理像素宽度 */
  width: number
  /** 截图物理像素高度 */
  height: number
  /** 主屏缩放因子 */
  scaleFactor: number
}

/** 标注完成后提交的数据 */
export interface AnnotatedImagePayload {
  /** 合成后的图片 base64（不含 data: 前缀） */
  base64: string
  /** 图片物理像素宽度 */
  width: number
  /** 图片物理像素高度 */
  height: number
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
    /**
     * 提交选区并等待裁剪结果
     *
     * 用 invoke 而非 send：主进程需要先隐藏覆盖窗口才能截图，隐藏/显示
     * 期间渲染进程会被节流。请求-响应模式下时序由 Promise 保证，渲染层
     * 拿到结果后再切编辑态，不存在「消息到了但界面还没恢复」的窗口。
     *
     * @returns 裁剪后的图片；截图失败或窗口已销毁时返回 null
     */
    requestCapture: (rect: SelectionRect) =>
      ipcRenderer.invoke('screenshot-overlay:capture', rect) as Promise<EditImagePayload | null>,
    /** 完成标注：合成图落盘并推送给发起截图的窗口 */
    sendAnnotateSave: (payload: AnnotatedImagePayload) => {
      ipcRenderer.send('screenshot-overlay:annotate-save', payload)
    },
    /** 复制合成图到系统剪贴板（不结束编辑态） */
    sendAnnotateCopy: (payload: AnnotatedImagePayload) => {
      ipcRenderer.send('screenshot-overlay:annotate-copy', payload)
    },
    /** 另存合成图到指定位置（保存后结束截图流程） */
    sendAnnotateDownload: (payload: AnnotatedImagePayload) => {
      ipcRenderer.send('screenshot-overlay:annotate-download', payload)
    },
    /**
     * 通知主进程「编辑态已绘制完成，可以显示窗口」
     *
     * 截图期间覆盖窗口整体透明（避免遮罩进入截图），恢复时机交由渲染层决定：
     * 图片解码、画布铺设、工具条定位都完成后才发起通知，窗口重新可见的第一帧
     * 就是完整的标注界面，不会先闪出一帧只有选框的画面。
     */
    notifyReady: () => {
      ipcRenderer.send('screenshot-overlay:annotate-ready')
    },
  }
}
