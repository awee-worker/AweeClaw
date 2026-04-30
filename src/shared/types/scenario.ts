/**
 * Scenario Plugin System - 场景插件系统
 *
 * 将 AweeClaw 从代码编辑器扩展为通用 AI 智能体平台。
 * 每个场景定义了身份、能力、UI 布局和数据源的完整配置。
 *
 * 设计原则：
 * - 场景即插件：代码编辑器只是默认场景
 * - 能力声明式：场景声明需要什么工具和上下文
 * - UI 自适应：场景决定主界面布局
 * - 向后兼容：不打开工作区时自动切换到通用助手场景
 */

import type { WorkMode } from './workMode'

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

// ============================================
// 场景能力声明
// ============================================

export interface ScenarioCapabilities {
  toolPacks: string[]
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
}

export interface StatusBarItemDescriptor {
  id: string
  component: string
  position: 'left' | 'right'
  order?: number
}

export interface ScenarioUI {
  layout: UILayout
  panels: PanelDescriptor[]
  sidebarItems: SidebarItemDescriptor[]
  statusBarItems: StatusBarItemDescriptor[]
  welcomeComponent?: string
  onboardingComponent?: string
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

  isDefault?: boolean
  requiresWorkspace?: boolean

  onActivate?: (context: ScenarioContext) => Promise<void>
  onDeactivate?: () => Promise<void>
}

export type ScenarioCategory =
  | 'development'
  | 'data'
  | 'creative'
  | 'productivity'
  | 'education'
  | 'automation'
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

export class ScenarioRegistry {
  private scenarios = new Map<string, ScenarioPlugin>()
  private activeScenarioId: string | null = null
  private listeners = new Set<(scenarioId: string) => void>()

  register(scenario: ScenarioPlugin): void {
    this.scenarios.set(scenario.id, scenario)
  }

  unregister(scenarioId: string): boolean {
    return this.scenarios.delete(scenarioId)
  }

  get(scenarioId: string): ScenarioPlugin | undefined {
    return this.scenarios.get(scenarioId)
  }

  getAll(): ScenarioPlugin[] {
    return Array.from(this.scenarios.values())
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

  private notifyListeners(scenarioId: string): void {
    for (const listener of this.listeners) {
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
}

export const scenarioRegistry = new ScenarioRegistry()
