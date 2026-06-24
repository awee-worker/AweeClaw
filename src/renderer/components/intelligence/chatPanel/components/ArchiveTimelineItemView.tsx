/**
 * 归档消息项组件
 * 显示被折叠的历史消息数量，提供展开按钮
 */
import { ActionButton } from '../../../ui'
import { t, type Language } from '@renderer/i18n'
import type { TimelineArchiveItem } from '../../chatTimelineProjection'

interface ArchiveTimelineItemProps {
  item: TimelineArchiveItem
  onReveal: () => void
  language: Language
  isChatPrimary: boolean
}

export function ArchiveTimelineItemView({
  item,
  onReveal,
  language,
  isChatPrimary,
}: ArchiveTimelineItemProps) {
  const label = t('ai.showmorehistory', language)
  const hiddenLabel = t('ai.oldermessagesarchived', language, { hiddenCount: item.hiddenCount })
  const revealLabel = t('ai.revealmore', language, { revealCount: item.revealCount })
  const remainingLabel =
    item.remainingCount > 0
      ? t('ai.remaining', language, { remainingCount: item.remainingCount })
      : undefined

  return (
    <div className={isChatPrimary ? 'max-w-[800px] mx-auto w-full' : ''}>
      <div className="px-4 pb-3 pt-2">
        <div className="mx-auto max-w-3xl rounded-2xl border border-border/60 bg-background/95 px-4 py-3 shadow-sm">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <div className="text-[12px] font-semibold uppercase tracking-[0.18em] text-text-muted">
                {label}
              </div>
              <div className="mt-1 text-sm text-text-secondary">{hiddenLabel}</div>
              {remainingLabel && (
                <div className="mt-1 text-xs text-text-muted">{remainingLabel}</div>
              )}
            </div>
            <ActionButton
              variant="ghost"
              size="sm"
              onClick={onReveal}
              className="shrink-0 rounded-xl border border-border/60 bg-surface/60 px-3 text-xs text-text-primary hover:bg-surface-hover"
            >
              {revealLabel}
            </ActionButton>
          </div>
        </div>
      </div>
    </div>
  )
}
