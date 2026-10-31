/**
 * PluginManageDrawer — 插件功能面板抽屉
 *
 * 已安装插件卡片上的「管理」入口用它打开插件自己声明的功能面板。
 * 这是插件的灵活 UI 扩展能力：面板内容完全由插件的 ui.js 提供，
 * 客户端只负责容器、分区导航与加载时序。
 *
 * 与「配置」的分工：
 * - 配置项固定走 PluginConfigEditDialog 弹窗（填完即关的短期动作）
 * - 功能面板走抽屉（需要常驻的操作界面）
 *
 * 同一批面板也可以声明 openAs: 'drawer'，从左侧菜单点击直接以抽屉打开，
 * 见 manifest.contributes.sidebarPanels[].openAs。
 */

import { createElement, useCallback, useEffect, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { useStore } from '@store'
import { PluginBoundary } from '@renderer/plugins/PluginBoundary'
import { usePluginPanelComponent } from '@renderer/plugins/usePluginPanelComponent'
import { PLUGIN_CLOSE_PANEL_EVENT } from '@renderer/plugins/PluginHostApi'
import { resolveLucideIcon } from './pluginIconResolver'
import { type Language } from '@renderer/i18n'

/** 插件声明的功能面板（来自 manifest.contributes.sidebarPanels） */
export interface PluginManageablePanel {
  id: string
  label: string
  labelZh: string
  icon?: string
}

interface Props {
  open: boolean
  /** 插件 key（用于错误边界归因与关闭事件匹配） */
  pluginKey: string
  /** 插件显示名 */
  pluginName: string
  /** 插件声明的面板，为空时不渲染抽屉 */
  panels: PluginManageablePanel[]
  onClose: () => void
}

export function PluginManageDrawer({
  open,
  pluginKey,
  pluginName,
  panels,
  onClose,
}: Props) {
  const language = useStore((s) => s.language) as Language
  const isZh = language === 'zh'

  const [activeId, setActiveId] = useState<string | undefined>(panels[0]?.id)

  // 每次打开重置到第一个面板：换插件后旧的 id 可能已不存在
  useEffect(() => {
    if (!open) return
    setActiveId(panels[0]?.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pluginKey])

  const { Component: PanelComponent, host: panelHost, loadState } = usePluginPanelComponent(activeId)

  // 浮层的退出通道：Esc 关闭；插件面板自带的关闭按钮派发 PLUGIN_CLOSE_PANEL_EVENT，
  // 该事件原本只处理侧栏面板，面板挂到抽屉里要在这里接住，否则按钮点了没反应
  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    const handlePanelClose = (event: Event) => {
      const detail = (event as CustomEvent<{ pluginKey?: string }>).detail
      if (detail?.pluginKey && detail.pluginKey !== pluginKey) return
      onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener(PLUGIN_CLOSE_PANEL_EVENT, handlePanelClose)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener(PLUGIN_CLOSE_PANEL_EVENT, handlePanelClose)
    }
  }, [open, pluginKey, onClose])

  const handleClose = useCallback(() => onClose(), [onClose])

  if (!open || panels.length === 0) return null

  /** 只有一个面板时不铺左侧导航，内容直接占满 */
  const showNav = panels.length > 1
  const activePanel = panels.find((p) => p.id === activeId) ?? panels[0]

  const renderBody = () => {
    if (loadState === 'loading') {
      return (
        <div className="flex flex-col items-center justify-center h-full text-text-muted">
          <Loader2 className="w-5 h-5 animate-spin mb-2" />
          <p className="text-xs">{isZh ? '正在加载插件面板…' : 'Loading plugin panel…'}</p>
        </div>
      )
    }
    if (loadState === 'error') {
      return (
        <div className="flex flex-col items-center justify-center h-full px-4 text-center text-status-error">
          <p className="text-xs">{isZh ? '插件面板加载失败' : 'Plugin panel failed to load'}</p>
          <p className="text-[11px] mt-1 opacity-70">{activePanel.id}</p>
        </div>
      )
    }
    if (!PanelComponent) {
      return (
        <div className="flex flex-col items-center justify-center h-full px-4 text-center text-text-muted">
          <p className="text-xs">{isZh ? '该插件没有可用的面板组件' : 'No panel component available'}</p>
          <p className="text-[11px] mt-1 opacity-70">{activePanel.id}</p>
        </div>
      )
    }
    const panelProps = panelHost ? { host: panelHost } : {}
    return createElement(PanelComponent as React.ComponentType<Record<string, unknown>>, panelProps)
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
        aria-label={pluginName}
        className="relative h-full w-[920px] max-w-[94vw] bg-popover border-l border-border/60 shadow-2xl flex flex-col animate-[slideInRight_180ms_ease-out]"
      >
        <header className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-border/50 shrink-0">
          <div className="min-w-0">
            <p className="text-sm font-medium text-text-primary truncate">{pluginName}</p>
            <p className="text-[11px] text-text-muted truncate">{pluginKey}</p>
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

        <div className="flex-1 min-h-0 flex">
          {showNav && (
            <nav className="w-44 shrink-0 border-r border-border/40 p-2 space-y-0.5 overflow-y-auto">
              {panels.map((panel) => {
                const Icon = panel.icon ? resolveLucideIcon(panel.icon) : undefined
                const active = panel.id === activePanel.id
                return (
                  <button
                    key={panel.id}
                    type="button"
                    onClick={() => setActiveId(panel.id)}
                    className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-xs text-left transition-colors ${
                      active
                        ? 'bg-accent/10 text-text-primary'
                        : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
                    }`}
                  >
                    {Icon && (
                      <Icon className={`w-3.5 h-3.5 shrink-0 ${active ? 'text-accent' : 'text-text-muted'}`} />
                    )}
                    <span className="truncate">
                      {isZh ? panel.labelZh || panel.label : panel.label || panel.labelZh}
                    </span>
                  </button>
                )
              })}
            </nav>
          )}

          <div className="flex-1 min-w-0 min-h-0">
            <PluginBoundary pluginKey={pluginKey}>{renderBody()}</PluginBoundary>
          </div>
        </div>
      </aside>
    </div>
  )
}

export default PluginManageDrawer

