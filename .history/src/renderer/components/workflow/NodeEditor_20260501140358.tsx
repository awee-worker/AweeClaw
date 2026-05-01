import { useMemo } from 'react'
import { X, MessageSquare, Wrench, GitBranch, Clock, UserCheck, Zap, Globe } from 'lucide-react'
import type { WorkflowDefinition, WorkflowStep, WorkflowStepType } from '@shared/types/workflow'

interface NodeEditorProps {
  workflow: WorkflowDefinition
  nodeId: string
  onClose: () => void
  language: 'en' | 'zh'
}

const STEP_TYPE_LABELS: Record<WorkflowStepType, { en: string; zh: string }> = {
  'agent_message': { en: 'Agent Message', zh: '智能体消息' },
  'tool_call': { en: 'Tool Call', zh: '工具调用' },
  'condition': { en: 'Condition', zh: '条件判断' },
  'loop': { en: 'Loop', zh: '循环' },
  'parallel': { en: 'Parallel', zh: '并行执行' },
  'user_input': { en: 'User Input', zh: '用户输入' },
  'delay': { en: 'Delay', zh: '延迟' },
  'scenario_switch': { en: 'Scenario Switch', zh: '场景切换' },
  'sub_workflow': { en: 'Sub Workflow', zh: '子工作流' },
  'transform': { en: 'Transform', zh: '数据转换' },
  'http_request': { en: 'HTTP Request', zh: 'HTTP 请求' },
}

const STEP_ICONS: Record<WorkflowStepType, React.ComponentType<{ className?: string }>> = {
  'agent_message': MessageSquare,
  'tool_call': Wrench,
  'condition': GitBranch,
  'loop': Zap,
  'parallel': Zap,
  'user_input': UserCheck,
  'delay': Clock,
  'scenario_switch': GitBranch,
  'sub_workflow': Zap,
  'transform': Zap,
  'http_request': Globe,
}

