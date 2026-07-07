/**
 * 调试面板（Debug Panel）
 *
 * 展示调试会话状态、断点列表、调用栈和变量信息。
 */
import { useState } from 'react'
import type React from 'react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import {
  Play, Pause, Square, ArrowRight, ArrowDownLeft, ArrowUpLeft,
  Bug, AlertCircle, ChevronRight, ChevronDown,
} from 'lucide-react'

interface Breakpoint {
  id: string
  filePath: string
  line: number
  condition?: string
  enabled: boolean
}

const DockDebugPanel: React.FC = () => {
  const { language } = useStore(useShallow(s => ({
    language: s.language,
  })))
  const isZh = language === 'zh'

  const [isRunning, setIsRunning] = useState(false)
  const [currentLine, setCurrentLine] = useState<{ file: string; line: number } | null>(null)
  const [breakpoints, setBreakpoints] = useState<Breakpoint[]>([
    { id: '1', filePath: 'src/scenario.ts', line: 42, condition: '', enabled: true },
    { id: '2', filePath: 'src/components/BuilderWelcomePage.tsx', line: 95, condition: 'debug', enabled: true },
    { id: '3', filePath: 'src/hooks/useProjectOperations.ts', line: 128, condition: '', enabled: false },
  ])
  const [expandedBreakpoints, setExpandedBreakpoints] = useState<Set<string>>(new Set(['src/scenario.ts']))

  const toggleBreakpoint = (id: string) => {
    setBreakpoints(prev => prev.map(bp =>
      bp.id === id ? { ...bp, enabled: !bp.enabled } : bp
    ))
  }

  const toggleFileExpansion = (filePath: string) => {
    setExpandedBreakpoints(prev => {
      const next = new Set(prev)
      if (next.has(filePath)) next.delete(filePath)
      else next.add(filePath)
      return next
    })
  }

  const breakpointsByFile = breakpoints.reduce((acc, bp) => {
    if (!acc[bp.filePath]) acc[bp.filePath] = []
    acc[bp.filePath].push(bp)
    return acc
  }, {} as Record<string, Breakpoint[]>)

  return (
    <div className="h-full flex flex-col bg-background-editor">
      <div className="flex items-center gap-1 px-3 py-2 border-b border-border/40">
        <button
          onClick={() => setIsRunning(!isRunning)}
          className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors ${
            isRunning
              ? 'bg-amber-500/10 text-amber-400 hover:bg-amber-500/20'
              : 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
          }`}
        >
          {isRunning ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
          {isZh ? (isRunning ? '暂停' : '开始') : (isRunning ? 'Pause' : 'Start')}
        </button>
        <button
          onClick={() => { setIsRunning(false); setCurrentLine(null) }}
          className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
        >
          <Square className="w-3 h-3" />
          {isZh ? '停止' : 'Stop'}
        </button>
        <div className="w-[1px] h-4 bg-border/50 mx-1" />
        <button className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors" title={isZh ? '单步跳过' : 'Step Over'}>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
        <button className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors" title={isZh ? '单步进入' : 'Step Into'}>
          <ArrowDownLeft className="w-3.5 h-3.5" />
        </button>
        <button className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors" title={isZh ? '单步退出' : 'Step Out'}>
          <ArrowUpLeft className="w-3.5 h-3.5" />
        </button>
      </div>

      {currentLine && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-accent/5 border-b border-accent/10">
          <Bug className="w-3 h-3 text-accent" />
          <span className="text-xs text-text-secondary">
            {isZh ? '暂停在' : 'Paused at '}
            <span className="font-mono text-text-primary">{currentLine.file}:{currentLine.line}</span>
          </span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {breakpoints.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-text-muted px-6 py-8">
            <div className="w-12 h-12 rounded-2xl bg-surface/40 border border-border/40 flex items-center justify-center mb-3">
              <AlertCircle className="w-6 h-6 text-text-muted/50" strokeWidth={1.5} />
            </div>
            <p className="text-sm font-medium text-text-primary">
              {isZh ? '没有断点' : 'No breakpoints'}
            </p>
            <p className="text-xs text-text-muted mt-1 text-center leading-relaxed">
              {isZh ? '在编辑器中点击行号设置断点' : 'Click line numbers in editor to set breakpoints'}
            </p>
          </div>
        ) : (
          <div className="py-1">
            {Object.entries(breakpointsByFile).map(([filePath, fileBreakpoints]) => {
              const isExpanded = expandedBreakpoints.has(filePath)
              return (
                <div key={filePath}>
                  <button
                    onClick={() => toggleFileExpansion(filePath)}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-surface-hover/50 transition-colors"
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-3 h-3 text-text-muted" />
                    ) : (
                      <ChevronRight className="w-3 h-3 text-text-muted" />
                    )}
                    <span className="font-medium text-text-primary truncate flex-1">{filePath}</span>
                    <span className="text-[10px] text-text-muted/70 font-mono">
                      {fileBreakpoints.length}
                    </span>
                  </button>
                  {isExpanded && (
                    <div className="ml-6">
                      {fileBreakpoints.map((bp) => (
                        <button
                          key={bp.id}
                          onClick={() => toggleBreakpoint(bp.id)}
                          className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                            bp.enabled ? 'hover:bg-surface-hover/50' : 'opacity-50 hover:bg-surface-hover/30'
                          }`}
                        >
                          <div className={`w-2 h-2 rounded-full ${
                            bp.enabled ? 'bg-red-500' : 'bg-border'
                          }`} />
                          <span className="font-mono text-text-secondary">Ln {bp.line}</span>
                          {bp.condition && (
                            <span className="text-[10px] text-text-muted">if {bp.condition}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between px-3 py-1 border-t border-border/40 text-[10px] text-text-muted/70 font-mono">
        <span>{isZh ? `${breakpoints.length} 个断点` : `${breakpoints.length} breakpoints`}</span>
        <span>{isRunning ? (isZh ? '运行中' : 'Running') : (isZh ? '已停止' : 'Stopped')}</span>
      </div>
    </div>
  )
}

export default DockDebugPanel
