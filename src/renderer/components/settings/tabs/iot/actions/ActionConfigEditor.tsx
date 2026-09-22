/**
 * 动作配置可视化编辑器（阶段8 s8-04）
 *
 * 根据 actionType 渲染对应的表单：
 * - notification: 通知（channel/target/message）
 * - workflow: 工作流（workflowId/inputs JSON）
 * - causal_intervention: 因果干预（interventionVar/observedVar/sceneKey）
 * - device_control: 设备控制（entityId/command/value）
 *
 * 编辑器内部维护 config 对象，通过 onChange 回调上传给父组件。
 *
 * @module settings/tabs/iot/actions/ActionConfigEditor
 */

import { type Language, createTranslator } from '@renderer/i18n'
import type { ActionType, TriggerType } from '../AutomationRuleEditDialog'

interface ActionConfigEditorProps {
  language: Language
  actionType: ActionType
  /** 触发类型，用于展示该规则实际可用的消息变量 */
  triggerType: TriggerType
  config: Record<string, unknown>
  onChange: (config: Record<string, unknown>) => void
}

/**
 * 消息模板可用变量（触发类型相关）
 *
 * 与后端规则引擎注入的上下文保持一致：引擎按触发类型注入不同字段，
 * 未注入的变量在消息中原样保留，因此这里的清单必须与实际注入字段同步。
 */
const MESSAGE_VARIABLES: Record<TriggerType, string[]> = {
  reading_threshold: ['entityId', 'value', 'unit'],
  state_changed: ['entityId', 'fromState', 'toState'],
  sensor_anomaly: ['entityId', 'anomalyType', 'severity', 'description'],
  provider_event: ['providerId', 'providerName', 'providerEventType'],
}

/** 通用输入框样式 */
const inputClass =
  'w-full px-3 py-2 rounded-lg bg-surface/40 border border-border/40 text-sm text-text-primary focus:outline-none focus:border-accent/50'
const textareaClass =
  'w-full px-3 py-2 rounded-lg bg-surface/40 border border-border/40 text-sm text-text-primary font-mono focus:outline-none focus:border-accent/50'
const labelClass = 'block text-[12px] font-medium text-text-secondary mb-1.5'
const hintClass = 'text-[12px] text-text-muted mt-1'

/**
 * ActionConfigEditor
 *
 * 切换 actionType 时父组件会清空 config，本组件直接渲染当前 actionType 对应表单。
 */
