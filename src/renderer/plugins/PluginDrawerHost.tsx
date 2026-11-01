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

import { createElement, useCallback, useEffect } from 'react'
import { ArrowLeft, X } from 'lucide-react'
import { useStore } from '@store'
import { scenarioRegistry } from '@shared/configuration/scenarios'
import { resolveNavRailWidth, resolveTrafficLightsClearance } from '@components/layout/navRailMetrics'
import { PluginBoundary } from '@renderer/plugins/PluginBoundary'
import { usePluginPanelComponent } from '@renderer/plugins/usePluginPanelComponent'
import { PLUGIN_CLOSE_PANEL_EVENT } from '@renderer/plugins/PluginHostApi'
import {
  closePluginDrawer,
  resolvePanelDrawerWidth,
  usePluginDrawerTarget,
} from '@renderer/plugins/pluginDrawerStore'

const isMac =
  typeof navigator !== 'undefined' &&
  (navigator.platform.toUpperCase().indexOf('MAC') >= 0 ||
    ((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform
      ?.toUpperCase()
      .indexOf('MAC') ?? -1) >= 0)

/** 从面板 id 取所属插件：插件面板约定以 "<pluginKey>:<name>" 命名 */
function pluginKeyOf(panelId: string): string {
  const index = panelId.indexOf(':')
  return index > 0 ? panelId.slice(0, index) : panelId
}

/**
 * 固定档位的最大宽度上限
 *
 * full 由 resolvePanelDrawerWidth 按视口算，再套上限反而会裁出一条缝，
 * 因此不设约束；其余档位按内容密度分两档收口，窄档留出更多背景。
 */
function maxWidthOf(width: unknown, isFullWidth: boolean): string | undefined {
  if (isFullWidth) return undefined
  return width === 'lg' || width === 'xl' ? '94vw' : '85vw'
}

export default function PluginDrawerHost() {
  const target = usePluginDrawerTarget()
  const language = useStore(s => s.language)
  const navRailExpanded = useStore(s => s.navRailExpanded)
  const activeScenarioId = useStore(s => s.activeScenarioId)
  const isZh = language === 'zh'

  /**
   * 抽屉左边缘落在导航栏之后，macOS 的红绿灯画在窗口左上角。
   * 菜单收起（48px）或不渲染时，抽屉标题会正好落在三个圆点下方被盖住；
   * 这里按导航栏当前宽度补足标题栏左内边距，菜单展开时照常留 16px。
   */
  const scenarioUi = scenarioRegistry.get(activeScenarioId)?.ui
  const navRailWidth = resolveNavRailWidth(
    navRailExpanded,
    scenarioUi?.chrome?.hideNavRail === true,
  )
  const headerInset = resolveTrafficLightsClearance(navRailWidth, isMac, 16)

  // 内置面板走 PanelDrawerHost：这里是插件面板专用路径，
  // 不排除的话内置面板会被当成插件面板再挂一层抽屉，界面上就叠出两个浮层
  const panelId = target && target.kind !== 'panel' ? target.panelId : undefined

  // 组件未注册且属于插件面板时，hook 会触发 ui.js 懒加载并在完成后重绘
  const { Component: PanelComponent, host: panelHost, loadState } = usePluginPanelComponent(panelId)

  // 退出通道一：ESC，抽屉属于临时浮层，键盘要能退出
  useEffect(() => {
    if (!panelId) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closePluginDrawer()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [panelId])

  // 退出通道二：面板自带的关闭按钮派发 PLUGIN_CLOSE_PANEL_EVENT
  //
  // 该事件原本只处理侧栏面板（activeSidePanel），面板改成从左侧菜单以抽屉打开后
  // activeSidePanel 不再指向它，插件里的关闭按钮会点了没反应，因此这里也要接住。
  useEffect(() => {
    if (!panelId) return
    const onPanelClose = (event: Event) => {
      const detail = (event as CustomEvent<{ pluginKey?: string }>).detail
      if (detail?.pluginKey && !panelId.startsWith(detail.pluginKey)) return
      closePluginDrawer()
    }
    window.addEventListener(PLUGIN_CLOSE_PANEL_EVENT, onPanelClose)
    return () => window.removeEventListener(PLUGIN_CLOSE_PANEL_EVENT, onPanelClose)
  }, [panelId])

  const handleClose = useCallback(() => closePluginDrawer(), [])

  if (!target || target.kind === 'panel') return null

  const title = isZh
    ? (target.titleZh || target.title || target.panelId)
    : (target.title || target.titleZh || target.panelId)

  // 宽度与内置面板抽屉走同一套换算：full = 视口减去左侧菜单，菜单开合时跟着让位。
  // 不再用固定的 Tailwind 宽度类，是因为「导航栏不渲染」时菜单占位是 0，
  // 写死的 calc(100vw-48px) 会凭空少一块，和标题栏的红绿灯留白对不上。
  const resolvedWidth = resolvePanelDrawerWidth(target.width, navRailWidth)
  const isFullWidth = resolvedWidth.startsWith('calc(')
  const maxWidth = maxWidthOf(target.width, isFullWidth)

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
    return createElement(PanelComponent, panelProps as Record<string, unknown>)
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
        className="relative h-full bg-popover border-l border-border/60 shadow-2xl flex flex-col animate-[slideInRight_180ms_ease-out]"
        style={{ width: resolvedWidth, maxWidth }}
      >
        <header
          className="flex items-center gap-2 pr-4 py-3 border-b border-border/50 shrink-0"
          style={{ paddingLeft: headerInset }}
        >
          {/* 返回与右上角关闭是同一个动作：抽屉是浮层，关掉就回到打开前的位置。
              左侧再放一个是为了顺着「从左边退出去」的阅读习惯，鼠标不用跨到对角。
              内边距已按红绿灯宽度补足，菜单收起时按钮不会被系统三个圆点压住。 */}
          <button
            type="button"
            onClick={handleClose}
            aria-label={isZh ? '返回' : 'Back'}
            title={isZh ? '返回' : 'Back'}
            className="shrink-0 -ml-1 p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-text-primary truncate">{title}</p>
            <p className="text-[11px] text-text-muted truncate">{pluginKeyOf(target.panelId)}</p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label={isZh ? '关闭' : 'Close'}
            title={isZh ? '关闭' : 'Close'}
            className="shrink-0 p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
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
