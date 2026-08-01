import { Minus, Square, X, Search, Plus, Bell, Cloud, Phone } from 'lucide-react'

function PanelLeftIcon({ filled = false, className }: { filled?: boolean; className?: string }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            className={className}>
            <rect width="18" height="18" x="3" y="3" rx="2" />
            {filled && <path d="M3 5a2 2 0 0 1 2-2h4v18H5a2 2 0 0 1-2-2V5z" fill="currentColor" opacity="0.75" stroke="none" />}
            <line x1="9" x2="9" y1="3" y2="21" />
        </svg>
    )
}

function PanelRightIcon({ filled = false, className }: { filled?: boolean; className?: string }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            className={className}>
            <rect width="18" height="18" x="3" y="3" rx="2" />
            {filled && <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4V3z" fill="currentColor" opacity="0.75" stroke="none" />}
            <line x1="15" x2="15" y1="3" y2="21" />
        </svg>
    )
}
import { api } from '../../adapters/electronBridge'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { useAgentActions } from '@hooks/useAgent'
import ProjectSelector from './ProjectSelector'
import { ScenarioSelector } from '../scenario/ScenarioSelector'
import { useInlineToast } from '@components/foundation/InlineNotification'
import { useHasElevatedToastLayer } from '@components/foundation/toastLayerStore'
import { BRAND } from '@shared/brand'
import ImStatusFloating from './ImStatusFloating'
import { motion, AnimatePresence } from 'framer-motion'
import { Volume2 } from 'lucide-react'
import DockPopover from '../ui/DockPopover'
import NotificationCenterContent, { NotificationClearButton } from '../dock-panels/NotificationPanel'
import { getQuotaBarColor, getQuotaTextColor, getQuotaGlowColor } from '@utils/quotaColors'
import { PluginTopActions } from '@renderer/plugins/PluginTopActions'
import { formatTokenCount } from '@utils/formatter'
import { useEffect } from 'react'
import { t, type Language } from '@renderer/i18n'

