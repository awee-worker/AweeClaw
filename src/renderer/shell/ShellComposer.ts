/**
 * ShellComposer - UI 壳层组合器
 *
 * 根据当前活跃场景的 UI 配置，动态生成布局描述。
 * 输出一个 LayoutConfig 对象，由 App.tsx 消费来渲染界面。
 *
 * 设计原则：
 * - 场景驱动布局：每个场景声明自己的 UI 配置
 * - 声明式输出：输出纯数据描述，不含 React 组件
 * - 细粒度控制：面板可见性、尺寸、顺序都可由场景定义
 * - 向后兼容：默认开发助手场景保持现有布局
 */

import type { ScenarioPlugin, UILayout, PanelDescriptor, PrimaryViewDescriptor } from '@shared/protocols/scenario'
import type { RegionNode, ScenarioShellMode } from '@shared/protocols/scenario-regions'
import { REGIONS_SCHEMA_VERSION, SHELL_SLOTS, validateRegionTree } from '@shared/protocols/scenario-regions'
import { logger } from '@shared/toolkit/LogEngine'

// ============================================
// 布局配置输出
// ============================================

export interface LayoutConfig {
  layout: UILayout
  showActivityBar: boolean
  showStatusBar: boolean
  showSidebar: boolean
  showEditor: boolean
  showChat: boolean
  showTerminal: boolean
  sidebarPosition: 'left' | 'hidden'
  chatPosition: 'right' | 'primary' | 'hidden'
  editorPosition: 'primary' | 'hidden'
  chatExpanded: boolean
  sidebarDefaultWidth: number
  sidebarMinWidth: number
  chatDefaultWidth: number
  wideModePanelIds: string[]
  wideModeHidesChat: boolean
  /** 声明了 hideChat 的面板 ID 列表，切换到这些面板时自动隐藏聊天（用户可手动切换显示） */
  autoHideChatPanelIds: string[]
  /** 声明了 keepChat 的面板 ID 列表，这些面板无论 wideModeHidesChat 如何都保留聊天（面板与对话并列） */
  keepChatPanelIds: string[]
  panels: PanelDescriptor[]
  sidebarItems: ScenarioPlugin['ui']['sidebarItems']
  statusBarItems: ScenarioPlugin['ui']['statusBarItems']

  /** 当前场景 ID：主区域组件按它解析 */
  scenarioId: string
  /** 主区域组件声明（含历史兼容映射），undefined 表示使用客户端通用看板 */
  primaryView?: PrimaryViewDescriptor
  /**
   * 外壳放权档位。
   *
   * 'full' 时场景接管整壳，客户端只保证保留集部件与全屏页；其余两档沿用
   * 现有的 slot / MainContentArea 路径。
   */
  shellMode: ScenarioShellMode
  /** 场景声明的外壳区域树（已校验），undefined 表示使用默认结构 */
  regions?: RegionNode
}

/**
 * build* 函数的返回类型。
 *
 * scenarioId / primaryView / shellMode / regions 与具体预设无关，由 getLayoutConfig
 * 在 switch 之后统一注入，避免十个预设函数各抄一遍、漏一个就静默失效。
 */
export type BaseLayoutConfig = Omit<
  LayoutConfig,
  'scenarioId' | 'primaryView' | 'shellMode' | 'regions'
>

// ============================================
// 布局策略
// ============================================

function extractWideModePanelIds(scenario: ScenarioPlugin): string[] {
  if (!scenario.ui.sidebarItems) return []
  return scenario.ui.sidebarItems.filter(item => item.wideMode).map(item => item.id)
}

function getWideModeHidesChat(scenario: ScenarioPlugin): boolean {
  return scenario.ui.wideModeHidesChat !== false
}

/** 提取声明了 hideChat 的面板 ID（切换到这些面板时自动隐藏聊天，用户可手动切换显示） */
function extractAutoHideChatPanelIds(scenario: ScenarioPlugin): string[] {
  if (!scenario.ui.sidebarItems) return []
  return scenario.ui.sidebarItems.filter(item => item.hideChat).map(item => item.id)
}

