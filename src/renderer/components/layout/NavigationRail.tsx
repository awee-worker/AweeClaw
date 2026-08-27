import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Settings, Compass, LogIn, ChevronUp, CloudSync, Info, MessageSquare, Plus, MoreHorizontal, Edit2, Trash2, LogOut, UserCircle, Wallet, History, Clock, Puzzle, Blocks } from 'lucide-react'
import { HintOverlay } from '../ui/HintOverlay'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { scenarioRegistry } from '@shared/configuration/scenarios'
import { getLucideIcon } from '../foundation/IconMap'
import { Logo } from '../foundation/BrandMark'
import { UserAccountPopover } from './UserAccountPopover'
import { UpdateModal } from './UpdateModal'
import { QuickSettingsMenu } from './QuickSettingsMenu'
import { updaterService, type UpdateStatus } from '@services/updateAdapter'
import { useAgentStore } from '@intelligence/state/IntelligenceStore'
import { useAgentActions, useAllThreads } from '@hooks/useAgent'
import { getThreadDisplayTitle, getMessageText } from '@intelligence/providerTypes'
import type { ChatThread } from '@intelligence/providerTypes'
import type { SidebarItemDescriptor } from '@shared/protocols/scenario'
import type { SidePanel } from '@store/slices'
import { BRAND } from '@shared/brand'
import { formatUserDisplayName } from '@shared/toolkit/formatHelper'
import { t, type Language } from '@renderer/i18n'
import { usePluginExtensions } from '@renderer/plugins/usePluginExtensions'

