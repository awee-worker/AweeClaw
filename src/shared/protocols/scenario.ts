/**
 * Scenario Plugin System - 场景插件系统
 *
 * 将 AweeClaw 定位为通用 AI 智能体平台。
 * 每个场景定义了身份、能力、UI 布局和数据源的完整配置。
 *
 * 设计原则：
 * - 场景即插件：开发助手只是默认场景之一
 * - 能力声明式：场景声明需要什么工具和上下文
 * - UI 自适应：场景决定主界面布局
 * - 向后兼容：不打开工作空间时自动切换到通用助手场景
 */

import type { WorkMode } from '@protocols/workModeProtocol'
import { BRAND } from '@shared/brand'
import { StorageService } from '@shared/toolkit/StorageService'
import type { RegionNode, ScenarioShellMode } from './scenario-regions'

// ============================================
// 场景身份定义
// ============================================

export interface ScenarioIdentity {
  systemPrompt: string
  securityRules: string
  conventions: string
  workflow: string
  outputFormat?: string
  toolGuidelines?: string
}

/**
 * 场景会话边界
 *
 * 关闭场景后对话仍然留在同一条会话流里，通用助手随时可以接手。但对「工作区
 * 自成一整套流程」的场景（原型工坊、图纸库等）来说，用户要的是本场景内的
 * 产出，而不是一个顺带能写脚本、能查资料、能跑命令的通用助手 —— 那些能力
 * 一旦混进来，模型很容易用 workaround（例如直接写一份 HTML）绕开场景自己的
 * 产出通道。
 *
 * 声明会话边界后，由宿主统一落实两件事：
 * - 提示词：在身份之后、工具清单之前注入边界声明，说明本会话只处理什么、
 *   场景外请求如何回应（引导用户切换场景，而不是硬着头皮做）
 * - 工具集：allowedTools / deniedTools 直接作用于下发给模型的内置工具清单，
 *   与提示词里的清单同源（见 getToolsForContext），不存在「提示词说没有、
 *   实际还能调」的错位
 *
 * 未声明时不改变任何现有行为。
 */
export interface ScenarioSessionScope {
  /**
   * 边界说明（Markdown 片段）
   *
   * 直接注入系统提示词。需要写清楚：本会话负责什么、什么请求必须拒答、
   * 拒答时引导用户去哪。
   */
  boundary: string
  /**
   * 是否显式拒答场景外话题
   *
   * 为真时追加一条硬约束：场景外请求不展开、不绕道完成，只说明边界并给出
   * 切换建议。为假时只描述边界，由模型自行把握。
   */
  refuseOffTopic?: boolean
  /**
   * 工具白名单（支持 `proto_*` 这种前缀写法）
   *
   * 非空时只下发批次内的工具。场景自有工具同样要写进来，否则会被一并挡掉。
   */
  allowedTools?: string[]
  /**
   * 工具黑名单（支持 `git_*` 这种前缀写法）
   *
   * 在白名单之后生效，适合「大部分保留、少数几个必须挡掉」的场景。
   */
  deniedTools?: string[]
}

// ============================================
// 场景能力声明
// ============================================

export interface ScenarioCapabilities {
  toolPacks: string[]
  /** 场景直接声明的工具名列表（用于声明式场景，无需 toolPack 注册） */
  tools?: string[]
  modes: ScenarioModeDescriptor[]
  contextTypes: ContextTypeDescriptor[]
  outputFormats: string[]
}

export interface ScenarioModeDescriptor {
  id: WorkMode | string
  label: string
  labelZh: string
  icon: string
  description: string
  descriptionZh: string
  toolPolicy: {
    enabled: boolean
    requireApproval?: boolean
  }
}

export interface ContextTypeDescriptor {
  type: string
  label: string
  labelZh: string
  icon?: string
  priority: number
}

// ============================================
// UI 布局定义
// ============================================

