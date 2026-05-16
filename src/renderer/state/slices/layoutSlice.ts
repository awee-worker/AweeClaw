import { StateCreator } from 'zustand'
import { LAYOUT } from '@shared/appConstants'

export type SidePanel = 'explorer' | 'search' | 'git' | 'problems' | 'outline' | 'history' | 'extensions' | 'shell' | 'data-sources' | 'charts' | 'characters' | 'scenarios' | 'notes' | 'knowledge' | 'prompts' | 'tasks' | 'bookmarks' | 'stores' | 'diagnosis' | 'plans' | 'benchmarks' | null

export interface LayoutSlice {
  activeSidePanel: SidePanel
  lastActiveSidePanel: Exclude<SidePanel, null>
  terminalVisible: boolean
  debugVisible: boolean
  chatVisible: boolean
  sidebarWidth: number
  chatWidth: number
  terminalLayout: 'tabs' | 'split'
  navRailExpanded: boolean
  showSettingsPage: boolean
  showWelcomePage: boolean
  showUserProfilePage: boolean
  showBillingCenterPage: boolean

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
  setNavRailExpanded: (expanded: boolean) => void
  toggleNavRail: () => void
  setShowSettingsPage: (show: boolean) => void
  setShowWelcomePage: (show: boolean) => void
  setShowUserProfilePage: (show: boolean) => void
  setShowBillingCenterPage: (show: boolean) => void
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
  navRailExpanded: true,
  showSettingsPage: false,
  showWelcomePage: false,
  showUserProfilePage: false,
  showBillingCenterPage: false,

  setActiveSidePanel: (panel) => set(() => ({
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
  setNavRailExpanded: (expanded) => set({ navRailExpanded: expanded }),
  toggleNavRail: () => set((state) => ({ navRailExpanded: !state.navRailExpanded })),
  setShowSettingsPage: (show) => set({ showSettingsPage: show }),
  setShowWelcomePage: (show) => set({ showWelcomePage: show }),
  setShowUserProfilePage: (show) => set({ showUserProfilePage: show }),
  setShowBillingCenterPage: (show) => set({ showBillingCenterPage: show }),
})
