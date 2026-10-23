/**
 * 工作空间面板 / 会话面板开关部件（sidebar-toggle）
 *
 * 两个开关放在一起，因为它们共用一个语义位：右侧工作区的左右两块内容
 * （工作空间面板、AI 会话面板）分别收放。场景用 chrome.hideSidebarToggle /
 * chrome.hideChatToggle 逐个收起。
 *
 * 助手开关的可见性有一条硬规则：场景声明 hideChatToggle 时收起常驻开关，
 * 但聊天一旦处于可见状态，按钮必须回来承担「关闭」职责 —— 菜单、快捷键、
 * todo 等入口都能绕过场景配置把聊天打开，此时没有开关，用户会停在一个
 * 关不掉、场景内也找不到入口的界面上。
 */

import { useShallow } from 'zustand/react/shallow'
import { useStore } from '@store'
import { scenarioRegistry } from '@shared/configuration/scenarios'
import { HintOverlay } from '@components/ui/HintOverlay'
import type { HostPartComponentProps } from '../HostPartRegistry'

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

export function SidebarTogglePart(_props: HostPartComponentProps) {
  const { language, activeSidePanel, chatVisible, toggleSidebar, toggleChat, activeScenarioId } = useStore(
    useShallow((s) => ({
      language: s.language,
      activeSidePanel: s.activeSidePanel,
      chatVisible: s.chatVisible,
      toggleSidebar: s.toggleSidebar,
      toggleChat: s.toggleChat,
      activeScenarioId: s.activeScenarioId,
    })),
  )

  const scenarioChrome = scenarioRegistry.get(activeScenarioId)?.ui?.chrome
  const hideSidebarToggle = scenarioChrome?.hideSidebarToggle === true
  const hideChatToggle = scenarioChrome?.hideChatToggle === true

  const sidebarVisible = activeSidePanel !== null

  return (
    <>
      {!hideSidebarToggle && (
        <HintOverlay
          content={language === 'zh' ? (sidebarVisible ? '隐藏工作空间面板' : '显示工作空间面板') : (sidebarVisible ? 'Hide Workspace Panel' : 'Show Workspace Panel')}
          side="bottom"
          delay={300}
        >
          <button
            onClick={toggleSidebar}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-text-primary/[0.05] transition-colors"
          >
            {sidebarVisible ? <PanelLeftIcon filled className="w-4 h-4" /> : <PanelLeftIcon className="w-4 h-4" />}
          </button>
        </HintOverlay>
      )}

      {(!hideChatToggle || chatVisible) && (
        <HintOverlay
          content={language === 'zh' ? (chatVisible ? '隐藏 AI 会话面板' : '显示 AI 会话面板') : (chatVisible ? 'Hide Chat Panel' : 'Show Chat Panel')}
          side="bottom"
          delay={300}
        >
          <button
            onClick={toggleChat}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-text-primary/[0.05] transition-colors"
          >
            {chatVisible ? <PanelRightIcon filled className="w-4 h-4" /> : <PanelRightIcon className="w-4 h-4" />}
          </button>
        </HintOverlay>
      )}
    </>
  )
}

export default SidebarTogglePart
