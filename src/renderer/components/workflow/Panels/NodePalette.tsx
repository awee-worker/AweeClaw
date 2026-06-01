import { useState, useCallback, useMemo, useRef } from 'react'
import type { WorkflowNodeTypeV2 } from '@shared/protocols/workflowV2'
import { NODE_CATEGORY_MAP, NODE_TYPE_LABELS, NODE_CATEGORY_LABELS } from '@shared/protocols/workflowV2'
import { getNodeColor, getNodeIcon, getNodeLabel } from '../shared/nodeTypes'
import { Search, X, ChevronDown, Blocks, Sparkles } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { t, type Language } from '@renderer/i18n'

interface NodePaletteProps {
  onAddNode: (type: WorkflowNodeTypeV2) => void
  language?: 'en' | 'zh'
}

const CATEGORY_ORDER = ['agent', 'interaction', 'flow', 'tool', 'data', 'control', 'output'] as const

const RECOMMENDED_TYPES: WorkflowNodeTypeV2[] = [
  'agent_task',
  'user_input',
  'condition',
  'variable_set',
  'code_runner',
  'http_request',
  'knowledge_query',
  'notification',
]

const RECOMMENDED_ZH: Partial<Record<WorkflowNodeTypeV2, string>> = {
  agent_task: '让AI执行任务',
  user_input: '让用户输入信息',
  condition: '根据条件分支',
  variable_set: '设置工作流变量',
  code_runner: '自定义代码处理',
  http_request: '调用外部API',
  knowledge_query: '查询知识库',
  notification: '推送消息通知',
}

const RECOMMENDED_EN: Partial<Record<WorkflowNodeTypeV2, string>> = {
  agent_task: 'AI task execution',
  user_input: 'Collect user input',
  condition: 'Branch by condition',
  variable_set: 'Set workflow variable',
  code_runner: 'Custom code processor',
  http_request: 'Call external API',
  knowledge_query: 'Search knowledge base',
  notification: 'Send notification',
}

