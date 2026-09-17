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
import { useFeatureGuard } from '@hooks/useFeatureGuard'
import { automationApi, getApiErrorMessage } from '@renderer/adapters/taskProjectApi'
import { countAutomationTasks } from '@renderer/adapters/quotaUsage'
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
  // 自动化任务数量受套餐配额约束（automationTasksLimit）
  const { requireQuota } = useFeatureGuard()

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
      // 同步本地 cronScheduler：清理孤儿任务、注册缺失的 schedule 规则、同步启停状态
      void syncLocalCronWithBackend(data)
    } catch (e) {
      setError(getApiErrorMessage(e, isZh ? '加载失败' : 'Failed to load'))
    }
    setLoading(false)
  }, [selectedId, isZh])

  /**
   * 同步本地 cronScheduler 与后端规则列表
   * - 清理本地孤儿任务（后端已删除的）
   * - 注册缺失的 schedule 类型规则
   * - 同步启停状态（其他设备可能改过 enabled）
   */
  const syncLocalCronWithBackend = useCallback(async (backendRules: AutomationRule[]) => {
    const api = (window as Window & {
      electronAPI?: {
        cronGetAllTasks?: () => Promise<{ success: boolean; tasks: Array<{ id: string; ruleId?: string; status: string }> }>
        cronUnregister?: (taskId: string) => Promise<unknown>
        cronRegister?: (config: unknown) => Promise<unknown>
        cronResumeByRuleId?: (id: string) => Promise<unknown>
        cronPauseByRuleId?: (id: string) => Promise<unknown>
      }
    }).electronAPI
    if (!api?.cronGetAllTasks) return

    try {
      const result = await api.cronGetAllTasks()
      const localTasks = result.tasks || []
      const scheduleRules = backendRules.filter(r => r.triggerConfig?.type === 'schedule' && r.triggerConfig.cron)

      // 1. 清理本地孤儿任务（后端已删除或无 ruleId 的旧任务）
      for (const task of localTasks) {
        if (task.ruleId && !backendRules.find(r => r.id === task.ruleId)) {
          await api.cronUnregister?.(task.id)
        }
      }

      // 2. 注册缺失的 schedule 规则 + 3. 同步启停状态
      for (const rule of scheduleRules) {
        const existing = localTasks.find(t => t.ruleId === rule.id)
        if (!existing) {
          await api.cronRegister?.({
            name: rule.name,
            expression: rule.triggerConfig.cron!,
            command: rule.actionConfig?.prompt || '',
            ruleId: rule.id,
            agentId: rule.actionConfig?.agentId,
            active: rule.enabled,
          })
        } else {
          // 同步启停状态
          if (rule.enabled && existing.status === 'paused') {
            await api.cronResumeByRuleId?.(rule.id)
          } else if (!rule.enabled && existing.status === 'active') {
            await api.cronPauseByRuleId?.(rule.id)
          }
        }
      }
    } catch {
      // 同步失败不阻断 UI，下次加载会重试
    }
  }, [])

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

  /** 自动化任务数量校验（自动化规则 + 定时任务合并计数），超限时给出升级引导 */
  const checkAutomationQuota = useCallback(async (): Promise<boolean> => {
    // -1 表示两处数据源都不可达、用量未知 —— 按宽松策略放行
    const used = await countAutomationTasks()
    if (used < 0) return true
    return requireQuota('automationTasksLimit', used)
  }, [requireQuota])

  /** 新建空白规则：先校验配额，再打开表单 */
  const handleCreate = useCallback(async () => {
    if (!(await checkAutomationQuota())) return
    setEditingRule(null)
    setShowFormDialog(true)
  }, [checkAutomationQuota])

  /** 从模板创建：先校验配额，再打开模板面板 */
  const handleOpenTemplates = useCallback(async () => {
    if (!(await checkAutomationQuota())) return
    setShowTemplates(true)
  }, [checkAutomationQuota])

  const handleToggleEnabled = useCallback(async (rule: AutomationRule) => {
    // 乐观更新
    setRules(prev => prev.map(r =>
      r.id === rule.id ? { ...r, enabled: !r.enabled } : r,
    ))
    try {
      await automationApi.update(rule.id, { enabled: !rule.enabled })
      // 同步本地 cronScheduler 的启停状态（仅 schedule 类型规则）
      if (rule.triggerConfig?.type === 'schedule') {
        const api = (window as Window & { electronAPI?: { cronResumeByRuleId?: (id: string) => Promise<unknown>; cronPauseByRuleId?: (id: string) => Promise<unknown> } }).electronAPI
        if (api) {
          if (rule.enabled) {
            // 当前 enabled=true → 即将禁用 → pause
            await api.cronPauseByRuleId?.(rule.id)
          } else {
            // 当前 enabled=false → 即将启用 → resume
            await api.cronResumeByRuleId?.(rule.id)
          }
        }
      }
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
      // 同步删除本地 cronScheduler 中的任务
      const api = (window as Window & { electronAPI?: { cronUnregisterByRuleId?: (id: string) => Promise<unknown> } }).electronAPI
      await api?.cronUnregisterByRuleId?.(id)
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
    // 兜底二次校验：模板面板可能已打开一段时间
    if (!(await checkAutomationQuota())) return
    try {
      const created = await automationApi.createFromTemplate(templateId)
      setRules(prev => [created, ...prev])
      setSelectedId(created.id)
      setShowTemplates(false)
      // 同步注册到本地 cronScheduler（仅 schedule 类型）
      if (created.triggerConfig?.type === 'schedule' && created.triggerConfig.cron) {
        const api = (window as Window & { electronAPI?: { cronRegister?: (config: unknown) => Promise<unknown> } }).electronAPI
        await api?.cronRegister?.({
          name: created.name,
          expression: created.triggerConfig.cron,
          command: created.actionConfig?.prompt || '',
          ruleId: created.id,
          agentId: created.actionConfig?.agentId,
          active: created.enabled,
        })
      }
    } catch (e) {
      setError(getApiErrorMessage(e, isZh ? '创建失败' : 'Create failed'))
    }
  }, [checkAutomationQuota])

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
        // 同步本地 cronScheduler（upsert：存在则更新，不存在则注册）
        if (updated.triggerConfig?.type === 'schedule' && updated.triggerConfig.cron) {
          const api = (window as Window & { electronAPI?: { cronUpsertByRuleId?: (ruleId: string, updates: Record<string, unknown>, active?: boolean) => Promise<unknown>; cronUnregisterByRuleId?: (id: string) => Promise<unknown> } }).electronAPI
          await api?.cronUpsertByRuleId?.(
            updated.id,
            {
              name: updated.name,
              expression: updated.triggerConfig.cron,
              command: updated.actionConfig?.prompt || '',
            },
            updated.enabled,
          )
        } else {
          // 非 schedule 类型规则：移除可能存在的本地 cron 任务
          const api = (window as Window & { electronAPI?: { cronUnregisterByRuleId?: (id: string) => Promise<unknown> } }).electronAPI
          await api?.cronUnregisterByRuleId?.(updated.id)
        }
      } catch (e) {
        setError(getApiErrorMessage(e, isZh ? '更新失败' : 'Update failed'))
      }
    } else {
      // 兜底二次校验：表单可能已打开一段时间，期间自动化任务数可能已达上限
      if (!(await checkAutomationQuota())) {
        setShowFormDialog(false)
        return
      }
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
        // 同步注册到本地 cronScheduler（仅 schedule 类型）
        if (created.triggerConfig?.type === 'schedule' && created.triggerConfig.cron) {
          const api = (window as Window & { electronAPI?: { cronRegister?: (config: unknown) => Promise<unknown> } }).electronAPI
          await api?.cronRegister?.({
            name: created.name,
            expression: created.triggerConfig.cron,
            command: created.actionConfig?.prompt || '',
            ruleId: created.id,
            agentId: created.actionConfig?.agentId,
            active: created.enabled,
          })
        }
      } catch (e) {
        setError(getApiErrorMessage(e, isZh ? '创建失败' : 'Create failed'))
      }
    }
  }, [editingRule, isZh, checkAutomationQuota])

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
              onClick={handleOpenTemplates}
              className="p-1.5 rounded-md hover:bg-surface-hover/50 text-text-muted hover:text-text-primary transition-colors"
              title={isZh ? '从模板创建' : 'From template'}
            >
              <LayoutTemplate className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleCreate}
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
              <button onClick={handleOpenTemplates} className="mt-2 text-[12px] text-accent hover:underline">
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
              <button onClick={handleOpenTemplates} className="mt-3 flex items-center gap-1.5 text-[12px] text-accent hover:underline">
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