export type UILayout =
  | 'editor-centric'
  | 'chat-centric'
  | 'canvas-centric'
  | 'dashboard-centric'
  | 'analytics-centric'
  | 'research-centric'
  | 'focus-centric'
  | 'split-centric'
  | 'fullscreen-chat'
  | 'minimal'

export interface PanelDescriptor {
  id: string
  component: string
  props?: Record<string, unknown>
  region: 'primary' | 'secondary' | 'auxiliary' | 'floating'
  defaultVisible?: boolean
  resizable?: boolean
  minWidth?: number
  maxWidth?: number
}

export interface SidebarItemDescriptor {
  id: string
  icon: string
  label: string
  labelZh: string
  component: string
  position?: number
  /** 宽模式：面板在主内容区全屏展示，隐藏侧边栏 */
  wideMode?: boolean
  /**
   * 激活该侧边栏面板时隐藏主内容区的编辑器（含编辑器欢迎页）。
   * 适用于纯列表型面板（如项目列表、模板列表），
   * 避免无文件的编辑器欢迎页占据主区域空间，让 Chat 占满主区。
   */
  hideEditor?: boolean
  /**
   * 激活该宽模式面板时隐藏聊天窗口（默认隐藏，用户可手动恢复显示）。
   * 适用于需要最大化空间的面板（如画布、图纸库），
   * 让面板独占主内容区。仅对 wideMode 面板生效。
   *
   * 若需要"无论用户怎么切换都保持隐藏"，请用场景级 wideModeHidesChat。
   */
  hideChat?: boolean
  /**
   * 该宽模式面板保留聊天窗口，与面板并列展示（强制，不受 wideModeHidesChat 影响）。
   *
   * 用于"参考资料 + 对话"这类需要边看边问的面板（如开发助手的知识库）：
   * 场景整体希望面板独占主区域，但个别面板必须保留对话。
   */
  keepChat?: boolean
  /**
   * 是否在侧边栏导航中隐藏此入口。
   *
   * hidden=true 的面板仍会被 PanelRegistry 注册（可通过代码 setActiveSidePanel 激活），
   * 但不出现在 NavigationRail 的菜单列表中。
   *
   * 用途：聚合型工作空间面板（如场景开发助手的"项目工作空间"），
   * 由其他面板（如项目列表卡片的"打开"按钮）触发激活，而非直接作为菜单项。
   */
  hidden?: boolean
}

export interface StatusBarItemDescriptor {
  id: string
  component: string
  position: 'left' | 'right'
  order?: number
}

export interface WelcomeSuggestionItem {
  icon: string
  title: string
  titleZh: string
  prompt: string
  color: string
}

export interface WelcomeTitleConfig {
  title: string
  titleZh: string
  subtitle: string
  subtitleZh: string
}

/**
 * 主区域组件声明
 *
 * 用于「主内容区不展示编辑器/通用看板，而是展示场景自己的组件」这类需求。
 * 组件通过场景模块的 getComponents() 以 component 键名注册。
 */
export interface PrimaryViewDescriptor {
  /** 组件键名，对应场景模块 getComponents() 返回的 key */
  component: string
  /**
   * 用户打开文件时是否优先显示编辑器。
   *
   * 缺省 true，与现有场景布局行为一致（有文件看文件，无文件看场景主视图）。
   * 置为 false 表示主区域始终由该组件占据，用户可以另开窗口查看文件。
   */
  preferEditor?: boolean
}

/**
 * 外壳元素显隐配置
 *
 * 场景接管整个工作区后，宿主通用入口（新建任务、工作空间切换、语音对话等）
 * 往往与场景自身的流程重复。这里按场景关掉，避免用户在场景里看到两套入口。
 *
 * 全部缺省为 false（显示），保持现有场景行为不变。
 */
/**
 * 顶部菜单栏顶级菜单标识
 *
 * 与主进程菜单（menuItems/*）以及 Windows/Linux 自绘菜单（appMenuModel）的
 * id 一一对应。macOS 的应用名菜单由系统托管，不在此列。
 */
