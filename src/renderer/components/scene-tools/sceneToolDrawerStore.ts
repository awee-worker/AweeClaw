/**
 * 场景工具抽屉状态
 *
 * 场景内置工具（番茄钟、记账本、闪卡复习等）统一以右侧抽屉的形式打开：
 * 仪表盘卡片、AI 调用、场景内的工具入口都走这里，不再占用左侧面板。
 *
 * 抽屉只是容器，工具组件、数据与交互仍由 SceneToolsPanel 提供；
 * 这里只保存「当前展示哪个工具」，`toolId` 为 null 时展示工具宫格首页。
 *
 * 用独立的小 store 而不是并入全局 store：它只服务抽屉这一处，
 * 写入稀疏，没必要让整个应用为它重渲染。
 */

import { useSyncExternalStore } from 'react'

/** 抽屉要展示的目标 */
export interface SceneToolDrawerTarget {
  /** 工具 id，对应 registry 中的 SceneToolMeta.id；null 表示工具宫格首页 */
  toolId: string | null
}

let current: SceneToolDrawerTarget | null = null
const listeners = new Set<() => void>()

function notify(): void {
  listeners.forEach((listener) => listener())
}

export function subscribeSceneToolDrawer(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getSceneToolDrawerTarget(): SceneToolDrawerTarget | null {
  return current
}

/**
 * 打开抽屉。
 *
 * 重复打开同一个工具时不再通知订阅者，避免抽屉内的工具组件被无谓重挂载、
 * 丢失未提交的输入（例如正在敲的记账金额）。
 */
export function openSceneToolDrawer(toolId: string | null = null): void {
  if (current && current.toolId === toolId) return
  current = { toolId }
  notify()
}

export function closeSceneToolDrawer(): void {
  if (!current) return
  current = null
  notify()
}

/** 当前抽屉是否处于打开状态 */
export function isSceneToolDrawerOpen(): boolean {
  return current !== null
}

/** React 侧读取当前抽屉目标 */
export function useSceneToolDrawerTarget(): SceneToolDrawerTarget | null {
  return useSyncExternalStore(
    subscribeSceneToolDrawer,
    getSceneToolDrawerTarget,
    getSceneToolDrawerTarget
  )
}
