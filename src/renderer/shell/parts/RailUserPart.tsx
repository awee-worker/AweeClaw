/**
 * 导航栏账号区部件（rail-user）
 *
 * 从 NavigationRail 里拆出：登录按钮 / 头像 + 用户菜单 + 登录弹窗 + 更新弹窗。
 *
 * 菜单里的每一项都先收起侧边栏与全屏页、再打开目标页面 —— 否则侧边栏会压在
 * 刚打开的全屏页上，用户看到的是两套界面叠在一起。这段收尾动作统一写在
 * openExclusive 里，避免十几个入口各写一遍、漏一个就出现叠层。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Activity,
  BookUser,
  ChevronUp,
  Clock,
  CloudSync,
  Compass,
  GraduationCap,
  History,
  Info,
  LogIn,
  LogOut,
  Puzzle,
  Settings,
  UserCircle,
  Wallet,
} from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '@store'
import {
  closePanelDrawer,
  getPluginDrawerTarget,
  openBuiltinPanel,
} from '@renderer/plugins/pluginDrawerStore'
import { closeSceneToolDrawer } from '@components/scene-tools/sceneToolDrawerStore'
import { BRAND } from '@shared/brand'
import { formatUserDisplayName } from '@shared/toolkit/formatHelper'
import { t, type Language } from '@renderer/i18n'
import { updaterService, type UpdateStatus } from '@services/updateAdapter'
import { useUserNotificationStore, SCENARIO_NOTIFICATION_TYPES, PLUGIN_NOTIFICATION_TYPES, SUBSCRIPTION_NOTIFICATION_TYPES } from '@store/userNotificationStore'
import { HintOverlay } from '@components/ui/HintOverlay'
import { UserAccountPopover } from '@components/layout/UserAccountPopover'
import { UpdateModal } from '@components/layout/UpdateModal'
import { QuickSettingsMenu } from '@components/layout/QuickSettingsMenu'
import type { HostPartComponentProps } from '../HostPartRegistry'

/**
 * 菜单项未读角标
 *
 * 用于「工作场景」「插件与技能」「费用中心」等入口：这些页面内部虽然有
 * 到期提醒横幅，但用户不主动点进去就看不到，角标是唯一能提前暴露风险的信号。
 */