export type ScenarioMenuId = 'file' | 'edit' | 'view' | 'ai' | 'window' | 'help'

/**
 * 顶部菜单栏显隐配置
 *
 * 场景接管整壳后，菜单里的多数条目（打开文件夹、终端、AI 相关命令）在场景内
 * 没有对应动作，留着只会引导用户点进空白。这里按场景收窄菜单范围。
 *
 * - 不写：保持全部菜单可见（现有场景行为不变）
 * - items：只保留列出的顶级菜单，其余收起
 * - hide：整条菜单栏收起（macOS 仍保留系统应用菜单）
 */
export interface ScenarioMenuBarConfig {
  hide?: boolean
  items?: ScenarioMenuId[]
}

export interface ScenarioChromeConfig {
  /**
   * 左侧导航栏整体不渲染。
   *
   * 适用于「工作区自成一整套导航」的场景：导航栏在这里只剩一条空白竖条，
   * 反而挤占内容宽度。关掉后场景出口仍在顶部 scene-switcher，账号区按
   * userMenuPlacement 落到顶部右侧，用户不会失去这两个入口。
   *
   * 默认外壳结构下收起 rail 槽位；regions 档位请同时不写 rail 节点。
   * 两种档位下 NavigationRail 都不会渲染，因此它内部的会话历史、导航入口
   * 也一并消失 —— 场景需要自己在工作区里提供等价入口。
   */
  hideNavRail?: boolean
  /**
   * 账号区（头像 + 用户菜单）摆放位置。
   *
   * - rail    ：导航栏左下角（缺省，与原行为一致）
   * - titlebar：顶部最右侧，渲染为紧凑头像，菜单向下展开
   *
   * 缺省值随 hideNavRail 推导：导航栏被关掉时默认落到 titlebar，
   * 否则用户会连账号入口一起失去。
   */
  userMenuPlacement?: 'rail' | 'titlebar'
  /** 导航栏顶部「仪表盘」入口 */
  hideDashboard?: boolean
  /** 导航栏「新建任务」入口 */
  hideNewTask?: boolean
  /** 导航栏「场景工具」入口 */
  hideSceneTools?: boolean
  /** 顶部工作空间选择器 */
  hideWorkspaceSelector?: boolean
  /** 顶部快速搜索入口 */
  hideSearch?: boolean
  /**
   * 顶部菜单栏（文件 / 编辑 / 视图 / 会话 / 窗口 / 帮助）自定义
   *
   * 跨平台生效：Windows/Linux 作用于自绘菜单栏，macOS 作用于系统菜单栏。
   */
  menuBar?: ScenarioMenuBarConfig
  /** 顶部「显示 / 隐藏侧边栏」按钮 */
  hideSidebarToggle?: boolean
  /** 顶部「显示 / 隐藏 AI 助手」按钮 */
  hideChatToggle?: boolean
  /** 顶部语音对话入口 */
  hideVoiceConversation?: boolean
  /** 顶部桌面伴侣开关 */
  hideDesktopCompanion?: boolean
  /** 导航栏历史会话列表 */
  hideChatHistory?: boolean
}

/**
 * 解析账号区摆放位置
 *
 * 推导规则集中在这里，避免标题栏与导航栏各写一份判断而出现「两边都渲染」
 * 或「两边都不渲染」的错位。导航栏被关掉时用户仍然需要账号入口，因此缺省
 * 落到顶部右侧。
 */
/**
 * 解析菜单栏的可见顶级菜单
 *
 * 返回值是「允许显示的菜单 id」；null 表示不限制（全部显示），空数组表示
 * 一条都不显示。集中成函数是为了让渲染进程与主进程使用同一套判断，
 * 避免自绘菜单栏和系统菜单栏显示成两套结构。
 */
