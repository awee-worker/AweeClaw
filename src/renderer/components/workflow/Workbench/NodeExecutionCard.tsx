import { Loader2 } from 'lucide-react'
import type { WorkflowNodeV2, WorkflowNodeTypeV2 } from '@shared/protocols/workflowV2'
import { NODE_CATEGORY_MAP } from '@shared/protocols/workflowV2'
import { NODE_ICONS, NODE_STATUS_DISPLAY, type NodeDisplayStatus, type NodeExecutionRecord } from './runnerTypes'
import { t, type Language } from '@renderer/i18n'

interface NodeExecutionCardProps {
  node: WorkflowNodeV2
  index: number
  status: NodeDisplayStatus
  record: NodeExecutionRecord | undefined
  language: 'en' | 'zh'
  onClick: (nodeId: string) => void
  showConnector: boolean
}

export function NodeExecutionCard({ node, index, status, record, language, onClick, showConnector }: NodeExecutionCardProps) {
  const NodeIcon = (NODE_ICONS[node.type as WorkflowNodeTypeV2] || NODE_ICONS.agent_task) as React.ComponentType<{ className?: string }>
  const displayConfig = NODE_STATUS_DISPLAY[status]
  const categoryInfo = NODE_CATEGORY_MAP[node.type as WorkflowNodeTypeV2]

  return (
    <div className="flex flex-col items-center w-full">
      {showConnector && (
        <div className="flex flex-col items-center py-0.5">
          <div className={`w-px h-3 ${status === 'completed' ? 'bg-green-500/40' : 'bg-[var(--border)]/30'}`} />
        </div>
      )}

      <div
        className={`w-full max-w-[480px] p-2.5 rounded-xl border transition-all cursor-pointer ${
          status === 'running'
            ? 'border-blue-500/40 bg-blue-500/5 shadow-[0_0_15px_rgba(59,130,246,0.1)]'
            : status === 'completed'
              ? 'border-green-500/20 bg-green-500/5'
              : status === 'failed'
                ? 'border-red-500/20 bg-red-500/5'
                : 'border-[var(--border)]/30 bg-[var(--background)]/50'
        }`}
        onClick={() => onClick(node.id)}
      >
        <div className="flex items-center gap-2.5">
          <div
            className={`p-1.5 rounded-lg ${displayConfig.bg}`}
            style={categoryInfo ? { backgroundColor: `${categoryInfo.color}15` } : undefined}
          >
            {status === 'running'
              ? <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" />
              : <displayConfig.icon className={`w-3.5 h-3.5`} />
            }
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-[var(--text-primary)] truncate">
                {language === 'zh' && node.nameZh ? node.nameZh : node.name}
              </span>
              <NodeIcon className="w-3 h-3 text-[var(--text-muted)]/40" />
            </div>
            {status === 'running' && (
              <p className="text-[10px] text-blue-400/70 mt-0.5">
                {t('wf.executing', language as Language)}
              </p>
            )}
            {status === 'completed' && record?.output != null && <NodeOutputPreview output={record.output} />}
            {status === 'failed' && record?.error && (
              <p className="text-[10px] text-red-400/70 mt-0.5 line-clamp-1">{record.error}</p>
            )}
          </div>
          <span className="text-[10px] text-[var(--text-muted)]/30 font-mono">#{index + 1}</span>
        </div>
      </div>
    </div>
  )
}

function NodeOutputPreview({ output }: { output: unknown }) {
  const outStr = typeof output === 'string'
    ? output.substring(0, 60)
    : JSON.stringify(output).substring(0, 60)
  return <p className="text-[10px] text-green-400/60 mt-0.5 line-clamp-1">{outStr}</p>
}
