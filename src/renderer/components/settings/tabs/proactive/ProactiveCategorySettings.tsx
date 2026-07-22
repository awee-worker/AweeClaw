/**
 * 主动助手 - 分类设置子面板（s10-07）
 *
 * 职责：4 个场景分类的独立开关 + 场景说明
 * - coding: 编码场景（构建失败、重复命令、影响分析、调试卡顿）
 * - iot: IoT 场景（异常持续、MQTT 消息异常）
 * - system: 系统场景（资源告警、预测性告警）
 * - time: 定时场景（定时巡检、定时提醒）
 *
 * @module settings/tabs/proactive/ProactiveCategorySettings
 */

import { memo } from 'react'
import { Code, Cable, Monitor, Clock, type LucideIcon } from 'lucide-react'
import { ToggleSwitch } from '@components/ui'
import { type Language, t } from '@renderer/i18n'
import type { ProactivePermissionConfig } from './ProactiveSettingsPanel'

interface Props {
  config: ProactivePermissionConfig
  language: Language
  onUpdate: (patch: Partial<ProactivePermissionConfig>) => void
}

/** 分类定义 */
const CATEGORIES: Array<{
  key: keyof ProactivePermissionConfig['categories']
  icon: LucideIcon
  labelKey: string
  descKey: string
  detectorsKey: string
  color: string
}> = [
  {
    key: 'coding',
    icon: Code,
    labelKey: 'settings.proactive.category.coding',
    descKey: 'settings.proactive.category.coding.desc',
    detectorsKey: 'settings.proactive.category.coding.detectors',
    color: 'text-blue-400 bg-blue-500/10',
  },
  {
    key: 'iot',
    icon: Cable,
    labelKey: 'settings.proactive.category.iot',
    descKey: 'settings.proactive.category.iot.desc',
    detectorsKey: 'settings.proactive.category.iot.detectors',
    color: 'text-cyan-400 bg-cyan-500/10',
  },
  {
    key: 'system',
    icon: Monitor,
    labelKey: 'settings.proactive.category.system',
    descKey: 'settings.proactive.category.system.desc',
    detectorsKey: 'settings.proactive.category.system.detectors',
    color: 'text-amber-400 bg-amber-500/10',
  },
  {
    key: 'time',
    icon: Clock,
    labelKey: 'settings.proactive.category.time',
    descKey: 'settings.proactive.category.time.desc',
    detectorsKey: 'settings.proactive.category.time.detectors',
    color: 'text-violet-400 bg-violet-500/10',
  },
]

export const ProactiveCategorySettings = memo(function ProactiveCategorySettings({
  config,
  language,
  onUpdate,
}: Props) {
  const toggleCategory = (key: keyof ProactivePermissionConfig['categories'], enabled: boolean) => {
    onUpdate({ categories: { ...config.categories, [key]: enabled } })
  }

  return (
    <div className="space-y-3">
      {/* 提示信息 */}
      <div className="p-3 rounded-lg bg-surface/30 border border-border/30">
        <p className="text-[12px] text-text-muted leading-relaxed">
          {t('settings.proactive.category.hint', language)}
        </p>
      </div>

      {/* 分类列表 */}
      {CATEGORIES.map((cat) => {
        const Icon = cat.icon
        const isEnabled = config.categories[cat.key]
        return (
          <section
            key={cat.key}
            className={`p-4 rounded-xl border transition-colors ${
              isEnabled
                ? 'border-border/60 bg-surface/40'
                : 'border-border/30 bg-surface/20 opacity-70'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <div className={`p-2 rounded-lg shrink-0 ${cat.color}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-text-primary">
                    {t(cat.labelKey, language)}
                  </div>
                  <div className="text-[12px] text-text-muted mt-0.5">
                    {t(cat.descKey, language)}
                  </div>
                  <div className="text-[12px] text-text-muted/70 mt-1 italic">
                    {t(cat.detectorsKey, language)}
                  </div>
                </div>
              </div>
              <ToggleSwitch
                checked={isEnabled}
                onChange={(e) => toggleCategory(cat.key, e.target.checked)}
                switchSize="sm"
              />
            </div>
          </section>
        )
      })}
    </div>
  )
})