export function resolveVisibleMenuIds(menuBar?: ScenarioMenuBarConfig): ScenarioMenuId[] | null {
  if (!menuBar) return null
  if (menuBar.hide === true) return []
  if (!menuBar.items) return null
  // 去重并保持声明顺序，避免场景重复书写导致菜单排列错乱
  return [...new Set(menuBar.items)]
}

export function resolveUserMenuPlacement(
  chrome?: ScenarioChromeConfig,
): 'rail' | 'titlebar' {
  if (chrome?.userMenuPlacement) return chrome.userMenuPlacement
  return chrome?.hideNavRail === true ? 'titlebar' : 'rail'
}

export interface ScenarioUI {
  layout: UILayout
  panels: PanelDescriptor[]
  sidebarItems: SidebarItemDescriptor[]
  statusBarItems: StatusBarItemDescriptor[]
  welcomeComponent?: string
  onboardingComponent?: string
  defaultSidePanel?: string
  wideModeHidesChat?: boolean
  welcomeSuggestions?: WelcomeSuggestionItem[]
  welcomeTitle?: WelcomeTitleConfig
  widgetCards?: ScenarioWidgetCardContribution[]

  /**
   * 主区域组件
   *
   * 声明后主内容区在没有文件时渲染该组件，替代通用的数据看板。
   * 未声明时回退到客户端内置的兼容映射与通用看板。
   */
  primaryView?: PrimaryViewDescriptor

  /**
   * 外壳元素显隐
   *
   * 控制宿主通用入口（新建任务、场景工具、工作空间选择器、语音对话等）的显示，
   * 场景可据此把工作区收敛成自己的一套导航与操作入口。
   */
  chrome?: ScenarioChromeConfig

  /**
   * 外壳放权档位
   *
   * - chrome  ：宿主排壳，场景用 chrome.hideXxx 逐个关元素（缺省）
   * - regions ：场景摆位，宿主提供内容
   * - full    ：场景接管整壳，只保留 scene-switcher / window-controls /
   *             drag-region 三项不可移除的部件
   *
   * 缺省按现状推断：声明了 regions 视为 'regions'，否则 'chrome'。
   */
  shellMode?: ScenarioShellMode

  /**
   * 外壳区域树覆盖
   *
   * 声明后整棵外壳布局由场景决定，而非 layout 预设：槽位（rail / titlebar /
   * sidebar / main / statusbar）可以重新排列、嵌套、按比例分栏。未声明时使用
   * layout 预设生成的默认结构。
   *
   * 约束（违反时整棵树被拒绝并回退宿主默认布局）：
   * - 每个槽位 / 每个部件最多引用一次，挂载两份会让会话流与编辑器状态各走一套
   * - 槽位只能引用上面五个外壳槽位，chat / editor 归主内容区自己管理
   * - 部件节点（part）与占位节点（spacer）需要 regionsSchemaVersion 2
   * - 嵌套深度：full 档位 12 层，其余档位 8 层；ratio 长度需与子节点数量一致
   * - full 档位必须存在保留集三项，且 rail 缺省时要提供可达的面板入口
   */
  regions?: RegionNode

  /**
   * regions 契约版本
   *
   * 场景声明自己按哪一版契约编写。客户端在支持的版本范围内取最高兼容版本，
   * 高于自身支持的版本时整棵树被忽略并回退默认布局，避免新场景在老客户端上渲染成乱版。
   *
   * 缺省视为 1；升到 2 才允许 part / spacer 节点，任何 shellMode 都可用。
   */
  regionsSchemaVersion?: number

  /**
   * 无人值守执行
   *
   * 场景内的 AI 承担的是「把一个产物做出来」的整段动作（原型工坊画页面、
   * 报表工坊出报表），中途为每一次工具调用弹一次确认，等于让用户守着看它跑。
   * 声明为 true 后，活跃场景内的工具调用一律放行，不再逐次询问。
   *
   * 只豁免「是否允许调用」这一层：ask_user 这类主动提问仍然照常等待用户选择，
   * 场景会话边界（sessionScope.allowedTools）也照常生效 —— 放开的是询问频次，
   * 不是工具范围。
   */
  unattended?: boolean
}

