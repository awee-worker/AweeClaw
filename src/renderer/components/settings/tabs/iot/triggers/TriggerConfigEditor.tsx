/**
 * 触发配置可视化编辑器（阶段8 s8-03）
 *
 * 根据 triggerType 渲染对应的表单：
 * - sensor_anomaly: 传感器异常（entityType/anomalyType/severity/providerId 过滤）
 * - state_changed: 状态变化（entityId/entityType/fromState/toState 过滤）
 * - reading_threshold: 读数阈值（entityId/operator/value/unit）
 * - provider_event: Provider 事件（providerId/eventType）
 *
 * 所有字段除 reading_threshold 的 operator/value 外均为可选（留空表示匹配所有）。
 * 编辑器内部维护 config 对象，通过 onChange 回调上传给父组件。
 *
 * @module settings/tabs/iot/triggers/TriggerConfigEditor
 */

import { type Language, createTranslator } from '@renderer/i18n'
import type { TriggerType } from '../AutomationRuleEditDialog'

interface TriggerConfigEditorProps {
  language: Language
  triggerType: TriggerType
  config: Record<string, unknown>
  onChange: (config: Record<string, unknown>) => void
}

/** 通用输入框样式 */
const inputClass =
  'w-full px-3 py-2 rounded-lg bg-surface/40 border border-border/40 text-sm text-text-primary focus:outline-none focus:border-accent/50'
const labelClass = 'block text-[12px] font-medium text-text-secondary mb-1.5'

/**
 * TriggerConfigEditor
 *
 * 切换 triggerType 时父组件会清空 config，本组件直接渲染当前 triggerType 对应表单。
 */