/**
 * 内置的「必须与对话并列」面板。
 *
 * 知识库是主应用内置的参考资料面板，"边查资料边提问"是它的固有用法，
 * 与场景无关，因此在这里统一兜底，已安装的场景包无需逐个声明。
 * 场景若要让其他面板也保留对话，用 sidebarItems[].keepChat 声明。
 */
const BUILTIN_KEEP_CHAT_PANEL_IDS = ['knowledge']

/** 提取需要强制保留聊天的面板 ID（内置规则 + 场景声明） */
function extractKeepChatPanelIds(scenario: ScenarioPlugin): string[] {
  const declared = scenario.ui.sidebarItems?.filter(item => item.keepChat).map(item => item.id) ?? []
  return [...new Set([...BUILTIN_KEEP_CHAT_PANEL_IDS, ...declared])]
}

function buildEditorCentricConfig(scenario: ScenarioPlugin): BaseLayoutConfig {
  return {
    layout: 'editor-centric',
    showActivityBar: true,
    showStatusBar: false,
    showSidebar: true,
    showEditor: true,
    showChat: true,
    showTerminal: true,
    sidebarPosition: 'left',
    chatPosition: 'right',
    editorPosition: 'primary',
    chatExpanded: false,
    sidebarDefaultWidth: 175,
    sidebarMinWidth: 170,
    chatDefaultWidth: 450,
    wideModePanelIds: extractWideModePanelIds(scenario),
    wideModeHidesChat: getWideModeHidesChat(scenario),
    autoHideChatPanelIds: extractAutoHideChatPanelIds(scenario),
    keepChatPanelIds: extractKeepChatPanelIds(scenario),
    panels: scenario.ui.panels,
    sidebarItems: scenario.ui.sidebarItems,
    statusBarItems: scenario.ui.statusBarItems,
  }
}

function buildChatCentricConfig(scenario: ScenarioPlugin): BaseLayoutConfig {
  const hasSidebarItems = scenario.ui.sidebarItems && scenario.ui.sidebarItems.length > 0
  return {
    layout: 'chat-centric',
    showActivityBar: true,
    showStatusBar: false,
    showSidebar: hasSidebarItems,
    showEditor: false,
    showChat: true,
    showTerminal: false,
    sidebarPosition: hasSidebarItems ? 'left' : 'hidden',
    chatPosition: 'primary',
    editorPosition: 'hidden',
    chatExpanded: true,
    sidebarDefaultWidth: hasSidebarItems ? 175 : 0,
    sidebarMinWidth: hasSidebarItems ? 170 : 0,
    chatDefaultWidth: 0,
    wideModePanelIds: extractWideModePanelIds(scenario),
    wideModeHidesChat: getWideModeHidesChat(scenario),
    autoHideChatPanelIds: extractAutoHideChatPanelIds(scenario),
    keepChatPanelIds: extractKeepChatPanelIds(scenario),
    panels: scenario.ui.panels,
    sidebarItems: scenario.ui.sidebarItems,
    statusBarItems: scenario.ui.statusBarItems,
  }
}

function buildDashboardCentricConfig(scenario: ScenarioPlugin): BaseLayoutConfig {
  return {
    layout: 'dashboard-centric',
    showActivityBar: true,
    showStatusBar: false,
    showSidebar: true,
    showEditor: false,
    showChat: true,
    showTerminal: false,
    sidebarPosition: 'left',
    chatPosition: 'right',
    editorPosition: 'hidden',
    chatExpanded: false,
    sidebarDefaultWidth: 280,
    sidebarMinWidth: 170,
    chatDefaultWidth: 450,
    wideModePanelIds: extractWideModePanelIds(scenario),
    wideModeHidesChat: getWideModeHidesChat(scenario),
    autoHideChatPanelIds: extractAutoHideChatPanelIds(scenario),
    keepChatPanelIds: extractKeepChatPanelIds(scenario),
    panels: scenario.ui.panels,
    sidebarItems: scenario.ui.sidebarItems,
    statusBarItems: scenario.ui.statusBarItems,
  }
}