// ============================================
// 场景卡片定义
// ============================================

/**
 * 场景工作台卡片贡献
 *
 * 场景可在仪表盘展示数据卡片，支持按需刷新。
 * 卡片 id 格式建议："<scenarioId>:<cardName>"，如 "code-reviewer:stats"
 */
export interface ScenarioWidgetCardContribution {
  /** 卡片唯一 id，如 "code-reviewer:stats" */
  id: string
  /** lucide 图标名（通过 IconMap 解析） */
  icon: string
  /** 英文标题 */
  label: string
  /** 中文标题 */
  labelZh: string
  /** 英文描述（卡片底部显示） */
  description?: string
  /** 中文描述（卡片底部显示） */
  descriptionZh?: string
  /**
   * 刷新优先级分层：
   * - 'core'：高频刷新（15s），适用于核心数据卡片
   * - 'enhanced'：低频刷新（60s），适用于一般数据卡片
   * - 默认 'enhanced'
   */
  tier?: 'core' | 'enhanced'
  /**
   * 组件键名（对应 getComponents() 返回的 key）。
   * 组件签名：({ data, loading, onRefresh }: ScenarioWidgetCardPreviewProps) => ReactNode
   */
  previewComponent: string
}

/**
 * 场景卡片预览组件 Props
 */
export interface ScenarioWidgetCardPreviewProps {
  /** 卡片数据 */
  data: Record<string, unknown> | null
  /** 是否正在加载 */
  loading: boolean
  /** 手动刷新回调 */
  onRefresh: () => void
}

// ============================================
// 数据源定义
// ============================================

export interface DataSourceDescriptor {
  id: string
  type: 'filesystem' | 'database' | 'api' | 'knowledge-base' | 'media' | 'custom'
  label: string
  labelZh: string
  config: Record<string, unknown>
  requiresAuth?: boolean
}

export interface ScenarioDataSources {
  workspace: boolean
  customSources?: DataSourceDescriptor[]
}

// ============================================
// 场景插件接口
// ============================================

export interface ScenarioPlugin {
  id: string
  name: string
  nameZh: string
  icon: string
  description: string
  descriptionZh: string
  version: string
  author: string
  category: ScenarioCategory
  tags: string[]

  identity: ScenarioIdentity
  capabilities: ScenarioCapabilities
  ui: ScenarioUI
  dataSources: ScenarioDataSources

  /**
   * 会话边界：限定 AI 只服务本场景的内容
   *
   * 未声明时保持通用助手行为。
   */
  sessionScope?: ScenarioSessionScope

  isDefault?: boolean
  isBuiltin?: boolean
  requiresWorkspace?: boolean

  hasSettings?: boolean
  settingsComponent?: string
  source?: 'builtin' | 'marketplace' | 'local' | 'url'
  sourceUrl?: string
  /**
   * 来源市场条目 ID
   *
   * 场景包里的 config.id 可以与市场条目 ID 不同，安装后必须把这个对应关系带上，
   * 否则市场页无法判断「已安装」，更新检查也查不到新版本。
   */
  marketplaceId?: string
  installSize?: string
  changelog?: string

  onActivate?: (context: ScenarioContext) => Promise<void>
  onDeactivate?: () => Promise<void>

  /**
   * 动态上下文提供器：构建系统提示词时调用，返回场景专属的实时上下文（Markdown 片段）。
   *
   * 适用场景：场景在运行时持有需要 AI 感知的实时状态（如当前选中项目、当前打开的资源等），
   * 通过此回调注入到系统提示词，避免 AI 每次都要先调用工具才能获取上下文。
   *
   * 返回 null 表示无动态上下文（不注入任何内容）。
   * 抛错时由调用方捕获并降级为不注入，不影响主流程。
   */
  getDynamicContext?: () => Promise<string | null>
}

