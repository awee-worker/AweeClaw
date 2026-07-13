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
import { EditorSkeleton, PanelSkeleton, FullScreenLoading, InlineSettingsSkeleton, ChatSkeleton } from '@components/ui/ProgressIndicator'
import { t, type Language } from '@renderer/i18n'
import type { LayoutConfig } from '@renderer/shell/ShellComposer'
import { getScenarioComponent } from '@components/scenario/ScenarioComponentResolver'
import ChatSection from './ChatSection'

const ChatPanel = lazy(() => import('@components/intelligence/ChatPanel'))
const Editor = lazy(() => import('@components/workspace-editor/WorkspaceEditor'))
const TerminalStudio = lazy(() => import('@renderer/shell/components/TerminalStudio'))
const DataDashboard = lazy(() => import('@components/dashboard/InsightDashboard'))
const CanvasWorkspace = lazy(() => import('@components/canvas/WorkspaceCanvas'))
const DynamicPanelView = lazy(() => import('@components/explorer/AdaptivePanelView').then(m => ({ default: m.DynamicPanelView })))
const ScenarioManagerView = lazy(() => import('@components/scenario/ScenarioManagerView').then(m => ({ default: m.ScenarioManagerView })))
const KnowledgeView = lazy(() => import('@components/explorer/panels/KnowledgeExplorer').then(m => ({ default: m.KnowledgeView })))
const WelcomePage = lazy(() => import('@components/welcome/WelcomePage'))
const PreferencesDialog = lazy(() => import('@components/settings/PreferencesDialog'))
const UserProfilePage = lazy(() => import('@components/user/UserProfilePage'))
const BillingCenterPage = lazy(() => import('@components/user/BillingCenterPage'))
const SessionHistoryPage = lazy(() => import('@components/user/SessionHistoryPage'))
const PluginCenterPage = lazy(() => import('@components/plugin/PluginCenterPage'))
const EditorBottomBar = lazy(() => import('@components/layout/EditorBottomBar'))
const VoiceConversationOverlay = lazy(() => import('@components/voice/VoiceConversationOverlay'))

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
  const { chatVisible, openFiles, activeFilePath, language,
    showSettingsPage, showWelcomePage, showUserProfilePage, showBillingCenterPage, showSessionHistoryPage, showPluginCenterPage,
    activeSidePanel } = useStore(useShallow((s) => ({
    chatVisible: s.chatVisible,
    openFiles: s.openFiles,
    activeFilePath: s.activeFilePath,
    language: s.language,
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
    if (activeSidePanel === 'knowledge') {
      return (
        <>
          <FullPageSlot>
            <PanelSlot><KnowledgeView /></PanelSlot>
          </FullPageSlot>
          {layoutConfig.showChat && chatVisible && <ChatSection visible mode="secondary" />}
        </>
      )
    }
    return (
      <FullPageSlot>
        <PanelSlot>
          {activeSidePanel === 'scenarios' ? <ScenarioManagerView /> : <DynamicPanelView panelId={activeSidePanel} />}
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

  // 编辑器 + Chat
  if (openFiles.length > 0 && activeFilePath) {
    return (
      <>
        <EditorSlot />
        <ChatSection visible={chatVisible} mode="primary" />
      </>
    )
  }

  // 仅 Chat
  if (chatVisible) {
    return (
      <div className="flex-1 min-w-0 overflow-hidden relative">
        <ErrorBoundary><Suspense fallback={<ChatSkeleton />}><ChatPanel /></Suspense></ErrorBoundary>

        {/* 语音对话覆盖层 - 仅覆盖聊天区域 */}
        <VoiceConversationOverlaySlot />
      </div>
    )
  }

  // 空状态
  return (
    <div className="flex-1 min-w-0 overflow-hidden flex items-center justify-center">
      <div className="text-text-muted text-sm">
        {t('app.aiassistanthiddenclickthe', language as Language)}
      </div>
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

  // 是否隐藏 Chat（宽模式面板 + 特定条件）
  const shouldHideChat = useMemo(() => {
    if (!chatVisible) return true
    if (isWideModePanel && activeSidePanel !== 'knowledge' && (layoutConfig.wideModeHidesChat || activeSidePanel === 'scenarios')) return true
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
            {activeSidePanel === 'scenarios' ? <ScenarioManagerView />
              : activeSidePanel === 'knowledge' ? <KnowledgeView />
              : <DynamicPanelView panelId={activeSidePanel} />}
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
 * 语音对话覆盖层插槽
 *
 * 仅当 voiceConversationActive 为 true 时渲染 VoiceConversationOverlay。
 * 独立成组件避免在每个布局分支中重复订阅 store。
 */
function VoiceConversationOverlaySlot() {
  const { voiceConversationActive, setVoiceConversationActive } = useStore(useShallow((s) => ({
    voiceConversationActive: s.voiceConversationActive,
    setVoiceConversationActive: s.setVoiceConversationActive,
  })))

  if (!voiceConversationActive) return null

  return (
    <ErrorBoundary>
      <Suspense fallback={null}>
        <VoiceConversationOverlay onClose={() => setVoiceConversationActive(false)} />
      </Suspense>
    </ErrorBoundary>
  )
}

export default function MainContentArea(props: MainContentAreaProps) {
  if (props.layoutConfig.chatPosition === 'primary') {
    return <PrimaryMainContent {...props} />
  }
  return <SecondaryMainContent {...props} />
}
