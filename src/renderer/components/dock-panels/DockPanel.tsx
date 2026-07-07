/**
 * 底部 Dock 面板容器
 */
import { useEffect, useState, useCallback, memo } from 'react'
import { useStore, useModeStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import {
  AlertCircle, ScrollText, Bug, Terminal as TerminalIcon,
  ChevronDown, ChevronUp, X, Trash2, RefreshCw,
  Plus, Sparkles, SplitSquareHorizontal,
} from 'lucide-react'
import { type DockTab } from '@store/slices/layoutSlice'
import { useDiagnosticsStore } from '@services/diagnosticRepository'
import { useAgentStore } from '@intelligence/state/IntelligenceStore'
import { terminalManager } from '@services/TerminalAdapter'
import { t } from '@renderer/i18n'
import ProblemsPanel from './ProblemsPanel'
import OutputPanel from './OutputPanel'
import DockDebugPanel from './DockDebugPanel'
import TerminalConsolePanel from './TerminalConsolePanel'

const TAB_CONFIG: Record<DockTab, {
  icon: React.ComponentType<{ className?: string }>
  label: string
  labelZh: string
}> = {
  problems: { icon: AlertCircle, label: 'Problems', labelZh: '问题' },
  output: { icon: ScrollText, label: 'Output', labelZh: '输出' },
  debug: { icon: Bug, label: 'Debug', labelZh: '调试' },
  terminal: { icon: TerminalIcon, label: 'Terminal', labelZh: '终端' },
}

const DockPanel = memo(function DockPanel() {
  const {
    dockPanelVisible,
    setDockPanelVisible,
    activeDockTab,
    setActiveDockTab,
    language,
    toolCallLogs,
    clearToolCallLogs,
  } = useStore(useShallow(s => ({
    dockPanelVisible: s.dockPanelVisible,
    setDockPanelVisible: s.setDockPanelVisible,
    activeDockTab: s.activeDockTab,
    setActiveDockTab: s.setActiveDockTab,
    language: s.language,
    toolCallLogs: s.toolCallLogs,
    clearToolCallLogs: s.clearToolCallLogs,
  })))

  const [isCollapsed, setIsCollapsed] = useState(false)
  const [height, setHeight] = useState(280)
  const [isResizing, setIsResizing] = useState(false)

  const errorCount = useDiagnosticsStore(s => s.errorCount)
  const warningCount = useDiagnosticsStore(s => s.warningCount)

  const [terminalState, setTerminalState] = useState(() => terminalManager.getState())

  useEffect(() => {
    return terminalManager.subscribe(setTerminalState)
  }, [])

  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
  }, [])

  useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      const newHeight = window.innerHeight - e.clientY - 24
      if (newHeight > 100 && newHeight < window.innerHeight - 100) {
        setHeight(newHeight)
      }
    }

    const stopResizing = () => {
      setIsResizing(false)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', stopResizing)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', stopResizing)
    }
  }, [isResizing])

  const closePanel = useCallback(() => {
    setDockPanelVisible(false)
    setIsCollapsed(false)
  }, [setDockPanelVisible])

  const renderTab = useCallback((tab: DockTab) => {
    const config = TAB_CONFIG[tab]
    const Icon = config.icon
    const isActive = activeDockTab === tab
    const label = language === 'zh' ? config.labelZh : config.label

    let badge: string | null = null
    if (tab === 'problems' && (errorCount > 0 || warningCount > 0)) {
      badge = `${errorCount}${warningCount > 0 ? `,${warningCount}` : ''}`
    } else if (tab === 'output' && toolCallLogs.length > 0) {
      badge = String(toolCallLogs.length)
    }

    return (
      <button
        key={tab}
        onClick={() => setActiveDockTab(tab)}
        className={`flex items-center gap-2 px-3 h-full min-w-[80px] cursor-pointer transition-colors duration-150 rounded-md flex-shrink-0 ${
          isActive
            ? 'bg-accent/15 text-accent font-medium'
            : 'bg-transparent text-text-muted hover:bg-surface-hover/50 hover:text-text-primary'
        }`}
      >
        <Icon className="w-4 h-4" />
        <span className="text-xs">{label}</span>
        {badge && (
          <span className={`text-[10px] font-mono px-1.5 py-0 rounded ${
            tab === 'problems' && errorCount > 0
              ? 'bg-red-500/20 text-red-400'
              : 'bg-surface/60 text-text-muted'
          }`}>
            {badge}
          </span>
        )}
      </button>
    )
  }, [activeDockTab, language, errorCount, warningCount, toolCallLogs.length, terminalState.terminals.length, setActiveDockTab])

  const renderActionButtons = useCallback(() => {
    const isZh = language === 'zh'

    switch (activeDockTab) {
      case 'problems':
        return (
          <>
            <button
              onClick={() => useDiagnosticsStore.getState().clearAll()}
              className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
              title={t('builder.problems.clearAll', language)}
            >
              <Trash2 className="w-3 h-3" />
              {isZh ? '清空' : 'Clear'}
            </button>
            <button
              onClick={() => {}}
              className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
              title={isZh ? '复制问题' : 'Copy'}
            >
              <RefreshCw className="w-3 h-3" />
              {isZh ? '刷新' : 'Refresh'}
            </button>
          </>
        )

      case 'output':
        return (
          <>
            <button
              onClick={() => clearToolCallLogs()}
              className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
              title={isZh ? '清空输出' : 'Clear Output'}
            >
              <Trash2 className="w-3 h-3" />
              {isZh ? '清空' : 'Clear'}
            </button>
            <button
              onClick={() => {}}
              className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
              title={isZh ? '复制输出' : 'Copy Output'}
            >
              <RefreshCw className="w-3 h-3" />
              {isZh ? '复制' : 'Copy'}
            </button>
          </>
        )

      case 'debug':
        return (
          <>
            <button
              onClick={() => useStore.getState().toggleDebug()}
              className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-text-muted hover:text-accent hover:bg-accent/10 transition-colors"
              title={isZh ? '开始调试' : 'Start Debug'}
            >
              <RefreshCw className="w-3 h-3" />
              {isZh ? '开始' : 'Start'}
            </button>
            <button
              onClick={() => {}}
              className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
              title={isZh ? '停止调试' : 'Stop Debug'}
            >
              <X className="w-3 h-3" />
              {isZh ? '停止' : 'Stop'}
            </button>
          </>
        )

      case 'terminal': {
        const activeTerminalId = terminalState.activeId
        return (
          <>
            <button
              onClick={() => terminalManager.createTerminal({ cwd: useStore.getState().workspacePath || '' })}
              className="flex items-center justify-center w-7 h-7 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
              title={isZh ? '新建终端' : 'New Terminal'}
            >
              <Plus className="w-4 h-4" />
            </button>
            <button
              onClick={() => {
                terminalManager.createTerminal({ cwd: useStore.getState().workspacePath || '' })
                useStore.getState().setTerminalLayout('split')
              }}
              className="flex items-center justify-center w-7 h-7 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
              title={isZh ? '分屏终端' : 'Split Terminal'}
            >
              <SplitSquareHorizontal className="w-4 h-4" />
            </button>

            <button
              onClick={() => {
                const setMode = useModeStore.getState().setMode
                const setInputPrompt = useAgentStore.getState().setInputPrompt
                if (!activeTerminalId) return
                const content = terminalManager.getOutputPreview(activeTerminalId, 24, 6000)
                  .replace(/\u001b\[[0-9;]*m/g, '')
                  .slice(-2000)
                  .trim()
                if (!content) return
                setMode('chat')
                setInputPrompt(`I'm getting this error in the terminal. Please analyze it and fix the code:\n\n\`\`\`\n${content}\n\`\`\``)
              }}
              className="flex items-center justify-center w-7 h-7 rounded-lg text-accent hover:bg-accent/10 transition-colors"
              title={isZh ? 'AI 修复' : 'Fix with AI'}
            >
              <Sparkles className="w-4 h-4" />
            </button>
          </>
        )
      }

      default:
        return null
    }
  }, [activeDockTab, language, terminalState.activeId, clearToolCallLogs])

  const renderContent = useCallback(() => {
    switch (activeDockTab) {
      case 'problems':
        return <ProblemsPanel />
      case 'output':
        return <OutputPanel />
      case 'debug':
        return <DockDebugPanel />
      case 'terminal':
        return <TerminalConsolePanel />
      default:
        return null
    }
  }, [activeDockTab])

  if (!dockPanelVisible) return null

  return (
    <div className="bg-transparent flex flex-col transition-none relative z-10" style={{ height: isCollapsed ? 42 : height }}>
      <div className="absolute top-0 left-0 right-0 h-1 cursor-row-resize z-50 hover:bg-accent/50 transition-colors" onMouseDown={startResizing} />

      <div className="h-[42px] min-h-[42px] flex items-center justify-between border-b border-border/50 bg-background select-none relative z-20 px-2 py-1.5">
        <div className="flex items-center flex-1 min-w-0 h-full overflow-hidden gap-1.5">
          <div className="flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-md cursor-pointer hover:bg-surface-hover text-text-muted transition-colors" onClick={() => setIsCollapsed(!isCollapsed)}>
            {isCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </div>
          <div
            className="flex items-center overflow-x-auto overflow-y-hidden scrollbar-none flex-1 h-full gap-1.5"
            onWheel={(e) => {
              if (e.deltaY !== 0 && e.currentTarget) {
                e.currentTarget.scrollLeft += e.deltaY
              }
            }}
          >
            {(['problems', 'output', 'debug', 'terminal'] as DockTab[]).map(renderTab)}
          </div>
        </div>

        <div className="flex items-center h-full gap-1 px-2">
          {renderActionButtons()}
        </div>

        <div className="flex items-center gap-1 px-2 flex-shrink-0 h-full">
          <button
            onClick={closePanel}
            className="flex items-center justify-center w-7 h-7 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
            title={language === 'zh' ? '关闭面板' : 'Close Panel'}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className={`flex-1 p-0 min-h-0 relative bg-transparent ${isCollapsed ? 'hidden' : 'block'}`}>
        {renderContent()}
      </div>
    </div>
  )
})

export default DockPanel
