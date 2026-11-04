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
import { DEFAULT_HIDDEN_NAV_ITEMS } from '@shared/configuration/navAccountMenuItems'

export { DEFAULT_HIDDEN_NAV_ITEMS }

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
  | 'ledger'
  | 'plugin-market'
  | 'ai-browser'
  | 'mail-center'
  | 'scene-tools'
  | 'todo-hub'
  | null

/**
 * 工作空间面板 id
 *
 * 顶部「显示工作空间面板」开关与「新建任务」默认打开的都是这一块面板。
 * 插件市场 / 待办中心 / 邮件中心这类场景面板不算：它们占的是主内容区，
 * 用户切走视图后不该被开关当成工作空间面板重新顶出来。
 */
export const WORKSPACE_PANEL_ID = 'explorer' as const

/** 终端布局模式 */
export type TerminalLayout = 'tabs' | 'split'

/**
 * 内置浏览器承载的托管站点信息
 *
 * 托管类插件（站点托管等）把自己的站点打开到内置浏览器时一并带进来。
 * 有了它，浏览器才能把「用户此刻在看哪个系统」交给 AI：AI 侧据此选中
 * 对应站点的工具，不会在多个系统之间来回猜。普通自定义菜单打开网页时为空。
 */
export interface InternalBrowserSite {
  /** 站点 ID，与插件工具里的 site 参数一致 */
  id: string
  /** 站点名称，如「客户 CRM」 */
  name: string
  /** 站点分类，如 crm / oa */
  category: string
  /** 站点入口地址 */
  origin: string
  /** 站点入口完整地址（含入口路径） */
  entryUrl: string
}

/**
 * 内置浏览器的一个标签页
 *
 * 托管站点页、AI 生成的报告、页面里 target=_blank 打开的链接都落在同一处。
 * 原先这些页面各自去占主内容区（站点走内置浏览器、报告走预览标签页），
 * 结果是后开的那一个被前一个挡住，用户得先关掉站点页面才看得到报告。
 */
export interface InternalBrowserTab {
  /** 标签 id；取自增序列，不落盘 */
  id: string
  /** 标签地址 */
  url: string
  /** 标签标题；未知时由组件按域名兜底 */
  title: string
  /**
   * 是否站点入口标签
   *
   * 站点自动化的页面变化只同步到这一个标签：用户可能正开着报告对照，
   * 不该被后台的翻页强行拉走。
   */
  siteBound?: boolean
}

/** 标签 id 序列：同一毫秒内连开多个标签也不会重号 */
let internalBrowserTabSeq = 0

function createInternalBrowserTabId(): string {
  internalBrowserTabSeq += 1
  return `ibt-${Date.now().toString(36)}-${internalBrowserTabSeq}`
}

/** 专注布局前的面板快照：进入编辑器 / 内置浏览器前记录，退出时据此恢复 */export interface ChromeSnapshot {
  /** 菜单栏（导航栏）是否展开 */
  navRailExpanded: boolean
  /** 工作空间侧边栏当前面板 */
  activeSidePanel: SidePanel
}

/** 底部 Dock 面板 Tab 类型 */
export type DockTab = 'problems' | 'output' | 'debug' | 'terminal' | 'references'

/**
 * 工作台统一作用域。
 *
 * 卡片、布局与背景不再随场景模式切换：切换场景时工作台保持同一套卡片，
 * 用户在任一场景添加的工具在其余场景同样可用，避免「卡片在场景 A 加上、
 * 切到场景 B 就找不到」的割裂感。
 */
export const WORKBENCH_SCOPE = 'shared'

export type WorkbenchScope = typeof WORKBENCH_SCOPE

/** 工作台默认卡片集合（macOS 桌面小组件式，跨场景通用） */
export const WORKBENCH_DEFAULT_WIDGETS: string[] = [
  'new-chat',
  'open-scene-tools',
  'work-pomodoro',
  'life-ledger',
  'recent-workspaces',
]

/**
 * 已下线的历史工作台卡片 id。
 *
 * 这些卡片已迁移到其他入口（work-todo 由「通用 · 待办」取代），
 * 加载持久化配置时必须剔除，否则老用户工作台上会残留失效卡片。
 */
const RETIRED_WORKBENCH_WIDGET_IDS = ['work-todo']

/** 历史版本按场景分别保存工作台配置，迁移时按此顺序读取 */
const LEGACY_WORKBENCH_SCOPES: SceneMode[] = ['work', 'life', 'study', 'dev']

function cleanWidgetIds(ids: string[]): string[] {
  return ids.filter((id) => !RETIRED_WORKBENCH_WIDGET_IDS.includes(id))
}

/**
 * 恢复工作台卡片集合。
 *
 * 优先读取统一的共享配置；老版本按场景保存的数据把各场景卡片合并去重后沿用，
 * 保证升级后用户已添加的卡片不会凭空消失。
 */
function resolveWorkbenchWidgets(saved?: Record<string, string[]>): string[] {
  const shared = cleanWidgetIds(saved?.[WORKBENCH_SCOPE] ?? [])
  if (shared.length > 0) return shared

  const merged: string[] = []
  for (const scope of LEGACY_WORKBENCH_SCOPES) {
    for (const id of cleanWidgetIds(saved?.[scope] ?? [])) {
      if (!merged.includes(id)) merged.push(id)
    }
  }
  return merged.length > 0 ? merged : [...WORKBENCH_DEFAULT_WIDGETS]
}

