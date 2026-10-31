/**
 * 内置面板抽屉
 *
 * 左侧菜单里的待办 / 项目 / 自动化 / 知识库 / 邮件中心 / 插件市场 / AI 浏览器
 * 都以右侧抽屉打开：面板本身还是同一个组件，只是渲染位置从「接管主内容区」
 * 换成了一块固定宽度的浮层。
 *
 * 这样做的收益：
 * - 打开面板不再挤掉对话与工作内容，关掉就回到原来的地方，无需还原布局；
 * - 面板宽度可控，列表 + 详情型界面不会因为窗口宽度不同而被拉成奇怪的形状。
 *
 * 与 PluginDrawerHost 的分工：插件面板带宿主 API 和 ui.js 懒加载，由那边渲染；
 * 这里只处理已在 PanelRegistry 中登记的内置面板（kind === 'panel'）。
 */

import { useEffect } from 'react'
import { ArrowLeft, X } from 'lucide-react'
import { useStore } from '@store'
import { scenarioRegistry } from '@shared/configuration/scenarios'
import { CrashGuard } from '@components/foundation/CrashGuard'
import { resolveNavRailWidth, resolveTrafficLightsClearance } from '@components/layout/navRailMetrics'
import { DynamicPanelView } from './AdaptivePanelView'
import {
  closePanelDrawer,
  PANEL_DRAWER_WIDTHS,
  PanelDrawerContext,
  resolvePanelDrawerWidth,
  usePanelDrawerTarget,
} from '@renderer/plugins/pluginDrawerStore'


const isMac = typeof navigator !== 'undefined' && (
  navigator.platform.toUpperCase().indexOf('MAC') >= 0 ||
  ((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform?.toUpperCase().indexOf('MAC') ?? -1) >= 0
)
export default function PanelDrawerHost() {
  const target = usePanelDrawerTarget()
  const language = useStore(s => s.language)
  const activeScenarioId = useStore(s => s.activeScenarioId)
  const navRailExpanded = useStore(s => s.navRailExpanded)
  const isZh = language === 'zh'

  const panelId = target && target.kind === 'panel' ? target.panelId : null

  const scenarioUi = scenarioRegistry.get(activeScenarioId)?.ui

  // 标题兜底：调用方常常只知道面板 id（工作台卡片、设置页里的「打开邮件中心」），
  // 名称统一从当前场景的导航声明里取，避免每个入口各写一遍中英文。
  const declaration = panelId
    ? scenarioUi?.sidebarItems?.find(item => item.id === panelId)
    : undefined

  // 铺满剩余宽度的抽屉要扣掉左侧菜单，菜单展开 / 收起是两档宽度；
  // 场景声明不要导航栏时整条不渲染，此时剩余宽度就是整个视口。
  const navRailWidth = resolveNavRailWidth(navRailExpanded, scenarioUi?.chrome?.hideNavRail === true)
  const resolvedWidth = resolvePanelDrawerWidth(
    target?.width ?? (panelId ? PANEL_DRAWER_WIDTHS[panelId] : undefined),
    navRailWidth,
  )
  // full 档本身就是按视口算的，再套 94vw 上限会被裁出一条缝，改为不限最大宽度
  const isFullWidth = resolvedWidth.startsWith('calc(')

  // 抽屉左边缘落在 navRailWidth 处。macOS 上红绿灯画在窗口左上角且宽度固定，
  // 菜单收起（48px）或不渲染时左边缘会进到红绿灯下方，返回按钮被三个圆点盖住，
  // 所以标题栏左内边距要跟着菜单宽度补足；菜单展开时正常留 12px 即可。
  const headerInset = resolveTrafficLightsClearance(navRailWidth, isMac, 12)


  // 抽屉是临时浮层，键盘要能退出
  useEffect(() => {
    if (!panelId) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closePanelDrawer()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [panelId])

  if (!target || target.kind !== 'panel' || !panelId) return null

  const titleEn = target.title || declaration?.label || panelId
  const titleZh = target.titleZh || declaration?.labelZh || titleEn
  const title = isZh ? titleZh : titleEn

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* 遮罩：点击空白处关闭 */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-[1px] animate-[fadeIn_120ms_ease-out]"
        onClick={closePanelDrawer}
        aria-hidden
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`panel-drawer no-drag relative h-full ${isFullWidth ? 'max-w-none' : 'max-w-[94vw]'} bg-background border-l border-border/60 shadow-2xl flex flex-col animate-[slideInRight_180ms_ease-out]`}
        style={{ width: resolvedWidth }}
      >
        <header
          className="flex items-center gap-2 pr-4 h-12 border-b border-border/50 shrink-0"
          style={{ paddingLeft: headerInset }}
        >
          {/* 返回与右上角关闭是同一个动作：抽屉是浮层，关掉就回到打开前的位置。
              左侧再放一个是为了顺着「从左边退出去」的阅读习惯，鼠标不用跨到对角。 */}
          <button
            type="button"
            onClick={closePanelDrawer}
            aria-label={isZh ? '返回' : 'Back'}
            title={isZh ? '返回' : 'Back'}
            className="shrink-0 -ml-1 p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <p className="flex-1 min-w-0 text-sm font-medium text-text-primary truncate">{title}</p>
          <button
            type="button"
            onClick={closePanelDrawer}
            aria-label={isZh ? '关闭' : 'Close'}
            className="shrink-0 p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 min-h-0 overflow-hidden">
          <PanelDrawerContext.Provider value={{ close: closePanelDrawer }}>
            <CrashGuard>
              <DynamicPanelView panelId={panelId} />
            </CrashGuard>
          </PanelDrawerContext.Provider>
        </div>

        {/*
          面板原本是「整页」设计的，个别标题栏声明了窗口拖拽区（drag-region），
          顶部还留了 40px 给窗口标题让位。放进抽屉后这两项都不再成立：
          拖拽区会让「按住标题」变成拖走整个窗口，而抽屉自己已有 48px 的标题条，
          再叠 40px 留白就把内容顶得太低。这里统一降级为普通区域并收紧间距。
        */}
        <style>{`
          .panel-drawer .drag-region {
            -webkit-app-region: no-drag;
            padding-top: 1.25rem;
          }
        `}</style>
      </aside>
    </div>
  )
}
