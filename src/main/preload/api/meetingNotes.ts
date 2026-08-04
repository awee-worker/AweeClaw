/**
 * 会议纪要 preload API
 *
 * 仅用于 meeting-notes.html 窗口，封装与主进程的 IPC 通信。
 * 通过 contextBridge 暴露到 window.electronAPI.meetingNotes
 *
 * 频道：
 * - meeting-notes:show              显示/聚焦窗口
 * - meeting-notes:get-workspace     获取工作区路径
 * - meeting-notes:save-transcript  保存录音原文 txt
 * - meeting-notes:generate-docx    生成并保存 docx
 *
 * 翻译/整理的 LLM 调用复用现有 ai.sendMessage（不在此模块），
 * 声纹相关频道在 Phase 5 补充。
 */

import { ipcRenderer } from 'electron'
import { invoke } from '../ipcHelpers'
import type {
  SaveTranscriptPayload,
  SaveTranscriptResult,
  GenerateDocxPayload,
  GenerateDocxResult,
  OrganizeProgress,
} from '../../../shared/protocols/meetingNotes'

/** 统一 IPC 响应格式 */
interface IpcResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

export function createMeetingNotesApi() {
  return {
    // --------------------------------------------
    // 窗口控制
    // --------------------------------------------
    /** 显示/聚焦会议纪要窗口 */
    show: invoke<IpcResponse>('meeting-notes:show'),

    // --------------------------------------------
    // 工作区
    // --------------------------------------------
    /** 获取当前工作区路径（用于显示保存位置预览） */
    getWorkspace: invoke<IpcResponse<{ workspacePath: string }>>('meeting-notes:get-workspace'),

    // --------------------------------------------
    // 文件保存
    // --------------------------------------------
    /** 保存录音原文 txt */
    saveTranscript: (payload: SaveTranscriptPayload) =>
      ipcRenderer.invoke('meeting-notes:save-transcript', payload) as Promise<SaveTranscriptResult>,

    /** 生成并保存 docx */
    generateDocx: (payload: GenerateDocxPayload) =>
      ipcRenderer.invoke('meeting-notes:generate-docx', payload) as Promise<GenerateDocxResult>,

    // --------------------------------------------
    // 事件订阅（main→render）
    // --------------------------------------------
    /** 整理进度推送（预留，当前整理在渲染层） */
    onOrganizeProgress: (callback: (progress: OrganizeProgress) => void): (() => void) => {
      const handler = (_event: unknown, progress: OrganizeProgress) => callback(progress)
      ipcRenderer.on('meeting-notes:organize-progress', handler)
      return () => ipcRenderer.removeListener('meeting-notes:organize-progress', handler)
    },
  }
}
