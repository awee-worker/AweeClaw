import { StateCreator } from 'zustand'
import { LAYOUT } from '@shared/constants'

export type SidePanel = 'explorer' | 'search' | 'git' | 'problems' | 'outline' | 'history' | 'extensions' | 'emotion' | 'shell' | 'data-sources' | 'charts' | 'characters' | 'scenarios' | 'notes' | 'knowledge' | 'prompts' | 'tasks' | 'bookmarks' | null

export interface LayoutSlice {
  activeSidePanel: SidePanel
  lastActiveSidePanel: Exclude<SidePanel, null>
  terminalVisible: boolean
  debugVisible: boolean
  chatVisible: boolean
  sidebarWidth: number
  chatWidth: number
  terminalLayout: 'tabs' | 'split'

  setActiveSidePanel: (panel: SidePanel) => void
  setTerminalVisible: (visible: boolean) => void
  setDebugVisible: (visible: boolean) => void
  setChatVisible: (visible: boolean) => void
  setSidebarWidth: (width: number) => void
  setChatWidth: (width: number) => void
  setTerminalLayout: (layout: 'tabs' | 'split') => void
  toggleTerminal: () => void
  toggleDebug: () => void
  toggleSidebar: () => void
  toggleChat: () => void
}

export const createLayoutSlice: StateCreator<LayoutSlice, [], [], LayoutSlice> = (set) => ({
  activeSidePanel: 'explorer',
  lastActiveSidePanel: 'explorer',
  terminalVisible: false,
  debugVisible: false,
  chatVisible: true,
  sidebarWidth: 260,
  chatWidth: 600,
  terminalLayout: 'tabs',

  setActiveSidePanel: (panel) => set((state) => ({
    activeSidePanel: panel,
    ...(panel ? { lastActiveSidePanel: panel } : {}),
  })),
  setTerminalVisible: (visible) => set({ terminalVisible: visible }),
  setDebugVisible: (visible) => set({ debugVisible: visible }),
  setChatVisible: (visible) => set({ chatVisible: visible }),
  setSidebarWidth: (width) => set({ sidebarWidth: width }),
  setChatWidth: (width) => set({ chatWidth: Math.max(width, LAYOUT.CHAT_MIN_WIDTH) }),
  setTerminalLayout: (layout) => set({ terminalLayout: layout }),
  toggleTerminal: () => set((state) => ({ terminalVisible: !state.terminalVisible })),
  toggleDebug: () => set((state) => ({ debugVisible: !state.debugVisible })),
  toggleSidebar: () => set((state) => ({
    activeSidePanel: state.activeSidePanel ? null : state.lastActiveSidePanel,
  })),
  toggleChat: () => set((state) => ({ chatVisible: !state.chatVisible })),
})
