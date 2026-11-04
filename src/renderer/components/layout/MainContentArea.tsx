/**
 * 主内容区域路由组件
 *
 * 根据 layoutConfig 和当前应用状态，决定主内容区域渲染哪个组件。
 * 从 AweeApp.tsx 中提取，将深层嵌套的三元表达式转为清晰的条件分支。
 *
 * 支持的布局模式：
 * - primary (chatPosition=primary): 编辑器+Chat 并列
 * - secondary: 支持多种场景布局（editor-centric, dashboard-centric, canvas-centric 等）
 */

import { Suspense, lazy, useMemo, useEffect } from 'react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { CrashGuard as ErrorBoundary } from '@components/foundation/CrashGuard'
import { EditorSkeleton, PanelSkeleton, FullScreenLoading, InlineSettingsSkeleton } from '@components/ui/ProgressIndicator'
import type { LayoutConfig } from '@renderer/shell/ShellComposer'
import { getScenarioComponent } from '@components/scenario/ScenarioComponentResolver'
import { pluginUiRegistry } from '@renderer/plugins/PluginUiRegistry'
import { RegionRenderer } from '@renderer/shell/RegionRenderer'
import type { RegionSlotMap } from '@shared/protocols/scenario-regions'
import { useFocusChromeCollapse } from '@renderer/hooks/useFocusChromeCollapse'
import { usePanelDrawerTarget } from '@renderer/plugins/pluginDrawerStore'
import ChatSection from './ChatSection'
import { CollapsedChatHint } from './CollapsedChatHint'

/**
 * 插件区域树不引用外壳槽位，所以 slot 映射恒为空。
 *
 * 提到模块级是为了保持引用稳定：每次渲染新建 `{}` 会让 RegionRenderer
 * 的 props 恒变，白白多跑一轮递归。
 */
const NO_SLOTS: RegionSlotMap = {}

const Editor = lazy(() => import('@components/workspace-editor/WorkspaceEditor'))
const TerminalStudio = lazy(() => import('@renderer/shell/components/TerminalStudio'))
const DataDashboard = lazy(() => import('@components/dashboard/InsightDashboard'))
const CanvasWorkspace = lazy(() => import('@components/canvas/WorkspaceCanvas'))
const DynamicPanelView = lazy(() => import('@components/explorer/AdaptivePanelView').then(m => ({ default: m.DynamicPanelView })))
const WelcomePage = lazy(() => import('@components/welcome/WelcomePage'))
const PreferencesDialog = lazy(() => import('@components/settings/PreferencesDialog'))
const UserProfilePage = lazy(() => import('@components/user/UserProfilePage'))
const BillingCenterPage = lazy(() => import('@components/user/BillingCenterPage'))
const SessionHistoryPage = lazy(() => import('@components/user/SessionHistoryPage'))
const PluginCenterPage = lazy(() => import('@components/plugin/PluginCenterPage'))
const EditorBottomBar = lazy(() => import('@components/layout/EditorBottomBar'))
const InternalBrowser = lazy(() => import('@components/browser/InternalBrowser'))

interface MainContentAreaProps {
  layoutConfig: LayoutConfig
  isWideModePanel: boolean
  scenarioWelcomeComponent: React.ComponentType<unknown> | null
}

/** 全屏页面容器（设置、用户中心等） */
function FullPageSlot({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      {children}
    </div>
  )
}

/**
 * 编辑器插槽（带 ErrorBoundary + Suspense）
 *
 * 左侧补一条 border-l，与右侧会话区的 border-l 对称。
 *
 * 只靠侧栏的投影分隔是不够的：投影是半透明黑的扩散，壁纸开启后面板本身也变透明，
 * 投影落在壁纸上看不出边界，两侧面板会连成一整块。边框是一条明确的实线，
 * 与透明度无关，是壁纸模式下唯一稳定可辨的分隔。
 */
function EditorSlot() {
  return (
    <div className="flex-1 min-h-0 flex flex-col relative overflow-hidden min-w-0 border-l border-border/30">
      <ErrorBoundary>
        <Suspense fallback={<EditorSkeleton />}>
          <Editor />
        </Suspense>
      </ErrorBoundary>
    </div>
  )
}