function buildAnalyticsCentricConfig(scenario: ScenarioPlugin): BaseLayoutConfig {
  return {
    layout: 'analytics-centric',
    showActivityBar: true,
    showStatusBar: false,
    showSidebar: true,
    showEditor: false,
    showChat: true,
    showTerminal: false,
    sidebarPosition: 'left',
    chatPosition: 'right',
    editorPosition: 'hidden',
    chatExpanded: false,
    sidebarDefaultWidth: 280,
    sidebarMinWidth: 170,
    chatDefaultWidth: 500,
    wideModePanelIds: extractWideModePanelIds(scenario),
    wideModeHidesChat: getWideModeHidesChat(scenario),
    autoHideChatPanelIds: extractAutoHideChatPanelIds(scenario),
    keepChatPanelIds: extractKeepChatPanelIds(scenario),
    panels: scenario.ui.panels,
    sidebarItems: scenario.ui.sidebarItems,
    statusBarItems: scenario.ui.statusBarItems,
  }
}

function buildCanvasCentricConfig(scenario: ScenarioPlugin): BaseLayoutConfig {
  return {
    layout: 'canvas-centric',
    showActivityBar: true,
    showStatusBar: false,
    showSidebar: true,
    showEditor: false,
    showChat: true,
    showTerminal: false,
    sidebarPosition: 'left',
    chatPosition: 'right',
    editorPosition: 'hidden',
    chatExpanded: false,
    sidebarDefaultWidth: 300,
    sidebarMinWidth: 220,
    chatDefaultWidth: 400,
    wideModePanelIds: extractWideModePanelIds(scenario),
    wideModeHidesChat: getWideModeHidesChat(scenario),
    autoHideChatPanelIds: extractAutoHideChatPanelIds(scenario),
    keepChatPanelIds: extractKeepChatPanelIds(scenario),
    panels: scenario.ui.panels,
    sidebarItems: scenario.ui.sidebarItems,
    statusBarItems: scenario.ui.statusBarItems,
  }
}

function buildFullscreenChatConfig(scenario: ScenarioPlugin): BaseLayoutConfig {
  return {
    layout: 'fullscreen-chat',
    showActivityBar: false,
    showStatusBar: false,
    showSidebar: false,
    showEditor: false,
    showChat: true,
    showTerminal: false,
    sidebarPosition: 'hidden',
    chatPosition: 'primary',
    editorPosition: 'hidden',
    chatExpanded: true,
    sidebarDefaultWidth: 0,
    sidebarMinWidth: 0,
    chatDefaultWidth: 0,
    wideModePanelIds: extractWideModePanelIds(scenario),
    wideModeHidesChat: getWideModeHidesChat(scenario),
    autoHideChatPanelIds: extractAutoHideChatPanelIds(scenario),
    keepChatPanelIds: extractKeepChatPanelIds(scenario),
    panels: scenario.ui.panels,
    sidebarItems: scenario.ui.sidebarItems,
    statusBarItems: scenario.ui.statusBarItems,
  }
}

function buildMinimalConfig(scenario: ScenarioPlugin): BaseLayoutConfig {
  return {
    layout: 'minimal',
    showActivityBar: false,
    showStatusBar: false,
    showSidebar: false,
    showEditor: false,
    showChat: true,
    showTerminal: false,
    sidebarPosition: 'hidden',
    chatPosition: 'primary',
    editorPosition: 'hidden',
    chatExpanded: true,
    sidebarDefaultWidth: 0,
    sidebarMinWidth: 0,
    chatDefaultWidth: 0,
    wideModePanelIds: extractWideModePanelIds(scenario),
    wideModeHidesChat: getWideModeHidesChat(scenario),
    autoHideChatPanelIds: extractAutoHideChatPanelIds(scenario),
    keepChatPanelIds: extractKeepChatPanelIds(scenario),
    panels: scenario.ui.panels,
    sidebarItems: scenario.ui.sidebarItems,
    statusBarItems: scenario.ui.statusBarItems,
  }
}