/** 恢复卡片摆放位置：共享配置优先，其次取第一份非空的旧场景配置 */
function resolveWorkbenchPositions(
  saved?: Record<string, Record<string, WorkbenchCardPos>>
): Record<string, WorkbenchCardPos> {
  const shared = saved?.[WORKBENCH_SCOPE]
  if (shared && Object.keys(shared).length > 0) return shared
  for (const scope of LEGACY_WORKBENCH_SCOPES) {
    const legacy = saved?.[scope]
    if (legacy && Object.keys(legacy).length > 0) return legacy
  }
  return {}
}

/** 恢复工作台背景：共享配置优先，其次取第一份非空的旧场景配置 */
function resolveWorkbenchBackground(
  saved?: Record<string, WorkbenchBackground | null>
): WorkbenchBackground | null {
  const shared = saved?.[WORKBENCH_SCOPE]
  if (shared) return shared
  for (const scope of LEGACY_WORKBENCH_SCOPES) {
    const legacy = saved?.[scope]
    if (legacy) return legacy
  }
  return null
}

/* ===================== 工作台配置持久化 ===================== */

const WORKBENCH_STORAGE_KEY = `${BRAND.cssPrefix}-workbench`

/**
 * 持久化结构：三个工作台自定义状态字段的整体快照。
 *
 * 键为工作台作用域：新版本只有 shared，老版本则是各场景模式键，
 * 因此这里用宽松的字符串索引，读盘时统一由 resolveWorkbench* 归一化。
 */
interface PersistedWorkbench {
  widgets?: Record<string, string[]>
  positions?: Record<string, Record<string, WorkbenchCardPos>>
  backgrounds?: Record<string, WorkbenchBackground | null>
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
  widgets: Record<string, string[]>
  positions: Record<string, Record<string, WorkbenchCardPos>>
  backgrounds: Record<string, WorkbenchBackground | null>
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
  workbenchWidgets: Record<string, string[]>
  workbenchPositions: Record<string, Record<string, WorkbenchCardPos>>
  workbenchBackgrounds: Record<string, WorkbenchBackground | null>
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
  'showContactsPage',
] as const

/** 全屏页面状态片段类型 */
type FullscreenPageState = Record<(typeof FULLSCREEN_PAGE_KEYS)[number], boolean>

/** 布局默认值集中管理，便于统一调整 */
const LAYOUT_DEFAULTS = {
  activeSidePanel: WORKSPACE_PANEL_ID as SidePanel,
  terminalVisible: false,
  debugVisible: false,
  chatVisible: true,
  sidebarWidth: 175,
  chatWidth: LAYOUT.CHAT_DEFAULT_WIDTH,
  terminalLayout: 'tabs' as TerminalLayout,
  navRailExpanded: true,
  dockPanelVisible: false,
  activeDockTab: 'terminal' as DockTab,
  planPanelPlanId: null,
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

/* ===================== 导航菜单显隐持久化 ===================== */

const HIDDEN_NAV_ITEMS_STORAGE_KEY = `${BRAND.cssPrefix}-hidden-nav-items`

/**
 * 存储结构版本
 *
 * v1 是裸数组，无法区分「用户主动取消了默认隐藏」与「还没选择过」；
 * v2 改为带版本号的对象，升级时把默认隐藏项合并进旧数据，之后用户怎么改
 * 就是什么，不会每次启动又被加回来。
 *
 * 默认隐藏项本身定义在 shared/configuration/navAccountMenuItems，与可管理清单同源，
 * 两边不会各自漂移。
 */
const HIDDEN_NAV_ITEMS_STORAGE_VERSION = 2


interface StoredHiddenNavItems {
  version: number
  ids: string[]
}

const sanitizeNavIds = (value: unknown): string[] =>
  Array.isArray(value)
    ? Array.from(new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0)))
    : []

/** 从 localStorage 恢复用户隐藏的导航菜单 id 列表 */
function loadHiddenNavItems(): string[] {
  try {
    const raw = StorageService.get<string>(HIDDEN_NAV_ITEMS_STORAGE_KEY)
    if (!raw) return [...DEFAULT_HIDDEN_NAV_ITEMS]

    const parsed = JSON.parse(raw) as unknown

    // 旧格式（裸数组）：视为未选择过默认隐藏项，合并后按新格式写回
    if (Array.isArray(parsed)) {
      const merged = Array.from(new Set([...sanitizeNavIds(parsed), ...DEFAULT_HIDDEN_NAV_ITEMS]))
      persistHiddenNavItems(merged)
      return merged
    }

    if (parsed && typeof parsed === 'object') {
      const stored = parsed as Partial<StoredHiddenNavItems>
      const ids = sanitizeNavIds(stored.ids)
      if (stored.version === HIDDEN_NAV_ITEMS_STORAGE_VERSION) return ids
      // 未来若新增默认隐藏项，在这里按版本号增量合并
      const merged = Array.from(new Set([...ids, ...DEFAULT_HIDDEN_NAV_ITEMS]))
      persistHiddenNavItems(merged)
      return merged
    }
  } catch (e) {
    logger.ui.warn('[LayoutSlice] Failed to load hidden nav items:', e)
  }
  return [...DEFAULT_HIDDEN_NAV_ITEMS]
}

