import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Play,
  Pause,
  RotateCcw,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  MessageSquare,
  GitBranch,
  UserCheck,
  Zap,
} from 'lucide-react'
import { motion } from 'framer-motion'
import { workflowEngine } from '@shared/types/workflow'
import type { WorkflowDefinition, WorkflowRun, WorkflowStep, WorkflowStepType } from '@shared/types/workflow'

interface WorkflowRunnerProps {
  workflow: WorkflowDefinition
  run: WorkflowRun
  language: 'en' | 'zh'
}

const STATUS_CONFIG: Record<WorkflowRun['status'], { color: string; bg: string; icon: React.ComponentType<{ className?: string }> }> = {
  'pending': { color: 'text-gray-400', bg: 'bg-gray-500/10', icon: Clock },
  'running': { color: 'text-blue-400', bg: 'bg-blue-500/10', icon: Loader2 },
  'paused': { color: 'text-amber-400', bg: 'bg-amber-500/10', icon: Pause },
  'completed': { color: 'text-green-400', bg: 'bg-green-500/10', icon: CheckCircle2 },
  'failed': { color: 'text-red-400', bg: 'bg-red-500/10', icon: XCircle },
  'cancelled': { color: 'text-gray-400', bg: 'bg-gray-500/10', icon: XCircle },
}

const STEP_ICONS: Record<WorkflowStepType, React.ComponentType<{ className?: string }>> = {
  'agent_message': MessageSquare,
  'condition': GitBranch,
  'parallel': Zap,
  'user_input': UserCheck,
  'delay': Clock,
}

type StepDisplayStatus = 'pending' | 'running' | 'completed' | 'failed' | 'waiting'

const STEP_STATUS_DISPLAY: Record<StepDisplayStatus, { color: string; bg: string; icon: React.ComponentType<{ className?: string }> }> = {
  'pending': { color: 'text-gray-400', bg: 'bg-gray-500/10', icon: Clock },
  'running': { color: 'text-blue-400', bg: 'bg-blue-500/10', icon: Loader2 },
  'completed': { color: 'text-green-400', bg: 'bg-green-500/10', icon: CheckCircle2 },
  'failed': { color: 'text-red-400', bg: 'bg-red-500/10', icon: XCircle },
  'waiting': { color: 'text-gray-500/30', bg: 'bg-gray-500/5', icon: Clock },
}

