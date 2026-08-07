/**
 * PPT 预览窗口 preload API
 *
 * 仅用于 ppt-preview.html 窗口，封装与主进程的 IPC 通信。
 * 通过 contextBridge 暴露到 window.electronAPI.pptPreview
 *
 * 频道（与 PptPreviewManager / pptPreviewProtocol 对齐）：
 * - ppt-preview:close          请求关闭/隐藏预览窗口（render→main）
 * - ppt-preview:export         请求在系统文件管理器中显示文件（render→main）
 * - ppt-preview:open           会话初始化推送（main→render）
 * - ppt-preview:push-slide     幻灯片数据推送（main→render）
 * - ppt-preview:mark-complete  生成完成通知（main→render）
 *
 * 设计要点：
 * - 窗口控制（open/close）由主进程触发，渲染层只接收数据
 * - 渲染层只暴露两个主动操作：close（隐藏窗口）和 export（显示文件）
 */

import { ipcRenderer } from 'electron'
import { invoke } from '../ipcHelpers'
import type {
  PptPresentationMeta,
  PptSlideData,
} from '../../../shared/protocols/pptPreviewProtocol'
import { PPT_PREVIEW_CHANNELS } from '../../../shared/protocols/pptPreviewProtocol'

/** 统一 IPC 响应格式 */
interface IpcResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

/** 完成事件载荷 */
interface MarkCompletePayload {
  sessionId: string
  filePath: string
}

export function createPptPreviewApi() {
  return {
    // --------------------------------------------
    // 窗口控制（render → main）
    // --------------------------------------------
    /** 隐藏预览窗口（不销毁，便于下次快速显示） */
    close: invoke<IpcResponse>(PPT_PREVIEW_CHANNELS.CLOSE),

    /** 在系统文件管理器中显示已保存的 .pptx 文件 */
    export: invoke<IpcResponse>(PPT_PREVIEW_CHANNELS.EXPORT),

    // --------------------------------------------
    // 事件订阅（main → render）
    // --------------------------------------------
    /** 会话打开：初始化预览（清空旧数据，设置标题） */
    onOpen: (callback: (meta: PptPresentationMeta) => void): (() => void) => {
      const handler = (_event: unknown, meta: PptPresentationMeta) => callback(meta)
      ipcRenderer.on(PPT_PREVIEW_CHANNELS.OPEN, handler)
      return () => ipcRenderer.removeListener(PPT_PREVIEW_CHANNELS.OPEN, handler)
    },

    /** 幻灯片数据推送：新增/更新一张幻灯片 */
    onPushSlide: (callback: (slide: PptSlideData) => void): (() => void) => {
      const handler = (_event: unknown, slide: PptSlideData) => callback(slide)
      ipcRenderer.on(PPT_PREVIEW_CHANNELS.PUSH_SLIDE, handler)
      return () => ipcRenderer.removeListener(PPT_PREVIEW_CHANNELS.PUSH_SLIDE, handler)
    },

    /** 生成完成通知：附带保存路径 */
    onMarkComplete: (callback: (payload: MarkCompletePayload) => void): (() => void) => {
      const handler = (_event: unknown, payload: MarkCompletePayload) => callback(payload)
      ipcRenderer.on(PPT_PREVIEW_CHANNELS.MARK_COMPLETE, handler)
      return () => ipcRenderer.removeListener(PPT_PREVIEW_CHANNELS.MARK_COMPLETE, handler)
    },
  }
}
