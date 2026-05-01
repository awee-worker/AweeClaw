import { useState, useCallback, useMemo, useEffect } from 'react'
import { Modal } from '../ui/Modal'
import { useStore } from '@store'
import { workflowEngine } from '@shared/types/workflow'
import { builtinWorkflows } from '@shared/config/workflows'
import WorkflowCanvas from './WorkflowCanvas'
import WorkflowRunner from './WorkflowRunner'
import NodeEditor from './NodeEditor'
import WorkflowHistory from './WorkflowHistory'
import type { WorkflowDefinition, WorkflowRun } from '@shared/types/workflow'
import {
  X,
  Play,
  ArrowLeft,
  Search,
  Sparkles,
  Code2,
  FileText,
  Bug,
  RefreshCw,
  Rocket,
  Clock,
} from 'lucide-react'

interface WorkflowPanelProps {
  onClose: () => void
}

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Search,
  Rocket,
  RefreshCw,
  FileText,
  Bug,
}

type ViewMode = 'list' | 'detail' | 'run'
type TabMode = 'workflows' | 'history'

export default function WorkflowPanel({ onClose }: WorkflowPanelProps) {
  const language = useStore(s => s.language)
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [tabMode, setTabMode] = useState<TabMode>('workflows')
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowDefinition | null>(null)
  const [activeRun, setActiveRun] = useState<WorkflowRun | null>(null)
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    for (const wf of builtinWorkflows) {
      if (!workflowEngine.get(wf.id)) {
        workflowEngine.register(wf)
      }
    }
  }, [])

  const workflows = useMemo(() => {
    const all = workflowEngine.getAll()
    if (!searchQuery) return all
    const q = searchQuery.toLowerCase()
    return all.filter(w =>
      w.name.toLowerCase().includes(q) ||
      w.nameZh.toLowerCase().includes(q) ||
      w.description.toLowerCase().includes(q) ||
      w.descriptionZh.toLowerCase().includes(q) ||
      w.tags.some(t => t.toLowerCase().includes(q))
    )
  }, [searchQuery])

  const handleSelectWorkflow = useCallback((wf: WorkflowDefinition) => {
    setSelectedWorkflow(wf)
    setViewMode('detail')
  }, [])

  const handleStartWorkflow = useCallback(async () => {
    if (!selectedWorkflow) return
    const inputVars: Record<string, unknown> = {}
    if (selectedWorkflow.inputSchema) {
      for (const [key, param] of Object.entries(selectedWorkflow.inputSchema)) {
        inputVars[key] = param.default ?? ''
      }
    }
    const run = await workflowEngine.start(selectedWorkflow.id, inputVars)
    setActiveRun(run)
    setViewMode('run')
  }, [selectedWorkflow])

  const handleBack = useCallback(() => {
    if (viewMode === 'run') {
      setViewMode('detail')
      setActiveRun(null)
    } else if (viewMode === 'detail') {
      setViewMode('list')
      setSelectedWorkflow(null)
    }
    setEditingNodeId(null)
  }, [viewMode])

  const handleEditNode = useCallback((nodeId: string) => {
    setEditingNodeId(nodeId)
  }, [])

  const handleCloseNodeEditor = useCallback(() => {
    setEditingNodeId(null)
  }, [])

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title=""
      size="5xl"
      noPadding
      showCloseButton={false}
    >
      <div className="flex flex-col h-[80vh] bg-background">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/50">
          <div className="flex items-center gap-3">
            {viewMode !== 'list' && (
              <button
                onClick={handleBack}
                className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-accent" />
              <h2 className="text-[15px] font-bold text-text-primary">
                {viewMode === 'list'
                  ? language === 'zh' ? '多智体工作流' : 'Multi-Agent Workflows'
                  : viewMode === 'detail'
                    ? selectedWorkflow ? (language === 'zh' ? selectedWorkflow.nameZh : selectedWorkflow.name) : ''
                    : language === 'zh' ? '执行工作流' : 'Running Workflow'}
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {viewMode === 'detail' && selectedWorkflow && (
              <button
                onClick={handleStartWorkflow}
                className="flex items-center gap-1.5 px-4 py-1.5 text-[12px] font-medium bg-accent text-white hover:bg-accent-hover rounded-lg transition-all"
              >
                <Play className="w-3.5 h-3.5" />
                {language === 'zh' ? '启动' : 'Run'}
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {viewMode === 'list' && (
            <WorkflowList
              workflows={workflows}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              onSelect={handleSelectWorkflow}
              language={language}
            />
          )}

          {viewMode === 'detail' && selectedWorkflow && (
            <div className="flex h-full">
              <div className="flex-1 overflow-hidden">
                <WorkflowCanvas
                  workflow={selectedWorkflow}
                  onEditNode={handleEditNode}
                  language={language}
                />
              </div>
              {editingNodeId && (
                <NodeEditor
                  workflow={selectedWorkflow}
                  nodeId={editingNodeId}
                  onClose={handleCloseNodeEditor}
                  language={language}
                />
              )}
            </div>
          )}

          {viewMode === 'run' && activeRun && selectedWorkflow && (
            <WorkflowRunner
              workflow={selectedWorkflow}
              run={activeRun}
              language={language}
            />
          )}
        </div>
      </div>
    </Modal>
  )
}

interface WorkflowListProps {
  workflows: WorkflowDefinition[]
  searchQuery: string
  onSearchChange: (q: string) => void
  onSelect: (wf: WorkflowDefinition) => void
  language: 'en' | 'zh'
}

function WorkflowList({ workflows, searchQuery, onSearchChange, onSelect, language }: WorkflowListProps) {
  const categories = useMemo(() => {
    const map = new Map<string, WorkflowDefinition[]>()
    for (const wf of workflows) {
      const cat = wf.category
      if (!map.has(cat)) map.set(cat, [])
      map.get(cat)!.push(wf)
    }
    return map
  }, [workflows])

  const categoryLabels: Record<string, { en: string; zh: string; icon: React.ComponentType<{ className?: string }> }> = {
    'code-review': { en: 'Code Review', zh: '代码审查', icon: Search },
    'automation': { en: 'Automation', zh: '自动化', icon: Rocket },
    'documentation': { en: 'Documentation', zh: '文档', icon: FileText },
  }

  return (
    <div className="h-full flex flex-col">
      {/* Search */}
      <div className="px-6 py-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted/50" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => onSearchChange(e.target.value)}
            placeholder={language === 'zh' ? '搜索工作流...' : 'Search workflows...'}
            className="w-full pl-9 pr-4 py-2 text-[13px] bg-surface/50 border border-border/50 rounded-lg text-text-primary placeholder:text-text-muted/40 focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all"
          />
        </div>
      </div>

      {/* Workflow Cards */}
      <div className="flex-1 overflow-y-auto custom-scrollbar px-6 pb-6">
        {Array.from(categories.entries()).map(([category, wfs]) => {
          const catInfo = categoryLabels[category] || { en: category, zh: category, icon: Code2 }
          const CatIcon = catInfo.icon

          return (
            <div key={category} className="mb-6">
              <div className="flex items-center gap-2 mb-3">
                <CatIcon className="w-4 h-4 text-accent/70" />
                <h3 className="text-[13px] font-semibold text-text-secondary">
                  {language === 'zh' ? catInfo.zh : catInfo.en}
                </h3>
                <span className="text-[11px] text-text-muted/50">({wfs.length})</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {wfs.map(wf => {
                  const WfIcon = (wf.icon && ICON_MAP[wf.icon]) || Sparkles
                  const stepCount = Object.keys(wf.steps).length

                  return (
                    <button
                      key={wf.id}
                      onClick={() => onSelect(wf)}
                      className="group text-left p-4 rounded-xl border border-border/40 bg-surface/30 hover:bg-surface-hover hover:border-accent/30 transition-all duration-200"
                    >
                      <div className="flex items-start gap-3">
                        <div className="p-2 rounded-lg bg-accent/10 text-accent group-hover:bg-accent/15 transition-colors">
                          <WfIcon className="w-5 h-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="text-[13px] font-semibold text-text-primary group-hover:text-accent transition-colors">
                            {language === 'zh' ? wf.nameZh : wf.name}
                          </h4>
                          <p className="text-[11px] text-text-muted/70 mt-1 line-clamp-2">
                            {language === 'zh' ? wf.descriptionZh : wf.description}
                          </p>
                          <div className="flex items-center gap-3 mt-2">
                            <span className="text-[10px] text-text-muted/50">
                              {stepCount} {language === 'zh' ? '步骤' : 'steps'}
                            </span>
                            <div className="flex items-center gap-1">
                              {wf.tags.slice(0, 3).map(tag => (
                                <span
                                  key={tag}
                                  className="px-1.5 py-0.5 text-[9px] font-medium bg-accent/5 text-accent/60 rounded"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}

        {workflows.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-text-muted/40">
            <Sparkles className="w-10 h-10 mb-3" />
            <p className="text-[13px]">
              {language === 'zh' ? '没有找到匹配的工作流' : 'No matching workflows found'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
