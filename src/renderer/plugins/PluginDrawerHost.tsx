/**
 * 插件抽屉容器
 *
 * 二级选项的 action 可以把插件面板以右侧抽屉的形式拉出来（如「使用模板」）。
 * 这里只负责容器与加载时序，面板组件、数据请求、交互全部由插件实现——
 * 客户端不内置任何模板内容，插件的 ui.js 换成什么，抽屉里就是什么。
 *
 * 加载顺序与 AdaptivePanelView 一致：先查 PanelRegistry，命中插件面板但尚未注册时
 * 触发 ui.js 懒加载，加载完成后重新渲染。插件组件崩溃由 PluginBoundary 兜住，
 * 不会把主界面带挂。
 */

import { createElement, useCallback, useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { useStore } from '@store'
import { getPanelComponent, getPanelHost } from '@components/explorer/PanelRegistry'
import { PluginBoundary } from '@renderer/plugins/PluginBoundary'
import { pluginUiRegistry } from '@renderer/plugins/PluginUiRegistry'
import { closePluginDrawer, usePluginDrawerTarget } from '@renderer/plugins/pluginDrawerStore'

/** 从面板 id 取所属插件：插件面板约定以 "<pluginKey>:<name>" 命名 */
function pluginKeyOf(panelId: string): string {
  const index = panelId.indexOf(':')
  return index > 0 ? panelId.slice(0, index) : panelId
}

export default function PluginDrawerHost() {
  const target = usePluginDrawerTarget()
  const language = useStore(s => s.language)
  const isZh = language === 'zh'

  // 注册是同步副作用，但不触发 re-render；用递增版本号驱动加载完成后的重绘
  const [, setLoadVersion] = useState(0)
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'error'>('idle')

  const panelId = target?.panelId

  // 组件未注册且属于插件面板时，触发 ui.js 懒加载
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

  // ESC 关闭：抽屉属于临时浮层，键盘要能退出
  useEffect(() => {
    if (!panelId) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closePluginDrawer()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [panelId])

  const handleClose = useCallback(() => closePluginDrawer(), [])

  if (!target) return null

  const PanelComponent = getPanelComponent(target.panelId)
  const panelHost = getPanelHost(target.panelId)
  const title = isZh
    ? (target.titleZh || target.title || target.panelId)
    : (target.title || target.titleZh || target.panelId)

  const renderBody = () => {
    if (loadState === 'loading') {
      return (
        <div className="flex flex-col items-center justify-center h-full text-text-muted">
          <div className="w-5 h-5 border-2 border-accent/30 border-t-accent rounded-full animate-spin mb-2" />
          <p className="text-xs">{isZh ? '正在加载插件面板…' : 'Loading plugin panel…'}</p>
        </div>
      )
    }
    if (loadState === 'error') {
      return (
        <div className="flex flex-col items-center justify-center h-full text-status-error px-4 text-center">
          <p className="text-xs">{isZh ? '插件面板加载失败' : 'Plugin panel failed to load'}</p>
          <p className="text-[11px] mt-1 opacity-70">{target.panelId}</p>
        </div>
      )
    }
    if (!PanelComponent) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-text-muted px-4 text-center">
          <p className="text-xs">{isZh ? '未找到该插件面板' : 'Panel not found'}</p>
          <p className="text-[11px] mt-1 opacity-70">{target.panelId}</p>
        </div>
      )
    }

    // 插件面板通过 props.host 访问宿主能力；额外透传抽屉参数供面板自行解释
    const panelProps = {
      ...(panelHost ? { host: panelHost } : {}),
      ...(target.payload ? { drawerParams: target.payload } : {}),
    }
    return createElement(PanelComponent, panelProps as unknown as React.Attributes)
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* 遮罩：点击空白处关闭 */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-[1px] animate-[fadeIn_120ms_ease-out]"
        onClick={handleClose}
        aria-hidden
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative h-full w-[420px] max-w-[85vw] bg-surface border-l border-border/60 shadow-2xl flex flex-col animate-[slideInRight_180ms_ease-out]"
      >
        <header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border/50 shrink-0">
          <div className="min-w-0">
            <p className="text-sm font-medium text-text-primary truncate">{title}</p>
            <p className="text-[11px] text-text-muted truncate">{pluginKeyOf(target.panelId)}</p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label={isZh ? '关闭' : 'Close'}
            className="shrink-0 p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </header>
        <div className="flex-1 min-h-0 overflow-y-auto">
          <PluginBoundary pluginKey={pluginKeyOf(target.panelId)}>
            {renderBody()}
          </PluginBoundary>
        </div>
      </aside>
    </div>
  )
}
