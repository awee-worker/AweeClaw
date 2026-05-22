import { useState, useCallback, useEffect, useRef } from 'react'
import { Search, Star, Download, Loader2, Filter, X, LayoutGrid, List, Eye } from 'lucide-react'
import {
  templateClientAPI,
  CATEGORIES,
  getCategoryLabel,
} from '@shared/configuration/workflows/templateClientAPI'
import type { WorkflowTemplateEntry, TemplateQuery } from '@shared/configuration/workflows/templateClientAPI'

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
        setError(language === 'zh' ? '加载模板失败' : 'Failed to load templates')
        console.error('Template load error:', err)
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
    async (template: WorkflowTemplateEntry) => {
      try {
        await templateClientAPI.recordUse(template.id)
      } catch {
        // Record usage silently
      }
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
        console.error('Rate error:', err)
      }
    },
    [search, typeFilter, categoryFilter, page, fetchTemplates],
  )

  const totalPages = Math.ceil(total / PAGE_SIZE)
  const t = (en: string, zh: string) => (language === 'zh' ? zh : en)

  return (
    <div className="h-full flex flex-col bg-white dark:bg-gray-900">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {t('Template Market', '模板市场')}
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400"
              title={viewMode === 'grid' ? t('List View', '列表视图') : t('Grid View', '网格视图')}
            >
              {viewMode === 'grid' ? <List size={18} /> : <LayoutGrid size={18} />}
            </button>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`p-2 rounded-lg transition-colors ${
                showFilters || typeFilter || categoryFilter
                  ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
                  : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400'
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
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
          />
          <input
            ref={searchInputRef}
            type="text"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder={t('Search templates...', '搜索模板...')}
            className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
          />
          {search && (
            <button
              onClick={() => handleSearchChange('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
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
              className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">{t('All Types', '全部类型')}</option>
              <option value="WORKFLOW">{t('Workflow', '工作流')}</option>
              <option value="CHAT">{t('Chat', '对话')}</option>
              <option value="RAG">{t('RAG', '检索增强')}</option>
            </select>

            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">{t('All Categories', '全部分类')}</option>
              {CATEGORIES.map((cat) => (
                <option key={cat.key} value={cat.key}>
                  {getCategoryLabel(cat.key, language as 'en' | 'zh')}
                </option>
              ))}
            </select>

            {(typeFilter || categoryFilter) && (
              <button
                onClick={clearFilters}
                className="px-3 py-1.5 rounded-lg text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
              >
                {t('Clear Filters', '清除筛选')}
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
              {t('Retry', '重试')}
            </button>
          </div>
        ) : templates.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-3">
            <Download size={48} strokeWidth={1} />
            <p>{t('No templates found', '未找到模板')}</p>
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
        <div className="flex-shrink-0 border-t border-gray-200 dark:border-gray-700 px-4 py-3 flex items-center justify-between">
          <span className="text-sm text-gray-500">
            {t(`Total ${total} templates`, `共 ${total} 个模板`)}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1.5 rounded-lg text-sm border border-gray-200 dark:border-gray-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300"
            >
              {t('Prev', '上一页')}
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
                      : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'
                  }`}
                >
                  {pageNum}
                </button>
              )
            })}
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1.5 rounded-lg text-sm border border-gray-200 dark:border-gray-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300"
            >
              {t('Next', '下一页')}
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
  t: (en: string, zh: string) => string
}) {
  const name = language === 'zh' && template.nameZh ? template.nameZh : template.name
  const desc =
    language === 'zh' && template.descriptionZh
      ? template.descriptionZh
      : template.description
  const category = getCategoryLabel(template.category, language)

  return (
    <div className="group relative bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 hover:border-blue-300 dark:hover:border-blue-700 hover:shadow-md transition-all duration-200">
      {/* Icon & Type Badge */}
      <div className="flex items-start justify-between mb-3">
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/30 dark:to-indigo-900/30 flex items-center justify-center">
          <Download size={20} className="text-blue-500" />
        </div>
        <div className="flex flex-col items-end gap-1">
          {template.isOfficial && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
              {t('Official', '官方')}
            </span>
          )}
          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
            {template.type}
          </span>
        </div>
      </div>

      {/* Name & Description */}
      <h3 className="font-medium text-gray-900 dark:text-gray-100 mb-1 truncate">{name}</h3>
      <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 mb-3 h-8">{desc}</p>

      {/* Tags */}
      {template.tags && template.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {template.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="px-1.5 py-0.5 rounded text-[10px] bg-gray-100 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-3 border-t border-gray-100 dark:border-gray-700/50">
        <div className="flex items-center gap-3 text-xs text-gray-400">
          <span className="flex items-center gap-1">
            <Download size={12} />
            {template.usageCount}
          </span>
          <span className="flex items-center gap-1">
            <Star size={12} className={template.rating ? 'text-amber-400' : ''} />
            {template.rating ? template.rating.toFixed(1) : '-'}
          </span>
          <span className="text-gray-300 dark:text-gray-600">{category}</span>
        </div>
      </div>

      {/* Hover Actions */}
      <div className="absolute inset-0 bg-white/90 dark:bg-gray-800/95 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 z-10">
        <button
          onClick={(e) => {
            e.stopPropagation()
            onUse(template)
          }}
          className="px-4 py-2 rounded-lg bg-blue-500 text-white text-sm font-medium hover:bg-blue-600 transition-colors"
        >
          {t('Use Template', '使用模板')}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onSelect(template)
          }}
          className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        >
          {t('Details', '详情')}
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
            className="text-gray-300 dark:text-gray-600 hover:text-amber-400 transition-colors"
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
  t: (en: string, zh: string) => string
}) {
  const name = language === 'zh' && template.nameZh ? template.nameZh : template.name
  const desc =
    language === 'zh' && template.descriptionZh
      ? template.descriptionZh
      : template.description
  const category = getCategoryLabel(template.category, language)

  return (
    <div className="flex items-center gap-4 p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-700 transition-all">
      <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/30 dark:to-indigo-900/30 flex items-center justify-center flex-shrink-0">
        <Download size={20} className="text-blue-500" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <h3 className="font-medium text-gray-900 dark:text-gray-100 truncate">{name}</h3>
          {template.isOfficial && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
              {t('Official', '官方')}
            </span>
          )}
          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
            {template.type}
          </span>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{desc}</p>
      </div>

      <div className="flex items-center gap-4 flex-shrink-0">
        <span className="text-xs text-gray-400">{category}</span>
        <span className="flex items-center gap-1 text-xs text-gray-400">
          <Download size={12} />
          {template.usageCount}
        </span>
        <span className="flex items-center gap-1 text-xs text-gray-400">
          <Star size={12} className={template.rating ? 'text-amber-400' : ''} />
          {template.rating ? template.rating.toFixed(1) : '-'}
        </span>

        <button
          onClick={() => onUse(template)}
          className="px-3 py-1.5 rounded-lg bg-blue-500 text-white text-xs font-medium hover:bg-blue-600 transition-colors"
        >
          {t('Use', '使用')}
        </button>
        <button
          onClick={() => onSelect(template)}
          className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400"
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
  t: (en: string, zh: string) => string
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
        className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-lg w-full mx-4 max-h-[80vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/30 dark:to-indigo-900/30 flex items-center justify-center">
              <Download size={20} className="text-blue-500" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-gray-100">{name}</h3>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs text-gray-400">{category}</span>
                <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
                  {template.type}
                </span>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">{desc}</p>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-900/50 text-center">
              <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">{nodeCount}</p>
              <p className="text-xs text-gray-400">{t('Nodes', '节点')}</p>
            </div>
            <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-900/50 text-center">
              <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">{edgeCount}</p>
              <p className="text-xs text-gray-400">{t('Edges', '连线')}</p>
            </div>
            <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-900/50 text-center">
              <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">{template.usageCount}</p>
              <p className="text-xs text-gray-400">{t('Uses', '使用')}</p>
            </div>
          </div>

          {/* Rating */}
          <div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {t('Rating', '评分')}: {template.rating ? template.rating.toFixed(1) : '-'}
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
                        : 'text-gray-300 dark:text-gray-600'
                    }
                  />
                </button>
              ))}
            </div>
          </div>

          {/* Tags */}
          {template.tags && template.tags.length > 0 && (
            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t('Tags', '标签')}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {template.tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-0.5 rounded text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-5 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            {t('Cancel', '取消')}
          </button>
          <button
            onClick={() => {
              onUse(template)
              onClose()
            }}
            className="px-4 py-2 rounded-lg bg-blue-500 text-white text-sm font-medium hover:bg-blue-600 transition-colors"
          >
            {t('Use This Template', '使用此模板')}
          </button>
        </div>
      </div>
    </div>
  )
}