export default function NodeEditor({ workflow, nodeId, onClose, language }: NodeEditorProps) {
  const step = useMemo((): WorkflowStep | undefined => workflow.steps[nodeId], [workflow, nodeId])

  if (!step) {
    return (
      <div className="w-[320px] border-l border-border/50 bg-background p-4">
        <p className="text-[12px] text-text-muted/50">
          {language === 'zh' ? '未找到节点' : 'Node not found'}
        </p>
      </div>
    )
  }

  const typeLabel = STEP_TYPE_LABELS[step.type]
  const Icon = STEP_ICONS[step.type] || MessageSquare

  const nextStep = step.next ? workflow.steps[step.next] : null

  return (
    <div className="w-[320px] border-l border-border/50 bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
        <h3 className="text-[12px] font-semibold text-text-primary">
          {language === 'zh' ? '节点属性' : 'Node Properties'}
        </h3>
        <button
          onClick={onClose}
          className="p-1 rounded text-text-muted/50 hover:text-text-primary hover:bg-surface-hover transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4">
        {/* Step Type Badge */}
        <div className="flex items-center gap-2 p-3 rounded-lg bg-surface/50 border border-border/30">
          <Icon className="w-4 h-4 text-accent" />
          <span className="text-[11px] font-medium text-accent">
            {language === 'zh' ? typeLabel.zh : typeLabel.en}
          </span>
        </div>

        {/* Step Name */}
        <div>
          <label className="text-[11px] font-medium text-text-secondary mb-1 block">
            {language === 'zh' ? '名称' : 'Name'}
          </label>
          <div className="px-3 py-2 text-[12px] text-text-primary bg-surface/30 border border-border/30 rounded-lg">
            {step.nameZh && language === 'zh' ? step.nameZh : step.name}
          </div>
        </div>

        {/* Step ID */}
        <div>
          <label className="text-[11px] font-medium text-text-secondary mb-1 block">
            ID
          </label>
          <div className="px-3 py-2 text-[11px] text-text-muted/60 font-mono bg-surface/30 border border-border/30 rounded-lg">
            {step.id}
          </div>
        </div>

        {/* Config Details */}
        {step.config.type === 'agent_message' && (
          <AgentMessageConfig config={step.config} language={language} />
        )}
        {step.config.type === 'tool_call' && (
          <ToolCallConfig config={step.config} language={language} />
        )}
        {step.config.type === 'condition' && (
          <ConditionConfig config={step.config} language={language} />
        )}
        {step.config.type === 'user_input' && (
          <UserInputConfig config={step.config} language={language} />
        )}

        {/* Next Step */}
        <div>
          <label className="text-[11px] font-medium text-text-secondary mb-1 block">
            {language === 'zh' ? '下一步' : 'Next Step'}
          </label>
          {nextStep ? (
            <div className="px-3 py-2 text-[12px] text-text-primary bg-surface/30 border border-border/30 rounded-lg flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-400" />
              {nextStep.nameZh && language === 'zh' ? nextStep.nameZh : nextStep.name}
            </div>
          ) : (
            <div className="px-3 py-2 text-[12px] text-text-muted/40 bg-surface/30 border border-border/30 rounded-lg">
              {language === 'zh' ? '无（结束）' : 'None (End)'}
            </div>
          )}
        </div>

        {/* Timeout */}
        {step.timeout && (
          <div>
            <label className="text-[11px] font-medium text-text-secondary mb-1 block">
              {language === 'zh' ? '超时' : 'Timeout'}
            </label>
            <div className="px-3 py-2 text-[12px] text-text-primary bg-surface/30 border border-border/30 rounded-lg">
              {step.timeout}ms
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function AgentMessageConfig({ config, language }: { config: any; language: 'en' | 'zh' }) {
  return (
    <div className="space-y-3">
      <div>
        <label className="text-[11px] font-medium text-text-secondary mb-1 block">
          {language === 'zh' ? '消息模板' : 'Message Template'}
        </label>
        <div className="px-3 py-2 text-[11px] text-text-muted/70 bg-surface/30 border border-border/30 rounded-lg max-h-[120px] overflow-y-auto custom-scrollbar whitespace-pre-wrap font-mono">
          {config.message || '-'}
        </div>
      </div>
      {config.outputVar && (
        <div>
          <label className="text-[11px] font-medium text-text-secondary mb-1 block">
            {language === 'zh' ? '输出变量' : 'Output Variable'}
          </label>
          <div className="px-3 py-2 text-[11px] text-accent font-mono bg-accent/5 border border-accent/20 rounded-lg">
            {'{{' + config.outputVar + '}}'}
          </div>
        </div>
      )}
      <div>
        <label className="text-[11px] font-medium text-text-secondary mb-1 block">
          {language === 'zh' ? '等待响应' : 'Wait for Response'}
        </label>
        <div className="px-3 py-2 text-[12px] text-text-primary bg-surface/30 border border-border/30 rounded-lg">
          {config.waitForResponse ? (language === 'zh' ? '是' : 'Yes') : (language === 'zh' ? '否' : 'No')}
        </div>
      </div>
    </div>
  )
}

function ToolCallConfig({ config, language }: { config: any; language: 'en' | 'zh' }) {
  return (
    <div className="space-y-3">
      <div>
        <label className="text-[11px] font-medium text-text-secondary mb-1 block">
          {language === 'zh' ? '工具' : 'Tool'}
        </label>
        <div className="px-3 py-2 text-[12px] text-text-primary bg-surface/30 border border-border/30 rounded-lg">
          {config.tool || '-'}
        </div>
      </div>
      {config.outputVar && (
        <div>
          <label className="text-[11px] font-medium text-text-secondary mb-1 block">
            {language === 'zh' ? '输出变量' : 'Output Variable'}
          </label>
          <div className="px-3 py-2 text-[11px] text-accent font-mono bg-accent/5 border border-accent/20 rounded-lg">
            {'{{' + config.outputVar + '}}'}
          </div>
        </div>
      )}
    </div>
  )
}

function ConditionConfig({ config, language }: { config: any; language: 'en' | 'zh' }) {
  return (
    <div className="space-y-3">
      <div>
        <label className="text-[11px] font-medium text-text-secondary mb-1 block">
          {language === 'zh' ? '条件表达式' : 'Condition'}
        </label>
        <div className="px-3 py-2 text-[11px] text-text-muted/70 bg-surface/30 border border-border/30 rounded-lg font-mono">
          {config.expression || '-'}
        </div>
      </div>
    </div>
  )
}

function UserInputConfig({ config, language }: { config: any; language: 'en' | 'zh' }) {
  return (
    <div className="space-y-3">
      <div>
        <label className="text-[11px] font-medium text-text-secondary mb-1 block">
          {language === 'zh' ? '提示信息' : 'Prompt'}
        </label>
        <div className="px-3 py-2 text-[11px] text-text-muted/70 bg-surface/30 border border-border/30 rounded-lg">
          {config.prompt || '-'}
        </div>
      </div>
    </div>
  )
}
