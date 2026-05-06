import { useState, useCallback, useEffect } from 'react'
import {
  Plus, Trash2, Search, BookOpen, Star, Copy, Check,
  Edit2, X, ToggleLeft, ToggleRight, Tag,
  FileUp, Link, Loader2, Database, Globe, User, FileText,
} from 'lucide-react'
import { useStore } from '@store'
import { knowledgeService } from '@/renderer/agent/services/knowledgeService'
import { api } from '@/renderer/services/electronAPI'
import {
  type KnowledgeEntry,
  type KnowledgeCategory,
  type KnowledgeSource,
  KNOWLEDGE_CATEGORIES,
} from '@/renderer/agent/services/knowledgeService/types'

const SOURCE_CONFIG: Record<KnowledgeSource, { zh: string; en: string; icon: typeof User; color: string }> = {
  user: { zh: '手动', en: 'Manual', icon: User, color: 'text-blue-400' },
  file: { zh: '文件', en: 'File', icon: FileText, color: 'text-emerald-400' },
  url: { zh: '网页', en: 'URL', icon: Globe, color: 'text-purple-400' },
  database: { zh: '数据库', en: 'Database', icon: Database, color: 'text-amber-400' },
  'web-crawl': { zh: '爬取', en: 'Crawl', icon: Globe, color: 'text-cyan-400' },
  migrated: { zh: '迁移', en: 'Migrated', icon: FileText, color: 'text-text-muted' },
}

