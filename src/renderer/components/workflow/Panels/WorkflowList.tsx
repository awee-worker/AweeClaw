import { useState, useCallback, useEffect, useRef } from 'react'
import { Plus, Trash2, Copy, Download, Upload, Workflow, Store } from 'lucide-react'
import type { WorkflowDefinitionV2 } from '@shared/protocols/workflowV2'
import {
  loadWorkflowDefinitions,
  deleteWorkflowDefinition,
  duplicateWorkflowDefinition,
  exportWorkflowDefinition,
  importWorkflowDefinition,
} from '@shared/configuration/workflows/workflowPersistenceV2'
import WorkflowHistoryV2 from './WorkflowHistoryV2'
import { t, type Language } from '@renderer/i18n'

interface WorkflowListProps {
  onSelect: (workflow: WorkflowDefinitionV2) => void
  onCreateNew: () => void
  onOpenWorkflow?: (workflowId: string) => void
  onOpenMarket?: () => void
  language: 'en' | 'zh'
}

type ListTab = 'workflows' | 'history'

export default function WorkflowList({ onSelect, onCreateNew, onOpenWorkflow, onOpenMarket, language }: WorkflowListProps) {
  const [workflows, setWorkflows] = useState<WorkflowDefinitionV2[]>(() => loadWorkflowDefinitions())
  const [activeTab, setActiveTab] = useState<ListTab>('workflows')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const refreshList = useCallback(() => {
    setWorkflows(loadWorkflowDefinitions())
  }, [])

  useEffect(() => {
    refreshList()
  }, [refreshList])

  const handleDelete = useCallback(
    (id: string, e: React.MouseEvent) => {
      e.stopPropagation()
      deleteWorkflowDefinition(id)
      refreshList()
    },
    [refreshList],
  )

  const handleDuplicate = useCallback(
    (id: string, e: React.MouseEvent) => {
      e.stopPropagation()
      duplicateWorkflowDefinition(id)
      refreshList()
    },
    [refreshList],
  )

  const handleExport = useCallback(
    (wf: WorkflowDefinitionV2, e: React.MouseEvent) => {
      e.stopPropagation()
      const json = exportWorkflowDefinition(wf)
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${wf.name || 'workflow'}.json`
      a.click()
      URL.revokeObjectURL(url)
    },
    [],
  )

  const handleImport = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = (ev) => {
        const text = ev.target?.result as string
        const imported = importWorkflowDefinition(text)
        if (imported) {
          refreshList()
        }
      }
      reader.readAsText(file)
      e.target.value = ''
    },
    [refreshList],
  )

  const handleRerun = useCallback(
    (workflowId: string) => {
      const wf = loadWorkflowDefinitions().find(w => w.id === workflowId)
      if (wf) onSelect(wf)
    },
    [onSelect],
  )

  const handleOpenWorkflow = useCallback(
    (workflowId: string) => {
      if (onOpenWorkflow) {
        onOpenWorkflow(workflowId)
      } else {
        const wf = loadWorkflowDefinitions().find(w => w.id === workflowId)
        if (wf) onSelect(wf)
      }
    },
    [onOpenWorkflow, onSelect],
  )

  const formatDate = useCallback(
    (timestamp?: number) => {
      if (!timestamp) return '-'
      const d = new Date(timestamp)
      return d.toLocaleDateString(t('wf.enus', language as Language), {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    },
    [language],
  )

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Workflow className="w-4 h-4 text-[var(--accent)]" />
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              {t('wf.workflows', language as Language)}
            </h2>
          </div>
          <div className="flex items-center bg-[var(--border)]/30 rounded-md p-0.5">
            <button
              onClick={() => setActiveTab('workflows')}
              className={`px-2.5 py-1 text-[10px] font-medium rounded transition-colors ${
                activeTab === 'workflows'
                  ? 'bg-[var(--background)] text-[var(--text-primary)] shadow-sm'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              {t('wf.workflows2', language as Language)}
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`px-2.5 py-1 text-[10px] font-medium rounded transition-colors ${
                activeTab === 'history'
                  ? 'bg-[var(--background)] text-[var(--text-primary)] shadow-sm'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              {t('wf.history', language as Language)}
            </button>
          </div>
        </div>
        {activeTab === 'workflows' && (
          <div className="flex items-center gap-1">
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleImport}
              className="hidden"
            />
            {onOpenMarket && (
              <button
                onClick={onOpenMarket}
                className="p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent)]/10 transition-colors"
                title={t('wf.templatemarket', language as Language)}
              >
                <Store className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--border)]/50 transition-colors"
              title={t('wf.importworkflow', language as Language)}
            >
              <Upload className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onCreateNew}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20 transition-colors"
            >
              <Plus className="w-3 h-3" />
              {t('wf.new', language as Language)}
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-hidden">
        {activeTab === 'workflows' ? (
          <div className="h-full overflow-y-auto p-3">
            {workflows.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-[var(--text-muted)]">
                <Workflow className="w-10 h-10 mb-3 opacity-30" />
                <p className="text-xs mb-3">
                  {t('wf.noworkflowsyetcreateone', language as Language)}
                </p>
                <button
                  onClick={onCreateNew}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20 transition-colors"
                >
                  <Plus className="w-3 h-3" />
                  {t('wf.newworkflow', language as Language)}
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {workflows.map(wf => (
                  <div
                    key={wf.id}
                    onClick={() => onSelect(wf)}
                    className="group p-3 rounded-lg border border-[var(--border)] bg-[var(--background)] hover:border-[var(--accent)]/30 hover:bg-[var(--accent)]/5 cursor-pointer transition-all"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-base">🔄</span>
                        <span className="text-xs font-medium text-[var(--text-primary)] truncate">
                          {language === 'zh' ? wf.nameZh : wf.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => handleDuplicate(wf.id, e)}
                          className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--border)]/50"
                          title={t('wf.duplicate', language as Language)}
                        >
                          <Copy className="w-3 h-3" />
                        </button>
                        <button
                          onClick={(e) => handleExport(wf, e)}
                          className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--border)]/50"
                          title={t('wf.export', language as Language)}
                        >
                          <Download className="w-3 h-3" />
                        </button>
                        <button
                          onClick={(e) => handleDelete(wf.id, e)}
                          className="p-1 rounded text-[var(--text-muted)] hover:text-red-400 hover:bg-red-500/10"
                          title={t('wf.delete', language as Language)}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                    {(wf.description || wf.descriptionZh) && (
                      <p className="text-[10px] text-[var(--text-muted)] line-clamp-2 mb-2">
                        {language === 'zh' ? wf.descriptionZh : wf.description}
                      </p>
                    )}
                    <div className="flex items-center gap-3 text-[10px] text-[var(--text-muted)]">
                      <span>{wf.nodes.length} {t('wf.nodes', language as Language)}</span>
                      <span>{wf.edges.length} {t('wf.edges', language as Language)}</span>
                      <span>{formatDate(wf.updatedAt || wf.createdAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <WorkflowHistoryV2
            onRerun={handleRerun}
            onOpenWorkflow={handleOpenWorkflow}
            language={language}
          />
        )}
      </div>
    </div>
  )
}