export type ScenarioCategory =
  | 'development'
  | 'data'
  | 'creative'
  | 'productivity'
  | 'education'
  | 'automation'
  | 'research'
  | 'communication'
  | 'entertainment'
  | 'business'
  | 'health'
  | 'finance'
  | 'legal'
  | 'marketing'
  | 'energy'
  | 'custom'

// ============================================
// 场景上下文
// ============================================

export interface ScenarioContext {
  scenarioId: string
  workspacePath: string | null
  setScenarioState: (key: string, value: unknown) => void
  getScenarioState: (key: string) => unknown
}

// ============================================
// 场景注册表
// ============================================

export type SerializableScenario = Omit<ScenarioPlugin, 'onActivate' | 'onDeactivate' | 'getDynamicContext'>

const CUSTOM_SCENARIOS_STORAGE_KEY = BRAND.storageKeys.customScenarios
const UNINSTALLED_BUILTIN_KEY = BRAND.storageKeys.uninstalledBuiltin

export class ScenarioRegistry {
  private scenarios = new Map<string, ScenarioPlugin>()
  private activeScenarioId: string | null = null
  private listeners = new Set<(scenarioId: string) => void>()
  private uninstallListeners = new Set<(scenarioId: string) => void>()
  private uninstalledBuiltinIds = new Set<string>()

  constructor() {
    this.loadUninstalledBuiltinList()
  }

  private loadUninstalledBuiltinList(): void {
    try {
      const raw = StorageService.get<string[]>(UNINSTALLED_BUILTIN_KEY)
      if (raw) {
        const ids = raw
        for (const id of ids) {
          this.uninstalledBuiltinIds.add(id)
        }
      }
    } catch {
      // ignore
    }
  }

  private persistUninstalledBuiltinList(): void {
    try {
      StorageService.set(UNINSTALLED_BUILTIN_KEY, [...this.uninstalledBuiltinIds])
    } catch {
      // ignore
    }
  }

  isUninstalledBuiltin(scenarioId: string): boolean {
    return this.uninstalledBuiltinIds.has(scenarioId)
  }

  reinstallBuiltin(scenarioId: string): void {
    this.uninstalledBuiltinIds.delete(scenarioId)
    this.persistUninstalledBuiltinList()
  }

  register(scenario: ScenarioPlugin): void {
    this.scenarios.set(scenario.id, scenario)
  }

  unregister(scenarioId: string): boolean {
    const deleted = this.scenarios.delete(scenarioId)
    if (deleted) {
      this.persistCustomScenarios()
    }
    return deleted
  }

  get(scenarioId: string): ScenarioPlugin | undefined {
    return this.scenarios.get(scenarioId)
  }

  getAll(): ScenarioPlugin[] {
    return Array.from(this.scenarios.values())
  }

  getInstalled(): ScenarioPlugin[] {
    return this.getAll()
  }

  getByCategory(category: ScenarioCategory): ScenarioPlugin[] {
    return this.getAll().filter(s => s.category === category)
  }

  getDefault(): ScenarioPlugin {
    const def = this.getAll().find(s => s.isDefault)
    if (def) return def
    const first = this.getAll()[0]
    if (first) return first
    throw new Error('No scenarios registered')
  }

  getActive(): ScenarioPlugin | undefined {
    if (!this.activeScenarioId) return undefined
    return this.scenarios.get(this.activeScenarioId)
  }

  getActiveId(): string | null {
    return this.activeScenarioId
  }

  setActive(scenarioId: string): boolean {
    const scenario = this.scenarios.get(scenarioId)
    if (!scenario) return false
    this.activeScenarioId = scenarioId
    this.notifyListeners(scenarioId)
    return true
  }