function MenuBadge({ count, title }: { count: number; title?: string }) {
  if (count <= 0) return null
  return (
    <span
      title={title}
      className="ml-auto min-w-[16px] h-[16px] px-1 flex items-center justify-center text-[10px] font-semibold bg-accent text-white rounded-full"
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}

interface UserMenuHandlers {
  onSettingsClick: () => void
  onAppearanceSettingsClick: () => void
  onExploreClick: () => void
  onScheduleClick: () => void
  onLedgerClick: () => void
  onPluginCenterClick: () => void
  onExpertLibraryClick: () => void
  onUserInfoClick: () => void
  onBillingCenterClick: () => void
  onSessionHistoryClick: () => void
  onContactsClick: () => void
  onCheckUpdate: () => void
  onAbout: () => void
  onLogout: () => void
}

function UserMenuDropdown({
  isOpen,
  onClose,
  language,
  handlers,
  isAuthenticated,
  cloudUser,
  anchorRef,
  hasUpdateAvailable,
  placement = 'rail',
}: {
  isOpen: boolean
  onClose: () => void
  language: Language
  handlers: UserMenuHandlers
  isAuthenticated: boolean
  cloudUser: { username?: string; email: string; avatarUrl?: string; planId: string; phone?: string } | null
  anchorRef: React.RefObject<HTMLDivElement | null>
  hasUpdateAvailable: boolean
  /** rail：贴在导航栏底部，菜单向上展开；titlebar：贴在顶部，菜单向右下展开 */
  placement?: RailUserPlacement
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({})

  useEffect(() => {
    if (!isOpen) { setShowLogoutConfirm(false); return }
    const handler = (e: MouseEvent) => {
      const target = e.target as Element | null
      // 二级菜单面板是 portal，挂在 body 上（容器带 backdrop-blur，留在里面 fixed
      // 定位会跑偏），DOM 上并不在 ref.current 之内。不排除它的话，点选项时
      // mousedown 会先把整个用户菜单卸掉，随后的 click 落空，表现为
      // 「菜单消失了，但界面语言 / 界面主题没切换」。
      if (target?.closest?.('[data-user-menu-portal]')) return
      if (ref.current && !ref.current.contains(target as Node)) {
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

    // 顶部账号区在窗口右上角，向上展开会顶出可视区，因此改成向下、
    // 且以右边缘对齐 —— 菜单宽度固定，左对齐会溢出到窗口外。
    if (placement === 'titlebar') {
      setMenuStyle({
        position: 'fixed',
        top: rect.bottom + 6,
        right: Math.max(8, window.innerWidth - rect.right),
        width: 200,
      })
      return
    }

    setMenuStyle({
      position: 'fixed',
      left: rect.left,
      bottom: window.innerHeight - rect.top + 4,
      width: 200,
    })
  }, [isOpen, anchorRef, placement])

  // 入口角标：按通知类型区分归属，避免把「插件到期」误标到场景入口上。
  // 必须放在提前 return 之前 —— 否则菜单开关时会触发 hooks 数量不一致的运行时错误。
  const scenarioBadge = useUserNotificationStore(
    s => s.items.filter(i => !i.isRead && SCENARIO_NOTIFICATION_TYPES.includes(i.type)).length,
  )
  const pluginBadge = useUserNotificationStore(
    s => s.items.filter(i => !i.isRead && PLUGIN_NOTIFICATION_TYPES.includes(i.type)).length,
  )
  const billingBadge = useUserNotificationStore(
    s => s.items.filter(i => !i.isRead && SUBSCRIPTION_NOTIFICATION_TYPES.includes(i.type)).length,
  )

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

  const badgeHint = (zh: string, en: string) => (language === 'zh' ? zh : en)

  const featureItems = [
    {
      icon: Compass,
      label: t('layout.workscenes', language as Language),
      onClick: handlers.onExploreClick,
      badge: scenarioBadge,
      badgeTitle: badgeHint('有场景即将到期或已到期', 'Paid scenarios expiring or expired'),
    },
    {
      icon: Puzzle,
      label: t('layout.pluginsandskills', language as Language),
      onClick: handlers.onPluginCenterClick,
      badge: pluginBadge,
      badgeTitle: badgeHint('有插件即将到期或已到期', 'Paid plugins expiring or expired'),
    },
    {
      icon: GraduationCap,
      label: language === 'zh' ? '专家库' : 'Expert Library',
      onClick: handlers.onExpertLibraryClick,
      badge: 0,
      badgeTitle: '',
    },
    {
      icon: Clock,
      label: t('layout.schedule', language as Language),
      onClick: handlers.onScheduleClick,
      badge: 0,
      badgeTitle: '',
    },
    {
      icon: Activity,
      label: language === 'zh' ? '任务中心' : 'Task Center',
      onClick: handlers.onLedgerClick,
      badge: 0,
      badgeTitle: '',
    },
    // 工作流菜单暂时隐藏，后续版本恢复
  ]

  const systemItems = [
    { icon: Settings, label: t('layout.settings', language as Language), onClick: handlers.onSettingsClick, hasBadge: false },
    { icon: CloudSync, label: t('layout.checkforupdates', language as Language), onClick: handlers.onCheckUpdate, hasBadge: hasUpdateAvailable },
    { icon: Info, label: t('layout.aboutaweeclaw', language as Language), onClick: handlers.onAbout, hasBadge: false },
  ]

  return createPortal(
    <div
      ref={ref}
      style={menuStyle}
      // bg-popover 是固定 96% 的浮层底色，不随壁纸的面板不透明度滑块变化：
      // 用户菜单压在页面之上，跟着变透明会直接透出后面的内容，文字无法阅读。
      className="py-1 rounded-xl bg-popover backdrop-blur-xl border border-border/50 shadow-xl shadow-black/20 z-[9999]"
    >
      {isAuthenticated && (
        <button
          onClick={() => { handlers.onUserInfoClick(); onClose() }}
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

      {/* 快速设置：界面语言 / 界面主题（hover 显示二级菜单）
          titlebar 落位时菜单贴在窗口右上角，二级菜单必须向左展开才不越界 */}
      <QuickSettingsMenu
        language={language as Language}
        onClose={onClose}
        direction={placement === 'titlebar' ? 'left' : 'right'}
        onOpenAppearanceSettings={() => { handlers.onAppearanceSettingsClick(); onClose() }}
      />

      <div className="h-px bg-border/50 my-1 mx-2" />

      {isAuthenticated && (
        <>
          <button
            onClick={() => { handlers.onUserInfoClick(); onClose() }}
            className="w-full h-8 flex items-center gap-2.5 px-3 text-text-primary hover:bg-text-primary/[0.06] transition-colors text-[13px]"
          >
            <UserCircle className="w-[16px] h-[16px]" strokeWidth={1.5} />
            <span>{t('layout.account', language as Language)}</span>
          </button>
          <button
            onClick={() => { handlers.onBillingCenterClick(); onClose() }}
            className="w-full h-8 flex items-center gap-2.5 px-3 text-text-primary hover:bg-text-primary/[0.06] transition-colors text-[13px]"
          >
            <Wallet className="w-[16px] h-[16px]" strokeWidth={1.5} />
            <span>{t('layout.billing', language as Language)}</span>
            <MenuBadge
              count={billingBadge}
              title={
                language === 'zh'
                  ? '套餐即将到期或已到期'
                  : 'Subscription expiring or expired'
              }
            />
          </button>
          <button
            onClick={() => { handlers.onSessionHistoryClick(); onClose() }}
            className="w-full h-8 flex items-center gap-2.5 px-3 text-text-primary hover:bg-text-primary/[0.06] transition-colors text-[13px]"
          >
            <History className="w-[16px] h-[16px]" strokeWidth={1.5} />
            <span>{t('layout.sessionhistory', language as Language)}</span>
          </button>
          <button
            onClick={() => { handlers.onContactsClick(); onClose() }}
            className="w-full h-8 flex items-center gap-2.5 px-3 text-text-primary hover:bg-text-primary/[0.06] transition-colors text-[13px]"
          >
            <BookUser className="w-[16px] h-[16px]" strokeWidth={1.5} />
            <span>{t('layout.contacts', language as Language)}</span>
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
          <MenuBadge count={item.badge} title={item.badgeTitle} />
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
                  onClick={() => { handlers.onLogout(); onClose() }}
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

/**
 * 账号区摆放位置
 *
 * - rail    ：导航栏左下角，展开态带用户名，菜单向上弹
 * - titlebar：顶部最右侧，恒为紧凑头像，菜单向右下弹
 */
export type RailUserPlacement = 'rail' | 'titlebar'

export interface RailUserPartProps extends HostPartComponentProps {
  /** 展开态显示用户名与箭头，收起态只留头像；缺省跟随导航栏展开状态 */
  expanded?: boolean
  /** 摆放位置，缺省为导航栏底部 */
  placement?: RailUserPlacement
}

export function RailUserPart({ expanded, placement = 'rail' }: RailUserPartProps) {
  const {
    language,
    isAuthenticated,
    cloudUser,
    logout,
    setActiveSidePanel,
    closeSidePanelForView,
    setShowSettingsPage,
    setShowScenarioPage,
    setShowPluginCenterPage,
    setSettingsIntent,
    setShowUserProfilePage,
    setShowBillingCenterPage,
    setShowSessionHistoryPage,
    setShowContactsPage,
    setShowWorkflow,
    setShowAbout,
    closeAllFullPages,
    closeInternalBrowser,
    activeSidePanel,
  } = useStore(useShallow((s) => ({
    language: s.language,
    isAuthenticated: s.isAuthenticated,
    cloudUser: s.cloudUser,
    logout: s.logout,
    setActiveSidePanel: s.setActiveSidePanel,
    closeSidePanelForView: s.closeSidePanelForView,
    setShowSettingsPage: s.setShowSettingsPage,
    setShowScenarioPage: s.setShowScenarioPage,
    setShowPluginCenterPage: s.setShowPluginCenterPage,
    setSettingsIntent: s.setSettingsIntent,
    setShowUserProfilePage: s.setShowUserProfilePage,
    setShowBillingCenterPage: s.setShowBillingCenterPage,
    setShowSessionHistoryPage: s.setShowSessionHistoryPage,
    setShowContactsPage: s.setShowContactsPage,
    setShowWorkflow: s.setShowWorkflow,
    setShowAbout: s.setShowAbout,
    closeAllFullPages: s.closeAllFullPages,
    closeInternalBrowser: s.closeInternalBrowser,
    activeSidePanel: s.activeSidePanel,
  })))

  const navRailExpanded = useStore((s) => s.navRailExpanded)

  const [showUserMenu, setShowUserMenu] = useState(false)
  const [showLoginModal, setShowLoginModal] = useState(false)
  const [showUpdateModal, setShowUpdateModal] = useState(false)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)
  const userAreaRef = useRef<HTMLDivElement>(null)

  const isExpanded = expanded ?? navRailExpanded
  const p = BRAND.cssPrefix

  // 订阅更新状态变化，自动检测版本更新并显示徽章提示
  useEffect(() => {
    const unsubscribe = updaterService.subscribe(setUpdateStatus)
    void updaterService.getStatus().then(setUpdateStatus)
    return () => unsubscribe()
  }, [])

  // 登录弹窗由本部件持有，其他面板（如未登录的后端数据面板）通过事件请求打开，
  // 避免各面板重复实现一套登录入口。
  useEffect(() => {
    const handler = () => setShowLoginModal(true)
    window.addEventListener('aweeclaw:open-login', handler)
    return () => window.removeEventListener('aweeclaw:open-login', handler)
  }, [])

  const hasUpdateAvailable = updateStatus?.status === 'available' || updateStatus?.status === 'downloaded'

  /**
   * 打开一个「独占式」全屏页：收起侧边栏与抽屉、退出工作流与内置浏览器
   *
   * 收起走 closeSidePanelForView：这里是把用户带离当前面板的上下文，
   * 顶部开关再按下应当打开工作空间面板，而不是把刚离开的插件市场顶回来。
   * 抽屉（待办 / AI 浏览器等）带遮罩浮在最上层，不关掉会把刚打开的全屏页盖住。
   */
  const openExclusive = useCallback((open: () => void) => {
    closeSidePanelForView()
    closePanelDrawer()
    closeSceneToolDrawer()
    open()
    setShowWorkflow(false)
    closeInternalBrowser()
  }, [closeSidePanelForView, setShowWorkflow, closeInternalBrowser])

  const handlers: UserMenuHandlers = {
    onSettingsClick: () => openExclusive(() => setShowSettingsPage(true)),
    // 主题二级菜单末尾的「自定义主题」：直接落到外观这一页，省掉一次找 tab 的操作
    onAppearanceSettingsClick: () => openExclusive(() => {
      setSettingsIntent({ tab: 'appearance' })
      setShowSettingsPage(true)
    }),
    onExploreClick: () => openExclusive(() => setShowScenarioPage(true)),
    onScheduleClick: () => {
      closeAllFullPages()
      closePanelDrawer()
      closeSceneToolDrawer()
      setShowWorkflow(false)
      setActiveSidePanel(activeSidePanel === 'schedule' ? null : 'schedule')
      closeInternalBrowser()
    },
    // 任务中心与导航栏入口保持一致：以全屏抽屉打开，再点一次收起
    onLedgerClick: () => {
      const currentTarget = getPluginDrawerTarget()
      const isOpen = currentTarget?.kind === 'panel' && currentTarget.panelId === 'ledger'
      closeAllFullPages()
      closeSceneToolDrawer()
      setShowWorkflow(false)
      closeInternalBrowser()
      if (isOpen) {
        closePanelDrawer()
        return
      }
      openBuiltinPanel('ledger')
    },
    onPluginCenterClick: () => openExclusive(() => setShowPluginCenterPage(true)),
    onExpertLibraryClick: () => openExclusive(() => {
      setSettingsIntent({ tab: 'roleLibrary' })
      setShowSettingsPage(true)
    }),
    onUserInfoClick: () => openExclusive(() => setShowUserProfilePage(true)),
    onBillingCenterClick: () => openExclusive(() => setShowBillingCenterPage(true)),
    onSessionHistoryClick: () => openExclusive(() => setShowSessionHistoryPage(true)),
    onContactsClick: () => openExclusive(() => setShowContactsPage(true)),
    onCheckUpdate: () => setShowUpdateModal(true),
    onAbout: () => setShowAbout(true),
    onLogout: () => {
      logout()
      setShowUserMenu(false)
    },
  }

  const userInitial = cloudUser?.username?.[0]?.toUpperCase() || cloudUser?.email?.[0]?.toUpperCase() || '?'
  const userDisplayName = formatUserDisplayName(cloudUser?.username || cloudUser?.email || cloudUser?.phone || '')
  const showUserInfo = isAuthenticated && !!cloudUser

  /**
   * 顶部摆放：只保留头像，尺寸让位给标题栏（40px 的导航栏按钮在 44px 的
   * 标题栏里会把整条撑高），菜单锚点因此也改成向下展开。
   */
  if (placement === 'titlebar') {
    return (
      <>
        <div className="no-drag relative flex items-center" ref={userAreaRef}>
          <UserMenuDropdown
            isOpen={showUserMenu}
            onClose={() => setShowUserMenu(false)}
            language={language}
            handlers={handlers}
            isAuthenticated={showUserInfo}
            cloudUser={cloudUser}
            anchorRef={userAreaRef}
            hasUpdateAvailable={hasUpdateAvailable}
            placement="titlebar"
          />

          {showUserInfo ? (
            <HintOverlay content={userDisplayName} side="bottom" delay={400}>
              <button
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="relative w-7 h-7 rounded-full flex items-center justify-center hover:bg-text-primary/[0.06] transition-colors"
              >
                {cloudUser?.avatarUrl ? (
                  <img
                    src={cloudUser.avatarUrl}
                    alt=""
                    className="w-[22px] h-[22px] rounded-full object-cover border border-border/40"
                  />
                ) : (
                  <div className="w-[22px] h-[22px] rounded-full bg-gradient-to-br from-accent/80 to-accent/40 flex items-center justify-center text-white text-[10px] font-bold shadow-sm shadow-accent/20">
                    {userInitial}
                  </div>
                )}
                {hasUpdateAvailable && (
                  <span className="absolute top-0 right-0 w-2 h-2 rounded-full bg-red-500 ring-2 ring-background animate-pulse" />
                )}
              </button>
            </HintOverlay>
          ) : (
            <HintOverlay content={t('layout.signin2', language as Language)} side="bottom" delay={400}>
              <button
                onClick={() => setShowLoginModal(true)}
                className="relative w-7 h-7 rounded-md flex items-center justify-center text-text-muted hover:text-accent hover:bg-accent/10 transition-colors"
              >
                <LogIn className="w-4 h-4" />
                {hasUpdateAvailable && (
                  <span className="absolute top-0 right-0 w-2 h-2 rounded-full bg-red-500 ring-2 ring-background animate-pulse" />
                )}
              </button>
            </HintOverlay>
          )}
        </div>

        <UserAccountPopover language={language} forceLoginOpen={showLoginModal} onLoginClose={() => setShowLoginModal(false)} hideButton />
        <UpdateModal isOpen={showUpdateModal} onClose={() => setShowUpdateModal(false)} />
      </>
    )
  }

  return (
    <>
      <div className={`${p}-nav-rail-user`} ref={userAreaRef}>
        <UserMenuDropdown
          isOpen={showUserMenu}
          onClose={() => setShowUserMenu(false)}
          language={language}
          handlers={handlers}
          isAuthenticated={showUserInfo}
          cloudUser={cloudUser}
          anchorRef={userAreaRef}
          hasUpdateAvailable={hasUpdateAvailable}
          placement="rail"
        />

        {showUserInfo ? (
          isExpanded ? (
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
          isExpanded ? (
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
    </>
  )
}

export default RailUserPart
