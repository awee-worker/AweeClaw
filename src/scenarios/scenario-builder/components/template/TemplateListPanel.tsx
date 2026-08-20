/**
 * 模板画廊面板
 *
 * 完整模板浏览体验：
 * - 顶栏：标题 + 搜索框 + 筛选标签（类型 / 分类）
 * - 主体：模板卡片网格（响应式布局）
 * - 弹窗：模板预览（TemplatePreviewDialog）/ 从模板创建（TemplateCreateDialog）
 *
 * 设计要点：
 * - 分类筛选采用横向标签，点击即过滤
 * - 搜索支持中英文模糊匹配（名称 / 描述 / 标签）
 * - 卡片网格响应式：1 列 → 2 列 → 3 列 → 4 列
 * - 创建成功后自动关闭对话框并触发外部回调
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import type React from 'react'
import { useI18n } from '@renderer/i18n'
import { Search, X } from 'lucide-react'
import { templateService } from '../../services'
import { getTemplateTypes, getTemplateCategories } from '../../templates'
import type { ScenarioTemplate } from '../../templates/types'
import type { CreateProjectResult } from '../../types'
import TemplateCard from './TemplateCard'
import TemplatePreviewDialog from './TemplatePreviewDialog'
import TemplateCreateDialog from './TemplateCreateDialog'

/** 筛选状态 */
interface FilterState {
  type: 'all' | 'declarative' | 'programmatic'
  category: 'all' | 'basic' | 'advanced' | 'official'
  keyword: string
}

const TemplateListPanel: React.FC = () => {
  const { t } = useI18n()

  // 模板列表（从 templateService 拉取）
  const [templates, setTemplates] = useState<ScenarioTemplate[]>([])
  const [loading, setLoading] = useState(true)

  // 筛选状态
  const [filter, setFilter] = useState<FilterState>({
    type: 'all',
    category: 'all',
    keyword: '',
  })

  // 弹窗状态
  const [previewTemplate, setPreviewTemplate] = useState<ScenarioTemplate | null>(null)
  const [createTemplate, setCreateTemplate] = useState<ScenarioTemplate | null>(null)

  // 加载模板列表
  useEffect(() => {
    void loadTemplates()
  }, [])

  const loadTemplates = useCallback(async () => {
    setLoading(true)
    try {
      const list = await templateService.listTemplates()
      setTemplates(list)
    } catch (err) {
      console.error('[TemplateListPanel] Failed to load templates:', err)
      setTemplates([])
    } finally {
      setLoading(false)
    }
  }, [])

  // 应用筛选
  const filteredTemplates = useMemo(() => {
    let list = templates

    if (filter.type !== 'all') {
      list = list.filter((tpl) => tpl.type === filter.type)
    }

    if (filter.category !== 'all') {
      list = list.filter((tpl) => tpl.category === filter.category)
    }

    const kw = filter.keyword.toLowerCase().trim()
    if (kw) {
      list = list.filter((tpl) => {
        const haystack = [
          tpl.id,
          tpl.name,
          tpl.nameZh,
          tpl.description,
          tpl.descriptionZh,
          ...tpl.tags,
        ].join(' ').toLowerCase()
        return haystack.includes(kw)
      })
    }

    return list
  }, [templates, filter])

  // 类型与分类筛选项
  const typeOptions = useMemo(() => [
    { value: 'all' as const, label: t('builder.template.filterAll'), labelZh: '全部' },
    ...getTemplateTypes(),
  ], [t])

  const categoryOptions = useMemo(() => [
    { value: 'all' as const, label: t('builder.template.filterAll'), labelZh: '全部' },
    ...getTemplateCategories(),
  ], [t])

  // 处理预览
  const handlePreview = useCallback((template: ScenarioTemplate) => {
    setPreviewTemplate(template)
  }, [])

  // 处理使用模板（打开创建对话框）
  const handleUse = useCallback((template: ScenarioTemplate) => {
    setPreviewTemplate(null)
    setCreateTemplate(template)
  }, [])

  // 创建成功回调
  const handleCreated = useCallback((result: CreateProjectResult) => {
    setCreateTemplate(null)
    // 通知外部（如项目列表面板刷新）
    if (result.success) {
      window.dispatchEvent(new CustomEvent('scenario-builder:project-created', {
        detail: { projectId: result.project?.id, localPath: result.localPath },
      }))
    }
  }, [])

  return (
    <div className="flex h-full flex-col">
      {/* 顶栏：标题 + 搜索 + 筛选 */}
      <div className="border-b border-border p-3 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium">{t('builder.template.title')}</h2>
          <span className="text-xs text-muted-foreground">
            {filteredTemplates.length}/{templates.length}
          </span>
        </div>

        {/* 搜索框 */}
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={filter.keyword}
            onChange={(e) => setFilter((prev) => ({ ...prev, keyword: e.target.value }))}
            placeholder={t('builder.template.searchPlaceholder')}
            className="w-full rounded border border-border bg-background py-1.5 pl-7 pr-7 text-xs"
          />
          {filter.keyword && (
            <button
              onClick={() => setFilter((prev) => ({ ...prev, keyword: '' }))}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={t('builder.common.cancel')}
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* 类型筛选 */}
        <div className="flex flex-wrap gap-1">
          {typeOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setFilter((prev) => ({ ...prev, type: opt.value }))}
              className={`rounded px-2 py-0.5 text-[12px] transition-colors ${
                filter.type === opt.value
                  ? 'bg-accent text-accent-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {opt.labelZh}
            </button>
          ))}
        </div>

        {/* 分类筛选 */}
        <div className="flex flex-wrap gap-1">
          {categoryOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setFilter((prev) => ({ ...prev, category: opt.value }))}
              className={`rounded px-2 py-0.5 text-[12px] transition-colors ${
                filter.category === opt.value
                  ? 'bg-accent text-accent-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {opt.labelZh}
            </button>
          ))}
        </div>
      </div>

      {/* 主体：模板卡片网格 */}
      <div className="flex-1 overflow-y-auto p-3">
        {loading ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            {t('builder.common.loading')}
          </div>
        ) : filteredTemplates.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
            <span>{t('builder.template.empty')}</span>
            {filter.keyword && (
              <button
                onClick={() => setFilter({ type: 'all', category: 'all', keyword: '' })}
                className="text-accent hover:underline"
              >
                {t('builder.template.clearFilter')}
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filteredTemplates.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                onPreview={handlePreview}
                onUse={handleUse}
              />
            ))}
          </div>
        )}
      </div>

      {/* 预览弹窗 */}
      {previewTemplate && (
        <TemplatePreviewDialog
          template={previewTemplate}
          onClose={() => setPreviewTemplate(null)}
          onUse={handleUse}
        />
      )}

      {/* 创建项目弹窗 */}
      {createTemplate && (
        <TemplateCreateDialog
          template={createTemplate}
          onClose={() => setCreateTemplate(null)}
          onCreated={handleCreated}
        />
      )}
    </div>
  )
}

export default TemplateListPanel