function buildResearchCentricConfig(scenario: ScenarioPlugin): BaseLayoutConfig {
  const hasSidebarItems = scenario.ui.sidebarItems && scenario.ui.sidebarItems.length > 0
  return {
    layout: 'research-centric',
    showActivityBar: true,
    showStatusBar: false,
    showSidebar: hasSidebarItems,
    showEditor: true,
    showChat: true,
    showTerminal: false,
    sidebarPosition: hasSidebarItems ? 'left' : 'hidden',
    chatPosition: 'right',
    editorPosition: 'primary',
    chatExpanded: false,
    sidebarDefaultWidth: hasSidebarItems ? 300 : 0,
    sidebarMinWidth: hasSidebarItems ? 220 : 0,
    chatDefaultWidth: 420,
    wideModePanelIds: extractWideModePanelIds(scenario),
    wideModeHidesChat: getWideModeHidesChat(scenario),
    autoHideChatPanelIds: extractAutoHideChatPanelIds(scenario),
    keepChatPanelIds: extractKeepChatPanelIds(scenario),
    panels: scenario.ui.panels,
    sidebarItems: scenario.ui.sidebarItems,
    statusBarItems: scenario.ui.statusBarItems,
  }
}

function buildFocusCentricConfig(scenario: ScenarioPlugin): BaseLayoutConfig {
  return {
    layout: 'focus-centric',
    showActivityBar: false,
    showStatusBar: false,
    showSidebar: false,
    showEditor: true,
    showChat: true,
    showTerminal: false,
    sidebarPosition: 'hidden',
    chatPosition: 'right',
    editorPosition: 'primary',
    chatExpanded: false,
    sidebarDefaultWidth: 0,
    sidebarMinWidth: 0,
    chatDefaultWidth: 380,
    wideModePanelIds: extractWideModePanelIds(scenario),
    wideModeHidesChat: getWideModeHidesChat(scenario),
    autoHideChatPanelIds: extractAutoHideChatPanelIds(scenario),
    keepChatPanelIds: extractKeepChatPanelIds(scenario),
    panels: scenario.ui.panels,
    sidebarItems: scenario.ui.sidebarItems,
    statusBarItems: scenario.ui.statusBarItems,
  }
}

function buildSplitCentricConfig(scenario: ScenarioPlugin): BaseLayoutConfig {
  return {
    layout: 'split-centric',
    showActivityBar: true,
    showStatusBar: false,
    showSidebar: true,
    showEditor: true,
    showChat: true,
    showTerminal: true,
    sidebarPosition: 'left',
    chatPosition: 'right',
    editorPosition: 'primary',
    chatExpanded: false,
    sidebarDefaultWidth: 240,
    sidebarMinWidth: 170,
    chatDefaultWidth: 400,
    wideModePanelIds: extractWideModePanelIds(scenario),
    wideModeHidesChat: getWideModeHidesChat(scenario),
    autoHideChatPanelIds: extractAutoHideChatPanelIds(scenario),
    keepChatPanelIds: extractKeepChatPanelIds(scenario),
    panels: scenario.ui.panels,
    sidebarItems: scenario.ui.sidebarItems,
    statusBarItems: scenario.ui.statusBarItems,
  }
}

// ============================================
// 场景 UI 解析
// ============================================

/**
 * 历史兼容：analytics-centric 曾把门店诊断的看板硬编码进主内容区。
 *
 * 那张表只是为了既有场景不掉功能。新场景请用 ui.primaryView 声明主区域组件，
 * 这张表里的条目可以随场景逐步改造逐个删除。
 */
