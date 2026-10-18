/**
 * 插件抽屉状态
 *
 * 二级选项的 action 可以要求以右侧抽屉的形式打开某个插件面板
 * （例如「使用模板」拉出插件提供的模板组件）。抽屉只是容器：
 * 组件、数据、交互全部由插件实现，这里仅保存「当前要展示哪个面板」。
 *
 * 用独立的小 store 而不是并入全局 store，是因为它只服务于抽屉这一处，
 * 生命周期短、写入稀疏，没必要让整个应用为它重渲染。
 */

import { useSyncExternalStore } from 'react'

/** 抽屉要展示的目标 */
export interface PluginDrawerTarget {
  /** 已注册到 PanelRegistry 的面板 id，如 "design-image-gen:templates" */
  panelId: string
  /** 抽屉标题（英文） */
  title?: string
  /** 抽屉标题（中文） */
  titleZh?: string
  /** 透传给面板组件的附加参数 */
  payload?: Record<string, unknown>
}

let current: PluginDrawerTarget | null = null
const listeners = new Set<() => void>()

function notify(): void {
  listeners.forEach(listener => listener())
}

export function subscribePluginDrawer(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function getPluginDrawerTarget(): PluginDrawerTarget | null {
  return current
}

/** 打开抽屉；重复打开同一个面板时只更新标题与参数，不重置已挂载的组件状态 */
export function openPluginDrawer(target: PluginDrawerTarget): void {
  if (!target?.panelId) return
  current = { ...target }
  notify()
}

export function closePluginDrawer(): void {
  if (!current) return
  current = null
  notify()
}

/** React 侧读取当前抽屉目标 */
export function usePluginDrawerTarget(): PluginDrawerTarget | null {
  return useSyncExternalStore(subscribePluginDrawer, getPluginDrawerTarget, getPluginDrawerTarget)
}
