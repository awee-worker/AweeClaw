/**
 * 发布面板
 *
 * 将场景发布到开发者中心市场。
 */
import { useState, useEffect, useCallback } from 'react'
import type React from 'react'
import { publishService } from '../../services'
import type { PublishRecord } from '../../types'
import { useI18n } from '@renderer/i18n'

const PublishPanel: React.FC = () => {
  const { t } = useI18n()
  const [records, setRecords] = useState<PublishRecord[]>([])
  const [publishing, setPublishing] = useState(false)
  const [loggedIn, setLoggedIn] = useState(false)
  const [packageName, setPackageName] = useState('')
  const [packagePath, setPackagePath] = useState('')
  const [version, setVersion] = useState('1.0.0')

  const checkStatus = useCallback(async () => {
    const status = await publishService.checkPublishStatus()
    setLoggedIn(status.loggedIn)
  }, [])

  const loadHistory = useCallback(async () => {
    try {
      const list = await publishService.getPublishHistory('')
      setRecords(list)
    } catch (err) {
      console.error('Failed to load publish history:', err)
    }
  }, [])

  useEffect(() => {
    checkStatus()
    loadHistory()
  }, [checkStatus, loadHistory])

  const handlePublish = useCallback(async () => {
    if (!loggedIn) return
    if (!packageName.trim() || !packagePath.trim()) return

    setPublishing(true)
    try {
      await publishService.publishScenario('', version, packageName, packagePath)
      await loadHistory()
    } catch (err) {
      console.error('Publish failed:', err)
    } finally {
      setPublishing(false)
    }
  }, [loggedIn, packageName, packagePath, version, loadHistory])

  const statusColors: Record<string, string> = {
    published: 'text-emerald-500',
    failed: 'text-destructive',
    uploading: 'text-yellow-500',
    pending: 'text-muted-foreground',
    rejected: 'text-destructive',
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border p-3">
        <h2 className="text-sm font-medium">{t('builder.publish.title')}</h2>
      </div>

      {/* 登录状态 */}
      <div className="border-b border-border p-3">
        <div className="flex items-center justify-between">
          <span className="text-xs">
            {loggedIn ? (
              <span className="text-emerald-500">✓ {t('builder.publish.checkStatus')}</span>
            ) : (
              <span className="text-destructive">{t('builder.publish.notLoggedIn')}</span>
            )}
          </span>
          <button onClick={checkStatus} className="text-xs text-muted-foreground hover:text-foreground">
            {t('builder.publish.checkStatus')}
          </button>
        </div>
      </div>

      {/* 发布表单 */}
      <div className="border-b border-border p-3 space-y-2">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">{t('builder.publish.packageName')}</label>
          <input
            type="text"
            value={packageName}
            onChange={(e) => setPackageName(e.target.value)}
            className="w-full rounded border border-border bg-background px-2 py-1 text-xs"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">{t('builder.publish.packagePath')}</label>
          <input
            type="text"
            value={packagePath}
            onChange={(e) => setPackagePath(e.target.value)}
            className="w-full rounded border border-border bg-background px-2 py-1 text-xs font-mono"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">{t('builder.publish.version')}</label>
          <input
            type="text"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            className="w-full rounded border border-border bg-background px-2 py-1 text-xs font-mono"
          />
        </div>
        <button
          onClick={handlePublish}
          disabled={!loggedIn || publishing || !packageName.trim() || !packagePath.trim()}
          className="w-full rounded bg-accent px-3 py-1.5 text-xs text-accent-foreground hover:bg-accent/90 disabled:opacity-50"
        >
          {publishing ? t('builder.publish.uploading') : t('builder.publish.publish')}
        </button>
        {!loggedIn && (
          <p className="text-[10px] text-destructive">{t('builder.publish.loginFirst')}</p>
        )}
      </div>

      {/* 发布历史 */}
      <div className="flex-1 overflow-y-auto">
        {records.length === 0 ? (
          <div className="p-4 text-center text-xs text-muted-foreground">{t('builder.publish.empty')}</div>
        ) : (
          <ul className="divide-y divide-border">
            {records.map((record) => (
              <li key={record.id} className="p-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">{record.packageName}</span>
                  <span className={`text-xs ${statusColors[record.status]}`}>
                    {t(`builder.publish.${record.status === 'published' ? 'published' : record.status === 'failed' ? 'failed' : 'uploading'}`)}
                  </span>
                </div>
                <div className="mt-1 text-[10px] text-muted-foreground">v{record.version}</div>
                {record.marketplaceId && (
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    {t('builder.publish.marketplaceId')}: {record.marketplaceId}
                  </div>
                )}
                {record.error && <div className="mt-1 text-[10px] text-destructive">{record.error}</div>}
                <div className="mt-1 text-[10px] text-muted-foreground">{record.publishedAt}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

export default PublishPanel
