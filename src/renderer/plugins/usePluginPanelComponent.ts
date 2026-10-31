/**
 * 插件面板组件加载
 *
 * 插件面板的组件来自 ui.js，默认不在启动时加载，第一次需要渲染时才拉取。
 * 「先查 PanelRegistry，未注册则触发懒加载，加载完成后重新取一次」这套时序
 * 在抽屉、管理界面里都要用，抽成 hook 避免各处重复实现。
 *
 * 返回的 Component / host 每次渲染都从 PanelRegistry 现取，
 * 因此懒加载完成后无需调用方额外处理，重新渲染即可拿到组件。
 */

import { useEffect, useState } from 'react'
import { getPanelComponent, getPanelHost } from '../components/explorer/PanelRegistry'
import { pluginUiRegistry } from './PluginUiRegistry'

/** 面板加载状态：idle 表示已就绪或无需加载 */
export type PluginPanelLoadState = 'idle' | 'loading' | 'error'

export interface PluginPanelLoadResult {
  /** 面板组件；尚未注册完成时为 undefined */
  Component: React.ComponentType<Record<string, unknown>> | undefined
  /** 面板对应的宿主 API，随组件一起从 PanelRegistry 取 */
  host: unknown
  /** 加载状态，供调用方渲染 loading / 失败提示 */
  loadState: PluginPanelLoadState
}

export function usePluginPanelComponent(panelId: string | undefined): PluginPanelLoadResult {
  const [loadState, setLoadState] = useState<PluginPanelLoadState>('idle')
  // 加载完成后自增，驱动重新渲染以便重新读取 PanelRegistry
  const [, setLoadVersion] = useState(0)

  useEffect(() => {
    if (!panelId) {
      setLoadState('idle')
      return
    }
    if (getPanelComponent(panelId)) {
      setLoadState('idle')
      return
    }
    if (!pluginUiRegistry.isPluginPanel(panelId)) {
      setLoadState('idle')
      return
    }

    let cancelled = false
    setLoadState('loading')
    pluginUiRegistry
      .ensurePanelLoaded(panelId)
      .then(() => {
        if (cancelled) return
        setLoadState('idle')
        setLoadVersion(v => v + 1)
      })
      .catch(() => {
        if (!cancelled) setLoadState('error')
      })

    return () => { cancelled = true }
  }, [panelId])

  return {
    Component: panelId ? getPanelComponent(panelId) : undefined,
    host: panelId ? getPanelHost(panelId) : undefined,
    loadState,
  }
}
