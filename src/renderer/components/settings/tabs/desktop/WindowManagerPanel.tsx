/**
 * 窗口控制面板
 * 列出系统所有可见窗口，支持聚焦、最小化、最大化、还原、关闭、置顶
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Search, RefreshCw, Minimize2, Maximize2, X, Focus, BringToFront, ShieldAlert, ExternalLink, AppWindow } from 'lucide-react'
import { type Language, t } from '@renderer/i18n'
import { ActionButton } from '@components/ui'
import { api } from '@renderer/adapters/electronBridge'
import { logger } from '@renderer/toolkit/LogEngine'

/** 窗口信息（与后端 types/actions.ts 的 WindowInfo 对齐） */
interface WindowInfo {
  id: string
  title: string
  appName: string
  bounds: { x: number; y: number; width: number; height: number }
  isFocused: boolean
  isMinimized: boolean
  isMaximized: boolean
  pid: number
}

interface WindowManagerPanelProps {
  language: Language
}

export function WindowManagerPanel({ language }: WindowManagerPanelProps) {
  const [windows, setWindows] = useState<WindowInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [actionTarget, setActionTarget] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [actionResults, setActionResults] = useState<Record<string, { success: boolean; error?: string }>>({})

  const loadWindows = useCallback(async () => {
    setLoading(true)
    setErrorMsg(null)
    try {
      const result = await window.electronAPI.desktopListWindows() as
        { success: boolean; data?: WindowInfo[]; error?: string; code?: string }
      if (result.success) {
        setWindows(result.data || [])
      } else {
        const msg = result.error || 'Failed to list windows'
        setWindows([])
        setErrorMsg(msg)
        logger.desktop?.error?.('[WindowManagerPanel] loadWindows failed:', msg)
      }
    } catch (err) {
      const msg = (err as Error).message || 'Unknown error'
      setWindows([])
      setErrorMsg(msg)
      logger.desktop?.error?.('[WindowManagerPanel] loadWindows error:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  /** 打开系统辅助功能设置（macOS） */
  const handleOpenAccessibilitySettings = useCallback(async () => {
    try {
      await api.desktop.accessibility.openPreferences('accessibility')
    } catch (err) {
      logger.desktop?.error?.('[WindowManagerPanel] openPreferences failed:', err)
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
        w.appName.toLowerCase().includes(lower) ||
        w.id.toLowerCase().includes(lower),
    )
  }, [windows, searchQuery])

  const performAction = useCallback(
    async (windowId: string, action: 'focus' | 'minimize' | 'maximize' | 'restore' | 'close' | 'bringToFront') => {
      const actionKey = `${windowId}:${action}`
      setActionTarget(actionKey)
      try {
        const electronAPI = window.electronAPI
        // bridge 层返回 { success: true, data: WindowOperationResult }
        // WindowOperationResult: { success: boolean, error?: string, ... }
        let ipcResult: { success: boolean; data?: { success: boolean; error?: string } }
        switch (action) {
          case 'focus':
            ipcResult = await electronAPI.desktopFocusWindow(windowId)
            break
          case 'minimize':
            ipcResult = await electronAPI.desktopMinimizeWindow(windowId)
            break
          case 'maximize':
            ipcResult = await electronAPI.desktopMaximizeWindow(windowId)
            break
          case 'restore':
            ipcResult = await electronAPI.desktopRestoreWindow(windowId)
            break
          case 'close':
            ipcResult = await electronAPI.desktopCloseWindow(windowId)
            break
          case 'bringToFront':
            ipcResult = await electronAPI.desktopBringWindowToFront(windowId)
            break
        }
        // 提取实际操作结果
        const result = {
          success: ipcResult.data?.success ?? ipcResult.success,
          error: ipcResult.data?.error,
        }
        // 记录操作结果（用于卡片内联提示）
        setActionResults(prev => ({
          ...prev,
          [actionKey]: { success: result.success, error: (result as { error?: string }).error },
        }))
        // 3 秒后清除结果
        setTimeout(() => {
          setActionResults(prev => {
            const next = { ...prev }
            delete next[actionKey]
            return next
          })
        }, 3000)

        if (!result.success) {
          logger.desktop?.warn?.(`[WindowManagerPanel] ${action} failed:`, result)
        }
        // 操作后刷新
        await loadWindows()
      } catch (err) {
        logger.desktop?.error?.(`[WindowManagerPanel] ${action} error:`, err)
        setActionResults(prev => ({
          ...prev,
          [actionKey]: { success: false, error: (err as Error).message },
        }))
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

      {/* 权限/错误提示 */}
      {errorMsg && (
        <div className="flex items-start gap-3 p-3 rounded-xl border border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400">
          <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0 space-y-2">
            <p className="text-sm font-medium">{errorMsg}</p>
            <p className="text-xs opacity-80">
              {t('desktop.windowPermissionTip', language) ||
                '提示：窗口列表读取依赖 macOS 辅助功能与自动化权限，请先在「权限状态」标签页中授权后重试。'}
            </p>
          </div>
          <button
            onClick={() => void handleOpenAccessibilitySettings()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition-colors shrink-0 whitespace-nowrap"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>{t('desktop.permission.openPreferences', language) || '打开系统设置'}</span>
          </button>
        </div>
      )}

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
              {/* 标题行：图标+标题+应用名 在左，关闭按钮在右 */}
              <div className="flex items-start gap-2 mb-2.5">
                <div className="w-8 h-8 rounded-md bg-accent/10 flex items-center justify-center shrink-0">
                  <AppWindow className="w-4 h-4 text-accent" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-text-primary truncate" title={win.title}>
                    {win.title || (t('desktop.untitledWindow', language) || '无标题窗口')}
                  </div>
                  {/* 应用名：有值才显示，空值不显示 */}
                  {win.appName && (
                    <div className="text-xs text-text-muted truncate mt-0.5">
                      {win.appName}
                      {win.bounds.width > 0 && (
                        <span className="opacity-60"> · {win.bounds.width}×{win.bounds.height}</span>
                      )}
                    </div>
                  )}
                </div>
                {/* 状态标签 */}
                <div className="flex flex-col gap-1 items-end shrink-0">
                  {win.isFocused && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/10 text-emerald-600 font-medium whitespace-nowrap">
                      {t('desktop.focused', language) || '聚焦'}
                    </span>
                  )}
                  {win.isMinimized && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-500/10 text-amber-600 font-medium whitespace-nowrap">
                      {t('desktop.minimized', language) || '最小化'}
                    </span>
                  )}
                </div>
                {/* 关闭按钮放右上角 */}
                <button
                  onClick={() => handleClose(win.id, win.title)}
                  disabled={isBusy}
                  title={t('desktop.close', language) || '关闭'}
                  className="flex items-center justify-center w-6 h-6 rounded-md bg-red-500/10 text-red-600 hover:bg-red-500/20 disabled:opacity-50 transition-colors shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* 操作按钮区 */}
              <div className="flex items-center gap-1 flex-wrap">
                <button
                  onClick={() => void performAction(win.id, 'focus')}
                  disabled={isBusy}
                  title={t('desktop.focus', language) || '聚焦'}
                  className="flex items-center gap-1 px-2 py-1 rounded-md bg-accent/10 text-accent hover:bg-accent/20 text-xs font-medium disabled:opacity-50 transition-colors"
                >
                  <Focus className="w-3 h-3" />
                  <span>{t('desktop.focus', language) || '聚焦'}</span>
                </button>
                <button
                  onClick={() => void performAction(win.id, 'minimize')}
                  disabled={isBusy}
                  title={t('desktop.minimize', language) || '最小化'}
                  className="flex items-center gap-1 px-2 py-1 rounded-md bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 text-xs font-medium disabled:opacity-50 transition-colors"
                >
                  <Minimize2 className="w-3 h-3" />
                  <span>{t('desktop.minimize', language) || '最小化'}</span>
                </button>
                <button
                  onClick={() => void performAction(win.id, 'maximize')}
                  disabled={isBusy}
                  title={t('desktop.maximize', language) || '最大化'}
                  className="flex items-center gap-1 px-2 py-1 rounded-md bg-blue-500/10 text-blue-600 hover:bg-blue-500/20 text-xs font-medium disabled:opacity-50 transition-colors"
                >
                  <Maximize2 className="w-3 h-3" />
                  <span>{t('desktop.maximize', language) || '最大化'}</span>
                </button>
                <button
                  onClick={() => void performAction(win.id, 'restore')}
                  disabled={isBusy}
                  title={t('desktop.restore', language) || '还原'}
                  className="flex items-center gap-1 px-2 py-1 rounded-md bg-surface-hover text-text-secondary hover:bg-surface-hover/80 text-xs font-medium disabled:opacity-50 transition-colors"
                >
                  <span>{t('desktop.restore', language) || '还原'}</span>
                </button>
                <button
                  onClick={() => void performAction(win.id, 'bringToFront')}
                  disabled={isBusy}
                  title={t('desktop.bringToFront', language) || '置顶'}
                  className="flex items-center gap-1 px-2 py-1 rounded-md bg-purple-500/10 text-purple-600 hover:bg-purple-500/20 text-xs font-medium disabled:opacity-50 transition-colors"
                >
                  <BringToFront className="w-3 h-3" />
                  <span>{t('desktop.bringToFront', language) || '置顶'}</span>
                </button>
              </div>

              {/* 操作结果内联提示 */}
              {actionKey && (() => {
                // 查找当前窗口任何失败的操作
                const failedAction = Object.entries(actionResults).find(
                  ([key, val]) => key.startsWith(actionKey) && !val.success,
                )
                if (!failedAction) return null
                const [, val] = failedAction
                return (
                  <div className="mt-2 text-[10px] text-red-500">
                    {val.error || '操作失败'}
                  </div>
                )
              })()}
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
