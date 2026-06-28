/**
 * 安装面板
 *
 * 将构建好的场景安装到本地客户端。
 */
import { useState, useEffect, useCallback } from 'react'
import type React from 'react'
import { installService, buildService } from '../../services'
import type { InstallRecord } from '../../types'
import { useI18n } from '@renderer/i18n'
import { useSelectedProject } from '../../hooks/useSelectedProject'

const InstallPanel: React.FC = () => {
  const { t } = useI18n()
  const { project: selectedProject, refresh: refreshProject } = useSelectedProject()
  const selectedProjectId = selectedProject?.id ?? null
  const [records, setRecords] = useState<InstallRecord[]>([])
  const [installing, setInstalling] = useState(false)
  const [packagePath, setPackagePath] = useState('')

  // 自动从最近成功的 pack 记录中解析出 packagePath
  useEffect(() => {
    if (!selectedProjectId) {
      setPackagePath('')
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const path = await buildService.getPackagePath(selectedProjectId)
        if (!cancelled && path) setPackagePath(path)
      } catch (err) {
        console.warn('[InstallPanel] getPackagePath failed:', err)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selectedProjectId])

  const loadHistory = useCallback(async () => {
    if (!selectedProjectId) {
      setRecords([])
      return
    }
    try {
      const list = await installService.getInstallHistory(selectedProjectId)
      setRecords(list)
    } catch (err) {
      console.error('Failed to load install history:', err)
    }
  }, [selectedProjectId])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  const handleInstall = useCallback(async () => {
    if (!selectedProjectId || !selectedProject || !packagePath.trim()) return
    setInstalling(true)
    try {
      await installService.installScenario(
        selectedProjectId,
        selectedProject.version,
        packagePath,
      )
      await loadHistory()
      await refreshProject()
    } catch (err) {
      console.error('Install failed:', err)
    } finally {
      setInstalling(false)
    }
  }, [selectedProjectId, selectedProject, packagePath, loadHistory, refreshProject])

  const handleUninstall = useCallback(
    async (scenarioId: string) => {
      setInstalling(true)
      try {
        await installService.uninstallScenario(scenarioId)
        await loadHistory()
        await refreshProject()
      } catch (err) {
        console.error('Uninstall failed:', err)
      } finally {
        setInstalling(false)
      }
    },
    [loadHistory, refreshProject],
  )

  const statusColors: Record<string, string> = {
    installed: 'text-emerald-500',
    failed: 'text-destructive',
    installing: 'text-yellow-500',
    pending: 'text-muted-foreground',
    uninstalled: 'text-muted-foreground',
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border p-3">
        <h2 className="text-sm font-medium">{t('builder.install.title')}</h2>
      </div>

      {/* 安装操作 */}
      <div className="border-b border-border p-3">
        <label className="mb-1 block text-xs text-muted-foreground">{t('builder.install.packagePath')}</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={packagePath}
            onChange={(e) => setPackagePath(e.target.value)}
            placeholder={t('builder.install.selectPackage')}
            className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs font-mono"
          />
          <button
            onClick={handleInstall}
            disabled={installing || !packagePath.trim() || !selectedProjectId}
            className="rounded bg-accent px-3 py-1 text-xs text-accent-foreground hover:bg-accent/90 disabled:opacity-50"
          >
            {installing ? t('builder.install.installing') : t('builder.install.install')}
          </button>
        </div>
        {!selectedProjectId && (
          <div className="mt-2 text-[10px] text-muted-foreground">请先在项目列表中选择一个项目</div>
        )}
      </div>

      {/* 安装历史 */}
      <div className="flex-1 overflow-y-auto">
        {records.length === 0 ? (
          <div className="p-4 text-center text-xs text-muted-foreground">{t('builder.install.empty')}</div>
        ) : (
          <ul className="divide-y divide-border">
            {records.map((record) => (
              <li key={record.id} className="p-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">v{record.version}</span>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs ${statusColors[record.status]}`}>
                      {t(`builder.install.${record.status === 'installed' ? 'installed' : record.status === 'failed' ? 'failed' : 'installing'}`)}
                    </span>
                    {record.status === 'installed' && record.scenarioId && (
                      <button
                        onClick={() => handleUninstall(record.scenarioId!)}
                        disabled={installing}
                        className="text-[10px] text-destructive hover:underline disabled:opacity-50"
                      >
                        卸载
                      </button>
                    )}
                  </div>
                </div>
                <div className="mt-1 truncate text-[10px] text-muted-foreground">{record.packagePath}</div>
                {record.error && <div className="mt-1 text-[10px] text-destructive">{record.error}</div>}
                <div className="mt-1 text-[10px] text-muted-foreground">{record.installedAt}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

export default InstallPanel
