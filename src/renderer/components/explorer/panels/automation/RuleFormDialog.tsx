/**
 * RuleFormDialog — 自动化规则创建/编辑对话框
 *
 * 表单字段：
 * - 规则名称、描述
 * - 触发器类型 + 配置（cron / event / webhook path）
 * - 动作类型 + 配置（prompt / channel / url / workflowId 等）
 * - 启用状态
 */
import { useState, useCallback, useEffect } from 'react'
import { Clock } from 'lucide-react'
import { OverlayDialog } from '@components/ui/OverlayDialog'
import { useStore } from '@store'
import type { AutomationRule } from '../tasks/types'
import { CronBuilder } from './CronBuilder'
import { WorkflowSelector } from './WorkflowSelector'

interface RuleFormDialogProps {
  rule: AutomationRule | null
  onSubmit: (data: {
    name: string
    description?: string
    triggerType: string
    triggerConfig: Record<string, unknown>
    actionType: string
    actionConfig: Record<string, unknown>
    enabled?: boolean
  }) => void
  onClose: () => void
}

const TRIGGER_TYPES = [
  { value: 'schedule', label: 'Schedule (Cron)', labelZh: '定时（Cron）' },
  { value: 'event', label: 'Event', labelZh: '事件' },
  { value: 'webhook', label: 'Webhook', labelZh: 'Webhook' },
]

const ACTION_TYPES = [
  { value: 'agent', label: 'Run Agent', labelZh: '调用 Agent' },
  { value: 'workflow', label: 'Run Workflow', labelZh: '执行工作流' },
  { value: 'notification', label: 'Send Notification', labelZh: '发送通知' },
  { value: 'webhook', label: 'Call Webhook', labelZh: '调用 Webhook' },
  { value: 'knowledge', label: 'Save to Knowledge', labelZh: '归档知识库' },
  { value: 'email', label: 'Send Email', labelZh: '发送邮件' },
]

