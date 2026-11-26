import { useState, useCallback, useEffect, useRef } from 'react'
import { logger } from '@shared/toolkit/LogEngine'
import { Search, Star, Download, Loader2, Filter, X, LayoutGrid, List, Eye } from 'lucide-react'
import {
  templateClientAPI,
  CATEGORIES,
  getCategoryLabel,
} from '@shared/configuration/workflows/templateClientAPI'
import type { WorkflowTemplateEntry, TemplateQuery } from '@shared/configuration/workflows/templateClientAPI'
import { t, type Language } from '@renderer/i18n'

interface TemplateMarketProps {
  onUseTemplate: (template: WorkflowTemplateEntry) => void
  language: 'en' | 'zh'
}

const PAGE_SIZE = 20

export default function TemplateMarket({ onUseTemplate, language }: TemplateMarketProps) {
  const [templates, setTemplates] = useState<WorkflowTemplateEntry[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [selectedTemplate, setSelectedTemplate] = useState<WorkflowTemplateEntry | null>(null)

  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<string>('')
  const [categoryFilter, setCategoryFilter] = useState<string>('')
  const [showFilters, setShowFilters] = useState(false)
  const [ratingState, setRatingState] = useState<Record<string, number>>({})

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const fetchTemplates = useCallback(
    async (query: TemplateQuery) => {
      setLoading(true)
      setError(null)
      try {
        const result = await templateClientAPI.list({
          ...query,
          pageSize: PAGE_SIZE,
          isOfficial: undefined,
        })
        setTemplates(result.items)
        setTotal(result.total)
      } catch (err) {
        setError(t('wf.failedtoloadtemplates', language as Language))
        logger.ui.error('Template load error:', err)
      } finally {
        setLoading(false)
      }
    },
    [language],
  )

  useEffect(() => {
    fetchTemplates({
      search: search || undefined,
      type: typeFilter || undefined,
      category: categoryFilter || undefined,
      page: 1,
    })
    setPage(1)
  }, [search, typeFilter, categoryFilter, fetchTemplates])

  useEffect(() => {
    fetchTemplates({
      search: search || undefined,
      type: typeFilter || undefined,
      category: categoryFilter || undefined,
      page,
    })
  }, [page, search, typeFilter, categoryFilter, fetchTemplates])

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearch(value)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        fetchTemplates({
          search: value || undefined,
          type: typeFilter || undefined,
          category: categoryFilter || undefined,
          page: 1,
        })
        setPage(1)
        debounceRef.current = null
      }, 300)
    },
    [typeFilter, categoryFilter, fetchTemplates],
  )

  const clearFilters = useCallback(() => {
    setSearch('')
    setTypeFilter('')
    setCategoryFilter('')
  }, [])

  const handleUseTemplate = useCallback(
    (template: WorkflowTemplateEntry) => {
      // 使用计数交给服务端的 instantiate 事务统一处理：
      // 这里再调一次 recordUse 会让同一个模板被计两次使用量，
      // 而 usageCount 是列表排序依据，重复计数会直接影响排序。
      onUseTemplate(template)
    },
    [onUseTemplate],
  )

  const handleRate = useCallback(
    async (templateId: string, rating: number) => {
      try {
        setRatingState(prev => ({ ...prev, [templateId]: rating }))
        await templateClientAPI.rate(templateId, rating)
        fetchTemplates({
          search: search || undefined,
          type: typeFilter || undefined,
          category: categoryFilter || undefined,
          page,
        })
      } catch (err) {
        logger.ui.error('Rate error:', err)
      }
    },
    [search, typeFilter, categoryFilter, page, fetchTemplates],
  )

  const totalPages = Math.ceil(total / PAGE_SIZE)
  return (
    <div className="h-full flex flex-col bg-background-secondary ">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-border p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-text-primary ">
            {t('app.templatemarket', language as Language)}
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
              className="p-2 rounded-lg hover:bg-surface-hover text-text-secondary "
              title={viewMode === 'grid' ? t('app.listview', language as Language) : t('app.gridview', language as Language)}
            >
              {viewMode === 'grid' ? <List size={18} /> : <LayoutGrid size={18} />}
            </button>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`p-2 rounded-lg transition-colors ${
                showFilters || typeFilter || categoryFilter
                  ? 'bg-accent/10 text-accent dark:bg-blue-900/30 dark:text-blue-400'
                  : 'hover:bg-surface-hover text-text-secondary '
              }`}
            >
              <Filter size={18} />
            </button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="relative">
          <Search
            size={18}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
          />
          <input
            ref={searchInputRef}
            type="text"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder={t('app.searchtemplates', language as Language)}
            className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-border bg-surface text-text-primary placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
          />
          {search && (
            <button
              onClick={() => handleSearchChange('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary"
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* Filters */}
        {showFilters && (
          <div className="mt-3 flex flex-wrap gap-2">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-border bg-surface text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">{t('app.alltypes', language as Language)}</option>
              <option value="WORKFLOW">{t('app.workflow', language as Language)}</option>
              <option value="CHAT">{t('app.chat', language as Language)}</option>
              <option value="RAG">{t('app.rag', language as Language)}</option>
            </select>

            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-border bg-surface text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">{t('app.allcategories', language as Language)}</option>
              {CATEGORIES.map((cat) => (
                <option key={cat.key} value={cat.key}>
                  {getCategoryLabel(cat.key, language as 'en' | 'zh')}
                </option>
              ))}
            </select>

            {(typeFilter || categoryFilter) && (
              <button
                onClick={clearFilters}
                className="px-3 py-1.5 rounded-lg text-sm text-red-400 hover:bg-red-500/10 dark:hover:bg-red-900/20 transition-colors"
              >
                {t('app.clearfilters', language as Language)}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {loading && templates.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 size={32} className="animate-spin text-blue-500" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full text-red-500 gap-2">
            <p>{error}</p>
            <button
              onClick={() =>
                fetchTemplates({ search: search || undefined, type: typeFilter || undefined, category: categoryFilter || undefined, page })
              }
              className="px-4 py-2 rounded-lg bg-blue-500 text-white text-sm hover:bg-blue-600"
            >
              {t('app.retry', language as Language)}
            </button>
          </div>
        ) : templates.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-text-muted gap-3">
            <Download size={48} strokeWidth={1} />
            <p>{t('app.notemplatesfound', language as Language)}</p>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {templates.map((tmpl) => (
              <TemplateCard
                key={tmpl.id}
                template={tmpl}
                language={language}
                onUse={handleUseTemplate}
                onRate={handleRate}
                onSelect={setSelectedTemplate}
                ratingState={ratingState}
                t={t}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {templates.map((tmpl) => (
              <TemplateRow
                key={tmpl.id}
                template={tmpl}
                language={language}
                onUse={handleUseTemplate}
                onSelect={setSelectedTemplate}
                t={t}
              />
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex-shrink-0 border-t border-border px-4 py-3 flex items-center justify-between">
          <span className="text-sm text-text-secondary">
            {t('app.totaltemplates', language as Language, { total: total })}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1.5 rounded-lg text-sm border border-border disabled:opacity-40 disabled:cursor-not-allowed hover:bg-surface text-text-primary "
            >
              {t('app.prev2', language as Language)}
            </button>
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
              let pageNum: number
              if (totalPages <= 5) {
                pageNum = i + 1
              } else if (page <= 3) {
                pageNum = i + 1
              } else if (page >= totalPages - 2) {
                pageNum = totalPages - 4 + i
              } else {
                pageNum = page - 2 + i
              }
              return (
                <button
                  key={pageNum}
                  onClick={() => setPage(pageNum)}
                  className={`px-3 py-1.5 rounded-lg text-sm border ${
                    pageNum === page
                      ? 'bg-blue-500 text-white border-blue-500'
                      : 'border-border hover:bg-surface text-text-primary '
                  }`}
                >
                  {pageNum}
                </button>
              )
            })}
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1.5 rounded-lg text-sm border border-border disabled:opacity-40 disabled:cursor-not-allowed hover:bg-surface text-text-primary "
            >
              {t('app.next2', language as Language)}
            </button>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {selectedTemplate && (
        <TemplateDetailModal
          template={selectedTemplate}
          language={language}
          onClose={() => setSelectedTemplate(null)}
          onUse={handleUseTemplate}
          onRate={handleRate}
          ratingState={ratingState}
          t={t}
        />
      )}
    </div>
  )
}

/* ==================== Template Card ==================== */

function TemplateCard({
  template,
  language,
  onUse,
  onRate,
  onSelect,
  ratingState,
  t,
}: {
  template: WorkflowTemplateEntry
  language: 'en' | 'zh'
  onUse: (tmpl: WorkflowTemplateEntry) => void
  onRate: (id: string, rating: number) => void
  onSelect: (tmpl: WorkflowTemplateEntry) => void
  ratingState: Record<string, number>
  t: (key: string, lang: Language, params?: Record<string, string | number | undefined>) => string
}) {
  const name = language === 'zh' && template.nameZh ? template.nameZh : template.name
  const desc =
    language === 'zh' && template.descriptionZh
      ? template.descriptionZh
      : template.description
  const category = getCategoryLabel(template.category, language)

  return (
    <div className="group relative bg-background-secondary rounded-xl border border-border p-4 hover:border-accent/40 dark:hover:border-accent/60 hover:shadow-md transition-all duration-200">
      {/* Icon & Type Badge */}
      <div className="flex items-start justify-between mb-3">
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/30 dark:to-indigo-900/30 flex items-center justify-center">
          <Download size={20} className="text-blue-500" />
        </div>
        <div className="flex flex-col items-end gap-1">
          {template.isOfficial && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/15 text-amber-400 dark:bg-amber-900/30 dark:text-amber-400">
              {t('app.official', language as Language)}
            </span>
          )}
          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-surface-hover text-text-secondary ">
            {template.type}
          </span>
        </div>
      </div>

      {/* Name & Description */}
      <h3 className="font-medium text-text-primary mb-1 truncate">{name}</h3>
      <p className="text-xs text-text-secondary line-clamp-2 mb-3 h-8">{desc}</p>

      {/* Tags */}
      {template.tags && template.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {template.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="px-1.5 py-0.5 rounded text-[10px] bg-surface-hover text-text-secondary "
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-3 border-t border-border-subtle ">
        <div className="flex items-center gap-3 text-xs text-text-muted">
          <span className="flex items-center gap-1">
            <Download size={12} />
            {template.usageCount}
          </span>
          <span className="flex items-center gap-1">
            <Star size={12} className={template.rating ? 'text-amber-400' : ''} />
            {template.rating ? template.rating.toFixed(1) : '-'}
          </span>
          <span className="text-text-muted ">{category}</span>
        </div>
      </div>

      {/* Hover Actions */}
      <div className="absolute inset-0 bg-popover rounded-xl opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 z-10">
        <button
          onClick={(e) => {
            e.stopPropagation()
            onUse(template)
          }}
          className="px-4 py-2 rounded-lg bg-blue-500 text-white text-sm font-medium hover:bg-blue-600 transition-colors"
        >
          {t('app.usetemplate', language as Language)}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onSelect(template)
          }}
          className="px-4 py-2 rounded-lg border border-border-active text-text-primary text-sm font-medium hover:bg-surface transition-colors"
        >
          {t('app.details2', language as Language)}
        </button>
      </div>

      {/* Rating Stars */}
      <div className="flex items-center gap-0.5 mt-2">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            onClick={(e) => {
              e.stopPropagation()
              onRate(template.id, star)
            }}
            className="text-text-muted hover:text-amber-400 transition-colors"
          >
            <Star
              size={14}
              fill={
                (ratingState[template.id] !== undefined
                  ? ratingState[template.id] >= star
                  : (template.rating || 0) >= star)
                  ? 'currentColor'
                  : 'none'
              }
              className={
                (ratingState[template.id] !== undefined
                  ? ratingState[template.id] >= star
                  : (template.rating || 0) >= star)
                  ? 'text-amber-400'
                  : ''
              }
            />
          </button>
        ))}
      </div>
    </div>
  )
}

/* ==================== Template Row ==================== */

function TemplateRow({
  template,
  language,
  onUse,
  onSelect,
  t,
}: {
  template: WorkflowTemplateEntry
  language: 'en' | 'zh'
  onUse: (tmpl: WorkflowTemplateEntry) => void
  onSelect: (tmpl: WorkflowTemplateEntry) => void
  t: (key: string, lang: Language, params?: Record<string, string | number | undefined>) => string
}) {
  const name = language === 'zh' && template.nameZh ? template.nameZh : template.name
  const desc =
    language === 'zh' && template.descriptionZh
      ? template.descriptionZh
      : template.description
  const category = getCategoryLabel(template.category, language)

  return (
    <div className="flex items-center gap-4 p-4 bg-background-secondary rounded-lg border border-border hover:border-accent/40 dark:hover:border-accent/60 transition-all">
      <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/30 dark:to-indigo-900/30 flex items-center justify-center flex-shrink-0">
        <Download size={20} className="text-blue-500" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <h3 className="font-medium text-text-primary truncate">{name}</h3>
          {template.isOfficial && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/15 text-amber-400 dark:bg-amber-900/30 dark:text-amber-400">
              {t('app.official2', language as Language)}
            </span>
          )}
          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-surface-hover text-text-secondary ">
            {template.type}
          </span>
        </div>
        <p className="text-xs text-text-secondary truncate">{desc}</p>
      </div>

      <div className="flex items-center gap-4 flex-shrink-0">
        <span className="text-xs text-text-muted">{category}</span>
        <span className="flex items-center gap-1 text-xs text-text-muted">
          <Download size={12} />
          {template.usageCount}
        </span>
        <span className="flex items-center gap-1 text-xs text-text-muted">
          <Star size={12} className={template.rating ? 'text-amber-400' : ''} />
          {template.rating ? template.rating.toFixed(1) : '-'}
        </span>

        <button
          onClick={() => onUse(template)}
          className="px-3 py-1.5 rounded-lg bg-blue-500 text-white text-xs font-medium hover:bg-blue-600 transition-colors"
        >
          {t('app.use', language as Language)}
        </button>
        <button
          onClick={() => onSelect(template)}
          className="p-1.5 rounded-lg hover:bg-surface-hover text-text-muted"
        >
          <Eye size={16} />
        </button>
      </div>
    </div>
  )
}

/* ==================== Detail Modal ==================== */

function TemplateDetailModal({
  template,
  language,
  onClose,
  onUse,
  onRate,
  ratingState,
  t,
}: {
  template: WorkflowTemplateEntry
  language: 'en' | 'zh'
  onClose: () => void
  onUse: (tmpl: WorkflowTemplateEntry) => void
  onRate: (id: string, rating: number) => void
  ratingState: Record<string, number>
  t: (key: string, lang: Language, params?: Record<string, string | number | undefined>) => string
}) {
  const name = language === 'zh' && template.nameZh ? template.nameZh : template.name
  const desc =
    language === 'zh' && template.descriptionZh
      ? template.descriptionZh
      : template.description
  const category = getCategoryLabel(template.category, language)
  const nodeCount = Array.isArray(template.nodes) ? template.nodes.length : 0
  const edgeCount = Array.isArray(template.edges) ? template.edges.length : 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-background-secondary rounded-xl shadow-2xl max-w-lg w-full mx-4 max-h-[80vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border ">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/30 dark:to-indigo-900/30 flex items-center justify-center">
              <Download size={20} className="text-blue-500" />
            </div>
            <div>
              <h3 className="font-semibold text-text-primary ">{name}</h3>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs text-text-muted">{category}</span>
                <span className="text-xs px-1.5 py-0.5 rounded bg-surface-hover text-text-secondary ">
                  {template.type}
                </span>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-surface-hover text-text-muted"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          <p className="text-sm text-text-secondary ">{desc}</p>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 rounded-lg bg-surface text-center">
              <p className="text-lg font-semibold text-text-primary ">{nodeCount}</p>
              <p className="text-xs text-text-muted">{t('app.nodes', language as Language)}</p>
            </div>
            <div className="p-3 rounded-lg bg-surface text-center">
              <p className="text-lg font-semibold text-text-primary ">{edgeCount}</p>
              <p className="text-xs text-text-muted">{t('app.edges', language as Language)}</p>
            </div>
            <div className="p-3 rounded-lg bg-surface text-center">
              <p className="text-lg font-semibold text-text-primary ">{template.usageCount}</p>
              <p className="text-xs text-text-muted">{t('app.uses', language as Language)}</p>
            </div>
          </div>

          {/* Rating */}
          <div>
            <p className="text-sm font-medium text-text-primary mb-2">
              {t('app.rating2', language as Language)}: {template.rating ? template.rating.toFixed(1) : '-'}
            </p>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  onClick={() => onRate(template.id, star)}
                  className="hover:scale-110 transition-transform"
                >
                  <Star
                    size={24}
                    fill={
                      (ratingState[template.id] !== undefined
                        ? ratingState[template.id] >= star
                        : (template.rating || 0) >= star)
                        ? 'currentColor'
                        : 'none'
                    }
                    className={
                      (ratingState[template.id] !== undefined
                        ? ratingState[template.id] >= star
                        : (template.rating || 0) >= star)
                        ? 'text-amber-400'
                        : 'text-text-muted '
                    }
                  />
                </button>
              ))}
            </div>
          </div>

          {/* Tags */}
          {template.tags && template.tags.length > 0 && (
            <div>
              <p className="text-sm font-medium text-text-primary mb-2">
                {t('app.tags2', language as Language)}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {template.tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-0.5 rounded text-xs bg-surface-hover text-text-secondary "
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-5 border-t border-border ">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-border text-text-secondary text-sm font-medium hover:bg-surface "
          >
            {t('app.cancel2', language as Language)}
          </button>
          <button
            onClick={() => {
              onUse(template)
              onClose()
            }}
            className="px-4 py-2 rounded-lg bg-blue-500 text-white text-sm font-medium hover:bg-blue-600 transition-colors"
          >
            {t('app.usethistemplate', language as Language)}
          </button>
        </div>
      </div>
    </div>
  )
}