const LEGACY_PRIMARY_VIEWS: Record<string, string> = {
  'store-diagnosis': 'StoreDiagnosisDashboard',
}

/** 解析主区域组件声明：显式声明 > 历史兼容映射 > 无（调用方回退通用看板） */
function resolvePrimaryView(scenario: ScenarioPlugin): PrimaryViewDescriptor | undefined {
  const declared = scenario.ui.primaryView
  if (declared?.component) return declared

  const legacy = LEGACY_PRIMARY_VIEWS[scenario.id]
  if (legacy) return { component: legacy }

  return undefined
}

/**
 * 解析外壳放权档位。
 *
 * 缺省按现状推断：声明了 regions 视为 'regions'，否则 'chrome'。这样老场景
 * 不需要补字段，行为保持不变。
 */
function resolveShellMode(scenario: ScenarioPlugin): ScenarioShellMode {
  const declared = scenario.ui.shellMode
  if (declared === 'chrome' || declared === 'regions' || declared === 'full') return declared
  return scenario.ui.regions ? 'regions' : 'chrome'
}

/**
 * 解析外壳区域树。
 *
 * 场景声明的是外部数据：契约版本超出支持范围、槽位越界、保留件缺失或结构
 * 非法时，整棵树被丢弃并回退宿主默认布局。半信半疑地渲染一棵坏树比不渲染
 * 更糟——用户会看到残缺界面却没有任何提示。
 *
 * 注意降级目标只有宿主默认树，绝不回退到场景自己的 regions：full 档位下那
 * 就是同一棵被拒的树，回退过去还是被拒，结果是白屏而不是降级。
 */
function resolveRegions(
  scenario: ScenarioPlugin,
  shellMode: ScenarioShellMode,
): RegionNode | undefined {
  const regions = scenario.ui.regions
  if (!regions) return undefined

  const declaredVersion = scenario.ui.regionsSchemaVersion ?? 1
  if (declaredVersion > REGIONS_SCHEMA_VERSION) {
    logger.scenario.warn(
      `[ShellComposer] 场景 ${scenario.id} 声明的 regions 契约版本 ${declaredVersion} 高于客户端支持的 ${REGIONS_SCHEMA_VERSION}，回退默认布局`,
    )
    return undefined
  }

  const result = validateRegionTree(regions, {
    allowedSlots: SHELL_SLOTS,
    shellMode,
    regionsSchemaVersion: declaredVersion,
    sidebarItemIds: scenario.ui.sidebarItems?.map((item) => item.id),
  })

  // 未知部件（场景 SDK 比客户端新）不阻断渲染，但必须留下痕迹，
  // 否则开发者只能盲猜「为什么我的部件没出现」
  if (result.warnings.length > 0) {
    logger.scenario.warn(
      `[ShellComposer] 场景 ${scenario.id} 的 regions 存在可忽略的问题：${result.warnings.join('；')}`,
    )
  }

  if (!result.ok) {
    logger.scenario.warn(
      `[ShellComposer] 场景 ${scenario.id} 的 regions 校验未通过，回退宿主默认布局：${result.errors.join('；')}`,
    )
    return undefined
  }

  return regions
}

/**
 * 稳定序列化：对象键排序后再拼接。
 *
 * 缓存 key 需要「配置内容相同则 key 相同」，而 JSON.stringify 依赖键顺序，
 * 同一份配置换个赋值顺序就会得到不同指纹，白白丢掉缓存。
 */
