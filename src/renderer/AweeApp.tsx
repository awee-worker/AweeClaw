import { lazy, Suspense, useState, useEffect, useMemo, useRef } from 'react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { useWindowTitle, useAppInit, useGlobalShortcuts, useMenuBridge, useFileWatcher, useAppShutdownState, usePreviewDiscoveryToasts, useChannelBridge } from '@hooks'
import AppTitleBar from './components/layout/AppTitleBar'
import NavigationRail from './components/layout/NavigationRail'
import SidebarSection from './components/layout/SidebarSection'
import MainContentArea from './components/layout/MainContentArea'
import GlobalOverlays from './components/layout/GlobalOverlays'
import WorkspaceStatusBar from './components/layout/WorkspaceStatusBar'
import { scenarioRegistry, initializeScenarios } from '@shared/configuration/scenarios'
import { scenarioLoader, registerBuiltinScenarios } from '@/scenarios'
import { loadExternalScenarios, setExternalScenarioLoadFunctions } from '@scenario-system/core/ExternalScenarioLoader'
import { api } from './adapters/electronBridge'
import { shellComposer, type LayoutConfig } from './shell/ShellComposer'
import { getPanelComponent } from '@components/explorer/PanelRegistry'
import { ToastProvider, useToast, setGlobalToast } from '@components/foundation/NotificationProvider'
import { GlobalDecisionOverlay } from '@components/foundation/DecisionOverlay'
import { CrashGuard as ErrorBoundary } from '@components/foundation/CrashGuard'
import { GlobalErrorHandler } from '@components/foundation/AppErrorHandler'
import GlobalToastContainer from '@components/foundation/AppToastContainer'
import { ThemeManager } from '@components/workspace-editor/EditorThemeProvider'
import { FullScreenLoading } from './components/ui/ProgressIndicator'
import { startupMetrics } from '@shared/toolkit/bootMetrics'

startupMetrics.mark('app-module-loaded')

const WorkflowWorkbench = lazy(() => import('@components/workflow/Workbench/WorkflowWorkbench'))
const WelcomePage = lazy(() => import('@components/welcome/WelcomePage'))
const PreferencesDialog = lazy(() => import('@components/settings/PreferencesDialog'))
const UserProfilePage = lazy(() => import('@components/user/UserProfilePage'))
const BillingCenterPage = lazy(() => import('@components/user/BillingCenterPage'))
const SessionHistoryPage = lazy(() => import('@components/user/SessionHistoryPage'))
const PluginCenterPage = lazy(() => import('@components/plugin/PluginCenterPage'))
const ScenarioManagerView = lazy(() => import('@components/scenario/ScenarioManagerView').then(m => ({ default: m.ScenarioManagerView })))

initializeScenarios()
registerBuiltinScenarios()

setExternalScenarioLoadFunctions(
  (scenarioId: string) => api.scenarioInstall.loadScenarioFiles(scenarioId),
)
loadExternalScenarios().catch(() => {})

function ToastInitializer() {
  const toastContext = useToast()

  useEffect(() => {
    setGlobalToast(toastContext)
  }, [toastContext])

  return null
}

