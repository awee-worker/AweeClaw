/**
 * 进程管理面板
 * 列出系统进程，支持搜索、终止
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Search, X, RefreshCw } from 'lucide-react'
import { type Language, t } from '@renderer/i18n'
import { ActionButton } from '@components/ui'
import { logger } from '@renderer/toolkit/LogEngine'

interface ProcessInfo {
  pid: number
  name: string
  cpuUsage: number
  memoryUsage: number
  command?: string
}

interface ProcessManagerPanelProps {
  language: Language
}

/** 字节转 MB */
function formatMemory(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 MB'
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function ProcessManagerPanel({ language }: ProcessManagerPanelProps) {
  const [processes, setProcesses] = useState<ProcessInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState<'cpu' | 'memory' | 'name'>('cpu')
  const [actionPid, setActionPid] = useState<number | null>(null)

  const loadProcesses = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.electronAPI.desktopListProcesses()
      if (result.success) {
        setProcesses(result.data || [])
      }
    } catch (err) {
      logger.desktop?.error?.('[ProcessManagerPanel] loadProcesses failed:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadProcesses()
    // 每 10 秒自动刷新
    const timer = setInterval(() => void loadProcesses(), 10_000)
    return () => clearInterval(timer)
  }, [loadProcesses])

  const filteredAndSorted = useMemo(() => {
    let list = processes
    if (searchQuery.trim()) {
      const lower = searchQuery.toLowerCase()
      list = list.filter(p =>
        p.name.toLowerCase().includes(lower) ||
        String(p.pid).includes(lower) ||
        (p.command || '').toLowerCase().includes(lower),
      )
    }
    return [...list].sort((a, b) => {
      if (sortBy === 'cpu') return b.cpuUsage - a.cpuUsage
      if (sortBy === 'memory') return b.memoryUsage - a.memoryUsage
      return a.name.localeCompare(b.name)
    })
  }, [processes, searchQuery, sortBy])

  const handleKill = useCallback(async (pid: number, name: string) => {
    const confirmed = window.confirm(
      t('desktop.confirmKill', language) || `确定要终止进程 "${name}" (PID: ${pid}) 吗？`,
    )
    if (!confirmed) return

    setActionPid(pid)
    try {
      const result = await window.electronAPI.desktopKillProcess(pid, false)
      if (result.success) {
        // 刷新列表
        await loadProcesses()
      }
    } catch (err) {
      logger.desktop?.error?.('[ProcessManagerPanel] kill failed:', err)
    } finally {
      setActionPid(null)
    }
  }, [language, loadProcesses])

  return (
    <div className="space-y-3">
      {/* 工具栏 */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder={t('desktop.searchProcesses', language) || '搜索进程...'}
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-surface border border-border/60 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50"
          />
        </div>
        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value as 'cpu' | 'memory' | 'name')}
          className="px-3 py-2 rounded-lg bg-surface border border-border/60 text-sm text-text-primary focus:outline-none focus:border-accent/50"
        >
          <option value="cpu">{t('desktop.sortByCpu', language) || 'CPU 排序'}</option>
          <option value="memory">{t('desktop.sortByMemory', language) || '内存排序'}</option>
          <option value="name">{t('desktop.sortByName', language) || '名称排序'}</option>
        </select>
        <ActionButton onClick={() => void loadProcesses()} variant="ghost" size="sm" disabled={loading}>
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </ActionButton>
      </div>

      {/* 进程表格 */}
      <div className="rounded-xl border border-border/40 bg-surface/50 overflow-hidden">
        <div className="grid grid-cols-12 gap-2 px-4 py-2 text-xs font-medium text-text-muted uppercase tracking-wide border-b border-border/40 bg-surface-hover/30">
          <div className="col-span-4">{t('desktop.processName', language) || '进程名称'}</div>
          <div className="col-span-2 text-right">PID</div>
          <div className="col-span-2 text-right">{t('desktop.cpu', language) || 'CPU'}</div>
          <div className="col-span-2 text-right">{t('desktop.memory', language) || '内存'}</div>
          <div className="col-span-2 text-right">{t('common.actions', language) || '操作'}</div>
        </div>

        <div className="max-h-[500px] overflow-y-auto">
          {filteredAndSorted.map(proc => (
            <div
              key={proc.pid}
              className="grid grid-cols-12 gap-2 px-4 py-2 text-sm hover:bg-surface-hover/30 border-b border-border/20 last:border-0"
            >
              <div className="col-span-4 flex items-center min-w-0">
                <span className="text-text-primary truncate" title={proc.command || proc.name}>
                  {proc.name}
                </span>
              </div>
              <div className="col-span-2 text-right text-text-muted font-mono text-xs">
                {proc.pid}
              </div>
              <div className="col-span-2 text-right">
                <span className={`font-mono text-xs ${proc.cpuUsage > 50 ? 'text-red-500' : proc.cpuUsage > 20 ? 'text-amber-500' : 'text-text-muted'}`}>
                  {proc.cpuUsage.toFixed(1)}%
                </span>
              </div>
              <div className="col-span-2 text-right text-text-muted font-mono text-xs">
                {formatMemory(proc.memoryUsage)}
              </div>
              <div className="col-span-2 flex justify-end">
                <button
                  onClick={() => void handleKill(proc.pid, proc.name)}
                  disabled={actionPid === proc.pid}
                  className="px-2 py-1 rounded-md bg-red-500/10 text-red-600 hover:bg-red-500/20 text-xs font-medium disabled:opacity-50"
                >
                  <X className="w-3 h-3 inline" />
                  <span className="ml-1">{t('common.kill', language) || '终止'}</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {filteredAndSorted.length === 0 && !loading && (
        <div className="text-center py-8 text-text-muted text-sm">
          {searchQuery ? (t('desktop.noProcessesFound', language) || '未找到匹配的进程') : (t('desktop.noProcesses', language) || '暂无进程')}
        </div>
      )}

      <div className="text-xs text-text-muted">
        {t('desktop.totalProcesses', language) || '共'} {filteredAndSorted.length} {t('desktop.processes', language) || '个进程'}
      </div>
    </div>
  )
}

export default ProcessManagerPanel
