import { lazy, Suspense, useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { useWindowTitle, useAppInit, useGlobalShortcuts, useFileWatcher, useSidebarResize, useChatResize, useAppShutdownState, usePreviewDiscoveryToasts, useChannelBridge } from '@hooks'
import AppTitleBar from './components/layout/AppTitleBar'
import NavigationRail from './components/layout/NavigationRail'
import { scenarioRegistry, initializeScenarios } from '@shared/configuration/scenarios'
import { scenarioLoader, registerBuiltinScenarios } from '@/scenarios'
import { loadExternalScenarios, setExternalScenarioLoadFunctions } from '@scenario-system/core/ExternalScenarioLoader'
import { api } from './adapters/electronBridge'
import { shellComposer, type LayoutConfig } from './shell/ShellComposer'
import { getPanelComponent } from '@components/explorer/PanelRegistry'
import WorkspaceStatusBar from './components/layout/WorkspaceStatusBar'
import EditorBottomBar from './components/layout/EditorBottomBar'
import { ToastProvider, useToast, setGlobalToast } from '@components/foundation/NotificationProvider'
import { GlobalDecisionOverlay } from '@components/foundation/DecisionOverlay'
import { CrashGuard as ErrorBoundary } from '@components/foundation/CrashGuard'
import { GlobalErrorHandler } from '@components/foundation/AppErrorHandler'
import GlobalToastContainer from '@components/foundation/AppToastContainer'
import { ThemeManager } from '@components/code-editor/EditorThemeProvider'
import { EditorSkeleton, PanelSkeleton, ChatSkeleton, FullScreenLoading, InlineSettingsSkeleton } from './components/ui/ProgressIndicator'
import { startupMetrics } from '@shared/toolkit/bootMetrics'

startupMetrics.mark('app-module-loaded')

const Editor = lazy(() => import('@components/code-editor/CodeEditor'))
const Sidebar = lazy(() => import('@components/explorer/ExplorerSidebar'))
const ChatPanel = lazy(() => import('@components/intelligence/ChatPanel'))
const TerminalStudio = lazy(() => import('./shell/components/TerminalStudio'))

const TerminalPanel = lazy(() => import('@components/dock-panels/TerminalConsolePanel'))
const DebugPanel = lazy(() => import('@components/dock-panels/DebugConsolePanel'))
const WorkflowWorkbench = lazy(() => import('@components/workflow/Workbench/WorkflowWorkbench'))
const DataDashboard = lazy(() => import('@components/dashboard/InsightDashboard'))
const StoreDiagnosisDashboard = lazy(() => import('@/scenarios/store-diagnosis/components/StoreDiagnosisDashboard'))
const CanvasWorkspace = lazy(() => import('@components/canvas/WorkspaceCanvas'))
const DynamicPanelView = lazy(() => import('@components/explorer/AdaptivePanelView').then(m => ({ default: m.DynamicPanelView })))
const ScenarioManagerView = lazy(() => import('@components/scenario/ScenarioManagerView').then(m => ({ default: m.ScenarioManagerView })))
const KnowledgeView = lazy(() => import('@components/explorer/panels/KnowledgeExplorer').then(m => ({ default: m.KnowledgeView })))

const OnboardingWizard = lazy(() => import('@components/modals/OnboardingWizard'))
const PreferencesDialog = lazy(() => import('@components/settings/PreferencesDialog'))
const CommandHub = lazy(() => import('@components/modals/CommandHub'))
const ShortcutReference = lazy(() => import('@components/modals/ShortcutReference'))
const FileNavigator = lazy(() => import('@components/modals/FileNavigator'))
const AppIdentityPanel = lazy(() => import('@components/modals/AppIdentityPanel'))
const WelcomePage = lazy(() => import('@components/onboarding/WelcomePage'))
const UserProfilePage = lazy(() => import('@components/user/UserProfilePage'))
const BillingCenterPage = lazy(() => import('@components/user/BillingCenterPage'))

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
    workspace, activeSidePanel,
    showWorkflow, setShowWorkflow,
    sidebarWidth, setSidebarWidth,
    chatWidth, setChatWidth,
    showQuickOpen, setShowQuickOpen,
    showAbout, setShowAbout,
    showCommandPalette, setShowCommandPalette,
    terminalVisible, debugVisible, chatVisible,
    activeScenarioId, openFiles, activeFilePath, language,
    showSettingsPage, showWelcomePage, showUserProfilePage, showBillingCenterPage,
  } = useStore(useShallow((state) => ({
    workspace: state.workspace,
    activeSidePanel: state.activeSidePanel,
    showWorkflow: state.showWorkflow,
    setShowWorkflow: state.setShowWorkflow,
    sidebarWidth: state.sidebarWidth,
    setSidebarWidth: state.setSidebarWidth,
    chatWidth: state.chatWidth,
    setChatWidth: state.setChatWidth,
    showQuickOpen: state.showQuickOpen,
    setShowQuickOpen: state.setShowQuickOpen,
    showAbout: state.showAbout,
    setShowAbout: state.setShowAbout,
    showCommandPalette: state.showCommandPalette,
    setShowCommandPalette: state.setShowCommandPalette,
    terminalVisible: state.terminalVisible,
    debugVisible: state.debugVisible,
    chatVisible: state.chatVisible,
    activeScenarioId: state.activeScenarioId,
    openFiles: state.openFiles,
    activeFilePath: state.activeFilePath,
    language: state.language,
    showSettingsPage: state.showSettingsPage,
    showWelcomePage: state.showWelcomePage,
    showUserProfilePage: state.showUserProfilePage,
    showBillingCenterPage: state.showBillingCenterPage,
  })))

  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [isInitialized, setIsInitialized] = useState(false)

  useEffect(() => {
    if (activeFilePath) {
      useStore.getState().setNavRailExpanded(false)
    }
  }, [activeFilePath])

  useEffect(() => {
    window.__ADNIFY_STORE__ = { getState: () => useStore.getState() }
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
  usePreviewDiscoveryToasts(hasWorkspace && isInitialized)
  useChannelBridge()

  const layoutConfig = useMemo<LayoutConfig>(() => {
    const scenario = scenarioRegistry.get(activeScenarioId)
    if (scenario) {
      return shellComposer.getLayoutConfig(scenario)
    }
    const defaultScenario = scenarioRegistry.getDefault()
    return shellComposer.getLayoutConfig(defaultScenario)
  }, [activeScenarioId])

  const isWideModePanel = useMemo(() => {
    if (!activeSidePanel) return false
    if (activeSidePanel === 'scenarios') return true
    return layoutConfig.wideModePanelIds.includes(activeSidePanel)
  }, [activeSidePanel, layoutConfig.wideModePanelIds])

  const scenarioWelcomeComponent = useMemo(() => {
    if (!activeScenarioId) return null
    const scenario = scenarioRegistry.get(activeScenarioId)
    if (!scenario?.ui?.welcomeComponent) return null
    return getPanelComponent(`welcome-${activeScenarioId}`)
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
    },
  })

  const sidebarRef = useRef<HTMLDivElement>(null)
  const chatRef = useRef<HTMLDivElement>(null)

  const { startResize: startSidebarResize } = useSidebarResize(setSidebarWidth, sidebarRef)
  const { startResize: startChatResize } = useChatResize(setChatWidth, chatRef)

  const handleCloseKeyboardShortcuts = useCallback(() => setShowKeyboardShortcuts(false), [])
  const handleCloseOnboarding = useCallback(() => setShowOnboarding(false), [])

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
          <>
            <div className={`flex h-full w-full overflow-hidden transition-opacity duration-300 ${layoutAnimating ? 'opacity-0' : 'opacity-100'}`}>
              {layoutConfig.chatPosition === 'primary' ? (
                <>
                  {layoutConfig.showActivityBar && <NavigationRail />}

                  <div className="flex-1 flex flex-col min-w-0">
                    <AppTitleBar />

                    <div className="flex-1 flex min-w-0 overflow-hidden">
                      {layoutConfig.showSidebar && activeSidePanel && !isWideModePanel && !showSettingsPage && !showWelcomePage && !showUserProfilePage && !showBillingCenterPage && (
                        <div ref={sidebarRef} style={{ width: sidebarWidth, minWidth: sidebarWidth }} className="flex-shrink-0 relative min-w-[220px]">
                          <ErrorBoundary>
                            <Suspense fallback={<PanelSkeleton />}>
                              <Sidebar />
                            </Suspense>
                          </ErrorBoundary>
                          <div
                            className="absolute top-0 right-0 w-1 h-full cursor-col-resize active:bg-accent transition-colors z-50 translate-x-[2px]"
                            onMouseDown={startSidebarResize}
                          />
                        </div>
                      )}

                      <div className="flex-1 flex min-w-0 bg-background relative">
                        {isWideModePanel && activeSidePanel ? (
                          activeSidePanel === 'knowledge' ? (
                            <>
                              <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                                <ErrorBoundary>
                                  <Suspense fallback={<PanelSkeleton />}>
                                    <KnowledgeView />
                                  </Suspense>
                                </ErrorBoundary>
                              </div>
                              {layoutConfig.showChat && chatVisible && (
                                <div
                                  ref={chatRef}
                                  style={{ width: chatWidth }}
                                  className="flex-shrink-0 relative border-l border-border/30 shadow-[-1px_0_15px_rgba(0,0,0,0.03)] z-20 bg-background-chat"
                                >
                                  <div
                                    className="absolute top-0 left-0 w-1 h-full cursor-col-resize active:bg-accent transition-colors z-50 -translate-x-[2px]"
                                    onMouseDown={startChatResize}
                                  />
                                  <ErrorBoundary>
                                    <Suspense fallback={<ChatSkeleton />}>
                                      <ChatPanel />
                                    </Suspense>
                                  </ErrorBoundary>
                                </div>
                              )}
                            </>
                          ) : (
                            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                              <ErrorBoundary>
                                <Suspense fallback={<PanelSkeleton />}>
                                  {activeSidePanel === 'scenarios' ? (
                                    <ScenarioManagerView />
                                  ) : (
                                    <DynamicPanelView panelId={activeSidePanel} />
                                  )}
                                </Suspense>
                              </ErrorBoundary>
                            </div>
                          )
                        ) : showWelcomePage ? (
                          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                            <ErrorBoundary>
                              <Suspense fallback={<FullScreenLoading />}>
                                <WelcomePage />
                              </Suspense>
                            </ErrorBoundary>
                          </div>
                        ) : showSettingsPage ? (
                          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                            <ErrorBoundary>
                              <Suspense fallback={<InlineSettingsSkeleton />}>
                                <PreferencesDialog embedded />
                              </Suspense>
                            </ErrorBoundary>
                          </div>
                        ) : showUserProfilePage ? (
                          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                            <ErrorBoundary>
                              <Suspense fallback={<InlineSettingsSkeleton />}>
                                <UserProfilePage />
                              </Suspense>
                            </ErrorBoundary>
                          </div>
                        ) : showBillingCenterPage ? (
                          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                            <ErrorBoundary>
                              <Suspense fallback={<InlineSettingsSkeleton />}>
                                <BillingCenterPage />
                              </Suspense>
                            </ErrorBoundary>
                          </div>
                        ) : openFiles.length > 0 && activeFilePath ? (
                          <>
                            <div className="flex-1 min-h-0 flex flex-col relative overflow-hidden min-w-0">
                              <ErrorBoundary>
                                <Suspense fallback={<EditorSkeleton />}>
                                  <Editor />
                                </Suspense>
                              </ErrorBoundary>
                            </div>
                            {chatVisible && (
                              <div
                                ref={chatRef}
                                style={{ width: chatWidth, minWidth: chatWidth }}
                                className="flex-shrink-0 relative min-w-[580px] border-l border-border/30 bg-background-chat"
                              >
                                <ErrorBoundary>
                                  <Suspense fallback={<ChatSkeleton />}>
                                    <ChatPanel />
                                  </Suspense>
                                </ErrorBoundary>
                                <div
                                  className="absolute top-0 left-0 w-1 h-full cursor-col-resize active:bg-accent transition-colors z-50 -translate-x-[2px]"
                                  onMouseDown={startChatResize}
                                />
                              </div>
                            )}
                          </>
                        ) : chatVisible ? (
                          <div className="flex-1 min-w-0 overflow-hidden">
                            <ErrorBoundary>
                              <Suspense fallback={<ChatSkeleton />}>
                                <ChatPanel />
                              </Suspense>
                            </ErrorBoundary>
                          </div>
                        ) : (
                          <div className="flex-1 min-w-0 overflow-hidden flex items-center justify-center">
                            <div className="text-text-muted text-sm">
                              {language === 'zh' ? 'AI 助手已隐藏，点击右上角图标显示' : 'AI Assistant hidden, click the icon to show'}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {layoutConfig.showStatusBar && <WorkspaceStatusBar />}
                  </div>
                </>
              ) : (
                <>
                  {layoutConfig.showActivityBar && <NavigationRail />}

                  <div className="flex-1 flex flex-col min-w-0">
                    <AppTitleBar />

                    <div className="flex-1 flex min-w-0 overflow-hidden">
                      {layoutConfig.showSidebar && activeSidePanel && !isShellStudioActive && !isWideModePanel && !showSettingsPage && !showWelcomePage && !showUserProfilePage && !showBillingCenterPage && (
                        <div ref={sidebarRef} style={{ width: sidebarWidth, minWidth: sidebarWidth }} className="flex-shrink-0 relative min-w-[220px]">
                          <ErrorBoundary>
                            <Suspense fallback={<PanelSkeleton />}>
                              <Sidebar />
                            </Suspense>
                          </ErrorBoundary>
                          <div
                            className="absolute top-0 right-0 w-1 h-full cursor-col-resize active:bg-accent transition-colors z-50 translate-x-[2px]"
                            onMouseDown={startSidebarResize}
                          />
                        </div>
                      )}

                      <div className="flex-1 flex min-w-0 bg-background relative">
                        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                          {isWideModePanel && activeSidePanel ? (
                            <ErrorBoundary>
                              <Suspense fallback={<PanelSkeleton />}>
                                {activeSidePanel === 'scenarios' ? (
                                  <ScenarioManagerView />
                                ) : activeSidePanel === 'knowledge' ? (
                                  <KnowledgeView />
                                ) : (
                                  <DynamicPanelView panelId={activeSidePanel} />
                                )}
                              </Suspense>
                            </ErrorBoundary>
                          ) : showWelcomePage ? (
                            <ErrorBoundary>
                              <Suspense fallback={<FullScreenLoading />}>
                                <WelcomePage />
                              </Suspense>
                            </ErrorBoundary>
                          ) : showSettingsPage ? (
                            <ErrorBoundary>
                              <Suspense fallback={<InlineSettingsSkeleton />}>
                                <PreferencesDialog embedded />
                              </Suspense>
                            </ErrorBoundary>
                          ) : showUserProfilePage ? (
                            <ErrorBoundary>
                              <Suspense fallback={<InlineSettingsSkeleton />}>
                                <UserProfilePage />
                              </Suspense>
                            </ErrorBoundary>
                          ) : showBillingCenterPage ? (
                            <ErrorBoundary>
                              <Suspense fallback={<InlineSettingsSkeleton />}>
                                <BillingCenterPage />
                              </Suspense>
                            </ErrorBoundary>
                          ) : layoutConfig.showEditor ? (
                            <>
                              {isShellStudioActive ? (
                                <div className="flex-1 min-h-0 flex flex-col relative overflow-hidden">
                                  <ErrorBoundary>
                                    <Suspense fallback={<EditorSkeleton />}>
                                      <TerminalStudio />
                                    </Suspense>
                                  </ErrorBoundary>
                                </div>
                              ) : (
                                <>
                                  <div className="flex-1 min-h-0 flex flex-col relative overflow-hidden">
                                    <ErrorBoundary>
                                      <Suspense fallback={<EditorSkeleton />}>
                                        <Editor />
                                      </Suspense>
                                    </ErrorBoundary>
                                  </div>
                                  {layoutConfig.showTerminal && terminalVisible && (
                                    <ErrorBoundary>
                                      <Suspense fallback={null}>
                                        <TerminalPanel />
                                      </Suspense>
                                    </ErrorBoundary>
                                  )}
                                  {debugVisible && (
                                    <ErrorBoundary>
                                      <Suspense fallback={null}>
                                        <DebugPanel />
                                      </Suspense>
                                    </ErrorBoundary>
                                  )}
                                  <EditorBottomBar />
                                </>
                              )}
                            </>
                          ) : layoutConfig.layout === 'dashboard-centric' ? (
                            openFiles.length > 0 && activeFilePath ? (
                              <div className="flex-1 min-h-0 flex flex-col relative overflow-hidden">
                                <ErrorBoundary>
                                  <Suspense fallback={<EditorSkeleton />}>
                                    <Editor />
                                  </Suspense>
                                </ErrorBoundary>
                              </div>
                            ) : (
                              <ErrorBoundary>
                                <Suspense fallback={<PanelSkeleton />}>
                                  <DataDashboard />
                                </Suspense>
                              </ErrorBoundary>
                            )
                          ) : layoutConfig.layout === 'canvas-centric' ? (
                            <ErrorBoundary>
                              <Suspense fallback={<PanelSkeleton />}>
                                <CanvasWorkspace />
                              </Suspense>
                            </ErrorBoundary>
                          ) : layoutConfig.layout === 'focus-centric' ? (
                            openFiles.length > 0 && activeFilePath ? (
                              <div className="flex-1 min-h-0 flex flex-col relative overflow-hidden">
                                <ErrorBoundary>
                                  <Suspense fallback={<EditorSkeleton />}>
                                    <Editor />
                                  </Suspense>
                                </ErrorBoundary>
                              </div>
                            ) : (
                              <ErrorBoundary>
                                <Suspense fallback={<PanelSkeleton />}>
                                  <DataDashboard />
                                </Suspense>
                              </ErrorBoundary>
                            )
                          ) : layoutConfig.layout === 'research-centric' || layoutConfig.layout === 'split-centric' ? (
                            openFiles.length > 0 && activeFilePath ? (
                              <div className="flex-1 min-h-0 flex flex-col relative overflow-hidden">
                                <ErrorBoundary>
                                  <Suspense fallback={<EditorSkeleton />}>
                                    <Editor />
                                  </Suspense>
                                </ErrorBoundary>
                              </div>
                            ) : scenarioWelcomeComponent ? (
                              <ErrorBoundary>
                                <Suspense fallback={<PanelSkeleton />}>
                                  {(() => { const W = scenarioWelcomeComponent; return <W /> })()}
                                </Suspense>
                              </ErrorBoundary>
                            ) : (
                              <ErrorBoundary>
                                <Suspense fallback={<PanelSkeleton />}>
                                  <DataDashboard />
                                </Suspense>
                              </ErrorBoundary>
                            )
                          ) : layoutConfig.layout === 'analytics-centric' ? (
                            openFiles.length > 0 && activeFilePath ? (
                              <div className="flex-1 min-h-0 flex flex-col relative overflow-hidden">
                                <ErrorBoundary>
                                  <Suspense fallback={<EditorSkeleton />}>
                                    <Editor />
                                  </Suspense>
                                </ErrorBoundary>
                              </div>
                            ) : (
                              <ErrorBoundary>
                                <Suspense fallback={<PanelSkeleton />}>
                                  <StoreDiagnosisDashboard />
                                </Suspense>
                              </ErrorBoundary>
                            )
                          ) : null}
                        </div>

                        {layoutConfig.showChat && chatVisible && !(isWideModePanel && activeSidePanel !== 'knowledge' && (layoutConfig.wideModeHidesChat || activeSidePanel === 'scenarios')) && !(scenarioWelcomeComponent && activeSidePanel === 'explorer' && !(openFiles.length > 0 && activeFilePath)) && (
                          <div ref={chatRef} style={{ width: chatWidth }} className="flex-shrink-0 relative border-l border-border/30 shadow-[-1px_0_15px_rgba(0,0,0,0.03)] z-20 bg-background-chat">
                            <div
                              className="absolute top-0 left-0 w-1 h-full cursor-col-resize active:bg-accent transition-colors z-50 -translate-x-[2px]"
                              onMouseDown={startChatResize}
                            />
                            <ErrorBoundary>
                              <Suspense fallback={<ChatSkeleton />}>
                                <ChatPanel />
                              </Suspense>
                            </ErrorBoundary>
                          </div>
                        )}
                      </div>
                    </div>

                    {layoutConfig.showStatusBar && <WorkspaceStatusBar />}
                  </div>
                </>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 overflow-hidden">
            <Suspense fallback={<FullScreenLoading />}>
              <WelcomePage />
            </Suspense>
          </div>
        )}
      </div>

      {showCommandPalette && (
        <Suspense fallback={null}>
          <CommandHub
            onClose={() => setShowCommandPalette(false)}
            onShowKeyboardShortcuts={() => {
              setShowCommandPalette(false)
              setShowKeyboardShortcuts(true)
            }}
          />
        </Suspense>
      )}
      {showKeyboardShortcuts && (
        <Suspense fallback={null}>
          <ShortcutReference onClose={handleCloseKeyboardShortcuts} />
        </Suspense>
      )}
      {showQuickOpen && (
        <Suspense fallback={null}>
          <FileNavigator onClose={() => setShowQuickOpen(false)} />
        </Suspense>
      )}
      {showOnboarding && isInitialized && (
        <Suspense fallback={null}>
          <OnboardingWizard onComplete={handleCloseOnboarding} />
        </Suspense>
      )}
      {showAbout && (
        <Suspense fallback={null}>
          <AppIdentityPanel onClose={() => setShowAbout(false)} />
        </Suspense>
      )}

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
