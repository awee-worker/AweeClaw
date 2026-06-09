import { useState } from 'react'
import {
  Star, Copy, Check, Edit2, X, ToggleLeft, ToggleRight, Trash2, Tag, Clock, Eye, FileText,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  type KnowledgeEntry,
  KNOWLEDGE_CATEGORIES,
} from '@intelligence/runtime/knowledgeService/providerTypes'
import { SOURCE_CONFIG, formatDate } from './KnowledgeEntryCard'
import { TipButton } from './TipButton'
import { t, type Language } from '@renderer/i18n'

type ViewMode = 'preview' | 'source' | 'edit'

interface DetailPanelProps {
  entry: KnowledgeEntry
  editingId: string | null
  editContent: string
  copiedId: string | null
  language: Language
  onStartEdit: () => void
  onSaveEdit: () => void
  onCancelEdit: () => void
  onEditContentChange: (v: string) => void
  onCopy: () => void
  onToggleEnabled: () => void
  onToggleStar: () => void
  onDelete: () => void
}

export function DetailPanel({
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
}: DetailPanelProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('preview')
  const srcConfig = SOURCE_CONFIG[entry.source]
  const SrcIcon = srcConfig?.icon || Star
  const catConfig = KNOWLEDGE_CATEGORIES.find((c) => c.id === entry.category)
  const isEditing = editingId === entry.id

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 py-4 border-b border-border/30 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-surface/60 flex-shrink-0">
              <SrcIcon
                className={`w-5 h-5 ${srcConfig?.color || 'text-text-muted'}`}
              />
            </div>
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold text-text-primary truncate">
                {entry.title}
              </h2>
              <div className="flex items-center gap-2 mt-1">
                {catConfig && (
                  <span
                    className={`text-[12px] px-2 py-0.5 rounded-full ${catConfig.color} bg-current/10`}
                  >
                    {language === 'zh' ? catConfig.labelZh : catConfig.labelEn}
                  </span>
                )}
                <span className="text-[12px] text-text-muted">
                  {srcConfig ? language === 'zh' ? srcConfig.zh : srcConfig.en : entry.source}
                </span>
                {entry.sourceDetail && (
                  <span className="text-[12px] text-text-muted truncate max-w-[160px]">
                    · {entry.sourceDetail}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <TipButton
              onClick={onCopy}
              tip={t('app.copycontent', language as Language)}
              className="p-2 rounded-lg hover:bg-surface-hover"
            >
              {copiedId === entry.id ? (
                <Check className="w-4 h-4 text-green-500" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </TipButton>
            {isEditing ? (
              <>
                <TipButton
                  onClick={onSaveEdit}
                  tip={t('app.save2', language as Language)}
                  className="p-2 text-green-500 hover:bg-green-500/10 rounded-lg"
                >
                  <Check className="w-4 h-4" />
                </TipButton>
                <TipButton
                  onClick={onCancelEdit}
                  tip={t('app.cancel', language as Language)}
                  className="p-2 text-text-muted hover:text-red-500 hover:bg-red-500/10 rounded-lg"
                >
                  <X className="w-4 h-4" />
                </TipButton>
              </>
            ) : (
              <>
                <div className="flex items-center bg-surface/30 rounded-lg border border-border/20 p-0.5">
                  <TipButton
                    onClick={() => setViewMode('preview')}
                    active={viewMode === 'preview'}
                    tip={t('app.markdownpreview', language as Language)}
                    className="p-1 rounded"
                  >
                    <Eye className="w-3.5 h-3.5" />
                  </TipButton>
                  <TipButton
                    onClick={() => setViewMode('source')}
                    active={viewMode === 'source'}
                    tip={t('app.sourceview', language as Language)}
                    className="p-1 rounded"
                  >
                    <FileText className="w-3.5 h-3.5" />
                  </TipButton>
                </div>
                <TipButton
                  onClick={() => {
                    setViewMode('edit')
                    onStartEdit()
                  }}
                  tip={t('app.edit', language as Language)}
                  className="p-2 rounded-lg hover:bg-surface-hover"
                >
                  <Edit2 className="w-4 h-4" />
                </TipButton>
              </>
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
            {entry.enabled ? (
              <ToggleRight className="w-3.5 h-3.5" />
            ) : (
              <ToggleLeft className="w-3.5 h-3.5" />
            )}
            {entry.enabled ? t('app.enabled', language as Language) : t('app.disabled', language as Language)}
          </button>
          <button
            onClick={onToggleStar}
            className={`text-[12px] px-2.5 py-1 rounded-lg transition-colors flex items-center gap-1.5 ${
              entry.starred
                ? 'text-amber-500 bg-amber-50 border border-amber-200'
                : 'text-text-muted bg-surface/30 border border-border/20'
            }`}
          >
            <Star
              className={`w-3.5 h-3.5 ${entry.starred ? 'fill-current' : ''}`}
            />
            {entry.starred ? t('app.starred', language as Language) : t('app.star', language as Language)}
          </button>
          <button
            onClick={onDelete}
            className="text-[12px] px-2.5 py-1 rounded-lg transition-colors flex items-center gap-1.5 text-text-muted bg-surface/30 border border-border/20 hover:text-red-500 hover:border-red-300"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {t('app.delete', language as Language)}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {viewMode === 'edit' || isEditing ? (
          <textarea
            value={editContent}
            onChange={(e) => onEditContentChange(e.target.value)}
            className="w-full bg-surface/30 rounded-xl px-4 py-3 text-[13px] text-text-primary outline-none border border-accent/30 resize-none min-h-[200px] custom-scrollbar leading-relaxed font-mono"
            autoFocus
          />
        ) : viewMode === 'preview' ? (
          <div className="prose prose-invert prose-sm max-w-none text-[13px] text-text-secondary leading-[1.8]">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {entry.content}
            </ReactMarkdown>
          </div>
        ) : (
          <div className="text-[13px] text-text-secondary leading-[1.8] whitespace-pre-wrap font-mono">
            {entry.content}
          </div>
        )}
      </div>

      <div className="px-5 py-3 border-t border-border/20 bg-surface/10">
        <div className="flex items-center gap-1.5 flex-wrap">
          {entry.tags.length > 0 &&
            entry.tags.map((tag) => (
              <span
                key={tag}
                className="text-[12px] px-2 py-0.5 bg-accent/10 text-accent rounded-full inline-flex items-center gap-1"
              >
                <Tag className="w-3 h-3" />
                {tag}
              </span>
            ))}
          <div className="flex items-center gap-3 ml-auto text-[12px] text-text-muted">
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {t('app.created', language as Language)} {formatDate(entry.createdAt, language)}
            </span>
            <span className="flex items-center gap-1">
              {t('app.updated', language as Language)} {formatDate(entry.updatedAt, language)}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

export function EmptyDetail({ language }: { language: Language }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-text-muted">
      <Star className="w-16 h-16 mb-4 opacity-30" />
      <p className="text-[14px] font-medium">
        {t('app.selectanentryto', language)}
      </p>
      <p className="text-[12px] mt-1 text-text-muted">
        {t('app.orclicktoadd', language)}
      </p>
    </div>
  )
}
