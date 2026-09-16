/**
 * usePluginExtensions — 插件 UI 扩展点订阅 Hook
 *
 * 订阅 PluginUiRegistry 状态变化，返回合并后的 sidebarItems 和 topActions。
 * 供 NavigationRail 和 PluginTopActions 使用。
 *
 * 关键约束：getSnapshot 必须返回引用稳定的对象。
 * useSyncExternalStore 通过 Object.is 比较前后两次快照，若引用不同则触发重渲染。
 * 若 getSnapshot 每次都创建新对象，会引发 "Maximum update depth exceeded" 无限循环。
 * 因此这里做了双层缓存：
 *   1. registry 侧 getSidebarItems()/getTopActions() 在数据未变时返回同一数组引用
 *   2. 本 hook 侧 getSnapshot() 仅在子引用变化时才重建快照对象
 *
 * @module renderer/plugins/usePluginExtensions
 */

import { useSyncExternalStore, useEffect, useState } from 'react'
import type { ComponentType } from 'react'
import type { SidebarItemDescriptor } from '@shared/protocols/scenario'
import type { PluginTopActionContribution } from '@shared/plugin-sdk/types'
import type { SceneMode } from '@protocols/sceneModeProtocol'
import { pluginUiRegistry } from './PluginUiRegistry'
import type { PluginHostApi, PluginPanelProps } from './types'

/** 顶部按钮扩展项（含组件和宿主 API） */
export interface PluginTopActionItem {
  pluginKey: string
  contribution: PluginTopActionContribution
  component: ComponentType<PluginPanelProps>
  host: PluginHostApi
}

interface PluginExtensionsState {
  sidebarItems: SidebarItemDescriptor[]
  topActions: PluginTopActionItem[]
}

// 空状态常量（避免每次渲染创建新数组，减少不必要的 re-render）
const EMPTY_STATE: PluginExtensionsState = { sidebarItems: [], topActions: [] }

/**
 * 订阅插件 UI 扩展点
 *
 * NavigationRail 用 sidebarItems 合并到导航项列表；
 * ConversationHeader 用 topActions 渲染顶部按钮。
 */
export function usePluginExtensions(): PluginExtensionsState {
  // useSyncExternalStore 订阅 registry 变化，返回当前快照
  const state = useSyncExternalStore(
    (listener) => pluginUiRegistry.subscribe(listener),
    () => getSnapshot(),
    () => EMPTY_STATE,
  )
  return state
}

/**
 * 快照缓存：仅在子引用变化时重建快照对象
 *
 * - cachedSidebarRef / cachedTopActionsRef：上次构建快照时的子数组引用
 * - cachedSnapshot：据此构建的快照对象引用
 *
 * 当 registry 数据未变时，getSidebarItems()/getTopActions() 返回同一引用，
 * 此处直接复用 cachedSnapshot，保证 getSnapshot() 返回值引用稳定。
 */
let cachedSidebarRef: SidebarItemDescriptor[] | null = null
let cachedTopActionsRef: PluginTopActionItem[] | null = null
let cachedSnapshot: PluginExtensionsState = EMPTY_STATE

/** 获取当前快照（sidebarItems + topActions），引用稳定 */
function getSnapshot(): PluginExtensionsState {
  const sidebarItems = pluginUiRegistry.getSidebarItems()
  const topActions = pluginUiRegistry.getTopActions()

  // 子引用均未变 → 复用上一次的快照对象
  if (sidebarItems === cachedSidebarRef && topActions === cachedTopActionsRef) {
    return cachedSnapshot
  }

  // 子引用变化 → 重建快照
  cachedSidebarRef = sidebarItems
  cachedTopActionsRef = topActions
  cachedSnapshot =
    sidebarItems.length === 0 && topActions.length === 0
      ? EMPTY_STATE
      : { sidebarItems, topActions }
  return cachedSnapshot
}

/**
 * 订阅所有可用的插件工作台卡片元数据
 *
 * 供 CardLibrary 在「添加卡片」弹层中展示插件卡片列表。
 * 响应式：插件安装/卸载时自动更新。
 *
 * @param mode 当前场景模式（过滤 modes 约束）
 */
export function usePluginWidgetCards(mode?: SceneMode) {
  return useSyncExternalStore(
    (listener) => pluginUiRegistry.subscribe(listener),
    () => pluginUiRegistry.getAllWidgetCards(mode),
    () => [],
  )
}

/**
 * 确保插件 UI 注册表已初始化（在应用启动时调用一次）
 *
 * 返回初始化状态，供组件判断是否正在加载。
 */
export function usePluginUiInit(): { ready: boolean } {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    pluginUiRegistry.initialize().finally(() => setReady(true))
  }, [])

  return { ready }
}
