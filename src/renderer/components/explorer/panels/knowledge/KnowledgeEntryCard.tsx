import {
  Star, ToggleLeft, ToggleRight, Trash2, Check,
  BookOpen, ChevronRight, Clock, Hash,
} from 'lucide-react'
import {
  type KnowledgeEntry,
  type KnowledgeSource,
  KNOWLEDGE_CATEGORIES,
} from '@intelligence/runtime/knowledgeService/providerTypes'
import { highlightText } from './searchUtils'
import { TipButton } from './TipButton'
import { t, type Language } from '@renderer/i18n'

export const SOURCE_CONFIG: Record<
  KnowledgeSource,
  { zh: string; en: string; icon: typeof BookOpen; color: string }
> = {
  user: { zh: '手动', en: 'Manual', icon: BookOpen, color: 'text-blue-500' },
  file: { zh: '文件', en: 'File', icon: BookOpen, color: 'text-emerald-500' },
  url: { zh: '网页', en: 'URL', icon: BookOpen, color: 'text-purple-500' },
  database: {
    zh: '数据库',
    en: 'Database',
    icon: BookOpen,
    color: 'text-amber-500',
  },
  'web-crawl': {
    zh: '爬取',
    en: 'Crawl',
    icon: BookOpen,
    color: 'text-cyan-500',
  },
  migrated: {
    zh: '迁移',
    en: 'Migrated',
    icon: BookOpen,
    color: 'text-text-muted',
  },
}

export function formatDate(ts: number, language: Language): string {
  const d = new Date(ts)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  const diffHour = Math.floor(diffMs / 3600000)
  const diffDay = Math.floor(diffMs / 86400000)

  if (language === 'zh') {
    if (diffMin < 1) return '刚刚'
    if (diffMin < 60) return `${diffMin}分钟前`
    if (diffHour < 24) return `${diffHour}小时前`
    if (diffDay < 7) return `${diffDay}天前`
    return d.toLocaleDateString('zh-CN')
  }
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHour < 24) return `${diffHour}h ago`
  if (diffDay < 7) return `${diffDay}d ago`
  return d.toLocaleDateString('en-US')
}

interface EntryCardProps {
  entry: KnowledgeEntry
  isSelected: boolean
  isBatchSelected?: boolean
  batchMode?: boolean
  searchQuery?: string
  onSelect: () => void
  onToggleBatchSelect?: () => void
  onToggleEnabled: () => void
  onToggleStar: () => void
  onDelete: () => void
  language: Language
}

export function EntryCard({
  entry,
  isSelected,
  isBatchSelected,
  batchMode,
  searchQuery,
  onSelect,
  onToggleBatchSelect,
  onToggleEnabled,
  onToggleStar,
  onDelete,
  language,
}: EntryCardProps) {
  const srcConfig = SOURCE_CONFIG[entry.source]
  const SrcIcon = srcConfig?.icon || BookOpen
  const catConfig = KNOWLEDGE_CATEGORIES.find((c) => c.id === entry.category)
  return (
    <div
      onClick={batchMode ? onToggleBatchSelect : onSelect}
      className={`group relative flex gap-3 px-3 py-3 rounded-xl cursor-pointer transition-all duration-150 ${
        isSelected
          ? 'bg-accent/10 border border-accent/20 shadow-sm'
          : isBatchSelected
            ? 'bg-accent/5 border border-accent/10'
            : 'hover:bg-surface-hover border border-transparent'
      } ${!entry.enabled ? 'opacity-45' : ''}`}
    >
      {batchMode && (
        <div className="flex-shrink-0 mt-1.5">
          <div
            className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
              isBatchSelected
                ? 'bg-accent border-accent'
                : 'border-border/40 hover:border-accent/50'
            }`}
          >
            {isBatchSelected && <Check className="w-3 h-3 text-white" />}
          </div>
        </div>
      )}
      <div className="flex-shrink-0 mt-0.5">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-surface/60">
          <SrcIcon
            className={`w-4 h-4 ${srcConfig?.color || 'text-text-muted'}`}
          />
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[13px] font-medium text-text-primary truncate">
            {searchQuery ? highlightText(entry.title, searchQuery) : entry.title}
          </span>
          {entry.starred && (
            <Star className="w-3 h-3 text-amber-500 fill-amber-500 flex-shrink-0" />
          )}
          {catConfig && (
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded-full ${catConfig.color} bg-current/10 flex-shrink-0`}
            >
              {language === 'zh' ? catConfig.labelZh : catConfig.labelEn}
            </span>
          )}
        </div>
        <p className="text-[12px] text-text-secondary truncate mt-1 leading-relaxed">
          {searchQuery ? highlightText(entry.content, searchQuery) : entry.content}
        </p>
        <div className="flex items-center gap-2 mt-1.5">
          <span className="text-[11px] text-text-muted flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {formatDate(entry.updatedAt, language)}
          </span>
          {entry.tags.length > 0 && (
            <span className="text-[11px] text-text-muted flex items-center gap-0.5">
              <Hash className="w-3 h-3" />
              {entry.tags.slice(0, 2).join(', ')}
              {entry.tags.length > 2 && ` +${entry.tags.length - 2}`}
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-col items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
        <TipButton
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation()
            onToggleEnabled()
          }}
          active={entry.enabled}
          tip={entry.enabled ? t('app.disable', language as Language) : t('app.enable', language as Language)}
          className="p-1 rounded hover:bg-surface-hover"
        >
          {entry.enabled ? (
            <ToggleRight className="w-3.5 h-3.5" />
          ) : (
            <ToggleLeft className="w-3.5 h-3.5" />
          )}
        </TipButton>
        <TipButton
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation()
            onToggleStar()
          }}
          active={entry.starred}
          tip={t('app.star', language as Language)}
          className={`p-1 rounded hover:bg-surface-hover ${entry.starred ? '' : 'hover:text-amber-500'}`}
        >
          <Star className="w-3.5 h-3.5" />
        </TipButton>
        <TipButton
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation()
            onDelete()
          }}
          tip={t('app.delete', language as Language)}
          className="p-1 rounded hover:text-red-500 hover:bg-surface-hover"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </TipButton>
      </div>
      {isSelected && (
        <ChevronRight className="w-4 h-4 text-accent absolute right-2 top-1/2 -translate-y-1/2" />
      )}
    </div>
  )
}
