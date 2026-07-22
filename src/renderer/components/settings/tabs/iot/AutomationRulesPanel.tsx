/**
 * IoT 自动化联动规则列表面板（阶段8 s8-02）
 *
 * 功能：
 * - 展示当前用户的联动规则列表（来自后端 /api/v1/iot/automation-rules）
 * - 新建/编辑/删除规则（含触发类型、动作类型、配置 JSON）
 * - 一键启用/禁用规则（PATCH enabled 字段）
 * - 显示触发次数、最近触发时间、最后错误信息
 *
 * 数据流：
 * - 全部 CRUD 走后端 REST API（持久化）
 * - 规则匹配由后端 IoTAutomationRuleEngineService 事件驱动，前端不参与实时匹配
 *
 * @module settings/tabs/iot/AutomationRulesPanel
 */

import { useState, useEffect, useCallback } from 'react'
import {
  Plus,
  Pencil,
  Trash2,
  Zap,
  AlertCircle,
  Loader2,
  Power,
} from 'lucide-react'
import { type Language, createTranslator } from '@renderer/i18n'
import { logger } from '@shared/toolkit/LogEngine'
import { backendApi } from '@renderer/adapters/backendApi'
import { AutomationRuleEditDialog } from './AutomationRuleEditDialog'

interface AutomationRulesPanelProps {
  language: Language
  refreshKey: number
}

/** 触发类型（与后端 AUTOMATION_TRIGGER_TYPES 对齐） */
type TriggerType = 'sensor_anomaly' | 'state_changed' | 'reading_threshold' | 'provider_event'

/** 动作类型（与后端 AUTOMATION_ACTION_TYPES 对齐） */
type ActionType = 'notification' | 'workflow' | 'causal_intervention' | 'device_control'

/** 后端规则实体 */
export interface AutomationRule {
  id: string
  name: string
  description?: string | null
  enabled: boolean
  triggerType: TriggerType
  triggerConfig: Record<string, unknown>
  actionType: ActionType
  actionConfig: Record<string, unknown>
  triggerCount?: number
  lastTriggeredAt?: string | null
  lastError?: string | null
  createdAt: string
  updatedAt: string
}

/** 列表响应可能为数组或 { items: [] } */
type ListResponse = AutomationRule[] | { items: AutomationRule[] }

/**
 * AutomationRulesPanel
 *
 * 父组件通过 refreshKey 触发刷新（与 Bridge 状态切换联动）。
 */
