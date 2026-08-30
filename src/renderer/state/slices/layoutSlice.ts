/**
 * 布局状态切片
 * 采用「状态分组 + 行为工厂」模式管理界面布局：
 *  - 将状态按职责划分为面板可见性、面板尺寸、全屏页面三组
 *  - 通过行为工厂函数生成状态更新片段，避免散落的 set 调用
 *  - 全屏页面使用集合化重置，新增页面只需扩展常量数组
 */
import { StateCreator } from 'zustand'
import { LAYOUT } from '@shared/appConstants'
import type { SceneMode } from '@protocols/sceneModeProtocol'
import { BRAND } from '@shared/brand'
import { StorageService } from '@shared/toolkit/StorageService'
import { logger } from '@shared/toolkit/LogEngine'

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

/** 各场景模式工作台默认卡片集合（macOS 桌面小组件式） */
export const WORKBENCH_DEFAULT_WIDGETS: Record<SceneMode, string[]> = {
  work: ['new-chat', 'work-todo', 'work-weekly', 'work-pomodoro', 'recent-workspaces'],
  life: ['new-chat', 'life-ledger', 'life-water', 'life-mood', 'recent-workspaces'],
  study: ['new-chat', 'study-flashcards', 'study-planner', 'study-pomodoro', 'recent-workspaces'],
}

/* ===================== 工作台配置持久化 ===================== */

const WORKBENCH_STORAGE_KEY = `${BRAND.cssPrefix}-workbench`

/** 持久化结构：三个工作台自定义状态字段的整体快照 */
interface PersistedWorkbench {
  widgets?: Record<SceneMode, string[]>
  positions?: Record<SceneMode, Record<string, WorkbenchCardPos>>
  backgrounds?: Record<SceneMode, WorkbenchBackground | null>
}

/**
 * 从 localStorage 恢复工作台自定义配置。
 * 同步读取用于 slice 初始化；electron-store 写入作为跨会话兜底。
 */
function loadPersistedWorkbench(): PersistedWorkbench {
  try {
    const raw = StorageService.get<string>(WORKBENCH_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as PersistedWorkbench
      if (parsed && typeof parsed === 'object') return parsed
    }
  } catch (e) {
    logger.ui.warn('[LayoutSlice] Failed to load persisted workbench:', e)
  }
  return {}
}

/**
 * 持久化工作台配置（新增/移除卡片、调整位置/大小、更换背景后自动调用）：
 * 1. 同步写入 localStorage（主存储，初始化时恢复）
 * 2. 异步写入 electron-store（兜底，防止 localStorage 丢失）
 */
function persistWorkbench(state: {
  widgets: Record<SceneMode, string[]>
  positions: Record<SceneMode, Record<string, WorkbenchCardPos>>
  backgrounds: Record<SceneMode, WorkbenchBackground | null>
}): void {
  const payload = JSON.stringify(state)
  try {
    StorageService.set(WORKBENCH_STORAGE_KEY, payload)
  } catch (e) {
    logger.ui.warn('[LayoutSlice] Failed to persist workbench to localStorage:', e)
  }
  try {
    import('@/renderer/adapters/electronBridge').then(({ api }) => {
      api.settings.set('workbench', payload).catch((e: unknown) => {
        logger.ui.warn('[LayoutSlice] Failed to persist workbench to electron-store:', e)
      })
    })
  } catch (e) {
    // ignore import errors
  }
}

/** 从 state 快照提取三个工作台字段并持久化 */
function persistWorkbenchFrom(state: {
  workbenchWidgets: Record<SceneMode, string[]>
  workbenchPositions: Record<SceneMode, Record<string, WorkbenchCardPos>>
  workbenchBackgrounds: Record<SceneMode, WorkbenchBackground | null>
}): void {
  persistWorkbench({
    widgets: state.workbenchWidgets,
    positions: state.workbenchPositions,
    backgrounds: state.workbenchBackgrounds,
  })
}

/**
 * 工作台卡片宫格位置（CSS Grid 模型）
 * col/row 为 1-based 网格坐标；colSpan/rowSpan 支持横向/竖向跨格，最小 1 格
 */
