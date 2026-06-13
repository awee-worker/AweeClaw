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
 * - 向后兼容：默认代码编辑器场景保持现有布局
 */

import type { ScenarioPlugin, UILayout, PanelDescriptor } from '@shared/protocols/scenario'
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
  panels: PanelDescriptor[]
  sidebarItems: ScenarioPlugin['ui']['sidebarItems']
  statusBarItems: ScenarioPlugin['ui']['statusBarItems']
}

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

function buildEditorCentricConfig(scenario: ScenarioPlugin): LayoutConfig {
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
    panels: scenario.ui.panels,
    sidebarItems: scenario.ui.sidebarItems,
    statusBarItems: scenario.ui.statusBarItems,
  }
}

function buildChatCentricConfig(scenario: ScenarioPlugin): LayoutConfig {
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
    panels: scenario.ui.panels,
    sidebarItems: scenario.ui.sidebarItems,
    statusBarItems: scenario.ui.statusBarItems,
  }
}

function buildDashboardCentricConfig(scenario: ScenarioPlugin): LayoutConfig {
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
    panels: scenario.ui.panels,
    sidebarItems: scenario.ui.sidebarItems,
    statusBarItems: scenario.ui.statusBarItems,
  }
}

function buildAnalyticsCentricConfig(scenario: ScenarioPlugin): LayoutConfig {
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
    panels: scenario.ui.panels,
    sidebarItems: scenario.ui.sidebarItems,
    statusBarItems: scenario.ui.statusBarItems,
  }
}

function buildCanvasCentricConfig(scenario: ScenarioPlugin): LayoutConfig {
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
    panels: scenario.ui.panels,
    sidebarItems: scenario.ui.sidebarItems,
    statusBarItems: scenario.ui.statusBarItems,
  }
}

function buildFullscreenChatConfig(scenario: ScenarioPlugin): LayoutConfig {
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
    panels: scenario.ui.panels,
    sidebarItems: scenario.ui.sidebarItems,
    statusBarItems: scenario.ui.statusBarItems,
  }
}

function buildMinimalConfig(scenario: ScenarioPlugin): LayoutConfig {
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
    panels: scenario.ui.panels,
    sidebarItems: scenario.ui.sidebarItems,
    statusBarItems: scenario.ui.statusBarItems,
  }
}

function buildResearchCentricConfig(scenario: ScenarioPlugin): LayoutConfig {
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
    panels: scenario.ui.panels,
    sidebarItems: scenario.ui.sidebarItems,
    statusBarItems: scenario.ui.statusBarItems,
  }
}

function buildFocusCentricConfig(scenario: ScenarioPlugin): LayoutConfig {
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
    panels: scenario.ui.panels,
    sidebarItems: scenario.ui.sidebarItems,
    statusBarItems: scenario.ui.statusBarItems,
  }
}

function buildSplitCentricConfig(scenario: ScenarioPlugin): LayoutConfig {
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
    panels: scenario.ui.panels,
    sidebarItems: scenario.ui.sidebarItems,
    statusBarItems: scenario.ui.statusBarItems,
  }
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

  constructor(ttlMs = DEFAULT_CACHE_TTL_MS) {
    this.ttlMs = ttlMs
    // 启动定时清理
    this.startCleanupTimer()
  }

  private startCleanupTimer(): void {
    setInterval(() => {
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

  getLayoutConfig(scenario: ScenarioPlugin): LayoutConfig {
    const cacheKey = `${scenario.id}:${scenario.ui.layout}`
    const cached = this.cache.get(cacheKey)

    if (cached && Date.now() - cached.createdAt <= this.ttlMs) {
      return cached.config
    }

    let config: LayoutConfig

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

    this.cache.set(cacheKey, { config, createdAt: Date.now() })
    return config
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