export function TriggerConfigEditor({
  language,
  triggerType,
  config,
  onChange,
}: TriggerConfigEditorProps) {
  const t = createTranslator(language)

  /** 更新单个字段 */
  const updateField = (key: string, value: unknown): void => {
    const next: Record<string, unknown> = { ...config }
    if (value === '' || value === null || value === undefined) {
      delete next[key]
    } else {
      next[key] = value
    }
    onChange(next)
  }

  /** 读取字符串字段 */
  const getField = (key: string): string => {
    const v = config[key]
    return typeof v === 'string' ? v : ''
  }

  /** 读取数字字段 */
  const getNumberField = (key: string): string => {
    const v = config[key]
    return typeof v === 'number' ? String(v) : ''
  }

  // ============================================================
  // 各触发类型表单
  // ============================================================

  if (triggerType === 'sensor_anomaly') {
    return (
      <div className="space-y-3 p-4 rounded-xl bg-surface/20 border border-border/30">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>
              {t('iot.rule.triggerConfig.entityType')}
            </label>
            <input
              type="text"
              value={getField('entityType')}
              onChange={(e) => updateField('entityType', e.target.value)}
              placeholder="sensor"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>
              {t('iot.rule.triggerConfig.anomalyType')}
            </label>
            <select
              value={getField('anomalyType')}
              onChange={(e) => updateField('anomalyType', e.target.value)}
              className={inputClass}
            >
              <option value="">{t('iot.rule.triggerConfig.optionalHint')}</option>
              <option value="zscore_outlier">
                {t('iot.anomalyType.zscore_outlier')}
              </option>
              <option value="rate_of_change">
                {t('iot.anomalyType.rate_of_change')}
              </option>
              <option value="stuck_value">
                {t('iot.anomalyType.stuck_value')}
              </option>
              <option value="out_of_range">
                {t('iot.anomalyType.out_of_range')}
              </option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>
              {t('iot.rule.triggerConfig.severity')}
            </label>
            <select
              value={getField('severity')}
              onChange={(e) => updateField('severity', e.target.value)}
              className={inputClass}
            >
              <option value="">{t('iot.rule.triggerConfig.optionalHint')}</option>
              <option value="info">{t('iot.fusion.severityInfo')}</option>
              <option value="warning">{t('iot.fusion.severityWarning')}</option>
              <option value="critical">{t('iot.fusion.severityCritical')}</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>
              {t('iot.rule.triggerConfig.providerId')}
            </label>
            <input
              type="text"
              value={getField('providerId')}
              onChange={(e) => updateField('providerId', e.target.value)}
              placeholder={t('iot.rule.triggerConfig.optionalHint')}
              className={inputClass}
            />
          </div>
        </div>
      </div>
    )
  }

  if (triggerType === 'state_changed') {
    return (
      <div className="space-y-3 p-4 rounded-xl bg-surface/20 border border-border/30">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>
              {t('iot.rule.triggerConfig.entityId')}
            </label>
            <input
              type="text"
              value={getField('entityId')}
              onChange={(e) => updateField('entityId', e.target.value)}
              placeholder={t('iot.rule.triggerConfig.optionalHint')}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>
              {t('iot.rule.triggerConfig.entityType')}
            </label>
            <input
              type="text"
              value={getField('entityType')}
              onChange={(e) => updateField('entityType', e.target.value)}
              placeholder="sensor"
              className={inputClass}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>
              {t('iot.rule.triggerConfig.fromState')}
            </label>
            <input
              type="text"
              value={getField('fromState')}
              onChange={(e) => updateField('fromState', e.target.value)}
              placeholder={t('iot.rule.triggerConfig.optionalHint')}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>
              {t('iot.rule.triggerConfig.toState')}
            </label>
            <input
              type="text"
              value={getField('toState')}
              onChange={(e) => updateField('toState', e.target.value)}
              placeholder={t('iot.rule.triggerConfig.optionalHint')}
              className={inputClass}
            />
          </div>
        </div>
      </div>
    )
  }

  if (triggerType === 'reading_threshold') {
    return (
      <div className="space-y-3 p-4 rounded-xl bg-surface/20 border border-border/30">
        <div>
          <label className={labelClass}>
            {t('iot.rule.triggerConfig.entityId')}
          </label>
          <input
            type="text"
            value={getField('entityId')}
            onChange={(e) => updateField('entityId', e.target.value)}
            placeholder={t('iot.rule.triggerConfig.optionalHint')}
            className={inputClass}
          />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={labelClass}>
              {t('iot.rule.triggerConfig.operator')}
            </label>
            <select
              value={getField('operator')}
              onChange={(e) => updateField('operator', e.target.value)}
              className={inputClass}
            >
              <option value="gt">{t('iot.rule.triggerConfig.operatorGt')}</option>
              <option value="lt">{t('iot.rule.triggerConfig.operatorLt')}</option>
              <option value="eq">{t('iot.rule.triggerConfig.operatorEq')}</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>
              {t('iot.rule.triggerConfig.value')} <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              value={getNumberField('value')}
              onChange={(e) =>
                updateField(
                  'value',
                  e.target.value === '' ? '' : Number(e.target.value),
                )
              }
              placeholder="0"
              step="any"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>
              {t('iot.rule.triggerConfig.unit')}
            </label>
            <input
              type="text"
              value={getField('unit')}
              onChange={(e) => updateField('unit', e.target.value)}
              placeholder="°C"
              className={inputClass}
            />
          </div>
        </div>
      </div>
    )
  }

  if (triggerType === 'provider_event') {
    return (
      <div className="space-y-3 p-4 rounded-xl bg-surface/20 border border-border/30">
        <div>
          <label className={labelClass}>
            {t('iot.rule.triggerConfig.providerId')}
          </label>
          <input
            type="text"
            value={getField('providerId')}
            onChange={(e) => updateField('providerId', e.target.value)}
            placeholder={t('iot.rule.triggerConfig.optionalHint')}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>
            {t('iot.rule.triggerConfig.eventType')} <span className="text-red-500">*</span>
          </label>
          <select
            value={getField('eventType')}
            onChange={(e) => updateField('eventType', e.target.value)}
            className={inputClass}
          >
            <option value="connected">
              {t('iot.rule.triggerConfig.eventConnected')}
            </option>
            <option value="disconnected">
              {t('iot.rule.triggerConfig.eventDisconnected')}
            </option>
            <option value="error">
              {t('iot.rule.triggerConfig.eventError')}
            </option>
            <option value="created">
              {t('iot.rule.triggerConfig.eventCreated')}
            </option>
            <option value="updated">
              {t('iot.rule.triggerConfig.eventUpdated')}
            </option>
            <option value="deleted">
              {t('iot.rule.triggerConfig.eventDeleted')}
            </option>
          </select>
        </div>
      </div>
    )
  }

  // 兜底（理论上不会进入）
  return (
    <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-500 text-[12px]">
      Unknown trigger type: {triggerType}
    </div>
  )
}
