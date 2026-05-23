import { useState, useCallback, useEffect, useMemo } from 'react'
import {
  Plus, Trash2, Search, BookOpen, Star, Copy, Check,
  Edit2, X, ToggleLeft, ToggleRight, Tag,
  FileUp, Link, Loader2, Database, Globe, User, FileText,
  ChevronRight, Clock, Hash,
} from 'lucide-react'
import { useStore } from '@store'
import { knowledgeService } from '@intelligence/runtime/knowledgeService'
import { api } from '../../../adapters/electronBridge'
import {
  type KnowledgeEntry,
  type KnowledgeCategory,
  type KnowledgeSource,
  KNOWLEDGE_CATEGORIES,
} from '@intelligence/runtime/knowledgeService/providerTypes'

const SOURCE_CONFIG: Record<KnowledgeSource, { zh: string; en: string; icon: typeof User; color: string }> = {
  user: { zh: '手动', en: 'Manual', icon: User, color: 'text-blue-500' },
  file: { zh: '文件', en: 'File', icon: FileText, color: 'text-emerald-500' },
  url: { zh: '网页', en: 'URL', icon: Globe, color: 'text-purple-500' },
  database: { zh: '数据库', en: 'Database', icon: Database, color: 'text-amber-500' },
  'web-crawl': { zh: '爬取', en: 'Crawl', icon: Globe, color: 'text-cyan-500' },
  migrated: { zh: '迁移', en: 'Migrated', icon: FileText, color: 'text-text-muted' },
}

function formatDate(ts: number, language: string): string {
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

function EntryCard({
  entry,
  isSelected,
  onSelect,
  onToggleEnabled,
  onToggleStar,
  onDelete,
  language,
}: {
  entry: KnowledgeEntry
  isSelected: boolean
  onSelect: () => void
  onToggleEnabled: () => void
  onToggleStar: () => void
  onDelete: () => void
  language: string
}) {
  const srcConfig = SOURCE_CONFIG[entry.source]
  const SrcIcon = srcConfig?.icon || BookOpen
  const catConfig = KNOWLEDGE_CATEGORIES.find(c => c.id === entry.category)
  const t = (zh: string, en: string) => (language === 'zh' ? zh : en)

  return (
    <div
      onClick={onSelect}
      className={`group relative flex gap-3 px-3 py-3 rounded-xl cursor-pointer transition-all duration-150 ${
        isSelected
          ? 'bg-accent/10 border border-accent/20 shadow-sm'
          : 'hover:bg-surface-hover border border-transparent'
      } ${!entry.enabled ? 'opacity-45' : ''}`}
    >
      <div className="flex-shrink-0 mt-0.5">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center bg-surface/60`}>
          <SrcIcon className={`w-4 h-4 ${srcConfig?.color || 'text-text-muted'}`} />
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[13px] font-medium text-text-primary truncate">
            {entry.title}
          </span>
          {entry.starred && (
            <Star className="w-3 h-3 text-amber-500 fill-amber-500 flex-shrink-0" />
          )}
          {catConfig && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${catConfig.color} bg-current/10 flex-shrink-0`}>
              {t(catConfig.labelZh, catConfig.labelEn)}
            </span>
          )}
        </div>
        <p className="text-[12px] text-text-secondary truncate mt-1 leading-relaxed">
          {entry.content}
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
        <button
          onClick={e => { e.stopPropagation(); onToggleEnabled() }}
          className={`p-1 rounded ${entry.enabled ? 'text-accent' : 'text-text-muted'} hover:bg-surface-hover`}
          title={entry.enabled ? t('禁用', 'Disable') : t('启用', 'Enable')}
        >
          {entry.enabled ? <ToggleRight className="w-3.5 h-3.5" /> : <ToggleLeft className="w-3.5 h-3.5" />}
        </button>
        <button
          onClick={e => { e.stopPropagation(); onToggleStar() }}
          className={`p-1 rounded ${entry.starred ? 'text-amber-500' : 'text-text-muted hover:text-amber-500'} hover:bg-surface-hover`}
          title={t('收藏', 'Star')}
        >
          <Star className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={e => { e.stopPropagation(); onDelete() }}
          className="p-1 rounded text-text-muted hover:text-red-500 hover:bg-surface-hover"
          title={t('删除', 'Delete')}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      {isSelected && (
        <ChevronRight className="w-4 h-4 text-accent absolute right-2 top-1/2 -translate-y-1/2" />
      )}
    </div>
  )
}