export function KnowledgeView() {
  const language = useStore(s => s.language)
  const [entries, setEntries] = useState<KnowledgeEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterCategory, setFilterCategory] = useState<KnowledgeCategory | null>(null)
  const [filterSource, setFilterSource] = useState<KnowledgeSource | null>(null)
  const [isAdding, setIsAdding] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newContent, setNewContent] = useState('')
  const [newCategory, setNewCategory] = useState<KnowledgeCategory>('concept')
  const [newTags, setNewTags] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [showUrlInput, setShowUrlInput] = useState(false)
  const [importUrl, setImportUrl] = useState('')

  const t = (zh: string, en: string) => (language === 'zh' ? zh : en)

  const loadEntries = useCallback(async () => {
    setLoading(true)
    try {
      const all = await knowledgeService.getEntries()
      setEntries(all)
    } catch {
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    loadEntries()
  }, [loadEntries])

  const selectedEntry = entries.find(e => e.id === selectedId)

  const filteredEntries = entries.filter(e => {
    if (filterCategory && e.category !== filterCategory) return false
    if (filterSource && e.source !== filterSource) return false
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      return (
        e.title.toLowerCase().includes(q) ||
        e.content.toLowerCase().includes(q) ||
        e.tags.some(tag => tag.toLowerCase().includes(q))
      )
    }
    return true
  })

  const handleAdd = useCallback(async () => {
    if (!newContent.trim()) return
    await knowledgeService.addEntry({
      title: newTitle.trim() || undefined,
      content: newContent.trim(),
      category: newCategory,
      tags: newTags
        .split(',')
        .map(tag => tag.trim())
        .filter(Boolean),
      source: 'user',
    })
    setNewTitle('')
    setNewContent('')
    setNewTags('')
    setIsAdding(false)
    loadEntries()
  }, [newTitle, newContent, newCategory, newTags, loadEntries])

  const handleDelete = useCallback(
    async (id: string) => {
      await knowledgeService.deleteEntry(id)
      if (selectedId === id) setSelectedId(null)
      loadEntries()
    },
    [selectedId, loadEntries]
  )

  const handleToggleEnabled = useCallback(
    async (id: string, enabled: boolean) => {
      await knowledgeService.updateEntry(id, { enabled: !enabled })
      loadEntries()
    },
    [loadEntries]
  )

  const handleToggleStar = useCallback(
    async (id: string) => {
      const entry = entries.find(e => e.id === id)
      if (!entry) return
      await knowledgeService.updateEntry(id, { starred: !entry.starred })
      loadEntries()
    },
    [entries, loadEntries]
  )

  const handleStartEdit = useCallback((entry: KnowledgeEntry) => {
    setEditingId(entry.id)
    setEditContent(entry.content)
  }, [])

  const handleSaveEdit = useCallback(async () => {
    if (!editingId || !editContent.trim()) return
    await knowledgeService.updateEntry(editingId, { content: editContent.trim() })
    setEditingId(null)
    setEditContent('')
    loadEntries()
  }, [editingId, editContent, loadEntries])

  const handleCopy = useCallback(
    async (entry: KnowledgeEntry) => {
      await navigator.clipboard.writeText(entry.content)
      setCopiedId(entry.id)
      setTimeout(() => setCopiedId(null), 1500)
    },
    []
  )

  const handleFileImport = useCallback(async () => {
    const result = await api.file.open()
    if (!result) return

    setImporting(true)
    try {
      await knowledgeService.importFromFile(result.path)
      loadEntries()
    } catch {
    }
    setImporting(false)
  }, [loadEntries])

  const handleUrlImport = useCallback(async () => {
    if (!importUrl.trim()) return
    setImporting(true)
    try {
      await knowledgeService.importFromUrl(importUrl.trim())
      setImportUrl('')
      setShowUrlInput(false)
      loadEntries()
    } catch {
    }
    setImporting(false)
  }, [importUrl, loadEntries])

  const enabledCount = entries.filter(e => e.enabled).length

  const activeSources = [...new Set(entries.map(e => e.source))]

  return (
    <div className="h-full flex flex-col bg-transparent">
      <div className="h-12 min-w-0 px-4 flex items-center justify-between gap-2 border-b border-border/50 bg-transparent sticky top-0 z-10">
        <span className="min-w-0 flex-shrink-0 whitespace-nowrap text-[13px] font-black text-text-primary/60 uppercase tracking-[0.2em] font-sans">
          {t('知识库', 'Knowledge')}
        </span>
        <div className="flex items-center gap-1.5">
          <span className="text-[12px] text-text-muted/60 tabular-nums mr-1">
            {enabledCount}/{entries.length}
          </span>
          {importing && <Loader2 className="w-4 h-4 text-accent animate-spin" />}
          <button
            onClick={handleFileImport}
            disabled={importing}
            className="p-1 text-text-muted hover:text-accent transition-colors disabled:opacity-40"
            title={t('导入文件', 'Import File')}
          >
            <FileUp className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowUrlInput(!showUrlInput)}
            disabled={importing}
            className="p-1 text-text-muted hover:text-accent transition-colors disabled:opacity-40"
            title={t('导入 URL', 'Import URL')}
          >
            <Link className="w-4 h-4" />
          </button>
          <button
            onClick={() => {
              setIsAdding(true)
              setNewTitle('')
              setNewContent('')
              setNewTags('')
              setNewCategory('concept')
            }}
            className="p-1 text-text-muted hover:text-accent transition-colors"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="px-3 py-2 space-y-2">
        <div className="flex items-center gap-2 px-3 py-2 bg-surface/30 rounded-lg border border-border/20">
          <Search className="w-4 h-4 text-text-muted flex-shrink-0" />
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder={t('搜索知识...', 'Search knowledge...')}
            className="flex-1 bg-transparent text-[13px] text-text-primary outline-none placeholder:text-text-muted/70"
          />
        </div>

        {showUrlInput && (
          <div className="flex items-center gap-2 px-3 py-2 bg-surface/30 rounded-lg border border-accent/20">
            <Link className="w-4 h-4 text-text-muted flex-shrink-0" />
            <input
              value={importUrl}
              onChange={e => setImportUrl(e.target.value)}
              placeholder={t('输入 URL...', 'Enter URL...')}
              className="flex-1 bg-transparent text-[13px] text-text-primary outline-none placeholder:text-text-muted/70"
              onKeyDown={e => {
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

        <div className="flex items-center gap-1.5 flex-wrap">
          {activeSources.map(source => {
            const cfg = SOURCE_CONFIG[source]
            if (!cfg) return null
            return (
              <button
                key={source}
                onClick={() => setFilterSource(filterSource === source ? null : source)}
                className={`text-[12px] px-2.5 py-1 rounded-full transition-colors flex items-center gap-1.5 ${
                  filterSource === source
                    ? 'text-accent bg-accent/10 border border-accent/30'
                    : 'text-text-muted hover:text-text-primary border border-transparent'
                }`}
              >
                <cfg.icon className={`w-3 h-3 ${cfg.color}`} />
                {t(cfg.zh, cfg.en)}
              </button>
            )
          })}
          {activeSources.length > 0 && <span className="text-border/60 mx-0.5">|</span>}
          {KNOWLEDGE_CATEGORIES.slice(0, 5).map(cat => (
            <button
              key={cat.id}
              onClick={() =>
                setFilterCategory(filterCategory === cat.id ? null : cat.id)
              }
              className={`text-[12px] px-2.5 py-1 rounded-full transition-colors ${
                filterCategory === cat.id
                  ? `${cat.color} bg-surface-active border border-current/20`
                  : 'text-text-muted hover:text-text-primary border border-transparent'
              }`}
            >
              {t(cat.labelZh, cat.labelEn)}
            </button>
          ))}
        </div>
      </div>

      {isAdding && (
        <div className="mx-3 mb-2 p-3 bg-surface/40 rounded-lg border border-accent/20 space-y-2.5">
          <input
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            placeholder={t('标题（可选）', 'Title (optional)')}
            className="w-full bg-black/20 rounded-md px-3 py-2 text-[13px] text-text-primary outline-none border border-border/30 focus:border-accent/50"
          />
          <textarea
            value={newContent}
            onChange={e => setNewContent(e.target.value)}
            placeholder={t('输入知识内容...', 'Enter knowledge content...')}
            className="w-full bg-black/20 rounded-md px-3 py-2 text-[13px] text-text-primary outline-none border border-border/30 focus:border-accent/50 resize-none h-24 custom-scrollbar"
            autoFocus
          />
          <div className="flex items-center gap-2">
            <select
              value={newCategory}
              onChange={e => setNewCategory(e.target.value as KnowledgeCategory)}
              className="bg-black/20 border border-border/30 rounded-md px-2.5 py-1.5 text-[12px] text-text-primary outline-none"
            >
              {KNOWLEDGE_CATEGORIES.map(cat => (
                <option key={cat.id} value={cat.id}>
                  {t(cat.labelZh, cat.labelEn)}
                </option>
              ))}
            </select>
            <input
              value={newTags}
              onChange={e => setNewTags(e.target.value)}
              placeholder={t('标签（逗号分隔）', 'Tags (comma separated)')}
              className="flex-1 bg-black/20 border border-border/30 rounded-md px-2.5 py-1.5 text-[12px] text-text-primary outline-none"
            />
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => setIsAdding(false)}
              className="px-3 py-1.5 text-[12px] text-text-muted hover:text-text-primary transition-colors"
            >
              {t('取消', 'Cancel')}
            </button>
            <button
              onClick={handleAdd}
              disabled={!newContent.trim()}
              className="px-3 py-1.5 text-[12px] text-accent hover:text-accent/80 disabled:opacity-40 transition-colors bg-accent/10 rounded-md"
            >
              {t('添加', 'Add')}
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 text-text-muted">
            <BookOpen className="w-10 h-10 mb-3 opacity-30 animate-pulse" />
            <p className="text-[13px]">{t('加载中...', 'Loading...')}</p>
          </div>
        ) : filteredEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-text-muted">
            <BookOpen className="w-10 h-10 mb-3 opacity-30" />
            <p className="text-[13px]">
              {entries.length === 0
                ? t('暂无知识条目', 'No entries yet')
                : t('无匹配结果', 'No matching results')}
            </p>
            {entries.length === 0 && (
              <p className="text-[12px] mt-1.5 text-text-muted/60">
                {t('点击 + 添加知识，或导入文件/URL', 'Click + to add, or import files/URLs')}
              </p>
            )}
          </div>
        ) : (
          filteredEntries.map(entry => {
            const srcConfig = SOURCE_CONFIG[entry.source]
            const SrcIcon = srcConfig?.icon || BookOpen
            return (
              <div
                key={entry.id}
                onClick={() => setSelectedId(entry.id)}
                className={`flex items-center gap-3 px-3 py-2.5 mx-1 rounded-lg cursor-pointer group transition-colors ${
                  selectedId === entry.id ? 'bg-accent/10' : 'hover:bg-surface-hover'
                } ${!entry.enabled ? 'opacity-50' : ''}`}
              >
                <div className="relative flex-shrink-0">
                  <SrcIcon className={`w-4 h-4 ${srcConfig?.color || 'text-text-muted'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-[13px] font-medium text-text-primary truncate">
                      {entry.title}
                    </span>
                    {entry.starred && (
                      <Star className="w-3 h-3 text-amber-400 fill-amber-400 flex-shrink-0" />
                    )}
                  </div>
                  <p className="text-[12px] text-text-muted/70 truncate mt-0.5">
                    {entry.content}
                  </p>
                </div>
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                  <button
                    onClick={e => {
                      e.stopPropagation()
                      handleToggleEnabled(entry.id, entry.enabled)
                    }}
                    className={`p-1 ${
                      entry.enabled ? 'text-accent' : 'text-text-muted'
                    } hover:bg-surface-hover rounded`}
                  >
                    {entry.enabled ? (
                      <ToggleRight className="w-4 h-4" />
                    ) : (
                      <ToggleLeft className="w-4 h-4" />
                    )}
                  </button>
                  <button
                    onClick={e => {
                      e.stopPropagation()
                      handleToggleStar(entry.id)
                    }}
                    className={`p-1 ${
                      entry.starred
                        ? 'text-amber-400'
                        : 'text-text-muted hover:text-amber-400'
                    } hover:bg-surface-hover rounded`}
                  >
                    <Star className="w-4 h-4" />
                  </button>
                  <button
                    onClick={e => {
                      e.stopPropagation()
                      handleDelete(entry.id)
                    }}
                    className="p-1 text-text-muted hover:text-red-400 hover:bg-surface-hover rounded"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>

      {selectedEntry && (
        <div className="border-t border-border/30 bg-surface/20 p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 min-w-0 flex-1 mr-2">
              {(() => {
                const srcCfg = SOURCE_CONFIG[selectedEntry.source]
                const SrcIcon = srcCfg?.icon || BookOpen
                return <SrcIcon className={`w-4 h-4 flex-shrink-0 ${srcCfg?.color || 'text-text-muted'}`} />
              })()}
              <span className="text-sm font-medium text-text-primary truncate">
                {selectedEntry.title}
              </span>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                onClick={() => handleCopy(selectedEntry)}
                className="p-1.5 text-text-muted hover:text-text-primary transition-colors rounded hover:bg-surface-hover"
              >
                {copiedId === selectedEntry.id ? (
                  <Check className="w-4 h-4 text-green-400" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
              {editingId === selectedEntry.id ? (
                <>
                  <button
                    onClick={handleSaveEdit}
                    className="p-1.5 text-green-400 hover:bg-green-500/10 rounded"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => {
                      setEditingId(null)
                      setEditContent('')
                    }}
                    className="p-1.5 text-text-muted hover:text-red-400 hover:bg-red-500/10 rounded"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <button
                  onClick={() => handleStartEdit(selectedEntry)}
                  className="p-1.5 text-text-muted hover:text-accent transition-colors rounded hover:bg-surface-hover"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {editingId === selectedEntry.id ? (
            <textarea
              value={editContent}
              onChange={e => setEditContent(e.target.value)}
              className="w-full bg-black/20 rounded-md px-3 py-2 text-[13px] text-text-primary outline-none border border-accent/30 resize-none h-28 custom-scrollbar"
              autoFocus
            />
          ) : (
            <p className="text-[13px] text-text-muted leading-relaxed line-clamp-5 whitespace-pre-wrap">
              {selectedEntry.content}
            </p>
          )}

          <div className="flex gap-1.5 mt-3 flex-wrap items-center">
            {selectedEntry.tags.length > 0 && selectedEntry.tags.map(tag => (
              <span
                key={tag}
                className="text-[12px] px-2 py-0.5 bg-accent/10 text-accent rounded-full inline-flex items-center gap-1"
              >
                <Tag className="w-3 h-3" />
                {tag}
              </span>
            ))}
            <span className="text-[12px] text-text-muted/50 ml-auto flex items-center gap-1.5">
              {(() => {
                const srcCfg = SOURCE_CONFIG[selectedEntry.source]
                return srcCfg ? t(srcCfg.zh, srcCfg.en) : selectedEntry.source
              })()}
              {selectedEntry.sourceDetail && (
                <span className="text-text-muted/30 truncate max-w-[120px]">
                  · {selectedEntry.sourceDetail}
                </span>
              )}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
