import { Search, Link, FileUp, Loader2, Plus, BookOpen } from 'lucide-react'
import {
  type KnowledgeCategory,
  type KnowledgeSource,
  KNOWLEDGE_CATEGORIES,
} from '@intelligence/runtime/knowledgeService/providerTypes'
import { SOURCE_CONFIG } from './KnowledgeEntryCard'
import { t, type Language } from '@renderer/i18n'

interface KnowledgeSearchBarProps {
  searchQuery: string
  onSearchChange: (query: string) => void
  filterCategory: KnowledgeCategory | null
  onFilterCategoryChange: (cat: KnowledgeCategory | null) => void
  filterSource: KnowledgeSource | null
  onFilterSourceChange: (source: KnowledgeSource | null) => void
  showUrlInput: boolean
  onToggleUrlInput: () => void
  importUrl: string
  onImportUrlChange: (url: string) => void
  onImportUrl: () => void
  importing: boolean
  enabledCount: number
  totalCount: number
  activeSources: KnowledgeSource[]
  onFileImport: () => void
  onAdd: () => void
  language: Language
}

export function KnowledgeSearchBar({
  searchQuery,
  onSearchChange,
  filterCategory,
  onFilterCategoryChange,
  filterSource,
  onFilterSourceChange,
  showUrlInput,
  onToggleUrlInput,
  importUrl,
  onImportUrlChange,
  onImportUrl,
  importing,
  enabledCount,
  totalCount,
  activeSources,
  onFileImport,
  onAdd,
  language,
}: KnowledgeSearchBarProps) {
  return (
    <>
      <div className="h-12 px-4 flex items-center justify-between gap-2 border-b border-border/50 flex-shrink-0">
        <span className="min-w-0 flex-shrink-0 whitespace-nowrap text-[13px] font-black text-text-secondary uppercase tracking-[0.2em] font-sans">
          {t('app.knowledge', language as Language)}
        </span>
        <div className="flex items-center gap-1.5">
          <span className="text-[12px] text-text-muted tabular-nums mr-1">
            {enabledCount}/{totalCount}
          </span>
          {importing && <Loader2 className="w-4 h-4 text-accent animate-spin" />}
          <button
            onClick={onFileImport}
            disabled={importing}
            className="p-1 text-text-muted hover:text-accent transition-colors disabled:opacity-40"
            title={t('app.importfiles', language as Language)}
          >
            <FileUp className="w-4 h-4" />
          </button>
          <button
            onClick={onToggleUrlInput}
            disabled={importing}
            className="p-1 text-text-muted hover:text-accent transition-colors disabled:opacity-40"
            title={t('app.importurl', language as Language)}
          >
            <Link className="w-4 h-4" />
          </button>
          <button
            onClick={onAdd}
            className="p-1 text-text-muted hover:text-accent transition-colors"
            title={t('app.addknowledge', language as Language)}
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="px-3 py-2 space-y-2 flex-shrink-0">
        <div className="flex items-center gap-2 px-3 py-2 bg-surface/30 rounded-lg border border-border/20">
          <Search className="w-4 h-4 text-text-muted flex-shrink-0" />
          <input
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t('app.searchknowledge', language as Language)}
            className="flex-1 bg-transparent text-[13px] text-text-primary outline-none placeholder:text-text-muted"
          />
        </div>

        {showUrlInput && (
          <div className="flex items-center gap-2 px-3 py-2 bg-surface/30 rounded-lg border border-accent/20">
            <Link className="w-4 h-4 text-text-muted flex-shrink-0" />
            <input
              value={importUrl}
              onChange={(e) => onImportUrlChange(e.target.value)}
              placeholder={t('app.enterurl', language as Language)}
              className="flex-1 bg-transparent text-[13px] text-text-primary outline-none placeholder:text-text-muted"
              onKeyDown={(e) => {
                if (e.key === 'Enter') onImportUrl()
              }}
            />
            <button
              onClick={onImportUrl}
              disabled={!importUrl.trim() || importing}
              className="text-[12px] text-accent hover:text-accent/80 disabled:opacity-40 px-1"
            >
              {t('app.import', language as Language)}
            </button>
          </div>
        )}

        <div className="flex items-center gap-1.5 flex-wrap">
          {activeSources.map((source) => {
            const cfg = SOURCE_CONFIG[source]
            if (!cfg) return null
            const Icon = cfg.icon
            return (
              <button
                key={source}
                onClick={() =>
                  onFilterSourceChange(filterSource === source ? null : source)
                }
                className={`text-[12px] px-2.5 py-1 rounded-full transition-colors flex items-center gap-1.5 ${
                  filterSource === source
                    ? 'text-accent bg-accent/10 border border-accent/30'
                    : 'text-text-muted hover:text-text-primary border border-transparent'
                }`}
              >
                <Icon className={`w-3 h-3 ${cfg.color}`} />
                {language === 'zh' ? cfg.zh : cfg.en}
              </button>
            )
          })}
          {activeSources.length > 0 && (
            <span className="text-border mx-0.5">|</span>
          )}
          {KNOWLEDGE_CATEGORIES.slice(0, 5).map((cat) => (
            <button
              key={cat.id}
              onClick={() =>
                onFilterCategoryChange(
                  filterCategory === cat.id ? null : cat.id,
                )
              }
              className={`text-[12px] px-2.5 py-1 rounded-full transition-colors ${
                filterCategory === cat.id
                  ? `${cat.color} bg-surface-active border border-current/20`
                  : 'text-text-muted hover:text-text-primary border border-transparent'
              }`}
            >
              {language === 'zh' ? cat.labelZh : cat.labelEn}
            </button>
          ))}
        </div>
      </div>
    </>
  )
}

export function EmptyList({
  hasEntries,
  language,
}: {
  hasEntries: boolean
  language: Language
}) {
  const t = (zh: string, en: string) => (language === 'zh' ? zh : en)
  return (
    <div className="flex flex-col items-center justify-center py-16 text-text-muted">
      <BookOpen className="w-10 h-10 mb-3 opacity-30" />
      <p className="text-[13px]">
        {hasEntries
          ? t('app.nomatchingresults', language as Language)
          : t('app.noentriesyet', language as Language)}
      </p>
      {!hasEntries && (
        <p className="text-[12px] mt-1.5 text-text-secondary">
          {t('app.clicktoaddor', language as Language)}
        </p>
      )}
    </div>
  )
}