/** 面板插槽 */
function PanelSlot({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary>
      <Suspense fallback={<PanelSkeleton />}>
        {children}
      </Suspense>
    </ErrorBoundary>
  )
}

// ====== Primary 布局（chatPosition=primary）======

function PrimaryMainContent({ layoutConfig, isWideModePanel }: MainContentAreaProps) {
  const { chatVisible, hasOpenFiles, activeFilePath,
    showSettingsPage, showWelcomePage, showUserProfilePage, showBillingCenterPage, showSessionHistoryPage, showPluginCenterPage,
    activeSidePanel, internalBrowserUrl, dockPanelVisible } = useStore(useShallow((s) => ({
    chatVisible: s.chatVisible,
    // 只订阅「是否存在打开的文件」这一布尔量：openFiles 数组会随编辑内容逐键重建，
    // 直接订阅数组会让主内容区（连同编辑器与对话区）在打字时全程重渲染。
    hasOpenFiles: s.openFiles.length > 0,
    activeFilePath: s.activeFilePath,
    showSettingsPage: s.showSettingsPage,
    showWelcomePage: s.showWelcomePage,
    showUserProfilePage: s.showUserProfilePage,
    showBillingCenterPage: s.showBillingCenterPage,
    showSessionHistoryPage: s.showSessionHistoryPage,
    showPluginCenterPage: s.showPluginCenterPage,
    activeSidePanel: s.activeSidePanel,
    internalBrowserUrl: s.internalBrowserUrl,
    // 底部面板（终端等）挂在编辑器区域内：面板可见时即使没有打开文件也要渲染编辑器
    dockPanelVisible: s.dockPanelVisible,
  })))

  /**
   * AI 浏览器是否正以抽屉打开
   *
   * 抽屉里的 AIBrowserView 自带内置浏览器实例。若这里仍按 internalBrowserUrl
   * 去接管主区域，同一个页面会被挂载两次：抽屉下面多出一个看不见的 webview，
   * 每开一次就多一份渲染进程与内存开销。
   */
  const drawerTarget = usePanelDrawerTarget()
  const browserInsideDrawer = drawerTarget?.panelId === 'ai-browser'

  /**
   * 对话抽屉
   *
   * 内置浏览器占满工作区时，对话可以按需从右侧拉出（浏览器工具栏的「AI 助手」），
   * 收起后页面回到整宽。形态只换外框，ChatPanel 实例不变。
   */
  const chatAsDrawer = useStore(s => s.chatAsDrawer)
  const closeChatDrawer = useStore(s => s.closeChatDrawer)
  const chatPresentation = chatAsDrawer ? ('drawer' as const) : ('inline' as const)

  /**
   * 是否由内置浏览器接管左侧工作区
   *
   * AI 浏览器面板自行承载内置浏览器（见 AIBrowserView），其余情况由主内容区接管。
   */
  const showInternalBrowser =
    Boolean(internalBrowserUrl) && activeSidePanel !== 'ai-browser' && !browserInsideDrawer

  // 宽模式面板（chat-centric 场景，聊天为主区域）
  // 是否隐藏聊天由场景配置统一决定（wideModeHidesChat），不再按 panelId 硬编码特例：
  // 通用助手这类对话中心场景声明 wideModeHidesChat: false，面板与对话并列；
  // 未声明的场景沿用默认 true，面板独占主区域。
  if (isWideModePanel && activeSidePanel) {
    const hideChat = layoutConfig.wideModeHidesChat && !layoutConfig.keepChatPanelIds.includes(activeSidePanel)
    // 插件声明了主区域布局时，用它的区域树替代默认的面板视图
    const panelRegions = pluginUiRegistry.getPanelRegions(activeSidePanel)

    return (
      <>
        <FullPageSlot>
          {panelRegions ? (
            <RegionRenderer root={panelRegions} slots={NO_SLOTS} />
          ) : (
            <PanelSlot>
              <DynamicPanelView panelId={activeSidePanel} />
            </PanelSlot>
          )}
        </FullPageSlot>
        {layoutConfig.showChat && !hideChat && (chatVisible || chatAsDrawer) && (
          <ChatSection
            visible
            mode="secondary"
            presentation={chatPresentation}
            onClose={closeChatDrawer}
          />
        )}
      </>
    )
  }

  // 全屏页面
  if (showWelcomePage) {
    return <FullPageSlot><ErrorBoundary><Suspense fallback={<FullScreenLoading />}><WelcomePage /></Suspense></ErrorBoundary></FullPageSlot>
  }
  if (showSettingsPage) {
    return <FullPageSlot><ErrorBoundary><Suspense fallback={<InlineSettingsSkeleton />}><PreferencesDialog embedded /></Suspense></ErrorBoundary></FullPageSlot>
  }
  if (showUserProfilePage) {
    return <FullPageSlot><ErrorBoundary><Suspense fallback={<InlineSettingsSkeleton />}><UserProfilePage /></Suspense></ErrorBoundary></FullPageSlot>
  }
  if (showBillingCenterPage) {
    return <FullPageSlot><ErrorBoundary><Suspense fallback={<InlineSettingsSkeleton />}><BillingCenterPage /></Suspense></ErrorBoundary></FullPageSlot>
  }
  if (showSessionHistoryPage) {
    return <FullPageSlot><ErrorBoundary><Suspense fallback={<InlineSettingsSkeleton />}><SessionHistoryPage /></Suspense></ErrorBoundary></FullPageSlot>
  }
  if (showPluginCenterPage) {
    return <FullPageSlot><ErrorBoundary><Suspense fallback={<InlineSettingsSkeleton />}><PluginCenterPage /></Suspense></ErrorBoundary></FullPageSlot>
  }

  // 始终渲染 ChatSection，避免 activeFilePath / 内置浏览器切换时卸载重新挂载
  //
  // 左侧工作区在「内置浏览器 / 编辑器 / 空」之间切换，ChatSection 始终是同一个位置的
  // 同一个元素（key 固定）。打开内置浏览器时不再整体换成另一棵树：那会把 ChatPanel
  // 一起卸载重建，而它携带整段消息 DOM、虚拟列表与滚动状态，重建一次就是主窗口
  // 卡顿并伴随画面跳动的直接原因。
  const hasFile = hasOpenFiles && activeFilePath !== null
  // 底部面板（终端等）挂在编辑器区域内部：面板可见时即使没有打开文件，
  // 编辑器区域也要渲染（WorkspaceEditor 无文件时渲染 EditorWelcome + DockPanel），
  // 否则菜单「新建终端」只改了状态，界面上什么都不会出现。
  const hasWorkspace = hasFile || showInternalBrowser || dockPanelVisible
  return (
    <div className="flex-1 flex min-h-0 overflow-hidden">
      {showInternalBrowser ? (
        <InternalBrowserSlot key="internal-browser" />
      ) : hasFile || dockPanelVisible ? (
        <EditorSlot key="editor" />
      ) : chatVisible ? null : (
        // 主区域既没有工作内容，对话面板也收起了：整块区域会空着，
        // 这里顶上一块说明，告诉用户从右上角开关恢复
        <CollapsedChatHint key="chat-collapsed-hint" />
      )}
      <ChatSection
        key="chat"
        visible={chatVisible || chatAsDrawer}
        mode="primary"
        hasFile={hasWorkspace}
        presentation={chatPresentation}
        onClose={closeChatDrawer}
      />
    </div>
  )
}

