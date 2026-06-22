/**
 * 窗口控制面板
 * 列出系统所有可见窗口，支持聚焦、最小化、最大化、还原、关闭、置顶
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Search, RefreshCw, Minimize2, Maximize2, X, Focus, BringToFront } from 'lucide-react'
import { type Language, t } from '@renderer/i18n'
import { ActionButton } from '@components/ui'
import { logger } from '@renderer/toolkit/LogEngine'

interface WindowInfo {
  id: string
  title: string
  owner: string
  bounds: { x: number; y: number; width: number; height: number }
  focused?: boolean
  minimized?: boolean
  maximized?: boolean
}

interface WindowManagerPanelProps {
  language: Language
}

export function WindowManagerPanel({ language }: WindowManagerPanelProps) {
  const [windows, setWindows] = useState<WindowInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [actionTarget, setActionTarget] = useState<string | null>(null)

  const loadWindows = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.electronAPI.desktopListWindows()
      if (result.success) {
        setWindows(result.data || [])
      }
    } catch (err) {
      logger.desktop?.error?.('[WindowManagerPanel] loadWindows failed:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadWindows()
    const timer = setInterval(() => void loadWindows(), 15_000)
    return () => clearInterval(timer)
  }, [loadWindows])

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return windows
    const lower = searchQuery.toLowerCase()
    return windows.filter(
      w =>
        w.title.toLowerCase().includes(lower) ||
        w.owner.toLowerCase().includes(lower) ||
        w.id.toLowerCase().includes(lower),
    )
  }, [windows, searchQuery])

  const performAction = useCallback(
    async (windowId: string, action: 'focus' | 'minimize' | 'maximize' | 'restore' | 'close' | 'bringToFront') => {
      setActionTarget(`${windowId}:${action}`)
      try {
        const api = window.electronAPI
        let result: { success: boolean }
        switch (action) {
          case 'focus':
            result = await api.desktopFocusWindow(windowId)
            break
          case 'minimize':
            result = await api.desktopMinimizeWindow(windowId)
            break
          case 'maximize':
            result = await api.desktopMaximizeWindow(windowId)
            break
          case 'restore':
            result = await api.desktopRestoreWindow(windowId)
            break
          case 'close':
            result = await api.desktopCloseWindow(windowId)
            break
          case 'bringToFront':
            result = await api.desktopBringWindowToFront(windowId)
            break
        }
        if (!result.success) {
          logger.desktop?.warn?.(`[WindowManagerPanel] ${action} failed:`, result)
        }
        // 操作后刷新
        await loadWindows()
      } catch (err) {
        logger.desktop?.error?.(`[WindowManagerPanel] ${action} error:`, err)
      } finally {
        setActionTarget(null)
      }
    },
    [loadWindows],
  )

  const handleClose = useCallback(
    (windowId: string, title: string) => {
      const confirmed = window.confirm(
        t('desktop.confirmCloseWindow', language) || `确定要关闭窗口 "${title}" 吗？`,
      )
      if (confirmed) {
        void performAction(windowId, 'close')
      }
    },
    [language, performAction],
  )

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
            placeholder={t('desktop.searchWindows', language) || '搜索窗口...'}
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-surface border border-border/60 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50"
          />
        </div>
        <ActionButton onClick={() => void loadWindows()} variant="ghost" size="sm" disabled={loading}>
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </ActionButton>
      </div>

      {/* 窗口列表 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {filtered.map(win => {
          const actionKey = `${win.id}:`
          const isBusy = actionTarget?.startsWith(actionKey) ?? false
          return (
            <div
              key={win.id}
              className="p-3 rounded-xl border border-border/40 bg-surface/50 hover:bg-surface-hover/30 transition-colors"
            >
              <div className="flex items-start gap-2 mb-2">
                <div className="w-8 h-8 rounded-md bg-accent/10 flex items-center justify-center shrink-0">
                  <Focus className="w-3.5 h-3.5 text-accent" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-text-primary truncate" title={win.title}>
                    {win.title || t('desktop.untitledWindow', language) || '无标题窗口'}
                  </div>
                  <div className="text-xs text-text-muted truncate">
                    {win.owner} · {win.bounds.width}×{win.bounds.height}
                  </div>
                </div>
                {win.focused && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/10 text-emerald-600 font-medium">
                    {t('desktop.focused', language) || '聚焦'}
                  </span>
                )}
                {win.minimized && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-500/10 text-amber-600 font-medium">
                    {t('desktop.minimized', language) || '最小化'}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1 flex-wrap">
                <button
                  onClick={() => void performAction(win.id, 'focus')}
                  disabled={isBusy}
                  className="flex items-center gap-1 px-2 py-1 rounded-md bg-accent/10 text-accent hover:bg-accent/20 text-xs font-medium disabled:opacity-50"
                >
                  <Focus className="w-3 h-3" />
                  <span>{t('desktop.focus', language) || '聚焦'}</span>
                </button>
                <button
                  onClick={() => void performAction(win.id, 'minimize')}
                  disabled={isBusy}
                  className="flex items-center gap-1 px-2 py-1 rounded-md bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 text-xs font-medium disabled:opacity-50"
                >
                  <Minimize2 className="w-3 h-3" />
                  <span>{t('desktop.minimize', language) || '最小化'}</span>
                </button>
                <button
                  onClick={() => void performAction(win.id, 'maximize')}
                  disabled={isBusy}
                  className="flex items-center gap-1 px-2 py-1 rounded-md bg-blue-500/10 text-blue-600 hover:bg-blue-500/20 text-xs font-medium disabled:opacity-50"
                >
                  <Maximize2 className="w-3 h-3" />
                  <span>{t('desktop.maximize', language) || '最大化'}</span>
                </button>
                <button
                  onClick={() => void performAction(win.id, 'restore')}
                  disabled={isBusy}
                  className="flex items-center gap-1 px-2 py-1 rounded-md bg-surface-hover text-text-secondary hover:bg-surface-hover/80 text-xs font-medium disabled:opacity-50"
                >
                  <span>{t('desktop.restore', language) || '还原'}</span>
                </button>
                <button
                  onClick={() => void performAction(win.id, 'bringToFront')}
                  disabled={isBusy}
                  className="flex items-center gap-1 px-2 py-1 rounded-md bg-purple-500/10 text-purple-600 hover:bg-purple-500/20 text-xs font-medium disabled:opacity-50"
                >
                  <BringToFront className="w-3 h-3" />
                  <span>{t('desktop.bringToFront', language) || '置顶'}</span>
                </button>
                <button
                  onClick={() => handleClose(win.id, win.title)}
                  disabled={isBusy}
                  className="flex items-center gap-1 px-2 py-1 rounded-md bg-red-500/10 text-red-600 hover:bg-red-500/20 text-xs font-medium disabled:opacity-50"
                >
                  <X className="w-3 h-3" />
                  <span>{t('desktop.close', language) || '关闭'}</span>
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {filtered.length === 0 && !loading && (
        <div className="text-center py-8 text-text-muted text-sm">
          {searchQuery
            ? (t('desktop.noWindowsFound', language) || '未找到匹配的窗口')
            : (t('desktop.noWindows', language) || '暂无窗口')}
        </div>
      )}

      <div className="text-xs text-text-muted">
        {t('desktop.totalWindows', language) || '共'} {filtered.length} {t('desktop.windowsCount', language) || '个窗口'}
      </div>
    </div>
  )
}

export default WindowManagerPanel
