import { useState, useCallback, useMemo } from 'react'
import { useStore } from '@store'
import { workflowEngine, BUILTIN_AGENT_ROLES } from '@shared/types/workflow'
import type {
  WorkflowDefinition,
  WorkflowStep,
  WorkflowStepType,
  AgentRole,
} from '@shared/types/workflow'
import {
  Plus,
  Trash2,
  GripVertical,
  MessageSquare,
  UserCheck,
  GitBranch,
  Layers,
  Clock,
  ChevronDown,
  Save,
  X,
  Sparkles,
} from 'lucide-react'

interface WorkflowBuilderProps {
  workflow: WorkflowDefinition
  onSave: (wf: WorkflowDefinition) => void
  onCancel: () => void
  language: 'en' | 'zh'
}

const STEP_TYPE_OPTIONS: Array<{
  type: WorkflowStepType
  icon: React.ComponentType<{ className?: string }>
  labelEn: string
  labelZh: string
  descEn: string
  descZh: string
}> = [
  {
    type: 'agent_message',
    icon: MessageSquare,
    labelEn: 'Agent Task',
    labelZh: '智能体任务',
    descEn: 'Send a message to an AI agent and get a response',
    descZh: '向 AI 智能体发送消息并获取响应',
  },
  {
    type: 'user_input',
    icon: UserCheck,
    labelEn: 'Human Input',
    labelZh: '人工输入',
    descEn: 'Pause for human approval or input',
    descZh: '暂停等待人工审批或输入',
  },
  {
    type: 'condition',
    icon: GitBranch,
    labelEn: 'Condition',
    labelZh: '条件分支',
    descEn: 'Branch based on a condition',
    descZh: '基于条件进行分支',
  },
  {
    type: 'parallel',
    icon: Layers,
    labelEn: 'Parallel',
    labelZh: '并行执行',
    descEn: 'Execute multiple steps in parallel',
    descZh: '并行执行多个步骤',
  },
  {
    type: 'delay',
    icon: Clock,
    labelEn: 'Delay',
    labelZh: '延时等待',
    descEn: 'Wait for a specified duration',
    descZh: '等待指定时长',
  },
]

