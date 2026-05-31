import { useState } from 'react'
import {
  type KnowledgeCategory,
  KNOWLEDGE_CATEGORIES,
} from '@intelligence/runtime/knowledgeService/providerTypes'

interface AddEntryFormProps {
  language: string
  onAdd: (data: {
    title: string
    content: string
    category: KnowledgeCategory
    tags: string
  }) => void
  onCancel: () => void
}

export function AddEntryForm({ language, onAdd, onCancel }: AddEntryFormProps) {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [category, setCategory] = useState<KnowledgeCategory>('concept')
  const [tags, setTags] = useState('')
  const t = (zh: string, en: string) => (language === 'zh' ? zh : en)

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 py-4 border-b border-border/30">
        <h3 className="text-[14px] font-semibold text-text-primary">
          {t('添加知识', 'Add Knowledge')}
        </h3>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        <div>
          <label className="text-[12px] text-text-secondary mb-1.5 block">
            {t('标题', 'Title')}
          </label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('输入标题（可选）', 'Enter title (optional)')}
            className="w-full bg-surface/30 rounded-lg px-3 py-2.5 text-[13px] text-text-primary outline-none border border-border/30 focus:border-accent/50 transition-colors placeholder:text-text-muted"
          />
        </div>
        <div>
          <label className="text-[12px] text-text-secondary mb-1.5 block">
            {t('内容', 'Content')}
          </label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={t('输入知识内容...', 'Enter knowledge content...')}
            className="w-full bg-surface/30 rounded-lg px-3 py-2.5 text-[13px] text-text-primary outline-none border border-border/30 focus:border-accent/50 resize-none min-h-[180px] custom-scrollbar leading-relaxed placeholder:text-text-muted"
            autoFocus
          />
        </div>
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <label className="text-[12px] text-text-secondary mb-1.5 block">
              {t('分类', 'Category')}
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as KnowledgeCategory)}
              className="w-full bg-surface/30 border border-border/30 rounded-lg px-3 py-2 text-[13px] text-text-primary outline-none focus:border-accent/50 transition-colors"
            >
              {KNOWLEDGE_CATEGORIES.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {t(cat.labelZh, cat.labelEn)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <label className="text-[12px] text-text-secondary mb-1.5 block">
              {t('标签', 'Tags')}
            </label>
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
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
