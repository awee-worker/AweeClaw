import { api } from '../../adapters/electronBridge'
import { logger } from '@toolkit/LogEngine'
import { useEffect, useMemo, useState } from 'react'
import { BRAND } from '@shared/brand'
import { getQuotaBarColor, getQuotaTextColor, getQuotaGlowColor } from '@utils/quotaColors'
import {
  GitBranch,
  AlertCircle,
  XCircle,
  Database,
  Loader2,
  Cpu,
  Terminal,
  CheckCircle2,
  ScrollText,
  Maximize2,
  MessageSquare,
  Bug,
  ListTodo,
  Bell,
  Volume2,
  Cloud,
} from 'lucide-react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import type { IndexStatus } from '@protocols'
import type { ImProcessingPhase } from '@shared/protocols/channel'
import { useImProcessingStatus } from '@hooks/useImProcessingStatus'
import { indexWorkerService, type IndexProgress } from '@services/indexWorkerAdapter'
import DockPopover from '../ui/DockPopover'
import ToolCallLogContent from '../dock-panels/ToolLogPanel'
import ContextStatsContent from '../dock-panels/ContextMetricsPanel'
import PlanListContent from '../dock-panels/TaskListPanel'
import NotificationCenterContent, { NotificationClearButton } from '../dock-panels/NotificationPanel'
import { useInlineToast } from '@components/foundation/InlineNotification'
import { useHasElevatedToastLayer } from '@components/foundation/toastLayerStore'
import {
  useAgentStore,
  selectMessageCount,
  selectMessageListState,
  selectCompressionStats,
  selectContextIndicatorKind,
} from '@intelligence/state/IntelligenceStore'
import { isAssistantMessage, type TokenUsage } from '@intelligence/providerTypes'
import { useDiagnosticsStore, getFileStats } from '@services/diagnosticRepository'
import LanguageServiceIndicator from './LanguageServiceIndicator'
import { motion, AnimatePresence } from 'framer-motion'
import { shellComposer } from '@/renderer/shell/ShellComposer'
import { scenarioRegistry } from '@shared/configuration/scenarios'
import { t, type Language } from '@renderer/i18n'

