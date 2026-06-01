/**
 * 工具调用日志内容组件
 * 包含日志列表和统计视图
 */

import { useState, useMemo } from 'react'
import {
  Trash2,
  Download,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  BarChart3,
  List,
  AlertTriangle,
  Clock,
  Zap,
} from 'lucide-react'
import { ActionButton } from '../ui'
import { JsonHighlight } from '@utils/jsonHighlight'
import { useStore } from '@store'
import { useAgentStore } from '@intelligence/state/IntelligenceStore'
import { useShallow } from 'zustand/react/shallow'
import { t, type Language } from '@renderer/i18n'

interface ToolCallLogContentProps {
  language?: 'en' | 'zh'
}

type ViewMode = 'logs' | 'stats'

export default function ToolCallLogContent({ language = 'zh' }: ToolCallLogContentProps) {
  const { toolCallLogs: logs, clearToolCallLogs, getToolStats, getPerformanceInsights } = useStore(useShallow(s => ({ toolCallLogs: s.toolCallLogs, clearToolCallLogs: s.clearToolCallLogs, getToolStats: s.getToolStats, getPerformanceInsights: s.getPerformanceInsights })))
  const currentThreadId = useAgentStore(state => state.currentThreadId)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState<'all' | 'request' | 'response'>('all')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('logs')

  const threadLogs = useMemo(
    () => currentThreadId ? logs.filter(log => log.threadId === currentThreadId) : [],
    [currentThreadId, logs]
  )
  const stats = useMemo(() => getToolStats(currentThreadId || undefined), [currentThreadId, getToolStats, logs])
  const insights = useMemo(() => getPerformanceInsights(currentThreadId || undefined), [currentThreadId, getPerformanceInsights, logs])

  const toggleExpand = (id: string) => {
    const newExpanded = new Set(expandedIds)
    if (newExpanded.has(id)) {
      newExpanded.delete(id)
    } else {
      newExpanded.add(id)
    }
    setExpandedIds(newExpanded)
  }

  const handleCopy = async (id: string, data: unknown) => {
    await navigator.clipboard.writeText(JSON.stringify(data, null, 2))
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const handleExport = () => {
    const exportData = { threadId: currentThreadId, logs: threadLogs, stats, insights, exportedAt: new Date().toISOString() }
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `tool-logs-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const filteredLogs = filter === 'all' ? threadLogs : threadLogs.filter((log) => log.type === filter)
  return (
    <div className="h-full flex flex-col">
      {/* 工具栏 */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border-subtle bg-surface/30">
        {/* 视图切换 */}
        <div className="flex bg-surface/50 rounded p-0.5">
          <button
            onClick={() => setViewMode('logs')}
            className={`px-1.5 py-0.5 text-[11px] rounded transition-colors ${
              viewMode === 'logs' ? 'bg-accent/20 text-accent' : 'text-text-muted hover:text-text-primary'
            }`}
            title={t('app.logs', language as Language)}
          >
            <List className="w-3 h-3" />
          </button>
          <button
            onClick={() => setViewMode('stats')}
            className={`px-1.5 py-0.5 text-[11px] rounded transition-colors ${
              viewMode === 'stats' ? 'bg-accent/20 text-accent' : 'text-text-muted hover:text-text-primary'
            }`}
            title={t('app.stats', language as Language)}
          >
            <BarChart3 className="w-3 h-3" />
          </button>
        </div>

        {viewMode === 'logs' && (
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as 'all' | 'request' | 'response')}
            className="px-1.5 py-0.5 text-[11px] bg-surface border border-border-subtle rounded text-text-secondary outline-none focus:border-accent/50"
          >
            <option value="all">{t('app.all', language as Language)}</option>
            <option value="request">{t('app.req', language as Language)}</option>
            <option value="response">{t('app.res', language as Language)}</option>
          </select>
        )}

        <div className="flex-1" />

        <ActionButton variant="ghost" size="sm" onClick={handleExport}
          className="h-6 px-1.5 text-[11px] gap-1 text-text-muted hover:text-text-primary" title={t('app.export', language as Language)}>
          <Download className="w-3 h-3" />
        </ActionButton>
        <ActionButton variant="ghost" size="sm" onClick={() => clearToolCallLogs(currentThreadId || undefined)}
          className="h-6 px-1.5 text-[11px] gap-1 text-text-muted hover:text-red-400 hover:bg-red-500/10" title={t('app.clear', language as Language)}>
          <Trash2 className="w-3 h-3" />
        </ActionButton>
      </div>

      {/* 内容区域 */}
      <div className="flex-1 overflow-auto">
        {viewMode === 'logs' ? (
          <LogsView logs={filteredLogs} expandedIds={expandedIds} toggleExpand={toggleExpand}
            handleCopy={handleCopy} copiedId={copiedId} language={language} />
        ) : (
          <StatsView stats={stats} insights={insights} language={language} />
        )}
      </div>
    </div>
  )
}

// 日志列表视图
function LogsView({ logs, expandedIds, toggleExpand, handleCopy, copiedId, language }: {
  logs: import('@store/slices/logSlice').ToolCallLogEntry[]
  expandedIds: Set<string>
  toggleExpand: (id: string) => void
  handleCopy: (id: string, data: unknown) => void
  copiedId: string | null
  language?: string
}) {
  const t = (zh: string, en: string) => (language === 'zh' ? zh : en)

  if (logs.length === 0) {
    return <div className="flex items-center justify-center h-full text-text-muted text-xs">{t('app.nologs', language as Language)}</div>
  }

  return (
    <div className="divide-y divide-border-subtle">
      {logs.map((log) => (
        <div key={log.id}>
          <button onClick={() => toggleExpand(log.id)}
            className="w-full flex items-center gap-1.5 px-2 py-1.5 hover:bg-surface/50 text-left">
            {expandedIds.has(log.id) ? <ChevronDown className="w-3 h-3 text-text-muted" /> : <ChevronRight className="w-3 h-3 text-text-muted" />}
            <span className={`px-1 py-0.5 text-[10px] rounded font-medium ${log.type === 'request' ? 'bg-blue-500/20 text-blue-400' : 'bg-green-500/20 text-green-400'}`}>
              {log.type === 'request' ? 'REQ' : 'RES'}
            </span>
            <span className="text-[11px] font-medium text-text-primary truncate flex-1">{log.toolName}</span>
            {log.success === false && <AlertTriangle className="w-3 h-3 text-red-400" />}
            {log.duration && <span className="text-[10px] text-text-muted">{log.duration}ms</span>}
          </button>

          {expandedIds.has(log.id) && (
            <div className="relative px-2 pb-2">
              <button onClick={() => handleCopy(log.id, log.data)} className="absolute top-1 right-2 p-0.5 hover:bg-surface rounded">
                {copiedId === log.id ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3 text-text-muted" />}
              </button>
              <div className="bg-surface/50 rounded p-1.5 overflow-auto max-h-32">
                <JsonHighlight data={log.data} maxHeight="max-h-28" />
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// 统计视图
function StatsView({ stats, insights, language }: {
  stats: import('@store/slices/logSlice').ToolStats[]
  insights: import('@store/slices/logSlice').PerformanceInsight[]
  language?: string
}) {
  const t = (zh: string, en: string) => (language === 'zh' ? zh : en)

  if (stats.length === 0) {
    return <div className="flex items-center justify-center h-full text-text-muted text-xs">{t('app.nostatistics', language as Language)}</div>
  }

  return (
    <div className="p-2 space-y-3">
      {/* 性能洞察 */}
      {insights.length > 0 && (
        <div className="space-y-1">
          <div className="text-[11px] font-medium text-text-muted uppercase tracking-wide">{t('app.insights', language as Language)}</div>
          <div className="space-y-1">
            {insights.slice(0, 3).map((insight, i) => (
              <div key={i} className={`flex items-center gap-2 px-2 py-1 rounded text-[11px] ${
                insight.severity === 'critical' ? 'bg-red-500/10 text-red-400' :
                insight.severity === 'warning' ? 'bg-yellow-500/10 text-yellow-400' : 'bg-blue-500/10 text-blue-400'
              }`}>
                {insight.type === 'slow_tool' && <Clock className="w-3 h-3" />}
                {insight.type === 'high_failure' && <AlertTriangle className="w-3 h-3" />}
                {insight.type === 'frequent_tool' && <Zap className="w-3 h-3" />}
                <span className="font-medium">{insight.toolName}</span>
                <span className="text-[10px] opacity-80">{language === 'zh' ? insight.messageZh : insight.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 工具统计表 */}
      <div className="space-y-1">
        <div className="text-[11px] font-medium text-text-muted uppercase tracking-wide">{t('app.toolstats', language as Language)}</div>
        <div className="bg-surface/30 rounded border border-border-subtle overflow-hidden">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="bg-surface/50 text-text-muted">
                <th className="text-left px-2 py-1 font-medium">{t('app.tool', language as Language)}</th>
                <th className="text-right px-2 py-1 font-medium">{t('app.calls', language as Language)}</th>
                <th className="text-right px-2 py-1 font-medium">{t('app.rate', language as Language)}</th>
                <th className="text-right px-2 py-1 font-medium">{t('app.avg', language as Language)}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {stats.slice(0, 8).map((stat) => (
                <tr key={stat.toolName} className="hover:bg-surface/30">
                  <td className="px-2 py-1 text-text-primary truncate max-w-[100px]" title={stat.toolName}>{stat.toolName}</td>
                  <td className="px-2 py-1 text-right text-text-secondary">{stat.totalCalls}</td>
                  <td className="px-2 py-1 text-right">
                    <span className={stat.successRate >= 0.9 ? 'text-green-400' : stat.successRate >= 0.7 ? 'text-yellow-400' : 'text-red-400'}>
                      {Math.round(stat.successRate * 100)}%
                    </span>
                  </td>
                  <td className="px-2 py-1 text-right text-text-muted">{Math.round(stat.avgDuration)}ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
