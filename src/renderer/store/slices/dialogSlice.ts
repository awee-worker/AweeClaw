import { StateCreator } from 'zustand'

export interface DialogSlice {
  showSettings: boolean
  showCommandPalette: boolean
  showComposer: boolean
  showWorkflow: boolean
  showQuickOpen: boolean
  showAbout: boolean

  setShowSettings: (show: boolean) => void
  setShowCommandPalette: (show: boolean) => void
  setShowComposer: (show: boolean) => void
  setShowWorkflow: (show: boolean) => void
  setShowQuickOpen: (show: boolean) => void
  setShowAbout: (show: boolean) => void
  closeAllDialogs: () => void
}

export const createDialogSlice: StateCreator<DialogSlice, [], [], DialogSlice> = (set) => ({
  showSettings: false,
  showCommandPalette: false,
  showComposer: false,
  showWorkflow: false,
  showQuickOpen: false,
  showAbout: false,

  setShowSettings: (show) => set({ showSettings: show }),
  setShowCommandPalette: (show) => set({ showCommandPalette: show }),
  setShowComposer: (show) => set({ showComposer: show }),
  setShowWorkflow: (show) => set({ showWorkflow: show }),
  setShowQuickOpen: (show) => set({ showQuickOpen: show }),
  setShowAbout: (show) => set({ showAbout: show }),
  closeAllDialogs: () => set({
    showSettings: false,
    showCommandPalette: false,
    showComposer: false,
    showWorkflow: false,
    showQuickOpen: false,
    showAbout: false,
  }),
})
