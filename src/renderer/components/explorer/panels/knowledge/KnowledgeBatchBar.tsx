import { useState, useCallback } from 'react'
import {
  Trash2, ToggleLeft, ToggleRight, Star, Tag, X, Check,
} from 'lucide-react'
import {
  type KnowledgeCategory,
  KNOWLEDGE_CATEGORIES,
} from '@intelligence/runtime/knowledgeService/providerTypes'
import { t, type Language } from '@renderer/i18n'

interface BatchActionBarProps {
  selectedIds: string[]
  language: Language
  onBatchUpdate: (updates: {
    enabled?: boolean
    starred?: boolean
    category?: KnowledgeCategory
    addTags?: string[]
    removeTags?: string[]
  }) => void
  onBatchDelete: () => void
  onClearSelection: () => void
}

export function BatchActionBar({
  selectedIds,
  language,
  onBatchUpdate,
  onBatchDelete,
  onClearSelection,
}: BatchActionBarProps) {
  const [showCategoryPicker, setShowCategoryPicker] = useState(false)
  const [showTagInput, setShowTagInput] = useState(false)
  const [tagInput, setTagInput] = useState('')
  const [tagMode, setTagMode] = useState<'add' | 'remove'>('add')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const handleTagSubmit = useCallback(() => {
    if (!tagInput.trim()) return
    const tags = tagInput
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (tags.length === 0) return
    if (tagMode === 'add') {
      onBatchUpdate({ addTags: tags })
    } else {
      onBatchUpdate({ removeTags: tags })
    }
    setTagInput('')
    setShowTagInput(false)
  }, [tagInput, tagMode, onBatchUpdate])

  if (selectedIds.length === 0) return null

  return (
    <div className="px-3 py-2 bg-accent/5 border-t border-accent/20 flex items-center gap-2 flex-shrink-0">
      <span className="text-[12px] text-accent font-medium mr-1">
        {t('app.selected', language as Language, { count: selectedIds.length })}
      </span>

      <button
        onClick={() => onBatchUpdate({ enabled: true })}
        className="p-1.5 text-text-muted hover:text-green-500 hover:bg-green-500/10 rounded-lg transition-colors"
        title={t('app.batchenable', language as Language)}
      >
        <ToggleRight className="w-4 h-4" />
      </button>
      <button
        onClick={() => onBatchUpdate({ enabled: false })}
        className="p-1.5 text-text-muted hover:text-orange-500 hover:bg-orange-500/10 rounded-lg transition-colors"
        title={t('app.batchdisable', language as Language)}
      >
        <ToggleLeft className="w-4 h-4" />
      </button>
      <button
        onClick={() => onBatchUpdate({ starred: true })}
        className="p-1.5 text-text-muted hover:text-amber-500 hover:bg-amber-500/10 rounded-lg transition-colors"
        title={t('app.batchstar', language as Language)}
      >
        <Star className="w-4 h-4" />
      </button>

      <div className="relative">
        <button
          onClick={() => setShowCategoryPicker(!showCategoryPicker)}
          className="p-1.5 text-text-muted hover:text-accent hover:bg-accent/10 rounded-lg transition-colors"
          title={t('app.changecategory', language as Language)}
        >
          <Tag className="w-4 h-4" />
        </button>
        {showCategoryPicker && (
          <div className="absolute bottom-full left-0 mb-1 bg-surface border border-border/30 rounded-lg shadow-lg py-1 z-50 min-w-[140px]">
            {KNOWLEDGE_CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                onClick={() => {
                  onBatchUpdate({ category: cat.id })
                  setShowCategoryPicker(false)
                }}
                className={`w-full text-left text-[12px] px-3 py-1.5 hover:bg-surface-hover ${cat.color}`}
              >
                {language === 'zh' ? cat.labelZh : cat.labelEn}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="relative">
        <button
          onClick={() => {
            setShowTagInput(!showTagInput)
            setTagMode('add')
          }}
          className="p-1.5 text-text-muted hover:text-accent hover:bg-accent/10 rounded-lg transition-colors text-[12px]"
          title={t('app.tagactions', language as Language)}
        >
          <Tag className="w-4 h-4" />
        </button>
        {showTagInput && (
          <div className="absolute bottom-full left-0 mb-1 bg-surface border border-border/30 rounded-lg shadow-lg p-2 z-50 min-w-[200px]">
            <div className="flex items-center gap-1 mb-2">
              <button
                onClick={() => setTagMode('add')}
                className={`text-[12px] px-2 py-0.5 rounded ${tagMode === 'add' ? 'bg-accent/20 text-accent' : 'text-text-muted'}`}
              >
                {t('app.add', language as Language)}
              </button>
              <button
                onClick={() => setTagMode('remove')}
                className={`text-[12px] px-2 py-0.5 rounded ${tagMode === 'remove' ? 'bg-red-500/20 text-red-500' : 'text-text-muted'}`}
              >
                {t('app.remove', language as Language)}
              </button>
            </div>
            <div className="flex items-center gap-1">
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                placeholder={t('app.commaseparatedtags', language as Language)}
                className="flex-1 bg-surface/30 border border-border/30 rounded px-2 py-1 text-[12px] text-text-primary outline-none"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleTagSubmit()
                }}
              />
              <button
                onClick={handleTagSubmit}
                className="p-1 text-accent hover:bg-accent/10 rounded"
              >
                <Check className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex-1" />

      {confirmDelete ? (
        <div className="flex items-center gap-1">
          <span className="text-[12px] text-red-500">
            {t('app.confirmdelete', language as Language)}
          </span>
          <button
            onClick={() => {
              onBatchDelete()
              setConfirmDelete(false)
            }}
            className="p-1 text-red-500 hover:bg-red-500/10 rounded-lg"
          >
            <Check className="w-4 h-4" />
          </button>
          <button
            onClick={() => setConfirmDelete(false)}
            className="p-1 text-text-muted hover:bg-surface-hover rounded-lg"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => setConfirmDelete(true)}
          className="p-1.5 text-text-muted hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-colors"
          title={t('app.batchdelete', language as Language)}
        >
          <Trash2 className="w-4 h-4" />
        </button>
      )}

      <button
        onClick={onClearSelection}
        className="p-1.5 text-text-muted hover:text-text-primary hover:bg-surface-hover rounded-lg transition-colors"
        title={t('app.clearselection', language as Language)}
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}