export interface WorkbenchCardPos {
  col: number
  row: number
  colSpan: number
  rowSpan: number
}

/** 工作台背景配置：color 为颜色/渐变，image 的 value 为 dataURL */
export type WorkbenchBackground =
  | { type: 'color'; value: string }
  | { type: 'image'; value: string }

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

/** 自定义菜单项（用户通过「自定义菜单」入口添加，持久化到 localStorage） */
export interface CustomMenu {
  id: string
  name: string
  /** lucide 图标名称，见 foundation/IconMap */
  icon: string
  /** 必须以 http:// 或 https:// 开头 */
  url: string
  createdAt: number
}

/* ===================== 自定义菜单持久化 ===================== */

const CUSTOM_MENUS_STORAGE_KEY = `${BRAND.cssPrefix}-custom-menus`

/** 从 localStorage 恢复自定义菜单列表 */
function loadCustomMenus(): CustomMenu[] {
  try {
    const raw = StorageService.get<string>(CUSTOM_MENUS_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as CustomMenu[]
      if (Array.isArray(parsed)) {
        return parsed.filter(m => m && typeof m.name === 'string' && typeof m.url === 'string')
      }
    }
  } catch (e) {
    logger.ui.warn('[LayoutSlice] Failed to load custom menus:', e)
  }
  return []
}

/** 持久化自定义菜单列表 */
function persistCustomMenus(menus: CustomMenu[]): void {
  try {
    StorageService.set(CUSTOM_MENUS_STORAGE_KEY, JSON.stringify(menus))
  } catch (e) {
    logger.ui.warn('[LayoutSlice] Failed to persist custom menus:', e)
  }
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
  /** 环境检测弹窗是否显示 */
  showEnvironmentSetup: boolean
  /** 设置环境检测弹窗显隐 */
  setShowEnvironmentSetup: (show: boolean) => void
  /** 场景管理页面当前标签页 */
  scenarioPageTab: 'installed' | 'marketplace'
  /** 设置场景管理页面标签页 */
  setScenarioPageTab: (tab: 'installed' | 'marketplace') => void

  /* ===== 语音对话模式 ===== */
  /** 语音对话模式是否激活（覆盖整个聊天区域的实时语音对话界面） */
  voiceConversationActive: boolean

  /* ===== 场景工具直达 ===== */
  /** 欢迎页点击工具卡片时暂存的目标工具 ID，SceneToolsPanel 工具就绪后自动跳转 */
  pendingSceneToolId: string | null
  /** 设置待跳转的场景工具 ID */
  setPendingSceneToolId: (id: string) => void

  /* ===== 工作台自定义 ===== */
  /** 每个场景模式的工作台卡片集合（用户可自定义：添加/移除/排序） */
  workbenchWidgets: Record<SceneMode, string[]>
  /** 切换某模式下某卡片的可见性 */
  setWorkbenchWidget: (mode: SceneMode, widgetId: string, visible: boolean) => void
  /** 调整某模式下卡片顺序（上移/下移） */
  moveWorkbenchWidget: (mode: SceneMode, widgetId: string, direction: 'up' | 'down') => void
  /** 重置某模式为默认卡片配置 */
  resetWorkbenchWidgets: (mode: SceneMode) => void

  /* ===== 工作台自由摆放与背景 ===== */
  /** 每个场景模式的工作台卡片自由摆放位置 */
  workbenchPositions: Record<SceneMode, Record<string, WorkbenchCardPos>>
  /** 设置单张卡片位置 */
  setWorkbenchPosition: (mode: SceneMode, widgetId: string, pos: WorkbenchCardPos) => void
  /** 批量设置卡片位置（拖拽碰撞解析用，一次渲染） */
  setWorkbenchPositions: (mode: SceneMode, positions: Record<string, WorkbenchCardPos>) => void
  /** 每个场景模式的工作台背景配置 */
  workbenchBackgrounds: Record<SceneMode, WorkbenchBackground | null>
  /** 设置工作台背景（null 表示移除背景） */
  setWorkbenchBackground: (mode: SceneMode, background: WorkbenchBackground | null) => void

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

  /* ===== 自定义菜单 ===== */
  /** 用户自定义菜单列表（持久化到 localStorage） */
  customMenus: CustomMenu[]
  /** 添加自定义菜单 */
  addCustomMenu: (input: { name: string; icon: string; url: string }) => void
  /** 删除自定义菜单 */
  removeCustomMenu: (id: string) => void

  /* ===== 内部浏览器 ===== */
  /** 内部浏览器当前打开的 URL（null 表示未打开） */
  internalBrowserUrl: string | null
  /** 内部浏览器页面标题 */
  internalBrowserTitle: string
  /** 当前激活的自定义菜单 ID（导航栏高亮用，null 表示未激活自定义菜单） */
  activeCustomMenuId: string | null
  /** 打开内部浏览器 */
  openInternalBrowser: (url: string, title?: string, menuId?: string) => void
  /** 关闭内部浏览器 */
  closeInternalBrowser: () => void
}

