import { useState, useCallback, useEffect } from 'react'
import {
  Plus, Trash2, Search, BookOpen, Star, Copy, Check,
  Edit2, X, ToggleLeft, ToggleRight, Tag, Layers,
  FileUp, Link, Loader2,
} from 'lucide-react'
import { useStore } from '@store'
import { knowledgeService } from '@/renderer/agent/services/knowledgeService'
import { api } from '@/renderer/services/electronAPI'
import {
  type KnowledgeEntry,
  type KnowledgeCategory,
  type KnowledgeLayer,
  KNOWLEDGE_CATEGORIES,
} from '@/renderer/agent/services/knowledgeService/types'

const LAYER_LABELS: Record<KnowledgeLayer, { zh: string; en: string }> = {
  manual: { zh: '手动', en: 'Manual' },
  conversation: { zh: '对话', en: 'Conversation' },
  codebase: { zh: '代码', en: 'Codebase' },
}

export function KnowledgeView() {
  const language = useStore(s => s.language)
  const [entries, setEntries] = useState<KnowledgeEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterCategory, setFilterCategory] = useState<KnowledgeCategory | null>(null)
  const [filterLayer, setFilterLayer] = useState<KnowledgeLayer | null>(null)
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
      // ignore
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    loadEntries()
  }, [loadEntries])

  const selectedEntry = entries.find(e => e.id === selectedId)

  const filteredEntries = entries.filter(e => {
    if (filterCategory && e.category !== filterCategory) return false
    if (filterLayer && e.layer !== filterLayer) return false
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      return (
        e.title.toLowerCase().includes(q) ||
        e.content.toLowerCase().includes(q) ||
        e.tags.some(t => t.toLowerCase().includes(q))
      )
    }
    return true
  })

  const handleAdd = useCallback(async () => {
    if (!newContent.trim()) return
    await knowledgeService.addEntry({
      title: newTitle.trim() || undefined,
      content: newContent.trim(),
      layer: 'manual',
      category: newCategory,
      tags: newTags
        .split(',')
        .map(t => t.trim())
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
      // ignore
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
      // ignore
    }
    setImporting(false)
  }, [importUrl, loadEntries])

  const enabledCount = entries.filter(e => e.enabled).length

  return (
    <div className="h-full flex flex-col bg-transparent">
      <div className="h-11 min-w-0 px-4 flex items-center justify-between gap-2 group border-b border-border/50 bg-transparent sticky top-0 z-10">
        <span className="min-w-0 flex-shrink-0 whitespace-nowrap text-[11px] font-black text-text-primary/60 uppercase tracking-[0.2em] font-sans">
          {t('知识库', 'Knowledge')}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-text-muted/60 tabular-nums">
            {enabledCount}/{entries.length}
          </span>
          {importing && <Loader2 className="w-3 h-3 text-accent animate-spin" />}
          <button
            onClick={handleFileImport}
            disabled={importing}
            className="p-1 text-text-muted hover:text-accent transition-colors disabled:opacity-40"
            title={t('导入文件', 'Import File')}
          >
            <FileUp className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setShowUrlInput(!showUrlInput)}
            disabled={importing}
            className="p-1 text-text-muted hover:text-accent transition-colors disabled:opacity-40"
            title={t('导入 URL', 'Import URL')}
          >
            <Link className="w-3.5 h-3.5" />
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
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="px-3 py-2 space-y-2">
        <div className="flex items-center gap-2 px-2 py-1.5 bg-surface/30 rounded-md border border-border/20">
          <Search className="w-3 h-3 text-text-muted flex-shrink-0" />
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder={t('搜索知识...', 'Search knowledge...')}
            className="flex-1 bg-transparent text-[11px] text-text-primary outline-none placeholder:text-text-muted/70"
          />
        </div>

        {showUrlInput && (
          <div className="flex items-center gap-1.5 px-2 py-1.5 bg-surface/30 rounded-md border border-accent/20">
            <Link className="w-3 h-3 text-text-muted flex-shrink-0" />
            <input
              value={importUrl}
              onChange={e => setImportUrl(e.target.value)}
              placeholder={t('输入 URL...', 'Enter URL...')}
              className="flex-1 bg-transparent text-[11px] text-text-primary outline-none placeholder:text-text-muted/70"
              onKeyDown={e => {
                if (e.key === 'Enter') handleUrlImport()
              }}
            />
            <button
              onClick={handleUrlImport}
              disabled={!importUrl.trim() || importing}
              className="text-[10px] text-accent hover:text-accent/80 disabled:opacity-40"
            >
              {t('导入', 'Import')}
            </button>
          </div>
        )}

        <div className="flex flex-wrap gap-1">
          {(['manual', 'conversation'] as KnowledgeLayer[]).map(layer => (
            <button
              key={layer}
              onClick={() => setFilterLayer(filterLayer === layer ? null : layer)}
              className={`text-[10px] px-1.5 py-0.5 rounded transition-colors flex items-center gap-0.5 ${
                filterLayer === layer
                  ? 'text-accent bg-accent/10'
                  : 'text-text-muted hover:text-text-primary'
              }`}
            >
              <Layers className="w-2.5 h-2.5" />
              {t(LAYER_LABELS[layer].zh, LAYER_LABELS[layer].en)}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-1">
          {KNOWLEDGE_CATEGORIES.slice(0, 6).map(cat => (
            <button
              key={cat.id}
              onClick={() =>
                setFilterCategory(filterCategory === cat.id ? null : cat.id)
              }
              className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                filterCategory === cat.id
                  ? `${cat.color} bg-surface-active`
                  : 'text-text-muted hover:text-text-primary'
              }`}
            >
              {t(cat.labelZh, cat.labelEn)}
            </button>
          ))}
        </div>
      </div>

      {isAdding && (
        <div className="mx-3 mb-2 p-2.5 bg-surface/40 rounded-lg border border-accent/20 space-y-2">
          <input
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            placeholder={t('标题（可选）', 'Title (optional)')}
            className="w-full bg-black/20 rounded px-2 py-1 text-[11px] text-text-primary outline-none border border-border/30 focus:border-accent/50"
          />
          <textarea
            value={newContent}
            onChange={e => setNewContent(e.target.value)}
            placeholder={t('输入知识内容...', 'Enter knowledge content...')}
            className="w-full bg-black/20 rounded px-2 py-1 text-[11px] text-text-primary outline-none border border-border/30 focus:border-accent/50 resize-none h-16 custom-scrollbar"
            autoFocus
          />
          <div className="flex items-center gap-2">
            <select
              value={newCategory}
              onChange={e => setNewCategory(e.target.value as KnowledgeCategory)}
              className="bg-black/20 border border-border/30 rounded px-1.5 py-0.5 text-[10px] text-text-primary outline-none"
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
              className="flex-1 bg-black/20 border border-border/30 rounded px-1.5 py-0.5 text-[10px] text-text-primary outline-none"
            />
          </div>
          <div className="flex items-center justify-end gap-1.5">
            <button
              onClick={() => setIsAdding(false)}
              className="px-2 py-0.5 text-[10px] text-text-muted hover:text-text-primary transition-colors"
            >
              {t('取消', 'Cancel')}
            </button>
            <button
              onClick={handleAdd}
              disabled={!newContent.trim()}
              className="px-2 py-0.5 text-[10px] text-accent hover:text-accent/80 disabled:opacity-40 transition-colors"
            >
              {t('添加', 'Add')}
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 text-text-muted">
            <BookOpen className="w-8 h-8 mb-2 opacity-30 animate-pulse" />
            <p className="text-xs">{t('加载中...', 'Loading...')}</p>
          </div>
        ) : filteredEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-text-muted">
            <BookOpen className="w-8 h-8 mb-2 opacity-30" />
            <p className="text-xs">
              {entries.length === 0
                ? t('暂无知识条目', 'No entries yet')
                : t('无匹配结果', 'No matching results')}
            </p>
            {entries.length === 0 && (
              <p className="text-[10px] mt-1 text-text-muted/60">
                {t('点击 + 添加知识，或使用 /remember 命令', 'Click + to add, or use /remember command')}
              </p>
            )}
          </div>
        ) : (
          filteredEntries.map(entry => {
            const catConfig = KNOWLEDGE_CATEGORIES.find(c => c.id === entry.category)
            return (
              <div
                key={entry.id}
                onClick={() => setSelectedId(entry.id)}
                className={`flex items-start gap-2 px-2 py-1.5 mx-1 rounded-md cursor-pointer group transition-colors ${
                  selectedId === entry.id ? 'bg-accent/10' : 'hover:bg-surface-hover'
                } ${!entry.enabled ? 'opacity-50' : ''}`}
              >
                <BookOpen
                  className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${
                    catConfig?.color || 'text-text-muted'
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] font-medium text-text-primary truncate">
                      {entry.title}
                    </span>
                    {entry.starred && (
                      <Star className="w-2.5 h-2.5 text-amber-400 fill-amber-400 flex-shrink-0" />
                    )}
                    <span
                      className={`text-[9px] px-1 rounded ${
                        entry.layer === 'manual'
                          ? 'bg-blue-500/10 text-blue-400'
                          : entry.layer === 'conversation'
                          ? 'bg-purple-500/10 text-purple-400'
                          : 'bg-emerald-500/10 text-emerald-400'
                      }`}
                    >
                      {t(
                        LAYER_LABELS[entry.layer].zh,
                        LAYER_LABELS[entry.layer].en
                      )}
                    </span>
                  </div>
                  <p className="text-[10px] text-text-muted truncate">
                    {entry.content}
                  </p>
                  {entry.tags.length > 0 && (
                    <div className="flex gap-1 mt-0.5 flex-wrap">
                      {entry.tags.slice(0, 3).map(tag => (
                        <span
                          key={tag}
                          className="text-[9px] px-1 py-0 bg-surface/50 rounded text-text-muted flex items-center gap-0.5"
                        >
                          <Tag className="w-2 h-2" />
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={e => {
                      e.stopPropagation()
                      handleToggleEnabled(entry.id, entry.enabled)
                    }}
                    className={`p-0.5 ${
                      entry.enabled ? 'text-accent' : 'text-text-muted'
                    } hover:bg-surface-hover rounded`}
                  >
                    {entry.enabled ? (
                      <ToggleRight className="w-3 h-3" />
                    ) : (
                      <ToggleLeft className="w-3 h-3" />
                    )}
                  </button>
                  <button
                    onClick={e => {
                      e.stopPropagation()
                      handleToggleStar(entry.id)
                    }}
                    className={`p-0.5 ${
                      entry.starred
                        ? 'text-amber-400'
                        : 'text-text-muted hover:text-amber-400'
                    } hover:bg-surface-hover rounded`}
                  >
                    <Star className="w-3 h-3" />
                  </button>
                  <button
                    onClick={e => {
                      e.stopPropagation()
                      handleDelete(entry.id)
                    }}
                    className="p-0.5 text-text-muted hover:text-red-400 hover:bg-surface-hover rounded"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>

      {selectedEntry && (
        <div className="border-t border-border/30 bg-surface/20 p-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-text-primary truncate flex-1 mr-2">
              {selectedEntry.title}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => handleCopy(selectedEntry)}
                className="p-1 text-text-muted hover:text-text-primary transition-colors"
              >
                {copiedId === selectedEntry.id ? (
                  <Check className="w-3 h-3 text-green-400" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </button>
              {editingId === selectedEntry.id ? (
                <>
                  <button
                    onClick={handleSaveEdit}
                    className="p-1 text-green-400 hover:bg-green-500/10 rounded"
                  >
                    <Check className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => {
                      setEditingId(null)
                      setEditContent('')
                    }}
                    className="p-1 text-text-muted hover:text-red-400 hover:bg-red-500/10 rounded"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </>
              ) : (
                <button
                  onClick={() => handleStartEdit(selectedEntry)}
                  className="p-1 text-text-muted hover:text-accent transition-colors"
                >
                  <Edit2 className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {editingId === selectedEntry.id ? (
            <textarea
              value={editContent}
              onChange={e => setEditContent(e.target.value)}
              className="w-full bg-black/20 rounded px-2 py-1 text-[11px] text-text-primary outline-none border border-accent/30 resize-none h-20 custom-scrollbar"
              autoFocus
            />
          ) : (
            <p className="text-[11px] text-text-muted leading-relaxed line-clamp-4 whitespace-pre-wrap">
              {selectedEntry.content}
            </p>
          )}

          <div className="flex gap-1 mt-1.5 flex-wrap items-center">
            {selectedEntry.tags.map(tag => (
              <span
                key={tag}
                className="text-[9px] px-1 py-0.5 bg-accent/10 text-accent rounded"
              >
                {tag}
              </span>
            ))}
            <span className="text-[9px] text-text-muted/50 ml-auto">
              {t(
                LAYER_LABELS[selectedEntry.layer].zh,
                LAYER_LABELS[selectedEntry.layer].en
              )}
              {' · '}
              {t(
                KNOWLEDGE_CATEGORIES.find(c => c.id === selectedEntry.category)
                  ?.labelZh ?? selectedEntry.category,
                KNOWLEDGE_CATEGORIES.find(c => c.id === selectedEntry.category)
                  ?.labelEn ?? selectedEntry.category
              )}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
