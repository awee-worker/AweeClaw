/**
 * 插件操作结果提示
 *
 * 插件在 UI 里做完一次选择（如挑了风格）后，只写会话上下文 AI 能看见，
 * 但用户在界面上没有任何反馈 —— 不知道自己点到没点到。
 * 这个 store 承载「当前选中了什么」，渲染在输入框上方的技能标签行末尾，
 * 与其他已选标签并排，常驻直到被下一次选择替换或手动关掉。
 *
 * 与 toast 的区别：toast 是全局浮层、位置固定在角落、会自动消失；
 * 这个提示要说明的是一个持续有效的状态，位置也该贴着输入框。
 */

import { useSyncExternalStore } from 'react'

export interface PluginNotice {
  /** 展示用短标签，如「PPT 风格 · 科技深色」 */
  text: string
  /** 来源插件，便于排查与将来按插件区分样式 */
  pluginKey: string
}

let current: PluginNotice | null = null
const listeners = new Set<() => void>()

function notify(): void {
  listeners.forEach(listener => listener())
}

export function subscribePluginNotice(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function getPluginNotice(): PluginNotice | null {
  return current
}

/**
 * 记录一条提示；重复调用直接替换，不自动消失。
 *
 * 它是「当前选中的状态」，不是一次性通知：用户需要随时能回看到自己选了什么，
 * 所以常驻在技能标签行末尾，直到被下一次操作覆盖或手动关掉。
 */
export function setPluginNotice(notice: PluginNotice): void {
  if (!notice?.text) return
  current = { ...notice }
  notify()
}

export function clearPluginNotice(): void {
  if (!current) return
  current = null
  notify()
}

export function usePluginNotice(): PluginNotice | null {
  return useSyncExternalStore(subscribePluginNotice, getPluginNotice, getPluginNotice)
}
