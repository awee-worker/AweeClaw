/**
 * 布局状态切片
 * 采用「状态分组 + 行为工厂」模式管理界面布局：
 *  - 将状态按职责划分为面板可见性、面板尺寸、全屏页面三组
 *  - 通过行为工厂函数生成状态更新片段，避免散落的 set 调用
 *  - 全屏页面使用集合化重置，新增页面只需扩展常量数组
 */
import { StateCreator } from 'zustand'
import { LAYOUT } from '@shared/appConstants'

/** 侧边栏可选面板类型 */
export type SidePanel =
  | 'explorer'
  | 'search'
  | 'git'
  | 'problems'
  | 'outline'
  | 'history'
  | 'extensions'
  | 'shell'
  | 'data-sources'
  | 'charts'
  | 'characters'
  | 'scenarios'
  | 'notes'
  | 'knowledge'
  | 'prompts'
  | 'tasks'
  | 'projects'
  | 'automation'
  | 'bookmarks'
  | 'stores'
  | 'diagnosis'
  | 'plans'
  | 'benchmarks'
  | 'schedule'
  | 'plugin-market'
  | 'scene-tools'
  | null

/** 终端布局模式 */
export type TerminalLayout = 'tabs' | 'split'

/** 底部 Dock 面板 Tab 类型 */
export type DockTab = 'problems' | 'output' | 'debug' | 'terminal'

/** 全屏页面状态键集合 */
const FULLSCREEN_PAGE_KEYS = [
  'showWelcomePage',
  'showSettingsPage',
  'showUserProfilePage',
  'showBillingCenterPage',
  'showSessionHistoryPage',
  'showPluginCenterPage',
  'showScenarioPage',
] as const

/** 全屏页面状态片段类型 */
type FullscreenPageState = Record<(typeof FULLSCREEN_PAGE_KEYS)[number], boolean>

/** 布局默认值集中管理，便于统一调整 */
const LAYOUT_DEFAULTS = {
  activeSidePanel: 'explorer' as SidePanel,
  terminalVisible: false,
  debugVisible: false,
  chatVisible: true,
  sidebarWidth: 175,
  chatWidth: LAYOUT.CHAT_DEFAULT_WIDTH,
  terminalLayout: 'tabs' as TerminalLayout,
  navRailExpanded: true,
  dockPanelVisible: false,
  activeDockTab: 'terminal' as DockTab,
} satisfies Record<string, unknown>

/** 构建全屏页面初始状态 */
function buildInitialFullscreenPages(): FullscreenPageState {
  return FULLSCREEN_PAGE_KEYS.reduce((acc, key) => {
    acc[key] = false
    return acc
  }, {} as FullscreenPageState)
}

/** 构建全屏页面重置片段：所有页面统一置为 false */
function buildFullscreenReset(): FullscreenPageState {
  return buildInitialFullscreenPages()
}

/** 构建指定全屏页面的切换片段，同时关闭其他全屏页面（互斥显示） */
function buildFullscreenToggle(
  target: (typeof FULLSCREEN_PAGE_KEYS)[number],
  visible: boolean,
): FullscreenPageState {
  const next = buildFullscreenReset()
  next[target] = visible
  return next
}

export interface LayoutSlice {
  /* ===== 面板可见性 ===== */
  activeSidePanel: SidePanel
  lastActiveSidePanel: Exclude<SidePanel, null>
  terminalVisible: boolean
  debugVisible: boolean
  chatVisible: boolean
  navRailExpanded: boolean

  /* ===== 底部 Dock 面板 ===== */
  dockPanelVisible: boolean
  activeDockTab: DockTab

  /* ===== 面板尺寸 ===== */
  sidebarWidth: number
  chatWidth: number
  terminalLayout: TerminalLayout

  /* ===== 全屏页面 ===== */
  showSettingsPage: boolean
  showWelcomePage: boolean
  showUserProfilePage: boolean
  showBillingCenterPage: boolean
  showSessionHistoryPage: boolean
  showPluginCenterPage: boolean
  showScenarioPage: boolean

