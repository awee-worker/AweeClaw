import { useState, useEffect, useCallback } from 'react'
import {
  ArrowUpCircle, CheckCircle2, Loader2, RefreshCw,
  X, AlertTriangle, ChevronDown, ChevronUp,
} from 'lucide-react'
import { useStore } from '@store'
import { scenarioRegistry } from '@shared/configuration/scenarios'
import { ActionButton } from '../ui'
import { toast } from '../foundation/NotificationProvider'
import {
  checkScenarioUpdates,
  updateScenarioFromMarketplace,
} from '@services/marketplaceService'
import type { MarketplaceUpdateInfo } from '@scenario-system/marketplace'

interface UpdateItem extends MarketplaceUpdateInfo {
  isUpdating: boolean
  isUpdated: boolean
  error: string | null
}

export function ScenarioUpdatePanel() {
  const language = useStore(s => s.language)
  const isAuthenticated = useStore(s => s.isAuthenticated)
  const [updates, setUpdates] = useState<UpdateItem[]>([])
  const [isChecking, setIsChecking] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null)

  const t = useCallback((zh: string, en: string) => language === 'zh' ? zh : en, [language])

  const doCheckUpdates = useCallback(async () => {
    if (!isAuthenticated) return

    setIsChecking(true)
    try {
      const installedScenarios = scenarioRegistry.getInstalled()
      const checkList = installedScenarios.map(s => ({
        id: s.id,
        version: s.version || '1.0.0',
      }))

      if (checkList.length === 0) {
        setUpdates([])
        setIsChecking(false)
        return
      }

      const results = await checkScenarioUpdates(checkList)

      const items: UpdateItem[] = results.map(r => ({
        ...r,
        isUpdating: false,
        isUpdated: false,
        error: null,
      }))

      setUpdates(items)
      setLastCheckedAt(new Date())
    } catch (err) {
      console.error('[ScenarioUpdatePanel] Check updates failed:', err)
      toast.error(
        t('检查更新失败', 'Failed to check updates'),
        err instanceof Error ? err.message : ''
      )
      setUpdates([])
    } finally {
      setIsChecking(false)
    }
  }, [isAuthenticated, t])

  useEffect(() => {
    if (isAuthenticated) {
      doCheckUpdates()
    }
  }, [isAuthenticated, doCheckUpdates])

  const handleUpdate = async (item: UpdateItem) => {
    setUpdates(prev =>
      prev.map(u => u.scenarioId === item.scenarioId ? { ...u, isUpdating: true, error: null } : u)
    )

    try {
      const result = await updateScenarioFromMarketplace(item.scenarioId, item.latestVersion)

      if (result.success && result.version) {
        setUpdates(prev =>
          prev.map(u =>
            u.scenarioId === item.scenarioId
              ? { ...u, isUpdating: false, isUpdated: true }
              : u
          )
        )

        toast.success(
          t(`场景已更新至 v${result.version}`, `Scenario updated to v${result.version}`)
        )

        setTimeout(() => {
          setUpdates(prev => prev.filter(u => u.scenarioId !== item.scenarioId))
        }, 2000)
      } else {
        setUpdates(prev =>
          prev.map(u =>
            u.scenarioId === item.scenarioId
              ? { ...u, isUpdating: false, error: result.error || t('更新失败', 'Update failed') }
              : u
          )
        )
      }
    } catch (err) {
      setUpdates(prev =>
        prev.map(u =>
          u.scenarioId === item.scenarioId
            ? { ...u, isUpdating: false, error: err instanceof Error ? err.message : String(err) }
            : u
        )
      )
    }
  }

  const handleDismiss = (scenarioId: string) => {
    setUpdates(prev => prev.filter(u => u.scenarioId !== scenarioId))
  }

  if (!isAuthenticated) return null

  const hasUpdates = updates.filter(u => !u.isUpdated).length > 0

  return (
    <div className="border-b border-border/20 bg-gradient-to-r from-blue-500/5 to-violet-500/5" data-scenario-update-panel>
      <div className="px-4 py-2.5 flex items-center justify-between cursor-pointer" onClick={() => hasUpdates && doCheckUpdates()}>
        <div className="flex items-center gap-2">
          <ArrowUpCircle className={`w-4 h-4 ${hasUpdates ? 'text-blue-400' : 'text-text-muted'}`} strokeWidth={1.5} />
          <span className="text-[12px] font-medium text-text-secondary">
            {t('场景更新', 'Scenario Updates')}
            {hasUpdates && (
              <span className="ml-1 text-[11px] font-semibold text-blue-400">
                ({updates.filter(u => !u.isUpdated).length})
              </span>
            )}
          </span>
          {lastCheckedAt && (
            <span className="text-[10px] text-text-muted/60">
              {lastCheckedAt.toLocaleTimeString(language === 'zh' ? 'zh-CN' : 'en-US', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {isChecking ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-text-muted" />
          ) : (
            <RefreshCw className="w-3.5 h-3.5 text-text-muted hover:text-text-primary transition-colors" />
          )}
        </div>
      </div>

      {hasUpdates && (
        <div className="px-4 pb-3 space-y-1.5">
          {updates.filter(u => !u.isUpdated).map(item => {
            const isExpanded = expandedId === item.scenarioId
            const IconComponent = (() => {
              try {
                const icons = require('lucide-react')
                return icons[item.scenarioIcon as keyof typeof icons]
                  ? icons[item.scenarioIcon as keyof typeof icons]
                  : ArrowUpCircle
              } catch {
                return ArrowUpCircle
              }
            })()

            return (
              <div
                key={item.scenarioId}
                className="rounded-lg border border-blue-500/15 bg-surface/40 overflow-hidden"
              >
                <div className="flex items-center gap-2.5 px-3 py-2">
                  <IconComponent className="w-4 h-4 text-blue-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[12px] font-medium text-text-primary truncate">
                        {language === 'zh' ? item.scenarioNameZh : item.scenarioName}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-400 font-mono whitespace-nowrap">
                        {item.currentVersion} → {item.latestVersion}
                      </span>
                    </div>
                    {item.error && (
                      <p className="text-[11px] text-red-400 mt-0.5">{item.error}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    {!item.isUpdated && !item.isUpdating && (
                      <>
                        <ActionButton
                          variant="primary"
                          size="sm"
                          className="h-6 px-2 text-[11px] rounded-md"
                          onClick={(e) => { e.stopPropagation(); handleUpdate(item) }}
                        >
                          <ArrowUpCircle className="w-3 h-3" />
                          {t('更新', 'Update')}
                        </ActionButton>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDismiss(item.scenarioId) }}
                          className="p-1 rounded hover:bg-surface/60 transition-colors"
                        >
                          <X className="w-3 h-3 text-text-muted" />
                        </button>
                      </>
                    )}
                    {item.isUpdating && (
                      <div className="flex items-center gap-1.5 text-blue-400">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span className="text-[11px]">{t('更新中...', 'Updating...')}</span>
                      </div>
                    )}
                    {item.isUpdated && (
                      <div className="flex items-center gap-1 text-green-400">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span className="text-[11px]">{t('已完成', 'Done')}</span>
                      </div>
                    )}
                  </div>

                  {(item.changelog || item.fileSize > 0) && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setExpandedId(isExpanded ? null : item.scenarioId) }}
                      className="p-1 rounded hover:bg-surface/60 transition-colors ml-1"
                    >
                      {isExpanded ? (
                        <ChevronUp className="w-3 h-3 text-text-muted" />
                      ) : (
                        <ChevronDown className="w-3 h-3 text-text-muted" />
                      )}
                    </button>
                  )}
                </div>

                {isExpanded && (
                  <div className="px-3 pb-2.5 pt-0 border-t border-border/10">
                    {item.changelog && (
                      <div className="mt-2">
                        <p className="text-[11px] font-medium text-text-muted mb-1">
                          {t('更新内容', "What's New")}
                        </p>
                        <p className="text-[11px] text-text-secondary leading-relaxed whitespace-pre-wrap">
                          {item.changelog}
                        </p>
                      </div>
                    )}
                    {item.minAppVersion && (
                      <div className="mt-1.5 flex items-center gap-1 text-[11px] text-amber-400/80">
                        <AlertTriangle className="w-3 h-3" />
                        {t(`需要应用版本 ≥ ${item.minAppVersion}`, `Requires app version ≥ ${item.minAppVersion}`)}
                      </div>
                    )}
                    {item.fileSize > 0 && (
                      <p className="text-[10px] text-text-muted mt-1">
                        {t(`包大小: ${(item.fileSize / 1024 / 1024).toFixed(1)} MB`, `Size: ${(item.fileSize / 1024 / 1024).toFixed(1)} MB`)}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {updates.filter(u => !u.isUpdated).length === 0 && lastCheckedAt && (
            <div className="py-3 text-center">
              <CheckCircle2 className="w-6 h-6 text-green-400 mx-auto mb-1.5" />
              <p className="text-[12px] text-text-muted">
                {t('所有场景已是最新版本', 'All scenarios are up to date')}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
