import { Bug, X } from 'lucide-react'
import type { WorkflowDefinitionV2 } from '@shared/protocols/workflowV2'
import WorkflowRunnerV2 from './WorkflowRunnerV2'
import { t, type Language } from '@renderer/i18n'

interface DebugPanelProps {
  workflow: WorkflowDefinitionV2
  visible: boolean
  onClose: () => void
  onNodeClick: (nodeId: string | null) => void
  language?: 'en' | 'zh'
}

export default function DebugPanel({ workflow, visible, onClose, onNodeClick, language = 'zh' }: DebugPanelProps) {
  if (!visible) return null

  return (
    <div className="h-64 border-t border-border bg-background flex flex-col flex-shrink-0">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/50 bg-background">
        <div className="flex items-center gap-1.5">
          <Bug className="w-3.5 h-3.5 text-accent" />
          <span className="text-xs font-medium text-text-primary">
            {t('wf.debugpanel', language as Language)}
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-0.5 rounded hover:bg-border/50 text-text-muted hover:text-text-primary transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex-1 overflow-hidden">
        <WorkflowRunnerV2 workflow={workflow} language={language} onNodeClick={onNodeClick} />
      </div>
    </div>
  )
}

export function DebugPanelToggle({ onClick, language = 'zh' }: { onClick: () => void; language?: 'en' | 'zh' }) {
  return (
    <div className="absolute bottom-4 right-4 z-10">
      <button
        onClick={onClick}
        className="p-2 rounded-lg bg-background border border-border shadow-lg hover:bg-border/50 text-text-muted hover:text-text-primary transition-all"
        title={t('wf.opendebugpanel', language as Language)}
      >
        <Bug className="w-4 h-4" />
      </button>
    </div>
  )
}
