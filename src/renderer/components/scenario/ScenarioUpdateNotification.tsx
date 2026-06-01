import { useState, useEffect, useCallback, useRef } from 'react'
import { ArrowUpCircle, Bell, X } from 'lucide-react'
import { useStore } from '@store'
import { scenarioRegistry } from '@shared/configuration/scenarios'
import { checkScenarioUpdates } from '@services/marketplaceService'
import type { MarketplaceUpdateInfo } from '@scenario-system/marketplace'
import { t, type Language } from '@renderer/i18n'

interface ScenarioUpdateNotificationProps {
  onNavigateToUpdate?: () => void
}

const CHECK_INTERVAL = 30 * 60 * 1000

export function ScenarioUpdateNotification({ onNavigateToUpdate }: ScenarioUpdateNotificationProps) {
  const language = useStore(s => s.language)
  const isAuthenticated = useStore(s => s.isAuthenticated)
  const [availableUpdates, setAvailableUpdates] = useState<MarketplaceUpdateInfo[]>([])
  const [, setIsChecking] = useState(false)
  const [isDismissed, setIsDismissed] = useState(false)
  const [lastChecked, setLastChecked] = useState<number>(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const doCheck = useCallback(async () => {
    if (!isAuthenticated) return

    const now = Date.now()
    if (now - lastChecked < 5 * 60 * 1000) return

    setIsChecking(true)
    try {
      const installedScenarios = scenarioRegistry.getInstalled()
      const checkList = installedScenarios.map(s => ({
        id: s.id,
        version: s.version || '1.0.0',
      }))

      if (checkList.length === 0) {
        setAvailableUpdates([])
        setIsChecking(false)
        setLastChecked(now)
        return
      }

      const results = await checkScenarioUpdates(checkList)
      setAvailableUpdates(results)
      setLastChecked(now)

      if (results.length > 0) {
        setIsDismissed(false)
      }
    } catch {
      setAvailableUpdates([])
    } finally {
      setIsChecking(false)
    }
  }, [isAuthenticated, lastChecked])

  useEffect(() => {
    if (isAuthenticated) {
      doCheck()
      timerRef.current = setInterval(doCheck, CHECK_INTERVAL)
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [isAuthenticated, doCheck])

  if (!isAuthenticated || isDismissed || availableUpdates.length === 0) {
    return null
  }

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-blue-500/5 border border-blue-500/15 rounded-lg animate-in slide-in-from-top-2">
      <div className="flex items-center gap-1.5 flex-1 min-w-0">
        <Bell className="w-3.5 h-3.5 text-blue-400 shrink-0" />
        <span className="text-xs text-[var(--color-text)] truncate">
          {t('app.scenarioupdatesavailable', language as Language, { length: availableUpdates.length })}
        </span>
      </div>

      <button
        onClick={onNavigateToUpdate}
        className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors shrink-0"
      >
        <ArrowUpCircle className="w-3 h-3" />
        {t('app.view', language as Language)}
      </button>

      <button
        onClick={() => setIsDismissed(true)}
        className="p-1 rounded hover:bg-[var(--color-bg-hover)] transition-colors shrink-0"
      >
        <X className="w-3 h-3 text-[var(--color-text)] opacity-50" />
      </button>
    </div>
  )
}
