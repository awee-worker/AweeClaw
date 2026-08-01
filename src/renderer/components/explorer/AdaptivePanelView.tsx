import { createElement, useEffect, useState } from 'react'
import { getPanelComponent, getPanelHost, registerScenarioPanelComponents } from './PanelRegistry'
import { scenarioRegistry } from '@shared/configuration/scenarios'
import { useStore } from '@store'
import { t, type Language } from '@renderer/i18n'
import { pluginUiRegistry } from '@renderer/plugins/PluginUiRegistry'

interface DynamicPanelViewProps {
  panelId: string
}

export function DynamicPanelView({ panelId }: DynamicPanelViewProps) {
  const activeScenarioId = useStore(s => s.activeScenarioId)
  const language = useStore(s => s.language)
  // 注册是同步副作用，但不会触发 re-render。
  // 用一个递增的 version 作为 re-render 触发器，确保注册完成后立即重新渲染面板。
  const [, setRegisterVersion] = useState(0)
  // 插件面板懒加载状态：loading / not-plugin / error
  const [pluginLoadState, setPluginLoadState] = useState<'idle' | 'loading' | 'error'>('idle')

  useEffect(() => {
    if (activeScenarioId) {
      registerScenarioPanelComponents(activeScenarioId)
      // 强制 re-render，使本次注册的组件立即可用（修复首次进入场景面板需点击两次的问题）
      setRegisterVersion(v => v + 1)
    }
  }, [activeScenarioId])

  // 插件面板懒加载兜底：当 panelId 属于插件贡献但 ui.js 尚未加载时，
  // 触发 ensurePanelLoaded，加载完成后 PanelRegistry 即拥有组件，重新渲染即可显示。
  useEffect(() => {
    let cancelled = false
    const PanelComponent = getPanelComponent(panelId)
    if (PanelComponent) {
      setPluginLoadState('idle')
      return
    }
    if (!pluginUiRegistry.isPluginPanel(panelId)) {
      setPluginLoadState('idle')
      return
    }
    // 命中插件面板但组件未注册 → 触发懒加载
    setPluginLoadState('loading')
    pluginUiRegistry
      .ensurePanelLoaded(panelId)
      .then(() => {
        if (!cancelled) {
          setPluginLoadState('idle')
          setRegisterVersion(v => v + 1)
        }
      })
      .catch(() => {
        if (!cancelled) setPluginLoadState('error')
      })
    return () => {
      cancelled = true
    }
  }, [panelId])

  const PanelComponent = getPanelComponent(panelId)
  // 插件面板的宿主 API（场景面板为 undefined，不传 host）
  // 插件组件约定通过 props.host 访问宿主能力，未传会导致运行时报错
  const panelHost = getPanelHost(panelId)

  if (!PanelComponent) {
    // 插件面板加载中
    if (pluginLoadState === 'loading') {
      return (
        <div className="flex flex-col items-center justify-center h-full text-text-muted px-4">
          <div className="w-5 h-5 border-2 border-accent/30 border-t-accent rounded-full animate-spin mb-2" />
          <p className="text-xs">{language === 'zh' ? '正在加载插件面板...' : 'Loading plugin panel...'}</p>
        </div>
      )
    }
    // 插件面板加载失败
    if (pluginLoadState === 'error') {
      return (
        <div className="flex flex-col items-center justify-center h-full text-status-error px-4">
          <p className="text-xs">{language === 'zh' ? '插件面板加载失败' : 'Plugin panel failed to load'}</p>
          <p className="text-[11px] mt-1 opacity-70">{panelId}</p>
        </div>
      )
    }
    // 场景面板未注册的兜底提示
    const scenario = scenarioRegistry.get(activeScenarioId)
    const scenarioName = scenario ? (language === 'zh' ? scenario.nameZh : scenario.name) : activeScenarioId
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-muted px-4">
        <p className="text-xs">{t('explorer.panel', language as Language, { scenarioName: scenarioName })}</p>
        <p className="text-[11px] mt-1 opacity-70">{t('explorer.progressindicatorcomponent', language as Language)}</p>
      </div>
    )
  }

  // 插件面板需要 host prop；场景面板无 host，仅传组件（props 展开为空对象）
  // 用 createElement 显式传 prop，类型断言绕过 ComponentType<unknown> 的 props 类型检查
  // （运行时插件组件会正确接收 host；场景组件无 host prop 也不受影响）
  const panelProps = panelHost ? ({ host: panelHost } as Record<string, unknown>) : undefined
  return createElement(PanelComponent, panelProps as React.Attributes)
}