export default function NodePalette({ onAddNode, language = 'zh' }: NodePaletteProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set())
  const searchInputRef = useRef<HTMLInputElement>(null)

  const toggleCategory = useCallback((cat: string) => {
    setCollapsedCategories(prev => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat); else next.add(cat)
      return next
    })
  }, [])

  const clearSearch = useCallback(() => {
    setSearchQuery('')
    searchInputRef.current?.focus()
  }, [])

  const groupedTypes = useMemo(() => {
    const allTypes = (Object.keys(NODE_TYPE_LABELS) as WorkflowNodeTypeV2[]).filter(t => t !== 'start')
    const q = searchQuery.trim().toLowerCase()
    const filtered = q
      ? allTypes.filter(type => {
          const labels = NODE_TYPE_LABELS[type]
          return (
            labels.en.toLowerCase().includes(q) ||
            labels.zh.includes(q) ||
            labels.descEn.toLowerCase().includes(q) ||
            labels.descZh.includes(q) ||
            type.includes(q)
          )
        })
      : allTypes

    const groups: Record<string, WorkflowNodeTypeV2[]> = {}
    for (const type of filtered) {
      const cat = NODE_CATEGORY_MAP[type]?.category || 'agent'
      if (!groups[cat]) groups[cat] = []
      groups[cat].push(type)
    }
    return { groups, hasResults: filtered.length > 0 }
  }, [searchQuery])

  const isSearching = searchQuery.trim().length > 0

  return (
    <aside className="w-[248px] flex-shrink-0 border-r border-gray-200/80 bg-white flex flex-col h-full overflow-hidden select-none">
      {/* Header */}
      <div className="px-4 pt-3.5 pb-2">
        <div className="flex items-center gap-2">
          <div className="p-1 rounded-md bg-blue-50">
            <Blocks className="w-3.5 h-3.5 text-blue-500" />
          </div>
          <div>
            <h3 className="text-xs font-semibold text-gray-700 leading-tight">
              {t('wf.nodepalette', language as Language)}
            </h3>
            <p className="text-[10px] text-gray-400 leading-tight mt-0.5">
              {t('wf.clickordragtoadd', language as Language)}
            </p>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder={t('wf.searchnodes', language as Language)}
            className="w-full h-8 pl-7 pr-7 text-[11px] rounded-lg border border-gray-200 bg-gray-50 text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-blue-400/50 focus:bg-white transition-all"
          />
          {searchQuery && (
            <button
              onClick={clearSearch}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-gray-200/60 text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Node List */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-2 pb-2 scroll-smooth">
        {/* Quick Start / Recommended Section */}
        {!isSearching && (
          <RecommendedSection language={language} onAddNode={onAddNode} />
        )}

        {/* No Results */}
        {isSearching && !groupedTypes.hasResults && (
          <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
            <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mb-3">
              <Search className="w-4 h-4 text-gray-400" />
            </div>
            <p className="text-xs text-gray-500 font-medium">
              {t('wf.nomatchingnodes', language as Language)}
            </p>
            <p className="text-[10px] text-gray-400 mt-1">
              {t('wf.tryadifferentkeyword', language as Language)}
            </p>
          </div>
        )}

        {/* Search Results or All Categories */}
        <AnimatePresence initial={false}>
          {CATEGORY_ORDER.map(category => {
            const types = groupedTypes.groups[category]
            if (!types || types.length === 0) return null

            const catLabels = NODE_CATEGORY_LABELS[category]
            const catLabel = language === 'zh' ? catLabels.zh : catLabels.en
            const isCollapsed = collapsedCategories.has(category)

            return (
              <motion.div
                key={category}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.15 }}
                className="mb-1"
              >
                <CategorySection
                  category={category}
                  label={catLabel}
                  count={types.length}
                  isCollapsed={isCollapsed}
                  onToggle={toggleCategory}
                >
                  {!isCollapsed && (
                    <div className="space-y-0.5">
                      {types.map(type => (
                        <PaletteItem
                          key={type}
                          type={type}
                          language={language}
                          onAddNode={onAddNode}
                          isSearching={isSearching}
                        />
                      ))}
                    </div>
                  )}
                </CategorySection>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </aside>
  )
}

/* ===== Recommended Section ===== */

function RecommendedSection({
  language,
  onAddNode,
}: {
  language: 'en' | 'zh'
  onAddNode: (type: WorkflowNodeTypeV2) => void
}) {
  return (
    <div className="mb-2">
      <div className="flex items-center gap-1.5 px-1 mb-1.5">
        <Sparkles className="w-3 h-3 text-amber-500" />
        <span className="text-[10px] font-semibold text-amber-600 tracking-wide">
          {t('wf.quickstart', language as Language)}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-1">
        {RECOMMENDED_TYPES.map(type => {
          const color = getNodeColor(type)
          const label = getNodeLabel(type, language)
          const usage = (language === 'zh' ? RECOMMENDED_ZH[type] : RECOMMENDED_EN[type]) || type
          const iconName = getNodeIcon(type)

          return (
            <button
              key={type}
              onClick={() => onAddNode(type)}
              className="flex flex-col items-center gap-1 p-2 rounded-lg border border-gray-100 hover:border-gray-200 hover:bg-gray-50 active:bg-gray-100 transition-all group"
            >
              <div
                className="flex items-center justify-center w-7 h-7 rounded-lg transition-all group-hover:scale-110 group-hover:shadow-sm"
                style={{ backgroundColor: `${color}15`, color }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  {quickIconSvgPath(iconName)}
                </svg>
              </div>
              <span className="text-[10px] font-medium text-gray-700 text-center leading-tight">
                {label}
              </span>
              <span className="text-[8px] text-gray-400 text-center leading-tight">
                {usage}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* ===== Category Section ===== */

const CATEGORY_COLOR_MAP: Record<string, { dot: string }> = {
  agent: { dot: '#3b82f6' },
  interaction: { dot: '#f59e0b' },
  flow: { dot: '#8b5cf6' },
  tool: { dot: '#14b8a6' },
  data: { dot: '#f97316' },
  control: { dot: '#64748b' },
  output: { dot: '#22c55e' },
}

function CategorySection({
  category,
  label,
  count,
  isCollapsed,
  onToggle,
  children,
}: {
  category: string
  label: string
  count: number
  isCollapsed: boolean
  onToggle: (cat: string) => void
  children: React.ReactNode
}) {
  const colors = CATEGORY_COLOR_MAP[category] ?? CATEGORY_COLOR_MAP.agent

  return (
    <div className="rounded-lg overflow-hidden">
      <button
        onClick={() => onToggle(category)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded-lg transition-colors group"
      >
        <span
          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: colors.dot }}
        />
        <ChevronDown
          className={`w-3 h-3 flex-shrink-0 transition-transform duration-200 text-gray-400 group-hover:text-gray-500 ${
            isCollapsed ? '' : 'rotate-180'
          }`}
        />
        <span className="truncate flex-1 text-left">{label}</span>
        <span className="text-[9px] text-gray-300 tabular-nums">{count}</span>
      </button>
      {children}
    </div>
  )
}

/* ===== Palette Item ===== */

function PaletteItem({
  type,
  language,
  onAddNode,
  isSearching,
}: {
  type: WorkflowNodeTypeV2
  language: 'en' | 'zh'
  onAddNode: (type: WorkflowNodeTypeV2) => void
  isSearching?: boolean
}) {
  const color = getNodeColor(type)
  const label = getNodeLabel(type, language)
  const iconName = getNodeIcon(type)
  const desc = NODE_TYPE_LABELS[type]
  const description = language === 'zh' ? desc.descZh : desc.descEn

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      e.dataTransfer.setData('application/workflow-node-type', type)
      e.dataTransfer.effectAllowed = 'copy'

      const ghost = document.createElement('div')
      ghost.className = 'fixed px-3 py-2 rounded-xl bg-white border border-gray-200 shadow-xl text-xs font-medium text-gray-700 pointer-events-none z-[9999]'
      ghost.textContent = label
      ghost.style.top = '-9999px'
      ghost.style.left = '-9999px'
      document.body.appendChild(ghost)
      e.dataTransfer.setDragImage(ghost, 60, 16)
      requestAnimationFrame(() => document.body.removeChild(ghost))
    },
    [type, label],
  )

  return (
    <button
      onClick={() => onAddNode(type)}
      draggable
      onDragStart={handleDragStart}
      className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left hover:bg-gray-50 active:bg-gray-100 transition-colors duration-150 group cursor-grab active:cursor-grabbing"
      title={description}
    >
      <div
        className="flex items-center justify-center w-6 h-6 rounded-md flex-shrink-0 transition-all duration-150 group-hover:scale-110 group-hover:shadow-sm"
        style={{ backgroundColor: `${color}18`, color }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {detailIconSvgPath(iconName)}
        </svg>
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-medium text-gray-700 truncate leading-tight">
          {label}
        </div>
        {!isSearching && (
          <div className="text-[9px] text-gray-400 truncate leading-tight mt-0.5">
            {description}
          </div>
        )}
      </div>
    </button>
  )
}

/* ===== SVG Path Helpers ===== */

function quickIconSvgPath(name: string): JSX.Element {
  switch (name) {
    case 'Bot': return <><path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path d="M2 14h2" /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" /></>
    case 'MessageSquare': return <><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></>
    case 'GitBranch': return <><line x1="6" y1="3" x2="6" y2="15" /><circle cx="6" cy="3" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" /></>
    case 'Variable': return <><path d="M4 7V4h16v3" /><path d="M9 20h6" /><path d="M12 4v16" /></>
    case 'Terminal': return <><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></>
    case 'Globe': return <><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></>
    case 'BookOpen': return <><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" /></>
    case 'BellRing': return <><path d="M4 22a2 2 0 0 1-2-2m4-6v-2a4 4 0 0 1 4-4h2a4 4 0 0 1 4 4v6m-4-6v14" /><path d="M22 10s-.07 1.14-1.03 2.86M18 8.5S17.93 9.64 16.97 11.36" /></>
    default: return <circle cx="12" cy="12" r="10" />
  }
}

function detailIconSvgPath(name: string): JSX.Element {
  switch (name) {
    case 'Bot': return <><path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path d="M2 14h2" /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" /></>
    case 'Users': return <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>
    case 'GitBranch': return <><line x1="6" y1="3" x2="6" y2="15" /><circle cx="6" cy="3" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" /></>
    case 'Wrench': return <><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" /></>
    case 'Database': return <><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /></>
    case 'Timer': return <><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></>
    case 'FileText': return <><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4h4" /><path d="M10 9H8" /><path d="M16 13H8" /><path d="M16 17H8" /></>
    case 'ArrowLeftRight': return <><path d="M8 3 4 7l4 4" /><path d="M4 7h16" /><path d="m16 21 4-4-4-4" /><path d="M20 17H4" /></>
    case 'Code2': return <><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></>
    case 'Globe': return <><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></>
    case 'Pencil': return <><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></>
    case 'Split': return <><path d="M16 3h5v5" /><path d="M8 3H3v5" /><path d="M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3" /><path d="m15 9 6-6" /></>
    case 'Repeat': return <><path d="m17 2 4 4-4 4" /><path d="M3 11v-1a4 4 0 0 1 4-4h14" /><path d="m7 22-4-4 4-4" /><path d="M21 13v1a4 4 0 0 1-4 4H3" /></>
    case 'GitMerge': return <><circle cx="18" cy="18" r="3" /><circle cx="6" cy="6" r="3" /><path d="M6 21V9a9 9 0 0 0 9 9" /></>
    case 'SquareFunction': return <><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M9 17c2 0 2.8-1 2.8-2.8V10c0-2 1-3.3 3.2-3" /><path d="M9 11.2h5.7" /></>
    case 'Shuffle': return <><path d="m16 3 5 5-5 5" /><path d="M21 8H13a6 6 0 0 0-6 6v1" /><path d="m3 13 5 5-5 5" /><path d="M8 13H3" /></>
    case 'ThumbsUp': return <><path d="M7 10v12" /><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2h0a3.13 3.13 0 0 1 3 3.88Z" /></>
    case 'FormInput': return <><rect width="20" height="12" x="2" y="6" rx="2" /><path d="M12 12h.01" /><path d="M17 12h.01" /><path d="M7 12h.01" /></>
    case 'Album': return <><rect width="18" height="18" x="3" y="3" rx="2" /><polyline points="3 9 9 15 15 9 21 15" /><circle cx="8.5" cy="8.5" r="1.5" /></>
    case 'Clock': return <><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></>
    case 'Webhook': return <><path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2" /><path d="m6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06" /><path d="m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 2.13 7.38" /></>
    case 'Bell': return <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></>
    case 'BookOpen': return <><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" /></>
    case 'Variable': return <><path d="M4 7V4h16v3" /><path d="M9 20h6" /><path d="M12 4v16" /></>
    default: return <circle cx="12" cy="12" r="10" />
  }
}