/** 持久化用户隐藏的导航菜单 id 列表 */
function persistHiddenNavItems(ids: string[]): void {
  try {
    const payload: StoredHiddenNavItems = {
      version: HIDDEN_NAV_ITEMS_STORAGE_VERSION,
      ids,
    }
    StorageService.set(HIDDEN_NAV_ITEMS_STORAGE_KEY, JSON.stringify(payload))
  } catch (e) {
    logger.ui.warn('[LayoutSlice] Failed to persist hidden nav items:', e)
  }
}

/* ===================== 导航菜单排序持久化 ===================== */

const NAV_MENU_ORDER_STORAGE_KEY = `${BRAND.cssPrefix}-nav-menu-order`

/**
 * 从 localStorage 恢复用户自定义的导航菜单顺序
 *
 * 只记录 id 序列，不记录菜单内容：菜单本身随场景 / 插件增删，顺序表里
 * 可能留着已经不存在的 id，排序时无匹配项会被忽略，不需要在这里清理。
 */
function loadNavMenuOrder(): string[] {
  try {
    const raw = StorageService.get<string>(NAV_MENU_ORDER_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return sanitizeNavIds(parsed)
  } catch (e) {
    logger.ui.warn('[LayoutSlice] Failed to load nav menu order:', e)
  }
  return []
}

/** 持久化导航菜单顺序 */
function persistNavMenuOrder(ids: string[]): void {
  try {
    StorageService.set(NAV_MENU_ORDER_STORAGE_KEY, JSON.stringify(ids))
  } catch (e) {
    logger.ui.warn('[LayoutSlice] Failed to persist nav menu order:', e)
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
  showContactsPage: boolean
  /**
   * 启动闸门：本次启动要不要先选工作空间
   *
   * 由「新建窗口」创建的空窗口置位，选定工作空间后由界面自身清除。
   * 不并入全屏页面集合：它与那些页面不同，不与其它页面互斥，而是压在它们之上。
   */
  workspacePickPending: boolean
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

  /* ===== 内联语音对话（并入当前会话） ===== */
  /**
   * 输入框长按进入的内联语音对话是否激活。
   *
   * 与 voiceConversationActive 区分：后者是自闭环的独立语音会话（自带 LLM 会话、
   * 独立历史归档，整块覆盖聊天区）；本标记驱动的语音对话把语音产物直接写进当前
   * 会话，只借用麦克风与扬声器，因此 UI 只是叠加在聊天之上的轻层，不替换聊天界面。
   */
  voiceDialogActive: boolean

  /* ===== 场景工具直达 ===== */
  /** 欢迎页点击工具卡片时暂存的目标工具 ID，SceneToolsPanel 工具就绪后自动跳转 */
  pendingSceneToolId: string | null
  /** 设置待跳转的场景工具 ID */
  setPendingSceneToolId: (id: string | null) => void

  /* ===== 场景无人值守 ===== */
  /**
   * 声明了 ui.unattended 的活跃场景 ID（null 表示当前场景需要逐次确认）
   *
   * 只存在内存：它由布局配置推导而来，落盘反而会和真实场景配置脱节。
   * 审批门禁（resolveApprovalGate）据此对活跃场景跳过逐次询问。
   */
  unattendedScenarioId: string | null
  /** 同步场景无人值守标记 */
  setUnattendedScenario: (id: string | null) => void

  /* ===== 工作台自定义 ===== */
  /** 工作台卡片集合（跨场景共享，用户可自定义：添加/移除/排序） */
  workbenchWidgets: Record<WorkbenchScope, string[]>
  /** 切换卡片的可见性 */
  setWorkbenchWidget: (widgetId: string, visible: boolean) => void
  /** 调整卡片顺序（上移/下移） */
  moveWorkbenchWidget: (widgetId: string, direction: 'up' | 'down') => void
  /** 重置为默认卡片配置 */
  resetWorkbenchWidgets: () => void

  /* ===== 工作台自由摆放与背景 ===== */
  /** 工作台卡片自由摆放位置（跨场景共享） */
  workbenchPositions: Record<WorkbenchScope, Record<string, WorkbenchCardPos>>
  /** 设置单张卡片位置 */
  setWorkbenchPosition: (widgetId: string, pos: WorkbenchCardPos) => void
  /** 批量设置卡片位置（拖拽碰撞解析用，一次渲染） */
  setWorkbenchPositions: (positions: Record<string, WorkbenchCardPos>) => void
  /** 工作台背景配置（跨场景共享） */
  workbenchBackgrounds: Record<WorkbenchScope, WorkbenchBackground | null>
  /** 设置工作台背景（null 表示移除背景） */
  setWorkbenchBackground: (background: WorkbenchBackground | null) => void

  /* ===== 面板可见性操作 ===== */
  setActiveSidePanel: (panel: SidePanel) => void
  /**
   * 因切走视图而收起侧边栏
   *
   * 与 setActiveSidePanel(null) 的差别只在「上次面板」：后者保留当前面板，
   * 顶部开关「关掉再打开」仍回到同一块；而打开设置页 / 历史会话、切换会话、
   * 把待办交给 AI 这类操作已经把用户带离了那块面板的上下文，开关再按下应当
   * 回到工作空间面板，而不是把刚离开的插件市场 / 待办中心重新顶出来。
   */
  closeSidePanelForView: () => void
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

  /* ===== 计划任务面板（右侧抽屉） ===== */
  /** 当前打开的计划面板所展示的 planId；null 表示面板收起 */
  planPanelPlanId: string | null
  /** 打开计划面板并定位到指定计划 */
  openPlanPanel: (planId: string) => void
  /** 收起计划面板 */
  closePlanPanel: () => void

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
  setShowContactsPage: (show: boolean) => void
  /** 设置/清除启动时的选工作空间闸门 */
  setWorkspacePickPending: (pending: boolean) => void
  /** 关闭所有全屏页面，返回聊天界面 */
  closeAllFullPages: () => void

  /* ===== 语音对话模式操作 ===== */
  /** 进入/退出语音对话模式 */
  setVoiceConversationActive: (active: boolean) => void
  /** 切换语音对话模式 */
  toggleVoiceConversation: () => void

  /* ===== 内联语音对话操作 ===== */
  /** 进入/退出内联语音对话（输入框长按触发） */
  setVoiceDialogActive: (active: boolean) => void

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

  /* ===== 导航菜单显隐 ===== */
  /**
   * 用户手动隐藏的导航菜单 id（持久化到 localStorage）
   *
   * 场景菜单、插件菜单、自定义菜单共用一套 id：它们在导航栏里本就是同一列，
   * 用户也不关心某个入口来自哪一方。
   *
   * 与 SidebarItemDescriptor.hidden 的区别：那是场景声明层面的「不作为常驻入口」，
   * 这里是用户偏好，随时可在「菜单显示」里改回来。
   */
  hiddenNavItems: string[]
  /** 整体覆盖隐藏列表（穿梭框一次提交多个变化） */
  setHiddenNavItems: (ids: string[]) => void
  /** 设置单个菜单的显隐 */
  setNavItemHidden: (id: string, hidden: boolean) => void

  /* ===== 导航菜单排序 ===== */
  /**
   * 用户在「菜单显示」里拖曳调整的导航菜单顺序（持久化到 localStorage）
   *
   * 与 hiddenNavItems 一样跨场景 / 插件 / 自定义菜单共用一套 id：顺序表只描述
   * 「谁排在谁前面」，未列出的入口按原有分组顺序跟在后面。
   */
  navMenuOrder: string[]
  /** 整体覆盖菜单顺序（拖曳结束后一次提交） */
  setNavMenuOrder: (ids: string[]) => void

  /* ===== 内部浏览器 ===== */
  /** 内部浏览器当前打开的 URL（null 表示未打开） */
  internalBrowserUrl: string | null
  /** 内部浏览器页面标题 */
  internalBrowserTitle: string
  /**
   * 内部浏览器使用的会话分区（null 表示沿用主窗口默认 session）
   *
   * 托管类插件打开自己管理的站点时传入 `persist:awee-site-<id>`，使内置浏览器
   * 与插件的后台采集窗口共享同一份登录态。
   */
  internalBrowserPartition: string | null
  /**
   * 内置浏览器刷新令牌
   *
   * 插件在站点分区里完成登录后，页面本身不会自己更新，需要一个外部入口把当前
   * 网页重载一次，用户才能看到登录后的界面。每调用一次 reloadInternalBrowser
   * 递增，由 InternalBrowser 消费。
   */
  internalBrowserReloadToken: number
  /**
   * 内置浏览器当前承载的托管站点（null 表示这是普通网页）
   *
   * 站点信息会随对话上下文交给 AI，让它围绕这个站点服务。
   */
  internalBrowserSite: InternalBrowserSite | null
  /** 当前激活的自定义菜单 ID（导航栏高亮用，null 表示未激活自定义菜单） */
  activeCustomMenuId: string | null
  /** 打开内部浏览器前的聊天窗口显隐（关闭时恢复，避免覆盖面板 / 用户的意图） */
  chatVisibleBeforeInternalBrowser: boolean | null
  /**
   * 打开内部浏览器
   *
   * @param site 托管站点信息；普通网页不传，传入后对话上下文会带上该站点
   */
  openInternalBrowser: (
    url: string,
    title?: string,
    menuId?: string,
    partition?: string,
    site?: InternalBrowserSite | null,
  ) => void
  /** 刷新内部浏览器当前页面（未打开时是空操作） */
  reloadInternalBrowser: () => void
  /** 关闭内部浏览器 */
  closeInternalBrowser: () => void

  /* ===== 对话抽屉 ===== */
  /**
   * 对话面板是否以抽屉形态浮在工作区之上
   *
   * 内置浏览器占满左侧工作区时，右侧再挤一栏对话会把页面压得很窄。
   * 由浏览器的「AI 助手」按需拉出抽屉，用完收起，页面回到整宽——
   * 同一时刻只有对话面板一个实例，只是外框形态在 inline / drawer 之间切换。
   */
  chatAsDrawer: boolean
  /**
   * 内置浏览器的标签页集合
   *
   * 打开浏览器时由一个站点入口标签起步，之后 AI 生成的报告、页面里的新窗口
   * 都以新标签追加——它们和站点页是同一处上下文，不该另起一个浏览器。
   */
  internalBrowserTabs: InternalBrowserTab[]
  /** 当前激活的标签页 id（null 表示浏览器未打开） */
  activeInternalBrowserTabId: string | null
  /** 在已打开的内置浏览器里新开一个标签页并激活它 */
  openInternalBrowserTab: (url: string, title?: string) => void
  /** 切换标签页（id 不存在时忽略） */
  selectInternalBrowserTab: (tabId: string) => void
  /** 关闭标签页；只剩一个时不做任何事，关闭浏览器请用 closeInternalBrowser */
  closeInternalBrowserTab: (tabId: string) => void
  /**
   * 更新标签页地址
   *
   * 地址栏跳转与站点自动化导航都走这里：地址变化会让 webview 重新导航到新页面。
   */
  updateInternalBrowserTabUrl: (tabId: string, url: string, title?: string) => void
  /**
   * 拉出对话抽屉前的对话显隐
   *
   * 抽屉只是把对话临时拉出来看一眼，收起后要回到打开前的状态。内置浏览器占满工作区时
   * 对话本来是隐藏的，只把形态退回内排而不还原显隐，右侧就会凭空多出一栏常驻会话。
   */
  chatVisibleBeforeDrawer: boolean | null
  /** 以抽屉形态打开对话面板，并把焦点交给它 */
  openChatDrawer: () => void
  /** 收起对话抽屉，恢复到打开前的显隐（浏览器下即对话重新隐藏） */
  closeChatDrawer: () => void

  /* ===== 专注布局（编辑器 / 内置浏览器占位时收起外壳） ===== */
  /**
   * 进入专注布局前的面板快照。
   *
   * null 表示当前不在专注布局，或用户已经手动接管过面板状态（此时退出不再覆盖）。
   */
  chromeSnapshotBeforeFocus: ChromeSnapshot | null
  /**
   * 记录当前面板状态并收起外壳。
   *
   * 幂等：已在专注布局（快照非空）时不覆盖首次快照，避免嵌套打开时丢失原始状态。
   *
   * @param options.collapseSidePanel 是否同时收起工作空间侧边栏。内置浏览器需要让出整块
   *        横向空间，传 true；文件编辑器只让出菜单栏，传 false（默认 true）。
   */
  enterFocusLayout: (options?: { collapseSidePanel?: boolean }) => void
  /** 恢复到进入专注布局前的面板状态；快照为空时不做任何事 */
  exitFocusLayout: () => void
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
  planPanelPlanId: LAYOUT_DEFAULTS.planPanelPlanId,
  ...buildInitialFullscreenPages(),
  workspacePickPending: false,

  /* ----- 语音对话模式初始状态 ----- */
  voiceConversationActive: false,
  voiceDialogActive: false,

  /* ----- 场景工具直达初始状态 ----- */
  pendingSceneToolId: null,

  /* ----- 场景无人值守初始状态 ----- */
  unattendedScenarioId: null,

  /* ----- 场景配置版本初始状态 ----- */
  scenarioConfigVersion: 0,

  /* ----- 自定义菜单初始状态（从 localStorage 恢复） ----- */
  customMenus: loadCustomMenus(),

  /* ----- 导航菜单显隐初始状态（从 localStorage 恢复） ----- */
  hiddenNavItems: loadHiddenNavItems(),
  /* ----- 导航菜单排序初始状态（从 localStorage 恢复） ----- */
  navMenuOrder: loadNavMenuOrder(),

  /* ----- 内部浏览器初始状态 ----- */
  internalBrowserUrl: null,
  internalBrowserTitle: '',
  internalBrowserPartition: null,
  internalBrowserReloadToken: 0,
  internalBrowserSite: null,
  activeCustomMenuId: null,
  chatVisibleBeforeInternalBrowser: null,
  chatAsDrawer: false,
  chatVisibleBeforeDrawer: null,
  internalBrowserTabs: [],
  activeInternalBrowserTabId: null,
  chromeSnapshotBeforeFocus: null,

  /* ----- 工作台自定义初始状态（优先恢复上次保存的配置） ----- */
  workbenchWidgets: {
    shared: resolveWorkbenchWidgets(persistedWorkbench.widgets),
  },
  workbenchPositions: {
    shared: resolveWorkbenchPositions(persistedWorkbench.positions),
  },
  workbenchBackgrounds: {
    shared: resolveWorkbenchBackground(persistedWorkbench.backgrounds),
  },
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
      // 用户显式打开 / 切换面板即视为接管：丢弃专注布局快照，退出时不再覆盖这次选择。
      // 收起（null）不清快照——专注布局自身、打开预览、切到浏览器等都会程序化收起侧边栏，
      // 若把它们也算作接管，关闭编辑器 / 浏览器后就再也恢复不到打开前的面板。
      chromeSnapshotBeforeFocus: panel ? null : state.chromeSnapshotBeforeFocus,
    })),
  /**
   * 收起侧边栏，并把「上次面板」重置为工作空间面板。
   *
   * lastActiveSidePanel 是顶部开关的恢复目标：用户自己关掉面板再打开，理应回到
   * 同一块；但切走视图是被动离开，若继续记住插件市场，开关一按就会把用户刚离开
   * 的界面重新弹出，看上去像「点错按钮」。
   */
  closeSidePanelForView: () =>
    set({
      activeSidePanel: null,
      lastActiveSidePanel: WORKSPACE_PANEL_ID,
      // 视图切换属于用户主动接管，专注布局的快照不再回放
      chromeSnapshotBeforeFocus: null,
    }),
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
  setUnattendedScenario: (id) => set({ unattendedScenarioId: id }),
  setNavRailExpanded: (expanded) =>
    set((state) => ({
      navRailExpanded: expanded,
      // 只有「用户主动展开」才算接管专注布局；收起多来自打开文件时的程序化调用
      // （AweeApp / 文件预览），把它们算作接管会让快照丢失、关闭后无法恢复。
      chromeSnapshotBeforeFocus: expanded ? null : state.chromeSnapshotBeforeFocus,
    })),
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
      chromeSnapshotBeforeFocus: null,
    })),
  toggleChat: () => set((state) => ({ chatVisible: !state.chatVisible })),
  toggleNavRail: () =>
    set((state) => ({
      navRailExpanded: !state.navRailExpanded,
      chromeSnapshotBeforeFocus: null,
    })),

  /* ----- 底部 Dock 面板操作 ----- */
  setDockPanelVisible: (visible) => set({ dockPanelVisible: visible }),
  setActiveDockTab: (tab) => set({ activeDockTab: tab }),
  toggleDockPanel: () => set((state) => ({ dockPanelVisible: !state.dockPanelVisible })),
  openDockPanel: (tab) => set({ dockPanelVisible: true, activeDockTab: tab }),

  /* ----- 计划任务面板操作 ----- */
  openPlanPanel: (planId) => set({ planPanelPlanId: planId }),
  closePlanPanel: () => set({ planPanelPlanId: null }),

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
      setShowContactsPage: (show) => set(buildFullscreenToggle('showContactsPage', show)),
  // 闸门不参与全屏页面互斥：关闭全屏页不应把用户重新拉回选择界面
  setWorkspacePickPending: (pending) => set({ workspacePickPending: pending }),
  closeAllFullPages: () => set(buildFullscreenReset()),

  /* ----- 语音对话模式操作 ----- */
  setVoiceConversationActive: (active) => set({ voiceConversationActive: active }),
  toggleVoiceConversation: () => set((state) => ({ voiceConversationActive: !state.voiceConversationActive })),
  setVoiceDialogActive: (active) => set({ voiceDialogActive: active }),

  /* ----- 场景工具直达操作 ----- */
  setPendingSceneToolId: (id) => set({ pendingSceneToolId: id }),

  /* ----- 场景配置版本操作 ----- */
  incrementScenarioConfigVersion: () => set((state) => ({ scenarioConfigVersion: state.scenarioConfigVersion + 1 })),

  /* ----- 环境检测弹窗操作 ----- */
  setShowEnvironmentSetup: (show) => set({ showEnvironmentSetup: show }),

  /* ----- 工作台自定义操作 ----- */
  setWorkbenchWidget: (widgetId, visible) =>
    set((state) => {
      const list = state.workbenchWidgets[WORKBENCH_SCOPE] ?? []
      const nextWidgets = {
        ...state.workbenchWidgets,
        [WORKBENCH_SCOPE]: visible ? [...list, widgetId] : list.filter((w) => w !== widgetId),
      }
      // 移除卡片时同步清理其自由摆放位置
      let nextPositions = state.workbenchPositions
      if (!visible) {
        const positions = state.workbenchPositions[WORKBENCH_SCOPE]
        if (positions && positions[widgetId]) {
          const next = { ...positions }
          delete next[widgetId]
          nextPositions = { ...state.workbenchPositions, [WORKBENCH_SCOPE]: next }
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
  moveWorkbenchWidget: (widgetId, direction) =>
    set((state) => {
      const list = [...(state.workbenchWidgets[WORKBENCH_SCOPE] ?? [])]
      const idx = list.indexOf(widgetId)
      if (idx === -1) return state
      const target = direction === 'up' ? idx - 1 : idx + 1
      if (target < 0 || target >= list.length) return state
      const [item] = list.splice(idx, 1)
      list.splice(target, 0, item)
      return { workbenchWidgets: { ...state.workbenchWidgets, [WORKBENCH_SCOPE]: list } }
    }),
  setWorkbenchPosition: (widgetId, pos) =>
    set((state) => {
      const next = {
        ...state.workbenchPositions,
        [WORKBENCH_SCOPE]: { ...(state.workbenchPositions[WORKBENCH_SCOPE] ?? {}), [widgetId]: pos },
      }
      // 自动保存：单张卡片位置
      persistWorkbenchFrom({
        workbenchWidgets: state.workbenchWidgets,
        workbenchPositions: next,
        workbenchBackgrounds: state.workbenchBackgrounds,
      })
      return { workbenchPositions: next }
    }),
  setWorkbenchPositions: (positions) =>
    set((state) => {
      const next = { ...state.workbenchPositions, [WORKBENCH_SCOPE]: positions }
      // 自动保存：拖拽结束后的整体排布（位置 / 大小）
      persistWorkbenchFrom({
        workbenchWidgets: state.workbenchWidgets,
        workbenchPositions: next,
        workbenchBackgrounds: state.workbenchBackgrounds,
      })
      return { workbenchPositions: next }
    }),
  setWorkbenchBackground: (background) =>
    set((state) => {
      const next = { ...state.workbenchBackgrounds, [WORKBENCH_SCOPE]: background }
      // 自动保存：背景设置 / 移除
      persistWorkbenchFrom({
        workbenchWidgets: state.workbenchWidgets,
        workbenchPositions: state.workbenchPositions,
        workbenchBackgrounds: next,
      })
      return { workbenchBackgrounds: next }
    }),
  resetWorkbenchWidgets: () =>
    set((state) => {
      const nextWidgets = {
        ...state.workbenchWidgets,
        [WORKBENCH_SCOPE]: [...WORKBENCH_DEFAULT_WIDGETS],
      }
      // 恢复默认布局同时清空自定义位置，回落到默认流式排布
      const nextPositions = { ...state.workbenchPositions, [WORKBENCH_SCOPE]: {} }
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

  /* ----- 导航菜单显隐操作 ----- */
  setHiddenNavItems: (ids) =>
    set(() => {
      // 去重后再落盘：穿梭框会成批提交，重复 id 会让隐藏计数虚高
      const next = Array.from(new Set(ids.filter((id) => typeof id === 'string' && id.length > 0)))
      persistHiddenNavItems(next)
      return { hiddenNavItems: next }
    }),
  setNavItemHidden: (id, hidden) =>
    set((state) => {
      const exists = state.hiddenNavItems.includes(id)
      // 状态未变时不写盘、不触发订阅者重渲染
      if (hidden === exists) return state
      const next = hidden
        ? [...state.hiddenNavItems, id]
        : state.hiddenNavItems.filter((item) => item !== id)
      persistHiddenNavItems(next)
      return { hiddenNavItems: next }
    }),

  /* ----- 导航菜单排序操作 ----- */
  setNavMenuOrder: (ids) =>
    set(() => {
      // 拖曳结束一次性提交，去重后落盘，避免同一 id 出现两次导致排序不稳定
      const next = Array.from(new Set(ids.filter((id) => typeof id === 'string' && id.length > 0)))
      persistNavMenuOrder(next)
      return { navMenuOrder: next }
    }),

  /* ----- 内部浏览器操作 ----- */
  openInternalBrowser: (url, title, menuId, partition, site) =>
    set((state) => {
      /**
       * 入口标签
       *
       * 每次「进入管理 / 打开菜单」都以一个站点入口标签起步：上一次留下的报告、
       * 帮助页属于上一段浏览，带过来只会让标签条越攒越长。同一个站点重复打开时
       * 依旧重置——用户点的是「进入管理」，期望看到的是入口页。
       */
      const entryTab: InternalBrowserTab = {
        id: createInternalBrowserTabId(),
        url,
        title: title ?? '',
        siteBound: true,
      }
      return {
        internalBrowserUrl: url,
        internalBrowserTitle: title ?? '',
        internalBrowserPartition: partition ?? null,
        // 只在这次调用带了站点信息时覆盖：不传 site 的自定义菜单打开网页会把旧站点带过去
        internalBrowserSite: site ?? null,
        activeCustomMenuId: menuId ?? null,
        internalBrowserTabs: [entryTab],
        activeInternalBrowserTabId: entryTab.id,
        // 仅在「由未打开变为打开」时记录打开前的显隐，连续打开其它链接不覆盖首次快照
        chatVisibleBeforeInternalBrowser: state.internalBrowserUrl
          ? state.chatVisibleBeforeInternalBrowser
          : state.chatVisible,
        // 打开内部浏览器时隐藏聊天窗口，浏览器占据其位置；用户可随时手动恢复显示
        chatVisible: false,
        // 新开一段浏览时令牌归零，避免上一次的刷新计数在重新挂载时多触发一次重载
        internalBrowserReloadToken: state.internalBrowserUrl ? state.internalBrowserReloadToken : 0,
      }
    }),
  reloadInternalBrowser: () =>
    set((state) =>
      // 没打开时不做任何事：令牌空转会让下次打开白白多刷一次页面
      state.internalBrowserUrl
        ? { internalBrowserReloadToken: state.internalBrowserReloadToken + 1 }
        : {},
    ),
  closeInternalBrowser: () =>
    set((state) => {
      // 没有打开内部浏览器时只清理残留字段，不动聊天显隐。
      //
      // 此前这里无条件回写 chatVisible，而快照在未打开时为 null、兜底值是 true，
      // 于是每个调用方（点菜单、切面板、开预览…）都会顺手把对话窗口叫出来。
      // 用户看到的就是「点一下菜单，会话窗口自己弹出来」。
      if (!state.internalBrowserUrl) {
        return {
          internalBrowserUrl: null,
          internalBrowserTitle: '',
          internalBrowserPartition: null,
          internalBrowserSite: null,
          activeCustomMenuId: null,
          chatAsDrawer: false,
          chatVisibleBeforeDrawer: null,
          // 浏览器没开时也要清空标签：残留标签会在下次打开时短暂占位
          internalBrowserTabs: [],
          activeInternalBrowserTabId: null,
        }
      }
      return {
        internalBrowserUrl: null,
        internalBrowserTitle: '',
        internalBrowserPartition: null,
        internalBrowserSite: null,
        activeCustomMenuId: null,
        // 浏览器关掉后抽屉形态没有承载对象了，退回内排，避免对话悬空在整屏上
        chatAsDrawer: false,
        // 抽屉的显隐快照同样失效：下一位使用者应记录自己的打开前状态
        chatVisibleBeforeDrawer: null,
        // 标签属于这一次浏览，关掉浏览器即全部作废
        internalBrowserTabs: [],
        activeInternalBrowserTabId: null,
        // 关闭后恢复到打开前的显隐：面板自动隐藏的聊天不会被唤起，用户手动开的聊天仍然保留。
        // 快照缺失时保留当前值，不兜底成 true。
        chatVisible: state.chatVisibleBeforeInternalBrowser ?? state.chatVisible,
        chatVisibleBeforeInternalBrowser: null,
      }
    }),

  /* ----- 内置浏览器标签页 ----- */
  openInternalBrowserTab: (url, title) =>
    set((state) => {
      // 浏览器没开时不凭空造标签：此时没有可挂载的容器，调用方应先 openInternalBrowser
      if (!state.internalBrowserUrl || !url) return state
      const tab: InternalBrowserTab = {
        id: createInternalBrowserTabId(),
        url,
        title: title ?? '',
      }
      return {
        internalBrowserTabs: [...state.internalBrowserTabs, tab],
        activeInternalBrowserTabId: tab.id,
      }
    }),
  selectInternalBrowserTab: (tabId) =>
    set((state) =>
      state.internalBrowserTabs.some((tab) => tab.id === tabId)
        ? { activeInternalBrowserTabId: tabId }
        : state,
    ),
  closeInternalBrowserTab: (tabId) =>
    set((state) => {
      // 只剩一个标签时不动：关掉它等于关浏览器，那是 closeInternalBrowser 的语义
      if (state.internalBrowserTabs.length <= 1) return state
      const index = state.internalBrowserTabs.findIndex((tab) => tab.id === tabId)
      if (index === -1) return state
      const nextTabs = state.internalBrowserTabs.filter((tab) => tab.id !== tabId)
      if (state.activeInternalBrowserTabId !== tabId) {
        return { internalBrowserTabs: nextTabs }
      }
      // 关掉的是当前标签：落到原位置的邻居上，标签条不会整体跳一下
      const fallback = nextTabs[Math.min(index, nextTabs.length - 1)]
      return { internalBrowserTabs: nextTabs, activeInternalBrowserTabId: fallback.id }
    }),
  updateInternalBrowserTabUrl: (tabId, url, title) =>
    set((state) => {
      const target = state.internalBrowserTabs.find((tab) => tab.id === tabId)
      if (!target || !url) return state
      const nextTitle = title || target.title
      // 地址与标题都没变时返回原 state：站点自动化会连续推同一页的事件，
      // 重复写会让 webview 白重载一次
      if (target.url === url && target.title === nextTitle) return state
      return {
        internalBrowserTabs: state.internalBrowserTabs.map((tab) =>
          tab.id === tabId ? { ...tab, url, title: nextTitle } : tab,
        ),
      }
    }),

  /* ----- 对话抽屉操作 ----- */
  openChatDrawer: () =>
    set((state) => ({
      chatAsDrawer: true,
      chatVisible: true,
      // 只在「由收起变为拉出」时记录快照：抽屉开着又被触发一次时不能覆盖首次的显隐
      chatVisibleBeforeDrawer: state.chatAsDrawer
        ? state.chatVisibleBeforeDrawer
        : state.chatVisible,
    })),
  closeChatDrawer: () =>
    // 形态退出抽屉，同时把对话显隐退回打开前的状态。
    // 只改形态的话，内置浏览器里本应隐藏的对话会在右侧重新变成一栏常驻会话。
    set((state) => ({
      chatAsDrawer: false,
      chatVisible: state.chatVisibleBeforeDrawer ?? false,
      chatVisibleBeforeDrawer: null,
    })),


  /* ----- 专注布局操作 ----- */
  enterFocusLayout: (options) =>
    set((state) => {
      const collapseSidePanel = options?.collapseSidePanel !== false
      const snapshot = state.chromeSnapshotBeforeFocus

      // 已在专注布局里（例如编辑器里再打开内置浏览器、浏览器关闭后回到编辑器）：
      // 保留首次快照，只按当前模式补齐 / 回退侧边栏。
      if (snapshot) {
        const nextSidePanel = collapseSidePanel ? null : snapshot.activeSidePanel
        if (state.navRailExpanded === false && state.activeSidePanel === nextSidePanel) {
          return state
        }
        return { navRailExpanded: false, activeSidePanel: nextSidePanel }
      }

      return {
        chromeSnapshotBeforeFocus: {
          navRailExpanded: state.navRailExpanded,
          activeSidePanel: state.activeSidePanel,
        },
        navRailExpanded: false,
        // 文件编辑器只让出菜单栏；内置浏览器才收起侧边栏
        activeSidePanel: collapseSidePanel ? null : state.activeSidePanel,
      }
    }),
  exitFocusLayout: () =>
    set((state) => {
      const snapshot = state.chromeSnapshotBeforeFocus
      if (!snapshot) return state
      return {
        navRailExpanded: snapshot.navRailExpanded,
        activeSidePanel: snapshot.activeSidePanel,
        chromeSnapshotBeforeFocus: null,
      }
    }),
  }
}

