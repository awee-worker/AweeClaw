import { useState, useRef, useEffect, useCallback } from 'react'
import { MessageSquarePlus, Plus, Blocks, Trash2 } from 'lucide-react'
import { HintOverlay } from '../ui/HintOverlay'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { scenarioRegistry } from '@shared/configuration/scenarios'
import { getLucideIcon } from '../foundation/IconMap'
import { Logo } from '../foundation/BrandMark'
import { useAgentActions } from '@hooks/useAgent'
import type { SidebarItemDescriptor } from '@shared/protocols/scenario'
import type { SidePanel } from '@store/slices'
import { BRAND } from '@shared/brand'
import { t, type Language } from '@renderer/i18n'
import { usePluginExtensions } from '@renderer/plugins/usePluginExtensions'
import AddCustomMenuDialog from '../browser/AddCustomMenuDialog'
import { useMailUnreadCount } from '@renderer/hooks/useMailUnreadCount'
import { useTodoHubStore } from '../todo-hub/todoHubStore'
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


// 场景工具入口是否在导航栏显示。
// 面板本身始终注册在 PanelRegistry 中（可被 AI 工具调用激活），
// 这里只控制导航项：通用助手场景不展示该入口。
const SHOW_SCENE_TOOLS_ENTRY = true

/**
 * 不展示「场景工具」导航项的场景
 *
 * 场景工具面板本身是通用工具台，对已经声明了完整 sidebarItems 的垂直场景来说
 * 只是噪声：这些场景的导航应当完全由自己的面板组成。
 */
