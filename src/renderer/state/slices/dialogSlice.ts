/**
 * 对话框可见性状态切片
 *
 * 集中管理各弹窗的显隐与设置面板初始 Tab。
 */

import { StateCreator } from 'zustand'

/** 切片接口 */
export interface DialogSlice {
  showSettings: boolean
  settingsInitialTab: string | null
  showCommandPalette: boolean
  showComposer: boolean
  showWorkflow: boolean
  showQuickOpen: boolean
  showAbout: boolean

  setShowSettings: (show: boolean, initialTab?: string) => void
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
  setShowCommandPalette: (show) => set({ showCommandPalette: show }),
  setShowComposer: (show) => set({ showComposer: show }),
  setShowWorkflow: (show) => set({ showWorkflow: show }),
  setShowQuickOpen: (show) => set({ showQuickOpen: show }),
  setShowAbout: (show) => set({ showAbout: show }),

  closeAllDialogs: () => set({ ...ALL_CLOSED }),
})