function CloudQuotaIndicator({ language }: { language: Language }) {
  const { isAuthenticated, cloudMode, quota, fetchQuota } = useStore(
    useShallow((s) => ({
      isAuthenticated: s.isAuthenticated,
      cloudMode: s.cloudMode,
      quota: s.quota,
      fetchQuota: s.fetchQuota,
    })),
  )

  useEffect(() => {
    if (isAuthenticated && cloudMode === 'cloud' && !quota) {
      fetchQuota().catch(() => {})
    }
  }, [isAuthenticated, cloudMode, quota, fetchQuota])

  if (!isAuthenticated || cloudMode !== 'cloud') return null

  const usedPercent = quota && quota.limit !== -1
    ? Math.min(100, (quota.used / quota.limit) * 100)
    : 0

  const quotaPercent = quota && quota.remaining !== -1
    ? Math.max(0, Math.round((1 - quota.used / quota.limit) * 100))
    : null

  const isQuotaExceeded = quotaPercent !== null && quotaPercent <= 0
  const isQuotaLow = quotaPercent !== null && quotaPercent <= 20

  const cloudColorClass = getQuotaTextColor(usedPercent)
  const quotaLabel = quota
    ? quota.remaining === -1
      ? '∞'
      : `${quotaPercent}%`
    : ''
  const quotaColorClass = getQuotaTextColor(usedPercent)

  return (
    <DockPopover
      icon={
        <div
          className="flex items-center gap-1.5 px-2 py-1 h-6 rounded-md cursor-pointer group hover:bg-white/5 transition-colors"
          title={quota ? `Token: ${quota.used.toLocaleString()} / ${quota.limit.toLocaleString()}${isQuotaExceeded ? (t('layout.exceeded', language as Language)) : isQuotaLow ? (t('layout.low', language as Language)) : ''}` : ''}
        >
          <Cloud className={`w-3 h-3 ${cloudColorClass} ${getQuotaGlowColor(usedPercent)}`} />
          <span className="text-[10px] font-medium text-text-muted group-hover:text-text-primary transition-colors max-w-[80px] truncate">
            {quota?.displayName || (t('layout.usage', language as Language))}
          </span>
          {quotaLabel && (
            <span className={`text-[10px] font-mono ${quotaColorClass} transition-colors`}>
              {quotaLabel}
            </span>
          )}
        </div>
      }
      title={t('layout.tokenusage', language as Language)}
      width={300}
      height={280}
      language={language as 'en' | 'zh'}
    >
      <div className="p-3 space-y-4">
        {quota && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              <div className="flex flex-col items-center p-2.5 rounded-xl bg-surface/80">
                <span className="text-[10px] text-text-muted mb-1">{t('layout.used', language as Language)}</span>
                <span className="text-sm font-bold text-text-primary">{quota.used.toLocaleString()}</span>
              </div>
              <div className="flex flex-col items-center p-2.5 rounded-xl bg-surface/80">
                <span className="text-[10px] text-text-muted mb-1">{t('layout.remaining', language as Language)}</span>
                <span className="text-sm font-bold text-text-primary">
                  {quota.remaining === -1
                    ? (t('layout.text3', language as Language))
                    : quota.remaining.toLocaleString()}
                </span>
              </div>
              <div className="flex flex-col items-center p-2.5 rounded-xl bg-surface/80">
                <span className="text-[10px] text-text-muted mb-1">{t('layout.total', language as Language)}</span>
                <span className="text-sm font-bold text-text-primary">
                  {quota.limit === -1
                    ? (t('layout.text4', language as Language))
                    : quota.limit.toLocaleString()}
                </span>
              </div>
            </div>

            {quota.limit !== -1 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-text-muted">
                    {t('layout.progress', language as Language)}
                  </span>
                  <span className={`font-mono ${getQuotaTextColor(usedPercent)}`}>
                    {usedPercent.toFixed(1)}%
                  </span>
                </div>
                <div className="h-2 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${getQuotaBarColor(usedPercent)}`}
                    style={{ width: `${usedPercent}%` }}
                  />
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-accent/5 border border-accent/10">
              <span className="text-xs text-text-muted">
                {t('layout.plan', language as Language)}
              </span>
              <span className="text-xs font-medium text-accent ml-auto">
                {quota.displayName || (t('layout.free', language as Language))}
              </span>
            </div>
          </div>
        )}

        <button
          onClick={() => {
            useStore.getState().setShowSettingsPage(true)
          }}
          className="w-full py-2 text-xs text-accent hover:text-accent-hover transition-colors text-center"
        >
          {t('layout.managecloud', language as Language)}
        </button>
      </div>
    </DockPopover>
  )
}

