import { lazy, Suspense, useState, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { MotionConfig } from 'framer-motion'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { useWindowTitle, useAppInit, useGlobalShortcuts, useMenuBridge, useFileWatcher, useAppShutdownState, useWorkspaceRuntimeBootstrap, usePreviewDiscoveryToasts, useChannelBridge, usePluginUpdateChecker, useScenarioUpdateChecker, useFloatingAvatarSync, useVrmCompanionSync, usePptPreviewIpc, useVtsSync } from '@hooks'
import AppTitleBar from './components/layout/AppTitleBar'
import NavigationRail from './components/layout/NavigationRail'
import SidebarSection from './components/layout/SidebarSection'
import MainContentArea from './components/layout/MainContentArea'
import GlobalOverlays from './components/layout/GlobalOverlays'
import { ExecutionStatusDock } from './components/layout/ExecutionStatusDock'
import { scenarioRegistry, initializeScenarios } from '@shared/configuration/scenarios'
import { resolveVisibleMenuIds } from '@shared/protocols/scenario'
import { scenarioLoader, registerBuiltinScenarios } from '@/scenarios'
import { loadExternalScenarios, setExternalScenarioLoadFunctions } from '@scenario-system/core/ExternalScenarioLoader'
import { api } from './adapters/electronBridge'
import { syncInstalledScenarioIcons } from './adapters/scenarioMarketplaceMap'
import { shellComposer, type LayoutConfig } from './shell/ShellComposer'
import {
  getPanelComponent,
  getPanelRegistryVersion,
  registerScenarioPanelComponents,
  subscribePanelRegistry,
} from '@components/explorer/PanelRegistry'
import { ToastProvider, useToast, setGlobalToast } from '@components/foundation/NotificationProvider'
import { MonitoringToastSubscriber } from '@components/foundation/MonitoringToastSubscriber'
import { GlobalDecisionOverlay } from '@components/foundation/DecisionOverlay'
import { GlobalPromptOverlay } from '@components/foundation/PromptOverlay'
import { GlobalGitAuthOverlay } from '@components/foundation/GitAuthPrompt'
import { CrashGuard as ErrorBoundary } from '@components/foundation/CrashGuard'
import { GlobalErrorHandler } from '@components/foundation/AppErrorHandler'
import GlobalToastContainer from '@components/foundation/AppToastContainer'
import { ThemeManager } from '@components/workspace-editor/EditorThemeProvider'
import { FullScreenLoading } from './components/ui/ProgressIndicator'
import { startupMetrics } from '@shared/toolkit/bootMetrics'
import { PluginHostBridge } from '@renderer/plugins/PluginHostBridge'
import { HostCapabilitiesBridge } from '@renderer/plugins/HostCapabilitiesBridge'
import PluginDrawerHost from '@renderer/plugins/PluginDrawerHost'
import { TodoHubCollector } from '@components/todo-hub/TodoHubCollector'
import { initRenderBudget, subscribeRenderBudget } from './services/renderBudget'
import { RegionRenderer } from './shell/RegionRenderer'
import { ScenarioRenderBridge } from './shell/ScenarioRenderBridge'
import { registerDefaultHostParts } from './shell/parts'
import { REGION_MAX_DEPTH_FULL, buildDefaultShellRegions } from '@shared/protocols/scenario-regions'
import type { RegionNode, RegionSlotMap } from '@shared/protocols/scenario-regions'

/**
 * 区域树里是否声明了 chat 部件
 *
 * 声明了就意味着对话的摆放与初值都由场景自己交代（presentation / defaultOpen），
 * 宿主再做默认处理只会和它打架。
 */
function regionsDeclareChat(node: RegionNode | undefined): boolean {
  if (!node) return false
  if (node.type === 'part') return node.id === 'chat'
  if (node.type !== 'split') return false
  return node.children.some(regionsDeclareChat)
}

// 宿主部件注册：与 AweeApp 同 chunk 执行，早于首次渲染，
// 因此区域树里的 part 节点不会先渲染成空白
registerDefaultHostParts()

startupMetrics.mark('app-module-loaded')

const WorkflowWorkbench = lazy(() => import('@components/workflow/Workbench/WorkflowWorkbench'))
const WelcomePage = lazy(() => import('@components/welcome/WelcomePage'))
const PreferencesDialog = lazy(() => import('@components/settings/PreferencesDialog'))
const UserProfilePage = lazy(() => import('@components/user/UserProfilePage'))
const BillingCenterPage = lazy(() => import('@components/user/BillingCenterPage'))
const SessionHistoryPage = lazy(() => import('@components/user/SessionHistoryPage'))
const ContactsPage = lazy(() => import('@components/contacts/ContactsPage'))
const PluginCenterPage = lazy(() => import('@components/plugin/PluginCenterPage'))
const ScenarioManagerView = lazy(() => import('@components/scenario/ScenarioManagerView').then(m => ({ default: m.ScenarioManagerView })))
const PlanPanelDrawer = lazy(() => import('./components/plan/PlanPanelDrawer').then(m => ({ default: m.PlanPanelDrawer })))
const LiveDanmuPanel = lazy(() => import('./components/live/LiveDanmuPanel').then(m => ({ default: m.LiveDanmuPanel })))

initializeScenarios()
registerBuiltinScenarios()

setExternalScenarioLoadFunctions(
  (scenarioId: string) => api.scenarioInstall.loadScenarioFiles(scenarioId),
)

/**
 * 外部场景是异步加载的：bundle 要走 scenario-bundle:// 协议 fetch + 动态 import，
 * 比首屏渲染慢。加载完成后会更新 scenarioRegistry 里的 ui 配置（sidebarItems 等），
 * 但 registry 不是响应式的，React 收不到通知 —— 结果就是「场景已装好、菜单没出现」，
 * 用户必须手动切一次场景才能刷出来。加载结束后主动递增配置版本号，强制重算布局。
 */
loadExternalScenarios()
  .then((loaded) => {
    if (loaded > 0) {
      useStore.getState().incrementScenarioConfigVersion()
    }
  })
  .catch(() => {
    /* 单个场景加载失败已在 loader 内部记录，不阻断首屏 */
  })

/**
 * 已安装场景图标补齐
 *
 * 已安装场景要显示它在场景应用市场里的图标，早前安装的场景本地只有场景包自带的
 * icon。这里在首屏之后补一次，补到图标才触发重渲染，避免顶部场景切换器一直
 * 停在旧图标上。离线或未登录时静默跳过。
 */
syncInstalledScenarioIcons()
  .then((applied) => {
    if (applied > 0) {
      useStore.getState().incrementScenarioConfigVersion()
    }
  })
  .catch(() => {
    /* 补图失败不影响启动 */
  })

function ToastInitializer() {
  const toastContext = useToast()

  useEffect(() => {
    setGlobalToast(toastContext)
  }, [toastContext])

  return null
}

function AppContent() {
  useAppShutdownState()
  // 索引线程与 plan / 图执行状态恢复：与界面无关，进主界面就要跑
  useWorkspaceRuntimeBootstrap()

  // 全局动效开关：由 Agent 执行状态、窗口可见性与实测帧率三者共同驱动
  useEffect(() => initRenderBudget(), [])

  const {
    workspace, activeSidePanel, activeFilePath,
    showWorkflow, setShowWorkflow,
    showSettingsPage, showWelcomePage, showUserProfilePage, showBillingCenterPage,
    showSessionHistoryPage, showPluginCenterPage, showScenarioPage, showContactsPage,
    activeScenarioId, scenarioConfigVersion, language,
    isAuthenticated, setShowWelcomePage, setChatVisible, setActiveSidePanel,
  } = useStore(useShallow((state) => ({
    workspace: state.workspace,
    activeSidePanel: state.activeSidePanel,
    activeFilePath: state.activeFilePath,
    showWorkflow: state.showWorkflow,
    setShowWorkflow: state.setShowWorkflow,
    showSettingsPage: state.showSettingsPage,
    showWelcomePage: state.showWelcomePage,
    showUserProfilePage: state.showUserProfilePage,
    showBillingCenterPage: state.showBillingCenterPage,
    showSessionHistoryPage: state.showSessionHistoryPage,
    showPluginCenterPage: state.showPluginCenterPage,
    showScenarioPage: state.showScenarioPage,
    showContactsPage: state.showContactsPage,
    activeScenarioId: state.activeScenarioId,
    scenarioConfigVersion: state.scenarioConfigVersion,
    language: state.language,
    isAuthenticated: state.isAuthenticated,
    setShowWelcomePage: state.setShowWelcomePage,
    setChatVisible: state.setChatVisible,
    setActiveSidePanel: state.setActiveSidePanel,
  })))

  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [isInitialized, setIsInitialized] = useState(false)
  // 环境检测弹窗：从 store 读取状态
  const { showEnvironmentSetup, setShowEnvironmentSetup } = useStore(useShallow(s => ({
    showEnvironmentSetup: s.showEnvironmentSetup,
    setShowEnvironmentSetup: s.setShowEnvironmentSetup,
  })))

  useEffect(() => {
    if (activeSidePanel === 'shell' || activeFilePath) {
      useStore.getState().setNavRailExpanded(false)
    }
  }, [activeSidePanel, activeFilePath])

  // v2.3.1：打开文件/预览/PPT 预览时，自动缩小聊天窗口到最小宽度，给编辑器更多空间
  //
  // 推出两帧执行：改宽度会让主内容区整片重新分配，而打开文件的同一帧还在做编辑器
  // 区域首次挂载与懒加载 chunk 执行。几件事压在一帧里，主线程做不完，观感就是
  // 「画面缩放一下 + 卡顿」。先让新布局与首帧绘制落地，再收窄聊天栏。
  useEffect(() => {
    if (!activeFilePath) return

    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        const { setChatWidth, chatWidth } = useStore.getState()
        // 仅当聊天窗口比最小宽度大时才缩小（避免用户手动调宽后又被打回）
        if (chatWidth > 480) {
          setChatWidth(460) // CHAT_MIN_WIDTH
        }
      })
    })

    return () => {
      cancelAnimationFrame(outer)
      if (inner) cancelAnimationFrame(inner)
    }
  }, [activeFilePath])

  useEffect(() => {
    window.__AWEECLAW_STORE__ = { getState: () => useStore.getState() }
  }, [])

  // 监听 AI Agent 调用的场景工具面板自动打开事件
  useEffect(() => {
    const handler = (e: Event) => {
      const toolId = (e as CustomEvent).detail as string
      if (toolId) {
        setActiveSidePanel('scene-tools')
      }
    }
    window.addEventListener('aweeclaw:scene-panel-open', handler)
    return () => window.removeEventListener('aweeclaw:scene-panel-open', handler)
  }, [setActiveSidePanel])

  // 监听场景请求显隐 AI 助手面板
  //
  // 面板声明 hideChat 后对话默认隐藏，场景内「把问题交给 AI」这类动作
  // 需要先把对话唤出来，否则消息进了会话用户也看不见。
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ visible?: boolean }>).detail
      useStore.getState().setChatVisible(detail?.visible !== false)
    }
    window.addEventListener('aweeclaw:chat-visible', handler)
    return () => window.removeEventListener('aweeclaw:chat-visible', handler)
  }, [])

  // 监听 AI Agent 写入通讯录：自动打开通讯录页面
  useEffect(() => {
    const handler = () => useStore.getState().setShowContactsPage(true)
    window.addEventListener('aweeclaw:contacts-open', handler)
    return () => window.removeEventListener('aweeclaw:contacts-open', handler)
  }, [])

  // 监听菜单"键盘快捷键"命令派发的全局事件
  useEffect(() => {
    const handleShowShortcuts = () => setShowKeyboardShortcuts(true)
    window.addEventListener('app:show-keyboard-shortcuts', handleShowShortcuts as EventListener)
    return () => window.removeEventListener('app:show-keyboard-shortcuts', handleShowShortcuts as EventListener)
  }, [])

  useEffect(() => {
    if (!activeScenarioId) return
    const previousId = scenarioLoader.getAllPlugins().find(p => scenarioLoader.isActive(p.id))?.id
    if (previousId && previousId !== activeScenarioId) {
      scenarioLoader.deactivate(previousId)
    }
    if (scenarioLoader.has(activeScenarioId) && !scenarioLoader.isActive(activeScenarioId)) {
      scenarioLoader.activate(activeScenarioId, workspace?.roots?.[0] || null)
    }
  }, [activeScenarioId, workspace])

  /**
   * 把场景声明的菜单栏范围同步给主进程
   *
   * macOS 用系统菜单栏、Windows/Linux 用自绘菜单栏，两侧都按同一份 ids 收窄，
   * 避免两套菜单显示成不同结构。null 表示恢复完整菜单。
   */
  useEffect(() => {
    if (!activeScenarioId) return
    const chrome = scenarioRegistry.get(activeScenarioId)?.ui?.chrome
    api.menu.setScenarioMenus(resolveVisibleMenuIds(chrome?.menuBar))
  }, [activeScenarioId, scenarioConfigVersion])

  const hasWorkspace = useMemo(() => Boolean(workspace && workspace.roots.length > 0), [workspace])

  /**
   * 独立全屏欢迎页：只在「尚未选择工作空间」时由它独占界面。
   *
   * 空窗口（新建窗口 / ?empty=1）不会恢复工作空间，欢迎页就是它的起始页；
   * 用户点击卡片（新建任务 / 场景市场 / 场景工具…）后 showWelcomePage 会被置为 false，
   * 此时必须放行到主界面，否则看起来「点击没有反应」——因为界面又被无工作空间兜底逻辑
   * 拉回欢迎页。有工作空间时欢迎页由 MainContentArea 在主布局内渲染，不走这里。
   */
  const showStandaloneWelcomePage = !hasWorkspace && showWelcomePage

  const isShellStudioActive = activeSidePanel === 'shell'

  useWindowTitle()
  useFileWatcher()
  useGlobalShortcuts()
  useMenuBridge()
  usePreviewDiscoveryToasts(hasWorkspace && isInitialized && activeScenarioId === 'dev-assistant')
  useChannelBridge()
  usePluginUpdateChecker()
  useScenarioUpdateChecker()
  useFloatingAvatarSync()
  // 桌面伴侣（VRM）联动：AI 回复时驱动角色口型 + 提取好感度
  useVrmCompanionSync()
  // VTS（VTube Studio）联动：维护口型旁路可用状态 + 回复收尾触发表情/热键
  useVtsSync()
  // v2.3：监听 PPT 预览 IPC 事件，在主窗口打开内嵌 Tab
  usePptPreviewIpc()

  /**
   * 恢复场景时的面板组件注册
   *
   * PanelRegistry 是渲染进程里的内存表，退出客户端即清空。冷启动恢复场景时
   * 只有当前场景生效，但没有任何组件会去补注册：整壳场景（视频工坊这类
   * shellMode='full'）的区域树直接把 panel 节点摆出来，绕开了 DynamicPanelView
   * 与 ScenarioWorkspacePanel 那两条副作用路径，于是整屏都落到「该面板未注册」。
   *
   * 放在 useMemo 而不是 useEffect，是为了在首帧渲染前完成注册，避免先闪一帧占位；
   * 外部场景 bundle 是异步加载的，加载完成后 scenarioConfigVersion 递增，这里会重跑。
   */
  useMemo(() => {
    if (activeScenarioId) registerScenarioPanelComponents(activeScenarioId)
  }, [activeScenarioId, scenarioConfigVersion])

  /** 注册表版本：注册是在渲染期间发生的，依赖它的派生值需要跟着重算 */
  const panelRegistryVersion = useSyncExternalStore(
    subscribePanelRegistry,
    getPanelRegistryVersion,
    getPanelRegistryVersion,
  )

  const layoutConfig = useMemo<LayoutConfig>(() => {
    // 场景安装/重装后，scenarioConfigVersion 递增，强制重新计算布局配置
    // 同时清除 ShellComposer 缓存，确保读取最新的 sidebarItems / wideModePanelIds
    if (scenarioConfigVersion > 0) {
      shellComposer.clearCache()
    }
    const scenario = scenarioRegistry.get(activeScenarioId)
    if (scenario) {
      return shellComposer.getLayoutConfig(scenario)
    }
    const defaultScenario = scenarioRegistry.getDefault()
    return shellComposer.getLayoutConfig(defaultScenario)
  }, [activeScenarioId, scenarioConfigVersion])

  // 当场景切换时应用布局配置中的 sidebar 默认宽度
  useEffect(() => {
    if (layoutConfig.sidebarDefaultWidth > 0) {
      useStore.getState().setSidebarWidth(layoutConfig.sidebarDefaultWidth)
    }
  }, [layoutConfig.sidebarDefaultWidth])

  /**
   * 同步场景无人值守声明
   *
   * 引擎侧的审批门禁不认识场景配置，只读 store，所以由这里把「当前活跃场景是否
   * 无人值守」翻译成一个 ID 写进去；离开该场景时清空，避免豁免被带到别的场景。
   */
  useEffect(() => {
    useStore.getState().setUnattendedScenario(
      layoutConfig.unattended ? layoutConfig.scenarioId : null,
    )
  }, [layoutConfig.unattended, layoutConfig.scenarioId])

  // 切换到声明了 hideChat 的面板时自动隐藏聊天窗口（用户可通过右上角按钮手动切换显示）
  // 与 hideChat 强制隐藏不同，这里是"默认隐藏"：用户点击切换按钮后聊天可正常显示
  //
  // autoHiddenChatRef 记录"这次隐藏是面板自动触发的"，离开该面板时据此恢复；
  // 若隐藏是用户手动所为，则不恢复，避免覆盖用户的选择。
  const autoHiddenChatRef = useRef(false)

  /** 默认工作台的场景 id：落回它时要补一次对话可见性 */
  const defaultWorkbenchId = useMemo(
    () => scenarioRegistry.getDefault()?.id ?? null,
    [scenarioConfigVersion],
  )

  /**
   * 场景切换时重算对话初值
   *
   * 三个问题都在这里收口：
   * - 上一场景的「自动隐藏」标记会被带到新场景，离开该面板时把抽屉重新顶开，
   *   表现为刚切进一个对话默认收起的场景，抽屉却是展开的；
   * - 声明了区域树的场景由自己的 chat 部件（defaultOpen）决定初值，宿主不应插手；
   * - 别的场景可能把对话收起且不还原：抽屉形态的场景（原型工坊、短剧工坊）激活
   *   时直接把 chatVisible 置 false，还有些场景的区域树根本不摆对话部件。这些收起
   *   发生在场景内部，用户切回默认工作台时没有任何入口把它叫回来 —— 而默认工作台
   *   的主区域就是对话本身，收着等于整片区域空着。
   *
   * 因此切换时先清掉标记，再分别处理：场景自带 chat 部件就交给部件；当前面板
   * 仍需要自动收起就保持收起；其余情况在上一场景确实自动收起过、或落回默认
   * 工作台时恢复可见，用户自己关掉的对话不会被强行打开。
   */
  const prevChatScenarioRef = useRef(activeScenarioId)
  useEffect(() => {
    if (prevChatScenarioRef.current === activeScenarioId) return
    prevChatScenarioRef.current = activeScenarioId

    const wasAutoHidden = autoHiddenChatRef.current
    autoHiddenChatRef.current = false

    if (regionsDeclareChat(layoutConfig.regions)) return
    if (activeSidePanel && layoutConfig.autoHideChatPanelIds.includes(activeSidePanel)) return
    if (wasAutoHidden) {
      setChatVisible(true)
      return
    }
    // 切回默认工作台：对话被别的场景收起了就补回来
    if (activeScenarioId === defaultWorkbenchId && !useStore.getState().chatVisible) {
      setChatVisible(true)
    }
  }, [activeScenarioId, layoutConfig, activeSidePanel, setChatVisible, defaultWorkbenchId])

  useEffect(() => {
    if (activeSidePanel && layoutConfig.autoHideChatPanelIds.includes(activeSidePanel)) {
      if (useStore.getState().chatVisible) {
        setChatVisible(false)
        autoHiddenChatRef.current = true
      }
      return
    }
    if (autoHiddenChatRef.current) {
      setChatVisible(true)
      autoHiddenChatRef.current = false
    }
  }, [activeSidePanel, layoutConfig.autoHideChatPanelIds, setChatVisible])

  const isWideModePanel = useMemo(() => {
    if (!activeSidePanel) return false
    if (activeSidePanel === 'scenarios') return true
    return layoutConfig.wideModePanelIds.includes(activeSidePanel)
  }, [activeSidePanel, layoutConfig.wideModePanelIds])

  /**
   * 宽模式面板渲染在全屏页之前，一旦有全屏页（欢迎页 / 设置页等）残留，
   * 界面显示的是面板、导航却按「未选中」渲染，点击会被误判成「打开」。
   * 这里保证面板激活时全屏页一定被清掉，两者状态始终一致。
   */
  useEffect(() => {
    if (!isWideModePanel) return
    const store = useStore.getState()
    if (store.showWelcomePage || store.showSettingsPage || store.showUserProfilePage
      || store.showBillingCenterPage || store.showSessionHistoryPage || store.showPluginCenterPage) {
      store.closeAllFullPages()
    }
  }, [isWideModePanel])

  const scenarioWelcomeComponent = useMemo(() => {
    if (!activeScenarioId) return null
    const scenario = scenarioRegistry.get(activeScenarioId)
    if (!scenario?.ui?.welcomeComponent) return null
    return getPanelComponent(`welcome-${activeScenarioId}`) ?? null
    // panelRegistryVersion：欢迎组件也是注册表里的运行时条目，注册补齐后要重算
  }, [activeScenarioId, panelRegistryVersion])

  const [layoutAnimating, setLayoutAnimating] = useState(false)
  const prevLayoutRef = useRef(layoutConfig.layout)
  useEffect(() => {
    if (prevLayoutRef.current !== layoutConfig.layout) {
      prevLayoutRef.current = layoutConfig.layout
      setLayoutAnimating(true)
      const timer = setTimeout(() => setLayoutAnimating(false), 400)
      return () => clearTimeout(timer)
    }
  }, [layoutConfig.layout])

  useAppInit({
    onInitialized: (result) => {
      setIsInitialized(true)
      if (result.shouldShowOnboarding) {
        setShowOnboarding(true)
      }
      if (!isAuthenticated) {
        setShowWelcomePage(true)
      }
      // 环境检测：引导已完成（非首次启动）且未做过环境检测时弹出
      // 首次启动会先走引导流程，引导完成后由下方 effect 触发环境检测
      if (!result.shouldShowOnboarding) {
        const { environmentCheckCompleted } = useStore.getState()
        if (!environmentCheckCompleted) {
          // 延迟 1s 弹出，让主界面先渲染稳定
          setTimeout(() => setShowEnvironmentSetup(true), 1000)
        }
      }
    },
  })

  // 引导完成（showOnboarding 从 true→false）后触发环境检测
  useEffect(() => {
    if (isInitialized && !showOnboarding) {
      const { environmentCheckCompleted } = useStore.getState()
      if (!environmentCheckCompleted) {
        // 引导刚完成的短延后再弹环境检测，避免视觉跳变
        const timer = setTimeout(() => setShowEnvironmentSetup(true), 500)
        return () => clearTimeout(timer)
      }
    }
  }, [isInitialized, showOnboarding])

  // 侧边栏是否隐藏
  const sidebarHidden = useMemo(() => {
    if (!layoutConfig.showSidebar || !activeSidePanel) return true
    if (isWideModePanel) return true
    if (isShellStudioActive && layoutConfig.chatPosition !== 'primary') return true
    if (showSettingsPage || showWelcomePage || showUserProfilePage || showBillingCenterPage || showSessionHistoryPage || showPluginCenterPage || showScenarioPage) return true
    return false
  }, [layoutConfig.showSidebar, layoutConfig.chatPosition, activeSidePanel, isWideModePanel, isShellStudioActive, showSettingsPage, showWelcomePage, showUserProfilePage, showBillingCenterPage, showSessionHistoryPage, showPluginCenterPage, showScenarioPage])

  // 外壳区域树：场景声明了 regions 就用场景的，否则用默认结构。
  //
  // 场景树在 ShellComposer 里已经过校验（契约版本 / 槽位越界 / 重复引用 / 结构非法），
  // 走到这里的一定是可渲染的树；校验未通过的场景已经在那边回退到默认布局。
  const shellRegions = useMemo(
    () => layoutConfig.regions ?? buildDefaultShellRegions({
      showActivityBar: layoutConfig.showActivityBar,
      animateClass: layoutAnimating ? 'opacity-0' : 'opacity-100',
    }),
    [layoutConfig.regions, layoutConfig.showActivityBar, layoutAnimating],
  )

  // 槽位内容：渲染器只负责摆放，每个槽位挂什么由这里决定
  const shellSlots = useMemo<RegionSlotMap>(() => ({
    rail: <NavigationRail />,
    titlebar: <AppTitleBar />,
    sidebar: <SidebarSection hidden={sidebarHidden} />,
    main: (
      <MainContentArea
        layoutConfig={layoutConfig}
        isWideModePanel={isWideModePanel}
        scenarioWelcomeComponent={scenarioWelcomeComponent}
      />
    ),
  }), [sidebarHidden, layoutConfig, isWideModePanel, scenarioWelcomeComponent])

  return (
    <div className="h-screen flex bg-background overflow-hidden text-text-primary selection:bg-accent/30 selection:text-white relative">

      {showWorkflow && (
        <div className="fixed inset-0 z-[100] bg-background animate-in fade-in duration-200">
          <ErrorBoundary>
            <Suspense fallback={<FullScreenLoading />}>
              <WorkflowWorkbench onClose={() => setShowWorkflow(false)} language={language as 'en' | 'zh'} />
            </Suspense>
          </ErrorBoundary>
        </div>
      )}

      <div className="relative z-10 flex h-full w-full">
        {showStandaloneWelcomePage ? (
          // 无工作空间入口页：独立全屏渲染，点击任一卡片即可退出到主界面
          <div className="flex-1 overflow-hidden">
            <Suspense fallback={<FullScreenLoading />}>
              <WelcomePage />
            </Suspense>
          </div>
        ) : (
          (showSettingsPage || showUserProfilePage || showBillingCenterPage || showSessionHistoryPage || showPluginCenterPage || showScenarioPage || showContactsPage) ? (
            // 全屏页面：设置/用户中心/费用中心/历史会话/插件/工作场景
            // 绕过 NavigationRail / AppTitleBar / SidebarSection
            <div className="flex h-full w-full overflow-hidden">
              <ErrorBoundary>
                <Suspense fallback={<FullScreenLoading />}>
                  {showSettingsPage && <PreferencesDialog embedded />}
                  {showUserProfilePage && <UserProfilePage />}
                  {showBillingCenterPage && <BillingCenterPage />}
                  {showSessionHistoryPage && <SessionHistoryPage />}
                  {showPluginCenterPage && <PluginCenterPage />}
                  {showScenarioPage && <ScenarioManagerView />}
                  {showContactsPage && <ContactsPage />}
                </Suspense>
              </ErrorBoundary>
            </div>
          ) : (
            <ScenarioRenderBridge slots={shellSlots} shellMode={layoutConfig.shellMode}>
              <RegionRenderer
                root={shellRegions}
                slots={shellSlots}
                // 接管整壳的场景可用更深的嵌套，与校验层的档位上限保持一致
                maxDepth={layoutConfig.shellMode === 'full' ? REGION_MAX_DEPTH_FULL : undefined}
              />
            </ScenarioRenderBridge>
          )
        )}
      </div>

      {/* 计划任务面板（右侧抽屉）：固定宽度覆盖层，挂应用根层，不受会话面板宽度影响 */}
      <Suspense fallback={null}>
        <PlanPanelDrawer />
      </Suspense>


      <GlobalOverlays
        showKeyboardShortcuts={showKeyboardShortcuts}
        setShowKeyboardShortcuts={setShowKeyboardShortcuts}
        showOnboarding={showOnboarding}
        setShowOnboarding={setShowOnboarding}
        isInitialized={isInitialized}
        showEnvironmentSetup={showEnvironmentSetup}
        setShowEnvironmentSetup={setShowEnvironmentSetup}
      />

      <GlobalDecisionOverlay />
      <GlobalPromptOverlay />
      {/* Git 凭证输入弹窗：push/pull/fetch/clone 与 AI 的 git_sync 工具共用 */}
      <GlobalGitAuthOverlay />
      <GlobalToastContainer />

      {/* 全局悬浮执行状态面板：有项目任务执行时在右下角显示 */}
      <ExecutionStatusDock />

      {/* 直播弹幕流面板：直播互动开启时在右下角实时展示弹幕（懒加载，关闭时不渲染） */}
      <Suspense fallback={null}>
        <LiveDanmuPanel />
      </Suspense>

      {/* 插件宿主桥接器：代理插件 UI 的宿主能力请求（如发送聊天消息），无 UI */}
      <PluginHostBridge />

      {/* 本地能力桥：语音合成与界面导航（装插件 / 配语音 / 环境检测），无 UI */}
      <HostCapabilitiesBridge />

      {/* 插件抽屉：二级选项的 action 拉起插件面板（如模板选择），无触发时不渲染 */}
      <PluginDrawerHost />

      {/* 待办中心采集器：把会话 / 挂载任务中未完成的事项自动汇入待办清单，无 UI */}
      <TodoHubCollector />
    </div>
  )
}

/**
 * 收敛标记 → MotionConfig 的 reducedMotion 取值。
 *
 * busy / hidden / perfLow 任一成立即强制降级：framer-motion 会跳过 transform 与
 * layout 动画（合成层更新的大头），保留 opacity / 颜色类动画（成本很低，且是「还在跑」
 * 的直接视觉反馈）——口径与 globals.css 中 CSS 动画的收敛保持一致。
 * 常态则用 'user' 跟随系统「减少动态效果」偏好，与样式层的媒体查询同步。
 */
function useReduceMotion(): boolean {
  const [converge, setConverge] = useState(false)

  useEffect(
    () => subscribeRenderBudget((state) => setConverge(state.busy || state.hidden || state.perfLow)),
    [],
  )

  return converge
}

export default function App() {
  const reduceMotion = useReduceMotion()

  return (
    <MotionConfig reducedMotion={reduceMotion ? 'always' : 'user'}>
      <ToastProvider>
        <ToastInitializer />
        <MonitoringToastSubscriber />
        <GlobalErrorHandler>
          <ThemeManager>
            <AppContent />
          </ThemeManager>
        </GlobalErrorHandler>
      </ToastProvider>
    </MotionConfig>
  )
}
