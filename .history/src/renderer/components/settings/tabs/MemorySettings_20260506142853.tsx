import { useState, useEffect, useCallback, useMemo } from 'react'
import { longTermMemoryService } from '@/renderer/agent/services/longTermMemoryService'
import type { MemoryEntry, MemorySource, MemoryStatus } from '@/renderer/agent/services/longTermMemoryService/types'
import { memoryService } from '@/renderer/agent/services/memoryService'
import { Button, Input } from '@components/ui'
import {
  Brain, Plus, Trash2, Edit2, Check, X,
  RefreshCw, Search, ToggleLeft, ToggleRight,
  Clock, Tag, Zap, Eye, Filter
} from 'lucide-react'

interface MemorySettingsProps {
  language: string
}

const SOURCE_LABELS: Record<MemorySource, { zh: string; en: string; color: string }> = {
  user: { zh: '手动', en: 'Manual', color: 'bg-blue-500/20 text-blue-400' },
  auto_extracted: { zh: '自动提取', en: 'Auto', color: 'bg-green-500/20 text-green-400' },
  dreaming_light: { zh: '轻梦', en: 'Light', color: 'bg-purple-500/20 text-purple-400' },
  dreaming_rem: { zh: '深梦', en: 'REM', color: 'bg-amber-500/20 text-amber-400' },
  dreaming_deep: { zh: '沉梦', en: 'Deep', color: 'bg-rose-500/20 text-rose-400' },
}

const STATUS_LABELS: Record<MemoryStatus, { zh: string; en: string; color: string }> = {
  short_term: { zh: '短期', en: 'Short', color: 'bg-cyan-500/20 text-cyan-400' },
  long_term: { zh: '长期', en: 'Long', color: 'bg-accent/20 text-accent' },
  forgotten: { zh: '已遗忘', en: 'Forgotten', color: 'bg-gray-500/20 text-gray-400' },
}