export default function WorkflowRunner({ workflow, run: initialRun, language }: WorkflowRunnerProps) {
  const [currentRun, setCurrentRun] = useState(initialRun)
  const [inputValues, setInputValues] = useState<Record<string, string>>({})

  useEffect(() => {
    const unsubscribe = workflowEngine.onEvent((event) => {
      if (event.runId === currentRun.id) {
        const updated = workflowEngine.getRun(currentRun.id)
        if (updated) setCurrentRun(updated)
      }
    })
    return unsubscribe
  }, [currentRun.id])

  const orderedSteps = useMemo((): WorkflowStep[] => {
    const steps: WorkflowStep[] = []
    let currentId: string | undefined = workflow.startStep
    const visited = new Set<string>()
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId)
      const step: WorkflowStep | undefined = workflow.steps[currentId]
      if (!step) break
      steps.push(step)
      currentId = step.next
    }
    return steps
  }, [workflow])

  const statusInfo = STATUS_CONFIG[currentRun.status]
  const StatusIcon = statusInfo.icon

  const getStepStatus = useCallback((stepId: string): StepDisplayStatus => {
    const historyEntry = currentRun.stepHistory.find(h => h.stepId === stepId)
    if (historyEntry) {
      if (historyEntry.status === 'success') return 'completed'
      if (historyEntry.status === 'failed') return 'failed'
      if (historyEntry.status === 'skipped') return 'pending'
    }
    if (currentRun.currentStepId === stepId) return 'running'
    const stepIndex = orderedSteps.findIndex(s => s.id === stepId)
    const currentIndex = orderedSteps.findIndex(s => s.id === currentRun.currentStepId)
    if (stepIndex > currentIndex && currentIndex >= 0) return 'waiting'
    return 'pending'
  }, [currentRun, orderedSteps])

  const handleStart = useCallback(async () => {
    const inputVars: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(inputValues)) {
      inputVars[key] = value
    }
    const newRun = await workflowEngine.start(workflow.id, inputVars)
    setCurrentRun(newRun)
  }, [workflow.id, inputValues])

  const handleCancel = useCallback(() => {
    workflowEngine.cancelRun(currentRun.id)
    const updated = workflowEngine.getRun(currentRun.id)
    if (updated) setCurrentRun(updated)
  }, [currentRun.id])

  const handleResume = useCallback((userInput?: string) => {
    workflowEngine.resume(currentRun.id, userInput)
    const updated = workflowEngine.getRun(currentRun.id)
    if (updated) setCurrentRun(updated)
  }, [currentRun.id])

  const hasInputSchema = workflow.inputSchema && Object.keys(workflow.inputSchema).length > 0
  const isIdle = currentRun.status === 'pending'
  const isRunning = currentRun.status === 'running'
  const isPaused = currentRun.status === 'paused'
  const isDone = currentRun.status === 'completed' || currentRun.status === 'failed' || currentRun.status === 'cancelled'

  const pausedStep = useMemo(() => {
    if (!isPaused || !currentRun.currentStepId) return null
    return workflow.steps[currentRun.currentStepId] || null
  }, [isPaused, currentRun.currentStepId, workflow.steps])

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border/30 bg-surface/20">
        <div className="flex items-center gap-2">
          <StatusIcon className={`w-4 h-4 ${statusInfo.color} ${isRunning ? 'animate-spin' : ''}`} />
          <span className={`text-[12px] font-medium ${statusInfo.color}`}>
            {language === 'zh'
              ? { pending: '等待中', running: '执行中', paused: '已暂停', completed: '已完成', failed: '失败', cancelled: '已取消' }[currentRun.status]
              : currentRun.status.charAt(0).toUpperCase() + currentRun.status.slice(1)}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {isIdle && hasInputSchema && (
            <button
              onClick={handleStart}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium bg-accent text-white hover:bg-accent-hover rounded-lg transition-all"
            >
              <Play className="w-3 h-3" />
              {language === 'zh' ? '启动' : 'Start'}
            </button>
          )}
          {isRunning && (
            <button
              onClick={handleCancel}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-lg transition-all"
            >
              <XCircle className="w-3 h-3" />
              {language === 'zh' ? '取消' : 'Cancel'}
            </button>
          )}
          {isPaused && (
            <>
              <button
                onClick={() => handleResume('approved')}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium bg-green-500/10 text-green-400 hover:bg-green-500/20 rounded-lg transition-all"
              >
                <CheckCircle2 className="w-3 h-3" />
                {language === 'zh' ? '批准继续' : 'Approve'}
              </button>
              <button
                onClick={handleCancel}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-lg transition-all"
              >
                <XCircle className="w-3 h-3" />
                {language === 'zh' ? '拒绝' : 'Reject'}
              </button>
            </>
          )}
          {isDone && (
            <button
              onClick={handleStart}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium bg-accent/10 text-accent hover:bg-accent/20 rounded-lg transition-all"
            >
              <RotateCcw className="w-3 h-3" />
              {language === 'zh' ? '重新运行' : 'Re-run'}
            </button>
          )}
        </div>
      </div>

      {/* Input Parameters */}
      {isIdle && hasInputSchema && (
        <div className="px-6 py-4 border-b border-border/30 bg-surface/10">
          <h4 className="text-[11px] font-semibold text-text-secondary mb-3">
            {language === 'zh' ? '输入参数' : 'Input Parameters'}
          </h4>
          <div className="space-y-3">
            {Object.entries(workflow.inputSchema!).map(([key, param]) => (
              <div key={key}>
                <label className="text-[11px] text-text-muted/70 mb-1 block">
                  {param.descriptionZh && language === 'zh' ? param.descriptionZh : param.description}
                  {param.required && <span className="text-red-400 ml-0.5">*</span>}
                </label>
                <input
                  type="text"
                  value={inputValues[key] ?? (param.default as string) ?? ''}
                  onChange={e => setInputValues(prev => ({ ...prev, [key]: e.target.value }))}
                  placeholder={param.type}
                  className="w-full px-3 py-2 text-[12px] bg-surface/50 border border-border/40 rounded-lg text-text-primary placeholder:text-text-muted/30 focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Paused User Input Panel */}
      {isPaused && pausedStep && pausedStep.config.type === 'user_input' && (
        <UserInputPanel
          step={pausedStep}
          onResume={handleResume}
          language={language}
        />
      )}

      {/* Step Execution Progress */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
        <div className="flex flex-col items-center gap-0">
          {orderedSteps.map((step, index) => {
            const stepStatus = getStepStatus(step.id)
            const StepIcon = STEP_ICONS[step.type] || MessageSquare
            const displayConfig = STEP_STATUS_DISPLAY[stepStatus]

            const historyEntry = currentRun.stepHistory.find(h => h.stepId === step.id)

            return (
              <div key={step.id} className="flex flex-col items-center w-full">
                {index > 0 && (
                  <div className="flex flex-col items-center py-0.5">
                    <div className={`w-px h-3 ${stepStatus === 'completed' ? 'bg-green-500/40' : 'bg-border/30'}`} />
                  </div>
                )}

                <motion.div
                  initial={{ opacity: 0.5, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className={`w-full max-w-[500px] p-3 rounded-xl border transition-all ${
                    stepStatus === 'running'
                      ? 'border-blue-500/40 bg-blue-500/5 shadow-[0_0_15px_rgba(59,130,246,0.1)]'
                      : stepStatus === 'completed'
                        ? 'border-green-500/20 bg-green-500/5'
                        : stepStatus === 'failed'
                          ? 'border-red-500/20 bg-red-500/5'
                          : 'border-border/30 bg-surface/20'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`p-1.5 rounded-lg ${displayConfig.bg}`}>
                      {stepStatus === 'running'
                        ? <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
                        : <displayConfig.icon className={`w-4 h-4 ${displayConfig.color}`} />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] font-medium text-text-primary">
                          {step.nameZh && language === 'zh' ? step.nameZh : step.name}
                        </span>
                        <StepIcon className="w-3 h-3 text-text-muted/40" />
                      </div>
                      {stepStatus === 'running' && (
                        <p className="text-[10px] text-blue-400/70 mt-0.5">
                          {language === 'zh' ? '正在执行...' : 'Executing...'}
                        </p>
                      )}
                      {stepStatus === 'completed' && historyEntry?.output != null && (() => {
                        const outStr = typeof historyEntry.output === 'string'
                          ? historyEntry.output.substring(0, 60)
                          : JSON.stringify(historyEntry.output).substring(0, 60)
                        return <p className="text-[10px] text-green-400/60 mt-0.5 line-clamp-1">{outStr}</p>
                      })()}
                      {stepStatus === 'failed' && historyEntry?.error && (
                        <p className="text-[10px] text-red-400/70 mt-0.5 line-clamp-1">
                          {historyEntry.error}
                        </p>
                      )}
                    </div>
                    <span className="text-[10px] text-text-muted/30 font-mono">#{index + 1}</span>
                  </div>
                </motion.div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

interface UserInputPanelProps {
  step: WorkflowStep
  onResume: (input?: string) => void
  language: 'en' | 'zh'
}

function UserInputPanel({ step, onResume, language }: UserInputPanelProps) {
  const [value, setValue] = useState('')

  const config = step.config as { prompt?: string; outputVar?: string }

  return (
    <div className="px-6 py-4 border-b border-amber-500/20 bg-amber-500/5">
      <div className="flex items-center gap-2 mb-2">
        <UserCheck className="w-4 h-4 text-amber-400" />
        <h4 className="text-[12px] font-semibold text-amber-400">
          {language === 'zh' ? '等待输入' : 'Awaiting Input'}
        </h4>
      </div>
      {config.prompt && (
        <p className="text-[11px] text-text-muted/70 mb-3">
          {config.prompt}
        </p>
      )}
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder={language === 'zh' ? '输入内容...' : 'Enter input...'}
          className="flex-1 px-3 py-2 text-[12px] bg-surface/50 border border-border/40 rounded-lg text-text-primary placeholder:text-text-muted/30 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/20 transition-all"
          onKeyDown={e => {
            if (e.key === 'Enter') onResume(value)
          }}
        />
        <button
          onClick={() => onResume(value)}
          className="px-4 py-2 text-[11px] font-medium bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 rounded-lg transition-all"
        >
          {language === 'zh' ? '提交' : 'Submit'}
        </button>
      </div>
    </div>
  )
}
