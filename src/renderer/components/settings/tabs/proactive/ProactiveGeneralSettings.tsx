/**
 * 主动助手 - 通用设置子面板（s10-07）
 *
 * 职责：
 * 1. 全局开关（enabled）
 * 2. 行动等级选择（off/notify/suggest/act）
 * 3. 引擎运行状态显示
 * 4. 频率限制状态显示（当前小时已派发次数 / 上限）
 *
 * 纯展示 + 回调组件，不直接调用 IPC。
 *
 * @module settings/tabs/proactive/ProactiveGeneralSettings
 */

import { memo } from 'react'
import { Power, Bell, AlertTriangle, Zap, type LucideIcon } from 'lucide-react'
import { ToggleSwitch } from '@components/ui'
import { type Language, t } from '@renderer/i18n'
import type { ProactivePermissionConfig, ProactiveLevel } from './ProactiveSettingsPanel'

interface Props {
  config: ProactivePermissionConfig
  engineRunning: boolean
  frequency: { count: number; maxPerHour: number } | null
  language: Language
  onUpdate: (patch: Partial<ProactivePermissionConfig>) => void
}

/** 等级选项定义 */
const LEVEL_OPTIONS: Array<{
  value: ProactiveLevel
  icon: LucideIcon
  labelKey: string
  descKey: string
  color: string
}> = [
  {
    value: 'off',
    icon: Power,
    labelKey: 'settings.proactive.level.off',
    descKey: 'settings.proactive.level.off.desc',
    color: 'border-text-muted/30 bg-surface/30',
  },
  {
    value: 'notify',
    icon: Bell,
    labelKey: 'settings.proactive.level.notify',
    descKey: 'settings.proactive.level.notify.desc',
    color: 'border-blue-500/40 bg-blue-500/5',
  },
  {
    value: 'suggest',
    icon: AlertTriangle,
    labelKey: 'settings.proactive.level.suggest',
    descKey: 'settings.proactive.level.suggest.desc',
    color: 'border-amber-500/40 bg-amber-500/5',
  },
  {
    value: 'act',
    icon: Zap,
    labelKey: 'settings.proactive.level.act',
    descKey: 'settings.proactive.level.act.desc',
    color: 'border-red-500/40 bg-red-500/5',
  },
]

export const ProactiveGeneralSettings = memo(function ProactiveGeneralSettings({
  config,
  engineRunning,
  frequency,
  language,
  onUpdate,
}: Props) {
  return (
    <div className="space-y-6">
      {/* 全局开关 */}
      <section className="p-4 rounded-xl border border-border/50 bg-surface/40">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-accent/10">
              <Power className="w-4 h-4 text-accent" />
            </div>
            <div>
              <div className="text-sm font-medium text-text-primary">
                {t('settings.proactive.globalToggle', language)}
              </div>
              <div className="text-[12px] text-text-muted mt-0.5">
                {t('settings.proactive.globalToggle.desc', language)}
              </div>
            </div>
          </div>
          <ToggleSwitch
            checked={config.enabled}
            onChange={(e) => onUpdate({ enabled: e.target.checked })}
            switchSize="md"
          />
        </div>
      </section>

      {/* 行动等级选择 */}
      <section>
        <h3 className="text-sm font-medium text-text-primary mb-3">
          {t('settings.proactive.level.title', language)}
        </h3>
        <div className="grid grid-cols-2 gap-3">
          {LEVEL_OPTIONS.map((option) => {
            const Icon = option.icon
            const isSelected = config.level === option.value
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onUpdate({ level: option.value })}
                disabled={!config.enabled && option.value !== 'off'}
                className={`p-3 rounded-xl border text-left transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                  isSelected
                    ? `${option.color} ring-2 ring-accent/40`
                    : 'border-border/40 bg-surface/20 hover:border-border/80'
                }`}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <Icon
                    className={`w-4 h-4 ${isSelected ? 'text-accent' : 'text-text-muted'}`}
                  />
                  <span
                    className={`text-sm font-medium ${
                      isSelected ? 'text-text-primary' : 'text-text-secondary'
                    }`}
                  >
                    {t(option.labelKey, language)}
                  </span>
                </div>
                <p className="text-[12px] text-text-muted leading-relaxed">
                  {t(option.descKey, language)}
                </p>
              </button>
            )
          })}
        </div>
      </section>

      {/* 运行状态 */}
      <section className="p-4 rounded-xl border border-border/50 bg-surface/40">
        <h3 className="text-sm font-medium text-text-primary mb-3">
          {t('settings.proactive.status.title', language)}
        </h3>
        <div className="space-y-2">
          <StatusRow
            label={t('settings.proactive.status.engine', language)}
            value={
              engineRunning
                ? t('settings.proactive.status.running', language)
                : t('settings.proactive.status.stopped', language)
            }
            color={engineRunning ? 'text-green-400' : 'text-text-muted'}
          />
          {frequency && (
            <StatusRow
              label={t('settings.proactive.status.frequency', language)}
              value={`${frequency.count} / ${frequency.maxPerHour}`}
              color={frequency.count >= frequency.maxPerHour ? 'text-red-400' : 'text-text-primary'}
            />
          )}
          <StatusRow
            label={t('settings.proactive.status.llmRefiner', language)}
            value={t('settings.proactive.status.llmRefiner.desc', language)}
            color="text-text-muted"
          />
        </div>
      </section>
    </div>
  )
})

// ============================================================
// 子组件：状态行
// ============================================================

function StatusRow({
  label,
  value,
  color,
}: {
  label: string
  value: string
  color: string
}) {
  return (
    <div className="flex items-center justify-between text-[13px]">
      <span className="text-text-muted">{label}</span>
      <span className={`font-medium ${color}`}>{value}</span>
    </div>
  )
}