export function RuleFormDialog({ rule, onSubmit, onClose }: RuleFormDialogProps) {
  const language = useStore(s => s.language)
  const isZh = language === 'zh'
  const isEdit = !!rule

  const triggerConfig = rule?.triggerConfig as { type?: string; cron?: string; event?: string; path?: string } ?? {}
  const actionConfig = rule?.actionConfig as { type?: string; prompt?: string; channel?: string; url?: string; workflowId?: string; template?: string } ?? {}

  const [name, setName] = useState(rule?.name ?? '')
  const [description, setDescription] = useState(rule?.description ?? '')
  const [triggerType, setTriggerType] = useState(triggerConfig.type ?? 'schedule')
  const [triggerCron, setTriggerCron] = useState(triggerConfig.cron ?? '')
  const [triggerEvent, setTriggerEvent] = useState(triggerConfig.event ?? '')
  const [triggerPath, setTriggerPath] = useState(triggerConfig.path ?? '')
  const [actionType, setActionType] = useState(actionConfig.type ?? 'agent')
  const [actionPrompt, setActionPrompt] = useState(actionConfig.prompt ?? '')
  const [actionChannel, setActionChannel] = useState(actionConfig.channel ?? '')
  const [actionUrl, setActionUrl] = useState(actionConfig.url ?? '')
  const [actionWorkflowId, setActionWorkflowId] = useState(actionConfig.workflowId ?? '')
  const [actionTemplate, setActionTemplate] = useState(actionConfig.template ?? '')
  const [enabled, setEnabled] = useState(rule?.enabled ?? true)
  const [error, setError] = useState<string | null>(null)
  const [showCronBuilder, setShowCronBuilder] = useState(false)

  useEffect(() => {
    setName(rule?.name ?? '')
    setDescription(rule?.description ?? '')
    setTriggerType(triggerConfig.type ?? 'schedule')
    setTriggerCron(triggerConfig.cron ?? '')
    setTriggerEvent(triggerConfig.event ?? '')
    setTriggerPath(triggerConfig.path ?? '')
    setActionType(actionConfig.type ?? 'agent')
    setActionPrompt(actionConfig.prompt ?? '')
    setActionChannel(actionConfig.channel ?? '')
    setActionUrl(actionConfig.url ?? '')
    setActionWorkflowId(actionConfig.workflowId ?? '')
    setActionTemplate(actionConfig.template ?? '')
    setEnabled(rule?.enabled ?? true)
    setError(null)
    setShowCronBuilder(false)
  }, [rule])

  const handleSubmit = useCallback(() => {
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError(isZh ? '请输入规则名称' : 'Please enter a rule name')
      return
    }

    // 构建触发器配置
    const triggerConfig: Record<string, unknown> = {}
    if (triggerType === 'schedule' && triggerCron) {
      triggerConfig.cron = triggerCron
    }
    if (triggerType === 'event' && triggerEvent) {
      triggerConfig.event = triggerEvent
    }
    if (triggerType === 'webhook' && triggerPath) {
      triggerConfig.path = triggerPath
    }

    // 构建动作配置
    const actionConfig: Record<string, unknown> = {}
    if (actionPrompt) actionConfig.prompt = actionPrompt
    if (actionChannel) actionConfig.channel = actionChannel
    if (actionUrl) actionConfig.url = actionUrl
    if (actionWorkflowId) actionConfig.workflowId = actionWorkflowId
    if (actionTemplate) actionConfig.template = actionTemplate

    // agent 类型动作：携带当前模型快照（provider/model），供后端兜底执行时使用
    // 注意：本地优先执行总是用 useStore.llmConfig 当前值，快照仅用于后端兜底
    if (actionType === 'agent') {
      const llmConfig = useStore.getState().llmConfig
      if (llmConfig?.provider && llmConfig?.model) {
        actionConfig.modelConfig = {
          provider: llmConfig.provider,
          model: llmConfig.model,
        }
      }
    }

    onSubmit({
      name: trimmedName,
      description: description.trim() || undefined,
      triggerType,
      triggerConfig,
      actionType,
      actionConfig,
      enabled,
    })
  }, [name, description, triggerType, triggerCron, triggerEvent, triggerPath, actionType, actionPrompt, actionChannel, actionUrl, actionWorkflowId, actionTemplate, enabled, isZh, onSubmit])

  return (
    <OverlayDialog
      isOpen
      onClose={onClose}
      title={isEdit ? (isZh ? '编辑规则' : 'Edit Rule') : (isZh ? '新建规则' : 'New Rule')}
      size="lg"
    >
      <div className="space-y-4">
        {/* 名称 */}
        <div>
          <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
            {isZh ? '规则名称' : 'Rule Name'} <span className="text-red-500">*</span>
          </label>
          <input
            autoFocus
            value={name}
            onChange={e => { setName(e.target.value); setError(null) }}
            placeholder={isZh ? '输入规则名称...' : 'Enter rule name...'}
            className={`w-full px-3 py-2 bg-surface/50 rounded-lg border text-[13px] text-text-primary outline-none transition-colors ${error ? 'border-red-500/50' : 'border-border/40 focus:border-accent/50'}`}
          />
          {error && <p className="text-[12px] text-red-500 mt-1">{error}</p>}
        </div>

        {/* 描述 */}
        <div>
          <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
            {isZh ? '描述' : 'Description'}
          </label>
          <input
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder={isZh ? '规则描述...' : 'Rule description...'}
            className="w-full px-3 py-2 bg-surface/50 rounded-lg border border-border/40 focus:border-accent/50 text-[13px] text-text-primary outline-none transition-colors"
          />
        </div>

        {/* 触发器 */}
        <div className="p-4 rounded-lg bg-amber-500/5 border border-amber-500/20 space-y-3">
          <div className="text-[12px] font-semibold text-amber-500 flex items-center gap-1.5">
            ⚡ {isZh ? '触发器' : 'Trigger'}
          </div>
          <div>
            <label className="block text-[12px] text-text-secondary mb-1">{isZh ? '类型' : 'Type'}</label>
            <select
              value={triggerType}
              onChange={e => setTriggerType(e.target.value)}
              className="w-full px-3 py-2 bg-surface/50 rounded-lg border border-border/40 focus:border-accent/50 text-[13px] text-text-primary outline-none transition-colors"
            >
              {TRIGGER_TYPES.map(t => (
                <option key={t.value} value={t.value}>{isZh ? t.labelZh : t.label}</option>
              ))}
            </select>
          </div>
          {triggerType === 'schedule' && (
            <div>
              <label className="block text-[12px] text-text-secondary mb-1">Cron {isZh ? '表达式' : 'Expression'}</label>
              <div className="flex gap-2">
                <input
                  value={triggerCron}
                  onChange={e => setTriggerCron(e.target.value)}
                  placeholder="0 9 * * 1-5 (Mon-Fri 9:00)"
                  className="flex-1 px-3 py-2 bg-surface/50 rounded-lg border border-border/40 focus:border-accent/50 text-[13px] text-text-primary outline-none transition-colors font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowCronBuilder(true)}
                  className="flex items-center gap-1.5 px-3 py-2 bg-surface/50 rounded-lg border border-border/40 text-[13px] text-text-primary hover:border-accent/50 hover:bg-surface-hover/40 transition-colors whitespace-nowrap"
                  title={isZh ? '打开 Cron 表达式生成器' : 'Open Cron expression builder'}
                >
                  <Clock className="w-3.5 h-3.5 text-accent" />
                  {isZh ? '生成' : 'Generate'}
                </button>
              </div>
              <p className="text-[11px] text-text-muted mt-1">
                {isZh ? '格式：分 时 日 月 周' : 'Format: minute hour day month weekday'}
              </p>
            </div>
          )}
          {triggerType === 'event' && (
            <div>
              <label className="block text-[12px] text-text-secondary mb-1">{isZh ? '事件名称' : 'Event Name'}</label>
              <input
                value={triggerEvent}
                onChange={e => setTriggerEvent(e.target.value)}
                placeholder="task.completed"
                className="w-full px-3 py-2 bg-surface/50 rounded-lg border border-border/40 focus:border-accent/50 text-[13px] text-text-primary outline-none transition-colors font-mono"
              />
            </div>
          )}
          {triggerType === 'webhook' && (
            <div>
              <label className="block text-[12px] text-text-secondary mb-1">Webhook Path</label>
              <input
                value={triggerPath}
                onChange={e => setTriggerPath(e.target.value)}
                placeholder="/webhook/my-rule"
                className="w-full px-3 py-2 bg-surface/50 rounded-lg border border-border/40 focus:border-accent/50 text-[13px] text-text-primary outline-none transition-colors font-mono"
              />
            </div>
          )}
        </div>

        {/* 动作 */}
        <div className="p-4 rounded-lg bg-blue-500/5 border border-blue-500/20 space-y-3">
          <div className="text-[12px] font-semibold text-blue-500 flex items-center gap-1.5">
            ▸ {isZh ? '动作' : 'Action'}
          </div>
          <div>
            <label className="block text-[12px] text-text-secondary mb-1">{isZh ? '类型' : 'Type'}</label>
            <select
              value={actionType}
              onChange={e => setActionType(e.target.value)}
              className="w-full px-3 py-2 bg-surface/50 rounded-lg border border-border/40 focus:border-accent/50 text-[13px] text-text-primary outline-none transition-colors"
            >
              {ACTION_TYPES.map(a => (
                <option key={a.value} value={a.value}>{isZh ? a.labelZh : a.label}</option>
              ))}
            </select>
          </div>
          {actionType === 'agent' && (
            <div>
              <label className="block text-[12px] text-text-secondary mb-1">{isZh ? '提示词' : 'Prompt'}</label>
              <textarea
                value={actionPrompt}
                onChange={e => setActionPrompt(e.target.value)}
                placeholder={isZh ? '给 Agent 的指令...' : 'Instructions for the agent...'}
                rows={3}
                className="w-full px-3 py-2 bg-surface/50 rounded-lg border border-border/40 focus:border-accent/50 text-[13px] text-text-primary outline-none transition-colors resize-none"
              />
            </div>
          )}
          {actionType === 'workflow' && (
            <div>
              <label className="block text-[12px] text-text-secondary mb-1">{isZh ? '工作流' : 'Workflow'}</label>
              <WorkflowSelector
                value={actionWorkflowId}
                onChange={setActionWorkflowId}
                isZh={isZh}
              />
            </div>
          )}
          {actionType === 'notification' && (
            <>
              <div>
                <label className="block text-[12px] text-text-secondary mb-1">{isZh ? '渠道' : 'Channel'}</label>
                <input
                  value={actionChannel}
                  onChange={e => setActionChannel(e.target.value)}
                  placeholder="in-app / email / webhook"
                  className="w-full px-3 py-2 bg-surface/50 rounded-lg border border-border/40 focus:border-accent/50 text-[13px] text-text-primary outline-none transition-colors"
                />
              </div>
              <div>
                <label className="block text-[12px] text-text-secondary mb-1">{isZh ? '消息模板' : 'Message Template'}</label>
                <textarea
                  value={actionTemplate}
                  onChange={e => setActionTemplate(e.target.value)}
                  placeholder={isZh ? '消息内容，支持 {{变量}}' : 'Message content, supports {{variables}}'}
                  rows={2}
                  className="w-full px-3 py-2 bg-surface/50 rounded-lg border border-border/40 focus:border-accent/50 text-[13px] text-text-primary outline-none transition-colors resize-none"
                />
              </div>
            </>
          )}
          {actionType === 'webhook' && (
            <div>
              <label className="block text-[12px] text-text-secondary mb-1">URL</label>
              <input
                value={actionUrl}
                onChange={e => setActionUrl(e.target.value)}
                placeholder="https://example.com/webhook"
                className="w-full px-3 py-2 bg-surface/50 rounded-lg border border-border/40 focus:border-accent/50 text-[13px] text-text-primary outline-none transition-colors"
              />
            </div>
          )}
        </div>

        {/* 启用状态 */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={e => setEnabled(e.target.checked)}
            className="w-4 h-4 rounded accent-accent"
          />
          <span className="text-[13px] text-text-primary">{isZh ? '创建后立即启用' : 'Enable immediately'}</span>
        </label>

        {/* 操作按钮 */}
        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-[13px] font-medium text-text-secondary rounded-lg hover:bg-surface-hover/50 transition-colors"
          >
            {isZh ? '取消' : 'Cancel'}
          </button>
          <button
            onClick={handleSubmit}
            className="px-4 py-2 text-[13px] font-medium bg-accent text-white rounded-lg hover:bg-accent/90 transition-colors"
          >
            {isEdit ? (isZh ? '保存' : 'Save') : (isZh ? '创建' : 'Create')}
          </button>
        </div>
      </div>

      {/* Cron 表达式生成器（通过 portal 渲染到顶层，覆盖在当前表单之上） */}
      {showCronBuilder && (
        <CronBuilder
          value={triggerCron || '* * * * *'}
          onConfirm={cron => { setTriggerCron(cron); setShowCronBuilder(false) }}
          onClose={() => setShowCronBuilder(false)}
        />
      )}
    </OverlayDialog>
  )
}