export const createLayoutSlice: StateCreator<LayoutSlice, [], [], LayoutSlice> = (set) => {
  // 恢复上次保存的工作台配置（卡片集合、位置/大小、背景）
  const persistedWorkbench = loadPersistedWorkbench()
  return {
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

  /* ----- 场景工具直达初始状态 ----- */
  pendingSceneToolId: null,

  /* ----- 场景配置版本初始状态 ----- */
  scenarioConfigVersion: 0,

  /* ----- 自定义菜单初始状态（从 localStorage 恢复） ----- */
  customMenus: loadCustomMenus(),

  /* ----- 内部浏览器初始状态 ----- */
  internalBrowserUrl: null,
  internalBrowserTitle: '',
  activeCustomMenuId: null,

  /* ----- 工作台自定义初始状态（优先恢复上次保存的配置） ----- */
  workbenchWidgets: {
    work: persistedWorkbench.widgets?.work?.length ? [...persistedWorkbench.widgets.work] : [...WORKBENCH_DEFAULT_WIDGETS.work],
    life: persistedWorkbench.widgets?.life?.length ? [...persistedWorkbench.widgets.life] : [...WORKBENCH_DEFAULT_WIDGETS.life],
    study: persistedWorkbench.widgets?.study?.length ? [...persistedWorkbench.widgets.study] : [...WORKBENCH_DEFAULT_WIDGETS.study],
  },
  workbenchPositions: persistedWorkbench.positions ?? {},
  workbenchBackgrounds: persistedWorkbench.backgrounds ?? {},
  /* ----- 场景管理页面标签页初始状态 ----- */
  scenarioPageTab: 'installed',
  setScenarioPageTab: (tab) => set({ scenarioPageTab: tab }),

  /* ----- 环境检测弹窗初始状态 ----- */
  showEnvironmentSetup: false,

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

  /* ----- 场景工具直达操作 ----- */
  setPendingSceneToolId: (id) => set({ pendingSceneToolId: id }),

  /* ----- 场景配置版本操作 ----- */
  incrementScenarioConfigVersion: () => set((state) => ({ scenarioConfigVersion: state.scenarioConfigVersion + 1 })),

  /* ----- 环境检测弹窗操作 ----- */
  setShowEnvironmentSetup: (show) => set({ showEnvironmentSetup: show }),

  /* ----- 工作台自定义操作 ----- */
  setWorkbenchWidget: (mode, widgetId, visible) =>
    set((state) => {
      const list = state.workbenchWidgets[mode] ?? []
      const nextWidgets = {
        ...state.workbenchWidgets,
        [mode]: visible ? [...list, widgetId] : list.filter((w) => w !== widgetId),
      }
      // 移除卡片时同步清理其自由摆放位置
      let nextPositions = state.workbenchPositions
      if (!visible) {
        const positions = state.workbenchPositions[mode]
        if (positions && positions[widgetId]) {
          const next = { ...positions }
          delete next[widgetId]
          nextPositions = { ...state.workbenchPositions, [mode]: next }
        }
      }
      // 自动保存：新增 / 移除卡片
      persistWorkbenchFrom({
        workbenchWidgets: nextWidgets,
        workbenchPositions: nextPositions,
        workbenchBackgrounds: state.workbenchBackgrounds,
      })
      return {
        workbenchWidgets: nextWidgets,
        ...(nextPositions !== state.workbenchPositions ? { workbenchPositions: nextPositions } : {}),
      }
    }),
  moveWorkbenchWidget: (mode, widgetId, direction) =>
    set((state) => {
      const list = [...(state.workbenchWidgets[mode] ?? [])]
      const idx = list.indexOf(widgetId)
      if (idx === -1) return state
      const target = direction === 'up' ? idx - 1 : idx + 1
      if (target < 0 || target >= list.length) return state
      const [item] = list.splice(idx, 1)
      list.splice(target, 0, item)
      return { workbenchWidgets: { ...state.workbenchWidgets, [mode]: list } }
    }),
  setWorkbenchPosition: (mode, widgetId, pos) =>
    set((state) => {
      const next = {
        ...state.workbenchPositions,
        [mode]: { ...(state.workbenchPositions[mode] ?? {}), [widgetId]: pos },
      }
      // 自动保存：单张卡片位置
      persistWorkbenchFrom({
        workbenchWidgets: state.workbenchWidgets,
        workbenchPositions: next,
        workbenchBackgrounds: state.workbenchBackgrounds,
      })
      return { workbenchPositions: next }
    }),
  setWorkbenchPositions: (mode, positions) =>
    set((state) => {
      const next = { ...state.workbenchPositions, [mode]: positions }
      // 自动保存：拖拽结束后的整体排布（位置 / 大小）
      persistWorkbenchFrom({
        workbenchWidgets: state.workbenchWidgets,
        workbenchPositions: next,
        workbenchBackgrounds: state.workbenchBackgrounds,
      })
      return { workbenchPositions: next }
    }),
  setWorkbenchBackground: (mode, background) =>
    set((state) => {
      const next = { ...state.workbenchBackgrounds, [mode]: background }
      // 自动保存：背景设置 / 移除
      persistWorkbenchFrom({
        workbenchWidgets: state.workbenchWidgets,
        workbenchPositions: state.workbenchPositions,
        workbenchBackgrounds: next,
      })
      return { workbenchBackgrounds: next }
    }),
  resetWorkbenchWidgets: (mode) =>
    set((state) => {
      const nextWidgets = {
        ...state.workbenchWidgets,
        [mode]: [...WORKBENCH_DEFAULT_WIDGETS[mode]],
      }
      // 恢复默认布局同时清空自定义位置，回落到默认流式排布
      const nextPositions = { ...state.workbenchPositions, [mode]: {} }
      // 自动保存：恢复默认布局
      persistWorkbenchFrom({
        workbenchWidgets: nextWidgets,
        workbenchPositions: nextPositions,
        workbenchBackgrounds: state.workbenchBackgrounds,
      })
      return { workbenchWidgets: nextWidgets, workbenchPositions: nextPositions }
    }),

  /* ----- 自定义菜单操作 ----- */
  addCustomMenu: (input) =>
    set((state) => {
      const menu: CustomMenu = {
        id: `custom-menu-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: input.name.trim(),
        icon: input.icon || 'Globe',
        url: input.url.trim(),
        createdAt: Date.now(),
      }
      const next = [...state.customMenus, menu]
      persistCustomMenus(next)
      return { customMenus: next }
    }),
  removeCustomMenu: (id) =>
    set((state) => {
      const next = state.customMenus.filter((m) => m.id !== id)
      persistCustomMenus(next)
      return { customMenus: next }
    }),

  /* ----- 内部浏览器操作 ----- */
  openInternalBrowser: (url, title, menuId) =>
    set({
      internalBrowserUrl: url,
      internalBrowserTitle: title ?? '',
      activeCustomMenuId: menuId ?? null,
      // 打开自定义菜单时自动隐藏聊天窗口，内部浏览器占据其位置；
      // 用户可随时通过「显示聊天窗口」重新显示
      chatVisible: false,
    }),
  closeInternalBrowser: () =>
    set({
      internalBrowserUrl: null,
      internalBrowserTitle: '',
      activeCustomMenuId: null,
      // 关闭内部浏览器后恢复聊天窗口显示
      chatVisible: true,
    }),
  }
}
