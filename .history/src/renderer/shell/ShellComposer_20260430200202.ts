/**
 * ShellComposer - UI 壳层组合器
 *
 * 根据当前活跃场景的 UI 配置，动态组合应用布局。
 * 支持多种布局模式：editor-centric / chat-centric / canvas-centric / dashboard-centric / minimal
 *
 * 设计原则：
 * - 场景决定布局：每个场景声明自己的 UI 配置
 * - 组件懒加载：面板组件按需加载
 * - 渐进增强：布局切换时保留用户数据
 * - 向后兼容：默认代码编辑器场景保持现有布局
 */

import type { ScenarioPlugin, UILayout, PanelDescriptor } from '@shared/types/scenario'
import { scenarioRegistry } from '@shared/config/scenarios'

// ============================================
// 布局策略接口
// ============================================

export interface LayoutStrategy {
  layout: UILayout
  getLayoutClasses(): {
    container: string
    primary: string
    secondary: string
    auxiliary: string
  }
  getPanelOrder(): PanelDescriptor[]
  shouldShowActivityBar(): boolean
  shouldShowStatusBar(): boolean
  getDefaultPanelVisibility(): Record<string, boolean>
}

// ============================================
// 布局策略实现
// ============================================

class EditorCentricLayout implements LayoutStrategy {
  layout: UILayout = 'editor-centric'
  private scenario: ScenarioPlugin | undefined

  constructor(scenario?: ScenarioPlugin) {
    this.scenario = scenario
  }

  getLayoutClasses() {
    return {
      container: 'flex-1 flex overflow-hidden',
      primary: 'flex-1 flex flex-col min-w-0 overflow-hidden',
      secondary: 'flex-shrink-0 relative min-w-[220px]',
      auxiliary: 'flex-shrink-0 relative border-l border-border/30 z-20 bg-background',
    }
  }

  getPanelOrder(): PanelDescriptor[] {
    return this.scenario?.ui.panels || [
      { id: 'editor', component: 'Editor', region: 'primary', defaultVisible: true, resizable: true },
      { id: 'sidebar', component: 'Sidebar', region: 'secondary', defaultVisible: true, resizable: true },
      { id: 'chat', component: 'ChatPanel', region: 'auxiliary', defaultVisible: true, resizable: true },
    ]
  }

  shouldShowActivityBar() { return true }
  shouldShowStatusBar() { return true }

  getDefaultPanelVisibility(): Record<string, boolean> {
    const visibility: Record<string, boolean> = {}
    for (const panel of this.getPanelOrder()) {
      visibility[panel.id] = panel.defaultVisible !== false
    }
    return visibility
  }
}

class ChatCentricLayout implements LayoutStrategy {
  layout: UILayout = 'chat-centric'
  private scenario: ScenarioPlugin | undefined

  constructor(scenario?: ScenarioPlugin) {
    this.scenario = scenario
  }

  getLayoutClasses() {
    return {
      container: 'flex-1 flex overflow-hidden',
      primary: 'flex-1 min-w-0 bg-background',
      secondary: 'hidden',
      auxiliary: 'hidden',
    }
  }

  getPanelOrder(): PanelDescriptor[] {
    return this.scenario?.ui.panels || [
      { id: 'chat', component: 'ChatPanel', region: 'primary', defaultVisible: true, resizable: false },
    ]
  }

  shouldShowActivityBar() { return false }
  shouldShowStatusBar() { return true }

  getDefaultPanelVisibility(): Record<string, boolean> {
    return { chat: true }
  }
}

class CanvasCentricLayout implements LayoutStrategy {
  layout: UILayout = 'canvas-centric'
  private scenario: ScenarioPlugin | undefined

  constructor(scenario?: ScenarioPlugin) {
    this.scenario = scenario
  }

  getLayoutClasses() {
    return {
      container: 'flex-1 flex overflow-hidden',
      primary: 'flex-1 min-w-0 bg-background',
      secondary: 'w-[300px] flex-shrink-0 border-r border-border/30',
      auxiliary: 'flex-shrink-0 relative border-l border-border/30 z-20 bg-background',
    }
  }

  getPanelOrder(): PanelDescriptor[] {
    return this.scenario?.ui.panels || [
      { id: 'canvas', component: 'CanvasPanel', region: 'primary', defaultVisible: true, resizable: true },
      { id: 'tools', component: 'ToolPanel', region: 'secondary', defaultVisible: true, resizable: true },
      { id: 'chat', component: 'ChatPanel', region: 'auxiliary', defaultVisible: true, resizable: true },
    ]
  }

