/**
 * 历史会话部件（chat-history）
 *
 * 从 NavigationRail 里拆出：展开态是一列可重命名的会话列表，收起态是若干
 * 圆形入口。两种形态共用同一份数据与同一套选中规则，因此不拆成两个组件。
 *
 * 选中高亮有两条约束（与拆分前一致）：
 * - 停在欢迎页、或停在接管主区域的 hideChat 面板时不显示高亮 —— 用户并未
 *   真正处于某个会话中，继续高亮会造成「界面已切走但列表仍选中」的误读
 * - 点击会话时若正被 hideChat / 宽模式面板占用主区域，先退出该面板并恢复
 *   会话视图，否则用户点了会话却还停在待办等面板上
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Edit2, MessageSquare, MoreHorizontal, PackageOpen, Trash2 } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '@store'
import { scenarioRegistry } from '@shared/configuration/scenarios'
import { BRAND } from '@shared/brand'
import { t, type Language } from '@renderer/i18n'
import { useAgentStore } from '@intelligence/state/IntelligenceStore'
import { useAgentActions, useAllThreads, isThreadExecuting } from '@hooks/useAgent'
import { closePanelDrawer, getPluginDrawerTarget } from '@renderer/plugins/pluginDrawerStore'
import { getMessageText, getThreadDisplayTitle } from '@intelligence/providerTypes'
import type { ChatThread } from '@intelligence/providerTypes'
import { HintOverlay } from '@components/ui/HintOverlay'
import { BreathingDot } from '@components/ui/BreathingDot'
import type { HostPartComponentProps } from '../HostPartRegistry'

/** 展开态最多直接列出多少条，超出的引导到历史会话页 */
const EXPANDED_LIMIT = 34
/** 收起态最多显示多少个入口 */
const COLLAPSED_LIMIT = 5

