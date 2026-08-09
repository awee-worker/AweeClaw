/**
 * AutomationView — 自动化规则管理工作台（宽屏模式）
 *
 * 布局结构：
 * ┌────────────┬──────────────────────────────────────┐
 * │  规则列表   │  规则详情 / 编辑器 / 运行历史          │
 * │  (左侧)    │  触发器配置 | 动作配置 | 运行历史      │
 * └────────────┴──────────────────────────────────────┘
 *
 * 功能：
 * - 规则的 CRUD（创建、编辑、启用/禁用、删除）
 * - 手动执行规则
 * - 查看运行历史和统计
 * - 从模板创建规则
 */
import { useState, useCallback, useEffect, useMemo } from 'react'
import {
  Plus, Loader2, AlertCircle, Zap, Play, ArrowLeft,
  History, LayoutTemplate, Settings2,
} from 'lucide-react'
import { useStore } from '@store'
import { automationApi, getApiErrorMessage } from '@renderer/adapters/taskProjectApi'
import type {
  AutomationRule,
  AutomationRun,
  AutomationTemplate,
} from '../tasks/types'
import { RuleFormDialog } from './RuleFormDialog'
import { RunHistoryPanel } from './RunHistoryPanel'

type DetailTab = 'config' | 'history'

export function AutomationView() {
  const language = useStore(s => s.language)
  const isZh = language === 'zh'

  const [rules, setRules] = useState<AutomationRule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<DetailTab>('config')
  const [showFormDialog, setShowFormDialog] = useState(false)
  const [editingRule, setEditingRule] = useState<AutomationRule | null>(null)
  const [templates, setTemplates] = useState<AutomationTemplate[]>([])
  const [showTemplates, setShowTemplates] = useState(false)
  const [executing, setExecuting] = useState(false)

  // 运行历史
  const [runs, setRuns] = useState<AutomationRun[]>([])
  const [runsLoading, setRunsLoading] = useState(false)

  // ─── 数据加载 ───────────────────────────────────────

  const loadRules = useCallback(async () => {
    setLoading(true)
    try {
      const data = await automationApi.list()
      setRules(data)
      setError(null)
      if (data.length > 0 && !selectedId) {
        setSelectedId(data[0].id)
      }
    } catch (e) {
      setError(getApiErrorMessage(e, isZh ? '加载失败' : 'Failed to load'))
    }
    setLoading(false)
  }, [selectedId, isZh])

  useEffect(() => {
    loadRules()
    // 加载模板（用于从模板创建）
    automationApi.getTemplates().then(setTemplates).catch(() => {})
  }, [loadRules])

  // 加载选中规则的运行历史
  useEffect(() => {
    if (!selectedId || activeTab !== 'history') {
      setRuns([])
      return
    }
    setRunsLoading(true)
    automationApi
      .listRunsByRule(selectedId, { limit: 50 })
      .then(res => { setRuns(res.items); setRunsLoading(false) })
      .catch(() => { setRuns([]); setRunsLoading(false) })
  }, [selectedId, activeTab])

  const selectedRule = useMemo(
    () => rules.find(r => r.id === selectedId) || null,
    [rules, selectedId],
  )

  // ─── 操作回调 ───────────────────────────────────────

  const handleToggleEnabled = useCallback(async (rule: AutomationRule) => {
    // 乐观更新
    setRules(prev => prev.map(r =>
      r.id === rule.id ? { ...r, enabled: !r.enabled } : r,
    ))
    try {
      await automationApi.update(rule.id, { enabled: !rule.enabled })
    } catch {
      // 回滚
      setRules(prev => prev.map(r =>
        r.id === rule.id ? { ...r, enabled: rule.enabled } : r,
      ))
    }
  }, [])

  const handleDelete = useCallback(async (id: string) => {
    try {
      await automationApi.remove(id)
      setRules(prev => prev.filter(r => r.id !== id))
      if (selectedId === id) setSelectedId(null)
    } catch (e) {
      setError(getApiErrorMessage(e, isZh ? '删除失败' : 'Delete failed'))
    }
  }, [selectedId, isZh])

  const handleExecute = useCallback(async (id: string) => {
    setExecuting(true)
    try {
      await automationApi.execute(id)
      // 刷新运行历史
      if (activeTab === 'history') {
        const res = await automationApi.listRunsByRule(id, { limit: 50 })
        setRuns(res.items)
      }
    } catch (e) {
      setError(getApiErrorMessage(e, isZh ? '执行失败' : 'Execution failed'))
    }
    setExecuting(false)
  }, [activeTab])

  const handleCreateFromTemplate = useCallback(async (templateId: string) => {
    try {
      const created = await automationApi.createFromTemplate(templateId)
      setRules(prev => [created, ...prev])
      setSelectedId(created.id)
      setShowTemplates(false)
    } catch (e) {
      setError(getApiErrorMessage(e, isZh ? '创建失败' : 'Create failed'))
    }
  }, [])

  const handleFormSubmit = useCallback(async (data: {
    name: string
    description?: string
    triggerType: string
    triggerConfig: Record<string, unknown>
    actionType: string
    actionConfig: Record<string, unknown>
    enabled?: boolean
  }) => {
    if (editingRule) {
      try {
        const updated = await automationApi.update(editingRule.id, {
          name: data.name,
          description: data.description,
          triggerConfig: { type: data.triggerType, ...data.triggerConfig },
          actionConfig: { type: data.actionType, ...data.actionConfig },
          enabled: data.enabled,
        })
        setRules(prev => prev.map(r => r.id === updated.id ? updated : r))
        setShowFormDialog(false)
      } catch (e) {
        setError(getApiErrorMessage(e, isZh ? '更新失败' : 'Update failed'))
      }
    } else {
      try {
        const created = await automationApi.create({
          name: data.name,
          description: data.description,
          triggerType: data.triggerType,
          triggerConfig: data.triggerConfig,
          actionType: data.actionType,
          actionConfig: data.actionConfig,
          enabled: data.enabled ?? true,
        })
        setRules(prev => [created, ...prev])
        setSelectedId(created.id)
        setShowFormDialog(false)
      } catch (e) {
        setError(getApiErrorMessage(e, isZh ? '创建失败' : 'Create failed'))
      }
    }
  }, [editingRule, isZh])

  // ─── 渲染 ───────────────────────────────────────────

  return (
    <div className="flex h-full bg-background overflow-hidden">
      {/* 左侧：规则列表 */}
      <div className="flex-shrink-0 w-72 border-r border-border/40 flex flex-col bg-surface/20">
        <div className="flex-shrink-0 h-14 px-4 flex items-center justify-between border-b border-border/30">
          <h2 className="text-[15px] font-semibold text-text-primary">
            {isZh ? '自动化' : 'Automation'}
          </h2>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowTemplates(true)}
              className="p-1.5 rounded-md hover:bg-surface-hover/50 text-text-muted hover:text-text-primary transition-colors"
              title={isZh ? '从模板创建' : 'From template'}
            >
              <LayoutTemplate className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => { setEditingRule(null); setShowFormDialog(true) }}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-accent text-white rounded-md text-[12px] font-medium hover:bg-accent/90 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              {isZh ? '新建' : 'New'}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 text-accent animate-spin" />
            </div>
          ) : rules.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-text-muted">
              <Zap className="w-8 h-8 mb-2 opacity-25" />
              <p className="text-[12px]">{isZh ? '暂无自动化规则' : 'No automation rules'}</p>
              <button onClick={() => setShowTemplates(true)} className="mt-2 text-[12px] text-accent hover:underline">
                {isZh ? '从模板创建' : 'Create from template'}
              </button>
            </div>
          ) : (
            <div className="space-y-1">
              {rules.map(rule => (
                <RuleCard
                  key={rule.id}
                  rule={rule}
                  isSelected={rule.id === selectedId}
                  isZh={isZh}
                  onClick={() => { setSelectedId(rule.id); setActiveTab('config') }}
                  onToggleEnabled={() => handleToggleEnabled(rule)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 右侧：规则详情 */}
      <div className="flex-1 flex flex-col min-w-0">
        {!selectedRule ? (
          <div className="flex-1 flex flex-col items-center justify-center text-text-muted">
            <Zap className="w-12 h-12 mb-3 opacity-20" />
            <p className="text-[14px]">{isZh ? '选择一条规则查看详情' : 'Select a rule to view details'}</p>
            {templates.length > 0 && (
              <button onClick={() => setShowTemplates(true)} className="mt-3 flex items-center gap-1.5 text-[12px] text-accent hover:underline">
                <LayoutTemplate className="w-3.5 h-3.5" />
                {isZh ? '浏览模板库' : 'Browse templates'}
              </button>
            )}
          </div>
        ) : (
          <>
            {/* 详情头部 */}
            <div className="flex-shrink-0 h-14 px-5 flex items-center justify-between border-b border-border/40 bg-surface/30">
              <div className="flex items-center gap-3 min-w-0">
                <button
                  onClick={() => setSelectedId(null)}
                  className="p-1 rounded hover:bg-surface-hover/50 text-text-muted hover:text-text-primary transition-colors flex-shrink-0"
                  title={isZh ? '返回列表' : 'Back to list'}
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold text-text-primary truncate">{selectedRule.name}</div>
                  {selectedRule.description && (
                    <div className="text-[12px] text-text-muted truncate">{selectedRule.description}</div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleExecute(selectedRule.id)}
                  disabled={executing || !selectedRule.enabled}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-accent/10 text-accent rounded-md text-[12px] font-medium hover:bg-accent/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {executing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                  {isZh ? '执行' : 'Run'}
                </button>
                <button
                  onClick={() => { setEditingRule(selectedRule); setShowFormDialog(true) }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-hover/50 text-text-primary rounded-md text-[12px] font-medium hover:bg-surface-hover transition-colors"
                >
                  <Settings2 className="w-3.5 h-3.5" />
                  {isZh ? '编辑' : 'Edit'}
                </button>
                <button
                  onClick={() => handleDelete(selectedRule.id)}
                  className="px-3 py-1.5 bg-red-500/10 text-red-500 rounded-md text-[12px] font-medium hover:bg-red-500/20 transition-colors"
                >
                  {isZh ? '删除' : 'Delete'}
                </button>
              </div>
            </div>

            {/* Tab 栏 */}
            <div className="flex-shrink-0 px-5 flex items-center gap-1 border-b border-border/30 bg-surface/10">
              <button
                onClick={() => setActiveTab('config')}
                className={`px-3 py-2.5 text-[13px] font-medium border-b-2 transition-colors ${activeTab === 'config' ? 'border-accent text-accent' : 'border-transparent text-text-muted hover:text-text-primary'}`}
              >
                {isZh ? '配置' : 'Configuration'}
              </button>
              <button
                onClick={() => setActiveTab('history')}
                className={`px-3 py-2.5 text-[13px] font-medium border-b-2 transition-colors flex items-center gap-1.5 ${activeTab === 'history' ? 'border-accent text-accent' : 'border-transparent text-text-muted hover:text-text-primary'}`}
              >
                <History className="w-3.5 h-3.5" />
                {isZh ? '运行历史' : 'History'}
              </button>
            </div>

            {/* Tab 内容 */}
            <div className="flex-1 overflow-y-auto">
              {error && (
                <div className="mx-5 mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                  <span className="text-[13px] text-red-500">{error}</span>
                </div>
              )}
              {activeTab === 'config' && (
                <RuleConfigPanel rule={selectedRule} isZh={isZh} />
              )}
              {activeTab === 'history' && (
                <RunHistoryPanel runs={runs} loading={runsLoading} isZh={isZh} />
              )}
            </div>
          </>
        )}
      </div>

      {/* 创建/编辑对话框 */}
      {showFormDialog && (
        <RuleFormDialog
          rule={editingRule}
          onSubmit={handleFormSubmit}
          onClose={() => setShowFormDialog(false)}
        />
      )}

      {/* 模板选择 */}
      {showTemplates && (
        <TemplateGallery
          templates={templates}
          isZh={isZh}
          onSelect={handleCreateFromTemplate}
          onClose={() => setShowTemplates(false)}
        />
      )}
    </div>
  )
}

// ─── 规则卡片 ───────────────────────────────────────────

function RuleCard({
  rule, isSelected, isZh, onClick, onToggleEnabled,
}: {
  rule: AutomationRule
  isSelected: boolean
  isZh: boolean
  onClick: () => void
  onToggleEnabled: () => void
}) {
  const triggerType = (rule.triggerConfig as { type?: string })?.type ?? 'unknown'
  const actionType = (rule.actionConfig as { type?: string })?.type ?? 'unknown'

  return (
    <div
      onClick={onClick}
      className={`p-3 rounded-lg cursor-pointer transition-all border ${
        isSelected ? 'border-accent/40 bg-accent/5' : 'border-transparent hover:bg-surface-hover/40 hover:border-border/20'
      }`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-[13px] font-medium text-text-primary truncate flex-1">{rule.name}</span>
        <button
          onClick={(e) => { e.stopPropagation(); onToggleEnabled() }}
          className={`flex-shrink-0 ml-2 relative w-8 h-4 rounded-full transition-colors ${rule.enabled ? 'bg-accent' : 'bg-zinc-400/40'}`}
        >
          <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${rule.enabled ? 'left-4' : 'left-0.5'}`} />
        </button>
      </div>
      {rule.description && (
        <p className="text-[12px] text-text-muted truncate mb-1.5">{rule.description}</p>
      )}
      <div className="flex items-center gap-2 text-[11px] text-text-muted">
        <span className="flex items-center gap-0.5">
          <span className="text-amber-500">⚡</span>
          {triggerType}
        </span>
        <span>→</span>
        <span className="flex items-center gap-0.5">
          <span className="text-blue-500">▸</span>
          {actionType}
        </span>
        <span className="ml-auto">{rule.executionCount} {isZh ? '次' : 'runs'}</span>
      </div>
      {rule.lastError && (
        <div className="mt-1.5 text-[11px] text-red-500 truncate">
          ⚠ {rule.lastError}
        </div>
      )}
    </div>
  )
}

// ─── 规则配置面板 ───────────────────────────────────────

function RuleConfigPanel({ rule, isZh }: { rule: AutomationRule; isZh: boolean }) {
  const triggerConfig = rule.triggerConfig as { type?: string; cron?: string; event?: string; path?: string }
  const actionConfig = rule.actionConfig as { type?: string; workflowId?: string; agentId?: string; prompt?: string; channel?: string; url?: string; template?: string }

  return (
    <div className="p-5 max-w-3xl space-y-5">
      {/* 触发器配置 */}
      <div>
        <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-text-muted uppercase tracking-wider mb-3">
          <Zap className="w-3.5 h-3.5 text-amber-500" />
          {isZh ? '触发器' : 'Trigger'}
        </h3>
        <div className="p-4 rounded-lg bg-surface/30 border border-border/30 space-y-2">
          <ConfigRow label={isZh ? '类型' : 'Type'} value={triggerConfig.type || '-'} />
          {triggerConfig.cron && <ConfigRow label="Cron" value={triggerConfig.cron} mono />}
          {triggerConfig.event && <ConfigRow label={isZh ? '事件' : 'Event'} value={triggerConfig.event} mono />}
          {triggerConfig.path && <ConfigRow label={isZh ? '路径' : 'Path'} value={triggerConfig.path} mono />}
        </div>
      </div>

      {/* 动作配置 */}
      <div>
        <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-text-muted uppercase tracking-wider mb-3">
          <span className="text-blue-500">▸</span>
          {isZh ? '动作' : 'Action'}
        </h3>
        <div className="p-4 rounded-lg bg-surface/30 border border-border/30 space-y-2">
          <ConfigRow label={isZh ? '类型' : 'Type'} value={actionConfig.type || '-'} />
          {actionConfig.workflowId && <ConfigRow label={isZh ? '工作流' : 'Workflow'} value={actionConfig.workflowId} mono />}
          {actionConfig.agentId && <ConfigRow label={isZh ? 'Agent' : 'Agent'} value={actionConfig.agentId} mono />}
          {actionConfig.channel && <ConfigRow label={isZh ? '渠道' : 'Channel'} value={actionConfig.channel} />}
          {actionConfig.url && <ConfigRow label="URL" value={actionConfig.url} mono />}
          {actionConfig.prompt && <ConfigRow label={isZh ? '提示词' : 'Prompt'} value={actionConfig.prompt} />}
          {actionConfig.template && <ConfigRow label={isZh ? '模板' : 'Template'} value={actionConfig.template.slice(0, 100) + (actionConfig.template.length > 100 ? '...' : '')} />}
        </div>
      </div>

      {/* 执行参数 */}
      <div>
        <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-text-muted uppercase tracking-wider mb-3">
          <Settings2 className="w-3.5 h-3.5" />
          {isZh ? '执行参数' : 'Execution'}
        </h3>
        <div className="p-4 rounded-lg bg-surface/30 border border-border/30 space-y-2">
          <ConfigRow label={isZh ? '优先级' : 'Priority'} value={String(rule.priority)} />
          <ConfigRow label={isZh ? '冷却时间' : 'Cooldown'} value={rule.cooldownSeconds > 0 ? `${rule.cooldownSeconds}s` : (isZh ? '无' : 'None')} />
          <ConfigRow label={isZh ? '最大执行次数' : 'Max Executions'} value={rule.maxExecutions > 0 ? String(rule.maxExecutions) : (isZh ? '无限' : 'Unlimited')} />
          <ConfigRow label={isZh ? '已执行' : 'Executed'} value={String(rule.executionCount)} />
          {rule.lastExecutedAt && (
            <ConfigRow label={isZh ? '上次执行' : 'Last Run'} value={new Date(rule.lastExecutedAt).toLocaleString(isZh ? 'zh-CN' : 'en-US')} />
          )}
        </div>
      </div>
    </div>
  )
}

function ConfigRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-[12px] text-text-muted w-24 flex-shrink-0">{label}</span>
      <span className={`text-[13px] text-text-primary flex-1 break-all ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  )
}

// ─── 模板库 ─────────────────────────────────────────────

function TemplateGallery({
  templates, isZh, onSelect, onClose,
}: {
  templates: AutomationTemplate[]
  isZh: boolean
  onSelect: (templateId: string) => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-text-inverted/50" onClick={onClose} />
      <div className="relative w-full max-w-3xl max-h-[80vh] bg-surface rounded-xl border border-border/40 shadow-2xl flex flex-col overflow-hidden">
        <div className="flex-shrink-0 h-14 px-5 flex items-center justify-between border-b border-border/30">
          <h3 className="text-[15px] font-semibold text-text-primary">
            {isZh ? '自动化模板库' : 'Automation Templates'}
          </h3>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary text-[14px]">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {templates.length === 0 ? (
            <div className="text-center py-8 text-text-muted text-[13px]">
              {isZh ? '暂无可用模板' : 'No templates available'}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {templates.map(tpl => (
                <button
                  key={tpl.id}
                  onClick={() => onSelect(tpl.id)}
                  className="text-left p-4 rounded-lg border border-border/30 bg-surface/40 hover:border-accent/40 hover:bg-accent/5 transition-all"
                >
                  <div className="text-[14px] font-medium text-text-primary mb-1">
                    {isZh ? tpl.nameZh : tpl.nameEn}
                  </div>
                  <p className="text-[12px] text-text-muted line-clamp-2">
                    {isZh ? tpl.descriptionZh : tpl.descriptionEn}
                  </p>
                  <div className="flex items-center gap-2 mt-2 text-[11px] text-text-muted">
                    <span className="text-amber-500">⚡ {(tpl.triggerConfig as { type?: string })?.type}</span>
                    <span>→</span>
                    <span className="text-blue-500">▸ {(tpl.actionConfig as { type?: string })?.type}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