export default function WorkspaceStatusBar() {
  const {
    activeFilePath,
    workspacePath,
    setShowSettingsPage,
    language,
    terminalVisible,
    setTerminalVisible,
    debugVisible,
    setDebugVisible,
    cursorPosition,
    isGitRepo,
    gitStatus,
    setActiveSidePanel,
  } = useStore(useShallow(s => ({
    activeFilePath: s.activeFilePath,
    workspacePath: s.workspacePath,
    setShowSettingsPage: s.setShowSettingsPage,
    language: s.language,
    terminalVisible: s.terminalVisible,
    setTerminalVisible: s.setTerminalVisible,
    debugVisible: s.debugVisible,
    setDebugVisible: s.setDebugVisible,
    cursorPosition: s.cursorPosition,
    isGitRepo: s.isGitRepo,
    gitStatus: s.gitStatus,
    setActiveSidePanel: s.setActiveSidePanel,
  })))

  const activeScenarioId = useStore(s => s.activeScenarioId)
  const showEditor = useMemo(() => {
    const scenario = scenarioRegistry.get(activeScenarioId)
    if (scenario) {
      return shellComposer.getLayoutConfig(scenario).showEditor
    }
    const defaultScenario = scenarioRegistry.getDefault()
    return shellComposer.getLayoutConfig(defaultScenario).showEditor
  }, [activeScenarioId])

  const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null)
  const [workerProgress, setWorkerProgress] = useState<IndexProgress | null>(null)

  const { toasts, visibleIds } = useInlineToast()
  const notificationCount = toasts.length
  const latestVisibleToastId = [...visibleIds].reverse().find(id => {
    const toast = toasts.find(item => item.id === id)
    return toast?.variant === 'inline'
  })
  const activeToast = latestVisibleToastId ? toasts.find(t => t.id === latestVisibleToastId) : null
  const shouldEject = useHasElevatedToastLayer()

  const diagnostics = useDiagnosticsStore(state => state.diagnostics)
  const version = useDiagnosticsStore(state => state.version)
  const currentFileStats = useMemo(() => getFileStats(diagnostics, activeFilePath), [activeFilePath, version, diagnostics])

  const messageCount = useAgentStore(selectMessageCount)
  const currentThreadId = useAgentStore(state => state.currentThreadId)
  const messageListVersion = useAgentStore(state => selectMessageListState(state).version)
  const compressionStats = useAgentStore(selectCompressionStats)
  const contextIndicatorKind = useAgentStore(selectContextIndicatorKind)

  const tokenStats = useMemo(() => {
    const messages = useAgentStore.getState().getMessages()
    const totalUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
    let lastUsage: TokenUsage | undefined

    for (const msg of messages) {
      if (isAssistantMessage(msg) && msg.usage) {
        totalUsage.promptTokens += msg.usage.promptTokens
        totalUsage.completionTokens += msg.usage.completionTokens
        totalUsage.totalTokens += msg.usage.totalTokens
        totalUsage.cachedInputTokens = (totalUsage.cachedInputTokens || 0) + (msg.usage.cachedInputTokens || 0)
        totalUsage.cacheWriteTokens = (totalUsage.cacheWriteTokens || 0) + (msg.usage.cacheWriteTokens || 0)
        lastUsage = msg.usage
      }
    }

    return { totalUsage, lastUsage }
  }, [currentThreadId, messageCount, messageListVersion])

  useEffect(() => {
    indexWorkerService.initialize()
    const unsubProgress = indexWorkerService.onProgress(setWorkerProgress)
    const unsubError = indexWorkerService.onError(error => {
      logger.ui.error('[WorkspaceStatusBar] Worker error:', error)
    })

    return () => {
      unsubProgress()
      unsubError()
    }
  }, [])

  useEffect(() => {
    if (!workspacePath) {
      setIndexStatus(null)
      return
    }

    api.index.status(workspacePath).then(setIndexStatus)
    const unsubscribe = api.index.onProgress(setIndexStatus)
    return unsubscribe
  }, [workspacePath])

  const handleIndexClick = () => setShowSettingsPage(true)
  const handleDiagnosticsClick = () => setActiveSidePanel('problems')
  const toolCallLogs = useStore(state => state.toolCallLogs)
  const currentThreadToolCallCount = useMemo(
    () => currentThreadId ? toolCallLogs.filter(log => log.threadId === currentThreadId).length : 0,
    [currentThreadId, toolCallLogs]
  )
  const plans = useAgentStore(state => state.plans)
  const activePlanId = useAgentStore(state => state.activePlanId)
  const loadPlansFromDisk = useAgentStore(state => state.loadPlansFromDisk)

  useEffect(() => {
    if (workspacePath) {
      loadPlansFromDisk(workspacePath)
    }
  }, [workspacePath, loadPlansFromDisk])

  const executingPlansCount = plans.filter(plan =>
    plan.status === 'executing' || plan.status === 'pausing' || plan.status === 'stopping'
  ).length

  const layerColorClass =
    compressionStats?.level === 4 ? 'text-red-400 drop-shadow-[0_0_6px_rgba(248,113,113,0.4)]' :
      compressionStats?.level === 3 ? 'text-orange-400 drop-shadow-[0_0_6px_rgba(251,146,60,0.4)]' :
        compressionStats?.level === 2 ? 'text-yellow-400 drop-shadow-[0_0_6px_rgba(250,204,21,0.4)]' :
          compressionStats?.level === 1 ? 'text-blue-400 drop-shadow-[0_0_6px_rgba(96,165,250,0.4)]' :
            'text-text-muted group-hover:text-text-primary'

  const contextIndicatorCopy = useMemo(() => ({
    compressing: t('layout.compressing', language as Language),
    handoffReady: t('layout.handoffready', language as Language),
    switching: t('layout.switching', language as Language),
    switched: t('layout.switched', language as Language),
  }), [language])

  const imStatuses = useImProcessingStatus()

  const imStatusLabel = useMemo(() => {
    if (imStatuses.length === 0) return null
    const status = imStatuses[imStatuses.length - 1]
    const phaseLabels: Record<ImProcessingPhase, string> = {
      received: t('layout.messagereceived', language as Language),
      thinking: t('layout.thinking', language as Language),
      replying: t('layout.replying', language as Language),
      done: t('layout.replysent', language as Language),
      error: t('layout.error', language as Language),
    }
    const countLabel = imStatuses.length > 1
      ? (t('layout.text5', language as Language, { length: imStatuses.length }))
      : ''
    return {
      text: `${status.channelLabel} · ${status.senderName} - ${phaseLabels[status.phase]}${countLabel}`,
      phase: status.phase,
    }
  }, [imStatuses, language])

  return (
    <div className={`${BRAND.cssPrefix}-status-strip`}>
      <style>{`
        .${BRAND.cssPrefix}-status-strip {
          height: 28px;
          background: rgb(var(--background-secondary));
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 10px;
          font-size: 11px;
          user-select: none;
          color: rgb(var(--text-muted));
          z-index: 50;
          font-weight: 500;
          border-top: 1px solid rgba(var(--border), 0.2);
        }
      `}</style>
      <div className="flex items-center gap-3">
        {isGitRepo && gitStatus && (
          <button className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-white/5 text-text-muted hover:text-text-primary transition-colors group">
            <div className="flex items-center justify-center w-4 h-4 transition-colors">
              <GitBranch className="w-3 h-3 text-text-muted group-hover:text-text-primary transition-colors" />
            </div>
            <span className="font-medium tracking-wide group-hover:text-text-primary">{gitStatus.branch}</span>
          </button>
        )}

        {showEditor && (
          <button
            onClick={handleDiagnosticsClick}
            className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-white/5 transition-colors text-text-muted group hover:text-text-primary"
          >
            <div className="flex items-center gap-1">
              <div className="flex items-center justify-center w-4 h-4 transition-colors">
                <XCircle className={`w-3 h-3 ${currentFileStats.errors > 0 ? 'text-red-400 drop-shadow-[0_0_6px_rgba(248,113,113,0.4)]' : 'text-text-muted group-hover:text-text-primary transition-colors'}`} />
              </div>
              <span className={`font-medium ${currentFileStats.errors > 0 ? 'text-red-400' : 'text-text-muted group-hover:text-text-primary'}`}>{currentFileStats.errors}</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="flex items-center justify-center w-4 h-4 transition-colors">
                <AlertCircle className={`w-3 h-3 ${currentFileStats.warnings > 0 ? 'text-amber-400 drop-shadow-[0_0_6px_rgba(251,191,36,0.4)]' : 'text-text-muted group-hover:text-text-primary transition-colors'}`} />
              </div>
              <span className={`font-medium ${currentFileStats.warnings > 0 ? 'text-amber-400' : 'text-text-muted group-hover:text-text-primary'}`}>{currentFileStats.warnings}</span>
            </div>
          </button>
        )}

        {workerProgress && !workerProgress.isComplete && workerProgress.total > 0 && (
          <div className="flex items-center gap-1.5 text-accent animate-fade-in px-2 py-0.5 rounded-md transition-colors hover:bg-white/5 cursor-default">
            <div className="flex items-center justify-center w-4 h-4 drop-shadow-[0_0_6px_rgba(var(--accent-rgb),0.5)]">
              <Cpu className="w-3 h-3 animate-pulse text-accent" />
            </div>
            <span className="font-medium">{workerProgress.message || `${Math.round((workerProgress.processed / workerProgress.total) * 100)}%`}</span>
          </div>
        )}

        {workspacePath && (
          <button
            onClick={handleIndexClick}
            className="flex items-center justify-center w-6 h-6 rounded-md hover:bg-white/5 transition-colors group"
          >
            {indexStatus?.isIndexing ? (
              <div className="flex items-center justify-center w-4 h-4 drop-shadow-[0_0_6px_rgba(var(--accent-rgb),0.5)]">
                <Loader2 className="w-3 h-3 animate-spin text-accent" />
              </div>
            ) : indexStatus?.totalChunks ? (
              <div className="flex items-center justify-center w-4 h-4 drop-shadow-[0_0_6px_rgba(52,211,153,0.5)]">
                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
              </div>
            ) : (
              <div className="flex items-center justify-center w-4 h-4">
                <Database className="w-3 h-3 text-text-muted group-hover:text-text-primary transition-colors" />
              </div>
            )}
          </button>
        )}

        {imStatusLabel && (
          <AnimatePresence mode="wait">
            <motion.div
              key={imStatusLabel.phase}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.2 }}
              className="flex items-center gap-1.5 px-2 py-0.5 rounded-md hover:bg-white/5 cursor-default"
            >
              {imStatusLabel.phase === 'thinking' || imStatusLabel.phase === 'replying' ? (
                <div className="flex items-center justify-center w-4 h-4 drop-shadow-[0_0_6px_rgba(var(--accent-rgb),0.5)]">
                  <Loader2 className="w-3 h-3 animate-spin text-accent" />
                </div>
              ) : imStatusLabel.phase === 'received' ? (
                <div className="flex items-center justify-center w-4 h-4 drop-shadow-[0_0_6px_rgba(96,165,250,0.5)]">
                  <MessageSquare className="w-3 h-3 text-blue-400" />
                </div>
              ) : imStatusLabel.phase === 'error' ? (
                <div className="flex items-center justify-center w-4 h-4 drop-shadow-[0_0_6px_rgba(248,113,113,0.4)]">
                  <AlertCircle className="w-3 h-3 text-red-400" />
                </div>
              ) : null}
              <span className={`font-medium ${
                imStatusLabel.phase === 'thinking' || imStatusLabel.phase === 'replying'
                  ? 'text-accent'
                  : imStatusLabel.phase === 'error'
                    ? 'text-red-400'
                    : 'text-text-muted'
              }`}>
                {imStatusLabel.text}
              </span>
            </motion.div>
          </AnimatePresence>
        )}
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-4 h-full">
        <CloudQuotaIndicator language={language} />

        {showEditor && (
          <div className="flex items-center gap-3 pr-1 h-full font-mono">
            <div className="flex items-center gap-2 cursor-pointer hover:bg-white/5 hover:text-text-primary px-2 py-1 rounded-md transition-colors text-[10px] hidden md:flex">
              <span>Ln {cursorPosition?.line || 1}, Col {cursorPosition?.column || 1}</span>
            </div>
            <LanguageServiceIndicator />
          </div>
        )}

        <div className="flex items-center gap-1 h-full">
          <DockPopover
            icon={
              <AnimatePresence mode="wait">
                {contextIndicatorKind === 'switching' ? (
                  <motion.div
                    key="transitioning"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    className="flex items-center gap-1.5 text-red-400 px-2 h-6 hover:bg-white/5 rounded-md transition-colors"
                  >
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                      className="flex items-center justify-center w-4 h-4 drop-shadow-[0_0_6px_rgba(248,113,113,0.5)]"
                    >
                      <Loader2 className="w-3 h-3" />
                    </motion.div>
                    <span className="text-[10px] font-medium">
                      {contextIndicatorCopy.switching}
                    </span>
                  </motion.div>
                ) : contextIndicatorKind === 'compressing' ? (
                  <motion.div
                    key="compressing"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    className="flex items-center gap-1.5 px-2 h-6 hover:bg-white/5 rounded-md cursor-pointer transition-colors"
                  >
                    <motion.div
                      className="flex items-center justify-center w-4 h-4 drop-shadow-[0_0_6px_rgba(var(--accent-rgb),0.5)]"
                      animate={{ scale: [1, 1.2, 1], opacity: [1, 0.7, 1] }}
                      transition={{ duration: 0.8, repeat: Infinity }}
                    >
                      <Maximize2 className="w-3 h-3 text-accent" />
                    </motion.div>
                    <span className="text-[10px] font-medium text-accent">
                      {contextIndicatorCopy.compressing}
                    </span>
                  </motion.div>
                ) : contextIndicatorKind === 'handoff_ready' ? (
                  <motion.div
                    key="handoff-ready"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    className="flex items-center gap-1.5 text-amber-400 px-2 h-6 hover:bg-white/5 rounded-md transition-colors"
                  >
                    <div className="flex items-center justify-center w-4 h-4 drop-shadow-[0_0_6px_rgba(251,191,36,0.45)]">
                      <ScrollText className="w-3 h-3" />
                    </div>
                    <span className="text-[10px] font-medium">
                      {contextIndicatorCopy.handoffReady}
                    </span>
                  </motion.div>
                ) : contextIndicatorKind === 'switched' ? (
                  <motion.div
                    key="switched"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    className="flex items-center gap-1.5 text-emerald-400 px-2 h-6 hover:bg-white/5 rounded-md transition-colors"
                  >
                    <div className="flex items-center justify-center w-4 h-4 drop-shadow-[0_0_6px_rgba(52,211,153,0.45)]">
                      <CheckCircle2 className="w-3 h-3" />
                    </div>
                    <span className="text-[10px] font-medium">
                      {contextIndicatorCopy.switched}
                    </span>
                  </motion.div>
                ) : (
                  <motion.div
                    key="normal"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex items-center justify-center px-1.5 py-1 rounded-md hover:bg-white/5 transition-colors cursor-pointer group h-6"
                  >
                    <div className="flex items-center gap-1.5">
                      <div className="flex items-center justify-center transition-all duration-300 w-4 h-4">
                        <Maximize2 className={`w-3 h-3 transition-colors ${layerColorClass}`} />
                      </div>
                      <span className="text-[10px] font-bold font-mono text-text-muted group-hover:text-text-primary transition-colors">
                        {compressionStats ? `${(compressionStats.ratio * 100).toFixed(1)}%` : '0%'}
                      </span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            }
            width={340}
            height={480}
            language={language as 'en' | 'zh'}
          >
            <ContextStatsContent
              totalUsage={tokenStats.totalUsage}
              lastUsage={tokenStats.lastUsage}
              language={language as 'en' | 'zh'}
            />
          </DockPopover>

          {messageCount > 0 && (
            <div className="flex items-center gap-1.5 px-2 py-1 h-6 rounded-md cursor-default group hover:bg-white/5 transition-colors">
              <div className="flex items-center justify-center w-4 h-4 transition-colors">
                <MessageSquare className="w-3 h-3 text-text-muted group-hover:text-text-primary transition-colors" />
              </div>
              <span className="font-medium text-text-muted group-hover:text-text-primary transition-colors">{messageCount}</span>
            </div>
          )}

          {plans.length > 0 && (
            <DockPopover
              icon={
                <div className="group flex items-center justify-center w-6 h-6 rounded-md hover:bg-white/5 transition-colors">
                  <div className="relative flex items-center justify-center w-4 h-4 transition-colors">
                    <ListTodo className={`w-3 h-3 transition-colors ${executingPlansCount > 0 ? 'text-amber-400 drop-shadow-[0_0_6px_rgba(251,191,36,0.6)]' : 'text-text-muted group-hover:text-text-primary'}`} />
                    {executingPlansCount > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse shadow-[0_0_4px_rgba(251,191,36,0.5)] border border-background-secondary" />
                    )}
                  </div>
                </div>
              }
              tooltip={t('layout.taskplans', language as Language)}
              title={t('layout.taskplans2', language as Language)}
              badge={activePlanId ? undefined : plans.length}
              width={340}
              height={360}
              language={language as 'en' | 'zh'}
            >
              <PlanListContent language={language as 'en' | 'zh'} />
            </DockPopover>
          )}

          <DockPopover
            icon={
              <div className="group flex items-center justify-center w-6 h-6 rounded-md hover:bg-white/5 transition-colors">
                <div className="relative flex items-center justify-center w-4 h-4 transition-colors">
                  <ScrollText className={`w-3 h-3 transition-colors ${currentThreadToolCallCount > 0 ? 'text-blue-400 drop-shadow-[0_0_6px_rgba(96,165,250,0.6)]' : 'text-text-muted group-hover:text-text-primary'}`} />
                  {currentThreadToolCallCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-blue-400 shadow-[0_0_8px_currentColor] rounded-full" />
                  )}
                </div>
              </div>
            }
            width={380}
            height={280}
            language={language as 'en' | 'zh'}
          >
            <ToolCallLogContent language={language as 'en' | 'zh'} />
          </DockPopover>
        </div>

        {showEditor && (
          <div className="flex items-center gap-0.5 h-full">
            <button
              onClick={() => setTerminalVisible(!terminalVisible)}
              className="group flex items-center justify-center w-7 h-7 rounded-md transition-all"
              title="Toggle Terminal"
            >
              <div className={`flex items-center justify-center w-5 h-5 rounded-md transition-colors ${terminalVisible ? 'text-accent drop-shadow-[0_0_6px_rgba(var(--accent-rgb),0.5)]' : 'text-text-muted hover:bg-white/5 hover:text-text-primary'}`}>
                <Terminal className="w-3 h-3" />
              </div>
            </button>
            <button
              onClick={() => setDebugVisible(!debugVisible)}
              className="group flex items-center justify-center w-7 h-7 rounded-md transition-all"
              title="Toggle Debug"
            >
              <div className={`flex items-center justify-center w-5 h-5 rounded-md transition-colors ${debugVisible ? 'text-accent drop-shadow-[0_0_6px_rgba(var(--accent-rgb),0.5)]' : 'text-text-muted hover:bg-white/5 hover:text-text-primary'}`}>
                <Bug className="w-3 h-3" />
              </div>
            </button>
          </div>
        )}

        <div className="flex items-center h-full pr-1">
          <DockPopover
            icon={
              <div className={`group relative flex items-center h-6 rounded-md transition-all ease-out duration-500 overflow-hidden ${activeToast && !shouldEject ? 'bg-transparent px-1 max-w-[320px]' : 'justify-center w-6 hover:bg-white/5'}`}>
                <AnimatePresence mode="wait">
                  {activeToast && !shouldEject ? (
                    <motion.div
                      layoutId={BRAND.layout.dynamicIslandId}
                      key={activeToast.id}
                      initial={{ opacity: 0, width: 0 }}
                      animate={{ opacity: 1, width: 'auto' }}
                      exit={{ opacity: 0, width: 0 }}
                      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                      className="flex items-center gap-1.5 whitespace-nowrap pl-1"
                    >
                      <Volume2 className={`w-3.5 h-3.5 animate-pulse shrink-0 ${
                        activeToast.type === 'success' ? 'text-emerald-400 drop-shadow-[0_0_6px_rgba(52,211,153,0.6)]' :
                          activeToast.type === 'error' ? 'text-red-400 drop-shadow-[0_0_6px_rgba(248,113,113,0.6)]' :
                            activeToast.type === 'warning' ? 'text-amber-400 drop-shadow-[0_0_6px_rgba(251,191,36,0.6)]' :
                              'text-blue-400 drop-shadow-[0_0_6px_rgba(96,165,250,0.6)]'
                      }`} />
                      <span className="text-[10.5px] text-text-primary font-medium truncate max-w-[260px]">
                        {activeToast.message}
                      </span>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="bell"
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.8 }}
                      className="relative flex items-center justify-center w-4 h-4 transition-colors"
                    >
                      <Bell className={`w-3 h-3 ${notificationCount > 0 ? 'text-accent drop-shadow-[0_0_6px_rgba(var(--accent-rgb),0.6)]' : 'text-text-muted group-hover:text-text-primary'}`} />
                      {notificationCount > 0 && (
                        <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-accent shadow-[0_0_8px_currentColor] rounded-full" />
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            }
            title={t('layout.messages', language as Language)}
            headerActions={<NotificationClearButton language={language as 'en' | 'zh'} />}
            badge={undefined}
            width={360}
            height={420}
            language={language as 'en' | 'zh'}
          >
            <NotificationCenterContent language={language as 'en' | 'zh'} />
          </DockPopover>
        </div>
      </div>
    </div>
  )
}
