import { Bug, X } from 'lucide-react'
import type { WorkflowDefinitionV2 } from '@shared/protocols/workflowV2'
import WorkflowRunnerV2 from './WorkflowRunnerV2'

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
    <div className="h-64 border-t border-[var(--border)] bg-[var(--background)] flex flex-col flex-shrink-0">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--border)]/50 bg-[var(--background)]">
        <div className="flex items-center gap-1.5">
          <Bug className="w-3.5 h-3.5 text-[var(--accent)]" />
          <span className="text-xs font-medium text-[var(--text-primary)]">
            {language === 'zh' ? '调试面板' : 'Debug Panel'}
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-0.5 rounded hover:bg-[var(--border)]/50 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
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
        className="p-2 rounded-lg bg-[var(--background)] border border-[var(--border)] shadow-lg hover:bg-[var(--border)]/50 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all"
        title={language === 'zh' ? '打开调试面板' : 'Open Debug Panel'}
      >
        <Bug className="w-4 h-4" />
      </button>
    </div>
  )
}