const SCENE_TOOLS_HIDDEN_SCENARIOS = ['general-assistant', 'miniprogram-studio']


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
    language,
    setShowWorkflow,
    activeScenarioId,
    navRailExpanded,
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
  } = useStore(useShallow(s => ({
    activeSidePanel: s.activeSidePanel,
    setActiveSidePanel: s.setActiveSidePanel,
    language: s.language,
    setShowWorkflow: s.setShowWorkflow,
    activeScenarioId: s.activeScenarioId,
    navRailExpanded: s.navRailExpanded,
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

  // 场景工具入口按场景显隐：由场景声明（ui.chrome.hideSceneTools）或内置黑名单决定
  const scenarioChrome = scenario?.ui?.chrome
  const showSceneToolsEntry = SHOW_SCENE_TOOLS_ENTRY
    && !SCENE_TOOLS_HIDDEN_SCENARIOS.includes(activeScenarioId)
    && scenarioChrome?.hideSceneTools !== true

  // 新建任务入口：场景自带完整导航时可由场景关掉，避免与场景自身的创建流程重复
  const showNewTaskEntry = scenarioChrome?.hideNewTask !== true

  // 仪表盘入口：场景以自己的首屏取代宿主仪表盘时收起
  const showDashboardEntry = scenarioChrome?.hideDashboard !== true

  // 历史会话：场景以自己的项目列表 / 素材列表取代会话历史时收起
  const hideChatHistory = scenarioChrome?.hideChatHistory === true

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
    const hadSidePanel = useStore.getState().activeSidePanel !== null
    setActiveSidePanel(null)
    closeAllFullPages()

    const open = () => openInternalBrowser(menu.url, menu.name, menu.id)

    // 侧边栏本来就没展开时没有额外重排，不必多等一帧
    if (!hadSidePanel) {
      open()
      return
    }

    requestAnimationFrame(() => requestAnimationFrame(open))
  }, [setActiveSidePanel, closeAllFullPages, openInternalBrowser])

  const handleBrandClick = useCallback(() => {
    setActiveSidePanel(null)
    setShowWelcomePage(true)
    setShowWorkflow(false)
    closeInternalBrowser()
  }, [setActiveSidePanel, setShowWelcomePage, setShowWorkflow, closeInternalBrowser])

  // 新建任务：新建对话（聊天界面）并进入「新建任务页面」。
  // 若当前已选择工作空间，则默认打开工作空间文件面板；未选择工作空间时不打开，避免出现空面板。
  const handleNewTask = useCallback(() => {
    if (useStore.getState().workspace?.roots?.length) {
      setActiveSidePanel('explorer')
    }
    closeAllFullPages()
    // 先关闭内部浏览器（其关闭逻辑会回写"打开前"的聊天显隐），再显式显示聊天窗口，避免被回写覆盖
    closeInternalBrowser()
    setChatVisible(true)
    createThread()
  }, [setActiveSidePanel, closeAllFullPages, setChatVisible, closeInternalBrowser, createThread])

  // 仪表盘（欢迎页）选中态
  const isDashboardActive = showWelcomePage

  // 新建任务不参与高亮：它是动作入口（打开工作空间文件面板 + 新建会话），
  // 当前会话的选中态统一由历史会话列表体现（见 ChatHistoryPart）。
  // 若绑定 activeSidePanel === 'explorer'，会导致仅打开工作空间面板时误高亮。
  const newTaskActive = false


  const handleSceneToolsClick = useCallback(() => {
    closeAllFullPages()
    setShowWorkflow(false)
    setActiveSidePanel(activeSidePanel === 'scene-tools' ? null : 'scene-tools')
    closeInternalBrowser()
  }, [activeSidePanel, setActiveSidePanel, closeAllFullPages, setShowWorkflow, closeInternalBrowser])


  return (
    <div className={`${p}-nav-rail`} data-expanded={navRailExpanded} data-mac={isMac}>
      <style>{`
        .${p}-nav-rail {
          height: 100%;
          width: 200px;
          background: rgb(var(--background-secondary));
          border-right: 1px solid rgba(var(--border), 0.2);
          /* 右侧投影：增强与内容区的层次分离，使用半透明黑避免硬边 */
          box-shadow: 4px 0 12px -4px rgba(0, 0, 0, 0.08), 1px 0 4px -2px rgba(0, 0, 0, 0.08);
          display: flex;
          flex-direction: column;
          /* z-index 高于 AppTitleBar(z-50)，确保顶部阴影不被标题栏背景遮挡 */
          z-index: 60;
          user-select: none;
          padding: 20px 8px 8px 8px;
          transition: width 200ms cubic-bezier(0.4, 0, 0.2, 1), padding 200ms cubic-bezier(0.4, 0, 0.2, 1);
          overflow: hidden;
          flex-shrink: 0;
        }
        .${p}-nav-rail[data-expanded="false"] {
          width: 48px;
          padding: 20px 4px 8px 4px;
          align-items: center;
        }
        .${p}-nav-rail[data-mac="true"] {
          padding-top: 48px;
        }
        .${p}-nav-rail[data-mac="true"][data-expanded="false"] {
          padding-top: 48px;
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
      {showDashboardEntry && (navRailExpanded ? (
        <div className={`${p}-nav-rail-brand`} data-active={isDashboardActive} onClick={handleBrandClick}>
          <div className={`${p}-nav-rail-brand-icon`}>
            <Logo className="w-full h-full" />
          </div>
          <span className={`${p}-nav-rail-brand-name`}>仪表盘</span>
        </div>
      ) : (
        <div className={`${p}-nav-rail-brand`} data-active={isDashboardActive} onClick={handleBrandClick}>
          <div className={`${p}-nav-rail-brand-icon`}>
            <Logo className="w-full h-full" />
          </div>
        </div>
      ))}

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
            !showWelcomePage && !showSettingsPage && !showUserProfilePage && activeSidePanel === item.id
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

      {/* 场景工具入口：随场景模式提供内置工具面板（通用助手场景不展示） */}
      {showSceneToolsEntry && (() => {
        const isSceneToolsActive = !showWelcomePage && activeSidePanel === 'scene-tools'
        const sceneToolsLabel = t('layout.scenetools', language as Language)
        return navRailExpanded ? (
          <button
            onClick={handleSceneToolsClick}
            className={`${p}-nav-rail-item hover:bg-text-primary/[0.06]`}
            data-active={isSceneToolsActive}
            style={{ marginTop: 4 }}
          >
            <Blocks
              className={`w-[18px] h-[18px] transition-all duration-200 flex-shrink-0 ${isSceneToolsActive ? 'scale-105' : 'opacity-60'}`}
              strokeWidth={isSceneToolsActive ? 2 : 1.5}
            />
            <span className={`${p}-nav-rail-label ${isSceneToolsActive ? 'text-accent' : ''}`}>
              {sceneToolsLabel}
            </span>
          </button>
        ) : (
          <HintOverlay content={sceneToolsLabel} side="right" delay={400}>
            <button
              onClick={handleSceneToolsClick}
              className={`${p}-nav-rail-item hover:bg-text-primary/[0.06]`}
              data-active={isSceneToolsActive}
              style={{ marginTop: 4 }}
            >
              <NavPill active={isSceneToolsActive} />
              <Blocks
                className={`w-[18px] h-[18px] transition-all duration-200 ${isSceneToolsActive ? 'scale-105' : 'opacity-60'}`}
                strokeWidth={isSceneToolsActive ? 2 : 1.5}
              />
            </button>
          </HintOverlay>
        )
      })()}

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

      {/* 账号区：登录态、用户菜单与登录/更新弹窗都在该部件内部 */}
      <RailUserPart expanded={navRailExpanded} />

      <AddCustomMenuDialog isOpen={showAddCustomMenu} onClose={() => setShowAddCustomMenu(false)} />

    </div>
  )
}
