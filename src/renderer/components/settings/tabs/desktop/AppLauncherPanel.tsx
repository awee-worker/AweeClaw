/**
 * 应用启动器面板
 * 列出已安装应用，支持启动、退出、搜索
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Search, Play, Square, ExternalLink, Folder, RefreshCw } from 'lucide-react'
import { type Language, t } from '@renderer/i18n'
import { ActionButton } from '@components/ui'
import { logger } from '@renderer/toolkit/LogEngine'

interface AppInfo {
  name: string
  bundleId?: string
  executablePath: string
  iconPath?: string
  version?: string
  publisher?: string
  categories?: string[]
}

interface AppLauncherPanelProps {
  language: Language
}

export function AppLauncherPanel({ language }: AppLauncherPanelProps) {
  const [apps, setApps] = useState<AppInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [actionTarget, setActionTarget] = useState<string | null>(null)

  const loadApps = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.electronAPI.desktopListInstalledApps()
      if (result.success) {
        setApps(result.data || [])
      }
    } catch (err) {
      logger.desktop?.error?.('[AppLauncherPanel] loadApps failed:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadApps()
  }, [loadApps])

  const filteredApps = useMemo(() => {
    if (!searchQuery.trim()) return apps
    const lower = searchQuery.toLowerCase()
    return apps.filter(a => a.name.toLowerCase().includes(lower))
  }, [apps, searchQuery])

  const handleLaunch = useCallback(async (name: string) => {
    setActionTarget(name)
    try {
      const result = await window.electronAPI.desktopLaunchApp(name)
      if (!result.success) {
        logger.desktop?.warn?.('[AppLauncherPanel] launch failed:', result)
      }
    } catch (err) {
      logger.desktop?.error?.('[AppLauncherPanel] launch error:', err)
    } finally {
      setActionTarget(null)
    }
  }, [])

  const handleQuit = useCallback(async (name: string) => {
    setActionTarget(name)
    try {
      const result = await window.electronAPI.desktopQuitApp(name)
      if (!result.success) {
        logger.desktop?.warn?.('[AppLauncherPanel] quit failed:', result)
      }
    } catch (err) {
      logger.desktop?.error?.('[AppLauncherPanel] quit error:', err)
    } finally {
      setActionTarget(null)
    }
  }, [])

  const handleOpenUrl = useCallback(async () => {
    const url = window.prompt(t('desktop.enterUrl', language) || '请输入 URL')
    if (!url) return
    try {
      await window.electronAPI.desktopOpenUrl(url)
    } catch (err) {
      logger.desktop?.error?.('[AppLauncherPanel] openUrl error:', err)
    }
  }, [language])

  return (
    <div className="space-y-4">
      {/* 工具栏 */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder={t('desktop.searchApps', language) || '搜索应用...'}
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-surface border border-border/60 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50"
          />
        </div>
        <ActionButton onClick={() => void loadApps()} variant="ghost" size="sm" disabled={loading}>
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </ActionButton>
        <ActionButton onClick={() => void handleOpenUrl()} variant="ghost" size="sm">
          <ExternalLink className="w-4 h-4" />
          <span className="ml-1.5 text-xs">{t('desktop.openUrl', language) || '打开 URL'}</span>
        </ActionButton>
      </div>

      {/* 应用列表 */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {filteredApps.map(app => (
          <div
            key={app.executablePath}
            className="group p-3 rounded-xl border border-border/40 bg-surface/50 hover:bg-surface-hover transition-colors"
          >
            <div className="flex items-start gap-2 mb-2">
              <div className="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
                <Folder className="w-4 h-4 text-accent" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-text-primary truncate" title={app.name}>
                  {app.name}
                </div>
                {app.version && (
                  <div className="text-xs text-text-muted truncate">v{app.version}</div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => void handleLaunch(app.name)}
                disabled={actionTarget === app.name}
                className="flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded-md bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 text-xs font-medium disabled:opacity-50"
              >
                <Play className="w-3 h-3" />
                <span>{t('common.launch', language) || '启动'}</span>
              </button>
              <button
                onClick={() => void handleQuit(app.name)}
                disabled={actionTarget === app.name}
                className="flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded-md bg-red-500/10 text-red-600 hover:bg-red-500/20 text-xs font-medium disabled:opacity-50"
              >
                <Square className="w-3 h-3" />
                <span>{t('common.quit', language) || '退出'}</span>
              </button>
            </div>
          </div>
        ))}
      </div>

      {filteredApps.length === 0 && !loading && (
        <div className="text-center py-12 text-text-muted text-sm">
          {searchQuery ? (t('desktop.noAppsFound', language) || '未找到匹配的应用') : (t('desktop.noApps', language) || '暂无应用')}
        </div>
      )}
    </div>
  )
}

export default AppLauncherPanel
