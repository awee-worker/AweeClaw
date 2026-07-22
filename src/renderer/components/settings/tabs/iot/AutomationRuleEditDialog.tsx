/**
 * IoT 自动化联动规则编辑对话框（阶段8 s8-02）
 *
 * 功能：
 * - 创建新规则或编辑已有规则
 * - 触发类型选择 + 触发配置可视化编辑（由 TriggerConfigEditor 提供）
 * - 动作类型选择 + 动作配置可视化编辑（由 ActionConfigEditor 提供）
 * - 启用状态切换
 *
 * 数据流：
 * - 提交时通过 backendApi POST/PUT 到 /api/v1/iot/automation-rules
 *
 * @module settings/tabs/iot/AutomationRuleEditDialog
 */

import { useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { X, Check, Loader2 } from 'lucide-react'
import { type Language, createTranslator } from '@renderer/i18n'
import { logger } from '@shared/toolkit/LogEngine'
import { backendApi } from '@renderer/adapters/backendApi'
import { TriggerConfigEditor } from './triggers/TriggerConfigEditor'
import { ActionConfigEditor } from './actions/ActionConfigEditor'
import type { AutomationRule } from './AutomationRulesPanel'

/** 触发类型 */
export type TriggerType = 'sensor_anomaly' | 'state_changed' | 'reading_threshold' | 'provider_event'

/** 动作类型 */
export type ActionType = 'notification' | 'workflow' | 'causal_intervention' | 'device_control'

/** 触发类型列表 */
const TRIGGER_TYPES: TriggerType[] = [
  'sensor_anomaly',
  'state_changed',
  'reading_threshold',
  'provider_event',
]

/** 动作类型列表 */
const ACTION_TYPES: ActionType[] = [
  'notification',
  'workflow',
  'causal_intervention',
  'device_control',
]

interface AutomationRuleEditDialogProps {
  language: Language
  rule: AutomationRule | null
  onClose: () => void
  onSaved: () => void
}

/**
 * AutomationRuleEditDialog
 *
 * 编辑现有规则时传入 rule；新建规则时 rule 为 null。
 */
export function AutomationRuleEditDialog({
  language,
  rule,
  onClose,
  onSaved,
}: AutomationRuleEditDialogProps) {
  const t = createTranslator(language)
  const isEdit = !!rule

  const [name, setName] = useState(rule?.name ?? '')
  const [description, setDescription] = useState(rule?.description ?? '')
  const [enabled, setEnabled] = useState(rule?.enabled ?? true)
  const [triggerType, setTriggerType] = useState<TriggerType>(
    rule?.triggerType ?? 'reading_threshold',
  )
  const [triggerConfig, setTriggerConfig] = useState<Record<string, unknown>>(
    rule?.triggerConfig ?? {},
  )
  const [actionType, setActionType] = useState<ActionType>(
    rule?.actionType ?? 'notification',
  )
  const [actionConfig, setActionConfig] = useState<Record<string, unknown>>(
    rule?.actionConfig ?? {},
  )
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  /** 提交保存 */
  const handleSubmit = useCallback(async () => {
    setFormError(null)

    if (!name.trim()) {
      setFormError(t('iot.rule.nameRequired'))
      return
    }

    setSaving(true)
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        enabled,
        triggerType,
        triggerConfig,
        actionType,
        actionConfig,
      }
      if (isEdit && rule) {
        await backendApi.put(
          `/api/v1/iot/automation-rules/${rule.id}`,
          payload,
        )
      } else {
        await backendApi.post('/api/v1/iot/automation-rules', payload)
      }
      onSaved()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setFormError(msg)
      logger.settings?.error('Failed to save automation rule:', e)
    } finally {
      setSaving(false)
    }
  }, [
    name,
    description,
    enabled,
    triggerType,
    triggerConfig,
    actionType,
    actionConfig,
    isEdit,
    rule,
    t,
    onSaved,
  ])

  /** 切换触发类型时重置配置 */
  const handleTriggerTypeChange = useCallback(
    (newType: TriggerType) => {
      if (newType === triggerType) return
      setTriggerType(newType)
      setTriggerConfig({})
    },
    [triggerType],
  )

  /** 切换动作类型时重置配置 */
  const handleActionTypeChange = useCallback(
    (newType: ActionType) => {
      if (newType === actionType) return
      setActionType(newType)
      setActionConfig({})
    },
    [actionType],
  )

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-surface border border-border rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h3 className="text-base font-semibold text-text-primary">
            {isEdit ? t('iot.rule.editTitle') : t('iot.rule.newTitle')}
          </h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-text-muted hover:text-red-500 hover:bg-red-500/10 transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 表单内容 */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* 基础信息 */}
          <div className="space-y-3">
            <div>
              <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
                {t('iot.rule.nameLabel')} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('iot.rule.namePlaceholder')}
                className="w-full px-3 py-2 rounded-lg bg-surface/40 border border-border/40 text-sm text-text-primary focus:outline-none focus:border-accent/50"
              />
            </div>

            <div>
              <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
                {t('iot.rule.descriptionLabel')}
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('iot.rule.descriptionPlaceholder')}
                className="w-full px-3 py-2 rounded-lg bg-surface/40 border border-border/40 text-sm text-text-primary focus:outline-none focus:border-accent/50"
              />
            </div>

            <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="rounded"
              />
              {t('iot.rule.enabledLabel')}
            </label>
          </div>

          {/* 分隔线 */}
          <div className="border-t border-border/40" />

          {/* 触发配置 */}
          <div className="space-y-3">
            <div>
              <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
                {t('iot.rule.triggerTypeLabel')}
              </label>
              <select
                value={triggerType}
                onChange={(e) =>
                  handleTriggerTypeChange(e.target.value as TriggerType)
                }
                className="w-full px-3 py-2 rounded-lg bg-surface/40 border border-border/40 text-sm text-text-primary focus:outline-none focus:border-accent/50"
              >
                {TRIGGER_TYPES.map((tt) => (
                  <option key={tt} value={tt}>
                    {t(`iot.rule.trigger.${tt}`)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
                {t('iot.rule.triggerConfigLabel')}
              </label>
              <TriggerConfigEditor
                language={language}
                triggerType={triggerType}
                config={triggerConfig}
                onChange={setTriggerConfig}
              />
            </div>
          </div>

          {/* 分隔线 */}
          <div className="border-t border-border/40" />

          {/* 动作配置 */}
          <div className="space-y-3">
            <div>
              <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
                {t('iot.rule.actionTypeLabel')}
              </label>
              <select
                value={actionType}
                onChange={(e) =>
                  handleActionTypeChange(e.target.value as ActionType)
                }
                className="w-full px-3 py-2 rounded-lg bg-surface/40 border border-border/40 text-sm text-text-primary focus:outline-none focus:border-accent/50"
              >
                {ACTION_TYPES.map((at) => (
                  <option key={at} value={at}>
                    {t(`iot.rule.action.${at}`)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
                {t('iot.rule.actionConfigLabel')}
              </label>
              <ActionConfigEditor
                language={language}
                actionType={actionType}
                config={actionConfig}
                onChange={setActionConfig}
              />
            </div>
          </div>

          {formError && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-500 text-[12px]">
              {formError}
            </div>
          )}
        </div>

        {/* 底部操作栏 */}
        <div className="flex items-center justify-end gap-2 p-5 border-t border-border bg-surface/40">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-hover transition-all"
          >
            {t('iot.common.cancel')}
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-accent text-white hover:bg-accent-hover transition-all flex items-center gap-1.5"
          >
            {saving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Check className="w-3.5 h-3.5" />
            )}
            {t('iot.common.save')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