// ====== Secondary 布局（chatPosition !== primary）======

function SecondaryMainContent({ layoutConfig, isWideModePanel, scenarioWelcomeComponent }: MainContentAreaProps) {
  const { chatVisible, hasOpenFiles, activeFilePath,
    showSettingsPage, showWelcomePage, showUserProfilePage, showBillingCenterPage, showSessionHistoryPage, showPluginCenterPage,
    activeSidePanel, internalBrowserUrl, dockPanelVisible } = useStore(useShallow((s) => ({
    chatVisible: s.chatVisible,
    // 只订阅「是否存在打开的文件」这一布尔量：openFiles 数组会随编辑内容逐键重建，
    // 直接订阅数组会让主内容区（连同编辑器与对话区）在打字时全程重渲染。
    hasOpenFiles: s.openFiles.length > 0,
    activeFilePath: s.activeFilePath,
    showSettingsPage: s.showSettingsPage,
    showWelcomePage: s.showWelcomePage,
    showUserProfilePage: s.showUserProfilePage,
    showBillingCenterPage: s.showBillingCenterPage,
    showSessionHistoryPage: s.showSessionHistoryPage,
    showPluginCenterPage: s.showPluginCenterPage,
    activeSidePanel: s.activeSidePanel,
    internalBrowserUrl: s.internalBrowserUrl,
    // 与 Primary 布局一致：面板可见时需要有编辑器区域承载
    dockPanelVisible: s.dockPanelVisible,
  })))

  const isShellStudioActive = activeSidePanel === 'shell'

  // 对话抽屉：与 Primary 分支同一份状态，形态由浏览器工具栏的「AI 助手」切换
  const chatAsDrawer = useStore(s => s.chatAsDrawer)
  const closeChatDrawer = useStore(s => s.closeChatDrawer)
  const chatPresentation = chatAsDrawer ? ('drawer' as const) : ('inline' as const)

  // 当前激活的侧边栏面板是否要求隐藏编辑器（含编辑器欢迎页）
  // 适用于纯列表型面板（项目列表/模板列表），避免无文件时编辑器欢迎页占据主区域
  const shouldHideEditor = useMemo(() => {
    if (!activeSidePanel) return false
    const items = layoutConfig.sidebarItems
    if (!items || items.length === 0) return false
    const item = items.find(it => it.id === activeSidePanel)
    // 底部面板可见时不隐藏编辑器：终端等面板挂在编辑器区域内，隐藏编辑器等于把面板一起藏掉
    return item?.hideEditor === true && !dockPanelVisible
  }, [activeSidePanel, layoutConfig.sidebarItems, dockPanelVisible])

  // 是否隐藏 Chat
  // hideChat 面板由 AweeApp 中的 useEffect 自动设置 chatVisible=false（默认隐藏）
  // 用户可通过右上角按钮手动切换 chatVisible，此处仅由 chatVisible 控制显隐
  const shouldHideChat = useMemo(() => {
    if (!chatVisible) return true
    // 宽模式面板是否独占主区域完全由场景配置决定：
    // - wideModeHidesChat（场景级，默认 true）控制整体行为
    // - keepChat（面板级）为个别面板保留对话，不受场景级设置影响
    // 需要"默认隐藏但允许用户恢复"的面板请声明 hideChat（见 AweeApp 的 autoHideChatPanelIds）
    if (isWideModePanel && layoutConfig.wideModeHidesChat
      && !layoutConfig.keepChatPanelIds.includes(activeSidePanel ?? '')) return true
    // 仅在非编辑器布局下隐藏 chat：编辑器布局由 EditorSlot 处理空状态（EditorWelcome），
    // 不渲染 scenarioWelcomeComponent，此时隐藏 chat 会导致用户无法与 AI 交互
    if (scenarioWelcomeComponent && !layoutConfig.showEditor && activeSidePanel === 'explorer' && !(hasOpenFiles && activeFilePath)) return true
    return false
  }, [chatVisible, isWideModePanel, activeSidePanel, layoutConfig.wideModeHidesChat, layoutConfig.keepChatPanelIds, layoutConfig.showEditor, scenarioWelcomeComponent, hasOpenFiles, activeFilePath])

  /**
   * 场景主区域组件
   *
   * 由场景声明 ui.primaryView 决定（ShellComposer 已合并历史兼容映射），
   * 这里只负责按 scenarioId + component 键名从场景模块取组件。
   * 解析不到时返回 null，由各布局回退到自己的通用组件——场景被卸载或组件改名
   * 都不该让主内容区变成空白。
   */
  const PrimaryViewComponent = useMemo(() => {
    const declared = layoutConfig.primaryView
    if (!declared) return null
    return getScenarioComponent(layoutConfig.scenarioId, declared.component) ?? null
  }, [layoutConfig.primaryView, layoutConfig.scenarioId])

  /**
   * 内置浏览器（自定义菜单）：只顶掉左侧工作区，右侧 ChatSection 原位保留
   *
   * 这里的返回结构与下方「编辑器模式」分支必须同形（Fragment > [工作区 div, ChatSection]）。
   * 原先这一分支写在 MainContentArea 顶层提前 return 另一棵树，ChatSection 的位置随之
   * 改变，React 只能把编辑器与 ChatPanel 整棵卸载后重建 —— ChatPanel 携带整段消息 DOM、
   * 虚拟列表与滚动状态，重建一次就是打开内置浏览器时那一下卡顿和画面跳动。
   */
  // AI 浏览器以抽屉打开时，页面在抽屉里渲染，主区域不能再接一份（见 PrimaryMainContent 同名判断）
  const drawerTarget = usePanelDrawerTarget()
  const showInternalBrowser =
    Boolean(internalBrowserUrl) && activeSidePanel !== 'ai-browser' && drawerTarget?.panelId !== 'ai-browser'
  if (showInternalBrowser) {
    return (
      <>
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <InternalBrowserSlot />
        </div>
        {layoutConfig.showChat && (
          <ChatSection
            key="chat"
            visible={chatAsDrawer || !shouldHideChat}
            mode="secondary"
            presentation={chatPresentation}
            onClose={closeChatDrawer}
          />
        )}
      </>
    )
  }

  // 宽模式面板
  if (isWideModePanel && activeSidePanel) {
    // 插件声明了主区域布局时，用它的区域树替代默认的面板视图
    const panelRegions = pluginUiRegistry.getPanelRegions(activeSidePanel)

    return (
      <>
        <FullPageSlot>
          {panelRegions ? (
            <RegionRenderer root={panelRegions} slots={NO_SLOTS} />
          ) : (
            <PanelSlot>
              <DynamicPanelView panelId={activeSidePanel} />
            </PanelSlot>
          )}
        </FullPageSlot>
        {layoutConfig.showChat && (
          <ChatSection
            key="chat"
            visible={chatAsDrawer || !shouldHideChat}
            mode="secondary"
            presentation={chatPresentation}
            onClose={closeChatDrawer}
          />
        )}
      </>
    )
  }

  // 全屏页面
  if (showWelcomePage) {
    return <FullPageSlot><ErrorBoundary><Suspense fallback={<FullScreenLoading />}><WelcomePage /></Suspense></ErrorBoundary></FullPageSlot>
  }
  if (showSettingsPage) {
    return <FullPageSlot><ErrorBoundary><Suspense fallback={<InlineSettingsSkeleton />}><PreferencesDialog embedded /></Suspense></ErrorBoundary></FullPageSlot>
  }
  if (showUserProfilePage) {
    return <FullPageSlot><ErrorBoundary><Suspense fallback={<InlineSettingsSkeleton />}><UserProfilePage /></Suspense></ErrorBoundary></FullPageSlot>
  }
  if (showBillingCenterPage) {
    return <FullPageSlot><ErrorBoundary><Suspense fallback={<InlineSettingsSkeleton />}><BillingCenterPage /></Suspense></ErrorBoundary></FullPageSlot>
  }
  if (showSessionHistoryPage) {
    return <FullPageSlot><ErrorBoundary><Suspense fallback={<InlineSettingsSkeleton />}><SessionHistoryPage /></Suspense></ErrorBoundary></FullPageSlot>
  }
  if (showPluginCenterPage) {
    return <FullPageSlot><ErrorBoundary><Suspense fallback={<InlineSettingsSkeleton />}><PluginCenterPage /></Suspense></ErrorBoundary></FullPageSlot>
  }

  // 编辑器模式
  if (layoutConfig.showEditor) {
    // 当侧边栏面板要求隐藏编辑器（如项目列表/模板列表）时，主区域仅显示 Chat
    // 避免无文件时编辑器欢迎页（EditorWelcome）占据主区域空间
    if (shouldHideEditor) {
      return (
        <>
          {layoutConfig.showChat && (
          <ChatSection
            key="chat"
            visible={chatAsDrawer || !shouldHideChat}
            mode="secondary"
            presentation={chatPresentation}
            onClose={closeChatDrawer}
          />
        )}
        </>
      )
    }
    return (
      <>
        {isShellStudioActive ? (
          <div className="flex-1 min-h-0 flex flex-col relative overflow-hidden">
            <ErrorBoundary><Suspense fallback={<EditorSkeleton />}><TerminalStudio /></Suspense></ErrorBoundary>
          </div>
        ) : (
          <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
            <EditorSlot />
            <EditorBottomBar />
          </div>
        )}
        {layoutConfig.showChat && (
          <ChatSection
            key="chat"
            visible={chatAsDrawer || !shouldHideChat}
            mode="secondary"
            presentation={chatPresentation}
            onClose={closeChatDrawer}
          />
        )}
      </>
    )
  }

  // 场景布局：dashboard / canvas / focus / research / split / analytics
  const layout = layoutConfig.layout

  if (layout === 'dashboard-centric') {
    const Dashboard = PrimaryViewComponent ?? DataDashboard
    return (
      <>
        <FullPageSlot>
          {hasOpenFiles && activeFilePath ? (
            <PanelSlot><Editor /></PanelSlot>
          ) : (
            <PanelSlot><Dashboard /></PanelSlot>
          )}
        </FullPageSlot>
        {layoutConfig.showChat && (
          <ChatSection
            key="chat"
            visible={chatAsDrawer || !shouldHideChat}
            mode="secondary"
            presentation={chatPresentation}
            onClose={closeChatDrawer}
          />
        )}
      </>
    )
  }

  if (layout === 'canvas-centric') {
    return (
      <>
        <FullPageSlot><PanelSlot><CanvasWorkspace /></PanelSlot></FullPageSlot>
        {layoutConfig.showChat && (
          <ChatSection
            key="chat"
            visible={chatAsDrawer || !shouldHideChat}
            mode="secondary"
            presentation={chatPresentation}
            onClose={closeChatDrawer}
          />
        )}
      </>
    )
  }

  if (layout === 'focus-centric' || layout === 'research-centric' || layout === 'split-centric') {
    return (
      <>
        <FullPageSlot>
          {hasOpenFiles && activeFilePath ? (
            <PanelSlot><Editor /></PanelSlot>
          ) : PrimaryViewComponent ? (
            <PanelSlot><PrimaryViewComponent /></PanelSlot>
          ) : scenarioWelcomeComponent ? (
            <PanelSlot>{(() => { const W = scenarioWelcomeComponent; return <W /> })()}</PanelSlot>
          ) : (
            <PanelSlot><DataDashboard /></PanelSlot>
          )}
        </FullPageSlot>
        {layoutConfig.showChat && (
          <ChatSection
            key="chat"
            visible={chatAsDrawer || !shouldHideChat}
            mode="secondary"
            presentation={chatPresentation}
            onClose={closeChatDrawer}
          />
        )}
      </>
    )
  }

  if (layout === 'analytics-centric') {
    // 主区域组件由场景自述（ui.primaryView）。此前这里硬编码 `store-diagnosis`，
    // 任何其他场景声明 analytics-centric 都会渲染出门店诊断的看板。
    const AnalyticsView = PrimaryViewComponent ?? DataDashboard
    return (
      <>
        <FullPageSlot>
          {hasOpenFiles && activeFilePath ? (
            <PanelSlot><Editor /></PanelSlot>
          ) : (
            <PanelSlot><AnalyticsView /></PanelSlot>
          )}
        </FullPageSlot>
        {layoutConfig.showChat && (
          <ChatSection
            key="chat"
            visible={chatAsDrawer || !shouldHideChat}
            mode="secondary"
            presentation={chatPresentation}
            onClose={closeChatDrawer}
          />
        )}
      </>
    )
  }

  return null
}

