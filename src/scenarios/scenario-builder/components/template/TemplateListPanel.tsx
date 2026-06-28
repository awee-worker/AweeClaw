/**
 * 模板列表面板
 *
 * 显示可用场景模板，支持选择模板创建项目。
 */
import type React from 'react'
import { useI18n } from '@renderer/i18n'

interface Template {
  id: string
  name: string
  nameZh: string
  type: 'declarative' | 'programmatic'
  category: string
  description: string
  descriptionZh: string
}

const TEMPLATES: Template[] = [
  {
    id: 'declarative-basic',
    name: 'Declarative Basic',
    nameZh: '声明式基础',
    type: 'declarative',
    category: 'basic',
    description: 'Basic declarative scenario with system prompt',
    descriptionZh: '基础声明式场景，包含系统提示词',
  },
  {
    id: 'declarative-with-tools',
    name: 'Declarative with Tools',
    nameZh: '声明式带工具',
    type: 'declarative',
    category: 'advanced',
    description: 'Declarative scenario with custom tools',
    descriptionZh: '带自定义工具的声明式场景',
  },
  {
    id: 'programmatic-basic',
    name: 'Programmatic Basic',
    nameZh: '编程式基础',
    type: 'programmatic',
    category: 'basic',
    description: 'Basic programmatic scenario with TypeScript',
    descriptionZh: '基础编程式场景，使用 TypeScript',
  },
  {
    id: 'programmatic-full',
    name: 'Programmatic Full',
    nameZh: '编程式完整',
    type: 'programmatic',
    category: 'advanced',
    description: 'Full programmatic scenario with UI, tools, database',
    descriptionZh: '完整编程式场景，包含 UI、工具、数据库',
  },
]

const TemplateListPanel: React.FC = () => {
  const { t, language } = useI18n()

  const typeColors: Record<string, string> = {
    declarative: 'bg-blue-500/10 text-blue-500',
    programmatic: 'bg-purple-500/10 text-purple-500',
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border p-3">
        <h2 className="text-sm font-medium">{t('builder.template.title')}</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {TEMPLATES.map((template) => (
            <div
              key={template.id}
              className="flex flex-col rounded-lg border border-border p-3 transition-all hover:scale-[1.02] hover:border-accent/40 hover:bg-muted/30"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">
                  {language === 'zh' ? template.nameZh : template.name}
                </span>
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${typeColors[template.type]}`}>
                  {t(`builder.type.${template.type}`)}
                </span>
              </div>
              <p className="mt-2 flex-1 text-xs leading-relaxed text-muted-foreground">
                {language === 'zh' ? template.descriptionZh : template.description}
              </p>
              <button className="mt-3 w-full rounded border border-border py-1.5 text-xs hover:bg-accent hover:text-accent-foreground transition-colors">
                {t('builder.template.use')}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default TemplateListPanel