  /* ===== 语音对话模式 ===== */
  /** 语音对话模式是否激活（覆盖整个聊天区域的实时语音对话界面） */
  voiceConversationActive: boolean

  /* ===== 面板可见性操作 ===== */
  setActiveSidePanel: (panel: SidePanel) => void
  setTerminalVisible: (visible: boolean) => void
  setDebugVisible: (visible: boolean) => void
  setChatVisible: (visible: boolean) => void
  setNavRailExpanded: (expanded: boolean) => void
  toggleTerminal: () => void
  toggleDebug: () => void
  toggleSidebar: () => void
  toggleChat: () => void
  toggleNavRail: () => void

  /* ===== 底部 Dock 面板操作 ===== */
  setDockPanelVisible: (visible: boolean) => void
  setActiveDockTab: (tab: DockTab) => void
  toggleDockPanel: () => void
  openDockPanel: (tab: DockTab) => void

  /* ===== 面板尺寸操作 ===== */
  setSidebarWidth: (width: number) => void
  setChatWidth: (width: number) => void
  setTerminalLayout: (layout: TerminalLayout) => void

  /* ===== 全屏页面操作 ===== */
  setShowSettingsPage: (show: boolean) => void
  setShowWelcomePage: (show: boolean) => void
  setShowUserProfilePage: (show: boolean) => void
  setShowBillingCenterPage: (show: boolean) => void
  setShowSessionHistoryPage: (show: boolean) => void
  setShowPluginCenterPage: (show: boolean) => void
  setShowScenarioPage: (show: boolean) => void
  /** 关闭所有全屏页面，返回聊天界面 */
  closeAllFullPages: () => void

  /* ===== 语音对话模式操作 ===== */
  /** 进入/退出语音对话模式 */
  setVoiceConversationActive: (active: boolean) => void
  /** 切换语音对话模式 */
  toggleVoiceConversation: () => void

  /* ===== 场景配置版本（用于强制布局重算） ===== */
  /** 场景配置版本号，每次场景安装/更新时递增 */
  scenarioConfigVersion: number
  /** 递增场景配置版本号，触发 AweeApp 重新计算 layoutConfig */
  incrementScenarioConfigVersion: () => void
}

