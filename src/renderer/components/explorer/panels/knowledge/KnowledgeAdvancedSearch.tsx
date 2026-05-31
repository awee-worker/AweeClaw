import { useMemo } from 'react'
import { Search, X, SlidersHorizontal } from 'lucide-react'
import {
  type KnowledgeCategory,
  type KnowledgeSource,
  KNOWLEDGE_CATEGORIES,
} from '@intelligence/runtime/knowledgeService/providerTypes'
import { SOURCE_CONFIG } from './KnowledgeEntryCard'
import { generateSearchSuggestions } from './searchUtils'

interface AdvancedSearchPanelProps {
  searchQuery: string
  onSearchChange: (query: string) => void
  filterCategory: KnowledgeCategory | null
  onFilterCategoryChange: (cat: KnowledgeCategory | null) => void
  filterSource: KnowledgeSource | null
  onFilterSourceChange: (source: KnowledgeSource | null) => void
  showAdvanced: boolean
  onToggleAdvanced: () => void
  starredOnly: boolean
  onStarredOnlyChange: (v: boolean) => void
  enabledOnly: boolean
  onEnabledOnlyChange: (v: boolean) => void
  dateRange: { from: Date | null; to: Date | null }
  onDateRangeChange: (range: { from: Date | null; to: Date | null }) => void
  entries: { title: string; tags: string[]; category: string }[]
  language: string
}

export function AdvancedSearchPanel({
  searchQuery,
  onSearchChange,
  filterCategory,
  onFilterCategoryChange,
  filterSource,
  onFilterSourceChange,
  showAdvanced,
  onToggleAdvanced,
  starredOnly,
  onStarredOnlyChange,
  enabledOnly,
  onEnabledOnlyChange,
  dateRange,
  onDateRangeChange,
  entries,
  language,
}: AdvancedSearchPanelProps) {
  const t = (zh: string, en: string) => (language === 'zh' ? zh : en)

  const suggestions = useMemo(
    () => generateSearchSuggestions(entries, searchQuery),
    [entries, searchQuery],
  )

  const hasActiveFilters =
    filterCategory !== null ||
    filterSource !== null ||
    starredOnly ||
    enabledOnly ||
    dateRange.from !== null ||
    dateRange.to !== null

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 px-3 py-2 bg-surface/30 rounded-lg border border-border/20">
        <Search className="w-4 h-4 text-text-muted flex-shrink-0" />
        <input
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t('搜索知识...', 'Search knowledge...')}
          className="flex-1 bg-transparent text-[13px] text-text-primary outline-none placeholder:text-text-muted"
        />
        {searchQuery && (
          <button
            onClick={() => onSearchChange('')}
            className="p-0.5 text-text-muted hover:text-text-primary"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          onClick={onToggleAdvanced}
          className={`p-0.5 transition-colors ${showAdvanced || hasActiveFilters ? 'text-accent' : 'text-text-muted hover:text-text-primary'}`}
          title={t('高级搜索', 'Advanced Search')}
        >
          <SlidersHorizontal className="w-4 h-4" />
        </button>
      </div>

      {suggestions.length > 0 && searchQuery.length >= 2 && !showAdvanced && (
        <div className="px-3 py-1.5 bg-surface/20 rounded-lg border border-border/10">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] text-text-muted mr-1">
              {t('建议', 'Suggest')}:
            </span>
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => onSearchChange(s)}
                className="text-[11px] px-2 py-0.5 text-accent/80 hover:text-accent bg-accent/5 hover:bg-accent/10 rounded-full transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {showAdvanced && (
        <div className="px-3 py-2.5 bg-surface/20 rounded-lg border border-border/10 space-y-2.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-text-muted min-w-[32px]">
              {t('来源', 'Source')}:
            </span>
            {Object.entries(SOURCE_CONFIG).map(([key, cfg]) => {
              const Icon = cfg.icon
              return (
                <button
                  key={key}
                  onClick={() =>
                    onFilterSourceChange(
                      filterSource === key ? null : (key as KnowledgeSource),
                    )
                  }
                  className={`text-[11px] px-2 py-0.5 rounded-full transition-colors flex items-center gap-1 ${
                    filterSource === key
                      ? 'text-accent bg-accent/10 border border-accent/30'
                      : 'text-text-muted hover:text-text-primary border border-transparent'
                  }`}
                >
                  <Icon className={`w-3 h-3 ${cfg.color}`} />
                  {t(cfg.zh, cfg.en)}
                </button>
              )
            })}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-text-muted min-w-[32px]">
              {t('分类', 'Cat')}:
            </span>
            {KNOWLEDGE_CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                onClick={() =>
                  onFilterCategoryChange(
                    filterCategory === cat.id ? null : cat.id,
                  )
                }
                className={`text-[11px] px-2 py-0.5 rounded-full transition-colors ${
                  filterCategory === cat.id
                    ? `${cat.color} bg-surface-active border border-current/20`
                    : 'text-text-muted hover:text-text-primary border border-transparent'
                }`}
              >
                {t(cat.labelZh, cat.labelEn)}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-[11px] text-text-muted cursor-pointer">
              <input
                type="checkbox"
                checked={starredOnly}
                onChange={(e) => onStarredOnlyChange(e.target.checked)}
                className="accent-accent"
              />
              {t('仅收藏', 'Starred only')}
            </label>
            <label className="flex items-center gap-1.5 text-[11px] text-text-muted cursor-pointer">
              <input
                type="checkbox"
                checked={enabledOnly}
                onChange={(e) => onEnabledOnlyChange(e.target.checked)}
                className="accent-accent"
              />
              {t('仅启用', 'Enabled only')}
            </label>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] text-text-muted min-w-[32px]">
              {t('时间', 'Date')}:
            </span>
            <input
              type="date"
              value={
                dateRange.from
                  ? dateRange.from.toISOString().split('T')[0]
                  : ''
              }
              onChange={(e) =>
                onDateRangeChange({
                  ...dateRange,
                  from: e.target.value ? new Date(e.target.value) : null,
                })
              }
              className="text-[11px] bg-surface/30 border border-border/20 rounded px-2 py-0.5 text-text-primary outline-none"
            />
            <span className="text-[11px] text-text-muted">-</span>
            <input
              type="date"
              value={
                dateRange.to ? dateRange.to.toISOString().split('T')[0] : ''
              }
              onChange={(e) =>
                onDateRangeChange({
                  ...dateRange,
                  to: e.target.value ? new Date(e.target.value) : null,
                })
              }
              className="text-[11px] bg-surface/30 border border-border/20 rounded px-2 py-0.5 text-text-primary outline-none"
            />
          </div>

          {hasActiveFilters && (
            <button
              onClick={() => {
                onFilterCategoryChange(null)
                onFilterSourceChange(null)
                onStarredOnlyChange(false)
                onEnabledOnlyChange(false)
                onDateRangeChange({ from: null, to: null })
              }}
              className="text-[11px] text-accent hover:text-accent/80 transition-colors"
            >
              {t('清除所有筛选', 'Clear all filters')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