function ThreadListItem({
  thread,
  isActive,
  running,
  language,
  onSelect,
  onDelete,
  onRename,
}: {
  thread: ChatThread
  isActive: boolean
  running: boolean
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
      {/* 正在执行的会话把入口图标换成呼吸圆点，用户切走后也能看出这条还在跑 */}
      {running ? (
        <BreathingDot className="w-3.5 h-3.5" />
      ) : (
        <MessageSquare className="w-3.5 h-3.5 shrink-0 opacity-50" strokeWidth={1.5} />
      )}
      <div className="flex-1 min-w-0 group-hover:pr-5 transition-all">
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="text-[13px] font-medium truncate leading-snug" title={title}>{title}</div>
          {thread.mountedTask && (
            <span
              className="shrink-0 flex items-center text-accent opacity-80"
              title={t('mt.badge', language as Language)}
            >
              <PackageOpen className="w-3 h-3" strokeWidth={1.5} />
            </span>
          )}
        </div>
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
                className="fixed py-1 rounded-lg bg-popover backdrop-blur-xl border border-border/50 shadow-lg shadow-black/15 z-[9999] min-w-[120px]"
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

export interface ChatHistoryPartProps extends HostPartComponentProps {
  /** 展开态渲染完整列表，收起态渲染圆形入口；缺省跟随导航栏展开状态 */
  expanded?: boolean
}

export function ChatHistoryPart({ expanded }: ChatHistoryPartProps) {
  const {
    language,
    activeSidePanel,
    closeSidePanelForView,
    setChatVisible,
    setShowSessionHistoryPage,
    showWelcomePage,
    activeScenarioId,
    navRailExpanded,
  } = useStore(useShallow((s) => ({
    language: s.language,
    activeSidePanel: s.activeSidePanel,
    closeSidePanelForView: s.closeSidePanelForView,
    setChatVisible: s.setChatVisible,
    setShowSessionHistoryPage: s.setShowSessionHistoryPage,
    showWelcomePage: s.showWelcomePage,
    activeScenarioId: s.activeScenarioId,
    navRailExpanded: s.navRailExpanded,
  })))

  const currentThreadId = useAgentStore(state => state.currentThreadId)
  const allThreads = useAllThreads()
  const { switchThread, deleteThread, renameThread } = useAgentActions()

  const [renamingThreadId, setRenamingThreadId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const isExpanded = expanded ?? navRailExpanded
  const p = BRAND.cssPrefix

  /**
   * 声明了 hideChat 的面板：激活时会接管主内容区并隐藏对话窗口，
   * 此时用户已经离开会话视图，历史列表不应再保持选中高亮；
   * 点击历史会话时也据此退出该面板、恢复对话窗口。
   */
  const hideChatPanelIds = useMemo(() => {
    const items = scenarioRegistry.get(activeScenarioId)?.ui?.sidebarItems ?? []
    return new Set(items.filter(item => item.hideChat).map(item => item.id))
  }, [activeScenarioId])

  /** 宽模式面板（接管主区域，如待办中心 / 邮件中心）id，点击会话时同样需要退出 */
  const wideModePanelIds = useMemo(() => {
    const items = scenarioRegistry.get(activeScenarioId)?.ui?.sidebarItems ?? []
    return new Set(items.filter(item => item.wideMode).map(item => item.id))
  }, [activeScenarioId])

  const threadHighlightEnabled = !showWelcomePage
    && !(activeSidePanel && hideChatPanelIds.has(activeSidePanel))

  const handleRenameThread = (threadId: string) => {
    const thread = useAgentStore.getState().threads[threadId]
    if (thread) {
      setRenamingThreadId(threadId)
      setRenameValue(getThreadDisplayTitle(thread))
    }
  }

  const handleRenameSubmit = () => {
    if (renamingThreadId && renameValue.trim()) {
      renameThread(renamingThreadId, renameValue.trim())
    }
    setRenamingThreadId(null)
  }

  const handleSelectThread = (threadId: string) => {
    // 面板以抽屉打开时，遮罩会挡住主区域，不关掉抽屉用户就看不到刚切过去的会话
    if (getPluginDrawerTarget()) closePanelDrawer()

    const panel = activeSidePanel
    if (panel && (hideChatPanelIds.has(panel) || wideModePanelIds.has(panel))) {
      // 切会话等于离开那块面板的上下文：收起时一并重置「上次面板」，
      // 否则顶部工作空间开关再按下会把刚离开的面板（插件市场等）重新打开。
      closeSidePanelForView()
      setChatVisible(true)
    }
    void switchThread(threadId)
  }

  if (!isExpanded) {
    return (
      <div className="flex-1 flex flex-col items-center min-h-0">
        {allThreads.length > 0 && (
          <div className="flex-1 overflow-y-auto no-scrollbar w-full flex flex-col items-center gap-1 py-1">
            {allThreads.slice(0, COLLAPSED_LIMIT).map(thread => (
              <HintOverlay
                key={thread.id}
                content={getThreadDisplayTitle(thread)}
                side="right"
                delay={400}
              >
                <button
                  onClick={() => handleSelectThread(thread.id)}
                  className={`relative w-[30px] h-[30px] rounded-md flex items-center justify-center transition-all ${
                    threadHighlightEnabled && currentThreadId === thread.id
                      ? 'bg-accent/10 text-accent'
                      : 'text-text-muted hover:text-text-primary hover:bg-surface-hover/50'
                  }`}
                >
                  {isThreadExecuting(thread) ? (
                    <BreathingDot className="w-3.5 h-3.5" />
                  ) : (
                    <MessageSquare className="w-3.5 h-3.5 opacity-50" strokeWidth={1.5} />
                  )}
                  {thread.mountedTask && (
                    <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-accent" />
                  )}
                </button>
              </HintOverlay>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 w-full">
      <div className={`${p}-nav-rail-history-header`}>
        <span className={`${p}-nav-rail-history-title`}>
          {t('layout.chathistory', language as Language)}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto no-scrollbar">
        {allThreads.length === 0 ? (
          <div className="px-2 py-4 text-[11px] text-text-muted opacity-40 text-center">
            {t('layout.nochatsyet', language as Language)}
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {allThreads.slice(0, EXPANDED_LIMIT).map(thread => (
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
                  isActive={threadHighlightEnabled && currentThreadId === thread.id}
                  running={isThreadExecuting(thread)}
                  language={language}
                  onSelect={() => handleSelectThread(thread.id)}
                  onDelete={() => deleteThread(thread.id)}
                  onRename={handleRenameThread}
                />
              )
            ))}
            {allThreads.length > EXPANDED_LIMIT && (
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
  )
}

export default ChatHistoryPart
