/**
 * 对话框可见性状态切片
 *
 * 集中管理各弹窗的显隐与设置面板初始 Tab。
 */

import { StateCreator } from 'zustand'

/** 设置面板打开意图：指定要定位到的 Tab / 子 Tab / 操作 */
export interface SettingsIntent {
  /** 设置面板一级 Tab（如 'agent'） */
  tab: string
  /** 智能体 Tab 下的二级子 Tab（'agentConfig' | 'custom'） */
  agentSubTab?: 'agentConfig' | 'custom'
  /** 是否自动打开「自定义智能体」新建表单 */
  createNewAgent?: boolean
  /** 自动打开指定智能体的编辑器（编辑已有智能体，如聊天输入区「设置智能体」入口） */
  editAgentId?: string
}

/** 切片接口 */
export interface DialogSlice {
  showSettings: boolean
  settingsInitialTab: string | null
  settingsIntent: SettingsIntent | null
  showCommandPalette: boolean
  showComposer: boolean
  showWorkflow: boolean
  showQuickOpen: boolean
  showAbout: boolean

  setShowSettings: (show: boolean, initialTab?: string) => void
  setSettingsIntent: (intent: SettingsIntent | null) => void
  setShowCommandPalette: (show: boolean) => void
  setShowComposer: (show: boolean) => void
  setShowWorkflow: (show: boolean) => void
  setShowQuickOpen: (show: boolean) => void
  setShowAbout: (show: boolean) => void
  closeAllDialogs: () => void
}

/** 全部关闭时的状态 */
const ALL_CLOSED = {
  showSettings: false,
  settingsInitialTab: null,
  settingsIntent: null,
  showCommandPalette: false,
  showComposer: false,
  showWorkflow: false,
  showQuickOpen: false,
  showAbout: false,
} as const

export const createDialogSlice: StateCreator<DialogSlice, [], [], DialogSlice> = (set) => ({
  ...ALL_CLOSED,

  setShowSettings: (show, initialTab) =>
    set({ showSettings: show, settingsInitialTab: initialTab || null }),
  setSettingsIntent: (intent) => set({ settingsIntent: intent }),
  setShowCommandPalette: (show) => set({ showCommandPalette: show }),
  setShowComposer: (show) => set({ showComposer: show }),
  setShowWorkflow: (show) => set({ showWorkflow: show }),
  setShowQuickOpen: (show) => set({ showQuickOpen: show }),
  setShowAbout: (show) => set({ showAbout: show }),

  closeAllDialogs: () => set({ ...ALL_CLOSED }),
})