const isMac = typeof navigator !== 'undefined' && (
  navigator.platform.toUpperCase().indexOf('MAC') >= 0 ||
  ((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform?.toUpperCase().indexOf('MAC') ?? -1) >= 0
)

const DEFAULT_ITEMS: SidebarItemDescriptor[] = [
  { id: 'explorer', icon: 'Files', label: 'Workspace', labelZh: '工作区', component: 'ExplorerView', position: 0 },
  { id: 'knowledge', icon: 'BookOpen', label: 'Knowledge', labelZh: '知识库', component: 'KnowledgeView', position: 1 },
]

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

function UserMenuDropdown({
  isOpen,
  onClose,
  language,
  onSettingsClick,
  onExploreClick,
  // onWorkflowClick 见类型声明；工作流菜单暂隐藏（见 featureItems 注释），恢复时在此重新解构
  onScheduleClick,
  onPluginCenterClick,
  onUserInfoClick,
  onBillingCenterClick,
  onSessionHistoryClick,
  onCheckUpdate,
  onAbout,
  onLogout,
  isAuthenticated,
  cloudUser,
  anchorRef,
  hasUpdateAvailable,
}: {
  isOpen: boolean
  onClose: () => void
  language: Language
  onSettingsClick: () => void
  onExploreClick: () => void
  onWorkflowClick: () => void
  onScheduleClick: () => void
  onPluginCenterClick: () => void
  onUserInfoClick: () => void
  onBillingCenterClick: () => void
  onSessionHistoryClick: () => void
  onCheckUpdate: () => void
  onAbout: () => void
  onLogout: () => void
  isAuthenticated: boolean
  cloudUser: { username?: string; email: string; avatarUrl?: string; planId: string; phone?: string } | null
  anchorRef: React.RefObject<HTMLDivElement | null>
  hasUpdateAvailable: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({})

  useEffect(() => {
    if (!isOpen) { setShowLogoutConfirm(false); return }
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [isOpen, onClose])

  useEffect(() => {
    if (!isOpen || !anchorRef.current) return
    const anchor = anchorRef.current
    const rect = anchor.getBoundingClientRect()
    setMenuStyle({
      position: 'fixed',
      left: rect.left,
      bottom: window.innerHeight - rect.top + 4,
      width: 200,
    })
  }, [isOpen, anchorRef])

  if (!isOpen) return null

  const planLabel = cloudUser?.planId === 'ENTERPRISE'
    ? (t('layout.enterprise', language as Language))
    : cloudUser?.planId === 'PRO'
      ? (t('layout.pro', language as Language))
      : cloudUser?.planId === 'TEAM'
        ? (t('layout.team', language as Language))
        : t('layout.free', language as Language)

  const initial = cloudUser?.username?.[0]?.toUpperCase() || cloudUser?.email?.[0]?.toUpperCase() || '?'
  const displayName = formatUserDisplayName(cloudUser?.username || cloudUser?.email || cloudUser?.phone || '')

  const featureItems = [
    { icon: Compass, label: t('layout.workscenes', language as Language), onClick: onExploreClick },
    { icon: Puzzle, label: t('layout.pluginsandskills', language as Language), onClick: onPluginCenterClick },
    { icon: Clock, label: t('layout.schedule', language as Language), onClick: onScheduleClick },
    // 工作流菜单暂时隐藏，后续版本恢复
    // { icon: Workflow, label: t('layout.workflow', language as Language), onClick: onWorkflowClick },
  ]

  const systemItems = [
    { icon: Settings, label: t('layout.settings', language as Language), onClick: onSettingsClick, hasBadge: false },
    { icon: CloudSync, label: t('layout.checkforupdates', language as Language), onClick: onCheckUpdate, hasBadge: hasUpdateAvailable },
    { icon: Info, label: t('layout.aboutaweeclaw', language as Language), onClick: onAbout, hasBadge: false },
  ]

  return createPortal(
    <div
      ref={ref}
      style={menuStyle}
      className="py-1 rounded-xl bg-surface/95 backdrop-blur-xl border border-border/50 shadow-xl shadow-black/20 z-[9999]"
    >
      {isAuthenticated && (
        <button
          onClick={() => { onUserInfoClick(); onClose() }}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-text-primary/[0.06] transition-colors"
        >
          {cloudUser?.avatarUrl ? (
            <img src={cloudUser.avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover border border-border/40 flex-shrink-0" />
          ) : (
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-accent/80 to-accent/40 flex items-center justify-center text-white text-xs font-bold flex-shrink-0 shadow-sm shadow-accent/20">
              {initial}
            </div>
          )}
          <div className="flex-1 min-w-0 text-left">
            <p className="text-[13px] font-medium text-text-primary truncate">{displayName}</p>
            <p className="text-[11px] text-text-muted">{planLabel}</p>
          </div>
        </button>
      )}

      {isAuthenticated && <div className="h-px bg-border/50 my-1 mx-2" />}

      {/* 快速设置：界面语言 / 界面主题（hover 显示二级菜单） */}
      <QuickSettingsMenu language={language as Language} onClose={onClose} />

      <div className="h-px bg-border/50 my-1 mx-2" />

      {isAuthenticated && (
        <>
          <button
            onClick={() => { onUserInfoClick(); onClose() }}
            className="w-full h-8 flex items-center gap-2.5 px-3 text-text-primary hover:bg-text-primary/[0.06] transition-colors text-[13px]"
          >
            <UserCircle className="w-[16px] h-[16px]" strokeWidth={1.5} />
            <span>{t('layout.account', language as Language)}</span>
          </button>
          <button
            onClick={() => { onBillingCenterClick(); onClose() }}
            className="w-full h-8 flex items-center gap-2.5 px-3 text-text-primary hover:bg-text-primary/[0.06] transition-colors text-[13px]"
          >
            <Wallet className="w-[16px] h-[16px]" strokeWidth={1.5} />
            <span>{t('layout.billing', language as Language)}</span>
          </button>
          <button
            onClick={() => { onSessionHistoryClick(); onClose() }}
            className="w-full h-8 flex items-center gap-2.5 px-3 text-text-primary hover:bg-text-primary/[0.06] transition-colors text-[13px]"
          >
            <History className="w-[16px] h-[16px]" strokeWidth={1.5} />
            <span>{t('layout.sessionhistory', language as Language)}</span>
          </button>
        </>
      )}

      {isAuthenticated && <div className="h-px bg-border/50 my-1 mx-2" />}

      {featureItems.map((item) => (
        <button
          key={item.label}
          onClick={() => { item.onClick(); onClose() }}
          className="w-full h-8 flex items-center gap-2.5 px-3 text-text-primary hover:bg-text-primary/[0.06] transition-colors text-[13px]"
        >
          <item.icon className="w-[16px] h-[16px]" strokeWidth={1.5} />
          <span>{item.label}</span>
        </button>
      ))}

      <div className="h-px bg-border/50 my-1 mx-2" />

      {systemItems.map((item) => (
        <button
          key={item.label}
          onClick={() => { item.onClick(); onClose() }}
          className="w-full h-8 flex items-center gap-2.5 px-3 text-text-primary hover:bg-text-primary/[0.06] transition-colors text-[13px]"
        >
          <item.icon className="w-[16px] h-[16px]" strokeWidth={1.5} />
          <span>{item.label}</span>
          {item.hasBadge && (
            <span className="ml-auto w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          )}
        </button>
      ))}

      {isAuthenticated && (
        <>
          <div className="h-px bg-border/50 my-1 mx-2" />
          {showLogoutConfirm ? (
            <div className="px-3 py-2 space-y-2">
              <p className="text-[12px] text-text-secondary">{t('layout.areyousureyouwant', language as Language)}</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowLogoutConfirm(false)}
                  className="flex-1 h-7 rounded-md text-[12px] font-medium border border-border/50 text-text-secondary hover:bg-surface-hover transition-colors"
                >
                  {t('layout.cancel', language as Language)}
                </button>
                <button
                  onClick={() => { onLogout(); onClose() }}
                  className="flex-1 h-7 rounded-md text-[12px] font-medium bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors"
                >
                  {t('layout.signout', language as Language)}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowLogoutConfirm(true)}
              className="w-full h-8 flex items-center gap-2.5 px-3 text-red-500 hover:bg-red-500/5 transition-colors text-[13px]"
            >
              <LogOut className="w-[16px] h-[16px]" strokeWidth={1.5} />
              <span>{t('layout.signout2', language as Language)}</span>
            </button>
          )}
        </>
      )}
    </div>,
    document.body
  )
}

function ThreadListItem({
  thread,
  isActive,
  language,
  onSelect,
  onDelete,
  onRename,
}: {
  thread: ChatThread
  isActive: boolean
  language: Language
  onSelect: () => void
  onDelete: () => void
  onRename: (threadId: string) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuBtnRef = useRef<HTMLButtonElement>(null)
  const [menuPos, setMenuPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 })

  const title = useMemo(() => {
    if (thread.title?.trim()) return thread.title.trim()
    const firstUserMsg = thread.messages.find(m => m.role === 'user')
    if (firstUserMsg) return getMessageText(firstUserMsg.content).slice(0, 42)
    return getThreadDisplayTitle(thread)
  }, [thread])

  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  useEffect(() => {
    if (menuOpen && menuBtnRef.current) {
      const rect = menuBtnRef.current.getBoundingClientRect()
      setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
    }
  }, [menuOpen])

  return (
    <div
      className={`group relative flex items-center gap-2 px-2 py-2 rounded-lg cursor-pointer hover:bg-text-primary/[0.06] transition-all ${
        isActive
          ? 'bg-accent/8 text-accent'
          : 'aweeclaw-thread-item hover:bg-surface-hover/50'
      } ${menuOpen ? 'z-30 bg-surface-hover/50' : 'z-0'}`}
      onClick={onSelect}
    >
      <MessageSquare className="w-3.5 h-3.5 shrink-0 opacity-50" strokeWidth={1.5} />
      <div className="flex-1 min-w-0 group-hover:pr-5 transition-all">
        <div className="text-[13px] font-medium truncate leading-snug" title={title}>{title}</div>
      </div>
      <div className="absolute right-1.5 top-1/2 -translate-y-1/2 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" ref={menuRef}>
        <button
          ref={menuBtnRef}
          onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen) }}
          className="p-0.5 rounded hover:opacity-100 transition-all"
        >
          <MoreHorizontal className="w-3.5 h-3.5" />
        </button>
      </div>
      {menuOpen && createPortal(
        <div
          ref={menuRef}
          className="fixed py-1 rounded-lg bg-surface/95 backdrop-blur-xl border border-border/50 shadow-lg shadow-black/15 z-[9999] min-w-[120px]"
          style={{ top: menuPos.top, right: menuPos.right }}
        >
          <button
            onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onRename(thread.id) }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-text-primary hover:bg-text-primary/[0.06] transition-colors"
          >
            <Edit2 className="w-3 h-3" strokeWidth={1.5} />
            {t('layout.rename', language as Language)}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onDelete() }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-text-primary hover:text-red-500 hover:bg-red-500/5 transition-colors"
          >
            <Trash2 className="w-3 h-3" strokeWidth={1.5} />
            {t('layout.delete', language as Language)}
          </button>
        </div>,
        document.body
      )}
    </div>
  )
}

