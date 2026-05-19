import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Settings, Workflow, Compass, LogIn, ChevronUp, CloudSync, Info, MessageSquare, Plus, MoreHorizontal, Edit2, Trash2, LogOut, UserCircle, Wallet } from 'lucide-react'
import { HintOverlay } from '../ui/HintOverlay'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { scenarioRegistry } from '@shared/configuration/scenarios'
import { getLucideIcon } from '../foundation/IconMap'
import { UserAccountPopover } from './UserAccountPopover'
import { UpdateModal } from './UpdateModal'
import { useAgentStore } from '@intelligence/state/IntelligenceStore'
import { useAgentActions, useAllThreads } from '@hooks/useAgent'
import { getThreadDisplayTitle, getMessageText } from '@intelligence/providerTypes'
import type { ChatThread } from '@intelligence/providerTypes'
import type { SidebarItemDescriptor } from '@shared/protocols/scenario'
import type { SidePanel } from '@store/slices'
import { BRAND } from '@shared/brand'

const isMac = typeof navigator !== 'undefined' && (
  navigator.platform.toUpperCase().indexOf('MAC') >= 0 ||
  ((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform?.toUpperCase().indexOf('MAC') ?? -1) >= 0
)

const DEFAULT_ITEMS: SidebarItemDescriptor[] = [
  { id: 'explorer', icon: 'Files', label: 'Workspace', labelZh: '工作区', component: 'ExplorerView', position: 0 },
  { id: 'knowledge', icon: 'BookOpen', label: 'Knowledge', labelZh: '知识库', component: 'KnowledgeView', position: 1 },
  { id: 'history', icon: 'History', label: 'History', labelZh: '历史', component: 'HistoryView', position: 2 },
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
  onWorkflowClick,
  onUserInfoClick,
  onBillingCenterClick,
  onCheckUpdate,
  onAbout,
  onLogout,
  isAuthenticated,
  cloudUser,
  anchorRef,
}: {
  isOpen: boolean
  onClose: () => void
  language: string
  onSettingsClick: () => void
  onExploreClick: () => void
  onWorkflowClick: () => void
  onUserInfoClick: () => void
  onBillingCenterClick: () => void
  onCheckUpdate: () => void
  onAbout: () => void
  onLogout: () => void
  isAuthenticated: boolean
  cloudUser: { username?: string; email: string; avatarUrl?: string; planId: string; phone?: string } | null
  anchorRef: React.RefObject<HTMLDivElement | null>
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
    ? (language === 'zh' ? '企业版' : 'Enterprise')
    : cloudUser?.planId === 'PRO' || cloudUser?.planId === 'PROFESSIONAL'
      ? (language === 'zh' ? '专业版' : 'Pro')
      : language === 'zh' ? '免费版' : 'Free'

  const initial = cloudUser?.username?.[0]?.toUpperCase() || cloudUser?.email?.[0]?.toUpperCase() || '?'
  const displayName = cloudUser?.username || cloudUser?.email || ''

  const featureItems = [
    { icon: Compass, label: language === 'zh' ? '探索' : 'Explore', onClick: onExploreClick },
    { icon: Workflow, label: language === 'zh' ? '工作流' : 'Workflow', onClick: onWorkflowClick },
  ]

  const systemItems = [
    { icon: Settings, label: language === 'zh' ? '设置' : 'Settings', onClick: onSettingsClick },
    { icon: CloudSync, label: language === 'zh' ? '检测更新' : 'Check for Updates', onClick: onCheckUpdate },
    { icon: Info, label: language === 'zh' ? '关于 AweeClaw' : 'About AweeClaw', onClick: onAbout },
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

      {isAuthenticated && (
        <>
          <button
            onClick={() => { onUserInfoClick(); onClose() }}
            className="w-full h-8 flex items-center gap-2.5 px-3 text-text-primary hover:bg-text-primary/[0.06] transition-colors text-[13px]"
          >
            <UserCircle className="w-[16px] h-[16px]" strokeWidth={1.5} />
            <span>{language === 'zh' ? '用户中心' : 'Account'}</span>
          </button>
          <button
            onClick={() => { onBillingCenterClick(); onClose() }}
            className="w-full h-8 flex items-center gap-2.5 px-3 text-text-primary hover:bg-text-primary/[0.06] transition-colors text-[13px]"
          >
            <Wallet className="w-[16px] h-[16px]" strokeWidth={1.5} />
            <span>{language === 'zh' ? '费用中心' : 'Billing'}</span>
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
        </button>
      ))}

      {isAuthenticated && (
        <>
          <div className="h-px bg-border/50 my-1 mx-2" />
          {showLogoutConfirm ? (
            <div className="px-3 py-2 space-y-2">
              <p className="text-[12px] text-text-secondary">{language === 'zh' ? '确定要退出登录吗？' : 'Are you sure you want to sign out?'}</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowLogoutConfirm(false)}
                  className="flex-1 h-7 rounded-md text-[12px] font-medium border border-border/50 text-text-secondary hover:bg-surface-hover transition-colors"
                >
                  {language === 'zh' ? '取消' : 'Cancel'}
                </button>
                <button
                  onClick={() => { onLogout(); onClose() }}
                  className="flex-1 h-7 rounded-md text-[12px] font-medium bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors"
                >
                  {language === 'zh' ? '退出' : 'Sign Out'}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowLogoutConfirm(true)}
              className="w-full h-8 flex items-center gap-2.5 px-3 text-red-500 hover:bg-red-500/5 transition-colors text-[13px]"
            >
              <LogOut className="w-[16px] h-[16px]" strokeWidth={1.5} />
              <span>{language === 'zh' ? '退出登录' : 'Sign Out'}</span>
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
  language: string
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
      className={`group relative flex items-center gap-2 px-2 py-2.5 rounded-lg cursor-pointer hover:bg-text-primary/[0.06] transition-all ${
        isActive
          ? 'bg-accent/8 text-accent'
          : 'aweeclaw-thread-item hover:bg-surface-hover/50'
      } ${menuOpen ? 'z-30 bg-surface-hover/50' : 'z-0'}`}
      onClick={onSelect}
    >
      <MessageSquare className="w-3.5 h-3.5 shrink-0 opacity-50" strokeWidth={1.5} />
      <div className="flex-1 min-w-0 group-hover:pr-5 transition-all">
        <div className="text-[13px] font-medium truncate leading-snug">{title}</div>
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
            {language === 'zh' ? '重命名' : 'Rename'}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onDelete() }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-text-primary hover:text-red-500 hover:bg-red-500/5 transition-colors"
          >
            <Trash2 className="w-3 h-3" strokeWidth={1.5} />
            {language === 'zh' ? '删除' : 'Delete'}
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

  const scenario = scenarioRegistry.get(activeScenarioId)
  const rawSidebarItems = scenario?.ui?.sidebarItems?.length
    ? [...scenario.ui.sidebarItems].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    : DEFAULT_ITEMS
  const sidebarItems = rawSidebarItems.filter(item => {
    if (item.id === 'checkpoint' && activeScenarioId !== 'code-editor') return false
    return true
  })

  const p = BRAND.cssPrefix

  const handleMenuItemClick = (itemId: string, isActive: boolean) => {
    setActiveSidePanel(isActive ? null : (itemId as SidePanel))
    setShowSettingsPage(false)
    setShowWelcomePage(false)
  }

  const handleBrandClick = useCallback(() => {
    setActiveSidePanel(null)
    setShowSettingsPage(false)
    setShowWelcomePage(true)
  }, [setActiveSidePanel, setShowSettingsPage, setShowWelcomePage])

  const handleSettingsClick = useCallback(() => {
    setActiveSidePanel(null)
    setShowSettingsPage(true)
    setShowWelcomePage(false)
    setShowUserProfilePage(false)
    setShowBillingCenterPage(false)
  }, [setActiveSidePanel, setShowSettingsPage, setShowWelcomePage, setShowUserProfilePage, setShowBillingCenterPage])

  const handleExploreClick = useCallback(() => {
    setActiveSidePanel(activeSidePanel === 'scenarios' ? null : 'scenarios')
    setShowSettingsPage(false)
    setShowUserProfilePage(false)
    setShowBillingCenterPage(false)
  }, [activeSidePanel, setActiveSidePanel, setShowSettingsPage, setShowUserProfilePage, setShowBillingCenterPage])

  const handleWorkflowClick = useCallback(() => {
    setShowWorkflow(true)
    setShowUserProfilePage(false)
    setShowBillingCenterPage(false)
  }, [setShowWorkflow, setShowUserProfilePage, setShowBillingCenterPage])

  const handleUserInfoClick = useCallback(() => {
    setActiveSidePanel(null)
    setShowSettingsPage(false)
    setShowWelcomePage(false)
    setShowUserProfilePage(true)
    setShowBillingCenterPage(false)
  }, [setActiveSidePanel, setShowSettingsPage, setShowWelcomePage, setShowUserProfilePage, setShowBillingCenterPage])

  const handleBillingCenterClick = useCallback(() => {
    setActiveSidePanel(null)
    setShowSettingsPage(false)
    setShowWelcomePage(false)
    setShowUserProfilePage(false)
    setShowBillingCenterPage(true)
  }, [setActiveSidePanel, setShowSettingsPage, setShowWelcomePage, setShowUserProfilePage, setShowBillingCenterPage])

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
  const userDisplayName = cloudUser?.username || cloudUser?.email || ''

  return (
    <div className={`${p}-nav-rail`} data-expanded={navRailExpanded} data-mac={isMac}>
      <style>{`
        .${p}-nav-rail {
          height: 100%;
          width: 200px;
          background: rgb(var(--background-secondary));
          border-right: 1px solid rgba(var(--border), 0.2);
          display: flex;
          flex-direction: column;
          z-index: 30;
          user-select: none;
          padding: 8px 8px 8px 8px;
          transition: width 200ms cubic-bezier(0.4, 0, 0.2, 1), padding 200ms cubic-bezier(0.4, 0, 0.2, 1);
          overflow: hidden;
          flex-shrink: 0;
        }
        .${p}-nav-rail[data-expanded="false"] {
          width: 48px;
          padding: 8px 4px 8px 4px;
          align-items: center;
        }
        .${p}-nav-rail[data-mac="true"] {
          padding-top: 36px;
        }
        .${p}-nav-rail[data-mac="true"][data-expanded="false"] {
          padding-top: 36px;
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
          width: 28px;
          height: 28px;
          border-radius: 8px;
          background: linear-gradient(135deg, rgb(var(--accent)), rgb(var(--accent)) 60%, rgba(var(--accent-rgb), 0.6));
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-size: 14px;
          font-weight: 800;
          flex-shrink: 0;
          box-shadow: 0 2px 8px rgba(var(--accent-rgb), 0.3);
        }
        .${p}-nav-rail-brand-name {
          font-size: 16px;
          font-weight: 700;
          color: rgb(var(--text-primary));
          letter-spacing: -0.02em;
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
          <div className={`${p}-nav-rail-brand-icon`}>A</div>
          <span className={`${p}-nav-rail-brand-name`}>{BRAND.name}</span>
        </div>
      ) : (
        <div className={`${p}-nav-rail-brand`} onClick={handleBrandClick}>
          <div className={`${p}-nav-rail-brand-icon`}>A</div>
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

      <div className={`${p}-nav-rail-divider`} style={{ marginTop: 20, marginBottom: 20 }} />

      {navRailExpanded ? (
        <div className="flex-1 flex flex-col min-h-0 w-full">
          <div className={`${p}-nav-rail-history-header`}>
            <span className={`${p}-nav-rail-history-title`}>
              {language === 'zh' ? '历史会话' : 'Chat History'}
            </span>
            <button
              className={`${p}-nav-rail-history-new-btn`}
              onClick={handleNewThread}
              title={language === 'zh' ? '新对话' : 'New Chat'}
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto no-scrollbar">
            {allThreads.length === 0 ? (
              <div className="px-2 py-4 text-[11px] text-text-muted opacity-40 text-center">
                {language === 'zh' ? '暂无会话' : 'No chats yet'}
              </div>
            ) : (
              <div className="flex flex-col gap-0.5">
                {allThreads.map(thread => (
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
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center min-h-0">
          <HintOverlay content={language === 'zh' ? '新对话' : 'New Chat'} side="right" delay={400}>
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
          onUserInfoClick={handleUserInfoClick}
          onBillingCenterClick={handleBillingCenterClick}
          onCheckUpdate={handleCheckUpdate}
          onAbout={handleAbout}
          onLogout={handleLogout}
          isAuthenticated={isAuthenticated}
          cloudUser={cloudUser}
          anchorRef={userAreaRef}
        />

        {isAuthenticated ? (
          navRailExpanded ? (
            <button
              className={`${p}-nav-rail-user-btn`}
              onClick={() => setShowUserMenu(!showUserMenu)}
            >
              <div className="w-6 h-6 rounded-full bg-gradient-to-br from-accent/80 to-accent/40 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0 shadow-sm shadow-accent/20">
                {userInitial}
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
                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-accent/80 to-accent/40 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0 shadow-sm shadow-accent/20">
                  {userInitial}
                </div>
              </button>
            </HintOverlay>
          )
        ) : (
          navRailExpanded ? (
            <button className={`${p}-nav-rail-login-btn`} onClick={() => setShowLoginModal(true)}>
              <LogIn className="w-3.5 h-3.5" />
              <span>{language === 'zh' ? '登录' : 'Sign In'}</span>
            </button>
          ) : (
            <HintOverlay content={language === 'zh' ? '登录' : 'Sign In'} side="right" delay={400}>
              <button className={`${p}-nav-rail-login-btn`} onClick={() => setShowLoginModal(true)}>
                <LogIn className="w-3.5 h-3.5" />
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