const isMac = typeof navigator !== 'undefined' && (
  navigator.platform.toUpperCase().indexOf('MAC') >= 0 ||
  ((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform?.toUpperCase().indexOf('MAC') ?? -1) >= 0
)

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
      placement="bottom"
      icon={
        <div
          className="flex items-center gap-1.5 px-1.5 py-0.5 h-6 rounded-md cursor-pointer group hover:bg-white/5 transition-colors"
          title={quota ? `Token: ${formatTokenCount(quota.used)} / ${quota.limit === -1 ? '∞' : formatTokenCount(quota.limit)}${isQuotaExceeded ? (t('layout.exceeded', language as Language)) : isQuotaLow ? (t('layout.low', language as Language)) : ''}` : ''}
        >
          <Cloud className={`w-3 h-3 ${cloudColorClass} ${getQuotaGlowColor(usedPercent)}`} />
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
                <span className="text-sm font-bold text-text-primary">{formatTokenCount(quota.used)}</span>
              </div>
              <div className="flex flex-col items-center p-2.5 rounded-xl bg-surface/80">
                <span className="text-[10px] text-text-muted mb-1">{t('layout.remaining', language as Language)}</span>
                <span className="text-sm font-bold text-text-primary">
                  {quota.remaining === -1
                    ? (t('layout.text0', language as Language))
                    : formatTokenCount(quota.remaining)}
                </span>
              </div>
              <div className="flex flex-col items-center p-2.5 rounded-xl bg-surface/80">
                <span className="text-[10px] text-text-muted mb-1">{t('layout.total', language as Language)}</span>
                <span className="text-sm font-bold text-text-primary">
                  {quota.limit === -1
                    ? (t('layout.text1', language as Language))
                    : formatTokenCount(quota.limit)}
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

export default function AppTitleBar() {
  const { setShowQuickOpen, language, activeSidePanel, chatVisible, toggleSidebar, toggleChat, navRailExpanded, setNavRailExpanded, setVoiceConversationActive, closeAllFullPages } = useStore(useShallow(s => ({
    setShowQuickOpen: s.setShowQuickOpen,
    language: s.language,
    activeSidePanel: s.activeSidePanel,
    chatVisible: s.chatVisible,
    toggleSidebar: s.toggleSidebar,
    toggleChat: s.toggleChat,
    navRailExpanded: s.navRailExpanded,
    setNavRailExpanded: s.setNavRailExpanded,
    setVoiceConversationActive: s.setVoiceConversationActive,
    closeAllFullPages: s.closeAllFullPages,
  })))

  const sidebarVisible = activeSidePanel !== null
  const { createThread } = useAgentActions()

  const { toasts, visibleIds } = useInlineToast()
  const notificationCount = toasts.length
  const latestVisibleToastId = [...visibleIds].reverse().find(id => {
    const toast = toasts.find(item => item.id === id)
    return toast?.variant === 'inline'
  })
  const activeToast = latestVisibleToastId ? toasts.find(t => t.id === latestVisibleToastId) : null
  const shouldEject = useHasElevatedToastLayer()

  return (
    <div className="h-11 flex items-center justify-between px-0 drag-region select-none bg-background z-50 border-b border-border/30">
      <div className={`flex items-center gap-3 h-full ${isMac && !navRailExpanded ? 'pl-[40px]' : 'pl-3'}`}>
        <button
          onClick={() => setNavRailExpanded(!navRailExpanded)}
          className="no-drag w-7 h-7 rounded-md flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-hover transition-all duration-200"
          title={navRailExpanded
            ? (t('layout.collapsemenu', language as Language))
            : (t('layout.expandmenu', language as Language))}
        >
          {navRailExpanded
            ? <PanelLeftIcon filled className="w-4 h-4" />
            : <PanelLeftIcon className="w-4 h-4" />
          }
        </button>

        <div className="no-drag">
          <ScenarioSelector />
        </div>

        <div className="w-[1px] h-4 bg-border/50" />

        <div className="no-drag">
          <ProjectSelector />
        </div>

        <div className="w-[1px] h-4 bg-border/50" />

        <div
          onClick={() => setShowQuickOpen(true)}
          className="no-drag flex items-center gap-1.5 px-2 h-[28px] rounded-md hover:bg-text-primary/[0.06] transition-all duration-200 cursor-pointer group"
        >
          <Search className="w-3.5 h-3.5 text-text-muted opacity-70 group-hover:text-accent transition-colors" />
          <span className="text-xs text-text-muted opacity-70 group-hover:text-text-primary transition-colors">
            {t('layout.search', language as Language)}
          </span>
        </div>
      </div>

      <div className="flex-1 min-w-0" />

      <div className="flex items-center justify-end h-full pr-2 gap-1">
        <div className="no-drag flex items-center gap-1 h-full mr-2">
          <ImStatusFloating />

          {chatVisible && (
            <>
              <button
                onClick={() => createThread()}
                className="flex items-center gap-1.5 px-2.5 py-1 text-[13px] font-medium text-text-muted hover:text-text-primary hover:bg-[rgba(var(--text-primary),0.06)] rounded-md transition-colors"
                title={t('layout.newchat', language as Language)}
              >
                <Plus className="w-3.5 h-3.5" />
                {t('layout.newchat2', language as Language)}
              </button>
              <button
                onClick={() => {
                  setVoiceConversationActive(true)
                  // 异步关闭其他全屏页面，避免阻塞语音窗口渲染
                  setTimeout(() => closeAllFullPages(), 0)
                }}
                className="flex items-center justify-center w-7 h-7 text-text-muted hover:text-accent hover:bg-accent/10 rounded-md transition-colors"
                title={language === 'zh' ? '语音对话' : 'Voice conversation'}
              >
                <Phone className="w-3.5 h-3.5" />
              </button>
              {/* 插件贡献的顶部按钮（扩展点），紧跟语音按钮之后 */}
              <PluginTopActions />
            </>
          )}

          <div className="w-[1px] h-4 bg-border/50 mx-1"></div>

          <CloudQuotaIndicator language={language} />

          <DockPopover
            placement="bottom"
            icon={
              <div className="relative flex items-center justify-center">
                <AnimatePresence mode="wait">
                  {activeToast && !shouldEject ? (
                    <motion.div
                      layoutId={BRAND.layout.dynamicIslandId}
                      key={activeToast.id}
                      initial={{ opacity: 0, width: 0 }}
                      animate={{ opacity: 1, width: 'auto' }}
                      exit={{ opacity: 0, width: 0 }}
                      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                      className="flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <Volume2 className={`w-3.5 h-3.5 animate-pulse shrink-0 ${
                        activeToast.type === 'success' ? 'text-emerald-400' :
                          activeToast.type === 'error' ? 'text-red-400' :
                            activeToast.type === 'warning' ? 'text-amber-400' :
                              'text-blue-400'
                      }`} />
                      <span className="text-[10.5px] text-text-primary font-medium truncate max-w-[160px]">
                        {activeToast.message}
                      </span>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="bell"
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.8 }}
                      className="relative flex items-center justify-center"
                    >
                      <Bell className={`w-4 h-4 ${notificationCount > 0 ? 'text-accent' : ''}`} />
                      {notificationCount > 0 && (
                        <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-accent rounded-full" />
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            }
            title={t('layout.messages', language as Language)}
            headerActions={<NotificationClearButton language={language as 'en' | 'zh'} />}
            width={360}
            height={420}
            language={language as 'en' | 'zh'}
          >
            <NotificationCenterContent language={language as 'en' | 'zh'} />
          </DockPopover>

          <div className="w-[1px] h-4 bg-border/50 mx-1"></div>

          <button
            onClick={toggleSidebar}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-text-primary/[0.05] transition-colors"
            title={language === 'zh' ? (sidebarVisible ? '隐藏侧边栏' : '显示侧边栏') : (sidebarVisible ? 'Hide Sidebar' : 'Show Sidebar')}
          >
            {sidebarVisible ? <PanelLeftIcon filled className="w-4 h-4" /> : <PanelLeftIcon className="w-4 h-4" />}
          </button>

          <button
            onClick={toggleChat}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-text-primary/[0.05] transition-colors"
            title={language === 'zh' ? (chatVisible ? '隐藏 AI 助手' : '显示 AI 助手') : (chatVisible ? 'Hide AI Assistant' : 'Show AI Assistant')}
          >
            {chatVisible ? <PanelRightIcon filled className="w-4 h-4" /> : <PanelRightIcon className="w-4 h-4" />}
          </button>
        </div>

        {!isMac && (
          <div className="no-drag flex items-center h-full pl-2 border-l border-border-subtle">
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => api.window.minimize()}
                className="w-9 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-text-primary/[0.05] transition-all group"
              >
                <Minus className="w-4 h-4 opacity-70 group-hover:opacity-100" />
              </button>
              <button
                onClick={() => api.window.maximize()}
                className="w-9 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-text-primary/[0.05] transition-all group"
              >
                <Square className="w-3 h-3 opacity-70 group-hover:opacity-100" />
              </button>
              <button
                onClick={() => api.window.close()}
                className="w-9 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-red-500/90 transition-all group"
              >
                <X className="w-4 h-4 opacity-70 group-hover:opacity-100" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