export default function NavigationRail() {
  const {
    activeSidePanel,
    setActiveSidePanel,
    language,
    setShowSettingsPage,
    setShowWorkflow,
    activeScenarioId,
    navRailExpanded,
    showSettingsPage,
    showUserProfilePage,
    isAuthenticated,
    cloudUser,
    setShowAbout,
    setShowWelcomePage,
    setShowUserProfilePage,
    setShowBillingCenterPage,
    setShowSessionHistoryPage,
    setShowPluginCenterPage,
    setShowScenarioPage,
    closeAllFullPages,
    logout,
  } = useStore(useShallow(s => ({
    activeSidePanel: s.activeSidePanel,
    setActiveSidePanel: s.setActiveSidePanel,
    language: s.language,
    setShowSettingsPage: s.setShowSettingsPage,
    setShowWorkflow: s.setShowWorkflow,
    activeScenarioId: s.activeScenarioId,
    navRailExpanded: s.navRailExpanded,
    showSettingsPage: s.showSettingsPage,
    showUserProfilePage: s.showUserProfilePage,
    isAuthenticated: s.isAuthenticated,
    cloudUser: s.cloudUser,
    setShowAbout: s.setShowAbout,
    setShowWelcomePage: s.setShowWelcomePage,
    setShowUserProfilePage: s.setShowUserProfilePage,
    setShowBillingCenterPage: s.setShowBillingCenterPage,
    setShowSessionHistoryPage: s.setShowSessionHistoryPage,
    setShowPluginCenterPage: s.setShowPluginCenterPage,
    setShowScenarioPage: s.setShowScenarioPage,
    closeAllFullPages: s.closeAllFullPages,
    logout: s.logout,
  })))

  const currentThreadId = useAgentStore(state => state.currentThreadId)
  const allThreads = useAllThreads()
  const { switchThread, deleteThread, createThread, renameThread } = useAgentActions()

  const [showUserMenu, setShowUserMenu] = useState(false)
  const [showLoginModal, setShowLoginModal] = useState(false)
  const [showUpdateModal, setShowUpdateModal] = useState(false)
  const userAreaRef = useRef<HTMLDivElement>(null)
  const [renamingThreadId, setRenamingThreadId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)

  // 订阅更新状态变化，自动检测版本更新并显示徽章提示
  useEffect(() => {
    const unsubscribe = updaterService.subscribe(setUpdateStatus)
    void updaterService.getStatus().then(setUpdateStatus)
    return () => unsubscribe()
  }, [])

  const hasUpdateAvailable = updateStatus?.status === 'available' || updateStatus?.status === 'downloaded'

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
  const { sidebarItems: pluginSidebarItems } = usePluginExtensions()
  const sidebarItems = [...scenarioSidebarItems, ...pluginSidebarItems]

  const p = BRAND.cssPrefix

  const handleMenuItemClick = (itemId: string, isActive: boolean) => {
    setActiveSidePanel(isActive ? null : (itemId as SidePanel))
    closeAllFullPages()
  }

  const handleBrandClick = useCallback(() => {
    setActiveSidePanel(null)
    setShowWelcomePage(true)
    setShowWorkflow(false)
  }, [setActiveSidePanel, setShowWelcomePage, setShowWorkflow])

  const handleSettingsClick = useCallback(() => {
    setActiveSidePanel(null)
    setShowSettingsPage(true)
    setShowWorkflow(false)
  }, [setActiveSidePanel, setShowSettingsPage, setShowWorkflow])

  const handleExploreClick = useCallback(() => {
    setActiveSidePanel(null)
    setShowScenarioPage(true)
    setShowWorkflow(false)
  }, [setActiveSidePanel, setShowScenarioPage, setShowWorkflow])

  const handleWorkflowClick = useCallback(() => {
    setActiveSidePanel(null)
    closeAllFullPages()
    setShowWorkflow(true)
  }, [setActiveSidePanel, closeAllFullPages, setShowWorkflow])

  const handleScheduleClick = useCallback(() => {
    closeAllFullPages()
    setShowWorkflow(false)
    setActiveSidePanel(activeSidePanel === 'schedule' ? null : 'schedule')
  }, [activeSidePanel, setActiveSidePanel, closeAllFullPages, setShowWorkflow])

  const handleSceneToolsClick = useCallback(() => {
    closeAllFullPages()
    setShowWorkflow(false)
    setActiveSidePanel(activeSidePanel === 'scene-tools' ? null : 'scene-tools')
  }, [activeSidePanel, setActiveSidePanel, closeAllFullPages, setShowWorkflow])

  const handlePluginCenterClick = useCallback(() => {
    setActiveSidePanel(null)
    setShowPluginCenterPage(true)
    setShowWorkflow(false)
  }, [setActiveSidePanel, setShowPluginCenterPage, setShowWorkflow])

  const handleUserInfoClick = useCallback(() => {
    setActiveSidePanel(null)
    setShowUserProfilePage(true)
    setShowWorkflow(false)
  }, [setActiveSidePanel, setShowUserProfilePage, setShowWorkflow])

  const handleBillingCenterClick = useCallback(() => {
    setActiveSidePanel(null)
    setShowBillingCenterPage(true)
    setShowWorkflow(false)
  }, [setActiveSidePanel, setShowBillingCenterPage, setShowWorkflow])

  const handleSessionHistoryClick = useCallback(() => {
    setActiveSidePanel(null)
    setShowSessionHistoryPage(true)
    setShowWorkflow(false)
  }, [setActiveSidePanel, setShowSessionHistoryPage, setShowWorkflow])

  const handleLogout = useCallback(() => {
    logout()
    setShowUserMenu(false)
  }, [logout])

  const handleCheckUpdate = useCallback(() => {
    setShowUpdateModal(true)
  }, [])

  const handleAbout = useCallback(() => {
    setShowAbout(true)
  }, [setShowAbout])

  const handleNewThread = useCallback(() => {
    createThread()
  }, [createThread])

  const handleRenameThread = useCallback((threadId: string) => {
    const thread = useAgentStore.getState().threads[threadId]
    if (thread) {
      setRenamingThreadId(threadId)
      setRenameValue(getThreadDisplayTitle(thread))
    }
  }, [])

  const handleRenameSubmit = useCallback(() => {
    if (renamingThreadId && renameValue.trim()) {
      renameThread(renamingThreadId, renameValue.trim())
    }
    setRenamingThreadId(null)
  }, [renamingThreadId, renameValue, renameThread])

  const userInitial = cloudUser?.username?.[0]?.toUpperCase() || cloudUser?.email?.[0]?.toUpperCase() || '?'
  const userDisplayName = formatUserDisplayName(cloudUser?.username || cloudUser?.email || cloudUser?.phone || '')
  const showUserInfo = isAuthenticated && !!cloudUser

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

      {navRailExpanded ? (
        <div className={`${p}-nav-rail-brand`} onClick={handleBrandClick}>
          <div className={`${p}-nav-rail-brand-icon`}>
            <Logo className="w-full h-full" />
          </div>
          <span className={`${p}-nav-rail-brand-name`}>{BRAND.name}</span>
        </div>
      ) : (
        <div className={`${p}-nav-rail-brand`} onClick={handleBrandClick}>
          <div className={`${p}-nav-rail-brand-icon`}>
            <Logo className="w-full h-full" />
          </div>
        </div>
      )}

      <div className="flex-shrink-0 w-full flex flex-col gap-0.5">
        {sidebarItems.map((item) => {
          const IconComponent = getLucideIcon(item.icon)
          const label = language === 'zh' ? item.labelZh : item.label
          const isActive = !showSettingsPage && !showUserProfilePage && activeSidePanel === item.id
          return navRailExpanded ? (
            <button
              key={item.id}
              onClick={() => handleMenuItemClick(item.id, isActive)}
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
            </button>
          ) : (
            <HintOverlay key={item.id} content={label} side="right" delay={400}>
              <button
                onClick={() => handleMenuItemClick(item.id, isActive)}
                className={`${p}-nav-rail-item hover:bg-text-primary/[0.06]`}
                data-active={isActive}
              >
                <NavPill active={isActive} />
                <IconComponent
                  className={`w-[18px] h-[18px] transition-all duration-200 ${isActive ? 'scale-105' : 'opacity-60'}`}
                  strokeWidth={isActive ? 2 : 1.5}
                />
              </button>
            </HintOverlay>
          )
        })}
      </div>

      {/* 场景工具入口：随场景模式提供内置工具面板（暂时隐藏） */}
      {false && (() => {
        const isSceneToolsActive = activeSidePanel === 'scene-tools'
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

      <div className={`${p}-nav-rail-divider`} style={{ marginTop: 20, marginBottom: 20 }} />

      {navRailExpanded ? (
        <div className="flex-1 flex flex-col min-h-0 w-full">
          <div className={`${p}-nav-rail-history-header`}>
            <span className={`${p}-nav-rail-history-title`}>
              {t('layout.chathistory', language as Language)}
            </span>
            <button
              className={`${p}-nav-rail-history-new-btn`}
              onClick={handleNewThread}
              title={t('layout.newchat', language as Language)}
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto no-scrollbar">
            {allThreads.length === 0 ? (
              <div className="px-2 py-4 text-[11px] text-text-muted opacity-40 text-center">
                {t('layout.nochatsyet', language as Language)}
              </div>
            ) : (
              <div className="flex flex-col gap-0.5">
                {allThreads.slice(0, 34).map(thread => (
                  renamingThreadId === thread.id ? (
                    <div key={thread.id} className="flex items-center gap-1 px-2 py-1.5">
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') handleRenameSubmit()
                          if (e.key === 'Escape') setRenamingThreadId(null)
                        }}
                        onBlur={handleRenameSubmit}
                        className="flex-1 min-w-0 bg-surface text-[12px] px-1.5 py-0.5 rounded border border-accent/40 focus:outline-none text-text-primary"
                        onClick={e => e.stopPropagation()}
                      />
                    </div>
                  ) : (
                    <ThreadListItem
                      key={thread.id}
                      thread={thread}
                      isActive={currentThreadId === thread.id}
                      language={language}
                      onSelect={() => switchThread(thread.id)}
                      onDelete={() => deleteThread(thread.id)}
                      onRename={handleRenameThread}
                    />
                  )
                ))}
                {allThreads.length > 34 && (
                  <button
                    onClick={() => setShowSessionHistoryPage(true)}
                    className="mt-1 px-2 py-2 text-[11px] text-text-muted hover:text-accent hover:bg-accent/8 rounded-md transition-colors flex items-center justify-center gap-1.5 border border-border/30 border-dashed"
                  >
                    <span>{language === 'zh' ? `查看更多（共 ${allThreads.length} 条）` : `View more (${allThreads.length} total)`}</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center min-h-0">
          <HintOverlay content={t('layout.newchat2', language as Language)} side="right" delay={400}>
            <button
              onClick={handleNewThread}
              className="w-[38px] h-[38px] rounded-lg flex items-center justify-center text-text-muted hover:text-accent hover:bg-accent/8 transition-all"
            >
              <Plus className="w-[18px] h-[18px] opacity-60" strokeWidth={1.5} />
            </button>
          </HintOverlay>
          {allThreads.length > 0 && (
            <div className="flex-1 overflow-y-auto no-scrollbar w-full flex flex-col items-center gap-1 py-1">
              {allThreads.slice(0, 5).map(thread => (
                <HintOverlay
                  key={thread.id}
                  content={getThreadDisplayTitle(thread)}
                  side="right"
                  delay={400}
                >
                  <button
                    onClick={() => switchThread(thread.id)}
                    className={`w-[30px] h-[30px] rounded-md flex items-center justify-center transition-all ${
                      currentThreadId === thread.id
                        ? 'bg-accent/10 text-accent'
                        : 'text-text-muted hover:text-text-primary hover:bg-surface-hover/50'
                    }`}
                  >
                    <MessageSquare className="w-3.5 h-3.5 opacity-50" strokeWidth={1.5} />
                  </button>
                </HintOverlay>
              ))}
            </div>
          )}
        </div>
      )}

      <div className={`${p}-nav-rail-divider`} />

      <div className={`${p}-nav-rail-user`} ref={userAreaRef}>
        <UserMenuDropdown
          isOpen={showUserMenu}
          onClose={() => setShowUserMenu(false)}
          language={language}
          onSettingsClick={handleSettingsClick}
          onExploreClick={handleExploreClick}
          onWorkflowClick={handleWorkflowClick}
          onScheduleClick={handleScheduleClick}
          onPluginCenterClick={handlePluginCenterClick}
          onUserInfoClick={handleUserInfoClick}
          onBillingCenterClick={handleBillingCenterClick}
          onSessionHistoryClick={handleSessionHistoryClick}
          onCheckUpdate={handleCheckUpdate}
          onAbout={handleAbout}
          onLogout={handleLogout}
          isAuthenticated={showUserInfo}
          cloudUser={cloudUser}
          anchorRef={userAreaRef}
          hasUpdateAvailable={hasUpdateAvailable}
        />

        {showUserInfo ? (
          navRailExpanded ? (
            <button
              className={`${p}-nav-rail-user-btn`}
              onClick={() => setShowUserMenu(!showUserMenu)}
            >
              <div className="relative flex-shrink-0">
                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-accent/80 to-accent/40 flex items-center justify-center text-white text-[10px] font-bold shadow-sm shadow-accent/20">
                  {userInitial}
                </div>
                {hasUpdateAvailable && (
                  <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-red-500 ring-2 ring-bg-secondary animate-pulse" />
                )}
              </div>
              <span className={`${p}-nav-rail-user-name`}>{userDisplayName}</span>
              <ChevronUp className={`w-3.5 h-3.5 ${p}-nav-rail-user-chevron`} />
            </button>
          ) : (
            <HintOverlay content={userDisplayName} side="right" delay={400}>
              <button
                className={`${p}-nav-rail-user-btn`}
                onClick={() => setShowUserMenu(!showUserMenu)}
              >
                <div className="relative flex-shrink-0">
                  <div className="w-6 h-6 rounded-full bg-gradient-to-br from-accent/80 to-accent/40 flex items-center justify-center text-white text-[10px] font-bold shadow-sm shadow-accent/20">
                    {userInitial}
                  </div>
                  {hasUpdateAvailable && (
                    <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-red-500 ring-2 ring-bg-secondary animate-pulse" />
                  )}
                </div>
              </button>
            </HintOverlay>
          )
        ) : (
          navRailExpanded ? (
            <button className={`${p}-nav-rail-login-btn`} onClick={() => setShowLoginModal(true)}>
              <div className="relative">
                <LogIn className="w-3.5 h-3.5" />
                {hasUpdateAvailable && (
                  <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-red-500 ring-2 ring-bg-secondary animate-pulse" />
                )}
              </div>
              <span>{t('layout.signin', language as Language)}</span>
            </button>
          ) : (
            <HintOverlay content={t('layout.signin2', language as Language)} side="right" delay={400}>
              <button className={`${p}-nav-rail-login-btn`} onClick={() => setShowLoginModal(true)}>
                <div className="relative">
                  <LogIn className="w-3.5 h-3.5" />
                  {hasUpdateAvailable && (
                    <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-red-500 ring-2 ring-bg-secondary animate-pulse" />
                  )}
                </div>
              </button>
            </HintOverlay>
          )
        )}
      </div>

      <UserAccountPopover language={language} forceLoginOpen={showLoginModal} onLoginClose={() => setShowLoginModal(false)} hideButton />
      <UpdateModal isOpen={showUpdateModal} onClose={() => setShowUpdateModal(false)} />
    </div>
  )
}
