import { useMemo } from 'react'
import {
  ArrowRight,
  MessageSquare,
  GitBranch,
  Clock,
  UserCheck,
  Zap,
} from 'lucide-react'
import { motion } from 'framer-motion'
import type { WorkflowDefinition, WorkflowStep, WorkflowStepType } from '@shared/protocols/workflow'
import { t, type Language } from '@renderer/i18n'

interface WorkflowCanvasProps {
  workflow: WorkflowDefinition
  onEditNode: (nodeId: string) => void
  language: 'en' | 'zh'
}

const STEP_ICON_MAP: Record<WorkflowStepType, React.ComponentType<{ className?: string }>> = {
  'agent_message': MessageSquare,
  'condition': GitBranch,
  'parallel': Zap,
  'user_input': UserCheck,
  'delay': Clock,
}

const STEP_COLORS: Record<WorkflowStepType, string> = {
  'agent_message': 'from-blue-500/20 to-blue-600/10 border-blue-500/30',
  'condition': 'from-amber-500/20 to-amber-600/10 border-amber-500/30',
  'parallel': 'from-teal-500/20 to-teal-600/10 border-teal-500/30',
  'user_input': 'from-rose-500/20 to-rose-600/10 border-rose-500/30',
  'delay': 'from-gray-500/20 to-gray-600/10 border-gray-500/30',
}

const STEP_ICON_COLORS: Record<WorkflowStepType, string> = {
  'agent_message': 'text-blue-400',
  'condition': 'text-amber-400',
  'parallel': 'text-teal-400',
  'user_input': 'text-rose-400',
  'delay': 'text-gray-400',
}

export default function WorkflowCanvas({ workflow, onEditNode, language }: WorkflowCanvasProps) {
  const orderedSteps = useMemo((): WorkflowStep[] => {
    const steps: WorkflowStep[] = []
    let currentId: string | undefined = workflow.startStep
    const visited = new Set<string>()

    while (currentId && !visited.has(currentId)) {
      visited.add(currentId)
      const currentStep: WorkflowStep | undefined = workflow.steps[currentId]
      if (!currentStep) break
      steps.push(currentStep)
      currentId = currentStep.next
    }

    const allSteps: WorkflowStep[] = Object.values(workflow.steps)
    for (const step of allSteps) {
      if (!visited.has(step.id)) {
        steps.push(step)
      }
    }

    return steps
  }, [workflow])

  return (
    <div className="h-full overflow-y-auto custom-scrollbar p-6">
      {/* Workflow Info */}
      <div className="mb-6">
        <p className="text-[12px] text-text-muted/70 leading-relaxed">
          {language === 'zh' ? workflow.descriptionZh : workflow.description}
        </p>
        <div className="flex items-center gap-4 mt-3">
          <span className="text-[11px] text-text-muted/50">
            {orderedSteps.length} {t('wf.steps', language as Language)}
          </span>
          <span className="text-[11px] text-text-muted/50">
            v{workflow.version}
          </span>
          <div className="flex items-center gap-1">
            {workflow.tags.map(tag => (
              <span key={tag} className="px-1.5 py-0.5 text-[9px] font-medium bg-accent/5 text-accent/60 rounded">
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Flow Diagram */}
      <div className="flex flex-col items-center gap-0">
        {/* Start Node */}
        <div className="flex items-center justify-center w-10 h-10 rounded-full bg-accent/10 border border-accent/30 text-accent text-[11px] font-bold">
          {t('wf.start', language as Language)}
        </div>

        {orderedSteps.map((step, index) => {
          const Icon = STEP_ICON_MAP[step.type] || MessageSquare
          const colorClass = STEP_COLORS[step.type] || STEP_COLORS['agent_message']
          const iconColor = STEP_ICON_COLORS[step.type] || 'text-blue-400'

          return (
            <div key={step.id} className="flex flex-col items-center">
              {/* Connector Arrow */}
              <div className="flex flex-col items-center py-1">
                <div className="w-px h-4 bg-border/50" />
                <ArrowRight className="w-3 h-3 text-text-muted/40 -rotate-90" />
              </div>

              {/* Step Node */}
              <motion.button
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.08 }}
                onClick={() => onEditNode(step.id)}
                className={`group relative w-[320px] p-4 rounded-xl border bg-gradient-to-br ${colorClass} hover:scale-[1.02] transition-all duration-200 cursor-pointer`}
              >
                <div className="flex items-start gap-3">
                  <div className={`p-1.5 rounded-lg bg-black/10 ${iconColor}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0 text-left">
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] font-semibold text-text-primary">
                        {step.nameZh && language === 'zh' ? step.nameZh : step.name}
                      </span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-black/10 text-text-muted/70 font-medium">
                        {step.type.replace('_', ' ')}
                      </span>
                    </div>
                    {step.config.type === 'agent_message' && (
                      <p className="text-[10px] text-text-muted/60 mt-1 line-clamp-2">
                        {(step.config as { message: string }).message.substring(0, 80)}...
                      </p>
                    )}
                  </div>
                  <span className="text-[10px] text-text-muted/40 font-mono">
                    #{index + 1}
                  </span>
                </div>
              </motion.button>
            </div>
          )
        })}

        {/* End Node */}
        <div className="flex flex-col items-center py-1">
          <div className="w-px h-4 bg-border/50" />
          <ArrowRight className="w-3 h-3 text-text-muted/40 -rotate-90" />
        </div>
        <div className="flex items-center justify-center w-10 h-10 rounded-full bg-surface/50 border border-border/50 text-text-muted/50 text-[11px] font-bold">
          {t('wf.end', language as Language)}
        </div>
      </div>
    </div>
  )
}
