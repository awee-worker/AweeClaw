import { useMemo } from 'react'
import { GitBranch, AlertCircle, XCircle, Terminal, Bug } from 'lucide-react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { useDiagnosticsStore, getFileStats } from '@services/diagnosticRepository'
import { BRAND } from '@shared/brand'

export default function EditorBottomBar() {
  const {
    language,
    isGitRepo,
    gitStatus,
    activeFilePath,
    cursorPosition,
    openDockPanel,
    dockPanelVisible,
    activeDockTab,
  } = useStore(useShallow(s => ({
    language: s.language,
    isGitRepo: s.isGitRepo,
    gitStatus: s.gitStatus,
    activeFilePath: s.activeFilePath,
    cursorPosition: s.cursorPosition,
    openDockPanel: s.openDockPanel,
    dockPanelVisible: s.dockPanelVisible,
    activeDockTab: s.activeDockTab,
  })))

  const isTerminalActive = dockPanelVisible && activeDockTab === 'terminal'
  const isDebugActive = dockPanelVisible && activeDockTab === 'debug'

  const diagnostics = useDiagnosticsStore(state => state.diagnostics)
  const version = useDiagnosticsStore(state => state.version)
  const currentFileStats = useMemo(
    () => getFileStats(diagnostics, activeFilePath),
    [activeFilePath, version, diagnostics],
  )

  return (
    <div className={`${BRAND.cssPrefix}-editor-bottom-bar`}>
      <style>{`
        .${BRAND.cssPrefix}-editor-bottom-bar {
          height: 26px;
          background: rgb(var(--background-secondary));
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 8px;
          font-size: 11px;
          user-select: none;
          color: rgb(var(--text-muted));
          z-index: 40;
          font-weight: 500;
          border-top: 1px solid rgba(var(--border), 0.2);
          flex-shrink: 0;
        }
      `}</style>

      <div className="flex items-center gap-2">
        {isGitRepo && gitStatus && (
          <button className="flex items-center gap-1.5 px-1.5 py-0.5 rounded-md hover:bg-white/5 text-text-muted hover:text-text-primary transition-colors group">
            <GitBranch className="w-3 h-3 text-text-muted group-hover:text-text-primary transition-colors" />
            <span className="font-medium tracking-wide group-hover:text-text-primary">{gitStatus.branch}</span>
          </button>
        )}

        <button
          onClick={() => openDockPanel('problems')}
          className="flex items-center gap-1.5 px-1.5 py-0.5 rounded-md hover:bg-white/5 transition-colors text-text-muted group hover:text-text-primary"
        >
          <XCircle className={`w-3 h-3 ${currentFileStats.errors > 0 ? 'text-red-400' : 'text-text-muted group-hover:text-text-primary transition-colors'}`} />
          <span className={`font-medium ${currentFileStats.errors > 0 ? 'text-red-400' : 'text-text-muted group-hover:text-text-primary'}`}>{currentFileStats.errors}</span>
          <AlertCircle className={`w-3 h-3 ${currentFileStats.warnings > 0 ? 'text-amber-400' : 'text-text-muted group-hover:text-text-primary transition-colors'}`} />
          <span className={`font-medium ${currentFileStats.warnings > 0 ? 'text-amber-400' : 'text-text-muted group-hover:text-text-primary'}`}>{currentFileStats.warnings}</span>
        </button>
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-2">
        {activeFilePath && cursorPosition && (
          <span className="text-[10px] font-mono text-text-muted hidden md:inline">
            Ln {cursorPosition.line}, Col {cursorPosition.column}
          </span>
        )}

        <div className="flex items-center gap-0.5">
          <button
            onClick={() => openDockPanel('terminal')}
            className="group flex items-center justify-center w-6 h-6 rounded-md transition-all"
            title={language === 'zh' ? (isTerminalActive ? '隐藏终端' : '显示终端') : (isTerminalActive ? 'Hide Terminal' : 'Show Terminal')}
          >
            <Terminal className={`w-3 h-3 transition-colors ${isTerminalActive ? 'text-accent' : 'text-text-muted group-hover:text-text-primary'}`} />
          </button>
          <button
            onClick={() => openDockPanel('debug')}
            className="group flex items-center justify-center w-6 h-6 rounded-md transition-all"
            title={language === 'zh' ? (isDebugActive ? '隐藏调试' : '显示调试') : (isDebugActive ? 'Hide Debug' : 'Show Debug')}
          >
            <Bug className={`w-3 h-3 transition-colors ${isDebugActive ? 'text-accent' : 'text-text-muted group-hover:text-text-primary'}`} />
          </button>
        </div>
      </div>
    </div>
  )
}
