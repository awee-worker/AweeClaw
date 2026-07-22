/**
 * 主动式助手设置面板（阶段10 s10-07 新增）
 *
 * 作为容器组件，负责：
 * 1. 加载/保存 ProactivePermissionConfig（通过 IPC）
 * 2. 内部 Tab 切换（通用/分类/勿扰/历史）
 * 3. 脏数据追踪 + 底部保存栏（遵循用户偏好："保存" + "返回应用"）
 * 4. 将配置和回调传递给 4 个子组件
 *
 * 子组件拆分（遵循"每个页面独立组件"原则）：
 * - ProactiveGeneralSettings    全局开关 + 等级选择
 * - ProactiveCategorySettings   4 分类开关
 * - ProactiveQuietHoursSettings 勿扰时段 + 频率限制
 * - ProactiveHistoryView        历史提案 + 采纳率统计（只读，无保存栏）
 *
 * @module settings/tabs/proactive/ProactiveSettingsPanel
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Sparkles, Settings2, Tag, Moon, History, RotateCcw } from 'lucide-react'
import { type Language, t } from '@renderer/i18n'
import { logger } from '@shared/toolkit/LogEngine'
import { ProactiveGeneralSettings } from './ProactiveGeneralSettings'
import { ProactiveCategorySettings } from './ProactiveCategorySettings'
import { ProactiveQuietHoursSettings } from './ProactiveQuietHoursSettings'
import { ProactiveHistoryView } from './ProactiveHistoryView'

// ============================================================
// 类型定义（与主进程 ProactiveInterface 对齐）
// ============================================================

export type ProactiveLevel = 'off' | 'notify' | 'suggest' | 'act'

export interface ProactivePermissionConfig {
  enabled: boolean
  level: ProactiveLevel
  categories: {
    coding: boolean
    iot: boolean
    system: boolean
    time: boolean
  }
  quietHours: {
    enabled: boolean
    start: string
    end: string
  }
  maxDisturbPerHour: number
  criticalWhitelist: string[]
}

/** IPC 返回的权限配置结果 */
interface PermissionConfigResult {
  config: ProactivePermissionConfig
  engineRunning: boolean
  frequency?: {
    count: number
    maxPerHour: number
    windowMs: number
  }
}

// ============================================================
// 常量
// ============================================================

/** 默认配置（用于重置） */
const DEFAULT_CONFIG: ProactivePermissionConfig = {
  enabled: false,
  level: 'suggest',
  categories: { coding: true, iot: true, system: true, time: true },
  quietHours: { enabled: false, start: '22:00', end: '08:00' },
  maxDisturbPerHour: 3,
  criticalWhitelist: [],
}

/** Tab 定义 */
type ProactiveTab = 'general' | 'category' | 'quietHours' | 'history'

const TABS: Array<{ id: ProactiveTab; icon: typeof Sparkles; labelKey: string }> = [
  { id: 'general', icon: Settings2, labelKey: 'settings.proactive.tab.general' },
  { id: 'category', icon: Tag, labelKey: 'settings.proactive.tab.category' },
  { id: 'quietHours', icon: Moon, labelKey: 'settings.proactive.tab.quietHours' },
  { id: 'history', icon: History, labelKey: 'settings.proactive.tab.history' },
]

// ============================================================
// 组件
// ============================================================

interface Props {
  language: Language
}

