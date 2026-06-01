import { useState, useMemo } from 'react'
import { Play, XCircle, RotateCcw, FlaskConical } from 'lucide-react'
import type { WorkflowDefinitionV2 } from '@shared/protocols/workflowV2'
import { RUN_STATUS_CONFIG, type WorkflowRunV2, type NodeExecutionRecord } from './runnerTypes'
import { NodeExecutionCard } from './NodeExecutionCard'
import { useWorkflowExecution } from './useWorkflowExecution'
import { t, type Language } from '@renderer/i18n'

interface WorkflowRunnerV2Props {
  workflow: WorkflowDefinitionV2
  language: 'en' | 'zh'
  onNodeClick?: (nodeId: string) => void
}

export default function WorkflowRunnerV2({ workflow, language, onNodeClick }: WorkflowRunnerV2Props) {
  const [inputValues, setInputValues] = useState<Record<string, string>>({})
  const {
    run,
    executionOrder,
    getNodeStatus,
    start,
    startTest,
    cancel,
    reset,
    isRunning,
    isDone,
    isIdle,
  } = useWorkflowExecution(workflow)

  const nodeMap = useMemo(() => {
    const map = new Map<string, WorkflowDefinitionV2['nodes'][0]>()
    for (const node of workflow.nodes) {
      map.set(node.id, node)
    }
    return map
  }, [workflow.nodes])

  const handleStart = () => {
    const inputVars: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(inputValues)) {
      if (value) inputVars[key] = value
    }
    start(Object.keys(inputVars).length > 0 ? inputVars : undefined)
  }

  const handleStartTest = () => {
    const inputVars: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(inputValues)) {
      if (value) inputVars[key] = value
    }
    startTest(Object.keys(inputVars).length > 0 ? inputVars : undefined)
  }

  const statusInfo = RUN_STATUS_CONFIG[run.status as keyof typeof RUN_STATUS_CONFIG] || RUN_STATUS_CONFIG.pending
  const StatusIcon = statusInfo.icon

  const hasInputSchema = workflow.inputSchema && Object.keys(workflow.inputSchema).length > 0

  return (
    <div className="h-full flex flex-col">
      <RunnerHeader
        statusInfo={statusInfo}
        StatusIcon={StatusIcon}
        run={run as WorkflowRunV2}
        language={language}
        isRunning={isRunning}
        isIdle={isIdle}
        isDone={isDone}
        onStart={handleStart}
        onStartTest={handleStartTest}
        onCancel={cancel}
        onRerun={reset}
      />

      {isIdle && hasInputSchema && (
        <InputSchemaPanel
          workflow={workflow}
          inputValues={inputValues}
          onInputChange={setInputValues}
          language={language}
        />
      )}

      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex flex-col items-center gap-0">
          {executionOrder.map((nodeId, index) => {
            const node = nodeMap.get(nodeId)
            if (!node) return null
            const nodeStatus = getNodeStatus(nodeId)
            const record = Array.isArray(run.nodeHistory)
              ? run.nodeHistory.find(r => r.nodeId === nodeId)
              : (run.nodeHistory as Map<string, NodeExecutionRecord>)?.get?.(nodeId)
            return (
              <NodeExecutionCard
                key={nodeId}
                node={node}
                index={index}
                status={nodeStatus}
                record={record}
                language={language}
                onClick={(id) => onNodeClick?.(id)}
                showConnector={index > 0}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}

function RunnerHeader({ statusInfo, StatusIcon, run, language, isRunning, isIdle, isDone, onStart, onStartTest, onCancel, onRerun }: {
  statusInfo: { color: string; icon: React.ComponentType<{ className?: string }> }
  StatusIcon: React.ComponentType<{ className?: string }>
  run: WorkflowRunV2 | null
  language: 'en' | 'zh'
  isRunning: boolean
  isIdle: boolean
  isDone: boolean
  onStart: () => void
  onStartTest: () => void
  onCancel: () => void
  onRerun: () => void
}) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border)] bg-[var(--background)]">
      <div className="flex items-center gap-2">
        <StatusIcon className={`w-4 h-4 ${statusInfo.color} ${isRunning ? 'animate-spin' : ''}`} />
        <span className={`text-xs font-medium ${statusInfo.color}`}>
          {run
            ? (language === 'zh'
                ? { pending: '等待中', running: '执行中', paused: '已暂停', completed: '已完成', failed: '失败', cancelled: '已取消' }[run.status] || run.status
                : run.status.charAt(0).toUpperCase() + run.status.slice(1))
            : (t('wf.ready', language as Language))}
        </span>
      </div>
      <div className="flex items-center gap-2">
        {isIdle && (
          <>
            <button onClick={onStartTest} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 rounded-lg transition-all">
              <FlaskConical className="w-3 h-3" />{t('wf.test', language as Language)}
            </button>
            <button onClick={onStart} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-green-500/10 text-green-500 hover:bg-green-500/20 rounded-lg transition-all">
              <Play className="w-3 h-3" />{t('wf.run', language as Language)}
            </button>
          </>
        )}
        {isRunning && (
          <button onClick={onCancel} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-lg transition-all">
            <XCircle className="w-3 h-3" />{t('wf.cancel', language as Language)}
          </button>
        )}
        {isDone && (
          <button onClick={onRerun} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20 rounded-lg transition-all">
            <RotateCcw className="w-3 h-3" />{t('wf.rerun', language as Language)}
          </button>
        )}
      </div>
    </div>
  )
}

function InputSchemaPanel({ workflow, inputValues, onInputChange, language }: {
  workflow: WorkflowDefinitionV2
  inputValues: Record<string, string>
  onInputChange: React.Dispatch<React.SetStateAction<Record<string, string>>>
  language: 'en' | 'zh'
}) {
  return (
    <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--background)]/50">
      <h4 className="text-xs font-semibold text-[var(--text-secondary)] mb-2">
        {t('wf.inputparameters', language as Language)}
      </h4>
      <div className="space-y-2">
        {Object.entries(workflow.inputSchema!).map(([key, param]) => (
          <div key={key}>
            <label className="text-[11px] text-[var(--text-muted)] mb-0.5 block">
              {param.descriptionZh && language === 'zh' ? param.descriptionZh : param.description}
              {param.required && <span className="text-red-400 ml-0.5">*</span>}
            </label>
            <input
              type="text"
              value={inputValues[key] ?? (param.default as string) ?? ''}
              onChange={e => onInputChange(prev => ({ ...prev, [key]: e.target.value }))}
              placeholder={(param as any).placeholder || param.description}
              className="w-full px-2.5 py-1.5 text-xs bg-[var(--background)] border border-[var(--border)] rounded-lg focus:outline-none focus:ring-1 focus:ring-[var(--accent)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
            />
          </div>
        ))}
      </div>
    </div>
  )
}