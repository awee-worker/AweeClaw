/**
 * 主动助手 - 勿扰时段与频率限制子面板（s10-07）
 *
 * 职责：
 * 1. 勿扰时段开关 + 起止时间配置（支持跨日，如 22:00-08:00）
 * 2. 每小时最大打扰次数（maxDisturbPerHour，1-10）
 * 3. critical 级预授权白名单（criticalWhitelist）编辑
 *
 * 勿扰时段内：仅 info 级别静默记录，medium/high/critical 降级或拦截
 *
 * @module settings/tabs/proactive/ProactiveQuietHoursSettings
 */

import { memo, useState } from 'react'
import { Moon, Clock, Gauge, Shield, Plus, X } from 'lucide-react'
import { ToggleSwitch } from '@components/ui'
import { type Language, t } from '@renderer/i18n'
import type { ProactivePermissionConfig } from './ProactiveSettingsPanel'

interface Props {
  config: ProactivePermissionConfig
  language: Language
  onUpdate: (patch: Partial<ProactivePermissionConfig>) => void
}

/** 时间输入校验（HH:MM 格式，24h 制） */
function isValidTime(time: string): boolean {
  return /^([01]?\d|2[0-3]):[0-5]\d$/.test(time)
}

export const ProactiveQuietHoursSettings = memo(function ProactiveQuietHoursSettings({
  config,
  language,
  onUpdate,
}: Props) {
  const [newWhitelistItem, setNewWhitelistItem] = useState('')
  const [whitelistError, setWhitelistError] = useState('')

  // ===== 勿扰时段处理 =====
  const handleQuietHoursToggle = (enabled: boolean) => {
    onUpdate({ quietHours: { ...config.quietHours, enabled } })
  }

  const handleStartTimeChange = (start: string) => {
    if (isValidTime(start) || start === '') {
      onUpdate({ quietHours: { ...config.quietHours, start } })
    }
  }

  const handleEndTimeChange = (end: string) => {
    if (isValidTime(end) || end === '') {
      onUpdate({ quietHours: { ...config.quietHours, end } })
    }
  }

  // ===== 频率限制处理 =====
  const handleMaxDisturbChange = (value: number) => {
    const clamped = Math.max(1, Math.min(10, value))
    onUpdate({ maxDisturbPerHour: clamped })
  }

  // ===== 白名单处理 =====
  const handleAddWhitelist = () => {
    const item = newWhitelistItem.trim()
    if (!item) {
      setWhitelistError(t('settings.proactive.whitelist.errorEmpty', language))
      return
    }
    if (config.criticalWhitelist.includes(item)) {
      setWhitelistError(t('settings.proactive.whitelist.errorDuplicate', language))
      return
    }
    onUpdate({ criticalWhitelist: [...config.criticalWhitelist, item] })
    setNewWhitelistItem('')
    setWhitelistError('')
  }

  const handleRemoveWhitelist = (item: string) => {
    onUpdate({
      criticalWhitelist: config.criticalWhitelist.filter((w) => w !== item),
    })
  }

  const handleWhitelistKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAddWhitelist()
    }
  }

  return (
    <div className="space-y-6">
      {/* 勿扰时段 */}
      <section className="p-4 rounded-xl border border-border/50 bg-surface/40">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-violet-500/10">
              <Moon className="w-4 h-4 text-violet-400" />
            </div>
            <div>
              <div className="text-sm font-medium text-text-primary">
                {t('settings.proactive.quietHours.title', language)}
              </div>
              <div className="text-[12px] text-text-muted mt-0.5">
                {t('settings.proactive.quietHours.desc', language)}
              </div>
            </div>
          </div>
          <ToggleSwitch
            checked={config.quietHours.enabled}
            onChange={(e) => handleQuietHoursToggle(e.target.checked)}
            switchSize="sm"
          />
        </div>

        {config.quietHours.enabled && (
          <div className="flex items-center gap-3 mt-3 pt-3 border-t border-border/30">
            <div className="flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-text-muted" />
              <span className="text-[13px] text-text-muted">
                {t('settings.proactive.quietHours.start', language)}
              </span>
            </div>
            <input
              type="time"
              value={config.quietHours.start}
              onChange={(e) => handleStartTimeChange(e.target.value)}
              className="px-2 py-1 rounded-lg bg-surface border border-border/50 text-[13px] text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
            <span className="text-text-muted">→</span>
            <span className="text-[13px] text-text-muted">
              {t('settings.proactive.quietHours.end', language)}
            </span>
            <input
              type="time"
              value={config.quietHours.end}
              onChange={(e) => handleEndTimeChange(e.target.value)}
              className="px-2 py-1 rounded-lg bg-surface border border-border/50 text-[13px] text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
          </div>
        )}
      </section>

      {/* 频率限制 */}
      <section className="p-4 rounded-xl border border-border/50 bg-surface/40">
        <div className="flex items-center gap-3 mb-3">
          <div className="p-2 rounded-lg bg-amber-500/10">
            <Gauge className="w-4 h-4 text-amber-400" />
          </div>
          <div>
            <div className="text-sm font-medium text-text-primary">
              {t('settings.proactive.frequency.title', language)}
            </div>
            <div className="text-[12px] text-text-muted mt-0.5">
              {t('settings.proactive.frequency.desc', language)}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4 mt-3">
          <input
            type="range"
            min={1}
            max={10}
            step={1}
            value={config.maxDisturbPerHour}
            onChange={(e) => handleMaxDisturbChange(Number(e.target.value))}
            className="flex-1 accent-accent"
          />
          <div className="flex items-center gap-1 shrink-0">
            <span className="text-lg font-semibold text-text-primary">
              {config.maxDisturbPerHour}
            </span>
            <span className="text-[12px] text-text-muted">
              / {t('settings.proactive.frequency.perHour', language)}
            </span>
          </div>
        </div>
      </section>

      {/* critical 白名单 */}
      <section className="p-4 rounded-xl border border-border/50 bg-surface/40">
        <div className="flex items-center gap-3 mb-3">
          <div className="p-2 rounded-lg bg-red-500/10">
            <Shield className="w-4 h-4 text-red-400" />
          </div>
          <div>
            <div className="text-sm font-medium text-text-primary">
              {t('settings.proactive.whitelist.title', language)}
            </div>
            <div className="text-[12px] text-text-muted mt-0.5">
              {t('settings.proactive.whitelist.desc', language)}
            </div>
          </div>
        </div>

        {/* 添加输入 */}
        <div className="flex items-center gap-2 mt-3">
          <input
            type="text"
            value={newWhitelistItem}
            onChange={(e) => {
              setNewWhitelistItem(e.target.value)
              setWhitelistError('')
            }}
            onKeyDown={handleWhitelistKey}
            placeholder={t('settings.proactive.whitelist.placeholder', language)}
            className="flex-1 px-3 py-2 rounded-lg bg-surface border border-border/50 text-[13px] text-text-primary placeholder-text-muted/50 focus:outline-none focus:ring-2 focus:ring-accent/40"
          />
          <button
            type="button"
            onClick={handleAddWhitelist}
            className="flex items-center gap-1 px-3 py-2 rounded-lg text-[13px] font-medium bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            {t('settings.proactive.whitelist.add', language)}
          </button>
        </div>

        {whitelistError && (
          <p className="text-[12px] text-red-400 mt-1.5">{whitelistError}</p>
        )}

        {/* 白名单列表 */}
        {config.criticalWhitelist.length > 0 ? (
          <div className="flex flex-wrap gap-2 mt-3">
            {config.criticalWhitelist.map((item) => (
              <span
                key={item}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-red-500/10 border border-red-500/20 text-[12px] text-red-300"
              >
                <span className="font-mono break-all max-w-[200px]">{item}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveWhitelist(item)}
                  className="hover:bg-red-500/20 rounded p-0.5 transition-colors"
                  aria-label={t('settings.proactive.whitelist.remove', language)}
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="text-[12px] text-text-muted/60 mt-3 italic">
            {t('settings.proactive.whitelist.empty', language)}
          </p>
        )}
      </section>
    </div>
  )
})