export function ActionConfigEditor({
  language,
  actionType,
  triggerType,
  config,
  onChange,
}: ActionConfigEditorProps) {
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

  /** 读取 JSON 对象字段（返回格式化字符串用于 textarea 显示） */
  const getJsonField = (key: string): string => {
    const v = config[key]
    if (!v || typeof v !== 'object') return ''
    try {
      return JSON.stringify(v, null, 2)
    } catch {
      return ''
    }
  }

  /** 设置 JSON 字段（解析失败则不更新） */
  const setJsonField = (key: string, jsonStr: string): void => {
    if (!jsonStr.trim()) {
      updateField(key, '')
      return
    }
    try {
      const parsed = JSON.parse(jsonStr)
      updateField(key, parsed)
    } catch {
      // 解析失败时不更新，避免破坏已有数据；最终提交时由后端校验
    }
  }

  // ============================================================
  // 各动作类型表单
  // ============================================================

  if (actionType === 'notification') {
    const channel = getField('channel') || 'toast'
    return (
      <div className="space-y-3 p-4 rounded-xl bg-surface/20 border border-border/30">
        <div>
          <label className={labelClass}>
            {t('iot.rule.actionConfig.channel')} <span className="text-red-500">*</span>
          </label>
          <select
            value={channel}
            onChange={(e) => updateField('channel', e.target.value)}
            className={inputClass}
          >
            <option value="toast">{t('iot.rule.actionConfig.channelToast')}</option>
            <option value="email">{t('iot.rule.actionConfig.channelEmail')}</option>
            <option value="webhook">
              {t('iot.rule.actionConfig.channelWebhook')}
            </option>
          </select>
        </div>
        {channel !== 'toast' && (
          <div>
            <label className={labelClass}>
              {t('iot.rule.actionConfig.target')} <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={getField('target')}
              onChange={(e) => updateField('target', e.target.value)}
              placeholder={
                channel === 'email'
                  ? 'user@example.com'
                  : 'https://hooks.example.com/xxx'
              }
              className={inputClass}
            />
            <p className={hintClass}>{t('iot.rule.actionConfig.targetHint')}</p>
          </div>
        )}
        <div>
          <label className={labelClass}>
            {t('iot.rule.actionConfig.message')} <span className="text-red-500">*</span>
          </label>
          <textarea
            value={getField('message')}
            onChange={(e) => updateField('message', e.target.value)}
            rows={3}
            placeholder={t('iot.rule.actionConfig.messagePlaceholder')}
            className={textareaClass}
          />
          <MessageVariables language={language} triggerType={triggerType} />
        </div>
      </div>
    )
  }

  if (actionType === 'workflow') {
    return (
      <div className="space-y-3 p-4 rounded-xl bg-surface/20 border border-border/30">
        <div>
          <label className={labelClass}>
            {t('iot.rule.actionConfig.workflowId')} <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={getField('workflowId')}
            onChange={(e) => updateField('workflowId', e.target.value)}
            placeholder="workflow-uuid"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>
            {t('iot.rule.actionConfig.inputs')}
          </label>
          <textarea
            value={getJsonField('inputs')}
            onChange={(e) => setJsonField('inputs', e.target.value)}
            rows={5}
            placeholder={'{\n  "entityId": "sensor.temp_1",\n  "value": 42.5\n}'}
            className={textareaClass}
          />
          <p className={hintClass}>{t('iot.rule.triggerConfig.optionalHint')}</p>
        </div>
      </div>
    )
  }

  if (actionType === 'causal_intervention') {
    return (
      <div className="space-y-3 p-4 rounded-xl bg-surface/20 border border-border/30">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>
              {t('iot.rule.actionConfig.interventionVar')} <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={getField('interventionVar')}
              onChange={(e) => updateField('interventionVar', e.target.value)}
              placeholder="heater_on"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>
              {t('iot.rule.actionConfig.observedVar')} <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={getField('observedVar')}
              onChange={(e) => updateField('observedVar', e.target.value)}
              placeholder="room_temp"
              className={inputClass}
            />
          </div>
        </div>
        <div>
          <label className={labelClass}>
            {t('iot.rule.actionConfig.sceneKey')}
          </label>
          <input
            type="text"
            value={getField('sceneKey')}
            onChange={(e) => updateField('sceneKey', e.target.value)}
            placeholder={t('iot.rule.triggerConfig.optionalHint')}
            className={inputClass}
          />
        </div>
      </div>
    )
  }

  if (actionType === 'device_control') {
    const command = getField('command') || 'turn_on'
    return (
      <div className="space-y-3 p-4 rounded-xl bg-surface/20 border border-border/30">
        <div>
          <label className={labelClass}>
            {t('iot.rule.actionConfig.controlEntityId')} <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={getField('entityId')}
            onChange={(e) => updateField('entityId', e.target.value)}
            placeholder="switch.heater"
            className={inputClass}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>
              {t('iot.rule.actionConfig.command')} <span className="text-red-500">*</span>
            </label>
            <select
              value={command}
              onChange={(e) => updateField('command', e.target.value)}
              className={inputClass}
            >
              <option value="turn_on">
                {t('iot.rule.actionConfig.commandTurnOn')}
              </option>
              <option value="turn_off">
                {t('iot.rule.actionConfig.commandTurnOff')}
              </option>
              <option value="set_value">
                {t('iot.rule.actionConfig.commandSetValue')}
              </option>
            </select>
          </div>
          {command === 'set_value' && (
            <div>
              <label className={labelClass}>
                {t('iot.rule.actionConfig.controlValue')} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={getField('value') ?? ''}
                onChange={(e) => updateField('value', e.target.value)}
                placeholder="25.5"
                className={inputClass}
              />
            </div>
          )}
        </div>
      </div>
    )
  }

  // 兜底（理论上不会进入）
  return (
    <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-500 text-[12px]">
      Unknown action type: {actionType}
    </div>
  )
}

/**
 * 消息变量说明
 *
 * 列出当前触发类型下消息内容可引用的变量及含义，变量在规则触发时由后端引擎替换。
 */
function MessageVariables({
  language,
  triggerType,
}: {
  language: Language
  triggerType: TriggerType
}) {
  const t = createTranslator(language)

  return (
    <div className="mt-2 rounded-lg border border-border/30 bg-surface/20 p-3">
      <p className="text-[12px] font-medium text-text-secondary mb-2">
        {t('iot.rule.actionConfig.varsTitle')}
      </p>
      <div className="space-y-1">
        {MESSAGE_VARIABLES[triggerType].map((name) => (
          <div key={name} className="flex items-baseline gap-2 text-[12px]">
            <code className="shrink-0 px-1 rounded bg-surface/60 font-mono text-accent">
              {`{${name}}`}
            </code>
            <span className="text-text-muted">
              {t(`iot.rule.actionConfig.var.${name}`)}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[12px] text-text-muted">
        {t('iot.rule.actionConfig.varsCommonHint')}
      </p>
    </div>
  )
}
