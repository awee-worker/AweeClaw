/**
 * 发布面板
 *
 * 将场景发布到开发者中心市场。
 * 集成发布前预检查：critical 项会阻止发布按钮。
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import type React from 'react'
import { publishService, buildService } from '../../services'
import type { PublishRecord } from '../../types'
import type { ChecklistResult } from '../../services'
import { useI18n } from '@renderer/i18n'
import { useSelectedProject } from '../../hooks/useSelectedProject'
import PreChecklistPanel from '../precheck/PreChecklistPanel'

const PublishPanel: React.FC = () => {
  const { t } = useI18n()
  const { project: selectedProject, refresh: refreshProject } = useSelectedProject()
  const selectedProjectId = selectedProject?.id ?? null
  const [records, setRecords] = useState<PublishRecord[]>([])
  const [publishing, setPublishing] = useState(false)
  const [loggedIn, setLoggedIn] = useState(false)
  const [developerName, setDeveloperName] = useState<string | undefined>()
  const [packageName, setPackageName] = useState('')
  const [packagePath, setPackagePath] = useState('')
  const [version, setVersion] = useState('1.0.0')
  // 发布前预检查结果（用于禁用发布按钮）
  const [checkResult, setCheckResult] = useState<ChecklistResult | null>(null)
  // 使用 ref 保存最新结果，避免回调闭包问题
  const checkResultRef = useRef<ChecklistResult | null>(null)

  // 当切换项目时自动填充 packageName / packagePath / version
  useEffect(() => {
    if (!selectedProject) {
      setPackageName('')
      setPackagePath('')
      setVersion('1.0.0')
      return
    }
    setPackageName(selectedProject.scenarioId)
    setVersion(selectedProject.version)
    let cancelled = false
    ;(async () => {
      try {
        const path = await buildService.getPackagePath(selectedProject.id)
        if (!cancelled && path) setPackagePath(path)
      } catch (err) {
        console.warn('[PublishPanel] getPackagePath failed:', err)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selectedProject])

  const checkStatus = useCallback(async () => {
    const status = await publishService.checkPublishStatus()
    setLoggedIn(status.loggedIn)
    setDeveloperName(status.developerName)
  }, [])

  const loadHistory = useCallback(async () => {
    if (!selectedProjectId) {
      setRecords([])
      return
    }
    try {
      const list = await publishService.getPublishHistory(selectedProjectId)
      setRecords(list)
    } catch (err) {
      console.error('Failed to load publish history:', err)
    }
  }, [selectedProjectId])

  useEffect(() => {
    checkStatus()
    loadHistory()
  }, [checkStatus, loadHistory])

  // PreChecklistPanel 结果变化回调
  const handleCheckResultChange = useCallback((r: ChecklistResult | null) => {
    checkResultRef.current = r
    setCheckResult(r)
  }, [])

  const handlePublish = useCallback(async () => {
    if (!loggedIn) return
    if (!selectedProjectId || !packageName.trim() || !packagePath.trim()) return
    // 二次校验：若已运行预检查且有 critical 项，阻止发布
    const current = checkResultRef.current
    if (current && !current.publishable) return

    setPublishing(true)
    try {
      await publishService.publishScenario(selectedProjectId, version, packageName, packagePath)
      await loadHistory()
      await refreshProject()
    } catch (err) {
      console.error('Publish failed:', err)
    } finally {
      setPublishing(false)
    }
  }, [loggedIn, selectedProjectId, packageName, packagePath, version, loadHistory, refreshProject])

  const statusColors: Record<string, string> = {
    published: 'text-emerald-500',
    failed: 'text-destructive',
    uploading: 'text-yellow-500',
    pending: 'text-muted-foreground',
    rejected: 'text-destructive',
  }

  // 发布按钮禁用条件：
  // - 未登录 / 正在发布 / 缺少必填字段 / 已运行预检查且有 critical 项
  const blockedByCheck = checkResult !== null && !checkResult.publishable

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
              <span className="text-emerald-500">
                ✓ {developerName ? `${t('builder.publish.checkStatus')} (${developerName})` : t('builder.publish.checkStatus')}
              </span>
            ) : (
              <span className="text-destructive">{t('builder.publish.notLoggedIn')}</span>
            )}
          </span>
          <button onClick={checkStatus} className="text-xs text-muted-foreground hover:text-foreground">
            {t('builder.publish.checkStatus')}
          </button>
        </div>
      </div>

      {/* 发布前预检查（独立组件） */}
      <div className="border-b border-border">
        <PreChecklistPanel onResultChange={handleCheckResultChange} />
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
          disabled={!loggedIn || publishing || !packageName.trim() || !packagePath.trim() || !selectedProjectId || blockedByCheck}
          className="w-full rounded bg-accent px-3 py-1.5 text-xs text-accent-foreground hover:bg-accent/90 disabled:opacity-50"
        >
          {publishing ? t('builder.publish.uploading') : t('builder.publish.publish')}
        </button>
        {!loggedIn && (
          <p className="text-[12px] text-destructive">{t('builder.publish.loginFirst')}</p>
        )}
        {!selectedProjectId && (
          <p className="text-[12px] text-muted-foreground">请先在项目列表中选择一个项目</p>
        )}
        {blockedByCheck && (
          <p className="text-[12px] text-destructive">{t('builder.precheck.blocked')}</p>
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
                <div className="mt-1 text-[12px] text-muted-foreground">v{record.version}</div>
                {record.marketplaceId && (
                  <div className="mt-1 text-[12px] text-muted-foreground">
                    {t('builder.publish.marketplaceId')}: {record.marketplaceId}
                  </div>
                )}
                {record.error && <div className="mt-1 text-[12px] text-destructive">{record.error}</div>}
                <div className="mt-1 text-[12px] text-muted-foreground">{record.publishedAt}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

export default PublishPanel