function AppContent() {
  useAppShutdownState()

  const {
    workspace, activeSidePanel, activeFilePath,
    showWorkflow, setShowWorkflow,
    showSettingsPage, showWelcomePage, showUserProfilePage, showBillingCenterPage,
    showSessionHistoryPage, showPluginCenterPage, showScenarioPage,
    activeScenarioId, language,
    isAuthenticated, setShowWelcomePage,
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
    activeScenarioId: state.activeScenarioId,
    language: state.language,
    isAuthenticated: state.isAuthenticated,
    setShowWelcomePage: state.setShowWelcomePage,
  })))

  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [isInitialized, setIsInitialized] = useState(false)

  useEffect(() => {
    if (activeSidePanel === 'shell' || activeFilePath) {
      useStore.getState().setNavRailExpanded(false)
    }
  }, [activeSidePanel, activeFilePath])

  useEffect(() => {
    window.__AWEECLAW_STORE__ = { getState: () => useStore.getState() }
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

  const hasWorkspace = useMemo(() => Boolean(workspace && workspace.roots.length > 0), [workspace])
  const isShellStudioActive = activeSidePanel === 'shell'

  useWindowTitle()
  useFileWatcher()
  useGlobalShortcuts()
  useMenuBridge()
  usePreviewDiscoveryToasts(hasWorkspace && isInitialized && activeScenarioId === 'dev-assistant')
  useChannelBridge()

  const layoutConfig = useMemo<LayoutConfig>(() => {
    const scenario = scenarioRegistry.get(activeScenarioId)
    if (scenario) {
      return shellComposer.getLayoutConfig(scenario)
    }
    const defaultScenario = scenarioRegistry.getDefault()
    return shellComposer.getLayoutConfig(defaultScenario)
  }, [activeScenarioId])

  // 当场景切换时应用布局配置中的 sidebar 默认宽度
  useEffect(() => {
    if (layoutConfig.sidebarDefaultWidth > 0) {
      useStore.getState().setSidebarWidth(layoutConfig.sidebarDefaultWidth)
    }
  }, [layoutConfig.sidebarDefaultWidth])

  const isWideModePanel = useMemo(() => {
    if (!activeSidePanel) return false
    if (activeSidePanel === 'scenarios') return true
    return layoutConfig.wideModePanelIds.includes(activeSidePanel)
  }, [activeSidePanel, layoutConfig.wideModePanelIds])

  const scenarioWelcomeComponent = useMemo(() => {
    if (!activeScenarioId) return null
    const scenario = scenarioRegistry.get(activeScenarioId)
    if (!scenario?.ui?.welcomeComponent) return null
    return getPanelComponent(`welcome-${activeScenarioId}`) ?? null
  }, [activeScenarioId])

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
    },
  })

  // 侧边栏是否隐藏
  const sidebarHidden = useMemo(() => {
    if (!layoutConfig.showSidebar || !activeSidePanel) return true
    if (isWideModePanel) return true
    if (isShellStudioActive && layoutConfig.chatPosition !== 'primary') return true
    if (showSettingsPage || showWelcomePage || showUserProfilePage || showBillingCenterPage || showSessionHistoryPage || showPluginCenterPage || showScenarioPage) return true
  }, [layoutConfig.showSidebar, layoutConfig.chatPosition, activeSidePanel, isWideModePanel, isShellStudioActive, showSettingsPage, showWelcomePage, showUserProfilePage, showBillingCenterPage, showSessionHistoryPage, showPluginCenterPage, showScenarioPage])

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
        {hasWorkspace ? (
          (showSettingsPage || showUserProfilePage || showBillingCenterPage || showSessionHistoryPage || showPluginCenterPage || showScenarioPage) ? (
            // 全屏页面：设置/用户中心/费用中心/历史会话/插件/工作场景
            // 绕过 NavigationRail / AppTitleBar / SidebarSection / WorkspaceStatusBar
            <div className="flex h-full w-full overflow-hidden">
              <ErrorBoundary>
                <Suspense fallback={<FullScreenLoading />}>
                  {showSettingsPage && <PreferencesDialog embedded />}
                  {showUserProfilePage && <UserProfilePage />}
                  {showBillingCenterPage && <BillingCenterPage />}
                  {showSessionHistoryPage && <SessionHistoryPage />}
                  {showPluginCenterPage && <PluginCenterPage />}
                  {showScenarioPage && <ScenarioManagerView />}
                </Suspense>
              </ErrorBoundary>
            </div>
          ) : (
            <div className={`flex h-full w-full overflow-hidden transition-opacity duration-300 ${layoutAnimating ? 'opacity-0' : 'opacity-100'}`}>
              {layoutConfig.showActivityBar && <NavigationRail />}

              <div className="flex-1 flex flex-col min-w-0">
                <AppTitleBar />

                <div className="flex-1 flex min-w-0 overflow-hidden">
                  <SidebarSection hidden={sidebarHidden} />

                  <div className="flex-1 flex min-w-0 bg-background relative">
                    <MainContentArea
                      layoutConfig={layoutConfig}
                      isWideModePanel={isWideModePanel}
                      scenarioWelcomeComponent={scenarioWelcomeComponent}
                    />
                  </div>
                </div>

                {layoutConfig.showStatusBar && <WorkspaceStatusBar />}
              </div>
            </div>
          )
        ) : (
          <div className="flex-1 overflow-hidden">
            <Suspense fallback={<FullScreenLoading />}>
              <WelcomePage />
            </Suspense>
          </div>
        )}
      </div>

      <GlobalOverlays
        showKeyboardShortcuts={showKeyboardShortcuts}
        setShowKeyboardShortcuts={setShowKeyboardShortcuts}
        showOnboarding={showOnboarding}
        setShowOnboarding={setShowOnboarding}
        isInitialized={isInitialized}
      />

      <GlobalDecisionOverlay />
      <GlobalToastContainer />
    </div>
  )
}

export default function App() {
  return (
    <ToastProvider>
      <ToastInitializer />
      <GlobalErrorHandler>
        <ThemeManager>
          <AppContent />
        </ThemeManager>
      </GlobalErrorHandler>
    </ToastProvider>
  )
}