export const createLayoutSlice: StateCreator<LayoutSlice, [], [], LayoutSlice> = (set) => ({
  /* ----- 初始状态 ----- */
  activeSidePanel: LAYOUT_DEFAULTS.activeSidePanel,
  lastActiveSidePanel: LAYOUT_DEFAULTS.activeSidePanel as Exclude<SidePanel, null>,
  terminalVisible: LAYOUT_DEFAULTS.terminalVisible,
  debugVisible: LAYOUT_DEFAULTS.debugVisible,
  chatVisible: LAYOUT_DEFAULTS.chatVisible,
  navRailExpanded: LAYOUT_DEFAULTS.navRailExpanded,
  sidebarWidth: LAYOUT_DEFAULTS.sidebarWidth,
  chatWidth: LAYOUT_DEFAULTS.chatWidth,
  terminalLayout: LAYOUT_DEFAULTS.terminalLayout,
  dockPanelVisible: LAYOUT_DEFAULTS.dockPanelVisible,
  activeDockTab: LAYOUT_DEFAULTS.activeDockTab,
  ...buildInitialFullscreenPages(),

  /* ----- 语音对话模式初始状态 ----- */
  voiceConversationActive: false,

  /* ----- 场景配置版本初始状态 ----- */
  scenarioConfigVersion: 0,

  /* ----- 面板可见性操作 ----- */
  setActiveSidePanel: (panel) =>
    set((state) => ({
      activeSidePanel: panel,
      lastActiveSidePanel: panel ?? state.lastActiveSidePanel,
    })),
  setTerminalVisible: (visible) => set((state) => ({ 
    terminalVisible: visible,
    dockPanelVisible: visible ? true : (state.activeDockTab === 'terminal' ? false : state.dockPanelVisible),
    activeDockTab: visible ? 'terminal' : state.activeDockTab,
  })),
  setDebugVisible: (visible) => set((state) => ({ 
    debugVisible: visible,
    dockPanelVisible: visible ? true : (state.activeDockTab === 'debug' ? false : state.dockPanelVisible),
    activeDockTab: visible ? 'debug' : state.activeDockTab,
  })),
  setChatVisible: (visible) => set({ chatVisible: visible }),
  setNavRailExpanded: (expanded) => set({ navRailExpanded: expanded }),
  toggleTerminal: () => set((state) => {
    const newTerminalVisible = !state.terminalVisible
    if (newTerminalVisible) {
      return { terminalVisible: true, dockPanelVisible: true, activeDockTab: 'terminal' }
    } else if (state.activeDockTab === 'terminal') {
      return { terminalVisible: false, dockPanelVisible: false }
    }
    return { terminalVisible: false }
  }),
  toggleDebug: () => set((state) => {
    const newDebugVisible = !state.debugVisible
    if (newDebugVisible) {
      return { debugVisible: true, dockPanelVisible: true, activeDockTab: 'debug' }
    } else if (state.activeDockTab === 'debug') {
      return { debugVisible: false, dockPanelVisible: false }
    }
    return { debugVisible: false }
  }),
  toggleSidebar: () =>
    set((state) => ({
      activeSidePanel: state.activeSidePanel ? null : state.lastActiveSidePanel,
    })),
  toggleChat: () => set((state) => ({ chatVisible: !state.chatVisible })),
  toggleNavRail: () => set((state) => ({ navRailExpanded: !state.navRailExpanded })),

  /* ----- 底部 Dock 面板操作 ----- */
  setDockPanelVisible: (visible) => set({ dockPanelVisible: visible }),
  setActiveDockTab: (tab) => set({ activeDockTab: tab }),
  toggleDockPanel: () => set((state) => ({ dockPanelVisible: !state.dockPanelVisible })),
  openDockPanel: (tab) => set({ dockPanelVisible: true, activeDockTab: tab }),

  /* ----- 面板尺寸操作 ----- */
  setSidebarWidth: (width) => set({ sidebarWidth: width }),
  setChatWidth: (width) => set({ chatWidth: Math.max(width, LAYOUT.CHAT_MIN_WIDTH) }),
  setTerminalLayout: (layout) => set({ terminalLayout: layout }),

  /* ----- 全屏页面操作（互斥切换） ----- */
  setShowSettingsPage: (show) => set(buildFullscreenToggle('showSettingsPage', show)),
  setShowWelcomePage: (show) => set(buildFullscreenToggle('showWelcomePage', show)),
  setShowUserProfilePage: (show) => set(buildFullscreenToggle('showUserProfilePage', show)),
  setShowBillingCenterPage: (show) => set(buildFullscreenToggle('showBillingCenterPage', show)),
  setShowSessionHistoryPage: (show) => set(buildFullscreenToggle('showSessionHistoryPage', show)),
  setShowPluginCenterPage: (show) => set(buildFullscreenToggle('showPluginCenterPage', show)),
  setShowScenarioPage: (show) => set(buildFullscreenToggle('showScenarioPage', show)),
  closeAllFullPages: () => set(buildFullscreenReset()),

  /* ----- 语音对话模式操作 ----- */
  setVoiceConversationActive: (active) => set({ voiceConversationActive: active }),
  toggleVoiceConversation: () => set((state) => ({ voiceConversationActive: !state.voiceConversationActive })),

  /* ----- 场景配置版本操作 ----- */
  incrementScenarioConfigVersion: () => set((state) => ({ scenarioConfigVersion: state.scenarioConfigVersion + 1 })),
})
