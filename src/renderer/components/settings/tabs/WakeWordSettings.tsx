/**
 * WakeWordSettings - 语音唤醒设置面板
 *
 * 仅包含语音唤醒配置（悬浮头像设置已迁移至「外观设置」页面）：
 * - 开关：启用/禁用语音唤醒
 * - 唤醒词：自定义唤醒词（如「小喵小喵」）
 * - 灵敏度：strict / balanced / loose
 * - 冷却时间：命中后冷却期（秒）
 * - 最短说话时间：过滤短噪音（毫秒）
 *
 * 设计原则：
 * - 独立组件，不干扰 VoiceSettingsPanel 的 STT/TTS 配置
 * - 配置变更实时保存到 SQLite（wake_word_config 表）
 * - 保存后通知主进程同步到头像窗口
 */

import { useState, useEffect, useCallback } from 'react'
import { Mic2, Loader2 } from 'lucide-react'
import { ToggleSwitch } from '@components/ui'
import { api } from '@renderer/adapters/electronBridge'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { toast } from '@components/foundation/NotificationProvider'
import type { Language } from '@renderer/i18n'
import type { WakeWordConfig } from '../../../types/electronBridge'

// ============================================
// 类型定义
// ============================================

type Sensitivity = 'strict' | 'balanced' | 'loose'

// ============================================
// 默认配置
// ============================================

const DEFAULT_WAKE_WORD_CONFIG: WakeWordConfig = {
  enabled: false,
  keyword: '小喵小喵',
  sensitivity: 'balanced',
  cooldownMs: 3000,
  minSpeechMs: 300,
  updatedAt: 0,
}

// ============================================
// 灵敏度选项
// ============================================

const SENSITIVITY_OPTIONS: Array<{
  value: Sensitivity
  zh: string
  en: string
  descZh: string
  descEn: string
}> = [
  {
    value: 'strict',
    zh: '严格',
    en: 'Strict',
    descZh: '转写文本必须完全等于唤醒词',
    descEn: 'Transcript must exactly match the keyword',
  },
  {
    value: 'balanced',
    zh: '均衡',
    en: 'Balanced',
    descZh: '包含唤醒词且长度相近（推荐）',
    descEn: 'Contains keyword with similar length (recommended)',
  },
  {
    value: 'loose',
    zh: '宽松',
    en: 'Loose',
    descZh: '包含唤醒词即可（易误触）',
    descEn: 'Contains keyword (may trigger falsely)',
  },
]

// ============================================
// 主组件
// ============================================

