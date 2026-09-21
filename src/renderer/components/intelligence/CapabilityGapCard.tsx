/**
 * 能力缺口建议卡片
 *
 * 在对话流中呈现「当前没有可直接使用的技能完成这件事」，并给出市场候选。
 *
 * 交互约定：
 * - 安装必须由用户点击，卡片不提供自动安装路径
 * - 卡片可忽略，忽略后同一缺口在冷却期内不再提示
 */

import { memo } from 'react'
import { Download, ExternalLink, Lightbulb, Loader2, X } from 'lucide-react'
import { useStore } from '@store'
import type { Language } from '@renderer/i18n'
import type { CapabilityGap } from '@intelligence/capabilities/planning/capabilityGapDetector'
import type { MarketplaceSuggestion } from '@intelligence/runtime/skillRepository'

interface CapabilityGapCardProps {
  gap: CapabilityGap
  suggestions: MarketplaceSuggestion[]
  /** 候选检索中 */
  loading?: boolean
  /** 用户确认安装 */
  onInstall?: (suggestion: MarketplaceSuggestion) => void
  /** 查看市场详情 */
  onView?: (suggestion: MarketplaceSuggestion) => void
  /** 忽略该建议 */
  onDismiss?: () => void
}

interface GapCopy {
  title: string
  suggesting: string
  empty: string
  install: string
  view: string
  dismiss: string
  confidence: string
}

function buildCopy(language: Language): GapCopy {
  if (language === 'en') {
    return {
      title: 'No skill available for this task',
      suggesting: 'Suggested skills',
      empty: 'No matching skill found in the marketplace',
      install: 'Install',
      view: 'View',
      dismiss: 'Dismiss',
      confidence: 'confidence',
    }
  }
  return {
    title: '当前没有可直接使用的技能完成这件事',
    suggesting: '建议安装',
    empty: '市场中没有找到匹配的技能',
    install: '安装',
    view: '查看',
    dismiss: '忽略',
    confidence: '置信度',
  }
}

const CapabilityGapCard = memo(function CapabilityGapCard({
  gap,
  suggestions,
  loading = false,
  onInstall,
  onView,
  onDismiss,
}: CapabilityGapCardProps) {
  const language = useStore((s) => s.language) as Language
  const copy = buildCopy(language)

  return (
    <div className="my-3 rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] p-3.5">
      <div className="flex items-start gap-2.5">
        <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-text-primary">{copy.title}</div>
          <div className="mt-1 text-[12px] leading-relaxed text-text-secondary">
            「{gap.intent}」
          </div>
          <div className="mt-1 text-[11px] leading-relaxed text-text-muted">
            {gap.reason}
            <span className="ml-1 text-text-muted/80">
              （{copy.confidence} {(gap.confidence * 100).toFixed(0)}%）
            </span>
          </div>

          <div className="mt-2.5">
            <div className="mb-1.5 text-[11px] uppercase tracking-wide text-text-muted/85">
              {copy.suggesting}
            </div>

            {loading ? (
              <div className="flex items-center gap-2 text-[12px] text-text-muted">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>...</span>
              </div>
            ) : suggestions.length === 0 ? (
              <div className="text-[12px] text-text-muted">{copy.empty}</div>
            ) : (
              <div className="space-y-1.5">
                {suggestions.map((suggestion) => (
                  <div
                    key={suggestion.package}
                    className="flex items-center gap-2 rounded-xl border border-border/40 bg-background/25 px-2.5 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] font-medium text-text-primary">
                        {suggestion.name}
                      </div>
                      <div className="truncate text-[11px] text-text-muted">
                        {suggestion.package}
                      </div>
                    </div>

                    {onView && (
                      <button
                        onClick={() => onView(suggestion)}
                        className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border/50 px-2 py-1 text-[11px] text-text-secondary transition-colors hover:text-text-primary"
                      >
                        <ExternalLink className="h-3 w-3" />
                        {copy.view}
                      </button>
                    )}

                    {onInstall && (
                      <button
                        onClick={() => onInstall(suggestion)}
                        className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-accent/40 bg-accent/10 px-2 py-1 text-[11px] text-accent transition-colors hover:bg-accent/20"
                      >
                        <Download className="h-3 w-3" />
                        {copy.install}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {onDismiss && (
          <button
            onClick={onDismiss}
            title={copy.dismiss}
            className="shrink-0 rounded-lg p-1 text-text-muted/70 transition-colors hover:text-text-secondary"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  )
})

export default CapabilityGapCard
