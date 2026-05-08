import { api } from '@/renderer/services/electronAPI'
import { Minus, Square, X, Search, HelpCircle, PanelLeftOpen, PanelLeftClose, PanelRightOpen, PanelRightClose } from 'lucide-react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import WorkspaceDropdown from './WorkspaceDropdown'
import UpdateIndicator from './UpdateIndicator'
import { ScenarioSelector } from '../scenario/ScenarioSelector'

const isMac = typeof navigator !== 'undefined' && (
  navigator.platform.toUpperCase().indexOf('MAC') >= 0 ||
  ((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform?.toUpperCase().indexOf('MAC') ?? -1) >= 0
)

export default function TitleBar() {
  const { setShowQuickOpen, setShowAbout, language, activeSidePanel, chatVisible, toggleSidebar, toggleChat } = useStore(useShallow(s => ({
    setShowQuickOpen: s.setShowQuickOpen,
    setShowAbout: s.setShowAbout,
    language: s.language,
    activeSidePanel: s.activeSidePanel,
    chatVisible: s.chatVisible,
    toggleSidebar: s.toggleSidebar,
    toggleChat: s.toggleChat,
  })))

  const sidebarVisible = activeSidePanel !== null

  return (
    <div className="h-12 flex items-center justify-between px-0 drag-region select-none bg-background z-50 border-b border-border/30">

      {/* Left - Scenario, Workspace & Search */}
      <div className={`
        flex items-center gap-4 h-full transition-all duration-300
        ${isMac ? 'pl-[76px]' : 'pl-4'}
      `}>
        {/* Scenario Selector */}
        <div className="no-drag pl-[15px]">
          <ScenarioSelector />
        </div>

        <div className="w-[1px] h-4 bg-border/50" />

        {/* Workspace Selector */}
        <div className="no-drag">
          <WorkspaceDropdown />
        </div>

        <div className="w-[1px] h-4 bg-border/50" />

        {/* Search */}
        <div
          onClick={() => setShowQuickOpen(true)}
          className="no-drag flex items-center gap-1.5 px-2 h-[28px] rounded-md hover:bg-text-primary/[0.06] transition-all duration-200 cursor-pointer group"
        >
          <Search className="w-3.5 h-3.5 text-text-muted opacity-70 group-hover:text-accent transition-colors" />
          <span className="text-xs text-text-muted opacity-70 group-hover:text-text-primary transition-colors">
            {language === 'zh' ? '搜索' : 'Search'}
          </span>
        </div>
      </div>

      {/* Center - Spacer */}
      <div className="flex-1 min-w-0" />

      {/* Right - Panel Toggles & Window Controls */}
      <div className="flex items-center justify-end h-full pr-2 gap-1">
        <div className="no-drag flex items-center gap-1 h-full mr-2">
          {/* Update Indicator */}
          <UpdateIndicator />

          {/* About Button */}
          <button
            onClick={() => setShowAbout(true)}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-text-primary/[0.05] transition-all"
            title="About"
          >
            <HelpCircle className="w-4 h-4" />
          </button>

          <div className="w-[1px] h-4 bg-border/50 mx-1"></div>

          {/* Sidebar Toggle */}
          <button
            onClick={toggleSidebar}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-text-primary/[0.05] transition-colors"
            title={language === 'zh' ? (sidebarVisible ? '隐藏侧边栏' : '显示侧边栏') : (sidebarVisible ? 'Hide Sidebar' : 'Show Sidebar')}
          >
            {sidebarVisible ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
          </button>

          <button
            onClick={toggleChat}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-text-primary/[0.05] transition-colors"
            title={language === 'zh' ? (chatVisible ? '隐藏 AI 助手' : '显示 AI 助手') : (chatVisible ? 'Hide AI Assistant' : 'Show AI Assistant')}
          >
            {chatVisible ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
          </button>
        </div>

        {/* Windows Controls */}
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
