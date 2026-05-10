import { StateCreator } from 'zustand'

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

export const createDialogSlice: StateCreator<DialogSlice, [], [], DialogSlice> = (set) => ({
  showSettings: false,
  settingsInitialTab: null,
  showCommandPalette: false,
  showComposer: false,
  showWorkflow: false,
  showQuickOpen: false,
  showAbout: false,

  setShowSettings: (show, initialTab) => set({ showSettings: show, settingsInitialTab: initialTab || null }),
  setShowCommandPalette: (show) => set({ showCommandPalette: show }),
  setShowComposer: (show) => set({ showComposer: show }),
  setShowWorkflow: (show) => set({ showWorkflow: show }),
  setShowQuickOpen: (show) => set({ showQuickOpen: show }),
  setShowAbout: (show) => set({ showAbout: show }),
  closeAllDialogs: () => set({
    showSettings: false,
    settingsInitialTab: null,
    showCommandPalette: false,
    showComposer: false,
    showWorkflow: false,
    showQuickOpen: false,
    showAbout: false,
  }),
})
