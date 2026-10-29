import type { ComponentType } from 'react'
import { scenarioRegistry } from '@shared/configuration/scenarios'
import { scenarioLoader } from '@scenario-system/core'
import type { PluginHostApi } from '@renderer/plugins/types'
import { ProjectsView } from './panels/projects/ProjectsView'
import { KnowledgeView } from './panels/KnowledgeExplorer'
import { TaskWorkspace } from './panels/tasks/TaskWorkspace'
import { AutomationView } from './panels/automation/AutomationView'
import { PluginMarketView } from './panels/plugin-market/PluginMarketView'
import { AIBrowserView } from './panels/ai-browser/AIBrowserView'
import { MailCenterView } from './panels/mail-center/MailCenterView'
import { SceneToolsPanel } from '../scene-tools/SceneToolsPanel'
import { TodoHubView } from '../todo-hub/TodoHubView'
import { ScenarioWorkspacePanel } from './panels/ScenarioWorkspacePanel'

type PanelComponent = ComponentType<unknown>

/**
 * 主应用内置面板组件兜底映射（按 sidebarItems[].component 字符串匹配）
 *
 * 当场景模块的 getComponents() 未提供某 component（如通用助手返回空对象），
 * 但 sidebarItems 配置了内置组件名（ProjectsView/KnowledgeView 等）时，
 * 回退到主应用内置组件，避免面板无法解析。
 *
 * 这取代了 MainContentArea 中针对 projects/knowledge/tasks 等的硬编码渲染分支，
 * 让所有 wideMode 面板统一走 DynamicPanelView 解析。
 */
const BUILTIN_PANEL_COMPONENTS: Record<string, PanelComponent> = {
  ProjectsView,
  KnowledgeView,
  TaskWorkspace,
  AutomationView,
  PluginMarketView,
  AIBrowserView,
  MailCenterView,
  SceneToolsPanel,
  TodoHubView,
  ScenarioWorkspacePanel,
}

/** 注册表条目：组件 + 可选的插件宿主 API */
interface PanelRegistryEntry {
  component: PanelComponent
  /** 插件面板专属的宿主 API；场景面板为 undefined */
  host?: PluginHostApi
}

const panelComponentRegistry = new Map<string, PanelRegistryEntry>()

/**
 * 注册表变更订阅
 *
 * 面板组件是运行时注册的：场景切换、插件 ui.js 懒加载、外部场景 bundle 异步
 * 加载完成都会往这里塞组件。注册表本身不是响应式的，读它的渲染层（区域树、
 * 欢迎页）不会因为注册而重渲染，画面就停在「该面板未注册」占位上。
 * 这里用版本号 + 订阅把这些变化显式广播出去。
 */
const panelRegistryListeners = new Set<() => void>()
let panelRegistryVersion = 0

function notifyPanelRegistryChanged(): void {
  panelRegistryVersion += 1
  for (const listener of panelRegistryListeners) {
    try {
      listener()
    } catch {}
  }
}

/** 注册表版本号：供 useSyncExternalStore 判断是否需要重渲染 */
export function getPanelRegistryVersion(): number {
  return panelRegistryVersion
}

/** 订阅注册表变更，返回取消订阅函数 */
export function subscribePanelRegistry(listener: () => void): () => void {
  panelRegistryListeners.add(listener)
  return () => {
    panelRegistryListeners.delete(listener)
  }
}

// 场景内置工具面板：全局注册，任何场景下均可通过 panelId='scene-tools' 激活
registerPanelComponent('scene-tools', SceneToolsPanel)

// 场景工作区：区域树里 { type: 'panel', id: 'scenario-workspace' } 即可摆放，
// 按 activeSidePanel 渲染当前场景面板，因此一棵静态树也能承载多面板切换
registerPanelComponent('scenario-workspace', ScenarioWorkspacePanel)

/**
 * 注册面板组件
 *
 * @param panelId 面板 ID（场景面板用 scenario item id，插件面板用 contribution.id）
 * @param component 面板 React 组件
 * @param host 插件面板专属的宿主 API（场景面板不传）
 */
export function registerPanelComponent(
  panelId: string,
  component: PanelComponent,
  host?: PluginHostApi,
): void {
  const existing = panelComponentRegistry.get(panelId)
  // 同一个组件重复注册是常态（每次场景切换 / 渲染都会调一次），
  // 直接返回可以避免无谓的订阅通知与随之而来的整树重渲染。
  if (existing && existing.component === component && existing.host === host) return

  panelComponentRegistry.set(panelId, { component, host })
  notifyPanelRegistryChanged()
}

export function getPanelComponent(panelId: string): PanelComponent | undefined {
  return panelComponentRegistry.get(panelId)?.component
}

/**
 * 获取面板的宿主 API（仅插件面板有）
 *
 * 供 AdaptivePanelView 渲染插件面板时取出并作为 props.host 传入。
 * 场景面板返回 undefined。
 */
export function getPanelHost(panelId: string): PluginHostApi | undefined {
  return panelComponentRegistry.get(panelId)?.host
}

export function hasPanelComponent(panelId: string): boolean {
  return panelComponentRegistry.has(panelId)
}

export function unregisterPanelComponent(panelId: string): boolean {
  const removed = panelComponentRegistry.delete(panelId)
  if (removed) notifyPanelRegistryChanged()
  return removed
}

export function registerScenarioPanelComponents(scenarioId: string): void {
  const scenario = scenarioRegistry.get(scenarioId)
  if (!scenario?.ui?.sidebarItems) return

  try {
    const module = getScenarioModule(scenarioId)
    if (!module?.getComponents) return

    const components = module.getComponents() ?? {}
    for (const item of scenario.ui.sidebarItems) {
      // 优先使用场景注册的组件；缺失时回退到主应用内置组件（ProjectsView/KnowledgeView 等）
      const comp = components[item.component] ?? BUILTIN_PANEL_COMPONENTS[item.component]
      if (comp) {
        registerPanelComponent(item.id, comp)
      }
    }

    if (scenario.ui.welcomeComponent) {
      const welcomeComp = components[scenario.ui.welcomeComponent]
      if (welcomeComp) {
        registerPanelComponent(`welcome-${scenarioId}`, welcomeComp)
      }
    }
  } catch {}
}

export function unregisterScenarioPanelComponents(scenarioId: string): void {
  const scenario = scenarioRegistry.get(scenarioId)
  if (!scenario?.ui?.sidebarItems) return

  for (const item of scenario.ui.sidebarItems) {
    unregisterPanelComponent(item.id)
  }

  if (scenario.ui.welcomeComponent) {
    unregisterPanelComponent(`welcome-${scenarioId}`)
  }
}

function getScenarioModule(scenarioId: string) {
  // 1. 优先从内置场景（/src/scenarios/*/index.ts）查找
  try {
    const entries = import.meta.glob('/src/scenarios/*/index.ts', { eager: true }) as Record<string, { default: { id: string; getComponents?: () => Record<string, PanelComponent> } }>
    for (const path in entries) {
      const mod = entries[path]?.default
      if (mod?.id === scenarioId) return mod
    }
  } catch {}

  // 2. 从场景加载器（含程序化场景）查找
  // 注意：不能使用 require()，因为渲染进程 nodeIntegration=false，
  // require 不可用。改用顶层静态 import 的 scenarioLoader。
  try {
    const entry = scenarioLoader.getEntry(scenarioId)
    if (entry?.module) return entry.module
  } catch {}

  return null
}
