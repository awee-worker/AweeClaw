import { useState, useRef, useEffect, useCallback } from 'react'
import { MessageSquarePlus, Plus, Trash2 } from 'lucide-react'
import { HintOverlay } from '../ui/HintOverlay'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { scenarioRegistry } from '@shared/configuration/scenarios'
import { getLucideIcon } from '../foundation/IconMap'
import { Logo } from '../foundation/BrandMark'
import { PanelLeftIcon } from '../foundation/PanelLeftIcon'
import { useAgentActions } from '@hooks/useAgent'
import type { SidebarItemDescriptor } from '@shared/protocols/scenario'
import { resolveUserMenuPlacement } from '@shared/protocols/scenario'
import type { SidePanel } from '@store/slices'
import { BRAND } from '@shared/brand'
import { t, type Language } from '@renderer/i18n'
import { usePluginExtensions } from '@renderer/plugins/usePluginExtensions'
import { pluginUiRegistry } from '@renderer/plugins/PluginUiRegistry'
import { openPluginDrawer, openBuiltinPanel, isBuiltinDrawerPanel, closePluginDrawer, getPluginDrawerTarget, usePanelDrawerTarget } from '@renderer/plugins/pluginDrawerStore'
import AddCustomMenuDialog from '../browser/AddCustomMenuDialog'
import { useMailUnreadCount } from '@renderer/hooks/useMailUnreadCount'
import { useTodoHubStore } from '../todo-hub/todoHubStore'
import { NAV_RAIL_WIDTH_EXPANDED, NAV_RAIL_WIDTH_COLLAPSED } from './navRailMetrics'
import ChatHistoryPart from '@renderer/shell/parts/ChatHistoryPart'
import RailUserPart from '@renderer/shell/parts/RailUserPart'

