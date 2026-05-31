import { useState, useCallback, useEffect, useMemo } from 'react'
import { BookOpen, Loader2, FileUp, Link, Plus, Network, Activity } from 'lucide-react'
import { useStore } from '@store'
import { knowledgeService } from '@intelligence/runtime/knowledgeService'
import {
  type KnowledgeEntry,
  type KnowledgeCategory,
  type KnowledgeSource,
} from '@intelligence/runtime/knowledgeService/providerTypes'
import { EntryCard } from './knowledge/KnowledgeEntryCard'
import { DetailPanel, EmptyDetail } from './knowledge/KnowledgeDetailPanel'
import { AddEntryForm } from './knowledge/KnowledgeAddForm'
import { EmptyList } from './knowledge/KnowledgeSearchBar'
import { BatchActionBar } from './knowledge/KnowledgeBatchBar'
import { AdvancedSearchPanel } from './knowledge/KnowledgeAdvancedSearch'
import { ImportDropZone } from './knowledge/KnowledgeImportDropZone'
import { KnowledgeGraphView } from './knowledge/KnowledgeGraphView'
import { HealthDashboard } from './knowledge/KnowledgeHealthDashboard'
import { TipButton } from './knowledge/TipButton'

type RightView = 'import' | 'graph' | 'health' | 'add' | 'detail' | 'empty'