  onActiveChange(listener: (scenarioId: string) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  onUninstall(listener: (scenarioId: string) => void): () => void {
    this.uninstallListeners.add(listener)
    return () => this.uninstallListeners.delete(listener)
  }

  private notifyListeners(scenarioId: string): void {
    for (const listener of this.listeners) {
      try {
        listener(scenarioId)
      } catch {
        // ignore listener errors
      }
    }
  }

  private notifyUninstallListeners(scenarioId: string): void {
    for (const listener of this.uninstallListeners) {
      try {
        listener(scenarioId)
      } catch {
        // ignore listener errors
      }
    }
  }

  has(scenarioId: string): boolean {
    return this.scenarios.has(scenarioId)
  }

  isBuiltin(scenarioId: string): boolean {
    const scenario = this.scenarios.get(scenarioId)
    return scenario?.isBuiltin === true
  }

  isInstalled(scenarioId: string): boolean {
    return this.scenarios.has(scenarioId)
  }

  hasSettings(scenarioId: string): boolean {
    const scenario = this.scenarios.get(scenarioId)
    return scenario?.hasSettings === true
  }

  getInstalledCount(): number {
    return this.scenarios.size
  }

  getBuiltinCount(): number {
    return this.getAll().filter(s => s.isBuiltin).length
  }

  getNonBuiltinCount(): number {
    return this.getAll().filter(s => !s.isBuiltin).length
  }

  registerAndPersist(scenario: ScenarioPlugin): void {
    this.scenarios.set(scenario.id, scenario)
    this.persistCustomScenarios()
  }

  async uninstallScenario(scenarioId: string): Promise<boolean> {
    const scenario = this.scenarios.get(scenarioId)
    if (!scenario) return false
    if (scenarioId === this.activeScenarioId) {
      const defaultScenario = this.getDefault()
      this.setActive(defaultScenario.id)
    }
    const deleted = this.scenarios.delete(scenarioId)
    if (deleted) {
      if (scenario.isBuiltin) {
        this.uninstalledBuiltinIds.add(scenarioId)
        this.persistUninstalledBuiltinList()
      } else {
        this.persistCustomScenarios()
      }
      this.notifyUninstallListeners(scenarioId)
    }
    return deleted
  }

  updateScenario(scenarioId: string, updates: Partial<ScenarioPlugin>): boolean {
    const scenario = this.scenarios.get(scenarioId)
    if (!scenario) return false
    Object.assign(scenario, updates)
    this.persistCustomScenarios()
    return true
  }

  persistCustomScenarios(): void {
    try {
      const customScenarios: SerializableScenario[] = []
      for (const [_id, scenario] of this.scenarios) {
        if (!scenario.isBuiltin) {
          const { onActivate, onDeactivate, ...serializable } = scenario
          customScenarios.push(serializable)
        }
      }
      StorageService.set(CUSTOM_SCENARIOS_STORAGE_KEY, customScenarios)
    } catch {
      // ignore storage errors
    }
  }

  loadCustomScenarios(): number {
    try {
      const raw = StorageService.get<SerializableScenario[]>(CUSTOM_SCENARIOS_STORAGE_KEY)
      if (!raw) return 0

      const customScenarios = raw
      let loaded = 0
      for (const data of customScenarios) {
        if (!this.scenarios.has(data.id)) {
          const scenario: ScenarioPlugin = {
            ...data,
            tags: data.tags || [],
            identity: data.identity || { systemPrompt: '', securityRules: '', conventions: '', workflow: '' },
            capabilities: data.capabilities || { toolPacks: [], modes: [], contextTypes: [], outputFormats: [] },
            ui: data.ui || { layout: 'chat-centric' as UILayout, panels: [], sidebarItems: [], statusBarItems: [] },
            dataSources: data.dataSources || { workspace: false },
          }
          this.scenarios.set(scenario.id, scenario)
          loaded++
        }
      }
      return loaded
    } catch {
      return 0
    }
  }
}

export const scenarioRegistry = new ScenarioRegistry()