export function AutomationRulesPanel({
  language,
  refreshKey,
}: AutomationRulesPanelProps) {
  const t = createTranslator(language)

  const [rules, setRules] = useState<AutomationRule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingRule, setEditingRule] = useState<AutomationRule | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  /** 加载规则列表 */
  const loadRules = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await backendApi.get<ListResponse>(
        '/api/v1/iot/automation-rules',
      )
      const list = Array.isArray(result) ? result : result?.items ?? []
      setRules(list)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      logger.settings?.error('Failed to load automation rules:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadRules()
  }, [loadRules, refreshKey])

  /** 删除规则 */
  const handleDelete = useCallback(
    async (id: string) => {
      if (!confirm(t('iot.rule.deleteConfirm'))) return
      try {
        await backendApi.delete(`/api/v1/iot/automation-rules/${id}`)
        await loadRules()
      } catch (e) {
        logger.settings?.error('Failed to delete automation rule:', e)
        setError(e instanceof Error ? e.message : String(e))
      }
    },
    [t, loadRules],
  )

  /** 启用/禁用规则 */
  const handleToggleEnabled = useCallback(
    async (rule: AutomationRule) => {
      setTogglingId(rule.id)
      try {
        await backendApi.put(`/api/v1/iot/automation-rules/${rule.id}`, {
          enabled: !rule.enabled,
        })
        await loadRules()
      } catch (e) {
        alert(t('iot.rule.operationFailed', { error: (e as Error).message }))
      } finally {
        setTogglingId(null)
      }
    },
    [loadRules, t],
  )

  /** 格式化最近触发时间 */
  const formatLastTriggered = (iso: string | null | undefined): string => {
    if (!iso) return t('iot.rule.neverTriggered')
    try {
      const d = new Date(iso)
      return d.toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US')
    } catch {
      return t('iot.rule.neverTriggered')
    }
  }

  /** 渲染单条规则卡片 */
  const renderRuleCard = (rule: AutomationRule) => {
    const triggerLabel = t(`iot.rule.trigger.${rule.triggerType}`)
    const actionLabel = t(`iot.rule.action.${rule.actionType}`)

    return (
      <div
        key={rule.id}
        className={`p-4 rounded-xl bg-surface/30 border transition-all ${
          rule.enabled
            ? 'border-border/40 hover:border-border/60'
            : 'border-border/20 opacity-60'
        }`}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h5 className="text-sm font-semibold text-text-primary truncate">
                {rule.name}
              </h5>
              <span className="px-2 py-0.5 rounded-md text-[12px] bg-blue-500/10 text-blue-500 border border-blue-500/20">
                {triggerLabel}
              </span>
              <span className="px-2 py-0.5 rounded-md text-[12px] bg-purple-500/10 text-purple-500 border border-purple-500/20">
                {actionLabel}
              </span>
              {!rule.enabled && (
                <span className="px-2 py-0.5 rounded-md text-[12px] bg-amber-500/10 text-amber-500 border border-amber-500/20">
                  {t('iot.common.disabled')}
                </span>
              )}
            </div>

            {rule.description && (
              <p className="text-[12px] text-text-muted mt-1.5 line-clamp-2">
                {rule.description}
              </p>
            )}

            <div className="flex items-center gap-3 mt-2 text-[12px] text-text-muted flex-wrap">
              <span title={t('iot.rule.lastTriggeredAt')}>
                {formatLastTriggered(rule.lastTriggeredAt)}
              </span>
              {typeof rule.triggerCount === 'number' && rule.triggerCount > 0 && (
                <>
                  <span>·</span>
                  <span>
                    {t('iot.rule.triggerCount')}: {rule.triggerCount}
                  </span>
                </>
              )}
              {rule.lastError && (
                <>
                  <span>·</span>
                  <span
                    className="text-red-500 truncate max-w-[240px]"
                    title={rule.lastError}
                  >
                    <AlertCircle className="w-3 h-3 inline mr-1" />
                    {rule.lastError}
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => handleToggleEnabled(rule)}
              disabled={togglingId === rule.id}
              className={`p-1.5 rounded-lg transition-all ${
                rule.enabled
                  ? 'text-emerald-500 hover:bg-emerald-500/10'
                  : 'text-text-muted hover:text-emerald-500 hover:bg-emerald-500/10'
              }`}
              title={t('iot.rule.toggleEnabled')}
            >
              {togglingId === rule.id ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Power className="w-4 h-4" />
              )}
            </button>
            <button
              onClick={() => setEditingRule(rule)}
              className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-hover transition-all"
              title={t('iot.common.edit')}
            >
              <Pencil className="w-4 h-4" />
            </button>
            <button
              onClick={() => handleDelete(rule.id)}
              className="p-1.5 rounded-lg text-text-muted hover:text-red-500 hover:bg-red-500/10 transition-all"
              title={t('iot.common.delete')}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    )
  }

  const enabledCount = rules.filter((r) => r.enabled).length

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-bold text-text-primary flex items-center gap-1.5">
            <Zap className="w-4 h-4 text-purple-500" />
            {t('iot.rule.listTitle')}
          </h4>
          <p className="text-[12px] text-text-muted mt-1">
            {t('iot.rule.listSubtitle', {
              count: rules.length,
              enabled: enabledCount,
            })}
          </p>
        </div>
        <button
          onClick={() => setShowCreateForm(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-accent/15 text-accent border border-accent/30 hover:bg-accent/25 transition-all"
        >
          <Plus className="w-3.5 h-3.5" />
          {t('iot.rule.new')}
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-500 text-[12px]">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-12 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-text-muted" />
        </div>
      ) : rules.length === 0 ? (
        <div className="py-12 text-center text-text-muted text-sm">
          {t('iot.rule.empty')}
        </div>
      ) : (
        <div className="space-y-2">{rules.map(renderRuleCard)}</div>
      )}

      {/* 新建/编辑对话框 */}
      {(showCreateForm || editingRule) && (
        <AutomationRuleEditDialog
          language={language}
          rule={editingRule}
          onClose={() => {
            setShowCreateForm(false)
            setEditingRule(null)
          }}
          onSaved={() => {
            setShowCreateForm(false)
            setEditingRule(null)
            void loadRules()
          }}
        />
      )}
    </div>
  )
}