  shouldShowActivityBar() { return true }
  shouldShowStatusBar() { return true }

  getDefaultPanelVisibility(): Record<string, boolean> {
    const visibility: Record<string, boolean> = {}
    for (const panel of this.getPanelOrder()) {
      visibility[panel.id] = panel.defaultVisible !== false
    }
    return visibility
  }
}

class DashboardCentricLayout implements LayoutStrategy {
  layout: UILayout = 'dashboard-centric'
  private scenario: ScenarioPlugin | undefined

  constructor(scenario?: ScenarioPlugin) {
    this.scenario = scenario
  }

  getLayoutClasses() {
    return {
      container: 'flex-1 flex overflow-hidden',
      primary: 'flex-1 min-w-0 bg-background p-4',
      secondary: 'w-[280px] flex-shrink-0 border-r border-border/30',
      auxiliary: 'flex-shrink-0 relative border-l border-border/30 z-20 bg-background',
    }
  }

  getPanelOrder(): PanelDescriptor[] {
    return this.scenario?.ui.panels || [
      { id: 'dashboard', component: 'DashboardPanel', region: 'primary', defaultVisible: true, resizable: true },
      { id: 'sidebar', component: 'Sidebar', region: 'secondary', defaultVisible: true, resizable: true },
      { id: 'chat', component: 'ChatPanel', region: 'auxiliary', defaultVisible: true, resizable: true },
    ]
  }

  shouldShowActivityBar() { return true }
  shouldShowStatusBar() { return true }

  getDefaultPanelVisibility(): Record<string, boolean> {
    const visibility: Record<string, boolean> = {}
    for (const panel of this.getPanelOrder()) {
      visibility[panel.id] = panel.defaultVisible !== false
    }
    return visibility
  }
}

class MinimalLayout implements LayoutStrategy {
  layout: UILayout = 'minimal'
  private scenario: ScenarioPlugin | undefined

  constructor(scenario?: ScenarioPlugin) {
    this.scenario = scenario
  }

  getLayoutClasses() {
    return {
      container: 'flex-1 flex overflow-hidden',
      primary: 'flex-1 min-w-0 bg-background',
      secondary: 'hidden',
      auxiliary: 'hidden',
    }
  }

  getPanelOrder(): PanelDescriptor[] {
    return this.scenario?.ui.panels || [
      { id: 'chat', component: 'ChatPanel', region: 'primary', defaultVisible: true, resizable: false },
    ]
  }

  shouldShowActivityBar() { return false }
  shouldShowStatusBar() { return false }

  getDefaultPanelVisibility(): Record<string, boolean> {
    return { chat: true }
  }
}

// ============================================
// ShellComposer 主类
// ============================================

class ShellComposerClass {
  private strategyCache = new Map<UILayout, LayoutStrategy>()

  getStrategy(scenario?: ScenarioPlugin): LayoutStrategy {
    const layout = scenario?.ui.layout || 'editor-centric'
    const cacheKey = layout

    if (this.strategyCache.has(cacheKey)) {
      return this.strategyCache.get(cacheKey)!
    }

    let strategy: LayoutStrategy

    switch (layout) {
      case 'editor-centric':
        strategy = new EditorCentricLayout(scenario)
        break
      case 'chat-centric':
        strategy = new ChatCentricLayout(scenario)
        break
      case 'canvas-centric':
        strategy = new CanvasCentricLayout(scenario)
        break
      case 'dashboard-centric':
        strategy = new DashboardCentricLayout(scenario)
        break
      case 'minimal':
        strategy = new MinimalLayout(scenario)
        break
      default:
        strategy = new EditorCentricLayout(scenario)
    }

    this.strategyCache.set(cacheKey, strategy)
    return strategy
  }

  getCurrentStrategy(): LayoutStrategy {
    const scenario = scenarioRegistry.getActive()
    return this.getStrategy(scenario)
  }

  /**
   * 获取当前场景的侧边栏项目
   */
  getSidebarItems() {
    const scenario = scenarioRegistry.getActive()
    return scenario?.ui.sidebarItems || []
  }

  /**
   * 获取当前场景的状态栏项目
   */
  getStatusBarItems() {
    const scenario = scenarioRegistry.getActive()
    return scenario?.ui.statusBarItems || []
  }

  /**
   * 清除策略缓存（场景切换时调用）
   */
  clearCache(): void {
    this.strategyCache.clear()
  }
}

export const shellComposer = new ShellComposerClass()
