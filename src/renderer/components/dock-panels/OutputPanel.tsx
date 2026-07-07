/**
 * 输出面板（Output Panel）
 */
import { useMemo } from 'react'
import type React from 'react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import {
  CheckCircle2, XCircle, AlertCircle, Info,
  FileCode, Terminal,
} from 'lucide-react'
import { useDiagnosticsStore } from '@services/diagnosticRepository'
import { t } from '@renderer/i18n'

interface LogItem {
  id: string
  timestamp: Date
  type: 'tool' | 'command' | 'log'
  level: 'info' | 'success' | 'error' | 'warning'
  source: string
  message: string
  details?: string
}

const OutputPanel: React.FC = () => {
  const { language } = useStore(useShallow(s => ({ language: s.language })))
  const toolCallLogs = useStore(s => s.toolCallLogs)
  const diagnostics = useDiagnosticsStore(s => s.diagnostics)

  const logs: LogItem[] = useMemo(() => {
    const items: LogItem[] = []

    toolCallLogs.forEach(log => {
      const level = log.success === false ? 'error' : log.success === true ? 'success' : 'info'
      items.push({
        id: log.id,
        timestamp: log.timestamp,
        type: 'tool',
        level,
        source: log.toolName,
        message: log.type === 'request' ? `${log.toolName} executing...` : (log.error || `${log.toolName} completed`),
        details: log.duration != null ? `${log.duration.toFixed(0)}ms` : undefined,
      })
    })

    diagnostics.forEach((diags, uri) => {
      diags.forEach(diag => {
        let level: LogItem['level'] = 'info'
        if (diag.severity === 1) level = 'error'
        else if (diag.severity === 2) level = 'warning'
        items.push({
          id: `${uri}-${diag.range.start.line}-${diag.range.start.character}`,
          timestamp: new Date(),
          type: 'log',
          level,
          source: diag.source || 'Diagnostics',
          message: diag.message,
          details: `${uri}:${diag.range.start.line + 1}:${diag.range.start.character + 1}`,
        })
      })
    })

    return items.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
  }, [toolCallLogs, diagnostics])

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  const getLevelIcon = (level: LogItem['level']) => {
    switch (level) {
      case 'success': return <CheckCircle2 className="w-3 h-3 text-emerald-400" />
      case 'error': return <XCircle className="w-3 h-3 text-red-400" />
      case 'warning': return <AlertCircle className="w-3 h-3 text-amber-400" />
      default: return <Info className="w-3 h-3 text-text-muted" />
    }
  }

  const getTypeIcon = (type: LogItem['type']) => {
    switch (type) {
      case 'tool': return <FileCode className="w-3 h-3 text-blue-400" />
      case 'command': return <Terminal className="w-3 h-3 text-green-400" />
      default: return <Info className="w-3 h-3 text-text-muted" />
    }
  }

  if (logs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-muted px-6 py-8">
        <div className="w-12 h-12 rounded-2xl bg-surface/40 border border-border/40 flex items-center justify-center mb-3">
          <Terminal className="w-6 h-6 text-text-muted/50" strokeWidth={1.5} />
        </div>
        <p className="text-sm font-medium text-text-primary">{t('output.noOutput', language)}</p>
        <p className="text-xs text-text-muted mt-1 text-center leading-relaxed">{t('output.noOutputDescription', language)}</p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-background-editor">
      <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
        {logs.map((log) => (
          <div key={log.id} className="flex items-start gap-2 px-2 py-1 rounded-md hover:bg-surface-hover/30 transition-colors group">
            <span className="text-[10px] font-mono text-text-muted/60 flex-shrink-0 mt-0.5">{formatTime(log.timestamp)}</span>
            <span className="flex-shrink-0 mt-0.5">{getTypeIcon(log.type)}</span>
            <span className="flex-shrink-0 mt-0.5">{getLevelIcon(log.level)}</span>
            <span className="text-xs font-medium text-text-secondary flex-shrink-0 min-w-[80px]">{log.source}</span>
            <span className={`text-xs flex-1 break-all ${log.level === 'error' ? 'text-red-400' : log.level === 'warning' ? 'text-amber-400' : 'text-text-secondary'}`}>
              {log.message}
            </span>
            {log.details && (
              <span className="text-[10px] font-mono text-text-muted/60 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                {log.details}
              </span>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between px-3 py-1 border-t border-border/40 text-[10px] text-text-muted/70 font-mono">
        <span>{logs.length} output items</span>
        <span>Live</span>
      </div>
    </div>
  )
}

export default OutputPanel
