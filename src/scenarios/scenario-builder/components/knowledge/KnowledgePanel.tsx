/**
 * 知识库面板
 *
 * 显示场景开发文档，支持按主题浏览。
 */
import { useState, useMemo, useCallback } from 'react'
import type React from 'react'
import { SCENARIO_DEV_KNOWLEDGE } from '../../config/prompts-knowledge'
import { useI18n } from '@renderer/i18n'

const TOPICS = [
  { id: 'all', label: 'all', labelZh: '全部' },
  { id: 'types', label: 'types', labelZh: '场景类型' },
  { id: 'manifest', label: 'manifest', labelZh: '清单配置' },
  { id: 'prompts', label: 'prompts', labelZh: '提示词编写' },
  { id: 'tools', label: 'tools', labelZh: '工具开发' },
  { id: 'database', label: 'database', labelZh: '数据库脚本' },
  { id: 'ui', label: 'ui', labelZh: 'UI 布局' },
  { id: 'lifecycle', label: 'lifecycle', labelZh: '生命周期' },
  { id: 'build', label: 'build', labelZh: '构建发布' },
]

const TOPIC_HEADINGS: Record<string, string> = {
  types: '一、场景类型',
  manifest: '三、scenario.json 完整配置',
  prompts: '四、提示词编写',
  tools: '七、自定义工具开发',
  database: '八、数据库脚本',
  ui: '九、UI 布局配置',
  lifecycle: '十、生命周期',
  build: '十一、构建与发布',
}

const KnowledgePanel: React.FC = () => {
  const { t, language } = useI18n()
  const [selectedTopic, setSelectedTopic] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')

  const content = useMemo(() => {
    if (selectedTopic === 'all') {
      return SCENARIO_DEV_KNOWLEDGE
    }
    const heading = TOPIC_HEADINGS[selectedTopic]
    if (!heading) return SCENARIO_DEV_KNOWLEDGE

    const startIdx = SCENARIO_DEV_KNOWLEDGE.indexOf(heading)
    if (startIdx === -1) return SCENARIO_DEV_KNOWLEDGE

    const afterHeading = SCENARIO_DEV_KNOWLEDGE.slice(startIdx + heading.length)
    const nextMatch = afterHeading.match(/\n## [一二三四五六七八九十]+、/)
    const endIdx = nextMatch?.index !== undefined
      ? startIdx + heading.length + nextMatch.index
      : SCENARIO_DEV_KNOWLEDGE.length

    return SCENARIO_DEV_KNOWLEDGE.slice(startIdx, endIdx).trim()
  }, [selectedTopic])

  const filteredContent = useMemo(() => {
    if (!searchQuery.trim()) return content
    const lines = content.split('\n')
    const lower = searchQuery.toLowerCase()
    return lines
      .filter((line) => line.toLowerCase().includes(lower))
      .join('\n')
  }, [content, searchQuery])

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(content)
  }, [content])

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border p-3">
        <h2 className="text-sm font-medium">{t('builder.knowledge.title')}</h2>
      </div>

      {/* 搜索 */}
      <div className="p-2">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t('builder.knowledge.search')}
          className="w-full rounded border border-border bg-background px-2 py-1 text-xs"
        />
      </div>

      {/* 主题标签 */}
      <div className="flex flex-wrap gap-1 border-b border-border p-2">
        {TOPICS.map((topic) => (
          <button
            key={topic.id}
            onClick={() => setSelectedTopic(topic.id)}
            className={`rounded px-2 py-0.5 text-[10px] transition-colors ${
              selectedTopic === topic.id
                ? 'bg-accent text-accent-foreground'
                : 'bg-muted hover:bg-muted/80'
            }`}
          >
            {language === 'zh' ? topic.labelZh : topic.label}
          </button>
        ))}
      </div>

      {/* 内容 */}
      <div className="flex-1 overflow-auto">
        <div className="flex items-center justify-between border-b border-border px-2 py-1">
          <span className="text-[10px] text-muted-foreground">
            {filteredContent.length} chars
          </span>
          <button onClick={handleCopy} className="text-[10px] text-muted-foreground hover:text-foreground">
            {t('builder.knowledge.copy')}
          </button>
        </div>
        <pre className="whitespace-pre-wrap p-3 text-[11px] font-mono leading-relaxed">
          {filteredContent}
        </pre>
      </div>
    </div>
  )
}

export default KnowledgePanel