export function ProactiveSettingsPanel({ language }: Props) {
  // ===== 状态 =====
  const [config, setConfig] = useState<ProactivePermissionConfig>(DEFAULT_CONFIG)
  const [loadedConfig, setLoadedConfig] = useState<ProactivePermissionConfig>(DEFAULT_CONFIG)
  const [engineRunning, setEngineRunning] = useState(false)
  const [frequency, setFrequency] = useState<{ count: number; maxPerHour: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState<ProactiveTab>('general')

  // ===== 脏数据检测 =====
  const isDirty = useMemo(() => {
    return JSON.stringify(config) !== JSON.stringify(loadedConfig)
  }, [config, loadedConfig])

  // ===== 加载配置 =====
  const loadConfig = useCallback(async () => {
    try {
      const result = await window.electronAPI.proactive.getPermissionConfig()
      if (result.success && result.data) {
        const data = result.data as PermissionConfigResult
        setConfig(data.config)
        setLoadedConfig(data.config)
        setEngineRunning(data.engineRunning)
        if (data.frequency) {
          setFrequency({ count: data.frequency.count, maxPerHour: data.frequency.maxPerHour })
        }
      }
    } catch (e) {
      logger.settings.error('[ProactiveSettingsPanel] 加载配置失败:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  // ===== 更新本地配置（不立即保存） =====
  const updateConfig = useCallback((patch: Partial<ProactivePermissionConfig>) => {
    setConfig((prev) => ({ ...prev, ...patch }))
  }, [])

  // ===== 保存配置 =====
  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      const result = await window.electronAPI.proactive.updatePermissionConfig(config)
      if (result.success && result.data) {
        const data = result.data as { config: ProactivePermissionConfig; engineRunning: boolean }
        setConfig(data.config)
        setLoadedConfig(data.config)
        setEngineRunning(data.engineRunning)
      }
    } catch (e) {
      logger.settings.error('[ProactiveSettingsPanel] 保存配置失败:', e)
    } finally {
      setSaving(false)
    }
  }, [config])

  // ===== 返回应用（撤销修改） =====
  const handleRevert = useCallback(() => {
    setConfig(loadedConfig)
  }, [loadedConfig])

  // ===== 重置为默认 =====
  const handleReset = useCallback(async () => {
    setSaving(true)
    try {
      const result = await window.electronAPI.proactive.resetPermissionConfig()
      if (result.success && result.data) {
        const data = result.data as { config: ProactivePermissionConfig; engineRunning: boolean }
        setConfig(data.config)
        setLoadedConfig(data.config)
        setEngineRunning(data.engineRunning)
      }
    } catch (e) {
      logger.settings.error('[ProactiveSettingsPanel] 重置配置失败:', e)
    } finally {
      setSaving(false)
    }
  }, [])

  // ===== 渲染 =====
  if (loading) {
    return (
      <div className="min-h-[320px] flex items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-text-muted">
          <div className="w-4 h-4 border-2 border-accent/60 border-t-transparent rounded-full animate-spin" />
          <span>{t('settings.loadingSettings', language)}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* 标题栏 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-accent" />
          <h2 className="text-lg font-semibold text-text-primary">
            {t('settings.proactive.title', language)}
          </h2>
          {engineRunning && (
            <span className="flex items-center gap-1 text-[12px] px-2 py-0.5 rounded-full bg-green-500/15 text-green-400">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              {t('settings.proactive.engineRunning', language)}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={handleReset}
          disabled={saving}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] text-text-muted hover:text-text-primary hover:bg-surface-active/50 transition-colors disabled:opacity-50"
          title={t('settings.proactive.resetToDefault', language)}
        >
          <RotateCcw className="w-3.5 h-3.5" />
          {t('settings.proactive.resetToDefault', language)}
        </button>
      </div>

      {/* Tab 导航 */}
      <div className="flex items-center gap-1 mb-4 border-b border-border/50">
        {TABS.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                isActive
                  ? 'text-accent border-accent'
                  : 'text-text-muted border-transparent hover:text-text-primary'
              }`}
            >
              <Icon className="w-4 h-4" />
              {t(tab.labelKey, language)}
            </button>
          )
        })}
      </div>

      {/* Tab 内容 */}
      <div className="flex-1 overflow-y-auto custom-scrollbar min-h-0">
        {activeTab === 'general' && (
          <ProactiveGeneralSettings
            config={config}
            engineRunning={engineRunning}
            frequency={frequency}
            language={language}
            onUpdate={updateConfig}
          />
        )}
        {activeTab === 'category' && (
          <ProactiveCategorySettings
            config={config}
            language={language}
            onUpdate={updateConfig}
          />
        )}
        {activeTab === 'quietHours' && (
          <ProactiveQuietHoursSettings
            config={config}
            language={language}
            onUpdate={updateConfig}
          />
        )}
        {activeTab === 'history' && <ProactiveHistoryView language={language} />}
      </div>

      {/* 底部保存栏（仅在有改动时显示，遵循用户偏好） */}
      {isDirty && activeTab !== 'history' && (
        <div className="shrink-0 flex items-center justify-end gap-2 pt-3 mt-3 border-t border-border/50">
          <button
            type="button"
            onClick={handleRevert}
            disabled={saving}
            className="px-4 py-2 rounded-lg text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-surface-active/50 transition-colors disabled:opacity-50"
          >
            {t('settings.proactive.backToApp', language)}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {saving && <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            {t('settings.proactive.save', language)}
          </button>
        </div>
      )}
    </div>
  )
}