const isMac = typeof navigator !== 'undefined' && (
  navigator.platform.toUpperCase().indexOf('MAC') >= 0 ||
  ((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform?.toUpperCase().indexOf('MAC') ?? -1) >= 0
)



/**
 * 场景未声明 sidebarItems 时的兜底菜单。
 *
 * explorer 标记 hidden：它由「新建任务」按钮按需激活（打开工作空间文件面板），
 * 不作为常驻导航项，避免与「新建任务」的语义重复。
 */
const DEFAULT_ITEMS: SidebarItemDescriptor[] = [
  { id: 'explorer', icon: 'Files', label: 'Workspace', labelZh: '工作空间', component: 'ExplorerView', position: 0, hidden: true },
  { id: 'knowledge', icon: 'BookOpen', label: 'Knowledge', labelZh: '知识库', component: 'KnowledgeView', position: 1 },
]

/**
 * 邮件中心导航项 id
 *
 * 该入口不是侧边栏面板，而是独立邮件中心窗口的入口，
 * 因此在渲染分支中集中处理，避免散落的字符串字面量。
 */
const MAIL_CENTER_ITEM_ID = 'mail-center'

/**
 * 待办中心导航项 id
 *
 * 与邮件中心一样需要额外处理：有未完成待办时在标签后显示数量（如「待办（5）」），
 * 收起模式下以角标呈现在图标右上角。
 */
const TODO_HUB_ITEM_ID = 'todo-hub'



// 场景工具不再提供左侧导航入口：
// 番茄钟、记账本等内置工具统一由仪表盘卡片以右侧抽屉的形式打开
// （见 components/scene-tools/SceneToolDrawerHost）。

function NavPill({ active }: { active: boolean }) {
  return (
    <div
      className={`
        absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-r-full
        hover:bg-text-primary/[0.06]
        transition-all duration-300 ease-out
        ${active ? 'h-5 bg-accent shadow-[0_0_8px_rgba(var(--accent-rgb),0.5)]' : 'h-0 bg-transparent'}
      `}
    />
  )
}

/**
 * 菜单项未读角标
 *
 * 用于「工作场景」「插件与技能」「费用中心」等入口：这些页面内部虽然有
 * 到期提醒横幅，但用户不主动点进去就看不到，角标是唯一能提前暴露风险的信号。
 */
function MenuBadge({ count, title }: { count: number; title?: string }) {
  if (count <= 0) return null
  return (
    <span
      title={title}
      className="ml-auto min-w-[16px] h-[16px] px-1 flex items-center justify-center text-[10px] font-semibold bg-accent text-white rounded-full"
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}

/* 用户菜单已移至 shell/parts/RailUserPart.tsx */

/* 历史会话列表项已移至 shell/parts/ChatHistoryPart.tsx */


export default function NavigationRail() {
  const {
    activeSidePanel,
    setActiveSidePanel,
    closeSidePanelForView,
    language,
    setShowWorkflow,
    activeScenarioId,
    navRailExpanded,
    setNavRailExpanded,
    showSettingsPage,
    showWelcomePage,
    setShowWelcomePage,
    closeAllFullPages,
    customMenus,
    removeCustomMenu,
    openInternalBrowser,
    activeCustomMenuId,
    closeInternalBrowser,
    setChatVisible,
    enterFocusLayout,
  } = useStore(useShallow(s => ({
    activeSidePanel: s.activeSidePanel,
    setActiveSidePanel: s.setActiveSidePanel,
    closeSidePanelForView: s.closeSidePanelForView,
    language: s.language,
    setShowWorkflow: s.setShowWorkflow,
    activeScenarioId: s.activeScenarioId,
    navRailExpanded: s.navRailExpanded,
    setNavRailExpanded: s.setNavRailExpanded,
    showSettingsPage: s.showSettingsPage,
    showWelcomePage: s.showWelcomePage,
    setShowWelcomePage: s.setShowWelcomePage,
    closeAllFullPages: s.closeAllFullPages,
    customMenus: s.customMenus,
    removeCustomMenu: s.removeCustomMenu,
    openInternalBrowser: s.openInternalBrowser,
    activeCustomMenuId: s.activeCustomMenuId,
    closeInternalBrowser: s.closeInternalBrowser,
    setChatVisible: s.setChatVisible,
    enterFocusLayout: s.enterFocusLayout,
  })))

  /**
   * 用户资料页状态
   *
   * 该页占满主区域时左侧面板实际上已不可见，导航项不应继续高亮；
   * 这里单独订阅，避免为一个布尔值把账号相关的整组动作塞进上面的解构里。
   */
  const showUserProfilePage = useStore(s => s.showUserProfilePage)

  const { createThread } = useAgentActions()

  const [showAddCustomMenu, setShowAddCustomMenu] = useState(false)

  const mailUnread = useMailUnreadCount()
  /** 未完成待办数量：用于待办入口的「待办（N）」显示与角标 */
  const pendingTodoCount = useTodoHubStore(s => s.items.filter(i => i.status !== 'done').length)
  /**
   * 当前抽屉目标
   *
   * 内置面板改以抽屉打开后不再写 activeSidePanel，选中态只能从这里取，
   * 否则点开面板时左侧那一项没有任何高亮反馈。
   */
  const drawerTarget = usePanelDrawerTarget()



  const scenario = scenarioRegistry.get(activeScenarioId)
  const rawSidebarItems = scenario?.ui?.sidebarItems?.length
    ? [...scenario.ui.sidebarItems].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    : DEFAULT_ITEMS
  const scenarioSidebarItems = rawSidebarItems.filter(item => {
    if (item.id === 'checkpoint' && activeScenarioId !== 'dev-assistant') return false
    // hidden 入口不在导航菜单显示，但仍注册到 PanelRegistry 可被代码激活
    if (item.hidden) return false
    return true
  })

  // 合并插件贡献的侧边栏面板（来自 PluginUiRegistry）
  // 显隐完全由 sidebarItems[].hidden 决定（上方已过滤），不再做全局硬编码屏蔽，
  // 否则场景无法控制自己的导航项，声明的入口会静默失效。
  const { sidebarItems: pluginSidebarItems } = usePluginExtensions()
  const sidebarItems = [...scenarioSidebarItems, ...pluginSidebarItems]

  /**
   * 插件更新可能删掉它原先贡献的导航项，此时该项对应的面板组件已在
   * PluginUiRegistry 里注销。若用户正停在那块面板上，主区域会渲染出空白，
   * 且左侧找不到任何可点的入口回到正常视图。
   *
   * 只处理「上一轮属于插件面板、这一轮消失了」的情况：场景面板会随场景切换
   * 增删，不能套用同一条规则，否则切场景时会被误判成面板失效。
   */
  const prevPluginPanelIdsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const currentIds = new Set(pluginSidebarItems.map(item => item.id))
    const previousIds = prevPluginPanelIdsRef.current
    prevPluginPanelIdsRef.current = currentIds

    if (!activeSidePanel) return
    if (!previousIds.has(activeSidePanel)) return
    if (currentIds.has(activeSidePanel)) return

    setActiveSidePanel(null)
  }, [pluginSidebarItems, activeSidePanel, setActiveSidePanel])

  const scenarioChrome = scenario?.ui?.chrome

  // 新建任务入口：场景自带完整导航时可由场景关掉，避免与场景自身的创建流程重复
  const showNewTaskEntry = scenarioChrome?.hideNewTask !== true

  // 仪表盘入口：场景以自己的首屏取代宿主仪表盘时收起
  const showDashboardEntry = scenarioChrome?.hideDashboard !== true

  // 历史会话：场景以自己的项目列表 / 素材列表取代会话历史时收起
  const hideChatHistory = scenarioChrome?.hideChatHistory === true

  // 账号区默认留在导航栏底部，场景声明放到顶部右侧时由 AppTitleBar 渲染
  const showRailUser = resolveUserMenuPlacement(scenarioChrome) === 'rail'

  const p = BRAND.cssPrefix

  /**
   * 场景是否自带完整导航
   *
   * 自带导航的场景里，这些菜单是「工作区视图切换器」：每一项都是一个可停留的
   * 独立工作台，不存在「未选中」的等价视图。取消选中后主区域会回落到编辑器空态
   * 与对话区，用户看到的就是一个欢迎页加聊天窗口，像是点错了地方。
   *
   * 因此这类场景点击已激活项应当是幂等的；想要收起侧边栏仍有顶部开关可用。
   * 未声明导航的场景（通用助手等）保留开合语义，那个面板本身可以收起来。
   */
  const scenarioOwnsNav = (scenario?.ui?.sidebarItems?.length ?? 0) > 0

  const handleMenuItemClick = (itemId: string, isActive: boolean) => {
    // 抽屉式插件面板：导航项只是唤起入口，点击后以浮层打开，不切换侧栏面板，
    // 主内容区与对话保持原样。面板自身的交互与数据全部由插件实现。
    const drawerMeta = pluginUiRegistry.getDrawerPanelMeta(itemId)
    if (drawerMeta) {
      closeAllFullPages()
      closeInternalBrowser()
      openPluginDrawer({
        panelId: itemId,
        title: drawerMeta.title,
        titleZh: drawerMeta.titleZh,
        width: drawerMeta.width,
      })
      return
    }

    // 内置面板：同样以抽屉打开，不再接管主内容区。
    // 再次点击当前已打开的那一项视为收起，与侧栏面板的开合语义保持一致。
    if (isBuiltinDrawerPanel(itemId)) {
      const currentTarget = getPluginDrawerTarget()
      const isOpen = currentTarget?.kind === 'panel' && currentTarget.panelId === itemId
      closeAllFullPages()
      closeInternalBrowser()
      if (isOpen) {
        closePluginDrawer()
        return
      }
      openBuiltinPanel(itemId)
      return
    }

    // 判定用 activeSidePanel 而非渲染层的 isActive：后者带 !showWelcomePage 等
    // 条件，欢迎页残留时界面显示的其实是面板、isActive 却是 false。
    if (scenarioOwnsNav && activeSidePanel === itemId) {
      // 顺手清掉可能残留的欢迎页 / 设置页，避免它们压在面板下面
      closeAllFullPages()
      closeInternalBrowser()
      return
    }

    setActiveSidePanel(isActive ? null : (itemId as SidePanel))
    closeAllFullPages()
    // 点击侧边栏面板时自动关闭内部浏览器
    closeInternalBrowser()
  }

  /**
   * 打开自定义菜单（内部浏览器）
   *
   * 分两步走：收起侧边栏、关闭全屏页面都会让主区域重新分配宽度，紧接着挂载
   * 内置浏览器（lazy chunk + <webview> 的 guest 进程）又是一批重活。全部压在同一
   * 帧里主线程做不完，表现为主窗口卡一下。这里先把布局变化落地一帧再打开浏览器，
   * 与打开预览 Tab 时「先让出侧边栏、再挂载 webview」的处理保持一致。
   */
  const handleOpenCustomMenu = useCallback((menu: { url: string; name: string; id: string }) => {
    // 收起动作必须走 enterFocusLayout：它先记录「打开前」的菜单栏 / 侧边栏状态，
    // 关闭浏览器后据此恢复。直接 setActiveSidePanel(null) 会把打开前的面板抹掉，
    // 快照只能记到 null，关闭后就再也回不到原来的工作空间面板。
    const store = useStore.getState()
    const hadSidePanel = store.activeSidePanel !== null
    const hadNavRail = store.navRailExpanded
    enterFocusLayout()
    closeAllFullPages()

    const open = () => openInternalBrowser(menu.url, menu.name, menu.id)

    // 侧边栏与菜单栏本来就没展开时没有额外重排，不必多等一帧
    if (!hadSidePanel && !hadNavRail) {
      open()
      return
    }

    requestAnimationFrame(() => requestAnimationFrame(open))
  }, [enterFocusLayout, closeAllFullPages, openInternalBrowser])

  const handleBrandClick = useCallback(() => {
    // 回欢迎页属于离开当前面板：顺便重置「上次面板」，顶部开关再按下时打开工作空间面板
    closeSidePanelForView()
    setShowWelcomePage(true)
    setShowWorkflow(false)
    closeInternalBrowser()
  }, [closeSidePanelForView, setShowWelcomePage, setShowWorkflow, closeInternalBrowser])

  // 新建任务：新建对话（聊天界面）并进入「新建任务页面」。
  // 若当前已选择工作空间，则默认打开工作空间文件面板；未选择工作空间时不打开，避免出现空面板，
  // 但要收起当前场景面板（插件市场 / 待办中心等）并重置开关的恢复目标，否则用户会停在一块
  // 与新建任务无关的界面上，顶部开关再按下也只会把它重新打开。
  const handleNewTask = useCallback(() => {
    if (useStore.getState().workspace?.roots?.length) {
      setActiveSidePanel('explorer')
    } else {
      closeSidePanelForView()
    }
    closeAllFullPages()
    // 先关闭内部浏览器（其关闭逻辑会回写"打开前"的聊天显隐），再显式显示聊天窗口，避免被回写覆盖
    closeInternalBrowser()
    setChatVisible(true)
    createThread()
  }, [setActiveSidePanel, closeSidePanelForView, closeAllFullPages, setChatVisible, closeInternalBrowser, createThread])

  // 仪表盘（欢迎页）选中态
  const isDashboardActive = showWelcomePage

  // 新建任务不参与高亮：它是动作入口（打开工作空间文件面板 + 新建会话），
  // 当前会话的选中态统一由历史会话列表体现（见 ChatHistoryPart）。
  // 若绑定 activeSidePanel === 'explorer'，会导致仅打开工作空间面板时误高亮。
  const newTaskActive = false


  /*
   * 场景声明不要左侧菜单面板时整条不渲染。
   *
   * 收口放在部件内部而不是外面的排版层：区域树的 slot / part 两条路径都从这里
   * 出内容，逐个判断会漏掉场景自定义树里的写法。
   */
  if (scenarioChrome?.hideNavRail === true) return null

  return (
    <div className={`${p}-nav-rail`} data-expanded={navRailExpanded} data-mac={isMac}>
      <style>{`
        .${p}-nav-rail {
          height: 100%;
          width: ${NAV_RAIL_WIDTH_EXPANDED}px;
          background: rgb(var(--background-secondary));
          border-right: 1px solid rgba(var(--border), 0.2);
          /* 右侧投影：增强与内容区的层次分离，使用半透明黑避免硬边 */
          box-shadow: 4px 0 12px -4px rgba(0, 0, 0, 0.08), 1px 0 4px -2px rgba(0, 0, 0, 0.08);
          display: flex;
          flex-direction: column;
          /* z-index 高于 AppTitleBar(z-50)，确保顶部阴影不被标题栏背景遮挡 */
          z-index: 60;
          /* 收起按钮绝对定位到面板顶部右侧，需以面板为参照 */
          position: relative;
          user-select: none;
          padding: 20px 8px 8px 8px;
          transition: width 200ms cubic-bezier(0.4, 0, 0.2, 1), padding 200ms cubic-bezier(0.4, 0, 0.2, 1);
          overflow: hidden;
          flex-shrink: 0;
        }
        .${p}-nav-rail[data-expanded="false"] {
          width: ${NAV_RAIL_WIDTH_COLLAPSED}px;
          padding: 20px 4px 8px 4px;
          align-items: center;
        }
        .${p}-nav-rail[data-mac="true"] {
          padding-top: 48px;
        }
        .${p}-nav-rail[data-mac="true"][data-expanded="false"] {
          padding-top: 48px;
        }
        .${p}-nav-rail-collapse-wrap {
          /* 与标题栏按钮同高：标题栏 h-11(44px)、按钮 28px 居中，顶部偏移 8px。
             绝对定位是为了摆脱导航栏的 padding-top（macOS 需为红绿灯让位 48px），
             靠右则天然避开左侧红绿灯区域。
             定位落在外层容器上而不是按钮本身：按钮外面套了一层悬停说明的包装节点，
             按钮自持绝对定位会改成相对那个包装节点计算，位置随之跑偏。 */
          position: absolute;
          top: 8px;
          right: 8px;
        }
        .${p}-nav-rail-collapse-btn {
          width: 28px;
          height: 28px;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          border: none;
          background: transparent;
          color: rgb(var(--text-muted));
          cursor: pointer;
          transition: color 0.2s ease, background 0.2s ease;
        }
        .${p}-nav-rail-collapse-btn:hover {
          color: rgb(var(--text-primary));
          background: rgb(var(--text-primary) / 0.06);
        }
        .${p}-nav-rail-brand {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 4px 6px 12px 6px;
          flex-shrink: 0;
          cursor: pointer;
          border-radius: 8px;
          transition: background 0.2s ease;
        }
        .${p}-nav-rail-brand:hover {
          background: rgb(var(--text-primary) / 0.06);
        }
        .${p}-nav-rail-brand[data-active="true"] {
          background: rgba(var(--accent), 0.08);
        }
        .${p}-nav-rail-brand[data-active="true"] .${p}-nav-rail-brand-name {
          color: rgb(var(--accent));
        }
        .${p}-nav-rail[data-expanded="false"] .${p}-nav-rail-brand {
          justify-content: center;
          padding: 4px 0 12px 0;
        }

        .${p}-nav-rail-brand-icon {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          overflow: hidden;
        }
        .${p}-nav-rail-brand-icon img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .${p}-nav-rail-brand-name {
          font-size: 13px;
          font-weight: 500;
          color: rgb(var(--text-primary));
        }
        .${p}-nav-rail[data-expanded="false"] .${p}-nav-rail-brand-name {
          display: none;
        }
        .${p}-nav-rail-item {
          position: relative;
          width: 100%;
          height: 38px;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: flex-start;
          padding-left: 10px;
          gap: 10px;
          transition: all 0.2s ease;
          cursor: pointer;
          border: none;
          background: transparent;
          color: #333333;
          flex-shrink: 0;
        }
        [data-theme="dark"] .${p}-nav-rail-item {
          color: #c0c0c0;
        }
        .aweeclaw-thread-item {
          color: #333333;
        }
        [data-theme="dark"] .aweeclaw-thread-item {
          color: #c0c0c0;
        }
        .${p}-nav-rail[data-expanded="false"] .${p}-nav-rail-item {
          width: 38px;
          justify-content: center;
          padding-left: 0;
          gap: 0;
        }
        .${p}-nav-rail-item:hover {
          background: rgb(var(--text-primary) / 0.06);
        }
        .${p}-nav-rail-item:hover svg {
          opacity: 1 !important;
        }
        .${p}-nav-rail-item[data-active="true"] {
          color: rgb(var(--accent));
          background: rgba(var(--accent), 0.08);
        }
        .${p}-nav-rail-label {
          font-size: 13px;
          font-weight: 500;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          /* 修复 button 默认 text-align:center + flex-1 撑满后文字居中问题 */
          text-align: left;
        }
        .${p}-nav-rail[data-expanded="false"] .${p}-nav-rail-label {
          display: none;
        }
        .${p}-nav-rail-divider {
          width: 100%;
          height: 1px;
          background: rgba(var(--border), 0.3);
          margin: 6px 0;
          transition: width 200ms ease;
        }
        .${p}-nav-rail[data-expanded="false"] .${p}-nav-rail-divider {
          width: 24px;
          margin-left: auto;
          margin-right: auto;
        }
        .${p}-nav-rail-history-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 2px;
          margin-bottom: 2px;
          flex-shrink: 0;
        }
        .${p}-nav-rail[data-expanded="false"] .${p}-nav-rail-history-header {
          display: none;
        }
        .${p}-nav-rail-history-title {
          font-size: 11px;
          font-weight: 600;
          color: rgb(var(--text-muted));
          opacity: 0.6;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .${p}-nav-rail-history-new-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 20px;
          height: 20px;
          border-radius: 4px;
          border: none;
          background: transparent;
          color: rgb(var(--text-muted));
          cursor: pointer;
          transition: all 0.15s ease;
          opacity: 0.5;
        }
        .${p}-nav-rail-history-new-btn:hover {
          background: rgba(var(--surface-hover), 0.5);
          color: rgb(var(--accent));
          opacity: 1;
        }
        .${p}-nav-rail-user {
          position: relative;
          width: 100%;
          flex-shrink: 0;
        }
        .${p}-nav-rail[data-expanded="false"] .${p}-nav-rail-user {
          width: 38px;
        }
        .${p}-nav-rail-user-btn {
          width: 100%;
          height: 40px;
          border-radius: 8px;
          display: flex;
          align-items: center;
          padding: 0 8px;
          gap: 8px;
          transition: all 0.2s ease;
          cursor: pointer;
          border: none;
          background: transparent;
          color: rgb(var(--text-primary));
        }
        .${p}-nav-rail[data-expanded="false"] .${p}-nav-rail-user-btn {
          width: 38px;
          justify-content: center;
          padding: 0;
        }
        .${p}-nav-rail-user-btn:hover {
          background: rgba(var(--surface-hover), 0.5);
        }
        .${p}-nav-rail-user-name {
          font-size: 13px;
          font-weight: 500;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          flex: 1;
          text-align: left;
        }
        .${p}-nav-rail[data-expanded="false"] .${p}-nav-rail-user-name {
          display: none;
        }
        .${p}-nav-rail-user-chevron {
          flex-shrink: 0;
          opacity: 0.6;
          transition: transform 0.2s ease;
        }
        .${p}-nav-rail[data-expanded="false"] .${p}-nav-rail-user-chevron {
          display: none;
        }
        .${p}-nav-rail-login-btn {
          width: 100%;
          height: 36px;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          transition: all 0.2s ease;
          cursor: pointer;
          border: none;
          background: rgb(var(--accent));
          color: white;
          font-size: 12px;
          font-weight: 500;
          box-shadow: 0 1px 3px rgba(var(--accent-rgb), 0.3);
        }
        .${p}-nav-rail[data-expanded="false"] .${p}-nav-rail-login-btn {
          width: 38px;
          height: 38px;
          border-radius: 50%;
          background: rgb(var(--accent));
        }
        .${p}-nav-rail-login-btn:hover {
          opacity: 0.9;
          transform: translateY(-1px);
          box-shadow: 0 2px 6px rgba(var(--accent-rgb), 0.4);
        }
        .${p}-nav-rail-login-btn:active {
          transform: translateY(0);
        }
      `}</style>

      {/* 仪表盘入口：场景用它自己的第一屏取代宿主仪表盘时可关闭 */}
      {showDashboardEntry && (
        <div className={`${p}-nav-rail-brand`} data-active={isDashboardActive} onClick={handleBrandClick}>
          <div className={`${p}-nav-rail-brand-icon`}>
            <Logo className="w-full h-full" />
          </div>
          <span className={`${p}-nav-rail-brand-name`}>仪表盘</span>
        </div>
      )}

      {/* 展开态：收起入口落在面板顶部右侧，与标题栏左侧的展开按钮互为镜像 */}
      {navRailExpanded && (
        <div className={`${p}-nav-rail-collapse-wrap no-drag`}>
          <HintOverlay content={t('layout.collapsemenu', language as Language)} side="right" delay={400}>
            <button
              type="button"
              className={`${p}-nav-rail-collapse-btn no-drag`}
              onClick={() => setNavRailExpanded(false)}
            >
              <PanelLeftIcon filled className="w-4 h-4" />
            </button>
          </HintOverlay>
        </div>
      )}


      {/* 新建任务：默认所有场景共有的固定入口，场景可通过 ui.chrome.hideNewTask 关闭 */}
      {showNewTaskEntry && (navRailExpanded ? (
        <button
          onClick={handleNewTask}
          className={`${p}-nav-rail-item hover:bg-text-primary/[0.06]`}
          data-active={newTaskActive}
        >
          <MessageSquarePlus
            className={`w-[18px] h-[18px] transition-all duration-200 flex-shrink-0 ${newTaskActive ? 'scale-105' : 'opacity-60'}`}
            strokeWidth={newTaskActive ? 2 : 1.5}
          />
          <span className={`${p}-nav-rail-label ${newTaskActive ? 'text-accent' : ''}`}>
            {language === 'zh' ? '新建任务' : 'New Task'}
          </span>
        </button>
      ) : (
        <HintOverlay content={language === 'zh' ? '新建任务' : 'New Task'} side="right" delay={400}>
          <button
            onClick={handleNewTask}
            className={`${p}-nav-rail-item hover:bg-text-primary/[0.06]`}
            data-active={newTaskActive}
          >
            <NavPill active={newTaskActive} />
            <MessageSquarePlus
              className={`w-[18px] h-[18px] transition-all duration-200 ${newTaskActive ? 'scale-105' : 'opacity-60'}`}
              strokeWidth={newTaskActive ? 2 : 1.5}
            />
          </button>
        </HintOverlay>
      ))}

      <div className="flex-shrink-0 w-full flex flex-col gap-0.5">
        {sidebarItems.map((item) => {
          const IconComponent = getLucideIcon(item.icon)
          const baseLabel = language === 'zh' ? item.labelZh : item.label
          // 待办项在标签后直接显示未完成数量，如「待办（5）」
          const label =
            item.id === TODO_HUB_ITEM_ID && pendingTodoCount > 0
              ? `${baseLabel}（${pendingTodoCount}）`
              : baseLabel
          // 邮件中心 / 待办中心各自挂一个角标（待办已在标签显示数量，不再重复挂角标）
          const badge =
            item.id === MAIL_CENTER_ITEM_ID
              ? mailUnread
              : item.id === TODO_HUB_ITEM_ID
                ? pendingTodoCount
                : 0
          const isActive =
            drawerTarget?.panelId === item.id ||
            (!showWelcomePage && !showSettingsPage && !showUserProfilePage && activeSidePanel === item.id)
          const onSelect = () => handleMenuItemClick(item.id, isActive)
          return navRailExpanded ? (
            <button
              key={item.id}
              onClick={onSelect}
              className={`${p}-nav-rail-item hover:bg-text-primary/[0.06]`}
              data-active={isActive}
            >
              <IconComponent
                className={`w-[18px] h-[18px] transition-all duration-200 flex-shrink-0 ${isActive ? 'scale-105' : 'opacity-60'}`}
                strokeWidth={isActive ? 2 : 1.5}
              />
              <span className={`${p}-nav-rail-label ${isActive ? 'text-accent' : ''}`}>
                {label}
              </span>
              {badge > 0 && item.id !== TODO_HUB_ITEM_ID && (
                <MenuBadge
                  count={badge}
                  title={language === 'zh' ? '有未读邮件' : 'Unread mail'}
                />
              )}
            </button>
          ) : (
            <HintOverlay key={item.id} content={label} side="right" delay={400}>
              <button
                onClick={onSelect}
                className={`${p}-nav-rail-item hover:bg-text-primary/[0.06]`}
                data-active={isActive}
              >
                <NavPill active={isActive} />
                <span className="relative inline-flex">
                  <IconComponent
                    className={`w-[18px] h-[18px] transition-all duration-200 ${isActive ? 'scale-105' : 'opacity-60'}`}
                    strokeWidth={isActive ? 2 : 1.5}
                  />
                  {badge > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 min-w-[14px] h-[14px] px-[3px] flex items-center justify-center text-[9px] font-semibold bg-accent text-white rounded-full leading-none">
                      {badge > 99 ? '99+' : badge}
                    </span>
                  )}
                </span>
              </button>
            </HintOverlay>
          )
        })}
      </div>

      {/* 自定义菜单：用户通过「自定义菜单」入口添加的网页菜单（内部浏览器打开） */}
      {customMenus.length > 0 && (
        <div className="flex flex-col gap-0.5 mt-1">
          {customMenus.map((menu) => {
            const MenuIcon = getLucideIcon(menu.icon)
            const isCustomMenuActive = !showWelcomePage && activeCustomMenuId === menu.id
            return navRailExpanded ? (
              <button
                key={menu.id}
                title={menu.url}
                onClick={() => handleOpenCustomMenu(menu)}
                className={`${p}-nav-rail-item hover:bg-text-primary/[0.06] group`}
                data-active={isCustomMenuActive}
              >
                <MenuIcon className={`w-[18px] h-[18px] transition-all duration-200 flex-shrink-0 ${isCustomMenuActive ? 'scale-105' : 'opacity-60'}`} strokeWidth={isCustomMenuActive ? 2 : 1.5} />
                <span className={`${p}-nav-rail-label flex-1 truncate ${isCustomMenuActive ? 'text-accent' : ''}`}>{menu.name}</span>
                <span
                  role="button"
                  title={t('layout.deletemenu', language as Language)}
                  onClick={(e) => { e.stopPropagation(); removeCustomMenu(menu.id) }}
                  className="w-5 h-5 mr-1 rounded flex items-center justify-center text-text-muted opacity-0 group-hover:opacity-100 hover:text-red-500 hover:bg-red-500/10 transition-all flex-shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </span>
              </button>
            ) : (
              <HintOverlay key={menu.id} content={menu.name} side="right" delay={400}>
                <button
                  onClick={() => handleOpenCustomMenu(menu)}
                  className={`${p}-nav-rail-item hover:bg-text-primary/[0.06]`}
                  data-active={isCustomMenuActive}
                >
                  <NavPill active={isCustomMenuActive} />
                  <MenuIcon className={`w-[18px] h-[18px] transition-all duration-200 ${isCustomMenuActive ? 'scale-105' : 'opacity-60'}`} strokeWidth={isCustomMenuActive ? 2 : 1.5} />
                </button>
              </HintOverlay>
            )
          })}
        </div>
      )}

      {/* 自定义菜单添加入口 */}
      {(() => {
        const customMenuLabel = t('layout.custommenu', language as Language)
        return navRailExpanded ? (
          <button
            onClick={() => { closeInternalBrowser(); setShowAddCustomMenu(true) }}
            className={`${p}-nav-rail-item hover:bg-text-primary/[0.06]`}
            style={{ marginTop: customMenus.length > 0 ? 2 : 6 }}
          >
            <Plus
              className="w-[18px] h-[18px] transition-all duration-200 flex-shrink-0 opacity-60"
              strokeWidth={1.5}
            />
            <span className={`${p}-nav-rail-label`}>
              {customMenuLabel}
            </span>
          </button>
        ) : (
          <HintOverlay content={customMenuLabel} side="right" delay={400}>
            <button
              onClick={() => { closeInternalBrowser(); setShowAddCustomMenu(true) }}
              className={`${p}-nav-rail-item hover:bg-text-primary/[0.06]`}
              style={{ marginTop: 6 }}
            >
              <NavPill active={false} />
              <Plus className="w-[18px] h-[18px] transition-all duration-200 opacity-60" strokeWidth={1.5} />
            </button>
          </HintOverlay>
        )
      })()}

      {!hideChatHistory && (
        <div className={`${p}-nav-rail-divider`} style={{ marginTop: 20, marginBottom: 20 }} />
      )}

      {/* 历史会话：场景自带项目列表时收起，避免与场景内的工作区入口重复 */}
      {!hideChatHistory && <ChatHistoryPart expanded={navRailExpanded} />}

      {/* 历史会话收起后保留弹性占位，让账号区仍贴在底部 */}
      {hideChatHistory && <div className="flex-1" />}


      <div className={`${p}-nav-rail-divider`} />

      {/*
       * 账号区：登录态、用户菜单与登录/更新弹窗都在该部件内部。
       * 场景把账号区挪到顶部右侧时这里不再渲染，否则会出现两个头像与两套菜单。
       */}
      {showRailUser && <RailUserPart expanded={navRailExpanded} />}

      <AddCustomMenuDialog isOpen={showAddCustomMenu} onClose={() => setShowAddCustomMenu(false)} />

    </div>
  )
}