// ====== 导出 ======

/**
 * 空闲预热懒加载 chunk
 *
 * 编辑器与内置浏览器都是打开时才 import 的重模块：下载、解析、执行全部落在
 * 「打开」那一帧，和布局重排、guest 渲染进程创建叠在一起，就是打开瞬间卡一下
 * 的直接来源。这里在主内容区渲染完之后借浏览器空闲时间把模块先取回（只 import、
 * 不渲染），首次真正打开时只剩执行开销。
 *
 * 同一路径的 dynamic import 命中模块缓存，与 lazy() 共用同一份 chunk，
 * 不会重复下载。
 */
function useChunkWarmup(load: () => Promise<unknown>): void {
  useEffect(() => {
    const idleWindow = window as Window & {
      requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number
      cancelIdleCallback?: (handle: number) => void
    }

    const warm = () => {
      void load()
    }

    if (typeof idleWindow.requestIdleCallback === 'function') {
      const handle = idleWindow.requestIdleCallback(warm, { timeout: 4000 })
      return () => idleWindow.cancelIdleCallback?.(handle)
    }

    const timer = setTimeout(warm, 1500)
    return () => clearTimeout(timer)
    // load 都是模块级常量函数，引用稳定
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

/** 编辑器模块（含整套编辑器组件与 hooks，Monaco 本体由 bootstrap 预热） */
const loadEditorChunk = () => import('@components/workspace-editor/WorkspaceEditor')

/**
 * 内置浏览器模块
 *
 * 这个 chunk 单独预热：打开自定义菜单是用户主动操作，等待窗口只有一两帧，
 * 现场下载会比编辑器更明显地表现为「点了没反应 / 卡一下」。
 */
const loadInternalBrowserChunk = () => import('@components/browser/InternalBrowser')

/**
 * 预览标签页模块
 *
 * WorkspaceEditor 用 safeLazy 加载 WebPreviewTab，而这套组件（工具栏、设备舞台、
 * webview 控制器、会话同步 hook）单独成一个 chunk，WorkspaceEditor 的预热带不上它。
 * 首次 open_preview 时现场下载并执行，负担全部落在打开预览的那一帧——表现为整个
 * 界面卡顿并伴随一次跳动。这里提前把它取到缓存里。
 */
const loadPreviewTabChunk = () => import('@components/workspace-editor/WebPreviewTab')

/**
 * 内部浏览器插槽
 *
 * 仅当 internalBrowserUrl 非空时渲染 InternalBrowser，占据内容区左侧工作空间位置。
 * 独立成组件避免在每个布局分支中重复订阅 store。
 */
function InternalBrowserSlot() {
  const internalBrowserUrl = useStore((s) => s.internalBrowserUrl)

  if (!internalBrowserUrl) return null

  return (
    <div className="flex-1 min-w-0 overflow-hidden">
      <ErrorBoundary>
        {/* chunk 尚未就绪时铺编辑器底色，避免浏览器区域闪一下空白 */}
        <Suspense fallback={<div className="h-full w-full bg-background-editor" />}>
          <InternalBrowser />
        </Suspense>
      </ErrorBoundary>
    </div>
  )
}

export default function MainContentArea(props: MainContentAreaProps) {
  useChunkWarmup(loadEditorChunk)
  useChunkWarmup(loadInternalBrowserChunk)
  useChunkWarmup(loadPreviewTabChunk)
  // 打开编辑器 / 内置浏览器时收起菜单栏与侧边栏，关闭后按快照恢复
  useFocusChromeCollapse(props.layoutConfig.sidebarItems)

  // 内置浏览器的承载位置在各个布局分支内部（Primary / Secondary 的左侧工作区），
  // 不在这里整体替换主区域：那样会把 ChatSection 连同 ChatPanel 一起卸载重建。
  return (
    <>
      {props.layoutConfig.chatPosition === 'primary' ? <PrimaryMainContent {...props} /> : <SecondaryMainContent {...props} />}
    </>
  )
}