export function WakeWordSettings() {
  const { language } = useStore(
    useShallow((state) => ({
      language: state.language as Language,
    })),
  )

  const tt = (zh: string, en: string) => (language === 'zh' ? zh : en)

  const [wakeConfig, setWakeConfig] = useState<WakeWordConfig>(DEFAULT_WAKE_WORD_CONFIG)
  const [loading, setLoading] = useState(true)

  // --------------------------------------------
  // 加载配置
  // --------------------------------------------
  useEffect(() => {
    let cancelled = false

    async function loadConfig() {
      try {
        const wakeRes = await api.settings.dbGetWakeWordConfig()

        if (cancelled) return

        if (wakeRes) {
          setWakeConfig(wakeRes)
        }
      } catch (err) {
        console.error('[WakeWordSettings] Load config failed:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadConfig()
    return () => {
      cancelled = true
    }
  }, [])

  // --------------------------------------------
  // 保存唤醒词配置
  // --------------------------------------------
  const handleSaveWakeWord = useCallback(
    async (config: WakeWordConfig) => {
      try {
        const result = await api.settings.dbSaveWakeWordConfig(config)
        if (result.success === false) {
          toast.error(tt('保存失败', 'Save failed'))
          return
        }
        toast.success(tt('语音唤醒配置已保存', 'Wake word settings saved'))
      } catch (err) {
        console.error('[WakeWordSettings] Save wake word config failed:', err)
        toast.error(tt('保存失败', 'Save failed'))
      }
    },
    [language],
  )

  // --------------------------------------------
  // 唤醒开关切换
  // --------------------------------------------
  const handleWakeEnabledChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const enabled = e.target.checked
      const newConfig = { ...wakeConfig, enabled, updatedAt: Date.now() }
      setWakeConfig(newConfig)
      await handleSaveWakeWord(newConfig)
    },
    [wakeConfig, handleSaveWakeWord],
  )

  // --------------------------------------------
  // 唤醒词变更
  // --------------------------------------------
  const handleKeywordChange = useCallback(
    (keyword: string) => {
      setWakeConfig((prev) => ({ ...prev, keyword }))
    },
    [],
  )

  // --------------------------------------------
  // 灵敏度变更
  // --------------------------------------------
  const handleSensitivityChange = useCallback(
    (sensitivity: Sensitivity) => {
      const newConfig = { ...wakeConfig, sensitivity, updatedAt: Date.now() }
      setWakeConfig(newConfig)
      void handleSaveWakeWord(newConfig)
    },
    [wakeConfig, handleSaveWakeWord],
  )

  // --------------------------------------------
  // 冷却时间变更
  // --------------------------------------------
  const handleCooldownChange = useCallback(
    (seconds: number) => {
      const newConfig = { ...wakeConfig, cooldownMs: seconds * 1000, updatedAt: Date.now() }
      setWakeConfig(newConfig)
    },
    [wakeConfig],
  )

  // --------------------------------------------
  // 最短说话时间变更
  // --------------------------------------------
  const handleMinSpeechChange = useCallback(
    (ms: number) => {
      const newConfig = { ...wakeConfig, minSpeechMs: ms, updatedAt: Date.now() }
      setWakeConfig(newConfig)
    },
    [wakeConfig],
  )

  // --------------------------------------------
  // 渲染
  // --------------------------------------------

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-4 h-4 animate-spin text-text-muted" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* ============ 语音唤醒设置 ============ */}
      <div className="rounded-xl border border-border/40 bg-surface/30 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Mic2 className="w-3.5 h-3.5 text-accent" />
          <p className="text-xs font-semibold text-text-primary">
            {tt('语音唤醒', 'Voice Wake Word')}
          </p>
        </div>

        {/* 唤醒开关 */}
        <div className="flex items-center justify-between gap-4 py-1">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-text-primary">
              {tt('启用语音唤醒', 'Enable Voice Wake Word')}
            </div>
            <div className="text-xs text-text-muted mt-0.5">
              {tt(
                '开启后，说出唤醒词可激活悬浮头像的语音对话',
                'When enabled, saying the wake word activates the floating avatar voice chat',
              )}
            </div>
          </div>
          <ToggleSwitch checked={wakeConfig.enabled} onChange={handleWakeEnabledChange} />
        </div>

        {/* 唤醒词输入 */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-text-secondary">
            {tt('唤醒词', 'Wake Word')}
          </label>
          <input
            type="text"
            value={wakeConfig.keyword}
            onChange={(e) => handleKeywordChange(e.target.value)}
            placeholder={tt('请输入唤醒词', 'Enter wake word')}
            className="w-full px-3 py-2 rounded-lg bg-surface-active/30 border border-border/40 text-sm text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent/50"
          />
          <p className="text-xs text-text-muted">
            {tt(
              '建议使用 4-6 字的短语，如「小喵小喵」「你好小喵」',
              'Use a 4-6 character phrase, e.g. "Hello Awee"',
            )}
          </p>
        </div>

        {/* 灵敏度选择 */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-text-secondary">
            {tt('识别灵敏度', 'Sensitivity')}
          </label>
          <div className="grid grid-cols-3 gap-2">
            {SENSITIVITY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => handleSensitivityChange(opt.value)}
                className={`px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${
                  wakeConfig.sensitivity === opt.value
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border/40 bg-surface-active/20 text-text-secondary hover:border-border-active'
                }`}
              >
                {tt(opt.zh, opt.en)}
              </button>
            ))}
          </div>
          <p className="text-xs text-text-muted">
            {tt(
              SENSITIVITY_OPTIONS.find((o) => o.value === wakeConfig.sensitivity)?.descZh || '',
              SENSITIVITY_OPTIONS.find((o) => o.value === wakeConfig.sensitivity)?.descEn || '',
            )}
          </p>
        </div>

        {/* 冷却时间 */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-text-secondary">
            {tt('冷却时间（秒）', 'Cooldown (seconds)')}
          </label>
          <input
            type="number"
            min={1}
            max={30}
            value={Math.round(wakeConfig.cooldownMs / 1000)}
            onChange={(e) => handleCooldownChange(Math.max(1, Number(e.target.value) || 1))}
            className="w-24 px-3 py-2 rounded-lg bg-surface-active/30 border border-border/40 text-sm text-text-primary focus:outline-none focus:border-accent/50"
          />
          <p className="text-xs text-text-muted">
            {tt(
              '唤醒命中后的冷却期，避免重复触发',
              'Cooldown period after detection to prevent repeated triggers',
            )}
          </p>
        </div>

        {/* 最短说话时间 */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-text-secondary">
            {tt('最短说话时间（毫秒）', 'Min Speech Time (ms)')}
          </label>
          <input
            type="number"
            min={100}
            max={2000}
            step={100}
            value={wakeConfig.minSpeechMs}
            onChange={(e) => handleMinSpeechChange(Math.max(100, Number(e.target.value) || 300))}
            className="w-24 px-3 py-2 rounded-lg bg-surface-active/30 border border-border/40 text-sm text-text-primary focus:outline-none focus:border-accent/50"
          />
          <p className="text-xs text-text-muted">
            {tt('短于此时间的语音视为噪音，不触发唤醒', 'Speech shorter than this is treated as noise')}
          </p>
        </div>
      </div>
    </div>
  )
}