function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'function') return '"[fn]"'
    return JSON.stringify(value) ?? 'null'
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(',')}]`
  }

  const record = value as Record<string, unknown>
  const entries = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
  return `{${entries.join(',')}}`
}

/** djb2 字符串哈希，取 32 位无符号整数的 36 进制串，用作缓存指纹 */
function hashString(input: string): string {
  let hash = 5381
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0
  }
  return (hash >>> 0).toString(36)
}

// ============================================
// 缓存条目（带 TTL）
// ============================================

interface CacheEntry {
  config: LayoutConfig
  createdAt: number
}

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000 // 5 分钟

// ============================================
// ShellComposer 主类
// ============================================

class ShellComposerClass {
  private cache = new Map<string, CacheEntry>()
  private ttlMs: number
  /**
   * 过期缓存清理定时器。
   *
   * 需要持有句柄：此前只调用 setInterval 而不保存返回值，窗口销毁或测试收尾时
   * 无从清除，定时器连同它闭包持有的 cache 会一直留在内存里。
   */
  private cleanupTimer: ReturnType<typeof setInterval> | null = null

  constructor(ttlMs = DEFAULT_CACHE_TTL_MS) {
    this.ttlMs = ttlMs
    // 启动定时清理
    this.startCleanupTimer()
  }

  private startCleanupTimer(): void {
    if (this.cleanupTimer !== null) return
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredEntries()
    }, 60000) // 每分钟清理一次
  }

  private cleanupExpiredEntries(): void {
    const now = Date.now()
    let cleaned = 0
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.createdAt > this.ttlMs) {
        this.cache.delete(key)
        cleaned++
      }
    }
    if (cleaned > 0) {
      logger.cache.debug(`[ShellComposer] Cleaned ${cleaned} expired cache entries`)
    }
  }

  /** 停止清理定时器并清空缓存（窗口销毁 / 测试收尾时调用） */
  dispose(): void {
    if (this.cleanupTimer !== null) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
    this.cache.clear()
  }


  getLayoutConfig(scenario: ScenarioPlugin): LayoutConfig {
    // 缓存 key 取整个 ui 配置的稳定指纹。
    //
    // 此前只拼了 sidebarItems 的 id/wideMode/hideChat：改 panels、statusBarItems、
    // welcomeComponent、primaryView 或 regions 都不会让缓存失效，表现为
    // 「场景更新了，界面还是旧的」，只能靠重装或重启刷出来。
    const cacheKey = `${scenario.id}:${hashString(stableSerialize(scenario.ui))}`
    const cached = this.cache.get(cacheKey)

    if (cached && Date.now() - cached.createdAt <= this.ttlMs) {
      return cached.config
    }

    let config: BaseLayoutConfig

    switch (scenario.ui.layout) {
      case 'editor-centric':
        config = buildEditorCentricConfig(scenario)
        break
      case 'chat-centric':
        config = buildChatCentricConfig(scenario)
        break
      case 'dashboard-centric':
        config = buildDashboardCentricConfig(scenario)
        break
      case 'analytics-centric':
        config = buildAnalyticsCentricConfig(scenario)
        break
      case 'canvas-centric':
        config = buildCanvasCentricConfig(scenario)
        break
      case 'research-centric':
        config = buildResearchCentricConfig(scenario)
        break
      case 'focus-centric':
        config = buildFocusCentricConfig(scenario)
        break
      case 'split-centric':
        config = buildSplitCentricConfig(scenario)
        break
      case 'fullscreen-chat':
        config = buildFullscreenChatConfig(scenario)
        break
      case 'minimal':
        config = buildMinimalConfig(scenario)
        break
      default:
        config = buildEditorCentricConfig(scenario)
    }

    // 与预设无关的字段统一注入，十个预设函数无需各自维护
    const shellMode = resolveShellMode(scenario)
    const fullConfig: LayoutConfig = {
      ...config,
      scenarioId: scenario.id,
      primaryView: resolvePrimaryView(scenario),
      shellMode,
      regions: resolveRegions(scenario, shellMode),
    }

    this.cache.set(cacheKey, { config: fullConfig, createdAt: Date.now() })
    return fullConfig
  }

  clearCache(): void {
    this.cache.clear()
  }

  setCacheTTL(ttlMs: number): void {
    this.ttlMs = ttlMs
  }

  getCacheStats(): { size: number; ttlMs: number } {
    return { size: this.cache.size, ttlMs: this.ttlMs }
  }
}

export const shellComposer = new ShellComposerClass()
