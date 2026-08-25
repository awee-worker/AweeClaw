/**
 * 声音提醒设置面板
 * 
 * 控制 AI 执行过程中的声音提醒行为：
 * - 任务完成提醒
 * - 错误提醒
 * - 需确认操作提醒
 */

import { Bell, CheckCircle, AlertCircle, AlertTriangle } from 'lucide-react'
import type { Language } from '@renderer/i18n'
import { ToggleSwitch } from '@components/ui'

export interface SoundNotificationSettings {
  enabled: boolean
  taskComplete: boolean
  taskError: boolean
  needApproval: boolean
}

interface SoundNotificationPanelProps {
  settings: SoundNotificationSettings
  onChange: (settings: SoundNotificationSettings) => void
  language: Language
}

export function SoundNotificationPanel({ settings, onChange, language }: SoundNotificationPanelProps) {
  const isZh = language === 'zh'

  const handleChange = (key: keyof SoundNotificationSettings, value: boolean) => {
    onChange({ ...settings, [key]: value })
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* 总开关 */}
      <section>
        <div className="flex items-center justify-between p-5 bg-surface rounded-2xl border border-border/40 hover:border-border/60 transition-colors">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-accent/10 flex items-center justify-center">
              <Bell className="w-4.5 h-4.5 text-accent" />
            </div>
            <div>
              <div className="text-sm font-semibold text-text-primary">
                {isZh ? '声音提醒' : 'Sound Notifications'}
              </div>
              <div className="text-xs text-text-muted mt-0.5">
                {isZh ? 'AI 执行过程中播放提示音' : 'Play sound alerts during AI execution'}
              </div>
            </div>
          </div>
          <ToggleSwitch
            checked={settings.enabled}
            onChange={(e) => handleChange('enabled', e.target.checked)}
          />
        </div>
      </section>

      {/* 子开关 - 仅在主开关开启时显示 */}
      {settings.enabled && (
        <div className="space-y-3 pl-12">
          {/* 任务完成提醒 */}
          <div className="flex items-center justify-between py-3 border-b border-border/20">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-green-500/10 flex items-center justify-center">
                <CheckCircle className="w-4 h-4 text-green-500" />
              </div>
              <div>
                <div className="text-sm font-medium text-text-primary">
                  {isZh ? '任务完成提醒' : 'Task Complete'}
                </div>
                <div className="text-xs text-text-muted">
                  {isZh ? 'AI 回复完内容时播放提示音' : 'Play sound when AI finishes replying'}
                </div>
              </div>
            </div>
            <ToggleSwitch
              checked={settings.taskComplete}
              onChange={(e) => handleChange('taskComplete', e.target.checked)}
            />
          </div>

          {/* 错误提醒 */}
          <div className="flex items-center justify-between py-3 border-b border-border/20">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center">
                <AlertCircle className="w-4 h-4 text-red-500" />
              </div>
              <div>
                <div className="text-sm font-medium text-text-primary">
                  {isZh ? '错误提醒' : 'Error Alert'}
                </div>
                <div className="text-xs text-text-muted">
                  {isZh ? 'AI 执行过程中发生错误时播放提示音' : 'Play sound when AI encounters an error during execution'}
                </div>
              </div>
            </div>
            <ToggleSwitch
              checked={settings.taskError}
              onChange={(e) => handleChange('taskError', e.target.checked)}
            />
          </div>

          {/* 需确认操作提醒 */}
          <div className="flex items-center justify-between py-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
              </div>
              <div>
                <div className="text-sm font-medium text-text-primary">
                  {isZh ? '需确认操作提醒' : 'Approval Required'}
                </div>
                <div className="text-xs text-text-muted">
                  {isZh ? 'AI 执行过程中需要用户确认、批准或选择时播放提示音' : 'Play sound when user confirmation, approval, or selection is needed'}
                </div>
              </div>
            </div>
            <ToggleSwitch
              checked={settings.needApproval}
              onChange={(e) => handleChange('needApproval', e.target.checked)}
            />
          </div>
        </div>
      )}
    </div>
  )
}
