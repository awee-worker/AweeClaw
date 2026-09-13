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

import { Suspense, lazy, useMemo } from 'react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { CrashGuard as ErrorBoundary } from '@components/foundation/CrashGuard'
import { EditorSkeleton, PanelSkeleton, FullScreenLoading, InlineSettingsSkeleton } from '@components/ui/ProgressIndicator'
import type { LayoutConfig } from '@renderer/shell/ShellComposer'
import { getScenarioComponent } from '@components/scenario/ScenarioComponentResolver'
import ChatSection from './ChatSection'

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

/** 编辑器插槽（带 ErrorBoundary + Suspense） */
function EditorSlot() {
  return (
    <div className="flex-1 min-h-0 flex flex-col relative overflow-hidden min-w-0">
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
  const { chatVisible, openFiles, activeFilePath,
    showSettingsPage, showWelcomePage, showUserProfilePage, showBillingCenterPage, showSessionHistoryPage, showPluginCenterPage,
    activeSidePanel } = useStore(useShallow((s) => ({
    chatVisible: s.chatVisible,
    openFiles: s.openFiles,
    activeFilePath: s.activeFilePath,
    showSettingsPage: s.showSettingsPage,
    showWelcomePage: s.showWelcomePage,
    showUserProfilePage: s.showUserProfilePage,
    showBillingCenterPage: s.showBillingCenterPage,
    showSessionHistoryPage: s.showSessionHistoryPage,
    showPluginCenterPage: s.showPluginCenterPage,
    activeSidePanel: s.activeSidePanel,
  })))

  // 宽模式面板
  if (isWideModePanel && activeSidePanel) {
    // 知识库面板与 Chat 并列展示（参考资料 + 对话），其余面板独占主区域
    if (activeSidePanel === 'knowledge') {
      return (
        <>
          <FullPageSlot>
            <PanelSlot><DynamicPanelView panelId="knowledge" /></PanelSlot>
          </FullPageSlot>
          {layoutConfig.showChat && chatVisible && <ChatSection visible mode="secondary" />}
        </>
      )
    }
    return (
      <FullPageSlot>
        <PanelSlot>
          <DynamicPanelView panelId={activeSidePanel} />
        </PanelSlot>
      </FullPageSlot>
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

  // 始终渲染 ChatSection，避免 activeFilePath 变化时卸载/重新挂载
  // 有文件时：EditorSlot 在左，ChatSection 在右固定宽度
  // 无文件时：只渲染 ChatSection，flex:1 占满整个主区域
  const hasFile = openFiles.length > 0 && activeFilePath !== null
  return (
    <div className="flex-1 flex min-h-0 overflow-hidden">
      {hasFile && <EditorSlot />}
      <ChatSection
        visible={chatVisible}
        mode="primary"
        hasFile={hasFile}
      />
    </div>
  )
}

// ====== Secondary 布局（chatPosition !== primary）======

function SecondaryMainContent({ layoutConfig, isWideModePanel, scenarioWelcomeComponent }: MainContentAreaProps) {
  const { chatVisible, openFiles, activeFilePath,
    showSettingsPage, showWelcomePage, showUserProfilePage, showBillingCenterPage, showSessionHistoryPage, showPluginCenterPage,
    activeSidePanel } = useStore(useShallow((s) => ({
    chatVisible: s.chatVisible,
    openFiles: s.openFiles,
    activeFilePath: s.activeFilePath,
    showSettingsPage: s.showSettingsPage,
    showWelcomePage: s.showWelcomePage,
    showUserProfilePage: s.showUserProfilePage,
    showBillingCenterPage: s.showBillingCenterPage,
    showSessionHistoryPage: s.showSessionHistoryPage,
    showPluginCenterPage: s.showPluginCenterPage,
    activeSidePanel: s.activeSidePanel,
  })))

  const isShellStudioActive = activeSidePanel === 'shell'

  // 当前激活的侧边栏面板是否要求隐藏编辑器（含编辑器欢迎页）
  // 适用于纯列表型面板（项目列表/模板列表），避免无文件时编辑器欢迎页占据主区域
  const shouldHideEditor = useMemo(() => {
    if (!activeSidePanel) return false
    const items = layoutConfig.sidebarItems
    if (!items || items.length === 0) return false
    const item = items.find(it => it.id === activeSidePanel)
    return item?.hideEditor === true
  }, [activeSidePanel, layoutConfig.sidebarItems])

  // 是否隐藏 Chat
  // hideChat 面板由 AweeApp 中的 useEffect 自动设置 chatVisible=false（默认隐藏）
  // 用户可通过右上角按钮手动切换 chatVisible，此处仅由 chatVisible 控制显隐
  const shouldHideChat = useMemo(() => {
    if (!chatVisible) return true
    // 全屏工作台面板（任务/项目/自动化）隐藏聊天，独占主区域
    const fullScreenPanels = ['tasks', 'projects', 'automation', 'scenarios', 'plugin-market']
    if (isWideModePanel && activeSidePanel !== 'knowledge' && (layoutConfig.wideModeHidesChat || fullScreenPanels.includes(activeSidePanel ?? ''))) return true
    // 仅在非编辑器布局下隐藏 chat：编辑器布局由 EditorSlot 处理空状态（EditorWelcome），
    // 不渲染 scenarioWelcomeComponent，此时隐藏 chat 会导致用户无法与 AI 交互
    if (scenarioWelcomeComponent && !layoutConfig.showEditor && activeSidePanel === 'explorer' && !(openFiles.length > 0 && activeFilePath)) return true
    return false
  }, [chatVisible, isWideModePanel, activeSidePanel, layoutConfig.wideModeHidesChat, layoutConfig.showEditor, scenarioWelcomeComponent, openFiles, activeFilePath])

  // 宽模式面板
  if (isWideModePanel && activeSidePanel) {
    return (
      <>
        <FullPageSlot>
          <PanelSlot>
            <DynamicPanelView panelId={activeSidePanel} />
          </PanelSlot>
        </FullPageSlot>
        {layoutConfig.showChat && <ChatSection visible={!shouldHideChat} mode="secondary" />}
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
          {layoutConfig.showChat && <ChatSection visible={!shouldHideChat} mode="secondary" />}
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
        {layoutConfig.showChat && <ChatSection visible={!shouldHideChat} mode="secondary" />}
      </>
    )
  }

  // 场景布局：dashboard / canvas / focus / research / split / analytics
  const layout = layoutConfig.layout

  if (layout === 'dashboard-centric') {
    return (
      <>
        <FullPageSlot>
          {openFiles.length > 0 && activeFilePath ? (
            <PanelSlot><Editor /></PanelSlot>
          ) : (
            <PanelSlot><DataDashboard /></PanelSlot>
          )}
        </FullPageSlot>
        {layoutConfig.showChat && <ChatSection visible={!shouldHideChat} mode="secondary" />}
      </>
    )
  }

  if (layout === 'canvas-centric') {
    return (
      <>
        <FullPageSlot><PanelSlot><CanvasWorkspace /></PanelSlot></FullPageSlot>
        {layoutConfig.showChat && <ChatSection visible={!shouldHideChat} mode="secondary" />}
      </>
    )
  }

  if (layout === 'focus-centric' || layout === 'research-centric' || layout === 'split-centric') {
    return (
      <>
        <FullPageSlot>
          {openFiles.length > 0 && activeFilePath ? (
            <PanelSlot><Editor /></PanelSlot>
          ) : scenarioWelcomeComponent ? (
            <PanelSlot>{(() => { const W = scenarioWelcomeComponent; return <W /> })()}</PanelSlot>
          ) : (
            <PanelSlot><DataDashboard /></PanelSlot>
          )}
        </FullPageSlot>
        {layoutConfig.showChat && <ChatSection visible={!shouldHideChat} mode="secondary" />}
      </>
    )
  }

  if (layout === 'analytics-centric') {
    // 动态解析场景组件：store-diagnosis 场景被删除时回退到通用数据看板
    const ScenarioDashboard = getScenarioComponent('store-diagnosis', 'StoreDiagnosisDashboard') ?? DataDashboard
    return (
      <>
        <FullPageSlot>
          {openFiles.length > 0 && activeFilePath ? (
            <PanelSlot><Editor /></PanelSlot>
          ) : (
            <PanelSlot><ScenarioDashboard /></PanelSlot>
          )}
        </FullPageSlot>
        {layoutConfig.showChat && <ChatSection visible={!shouldHideChat} mode="secondary" />}
      </>
    )
  }

  return null
}

// ====== 导出 ======

/**
 * 内部浏览器插槽
 *
 * 仅当 internalBrowserUrl 非空时渲染 InternalBrowser，占据内容区左侧工作区位置。
 * 独立成组件避免在每个布局分支中重复订阅 store。
 */
function InternalBrowserSlot() {
  const internalBrowserUrl = useStore((s) => s.internalBrowserUrl)

  if (!internalBrowserUrl) return null

  return (
    <div className="flex-1 min-w-0 overflow-hidden">
      <ErrorBoundary>
        <Suspense fallback={null}>
          <InternalBrowser />
        </Suspense>
      </ErrorBoundary>
    </div>
  )
}

export default function MainContentArea(props: MainContentAreaProps) {
  // 自定义菜单打开时：内部浏览器占据左侧工作区位置（flex-1）。
  // 打开时自动隐藏聊天窗口（见 layoutSlice.openInternalBrowser），浏览器全宽显示；
  // chatVisible 为 true 时右侧恢复聊天窗口，浏览器让出空间
  const internalBrowserUrl = useStore((s) => s.internalBrowserUrl)
  const chatVisible = useStore((s) => s.chatVisible)

  if (internalBrowserUrl) {
    return (
      <div className="flex-1 flex min-h-0 overflow-hidden">
        <InternalBrowserSlot />
        {chatVisible && <ChatSection visible mode="primary" hasFile />}
      </div>
    )
  }

  return (
    <>
      {props.layoutConfig.chatPosition === 'primary' ? <PrimaryMainContent {...props} /> : <SecondaryMainContent {...props} />}
    </>
  )
}
