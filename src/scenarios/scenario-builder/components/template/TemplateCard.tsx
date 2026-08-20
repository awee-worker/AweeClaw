/**
 * 模板卡片
 *
 * 单个场景模板的卡片展示，包含：
 * - 模板图标 / 类型徽章 / 分类标签
 * - 模板名称（中英文切换）
 * - 模板描述（中英文切换）
 * - 标签列表
 * - 操作按钮：预览 / 使用此模板
 *
 * 设计要点：
 * - 卡片视觉层级清晰：头部（图标+名称+徽章）→ 描述 → 标签 → 操作
 * - 鼠标悬停高亮（边框色 / 轻微缩放）
 * - 类型徽章使用颜色区分（声明式蓝 / 编程式紫）
 * - 标签字号最小 12px（遵循 UI 规范）
 */
import type React from 'react'
import { useI18n } from '@renderer/i18n'
import { getLucideIcon } from '@components/foundation/IconMap'
import type { ScenarioTemplate } from '../../templates/types'

interface TemplateCardProps {
  template: ScenarioTemplate
  onPreview: (template: ScenarioTemplate) => void
  onUse: (template: ScenarioTemplate) => void
}

/** 类型徽章颜色映射 */
const TYPE_BADGE_COLORS: Record<string, string> = {
  declarative: 'bg-blue-500/10 text-blue-500 dark:text-blue-400',
  programmatic: 'bg-purple-500/10 text-purple-500 dark:text-purple-400',
}

/** 分类徽章颜色映射 */
const CATEGORY_BADGE_COLORS: Record<string, string> = {
  basic: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  advanced: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  official: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
}

const TemplateCard: React.FC<TemplateCardProps> = ({ template, onPreview, onUse }) => {
  const { t, language } = useI18n()
  const isZh = language === 'zh'
  const IconComponent = getLucideIcon(template.icon)

  return (
    <div
      className="group relative flex flex-col rounded-lg border border-border bg-background p-3 transition-all hover:scale-[1.01] hover:border-accent/40 hover:bg-muted/30 hover:shadow-md"
      data-template-id={template.id}
    >
      {/* 头部：图标 + 名称 + 类型徽章 */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-accent/10 text-accent"
            aria-hidden="true"
          >
            <IconComponent className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">
              {isZh ? template.nameZh : template.name}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1">
              <span
                className={`shrink-0 rounded px-1.5 py-0.5 text-[12px] font-medium ${TYPE_BADGE_COLORS[template.type]}`}
              >
                {t(`builder.type.${template.type}`)}
              </span>
              <span
                className={`shrink-0 rounded px-1.5 py-0.5 text-[12px] ${CATEGORY_BADGE_COLORS[template.category]}`}
              >
                {t(`builder.template.category.${template.category}`)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 描述 */}
      <p className="mt-2 line-clamp-2 flex-1 text-xs leading-relaxed text-muted-foreground">
        {isZh ? template.descriptionZh : template.description}
      </p>

      {/* 标签 */}
      {template.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {template.tags.slice(0, 4).map((tag) => (
            <span
              key={tag}
              className="rounded bg-muted px-1.5 py-0.5 text-[12px] text-muted-foreground"
            >
              #{tag}
            </span>
          ))}
          {template.tags.length > 4 && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[12px] text-muted-foreground">
              +{template.tags.length - 4}
            </span>
          )}
        </div>
      )}

      {/* 操作 */}
      <div className="mt-3 flex gap-2">
        <button
          onClick={() => onPreview(template)}
          className="flex-1 rounded border border-border py-1.5 text-xs transition-colors hover:bg-muted"
        >
          {t('builder.template.preview')}
        </button>
        <button
          onClick={() => onUse(template)}
          className="flex-1 rounded bg-accent py-1.5 text-xs text-accent-foreground transition-colors hover:bg-accent/90"
        >
          {t('builder.template.use')}
        </button>
      </div>
    </div>
  )
}

export default TemplateCard
