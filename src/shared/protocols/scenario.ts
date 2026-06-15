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
 * - 向后兼容：不打开工作区时自动切换到通用助手场景
 */

import type { WorkMode } from '@protocols/workModeProtocol'
import { BRAND } from '@shared/brand'
import { StorageService } from '@shared/toolkit/StorageService'

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
  wideMode?: boolean
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
  isBuiltin?: boolean
  requiresWorkspace?: boolean

  hasSettings?: boolean
  settingsComponent?: string
  source?: 'builtin' | 'marketplace' | 'local' | 'url'
  sourceUrl?: string
  installSize?: string
  changelog?: string

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

export type SerializableScenario = Omit<ScenarioPlugin, 'onActivate' | 'onDeactivate'>

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
