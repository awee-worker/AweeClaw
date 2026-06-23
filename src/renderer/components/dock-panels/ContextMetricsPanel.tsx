import { Layers, Coins, Zap, AlertTriangle, ChevronRight, ArrowRightCircle, Loader2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  useAgentStore,
  selectCompressionStats,
  selectCurrentThread,
  selectLatestContextSnapshot,
} from '@intelligence/state/IntelligenceStore'
import { createManualHandoffSession } from '@intelligence/runtime/handoffSessionTracker'
import type { CompressionLevel } from '@intelligence/providerTypes'
import type { TokenUsage } from '@intelligence/providerTypes'
import { toast } from '@components/foundation/NotificationProvider'
import { formatTokenCount } from '@utils/formatter'
import { t, type Language } from '@renderer/i18n'

interface ContextStatsContentProps {
  totalUsage: TokenUsage
  lastUsage?: TokenUsage
  language?: 'zh' | 'en'
}

const LEVEL_COLORS: Record<CompressionLevel, string> = {
  0: 'text-emerald-400',
  1: 'text-blue-400',
  2: 'text-yellow-400',
  3: 'text-orange-400',
  4: 'text-red-400',
}

const LEVEL_BG: Record<CompressionLevel, string> = {
  0: 'bg-emerald-400',
  1: 'bg-blue-400',
  2: 'bg-yellow-400',
  3: 'bg-orange-400',
  4: 'bg-red-400',
}