function DetailPanel({
  entry,
  editingId,
  editContent,
  copiedId,
  language,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onEditContentChange,
  onCopy,
  onToggleEnabled,
  onToggleStar,
  onDelete,
}: {
  entry: KnowledgeEntry
  editingId: string | null
  editContent: string
  copiedId: string | null
  language: string
  onStartEdit: () => void
  onSaveEdit: () => void
  onCancelEdit: () => void
  onEditContentChange: (v: string) => void
  onCopy: () => void
  onToggleEnabled: () => void
  onToggleStar: () => void
  onDelete: () => void
}) {
  const srcConfig = SOURCE_CONFIG[entry.source]
  const SrcIcon = srcConfig?.icon || BookOpen
  const catConfig = KNOWLEDGE_CATEGORIES.find(c => c.id === entry.category)
  const t = (zh: string, en: string) => (language === 'zh' ? zh : en)
  const isEditing = editingId === entry.id

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 py-4 border-b border-border/30 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-surface/60 flex-shrink-0">
              <SrcIcon className={`w-5 h-5 ${srcConfig?.color || 'text-text-muted'}`} />
            </div>
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold text-text-primary truncate">
                {entry.title}
              </h2>
              <div className="flex items-center gap-2 mt-1">
                {catConfig && (
                  <span className={`text-[11px] px-2 py-0.5 rounded-full ${catConfig.color} bg-current/10`}>
                    {t(catConfig.labelZh, catConfig.labelEn)}
                  </span>
                )}
                <span className="text-[11px] text-text-muted">
                  {srcConfig ? t(srcConfig.zh, srcConfig.en) : entry.source}
                </span>
                {entry.sourceDetail && (
                  <span className="text-[11px] text-text-muted truncate max-w-[160px]">
                    · {entry.sourceDetail}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={onCopy}
              className="p-2 text-text-muted hover:text-text-primary transition-colors rounded-lg hover:bg-surface-hover"
              title={t('复制内容', 'Copy content')}
            >
              {copiedId === entry.id ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
            </button>
            {isEditing ? (
              <>
                <button onClick={onSaveEdit} className="p-2 text-green-500 hover:bg-green-500/10 rounded-lg" title={t('保存', 'Save')}>
                  <Check className="w-4 h-4" />
                </button>
                <button onClick={onCancelEdit} className="p-2 text-text-muted hover:text-red-500 hover:bg-red-500/10 rounded-lg" title={t('取消', 'Cancel')}>
                  <X className="w-4 h-4" />
                </button>
              </>
            ) : (
              <button onClick={onStartEdit} className="p-2 text-text-muted hover:text-accent transition-colors rounded-lg hover:bg-surface-hover" title={t('编辑', 'Edit')}>
                <Edit2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onToggleEnabled}
            className={`text-[12px] px-2.5 py-1 rounded-lg transition-colors flex items-center gap-1.5 ${
              entry.enabled
                ? 'text-accent bg-accent/10 border border-accent/20'
                : 'text-text-muted bg-surface/30 border border-border/20'
            }`}
          >
            {entry.enabled ? <ToggleRight className="w-3.5 h-3.5" /> : <ToggleLeft className="w-3.5 h-3.5" />}
            {entry.enabled ? t('已启用', 'Enabled') : t('已禁用', 'Disabled')}
          </button>
          <button
            onClick={onToggleStar}
            className={`text-[12px] px-2.5 py-1 rounded-lg transition-colors flex items-center gap-1.5 ${
              entry.starred
                ? 'text-amber-500 bg-amber-50 border border-amber-200'
                : 'text-text-muted bg-surface/30 border border-border/20'
            }`}
          >
            <Star className={`w-3.5 h-3.5 ${entry.starred ? 'fill-current' : ''}`} />
            {entry.starred ? t('已收藏', 'Starred') : t('收藏', 'Star')}
          </button>
          <button
            onClick={onDelete}
            className="text-[12px] px-2.5 py-1 rounded-lg transition-colors flex items-center gap-1.5 text-text-muted bg-surface/30 border border-border/20 hover:text-red-500 hover:border-red-300"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {t('删除', 'Delete')}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {isEditing ? (
          <textarea
            value={editContent}
            onChange={e => onEditContentChange(e.target.value)}
            className="w-full bg-surface/30 rounded-xl px-4 py-3 text-[13px] text-text-primary outline-none border border-accent/30 resize-none min-h-[200px] custom-scrollbar leading-relaxed"
            autoFocus
          />
        ) : (
          <div className="text-[13px] text-text-secondary leading-[1.8] whitespace-pre-wrap">
            {entry.content}
          </div>
        )}
      </div>

      <div className="px-5 py-3 border-t border-border/20 bg-surface/10">
        <div className="flex items-center gap-1.5 flex-wrap">
          {entry.tags.length > 0 && entry.tags.map(tag => (
            <span
              key={tag}
              className="text-[11px] px-2 py-0.5 bg-accent/10 text-accent rounded-full inline-flex items-center gap-1"
            >
              <Tag className="w-3 h-3" />
              {tag}
            </span>
          ))}
          <div className="flex items-center gap-3 ml-auto text-[11px] text-text-muted">
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {t('创建', 'Created')} {formatDate(entry.createdAt, language)}
            </span>
            <span className="flex items-center gap-1">
              {t('更新', 'Updated')} {formatDate(entry.updatedAt, language)}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function EmptyDetail({ language }: { language: string }) {
  const t = (zh: string, en: string) => (language === 'zh' ? zh : en)
  return (
    <div className="flex flex-col items-center justify-center h-full text-text-muted">
      <BookOpen className="w-16 h-16 mb-4 opacity-30" />
      <p className="text-[14px] font-medium">{t('选择一条知识查看详情', 'Select an entry to view details')}</p>
      <p className="text-[12px] mt-1 text-text-muted">{t('或点击 + 添加新知识', 'Or click + to add new knowledge')}</p>
    </div>
  )
}

function AddEntryForm({
  language,
  onAdd,
  onCancel,
}: {
  language: string
  onAdd: (data: { title: string; content: string; category: KnowledgeCategory; tags: string }) => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [category, setCategory] = useState<KnowledgeCategory>('concept')
  const [tags, setTags] = useState('')
  const t = (zh: string, en: string) => (language === 'zh' ? zh : en)

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 py-4 border-b border-border/30">
        <h3 className="text-[14px] font-semibold text-text-primary">{t('添加知识', 'Add Knowledge')}</h3>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        <div>
          <label className="text-[12px] text-text-secondary mb-1.5 block">{t('标题', 'Title')}</label>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder={t('输入标题（可选）', 'Enter title (optional)')}
            className="w-full bg-surface/30 rounded-lg px-3 py-2.5 text-[13px] text-text-primary outline-none border border-border/30 focus:border-accent/50 transition-colors placeholder:text-text-muted"
          />
        </div>
        <div>
          <label className="text-[12px] text-text-secondary mb-1.5 block">{t('内容', 'Content')}</label>
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder={t('输入知识内容...', 'Enter knowledge content...')}
            className="w-full bg-surface/30 rounded-lg px-3 py-2.5 text-[13px] text-text-primary outline-none border border-border/30 focus:border-accent/50 resize-none min-h-[180px] custom-scrollbar leading-relaxed placeholder:text-text-muted"
            autoFocus
          />
        </div>
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <label className="text-[12px] text-text-secondary mb-1.5 block">{t('分类', 'Category')}</label>
            <select
              value={category}
              onChange={e => setCategory(e.target.value as KnowledgeCategory)}
              className="w-full bg-surface/30 border border-border/30 rounded-lg px-3 py-2 text-[13px] text-text-primary outline-none focus:border-accent/50 transition-colors"
            >
              {KNOWLEDGE_CATEGORIES.map(cat => (
                <option key={cat.id} value={cat.id}>
                  {t(cat.labelZh, cat.labelEn)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <label className="text-[12px] text-text-secondary mb-1.5 block">{t('标签', 'Tags')}</label>
            <input
              value={tags}
              onChange={e => setTags(e.target.value)}
              placeholder={t('逗号分隔', 'Comma separated')}
              className="w-full bg-surface/30 border border-border/30 rounded-lg px-3 py-2 text-[13px] text-text-primary outline-none focus:border-accent/50 transition-colors placeholder:text-text-muted"
            />
          </div>
        </div>
      </div>
      <div className="px-5 py-3 border-t border-border/20 flex items-center justify-end gap-2">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-[13px] text-text-secondary hover:text-text-primary transition-colors rounded-lg hover:bg-surface-hover"
        >
          {t('取消', 'Cancel')}
        </button>
        <button
          onClick={() => onAdd({ title, content, category, tags })}
          disabled={!content.trim()}
          className="px-4 py-2 text-[13px] text-white bg-accent hover:bg-accent/90 disabled:opacity-40 transition-colors rounded-lg"
        >
          {t('添加', 'Add')}
        </button>
      </div>
    </div>
  )
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
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [showUrlInput, setShowUrlInput] = useState(false)
  const [importUrl, setImportUrl] = useState('')

  const t = (zh: string, en: string) => (language === 'zh' ? zh : en)

  const loadEntries = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true)
    try {
      const all = await knowledgeService.getEntries()
      setEntries(all)
    } catch {
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    loadEntries(true)
  }, [loadEntries])

  const selectedEntry = useMemo(
    () => entries.find(e => e.id === selectedId) || null,
    [entries, selectedId]
  )

  const filteredEntries = useMemo(() => {
    return entries.filter(e => {
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
  }, [entries, filterCategory, filterSource, searchQuery])

  const starredEntries = useMemo(
    () => filteredEntries.filter(e => e.starred),
    [filteredEntries]
  )
  const normalEntries = useMemo(
    () => filteredEntries.filter(e => !e.starred),
    [filteredEntries]
  )

  const handleAdd = useCallback(async (data: { title: string; content: string; category: KnowledgeCategory; tags: string }) => {
    if (!data.content.trim()) return
    await knowledgeService.addEntry({
      title: data.title.trim() || undefined,
      content: data.content.trim(),
      category: data.category,
      tags: data.tags.split(',').map(tag => tag.trim()).filter(Boolean),
      source: 'user',
    })
    setIsAdding(false)
    loadEntries()
  }, [loadEntries])

  const handleDelete = useCallback(
    async (id: string) => {
      await knowledgeService.deleteEntry(id)
      if (selectedId === id) setSelectedId(null)
      loadEntries()
    },
    [selectedId, loadEntries]
  )

  const handleToggleEnabled = useCallback(
    async (id: string) => {
      const entry = entries.find(e => e.id === id)
      if (!entry) return
      await knowledgeService.updateEntry(id, { enabled: !entry.enabled })
      loadEntries()
    },
    [entries, loadEntries]
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
    const paths = await api.file.openKnowledgeFiles()
    if (!paths || paths.length === 0) return
    setImporting(true)
    try {
      for (const filePath of paths) {
        try {
          await knowledgeService.importFromFile(filePath)
        } catch {
        }
      }
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
  const activeSources = useMemo(() => [...new Set(entries.map(e => e.source))], [entries])

  return (
    <div className="h-full flex bg-transparent">
      {/* Left Panel - List */}
      <div className="w-[380px] min-w-[320px] flex flex-col border-r border-border/30 bg-transparent flex-shrink-0">
        {/* Header */}
        <div className="h-12 px-4 flex items-center justify-between gap-2 border-b border-border/50 flex-shrink-0">
          <span className="min-w-0 flex-shrink-0 whitespace-nowrap text-[13px] font-black text-text-secondary uppercase tracking-[0.2em] font-sans">
            {t('知识库', 'Knowledge')}
          </span>
          <div className="flex items-center gap-1.5">
            <span className="text-[12px] text-text-muted tabular-nums mr-1">
              {enabledCount}/{entries.length}
            </span>
            {importing && <Loader2 className="w-4 h-4 text-accent animate-spin" />}
            <button
              onClick={handleFileImport}
              disabled={importing}
              className="p-1 text-text-muted hover:text-accent transition-colors disabled:opacity-40"
              title={t('导入文件', 'Import Files')}
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
              onClick={() => setIsAdding(true)}
              className="p-1 text-text-muted hover:text-accent transition-colors"
              title={t('添加知识', 'Add Knowledge')}
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="px-3 py-2 space-y-2 flex-shrink-0">
          <div className="flex items-center gap-2 px-3 py-2 bg-surface/30 rounded-lg border border-border/20">
            <Search className="w-4 h-4 text-text-muted flex-shrink-0" />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder={t('搜索知识...', 'Search knowledge...')}
              className="flex-1 bg-transparent text-[13px] text-text-primary outline-none placeholder:text-text-muted"
            />
          </div>

          {showUrlInput && (
            <div className="flex items-center gap-2 px-3 py-2 bg-surface/30 rounded-lg border border-accent/20">
              <Link className="w-4 h-4 text-text-muted flex-shrink-0" />
              <input
                value={importUrl}
                onChange={e => setImportUrl(e.target.value)}
                placeholder={t('输入 URL...', 'Enter URL...')}
                className="flex-1 bg-transparent text-[13px] text-text-primary outline-none placeholder:text-text-muted"
                onKeyDown={e => { if (e.key === 'Enter') handleUrlImport() }}
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

          {/* Filters */}
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
            {activeSources.length > 0 && <span className="text-border mx-0.5">|</span>}
            {KNOWLEDGE_CATEGORIES.slice(0, 5).map(cat => (
              <button
                key={cat.id}
                onClick={() => setFilterCategory(filterCategory === cat.id ? null : cat.id)}
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

        {/* Entry List */}
        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-text-muted">
              <BookOpen className="w-10 h-10 mb-3 opacity-30 animate-pulse" />
              <p className="text-[13px]">{t('加载中...', 'Loading...')}</p>
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-text-muted">
              <BookOpen className="w-10 h-10 mb-3 opacity-30" />
              <p className="text-[13px]">
                {entries.length === 0
                  ? t('暂无知识条目', 'No entries yet')
                  : t('无匹配结果', 'No matching results')}
              </p>
              {entries.length === 0 && (
                <p className="text-[12px] mt-1.5 text-text-secondary">
                  {t('点击 + 添加知识，或导入文件/URL', 'Click + to add, or import files/URLs')}
                </p>
              )}
            </div>
          ) : (
            <>
              {starredEntries.length > 0 && (
                <div className="mb-2">
                  <div className="px-3 py-1.5 text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                    {t('收藏', 'Starred')}
                  </div>
                  {starredEntries.map(entry => (
                    <EntryCard
                      key={entry.id}
                      entry={entry}
                      isSelected={selectedId === entry.id}
                      onSelect={() => setSelectedId(entry.id)}
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
                  {normalEntries.map(entry => (
                    <EntryCard
                      key={entry.id}
                      entry={entry}
                      isSelected={selectedId === entry.id}
                      onSelect={() => setSelectedId(entry.id)}
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
      </div>

      {/* Right Panel - Detail / Add */}
      <div className="flex-1 min-w-0 bg-surface/10">
        {isAdding ? (
          <AddEntryForm
            language={language}
            onAdd={handleAdd}
            onCancel={() => setIsAdding(false)}
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
            onCancelEdit={() => { setEditingId(null); setEditContent('') }}
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
