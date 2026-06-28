/**
 * 构建面板
 *
 * 提供校验、构建、打包功能，显示构建日志。
 */
import { useState, useEffect, useCallback } from 'react'
import type React from 'react'
import { buildService } from '../../services'
import type { BuildRecord } from '../../types'
import { useI18n } from '@renderer/i18n'
import { useSelectedProject } from '../../hooks/useSelectedProject'

const BuildPanel: React.FC = () => {
  const { t } = useI18n()
  const { project: selectedProject, refresh: refreshProject } = useSelectedProject()
  const selectedProjectId = selectedProject?.id ?? null
  const [records, setRecords] = useState<BuildRecord[]>([])
  const [building, setBuilding] = useState(false)
  const [selectedRecord, setSelectedRecord] = useState<BuildRecord | null>(null)

  const loadHistory = useCallback(async () => {
    if (!selectedProjectId) {
      setRecords([])
      setSelectedRecord(null)
      return
    }
    try {
      const history = await buildService.getBuildHistory(selectedProjectId)
      setRecords(history)
      if (history.length > 0 && !selectedRecord) {
        setSelectedRecord(history[0])
      }
    } catch (err) {
      console.error('Failed to load build history:', err)
    }
  }, [selectedProjectId, selectedRecord])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  const handleBuild = useCallback(
    async (buildType: 'validate' | 'build' | 'pack') => {
      if (!selectedProjectId) return
      setBuilding(true)
      try {
        let record: BuildRecord
        if (buildType === 'validate') {
          record = await buildService.validateProject(selectedProjectId)
        } else if (buildType === 'build') {
          record = await buildService.buildProject(selectedProjectId)
        } else {
          record = await buildService.packProject(selectedProjectId)
        }
        setSelectedRecord(record)
        await loadHistory()
        // 刷新项目状态（status/lastBuiltAt 可能变更）
        await refreshProject()
      } catch (err) {
        console.error('Build failed:', err)
      } finally {
        setBuilding(false)
      }
    },
    [selectedProjectId, loadHistory, refreshProject],
  )

  const statusColors: Record<string, string> = {
    success: 'text-emerald-500',
    failed: 'text-destructive',
    running: 'text-yellow-500',
    pending: 'text-muted-foreground',
    cancelled: 'text-muted-foreground',
  }

  return (
    <div className="flex h-full flex-col">
      {/* 工具栏 */}
      <div className="flex items-center gap-1 border-b border-border p-2">
        <button
          onClick={() => handleBuild('validate')}
          disabled={building || !selectedProjectId}
          className="rounded px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
        >
          {t('builder.toolbar.validate')}
        </button>
        <button
          onClick={() => handleBuild('build')}
          disabled={building || !selectedProjectId}
          className="rounded bg-accent px-2 py-1 text-xs text-accent-foreground hover:bg-accent/90 disabled:opacity-50"
        >
          {t('builder.toolbar.build')}
        </button>
        <button
          onClick={() => handleBuild('pack')}
          disabled={building || !selectedProjectId}
          className="rounded px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
        >
          {t('builder.toolbar.pack')}
        </button>
        <div className="ml-auto">
          {building && <span className="text-xs text-yellow-500">{t('builder.build.running')}</span>}
        </div>
      </div>

      {/* 构建历史 */}
      <div className="flex-1 overflow-y-auto">
        {records.length === 0 ? (
          <div className="p-4 text-center text-xs text-muted-foreground">{t('builder.build.empty')}</div>
        ) : (
          <ul className="divide-y divide-border">
            {records.map((record) => (
              <li
                key={record.id}
                onClick={() => setSelectedRecord(record)}
                className={`cursor-pointer p-2 hover:bg-muted ${
                  selectedRecord?.id === record.id ? 'bg-accent/5' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">{record.buildType}</span>
                  <span className={`text-xs ${statusColors[record.status]}`}>{t(`builder.build.${record.status === 'success' ? 'success' : record.status === 'failed' ? 'failed' : 'running'}`)}</span>
                </div>
                <div className="mt-1 text-[10px] text-muted-foreground">
                  {record.startedAt} · {record.durationMs}ms
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 日志输出 */}
      {selectedRecord && (
        <div className="h-48 border-t border-border">
          <div className="flex items-center justify-between border-b border-border px-2 py-1">
            <span className="text-xs font-medium">{t('builder.build.title')}</span>
            <button
              onClick={() => navigator.clipboard.writeText(selectedRecord.output)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              {t('builder.build.copy')}
            </button>
          </div>
          <pre className="h-32 overflow-auto bg-muted/30 p-2 text-[11px] font-mono">
            {selectedRecord.output || t('builder.build.empty')}
          </pre>
        </div>
      )}
    </div>
  )
}

export default BuildPanel
