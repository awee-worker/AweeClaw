/**
 * DeployHistoryList - 部署历史记录列表
 *
 * 展示项目的历史部署记录，支持展开查看详情。
 */
import type React from 'react'
import { useState, useEffect, useCallback } from 'react'
import { ChevronRight, ExternalLink, Clock, Loader2, CheckCircle2, XCircle, Circle } from 'lucide-react'
import { useI18n } from '@renderer/i18n'
import { previewService } from '../../services/PreviewService'
import type { DeployRecord, DeployStatus } from '../../services/PreviewService'

interface DeployHistoryListProps {
  projectId: string
  refreshKey?: number
}

const STATUS_ICONS: Record<DeployStatus, React.ComponentType<{ className?: string }>> = {
  pending: Circle,
  building: Loader2,
  deploying: Loader2,
  success: CheckCircle2,
  failed: XCircle,
  cancelled: XCircle,
}

const STATUS_COLORS: Record<DeployStatus, string> = {
  pending: 'text-muted-foreground',
  building: 'text-blue-500',
  deploying: 'text-orange-500',
  success: 'text-emerald-500',
  failed: 'text-red-500',
  cancelled: 'text-orange-500',
}

const DeployHistoryList: React.FC<DeployHistoryListProps> = ({
  projectId,
  refreshKey,
}) => {
  const { t } = useI18n()
  const [records, setRecords] = useState<DeployRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const loadRecords = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await previewService.getDeployHistory(projectId)
      setRecords(result)
    } catch (err) {
      setError(t('studio.deploy.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    loadRecords()
  }, [loadRecords, refreshKey])

  const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
    return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
  }

  const formatTime = (iso: string): string => {
    try {
      return new Date(iso).toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    } catch { return iso }
  }

  return (
    <div className="space-y-1.5">
      <label className="text-[10px] font-medium text-muted-foreground">
        {t('studio.deploy.history')}
      </label>

      {loading && records.length === 0 ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="text-[10px] text-red-500">{error}</div>
      ) : records.length === 0 ? (
        <p className="text-[10px] text-muted-foreground py-2">{t('studio.deploy.noDeployments')}</p>
      ) : (
        <div className="divide-y divide-border/50 border border-border rounded-md overflow-hidden">
          {records.map(record => {
            const StatusIcon = STATUS_ICONS[record.status] ?? Circle
            const statusColor = STATUS_COLORS[record.status] ?? 'text-muted-foreground'
            const isExpanded = expandedId === record.id

            return (
              <div key={record.id}>
                <button
                  onClick={() => setExpandedId(isExpanded ? null : record.id)}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-muted/20 transition-colors text-left"
                >
                  <ChevronRight
                    className={`w-3 h-3 text-muted-foreground transition-transform flex-shrink-0 ${
                      isExpanded ? 'rotate-90' : ''
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-medium capitalize">{record.target}</span>
                      <StatusIcon className={`w-3 h-3 ${statusColor} ${record.status === 'building' || record.status === 'deploying' ? 'animate-spin' : ''}`} />
                      <span className={`text-[9px] ${statusColor}`}>{t(`studio.deploy.status.${record.status}`)}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[9px] text-muted-foreground flex items-center gap-0.5">
                        <Clock className="w-2.5 h-2.5" />
                        {formatTime(record.startedAt)}
                      </span>
                      {record.durationMs > 0 && (
                        <span className="text-[9px] text-muted-foreground">
                          {formatDuration(record.durationMs)}
                        </span>
                      )}
                    </div>
                  </div>
                  {record.url && (
                    <a
                      href={record.url}
                      target="_blank"
                      rel="noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="p-1 rounded hover:bg-muted text-muted-foreground"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </button>

                {/* 展开详情 */}
                {isExpanded && (
                  <div className="px-6 py-2 bg-muted/10 text-[10px] text-muted-foreground space-y-1">
                    <div className="grid grid-cols-2 gap-1">
                      <div>
                        <span className="text-muted-foreground/60">{t('studio.deploy.detail.id')}:</span>{' '}
                        <span className="font-mono">{record.id}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground/60">{t('studio.deploy.detail.status')}:</span>{' '}
                        <span className={statusColor}>{t(`studio.deploy.status.${record.status}`)}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground/60">{t('studio.deploy.detail.started')}:</span>{' '}
                        <span>{formatTime(record.startedAt)}</span>
                      </div>
                      {record.finishedAt && (
                        <div>
                          <span className="text-muted-foreground/60">{t('studio.deploy.detail.finished')}:</span>{' '}
                          <span>{formatTime(record.finishedAt)}</span>
                        </div>
                      )}
                    </div>
                    {record.url && (
                      <div>
                        <span className="text-muted-foreground/60">{t('studio.deploy.detail.url')}:</span>{' '}
                        <a href={record.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                          {record.url}
                        </a>
                      </div>
                    )}
                    {record.config.env && Object.keys(record.config.env).length > 0 && (
                      <div>
                        <span className="text-muted-foreground/60">{t('studio.deploy.detail.env')}:</span>{' '}
                        <span className="font-mono">{JSON.stringify(record.config.env)}</span>
                      </div>
                    )}
                    {record.log && (
                      <div className="mt-1">
                        <span className="text-muted-foreground/60">{t('studio.deploy.detail.log')}:</span>
                        <pre className="mt-0.5 p-1.5 rounded bg-muted/30 text-[9px] font-mono whitespace-pre-wrap max-h-32 overflow-auto">
                          {record.log}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default DeployHistoryList