function generateStepId(): string {
  return `step-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

function createDefaultStep(type: WorkflowStepType, index: number): WorkflowStep {
  const id = generateStepId()
  const base = { id, name: `Step ${index + 1}`, type }

  switch (type) {
    case 'agent_message':
      return { ...base, roleId: 'developer', config: { type: 'agent_message', message: '', waitForResponse: true } }
    case 'user_input':
      return { ...base, config: { type: 'user_input', prompt: '', outputVar: `input_${index}` } }
    case 'condition':
      return { ...base, config: { type: 'condition', expression: '', thenStep: '', elseStep: '' } }
    case 'parallel':
      return { ...base, config: { type: 'parallel', steps: [] } }
    case 'delay':
      return { ...base, config: { type: 'delay', durationMs: 1000 } }
    default:
      return { ...base, config: { type: 'agent_message', message: '', waitForResponse: true } }
  }
}

export default function WorkflowBuilder({ workflow, onSave, onCancel, language }: WorkflowBuilderProps) {
  const [wf, setWf] = useState<WorkflowDefinition>({ ...workflow })
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null)
  const [showAddMenu, setShowAddMenu] = useState(false)

  const orderedSteps = useMemo(() => {
    const steps: WorkflowStep[] = []
    let currentId: string | undefined = wf.startStep
    const visited = new Set<string>()

    while (currentId && !visited.has(currentId)) {
      visited.add(currentId)
      const step = wf.steps[currentId]
      if (!step) break
      steps.push(step)
      currentId = step.next
    }

    for (const [id, step] of Object.entries(wf.steps)) {
      if (!visited.has(id)) {
        steps.push(step)
      }
    }

    return steps
  }, [wf])

  const selectedStep = selectedStepId ? wf.steps[selectedStepId] : null

  const updateWorkflow = useCallback((updates: Partial<WorkflowDefinition>) => {
    setWf(prev => ({ ...prev, ...updates }))
  }, [])

  const addStep = useCallback((type: WorkflowStepType) => {
    const newStep = createDefaultStep(type, Object.keys(wf.steps).length)
    const newSteps = { ...wf.steps, [newStep.id]: newStep }

    const stepIds = Object.keys(wf.steps)
    if (stepIds.length === 0) {
      setWf(prev => ({ ...prev, steps: newSteps, startStep: newStep.id }))
    } else {
      const lastStep = wf.steps[orderedSteps[orderedSteps.length - 1]?.id]
      if (lastStep && !lastStep.next) {
        const updatedLast = { ...lastStep, next: newStep.id }
        newSteps[lastStep.id] = updatedLast
      }
      setWf(prev => ({ ...prev, steps: newSteps }))
    }

    setShowAddMenu(false)
    setSelectedStepId(newStep.id)
  }, [wf, orderedSteps])

  const removeStep = useCallback((stepId: string) => {
    const newSteps = { ...wf.steps }
    const step = newSteps[stepId]
    if (!step) return

    for (const [id, s] of Object.entries(newSteps)) {
      if (s.next === stepId) {
        newSteps[id] = { ...s, next: step.next }
      }
    }

    delete newSteps[stepId]

    let startStep = wf.startStep
    if (wf.startStep === stepId) {
      startStep = step.next || Object.keys(newSteps)[0] || ''
    }

    setWf(prev => ({ ...prev, steps: newSteps, startStep }))
    if (selectedStepId === stepId) setSelectedStepId(null)
  }, [wf, selectedStepId])

  const updateStep = useCallback((stepId: string, updates: Partial<WorkflowStep>) => {
    setWf(prev => {
      const step = prev.steps[stepId]
      if (!step) return prev
      return {
        ...prev,
        steps: { ...prev.steps, [stepId]: { ...step, ...updates } },
      }
    })
  }, [])

  const updateStepConfig = useCallback((stepId: string, configUpdates: Record<string, unknown>) => {
    setWf(prev => {
      const step = prev.steps[stepId]
      if (!step) return prev
      return {
        ...prev,
        steps: {
          ...prev.steps,
          [stepId]: { ...step, config: { ...step.config, ...configUpdates } as any },
        },
      }
    })
  }, [])

  const handleSave = useCallback(() => {
    if (!wf.name.trim()) return
    onSave({ ...wf, isCustom: true })
  }, [wf, onSave])

  const getRoleInfo = useCallback((roleId?: string): AgentRole | undefined => {
    if (!roleId) return undefined
    return BUILTIN_AGENT_ROLES.find(r => r.id === roleId)
  }, [])

  return (
    <div className="flex h-full">
      {/* Left: Step List */}
      <div className="w-[280px] border-r border-border/40 flex flex-col">
        <div className="px-4 py-3 border-b border-border/30">
          <h3 className="text-[12px] font-semibold text-text-secondary">
            {language === 'zh' ? '步骤列表' : 'Steps'}
          </h3>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-1.5">
          {orderedSteps.map((step, index) => {
            const role = getRoleInfo(step.roleId)
            const isSelected = selectedStepId === step.id
            const isStart = wf.startStep === step.id
            const StepIcon = STEP_TYPE_OPTIONS.find(o => o.type === step.type)?.icon || MessageSquare

            return (
              <button
                key={step.id}
                onClick={() => setSelectedStepId(step.id)}
                className={`w-full text-left p-2.5 rounded-lg border transition-all ${
                  isSelected
                    ? 'border-accent/40 bg-accent/5'
                    : 'border-border/20 hover:border-border/40 hover:bg-surface-hover'
                }`}
              >
                <div className="flex items-center gap-2">
                  <GripVertical className="w-3 h-3 text-text-muted/30 flex-shrink-0" />
                  <div
                    className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: role ? `${role.color}15` : 'rgba(107,114,128,0.1)' }}
                  >
                    <StepIcon
                      className="w-3.5 h-3.5"
                      style={{ color: role?.color || '#6b7280' }}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <span className="text-[11px] font-medium text-text-primary truncate">
                        {step.nameZh && language === 'zh' ? step.nameZh : step.name}
                      </span>
                      {isStart && (
                        <span className="px-1 py-0 text-[8px] font-bold bg-green-500/10 text-green-400 rounded">
                          START
                        </span>
                      )}
                    </div>
                    {role && (
                      <span className="text-[9px] text-text-muted/50 truncate block">
                        {language === 'zh' ? role.nameZh : role.name}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); removeStep(step.id) }}
                    className="p-0.5 rounded text-text-muted/30 hover:text-red-400 transition-colors flex-shrink-0"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </button>
            )
          })}

          {orderedSteps.length === 0 && (
            <div className="text-center py-8 text-text-muted/30">
              <p className="text-[11px]">
                {language === 'zh' ? '点击下方按钮添加步骤' : 'Add steps below'}
              </p>
            </div>
          )}
        </div>

        {/* Add Step Button */}
        <div className="p-3 border-t border-border/30 relative">
          {showAddMenu && (
            <div className="absolute bottom-full left-3 right-3 mb-2 bg-background border border-border/50 rounded-xl shadow-xl overflow-hidden z-10">
              {STEP_TYPE_OPTIONS.map(opt => {
                const OptIcon = opt.icon
                return (
                  <button
                    key={opt.type}
                    onClick={() => addStep(opt.type)}
                    className="w-full text-left px-3 py-2.5 hover:bg-surface-hover transition-colors flex items-center gap-2.5"
                  >
                    <OptIcon className="w-4 h-4 text-accent/70" />
                    <div>
                      <p className="text-[11px] font-medium text-text-primary">
                        {language === 'zh' ? opt.labelZh : opt.labelEn}
                      </p>
                      <p className="text-[9px] text-text-muted/50">
                        {language === 'zh' ? opt.descZh : opt.descEn}
                      </p>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
          <button
            onClick={() => setShowAddMenu(!showAddMenu)}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-[11px] font-medium bg-accent/10 text-accent hover:bg-accent/15 rounded-lg transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            {language === 'zh' ? '添加步骤' : 'Add Step'}
          </button>
        </div>
      </div>

      {/* Right: Step Editor */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {selectedStep ? (
          <StepEditor
            step={selectedStep}
            allSteps={wf.steps}
            workflow={wf}
            onUpdate={updateStep}
            onUpdateConfig={updateStepConfig}
            language={language}
          />
        ) : (
          <div className="p-6">
            <div className="space-y-4">
              <div>
                <label className="text-[11px] font-medium text-text-secondary mb-1.5 block">
                  {language === 'zh' ? '工作流名称' : 'Workflow Name'}
                </label>
                <input
                  type="text"
                  value={wf.nameZh && language === 'zh' ? wf.nameZh : wf.name}
                  onChange={e => {
                    if (language === 'zh') {
                      updateWorkflow({ nameZh: e.target.value, name: e.target.value })
                    } else {
                      updateWorkflow({ name: e.target.value })
                    }
                  }}
                  placeholder={language === 'zh' ? '输入工作流名称' : 'Enter workflow name'}
                  className="w-full px-3 py-2 text-[12px] bg-surface/50 border border-border/40 rounded-lg text-text-primary placeholder:text-text-muted/30 focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all"
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-text-secondary mb-1.5 block">
                  {language === 'zh' ? '描述' : 'Description'}
                </label>
                <textarea
                  value={wf.descriptionZh && language === 'zh' ? wf.descriptionZh : wf.description}
                  onChange={e => {
                    if (language === 'zh') {
                      updateWorkflow({ descriptionZh: e.target.value, description: e.target.value })
                    } else {
                      updateWorkflow({ description: e.target.value })
                    }
                  }}
                  placeholder={language === 'zh' ? '描述工作流的用途' : 'Describe the workflow purpose'}
                  rows={3}
                  className="w-full px-3 py-2 text-[12px] bg-surface/50 border border-border/40 rounded-lg text-text-primary placeholder:text-text-muted/30 focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all resize-none"
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-text-secondary mb-1.5 block">
                  {language === 'zh' ? '分类' : 'Category'}
                </label>
                <select
                  value={wf.category}
                  onChange={e => updateWorkflow({ category: e.target.value as any })}
                  className="w-full px-3 py-2 text-[12px] bg-surface/50 border border-border/40 rounded-lg text-text-primary focus:outline-none focus:border-accent/50 transition-all"
                >
                  <option value="development">{language === 'zh' ? '开发' : 'Development'}</option>
                  <option value="code-review">{language === 'zh' ? '代码审查' : 'Code Review'}</option>
                  <option value="documentation">{language === 'zh' ? '文档' : 'Documentation'}</option>
                  <option value="testing">{language === 'zh' ? '测试' : 'Testing'}</option>
                  <option value="automation">{language === 'zh' ? '自动化' : 'Automation'}</option>
                  <option value="custom">{language === 'zh' ? '自定义' : 'Custom'}</option>
                </select>
              </div>

              <div className="pt-4 border-t border-border/20 text-center text-text-muted/30">
                <Sparkles className="w-6 h-6 mx-auto mb-2" />
                <p className="text-[11px]">
                  {language === 'zh' ? '选择左侧步骤进行编辑' : 'Select a step on the left to edit'}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Bar */}
      <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-6 py-3 border-t border-border/40 bg-background">
        <button
          onClick={onCancel}
          className="px-4 py-1.5 text-[12px] text-text-muted hover:text-text-primary transition-colors"
        >
          {language === 'zh' ? '取消' : 'Cancel'}
        </button>
        <button
          onClick={handleSave}
          disabled={!wf.name.trim()}
          className="flex items-center gap-1.5 px-4 py-1.5 text-[12px] font-medium bg-accent text-white hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-all"
        >
          <Save className="w-3.5 h-3.5" />
          {language === 'zh' ? '保存工作流' : 'Save Workflow'}
        </button>
      </div>
    </div>
  )
}

// ============================================
// Step Editor Sub-component
// ============================================

interface StepEditorProps {
  step: WorkflowStep
  allSteps: Record<string, WorkflowStep>
  workflow: WorkflowDefinition
  onUpdate: (stepId: string, updates: Partial<WorkflowStep>) => void
  onUpdateConfig: (stepId: string, configUpdates: Record<string, unknown>) => void
  language: 'en' | 'zh'
}

function StepEditor({ step, allSteps, workflow, onUpdate, onUpdateConfig, language }: StepEditorProps) {
  const otherSteps = Object.values(allSteps).filter(s => s.id !== step.id)
  const role = step.roleId ? BUILTIN_AGENT_ROLES.find(r => r.id === step.roleId) : undefined

  return (
    <div className="p-5 space-y-5">
      {/* Step Name */}
      <div>
        <label className="text-[11px] font-medium text-text-secondary mb-1.5 block">
          {language === 'zh' ? '步骤名称' : 'Step Name'}
        </label>
        <input
          type="text"
          value={step.nameZh && language === 'zh' ? step.nameZh : step.name}
          onChange={e => {
            const val = e.target.value
            if (language === 'zh') {
              onUpdate(step.id, { nameZh: val, name: val })
            } else {
              onUpdate(step.id, { name: val })
            }
          }}
          className="w-full px-3 py-2 text-[12px] bg-surface/50 border border-border/40 rounded-lg text-text-primary focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all"
        />
      </div>

      {/* Agent Role (only for agent_message) */}
      {step.type === 'agent_message' && (
        <div>
          <label className="text-[11px] font-medium text-text-secondary mb-1.5 block">
            {language === 'zh' ? '智能体角色' : 'Agent Role'}
          </label>
          <div className="grid grid-cols-2 gap-2">
            {BUILTIN_AGENT_ROLES.map(r => {
              const RoleIcon = STEP_TYPE_OPTIONS[0]?.icon || MessageSquare
              const isSelected = step.roleId === r.id
              return (
                <button
                  key={r.id}
                  onClick={() => onUpdate(step.id, { roleId: r.id })}
                  className={`text-left p-2.5 rounded-lg border transition-all ${
                    isSelected
                      ? 'border-accent/40 bg-accent/5'
                      : 'border-border/20 hover:border-border/40 hover:bg-surface-hover'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div
                      className="w-5 h-5 rounded flex items-center justify-center"
                      style={{ backgroundColor: `${r.color}15` }}
                    >
                      <MessageSquare className="w-3 h-3" style={{ color: r.color }} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] font-medium text-text-primary truncate">
                        {language === 'zh' ? r.nameZh : r.name}
                      </p>
                    </div>
                  </div>
                  <p className="text-[9px] text-text-muted/50 mt-1 line-clamp-2">
                    {language === 'zh' ? r.descriptionZh : r.description}
                  </p>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Agent Message */}
      {step.type === 'agent_message' && (
        <>
          <div>
            <label className="text-[11px] font-medium text-text-secondary mb-1.5 block">
              {language === 'zh' ? '提示消息' : 'Prompt Message'}
            </label>
            <textarea
              value={(step.config as any).message || ''}
              onChange={e => onUpdateConfig(step.id, { message: e.target.value })}
              placeholder={language === 'zh' ? '输入发送给智能体的消息...（使用 {{变量名}} 引用前序步骤输出）' : 'Enter message to send to agent... (Use {{varName}} to reference previous step outputs)'}
              rows={5}
              className="w-full px-3 py-2 text-[12px] bg-surface/50 border border-border/40 rounded-lg text-text-primary placeholder:text-text-muted/30 focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all resize-none font-mono"
            />
          </div>
          <div>
            <label className="text-[11px] font-medium text-text-secondary mb-1.5 block">
              {language === 'zh' ? '输出变量名' : 'Output Variable'}
            </label>
            <input
              type="text"
              value={(step.config as any).outputVar || ''}
              onChange={e => onUpdateConfig(step.id, { outputVar: e.target.value })}
              placeholder={language === 'zh' ? '如：analysis（后续步骤用 {{analysis}} 引用）' : 'e.g. analysis (reference with {{analysis}} later)'}
              className="w-full px-3 py-2 text-[12px] bg-surface/50 border border-border/40 rounded-lg text-text-primary placeholder:text-text-muted/30 focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all font-mono"
            />
          </div>
        </>
      )}

      {/* User Input */}
      {step.type === 'user_input' && (
        <>
          <div>
            <label className="text-[11px] font-medium text-text-secondary mb-1.5 block">
              {language === 'zh' ? '提示文字' : 'Prompt'}
            </label>
            <textarea
              value={(step.config as any).prompt || ''}
              onChange={e => onUpdateConfig(step.id, { prompt: e.target.value })}
              placeholder={language === 'zh' ? '输入给用户看的提示文字' : 'Enter prompt text for the user'}
              rows={3}
              className="w-full px-3 py-2 text-[12px] bg-surface/50 border border-border/40 rounded-lg text-text-primary placeholder:text-text-muted/30 focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all resize-none"
            />
          </div>
          <div>
            <label className="text-[11px] font-medium text-text-secondary mb-1.5 block">
              {language === 'zh' ? '输出变量名' : 'Output Variable'}
            </label>
            <input
              type="text"
              value={(step.config as any).outputVar || ''}
              onChange={e => onUpdateConfig(step.id, { outputVar: e.target.value })}
              placeholder="approval"
              className="w-full px-3 py-2 text-[12px] bg-surface/50 border border-border/40 rounded-lg text-text-primary placeholder:text-text-muted/30 focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all font-mono"
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={(step.config as any).approvalMode || false}
              onChange={e => onUpdateConfig(step.id, { approvalMode: e.target.checked })}
              className="rounded border-border/40"
            />
            <label className="text-[11px] text-text-secondary">
              {language === 'zh' ? '审批模式（批准/拒绝按钮）' : 'Approval mode (approve/reject buttons)'}
            </label>
          </div>
        </>
      )}

      {/* Condition */}
      {step.type === 'condition' && (
        <>
          <div>
            <label className="text-[11px] font-medium text-text-secondary mb-1.5 block">
              {language === 'zh' ? '条件表达式' : 'Condition Expression'}
            </label>
            <input
              type="text"
              value={(step.config as any).expression || ''}
              onChange={e => onUpdateConfig(step.id, { expression: e.target.value })}
              placeholder={language === 'zh' ? '如：approval === "approved"' : 'e.g. approval === "approved"'}
              className="w-full px-3 py-2 text-[12px] bg-surface/50 border border-border/40 rounded-lg text-text-primary placeholder:text-text-muted/30 focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all font-mono"
            />
          </div>
          <div>
            <label className="text-[11px] font-medium text-text-secondary mb-1.5 block">
              {language === 'zh' ? '条件为真 → 跳转到' : 'If true → Go to'}
            </label>
            <select
              value={(step.config as any).thenStep || ''}
              onChange={e => onUpdateConfig(step.id, { thenStep: e.target.value })}
              className="w-full px-3 py-2 text-[12px] bg-surface/50 border border-border/40 rounded-lg text-text-primary focus:outline-none focus:border-accent/50 transition-all"
            >
              <option value="">--</option>
              {otherSteps.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[11px] font-medium text-text-secondary mb-1.5 block">
              {language === 'zh' ? '条件为假 → 跳转到' : 'If false → Go to'}
            </label>
            <select
              value={(step.config as any).elseStep || ''}
              onChange={e => onUpdateConfig(step.id, { elseStep: e.target.value })}
              className="w-full px-3 py-2 text-[12px] bg-surface/50 border border-border/40 rounded-lg text-text-primary focus:outline-none focus:border-accent/50 transition-all"
            >
              <option value="">--</option>
              {otherSteps.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        </>
      )}

      {/* Delay */}
      {step.type === 'delay' && (
        <div>
          <label className="text-[11px] font-medium text-text-secondary mb-1.5 block">
            {language === 'zh' ? '等待时长（毫秒）' : 'Duration (ms)'}
          </label>
          <input
            type="number"
            value={(step.config as any).durationMs || 1000}
            onChange={e => onUpdateConfig(step.id, { durationMs: parseInt(e.target.value) || 1000 })}
            className="w-full px-3 py-2 text-[12px] bg-surface/50 border border-border/40 rounded-lg text-text-primary focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all"
          />
        </div>
      )}

      {/* Next Step */}
      {step.type !== 'condition' && step.type !== 'parallel' && (
        <div>
          <label className="text-[11px] font-medium text-text-secondary mb-1.5 block">
            {language === 'zh' ? '下一步' : 'Next Step'}
          </label>
          <select
            value={step.next || ''}
            onChange={e => onUpdate(step.id, { next: e.target.value || undefined })}
            className="w-full px-3 py-2 text-[12px] bg-surface/50 border border-border/40 rounded-lg text-text-primary focus:outline-none focus:border-accent/50 transition-all"
          >
            <option value="">{language === 'zh' ? '（结束）' : '(End)'}</option>
            {otherSteps.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Set as Start Step */}
      {workflow.startStep !== step.id && (
        <button
          onClick={() => {
            onUpdate(step.id, step as any)
            const newWf = { ...workflow, startStep: step.id }
            workflowEngine.updateDefinition(newWf)
          }}
          className="text-[10px] text-accent/60 hover:text-accent transition-colors"
        >
          {language === 'zh' ? '设为起始步骤' : 'Set as start step'}
        </button>
      )}
    </div>
  )
}
