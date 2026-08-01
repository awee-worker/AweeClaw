import type { ComponentType } from 'react'
import { scenarioRegistry } from '@shared/configuration/scenarios'
import { scenarioLoader } from '@scenario-system/core'
import type { PluginHostApi } from '@renderer/plugins/types'

type PanelComponent = ComponentType<unknown>

/** 注册表条目：组件 + 可选的插件宿主 API */
interface PanelRegistryEntry {
  component: PanelComponent
  /** 插件面板专属的宿主 API；场景面板为 undefined */
  host?: PluginHostApi
}

const panelComponentRegistry = new Map<string, PanelRegistryEntry>()

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
  panelComponentRegistry.set(panelId, { component, host })
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
  return panelComponentRegistry.delete(panelId)
}

export function registerScenarioPanelComponents(scenarioId: string): void {
  const scenario = scenarioRegistry.get(scenarioId)
  if (!scenario?.ui?.sidebarItems) return

  try {
    const module = getScenarioModule(scenarioId)
    if (!module?.getComponents) return

    const components = module.getComponents()
    for (const item of scenario.ui.sidebarItems) {
      const comp = components[item.component]
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