export function KnowledgeView() {
  const language = useStore((s) => s.language)
  const [entries, setEntries] = useState<KnowledgeEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterCategory, setFilterCategory] = useState<KnowledgeCategory | null>(null)
  const [filterSource, setFilterSource] = useState<KnowledgeSource | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [showUrlInput, setShowUrlInput] = useState(false)
  const [importUrl, setImportUrl] = useState('')
  const [batchMode, setBatchMode] = useState(false)
  const [batchSelectedIds, setBatchSelectedIds] = useState<Set<string>>(new Set())
  const [showAdvancedSearch, setShowAdvancedSearch] = useState(false)
  const [starredOnly, setStarredOnly] = useState(false)
  const [enabledOnly, setEnabledOnly] = useState(false)
  const [dateRange, setDateRange] = useState<{ from: Date | null; to: Date | null }>({ from: null, to: null })
  const [rightView, setRightView] = useState<RightView>('empty')

  const t = (zh: string, en: string) => (language === 'zh' ? zh : en)

  const switchView = useCallback((view: RightView) => {
    setRightView((prev) => (prev === view ? 'empty' : view))
    if (view !== 'detail') {
      setSelectedId(null)
    }
  }, [])

  const loadEntries = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true)
    try {
      const all = await knowledgeService.getEntries()
      setEntries(all)
    } catch {
      // silent
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    loadEntries(true)
  }, [loadEntries])

  const selectedEntry = useMemo(
    () => entries.find((e) => e.id === selectedId) || null,
    [entries, selectedId],
  )

  useEffect(() => {
    if (selectedEntry) {
      setRightView('detail')
    } else if (rightView === 'detail') {
      setRightView('empty')
    }
  }, [selectedEntry])

  const filteredEntries = useMemo(() => {
    return entries.filter((e) => {
      if (filterCategory && e.category !== filterCategory) return false
      if (filterSource && e.source !== filterSource) return false
      if (starredOnly && !e.starred) return false
      if (enabledOnly && !e.enabled) return false
      if (dateRange.from && e.updatedAt < dateRange.from.getTime()) return false
      if (dateRange.to && e.updatedAt > dateRange.to.getTime() + 86400000) return false
      if (searchQuery) {
        const q = searchQuery.toLowerCase()
        return (
          e.title.toLowerCase().includes(q) ||
          e.content.toLowerCase().includes(q) ||
          e.tags.some((tag) => tag.toLowerCase().includes(q))
        )
      }
      return true
    })
  }, [entries, filterCategory, filterSource, searchQuery, starredOnly, enabledOnly, dateRange])

  const starredEntries = useMemo(
    () => filteredEntries.filter((e) => e.starred),
    [filteredEntries],
  )
  const normalEntries = useMemo(
    () => filteredEntries.filter((e) => !e.starred),
    [filteredEntries],
  )

  const handleAdd = useCallback(
    async (data: {
      title: string
      content: string
      category: KnowledgeCategory
      tags: string
    }) => {
      if (!data.content.trim()) return
      await knowledgeService.addEntry({
        title: data.title.trim() || undefined,
        content: data.content.trim(),
        category: data.category,
        tags: data.tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
        source: 'user',
      })
      setRightView('empty')
      loadEntries()
    },
    [loadEntries],
  )

  const handleDelete = useCallback(
    async (id: string) => {
      await knowledgeService.deleteEntry(id)
      if (selectedId === id) setSelectedId(null)
      loadEntries()
    },
    [selectedId, loadEntries],
  )

  const handleToggleEnabled = useCallback(
    async (id: string) => {
      const entry = entries.find((e) => e.id === id)
      if (!entry) return
      await knowledgeService.updateEntry(id, { enabled: !entry.enabled })
      loadEntries()
    },
    [entries, loadEntries],
  )

  const handleToggleStar = useCallback(
    async (id: string) => {
      const entry = entries.find((e) => e.id === id)
      if (!entry) return
      await knowledgeService.updateEntry(id, { starred: !entry.starred })
      loadEntries()
    },
    [entries, loadEntries],
  )

  const handleStartEdit = useCallback((entry: KnowledgeEntry) => {
    setEditingId(entry.id)
    setEditContent(entry.content)
  }, [])

  const handleSaveEdit = useCallback(async () => {
    if (!editingId || !editContent.trim()) return
    await knowledgeService.updateEntry(editingId, {
      content: editContent.trim(),
    })
    setEditingId(null)
    setEditContent('')
    loadEntries()
  }, [editingId, editContent, loadEntries])

  const handleCopy = useCallback(async (entry: KnowledgeEntry) => {
    await navigator.clipboard.writeText(entry.content)
    setCopiedId(entry.id)
    setTimeout(() => setCopiedId(null), 1500)
  }, [])

  const handleUrlImport = useCallback(async () => {
    if (!importUrl.trim()) return
    setImporting(true)
    try {
      await knowledgeService.importFromUrl(importUrl.trim())
      setImportUrl('')
      setShowUrlInput(false)
      loadEntries()
    } catch {
      // silent
    }
    setImporting(false)
  }, [importUrl, loadEntries])

  const toggleBatchSelect = useCallback((id: string) => {
    setBatchSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const handleBatchUpdate = useCallback(
    async (updates: {
      enabled?: boolean
      starred?: boolean
      category?: KnowledgeCategory
      addTags?: string[]
      removeTags?: string[]
    }) => {
      await knowledgeService.batchUpdateEntries(
        [...batchSelectedIds],
        updates,
      )
      setBatchSelectedIds(new Set())
      setBatchMode(false)
      loadEntries()
    },
    [batchSelectedIds, loadEntries],
  )

  const handleBatchDelete = useCallback(async () => {
    await knowledgeService.batchDeleteEntries([...batchSelectedIds])
    setBatchSelectedIds(new Set())
    setBatchMode(false)
    loadEntries()
  }, [batchSelectedIds, loadEntries])

  const clearBatchSelection = useCallback(() => {
    setBatchSelectedIds(new Set())
    setBatchMode(false)
  }, [])

  const enabledCount = entries.filter((e) => e.enabled).length

  return (
    <div className="h-full flex bg-transparent">
      <div className="w-[380px] min-w-[320px] flex flex-col border-r border-border/30 bg-transparent flex-shrink-0">
        <div className="h-12 px-4 flex items-center justify-between gap-2 border-b border-border/50 flex-shrink-0">
          <span className="min-w-0 flex-shrink-0 whitespace-nowrap text-[13px] font-black text-text-secondary uppercase tracking-[0.2em] font-sans">
            {t('知识库', 'Knowledge')}
          </span>
          <div className="flex items-center gap-1.5">
            <span className="text-[12px] text-text-muted tabular-nums mr-1">
              {enabledCount}/{entries.length}
            </span>
            {importing && <Loader2 className="w-4 h-4 text-accent animate-spin" />}
            <TipButton
              onClick={() => switchView('import')}
              disabled={importing}
              active={rightView === 'import'}
              tip={t('导入文件', 'Import Files')}
              className="p-1"
            >
              <FileUp className="w-4 h-4" />
            </TipButton>
            <TipButton
              onClick={() => setShowUrlInput(!showUrlInput)}
              disabled={importing}
              tip={t('导入 URL', 'Import URL')}
              className="p-1"
            >
              <Link className="w-4 h-4" />
            </TipButton>
            <TipButton
              onClick={() => switchView('add')}
              active={rightView === 'add'}
              tip={t('添加知识', 'Add Knowledge')}
              className="p-1"
            >
              <Plus className="w-4 h-4" />
            </TipButton>
            <TipButton
              onClick={() => switchView('graph')}
              active={rightView === 'graph'}
              tip={t('知识图谱', 'Knowledge Graph')}
              className="p-1"
            >
              <Network className="w-4 h-4" />
            </TipButton>
            <TipButton
              onClick={() => switchView('health')}
              active={rightView === 'health'}
              tip={t('健康度', 'Health')}
              className="p-1"
            >
              <Activity className="w-4 h-4" />
            </TipButton>
          </div>
        </div>

        <div className="px-3 py-2 flex-shrink-0">
          <AdvancedSearchPanel
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            filterCategory={filterCategory}
            onFilterCategoryChange={setFilterCategory}
            filterSource={filterSource}
            onFilterSourceChange={setFilterSource}
            showAdvanced={showAdvancedSearch}
            onToggleAdvanced={() => setShowAdvancedSearch(!showAdvancedSearch)}
            starredOnly={starredOnly}
            onStarredOnlyChange={setStarredOnly}
            enabledOnly={enabledOnly}
            onEnabledOnlyChange={setEnabledOnly}
            dateRange={dateRange}
            onDateRangeChange={setDateRange}
            entries={entries}
            language={language}
          />
          {showUrlInput && (
            <div className="flex items-center gap-2 px-3 py-2 mt-2 bg-surface/30 rounded-lg border border-accent/20">
              <Link className="w-4 h-4 text-text-muted flex-shrink-0" />
              <input
                value={importUrl}
                onChange={(e) => setImportUrl(e.target.value)}
                placeholder={t('输入 URL...', 'Enter URL...')}
                className="flex-1 bg-transparent text-[13px] text-text-primary outline-none placeholder:text-text-muted"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleUrlImport()
                }}
              />
              <button
                onClick={handleUrlImport}
                disabled={!importUrl.trim() || importing}
                className="text-[12px] text-accent hover:text-accent/80 disabled:opacity-40 px-1"
              >
                {t('导入', 'Import')}
              </button>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-text-muted">
              <BookOpen className="w-10 h-10 mb-3 opacity-30 animate-pulse" />
              <p className="text-[13px]">{t('加载中...', 'Loading...')}</p>
            </div>
          ) : filteredEntries.length === 0 ? (
            <EmptyList hasEntries={entries.length > 0} language={language} />
          ) : (
            <>
              {!batchMode && filteredEntries.length > 1 && (
                <div className="px-3 py-1.5 flex items-center justify-between">
                  <span className="text-[11px] text-text-muted">
                    {t(`${filteredEntries.length} 条结果`, `${filteredEntries.length} results`)}
                  </span>
                  <button
                    onClick={() => setBatchMode(true)}
                    className="text-[11px] text-text-muted hover:text-accent transition-colors"
                  >
                    {t('批量操作', 'Batch')}
                  </button>
                </div>
              )}
              {starredEntries.length > 0 && (
                <div className="mb-2">
                  <div className="px-3 py-1.5 text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                    {t('收藏', 'Starred')}
                  </div>
                  {starredEntries.map((entry) => (
                    <EntryCard
                      key={entry.id}
                      entry={entry}
                      isSelected={selectedId === entry.id}
                      isBatchSelected={batchSelectedIds.has(entry.id)}
                      batchMode={batchMode}
                      searchQuery={searchQuery}
                      onSelect={() => setSelectedId(entry.id)}
                      onToggleBatchSelect={() => toggleBatchSelect(entry.id)}
                      onToggleEnabled={() => handleToggleEnabled(entry.id)}
                      onToggleStar={() => handleToggleStar(entry.id)}
                      onDelete={() => handleDelete(entry.id)}
                      language={language}
                    />
                  ))}
                </div>
              )}
              {normalEntries.length > 0 && (
                <div>
                  {starredEntries.length > 0 && (
                    <div className="px-3 py-1.5 text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                      {t('全部', 'All')}
                    </div>
                  )}
                  {normalEntries.map((entry) => (
                    <EntryCard
                      key={entry.id}
                      entry={entry}
                      isSelected={selectedId === entry.id}
                      isBatchSelected={batchSelectedIds.has(entry.id)}
                      batchMode={batchMode}
                      searchQuery={searchQuery}
                      onSelect={() => setSelectedId(entry.id)}
                      onToggleBatchSelect={() => toggleBatchSelect(entry.id)}
                      onToggleEnabled={() => handleToggleEnabled(entry.id)}
                      onToggleStar={() => handleToggleStar(entry.id)}
                      onDelete={() => handleDelete(entry.id)}
                      language={language}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {batchMode && (
          <BatchActionBar
            selectedIds={[...batchSelectedIds]}
            language={language}
            onBatchUpdate={handleBatchUpdate}
            onBatchDelete={handleBatchDelete}
            onClearSelection={clearBatchSelection}
          />
        )}
      </div>

      <div className="flex-1 min-w-0 bg-surface/10">
        {rightView === 'import' ? (
          <ImportDropZone
            language={language}
            onImportFiles={async (paths) => {
              setImporting(true)
              for (const filePath of paths) {
                try {
                  await knowledgeService.importFromFile(filePath)
                } catch {
                  // skip failed
                }
              }
              setImporting(false)
              loadEntries()
              setRightView('empty')
            }}
            onClose={() => setRightView('empty')}
          />
        ) : rightView === 'graph' ? (
          <KnowledgeGraphView
            language={language}
            onClose={() => setRightView('empty')}
          />
        ) : rightView === 'health' ? (
          <HealthDashboard
            entries={entries}
            language={language}
            onClose={() => setRightView('empty')}
          />
        ) : rightView === 'add' ? (
          <AddEntryForm
            language={language}
            onAdd={handleAdd}
            onCancel={() => setRightView('empty')}
          />
        ) : selectedEntry ? (
          <DetailPanel
            entry={selectedEntry}
            editingId={editingId}
            editContent={editContent}
            copiedId={copiedId}
            language={language}
            onStartEdit={() => handleStartEdit(selectedEntry)}
            onSaveEdit={handleSaveEdit}
            onCancelEdit={() => {
              setEditingId(null)
              setEditContent('')
            }}
            onEditContentChange={setEditContent}
            onCopy={() => handleCopy(selectedEntry)}
            onToggleEnabled={() => handleToggleEnabled(selectedEntry.id)}
            onToggleStar={() => handleToggleStar(selectedEntry.id)}
            onDelete={() => handleDelete(selectedEntry.id)}
          />
        ) : (
          <EmptyDetail language={language} />
        )}
      </div>
    </div>
  )
}
