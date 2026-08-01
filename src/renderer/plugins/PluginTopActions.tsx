/**
 * PluginTopActions — 顶部按钮扩展点容器
 *
 * 从 usePluginExtensions 获取所有插件的顶部按钮贡献，
 * 用 PluginBoundary 隔离渲染。
 *
 * 放置位置：ConversationHeader 右侧操作区（新会话/语音按钮旁）
 *
 * 加载策略：顶部按钮组件必须先加载 ui.js 才能显示（与面板不同，面板可点击时懒加载）。
 * 因此在组件挂载时调用 ensureTopActionsLoaded() 触发所有声明了 topActions 的插件加载。
 * 加载完成后，registry 通过 useSyncExternalStore 通知本组件重新渲染，按钮即出现。
 *
 * @module renderer/plugins/PluginTopActions
 */

import { createElement, useEffect } from 'react'
import { usePluginExtensions } from './usePluginExtensions'
import { PluginBoundary } from './PluginBoundary'
import { pluginUiRegistry } from './PluginUiRegistry'

export function PluginTopActions() {
  const { topActions } = usePluginExtensions()

  // 触发所有声明了 topActions 的插件 ui.js 加载。
  // usePluginExtensions 只返回已加载的 topActions，
  // 必须主动触发加载，否则按钮永远不会出现（死锁：按钮需组件显示，但无人触发加载）。
  //
  // 关键：不能只在挂载时调用一次。插件更新/重装时，registry 会先 unloadPlugin
  // （清空 loaded 和 discovered），再重新 set discovered。此时 topActions 会变空，
  // 但 useEffect 空依赖数组不会再次执行，导致按钮永久消失。
  // 因此用 topActions.length 作为依赖：当 topActions 变空时，重新检查是否有
  // 声明了 topActions 的插件尚未加载，有则触发加载。
  useEffect(() => {
    if (topActions.length > 0) return // 已有按钮，无需重新加载
    let cancelled = false
    pluginUiRegistry
      .ensureTopActionsLoaded()
      .then(() => {
        if (cancelled) return
        // 加载完成；registry 已通过 notifyListeners 通知 useSyncExternalStore 更新。
        // 此处无需手动 setState，订阅机制会自动重渲染。
      })
      .catch((err) => {
        // ensureTopActionsLoaded 内部用 allSettled，不会 reject；防御性处理
        console.error('[PluginTopActions] Failed to load top actions:', err)
      })
    return () => {
      cancelled = true
    }
  }, [topActions.length])

  if (topActions.length === 0) return null

  return (
    <div className="flex items-center gap-1">
      {topActions.map((item) => (
        <PluginBoundary key={`${item.pluginKey}:${item.contribution.id}`} pluginKey={item.pluginKey}>
          {createElement(item.component, { host: item.host })}
        </PluginBoundary>
      ))}
    </div>
  )
}