export function MemorySettings({ language }: MemorySettingsProps) {
  const t = (zh: string, en: string) => language === 'zh' ? zh : en

  const [entries, setEntries] = useState<MemoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [newMemory, setNewMemory] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingContent, setEditingContent] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [filterSource, setFilterSource] = useState<MemorySource | 'all'>('all')
  const [filterStatus, setFilterStatus] = useState<MemoryStatus | 'active'>('active')

  const loadEntries = useCallback(async () => {
    setLoading(true)
    try {
      const all = await longTermMemoryService.getEntries()
      setEntries(all)
    } catch {
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadEntries()
  }, [loadEntries])

  const filteredEntries = useMemo(() => {
    let result = entries

    if (filterStatus === 'active') {
      result = result.filter(e => e.status !== 'forgotten')
    } else if (filterStatus === 'short_term') {
      result = result.filter(e => e.status === 'short_term')
    } else if (filterStatus === 'long_term') {
      result = result.filter(e => e.status === 'long_term')
    } else if (filterStatus === 'forgotten') {
      result = result.filter(e => e.status === 'forgotten')
    }

    if (filterSource !== 'all') {
      result = result.filter(e => e.source === filterSource)
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(e =>
        e.content.toLowerCase().includes(q) ||
        e.tags.some(tag => tag.toLowerCase().includes(q))
      )
    }

    return result.sort((a, b) => b.updatedAt - a.updatedAt)
  }, [entries, filterSource, filterStatus, searchQuery])

  const stats = useMemo(() => {
    const active = entries.filter(e => e.status !== 'forgotten')
    return {
      total: entries.length,
      active: active.length,
      enabled: active.filter(e => e.enabled).length,
      shortTerm: entries.filter(e => e.status === 'short_term').length,
      longTerm: entries.filter(e => e.status === 'long_term').length,
      forgotten: entries.filter(e => e.status === 'forgotten').length,
    }
  }, [entries])

  const handleAddMemory = async () => {
    if (!newMemory.trim()) return
    await memoryService.addMemory(newMemory.trim())
    setNewMemory('')
    loadEntries()
  }

  const handleDelete = async (id: string) => {
    await longTermMemoryService.deleteEntry(id)
    loadEntries()
  }

  const handleToggle = async (id: string, enabled: boolean) => {
    await longTermMemoryService.updateEntry(id, { enabled: !enabled })
    loadEntries()
  }

  const handleStartEdit = (item: MemoryEntry) => {
    setEditingId(item.id)
    setEditingContent(item.content)
  }

  const handleSaveEdit = async () => {
    if (!editingId || !editingContent.trim()) return
    await longTermMemoryService.updateEntry(editingId, { content: editingContent.trim() })
    setEditingId(null)
    setEditingContent('')
    loadEntries()
  }

  const handleCancelEdit = () => {
    setEditingId(null)
    setEditingContent('')
  }

  const handleRestore = async (id: string) => {
    await longTermMemoryService.updateEntry(id, { status: 'short_term', enabled: true })
    loadEntries()
  }

  const formatTime = (ts: number) => {
    const d = new Date(ts)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return t('刚刚', 'Just now')
    if (diffMins < 60) return t(`${diffMins} 分钟前`, `${diffMins}m ago`)
    if (diffHours < 24) return t(`${diffHours} 小时前`, `${diffHours}h ago`)
    if (diffDays < 7) return t(`${diffDays} 天前`, `${diffDays}d ago`)
    return d.toLocaleDateString()
  }

  return (
    <div className="space-y-5 animate-fade-in pb-10">
      <div className="p-5 bg-surface/30 rounded-xl border border-border space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
              <Brain className="w-4 h-4 text-accent" />
            </div>
            <div>
              <h5 className="text-sm font-medium text-text-primary">
                {t('上下文记忆', 'Context Memory')}
              </h5>
              <p className="text-xs text-text-muted mt-0.5">
                {t('AI 在对话中自动记住的重要信息', 'Important info AI remembers across conversations')}
              </p>
            </div>
          </div>
          <button
            onClick={loadEntries}
            className="p-1.5 text-text-muted hover:text-accent transition-colors rounded-md hover:bg-accent/10"
            title={t('刷新', 'Refresh')}
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-4 gap-3">
          <div className="p-3 rounded-lg bg-black/20 border border-border/50 text-center">
            <div className="text-lg font-semibold text-text-primary">{stats.active}</div>
            <div className="text-[11px] text-text-muted">{t('活跃记忆', 'Active')}</div>
          </div>
          <div className="p-3 rounded-lg bg-black/20 border border-border/50 text-center">
            <div className="text-lg font-semibold text-cyan-400">{stats.shortTerm}</div>
            <div className="text-[11px] text-text-muted">{t('短期', 'Short')}</div>
          </div>
          <div className="p-3 rounded-lg bg-black/20 border border-border/50 text-center">
            <div className="text-lg font-semibold text-accent">{stats.longTerm}</div>
            <div className="text-[11px] text-text-muted">{t('长期', 'Long')}</div>
          </div>
          <div className="p-3 rounded-lg bg-black/20 border border-border/50 text-center">
            <div className="text-lg font-semibold text-text-muted">{stats.enabled}/{stats.active}</div>
            <div className="text-[11px] text-text-muted">{t('已启用', 'Enabled')}</div>
          </div>
        </div>

        <div className="flex gap-2">
          <Input
            value={newMemory}
            onChange={(e) => setNewMemory(e.target.value)}
            placeholder={t('手动添加记忆内容...', 'Add memory manually...')}
            className="flex-1 bg-black/20 border-border text-xs"
            onKeyDown={(e) => e.key === 'Enter' && handleAddMemory()}
          />
          <Button
            variant="secondary"
            onClick={handleAddMemory}
            disabled={!newMemory.trim()}
            className="px-3 gap-1"
          >
            <Plus className="w-3.5 h-3.5" />
            {t('添加', 'Add')}
          </Button>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('搜索记忆...', 'Search memories...')}
              className="w-full h-7 pl-8 pr-3 text-xs rounded-md bg-black/20 border border-border/50 text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent/50"
            />
          </div>

          <div className="flex items-center gap-1">
            <Filter className="w-3 h-3 text-text-muted" />
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as MemoryStatus | 'active')}
              className="h-7 px-2 text-xs rounded-md bg-black/20 border border-border/50 text-text-primary focus:outline-none focus:border-accent/50"
            >
              <option value="active">{t('活跃', 'Active')}</option>
              <option value="short_term">{t('短期', 'Short-term')}</option>
              <option value="long_term">{t('长期', 'Long-term')}</option>
              <option value="forgotten">{t('已遗忘', 'Forgotten')}</option>
            </select>
          </div>

          <div className="flex items-center gap-1">
            <select
              value={filterSource}
              onChange={(e) => setFilterSource(e.target.value as MemorySource | 'all')}
              className="h-7 px-2 text-xs rounded-md bg-black/20 border border-border/50 text-text-primary focus:outline-none focus:border-accent/50"
            >
              <option value="all">{t('全部来源', 'All Sources')}</option>
              <option value="user">{t('手动', 'Manual')}</option>
              <option value="auto_extracted">{t('自动提取', 'Auto')}</option>
              <option value="dreaming_light">{t('轻梦', 'Light')}</option>
              <option value="dreaming_rem">{t('深梦', 'REM')}</option>
              <option value="dreaming_deep">{t('沉梦', 'Deep')}</option>
            </select>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {loading ? (
          <div className="h-40 flex items-center justify-center text-text-muted">
            <RefreshCw className="w-5 h-5 animate-spin" />
          </div>
        ) : filteredEntries.length === 0 ? (
          <div className="h-40 flex items-center justify-center text-text-muted text-sm">
            {searchQuery || filterSource !== 'all' || filterStatus !== 'active'
              ? t('没有匹配的记忆', 'No matching memories')
              : t('暂无记忆', 'No memories yet')
            }
          </div>
        ) : (
          filteredEntries.map((item) => {
            const sourceInfo = SOURCE_LABELS[item.source]
            const statusInfo = STATUS_LABELS[item.status]
            const isForgotten = item.status === 'forgotten'

            return (
              <div
                key={item.id}
                className={`group p-3.5 rounded-xl border transition-colors ${
                  isForgotten
                    ? 'bg-black/10 border-border/30 opacity-60'
                    : item.enabled
                      ? 'bg-surface/30 border-border hover:border-accent/20'
                      : 'bg-black/15 border-border/40 opacity-70'
                }`}
              >
                {editingId === item.id ? (
                  <div className="flex items-start gap-2">
                    <Input
                      value={editingContent}
                      onChange={(e) => setEditingContent(e.target.value)}
                      className="flex-1 bg-black/30 border-accent/50 text-xs"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveEdit()
                        if (e.key === 'Escape') handleCancelEdit()
                      }}
                    />
                    <button
                      onClick={handleSaveEdit}
                      className="p-1.5 text-green-400 hover:bg-green-500/20 rounded transition-colors"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={handleCancelEdit}
                      className="p-1.5 text-text-muted hover:text-red-400 hover:bg-red-500/20 rounded transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start gap-3">
                      <button
                        onClick={() => handleToggle(item.id, item.enabled)}
                        className={`mt-0.5 p-0.5 transition-colors flex-shrink-0 ${item.enabled ? 'text-accent' : 'text-text-muted'}`}
                        title={item.enabled ? t('禁用', 'Disable') : t('启用', 'Enable')}
                      >
                        {item.enabled ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                      </button>

                      <div className="flex-1 min-w-0">
                        <p className={`text-[13px] leading-relaxed ${isForgotten ? 'text-text-muted line-through' : 'text-text-secondary'}`}>
                          {item.content}
                        </p>

                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${sourceInfo.color}`}>
                            {language === 'zh' ? sourceInfo.zh : sourceInfo.en}
                          </span>
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${statusInfo.color}`}>
                            {language === 'zh' ? statusInfo.zh : statusInfo.en}
                          </span>

                          {item.tags.length > 0 && (
                            <div className="flex items-center gap-1">
                              <Tag className="w-2.5 h-2.5 text-text-muted" />
                              {item.tags.slice(0, 3).map(tag => (
                                <span key={tag} className="text-[10px] text-text-muted bg-black/20 px-1.5 py-0.5 rounded">
                                  {tag}
                                </span>
                              ))}
                              {item.tags.length > 3 && (
                                <span className="text-[10px] text-text-muted">+{item.tags.length - 3}</span>
                              )}
                            </div>
                          )}

                          {item.recallCount > 0 && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] text-text-muted">
                              <Zap className="w-2.5 h-2.5" />
                              {item.recallCount}
                            </span>
                          )}

                          <span className="inline-flex items-center gap-0.5 text-[10px] text-text-muted ml-auto">
                            <Clock className="w-2.5 h-2.5" />
                            {formatTime(item.updatedAt)}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                        {isForgotten ? (
                          <button
                            onClick={() => handleRestore(item.id)}
                            className="p-1.5 text-accent hover:bg-accent/10 rounded transition-colors"
                            title={t('恢复', 'Restore')}
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <>
                            <button
                              onClick={() => handleStartEdit(item)}
                              className="p-1.5 text-text-muted hover:text-accent hover:bg-accent/10 rounded transition-colors"
                              title={t('编辑', 'Edit')}
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDelete(item.id)}
                              className="p-1.5 text-text-muted hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                              title={t('删除', 'Delete')}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )
          })
        )}
      </div>

      <div className="p-4 bg-surface/20 rounded-xl border border-border/50 space-y-2">
        <h6 className="text-xs font-medium text-text-primary">{t('💡 记忆机制说明', '💡 How Memory Works')}</h6>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-[12px] text-text-muted">
          <div className="space-y-1">
            <p className="font-medium text-text-secondary flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-cyan-400" />
              {t('短期记忆', 'Short-term')}
            </p>
            <p>{t('新产生的记忆，需要经过沉淀才能转为长期', 'New memories that need consolidation to become long-term')}</p>
          </div>
          <div className="space-y-1">
            <p className="font-medium text-text-secondary flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-accent" />
              {t('长期记忆', 'Long-term')}
            </p>
            <p>{t('经过 Dreaming 沉淀后晋升的稳定记忆', 'Stable memories promoted through Dreaming consolidation')}</p>
          </div>
          <div className="space-y-1">
            <p className="font-medium text-text-secondary flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-gray-400" />
              {t('已遗忘', 'Forgotten')}
            </p>
            <p>{t('不再活跃的记忆，可手动恢复', 'Inactive memories that can be manually restored')}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
