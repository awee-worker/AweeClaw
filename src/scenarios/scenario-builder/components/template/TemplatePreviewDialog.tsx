/**
 * 模板预览对话框
 *
 * 展示模板详情，供用户在"使用此模板"前了解模板内容：
 * - 基本信息：图标 / 名称 / 描述 / 标签
 * - 模板配置预览（scenarioConfigOverride 的关键字段）
 * - 文件结构预览（previewStructure 列表）
 * - 可定制变量列表（variables）
 *
 * 设计要点：
 * - 只读视图，不触发任何写操作
 * - 配置预览以分组卡片形式展示，便于阅读
 * - 文件结构用 monospace 字体展示，呈现目录树感
 * - 底部提供"使用此模板"按钮，触发外部的创建流程
 */
import type React from 'react'
import { useI18n } from '@renderer/i18n'
import { getLucideIcon } from '@components/foundation/IconMap'
import { X } from 'lucide-react'
import type { ScenarioTemplate } from '../../templates/types'

interface TemplatePreviewDialogProps {
  template: ScenarioTemplate
  onClose: () => void
  onUse: (template: ScenarioTemplate) => void
}

const TemplatePreviewDialog: React.FC<TemplatePreviewDialogProps> = ({
  template,
  onClose,
  onUse,
}) => {
  const { t, language } = useI18n()
  const isZh = language === 'zh'
  const IconComponent = getLucideIcon(template.icon)

  // 提取 configOverride 的关键字段用于预览
  const configOverride = template.scenarioConfigOverride ?? {}
  const capabilities = (configOverride.capabilities as Record<string, unknown> | undefined) ?? {}
  const builtinTools = (capabilities.builtinTools as string[] | undefined) ?? []
  const modes = (capabilities.modes as Array<Record<string, unknown>> | undefined) ?? []
  const ui = (configOverride.ui as Record<string, unknown> | undefined) ?? {}
  const sidebarItems = (ui.sidebarItems as Array<Record<string, unknown>> | undefined) ?? []
  const scripts = (configOverride.scripts as Record<string, unknown> | undefined) ?? {}
  const scriptTools = (scripts.tools as Array<Record<string, unknown>> | undefined) ?? []
  const database = (configOverride.database as Record<string, unknown> | undefined) ?? {}
  const permissions = (configOverride.permissions as string[] | undefined) ?? []

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-text-inverted/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-border/50 bg-background shadow-2xl shadow-black/20"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-start justify-between gap-3 border-b border-border p-5">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
              <IconComponent className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold">
                {isZh ? template.nameZh : template.name}
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {isZh ? template.descriptionZh : template.description}
              </p>
              {template.tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {template.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded bg-muted px-1.5 py-0.5 text-[12px] text-muted-foreground"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={t('builder.common.close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* 文件结构预览 */}
          {template.previewStructure && template.previewStructure.length > 0 && (
            <section className="mb-4">
              <h3 className="mb-2 text-sm font-medium">
                {t('builder.template.previewStructure')}
              </h3>
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <ul className="space-y-0.5 font-mono text-xs">
                  {template.previewStructure.map((file, idx) => (
                    <li key={idx} className="text-foreground/80">
                      <span className="text-muted-foreground">├── </span>
                      {file}
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}

          {/* 配置预览：能力 */}
          {builtinTools.length > 0 && (
            <section className="mb-4">
              <h3 className="mb-2 text-sm font-medium">
                {t('builder.template.previewBuiltinTools')}
              </h3>
              <div className="flex flex-wrap gap-1">
                {builtinTools.map((tool) => (
                  <span
                    key={tool}
                    className="rounded bg-blue-500/10 px-2 py-0.5 text-[12px] text-blue-600 dark:text-blue-400"
                  >
                    {tool}
                  </span>
                ))}
              </div>
            </section>
          )}

          {modes.length > 0 && (
            <section className="mb-4">
              <h3 className="mb-2 text-sm font-medium">
                {t('builder.template.previewModes')}
              </h3>
              <div className="flex flex-wrap gap-1">
                {modes.map((mode) => (
                  <span
                    key={String(mode.id)}
                    className="rounded bg-purple-500/10 px-2 py-0.5 text-[12px] text-purple-600 dark:text-purple-400"
                  >
                    {isZh ? String(mode.labelZh || mode.id) : String(mode.label || mode.id)}
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* 配置预览：UI 侧边栏 */}
          {sidebarItems.length > 0 && (
            <section className="mb-4">
              <h3 className="mb-2 text-sm font-medium">
                {t('builder.template.previewSidebar')}
              </h3>
              <ul className="space-y-1 text-xs text-muted-foreground">
                {sidebarItems.map((item, idx) => (
                  <li key={idx}>
                    <span className="font-mono text-foreground/80">
                      {String(item.id)}
                    </span>
                    <span className="ml-2">
                      → {isZh ? String(item.labelZh || item.label || '') : String(item.label || item.labelZh || '')}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* 配置预览：自定义脚本工具 */}
          {scriptTools.length > 0 && (
            <section className="mb-4">
              <h3 className="mb-2 text-sm font-medium">
                {t('builder.template.previewScriptTools')}
              </h3>
              <ul className="space-y-1 text-xs">
                {scriptTools.map((tool, idx) => (
                  <li
                    key={idx}
                    className="rounded border border-border bg-muted/30 px-2 py-1"
                  >
                    <div className="font-mono text-foreground/80">
                      {String(tool.name)}
                    </div>
                    <div className="mt-0.5 text-muted-foreground">
                      {isZh ? String(tool.descriptionZh || tool.description || '') : String(tool.description || tool.descriptionZh || '')}
                    </div>
                    {typeof tool.scriptFile === 'string' && (
                      <div className="mt-0.5 font-mono text-[12px] text-muted-foreground">
                        {tool.scriptFile}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* 配置预览：数据库 */}
          {database && Object.keys(database).length > 0 && (
            <section className="mb-4">
              <h3 className="mb-2 text-sm font-medium">
                {t('builder.template.previewDatabase')}
              </h3>
              <div className="rounded-lg border border-border bg-muted/30 p-2 text-xs">
                <pre className="whitespace-pre-wrap font-mono text-foreground/80">
                  {JSON.stringify(database, null, 2)}
                </pre>
              </div>
            </section>
          )}

          {/* 配置预览：权限 */}
          {permissions.length > 0 && (
            <section className="mb-4">
              <h3 className="mb-2 text-sm font-medium">
                {t('builder.template.previewPermissions')}
              </h3>
              <div className="flex flex-wrap gap-1">
                {permissions.map((perm) => (
                  <span
                    key={perm}
                    className="rounded bg-amber-500/10 px-2 py-0.5 text-[12px] text-amber-600 dark:text-amber-400"
                  >
                    {perm}
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* 可定制变量 */}
          {template.variables && template.variables.length > 0 && (
            <section className="mb-4">
              <h3 className="mb-2 text-sm font-medium">
                {t('builder.template.previewVariables')}
              </h3>
              <ul className="space-y-2">
                {template.variables.map((v) => (
                  <li
                    key={v.key}
                    className="rounded border border-border bg-muted/30 p-2"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-foreground/80">
                        {`{{${v.key}}}`}
                      </span>
                      {v.required && (
                        <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-[12px] text-destructive">
                          {t('builder.template.variableRequired')}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {isZh ? v.label : v.labelEn}
                    </div>
                    {v.defaultValue && (
                      <div className="mt-0.5 text-[12px] text-muted-foreground">
                        {t('builder.template.variableDefault')}: <span className="font-mono">{v.defaultValue}</span>
                      </div>
                    )}
                    {v.placeholder && (
                      <div className="mt-0.5 text-[12px] text-muted-foreground">
                        {t('builder.template.variablePlaceholder')}: {v.placeholder}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {/* 底部操作 */}
        <div className="flex justify-end gap-2 border-t border-border p-4">
          <button
            onClick={onClose}
            className="rounded border border-border px-4 py-2 text-sm hover:bg-muted"
          >
            {t('builder.common.close')}
          </button>
          <button
            onClick={() => onUse(template)}
            className="rounded bg-accent px-4 py-2 text-sm text-accent-foreground hover:bg-accent/90"
          >
            {t('builder.template.use')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default TemplatePreviewDialog