export default function ContextStatsContent({
  totalUsage,
  lastUsage,
  language = 'en',
}: ContextStatsContentProps) {
  const compressionStats = useAgentStore(selectCompressionStats)
  const currentThread = useAgentStore(selectCurrentThread)
  const latestSnapshot = useAgentStore(selectLatestContextSnapshot)
  const [isCreatingHandoff, setIsCreatingHandoff] = useState(false)

  const currentLevel = (compressionStats?.level ?? 0) as CompressionLevel
  const needsHandoff = compressionStats?.needsHandoff ?? currentLevel >= 4
  const ratio = compressionStats?.ratio ?? 0
  const contextLimit = compressionStats?.contextLimit ?? 128000
  const inputTokens = compressionStats?.inputTokens ?? 0

  const levelNames = {
    0: t('dock-panels.full', language as Language),
    1: t('dock-panels.truncate', language as Language),
    2: t('dock-panels.window', language as Language),
    3: t('dock-panels.deep', language as Language),
    4: t('dock-panels.handoff', language as Language),
  }

  const formatK = (n: number | undefined) => formatTokenCount(n ?? 0)

  const formatNumber = (n: number | undefined) => formatTokenCount(n ?? 0)

  const progressColor = useMemo(() => {
    if (ratio >= 0.95) return 'bg-red-500'
    if (ratio >= 0.85) return 'bg-orange-500'
    if (ratio >= 0.7) return 'bg-yellow-500'
    return 'bg-emerald-500'
  }, [ratio])

  const handleManualCompress = async () => {
    if (!currentThread || isCreatingHandoff) return

    if (currentThread.messages.length === 0) {
      toast.error(
        t('dock-panels.cannotcompress', language as Language),
        t('dock-panels.thereisnoconversationcontent', language as Language),
      )
      return
    }

    setIsCreatingHandoff(true)

    try {
      await createManualHandoffSession(currentThread.id)
      toast.success(
        t('dock-panels.switchedtonewthread', language as Language),
        t('dock-panels.createdanewthreadfrom', language as Language),
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      toast.error(
        t('dock-panels.compressionfailed', language as Language),
        message || (t('dock-panels.couldnotgenerateahandoff', language as Language)),
      )
    } finally {
      setIsCreatingHandoff(false)
    }
  }

  return (
    <div className="flex flex-col h-full bg-background select-none">
      <div className="p-4 border-b border-border/40">
        <div className="mb-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-text-muted" />
              <span className="text-xs font-medium text-text-secondary">
                {t('dock-panels.contextusage', language as Language)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-xs font-bold font-mono ${LEVEL_COLORS[currentLevel]}`}>
                {Math.round(ratio * 100)}%
              </span>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${LEVEL_BG[currentLevel]}/20 ${LEVEL_COLORS[currentLevel]}`}>
                L{currentLevel}
              </span>
            </div>
          </div>

          <div className="h-2 bg-text-primary/[0.05] rounded-full overflow-hidden">
            <div
              className={`h-full ${progressColor} transition-all duration-500 rounded-full`}
              style={{ width: `${Math.min(ratio * 100, 100)}%` }}
            />
          </div>

          <div className="flex justify-between mt-1 text-[10px] text-text-muted/85 font-mono">
            <span>0</span>
            <span className="text-yellow-500/50">50%</span>
            <span className="text-red-500/50">100%</span>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="p-2 rounded-lg bg-surface/50 border border-text-primary/[0.05]">
            <div className="text-[10px] text-text-muted uppercase">
              {t('dock-panels.textfield', language as Language)}
            </div>
            <div className="text-sm font-mono font-bold text-text-primary">
              {formatK(inputTokens)}
            </div>
          </div>
          <div className="p-2 rounded-lg bg-surface/50 border border-text-primary/[0.05]">
            <div className="text-[10px] text-text-muted uppercase">
              {t('dock-panels.limit', language as Language)}
            </div>
            <div className="text-sm font-mono font-bold text-text-secondary">
              {formatK(contextLimit)}
            </div>
          </div>
          <div className="p-2 rounded-lg bg-surface/50 border border-text-primary/[0.05]">
            <div className="text-[10px] text-text-muted uppercase">
              {t('dock-panels.level', language as Language)}
            </div>
            <div className={`text-sm font-mono font-bold ${LEVEL_COLORS[currentLevel]}`}>
              {levelNames[currentLevel]}
            </div>
          </div>
        </div>
      </div>

      <div className="p-4 border-b border-border/40">
        <div className="flex items-center gap-2 mb-3">
          <Coins className="w-4 h-4 text-accent" />
          <span className="text-xs font-medium text-text-secondary">
            {t('dock-panels.coststats', language as Language)}
          </span>
          <span className="ml-auto text-lg font-bold font-mono text-accent">
            {formatK(totalUsage?.totalTokens ?? 0)}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <StatRow
            label={t('dock-panels.totalin', language as Language)}
            value={formatNumber(totalUsage?.promptTokens ?? 0)}
          />
          <StatRow
            label={t('dock-panels.totalout', language as Language)}
            value={formatNumber(totalUsage?.completionTokens ?? 0)}
          />
          <StatRow
            label={t('dock-panels.cacheread', language as Language)}
            value={formatNumber(totalUsage?.cachedInputTokens ?? 0)}
            valueClassName="text-emerald-300"
          />
          <StatRow
            label={t('dock-panels.cachewrite', language as Language)}
            value={formatNumber(totalUsage?.cacheWriteTokens ?? 0)}
            valueClassName="text-sky-300"
          />
        </div>

        {lastUsage && (
          <>
            <div className="mt-2 flex items-center justify-between text-[11px] text-text-muted">
              <span className="flex items-center gap-1">
                <Zap className="w-3 h-3" />
                {t('dock-panels.lastrequest', language as Language)}
              </span>
              <span>
                {formatK(lastUsage.promptTokens)} <ChevronRight className="w-3 h-3 inline" /> {formatK(lastUsage.completionTokens)}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between text-[11px] text-text-muted">
              <span>{t('dock-panels.lastcache', language as Language)}</span>
              <span>
                {formatK(lastUsage.cachedInputTokens ?? 0)} <ChevronRight className="w-3 h-3 inline" /> {formatK(lastUsage.cacheWriteTokens ?? 0)}
              </span>
            </div>
          </>
        )}
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
        {needsHandoff && (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 flex gap-3 mb-4">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <div>
              <h4 className="text-xs font-bold text-red-400 mb-0.5">
                {t('dock-panels.contextfull', language as Language)}
              </h4>
              <p className="text-[11px] text-red-400/70">
                {t('dock-panels.compressandcontinueina', language as Language)}
              </p>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="text-[10px] text-text-muted uppercase tracking-wider">
              {t('dock-panels.compressionstrategy', language as Language)}
            </div>
            <button
              type="button"
              onClick={handleManualCompress}
              disabled={!currentThread || isCreatingHandoff}
              className="inline-flex items-center gap-1.5 rounded-md border border-accent/30 bg-accent/10 px-2 py-1 text-[11px] font-medium text-accent transition-colors hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isCreatingHandoff ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <ArrowRightCircle className="w-3 h-3" />
              )}
              <span>
                {t('dock-panels.compresstonewthread', language as Language)}
              </span>
            </button>
          </div>

          {([0, 1, 2, 3, 4] as CompressionLevel[]).map(level => (
            <div
              key={level}
              className={`flex items-center gap-2 p-2 rounded-lg transition-all ${level === currentLevel ? 'bg-text-primary/[0.05] ring-1 ring-text-primary/[0.1]' : 'opacity-50'}`}
            >
              <span className={`text-[10px] font-bold font-mono w-6 ${LEVEL_COLORS[level]}`}>
                L{level}
              </span>
              <span className="text-[11px] text-text-secondary flex-1">
                {level === 0 && (t('dock-panels.keepallmessages', language as Language))}
                {level === 1 && (t('dock-panels.truncatetoolargs', language as Language))}
                {level === 2 && (t('dock-panels.clearoldresults', language as Language))}
                {level === 3 && (t('dock-panels.deepcompresssummary', language as Language))}
                {level === 4 && (t('dock-panels.newsessionneeded', language as Language))}
              </span>
              {level === currentLevel && (
                <span className={`w-1.5 h-1.5 rounded-full ${LEVEL_BG[level]}`} />
              )}
            </div>
          ))}
        </div>

        {latestSnapshot ? (
          <div className="mt-4 p-3 rounded-xl bg-surface/30 border border-border/40">
            <div className="flex items-center justify-between gap-2 mb-1">
              <div className="text-[10px] text-accent font-bold uppercase tracking-wider">
                {t('dock-panels.currenttask', language as Language)}
              </div>
              <span className="text-[10px] text-text-muted uppercase tracking-wider">
                {latestSnapshot.source === 'handoff'
                  ? (t('dock-panels.handoffsnapshot', language as Language))
                  : (t('dock-panels.compressionsnapshot', language as Language))}
              </span>
            </div>
            <p className="text-[12px] text-text-secondary leading-relaxed line-clamp-3">
              {latestSnapshot.summary.objective}
            </p>
            {latestSnapshot.summary.pendingSteps[0] && (
              <p className="mt-2 text-[11px] text-text-muted leading-relaxed line-clamp-2">
                {t('dock-panels.next', language as Language)} {latestSnapshot.summary.pendingSteps[0]}
              </p>
            )}
          </div>
        ) : (
          <div className="mt-4 p-3 rounded-xl bg-surface/20 border border-border/30">
            <div className="text-[10px] text-text-muted uppercase tracking-wider mb-1">
              {t('dock-panels.currenttask2', language as Language)}
            </div>
            <p className="text-[12px] text-text-muted leading-relaxed">
              {t('dock-panels.nocontextsnapshotyet', language as Language)}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function StatRow({
  label,
  value,
  valueClassName = 'text-text-primary',
}: {
  label: string
  value: string
  valueClassName?: string
}) {
  return (
    <div className="flex items-center justify-between p-2 rounded-lg bg-surface/50 border border-text-primary/[0.05]">
      <span className="text-[11px] text-text-muted">{label}</span>
      <span className={`text-xs font-mono ${valueClassName}`}>{value}</span>
    </div>
  )
}
