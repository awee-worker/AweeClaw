/**
 * 语音设置面板（左侧菜单「语音设置」的容器）
 *
 * 整合：
 * 1. 模式切换（拆分式 / 端到端）
 * 2. 拆分式：STT 配置 + TTS 配置（含音色、语速、测试按钮）
 * 3. 端到端：实时语音模型配置
 * 4. 通用行为：自动播报开关
 *
 * 设计原则：所有模型相关配置（Provider/Model/APIKey/BaseURL/Voice/Speed）
 * 统一存储在 voice_model_config 表中，不再用 localStorage 重复存储。
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  Mic,
  Volume2,
  Loader2,
  Eye,
  EyeOff,
  Cloud,
  Server,
  Radio,
} from 'lucide-react'
import { ToggleSwitch } from '@components/ui'
import { voiceApi } from '../../../services/voiceApi'
import { toast } from '@components/foundation/NotificationProvider'
import { StorageService } from '@shared/toolkit/StorageService'
import { api } from '@renderer/adapters/electronBridge'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { t, type Language } from '@renderer/i18n'
import {
  VOICE_PROVIDERS,
  getVoiceProviderPreset,
  REALTIME_PROVIDERS,
  getRealtimeProviderPreset,
} from './voiceProviders'

type VoiceMode = 'split' | 'realtime'

interface VoiceModelConfig {
  mode: VoiceMode
  sttEnabled: boolean
  sttProvider: string
  sttModel: string
  sttApiKey: string
  sttBaseUrl: string
  sttLanguage: string
  sttTimeout: number
  ttsEnabled: boolean
  ttsProvider: string
  ttsModel: string
  ttsVoice: string
  ttsApiKey: string
  ttsBaseUrl: string
  ttsSpeed: number
  ttsTimeout: number
  realtimeEnabled: boolean
  realtimeProvider: string
  realtimeModel: string
  realtimeApiKey: string
  realtimeBaseUrl: string
  realtimeVoice: string
  realtimeTimeout: number
}

const DEFAULT_CONFIG: VoiceModelConfig = {
  mode: 'split',
  sttEnabled: false,
  sttProvider: 'openai',
  sttModel: 'whisper-1',
  sttApiKey: '',
  sttBaseUrl: '',
  sttLanguage: 'auto',
  sttTimeout: 120000,
  ttsEnabled: false,
  ttsProvider: 'openai',
  ttsModel: 'tts-1',
  ttsVoice: 'alloy',
  ttsApiKey: '',
  ttsBaseUrl: '',
  ttsSpeed: 1.0,
  ttsTimeout: 120000,
  realtimeEnabled: false,
  realtimeProvider: 'openai',
  realtimeModel: 'gpt-4o-realtime',
  realtimeApiKey: '',
  realtimeBaseUrl: '',
  realtimeVoice: 'alloy',
  realtimeTimeout: 120000,
}

/**
 * 需要手动保存的字段（非即时保存）。
 * 即时保存字段（mode/sttEnabled/ttsEnabled/realtimeEnabled）改动时立即写入 db，
 * 不触发 dirty 状态；其余字段需用户点击底部保存栏的"保存"按钮才写入 db。
 */
const PERSISTED_FIELDS: (keyof VoiceModelConfig)[] = [
  'sttProvider', 'sttModel', 'sttApiKey', 'sttBaseUrl',
  'ttsProvider', 'ttsModel', 'ttsVoice', 'ttsApiKey', 'ttsBaseUrl', 'ttsSpeed',
  'realtimeProvider', 'realtimeModel', 'realtimeVoice', 'realtimeApiKey', 'realtimeBaseUrl',
  'sttTimeout', 'ttsTimeout', 'realtimeTimeout', 'sttLanguage',
]

/** 对 config 中需要手动保存的字段做快照（JSON 字符串），用于 dirty 检测 */
function snapshotPersisted(config: VoiceModelConfig): string {
  const partial: Record<string, unknown> = {}
  for (const field of PERSISTED_FIELDS) {
    partial[field] = config[field]
  }
  return JSON.stringify(partial)
}

interface VoiceSettingsPanelProps {
  language: Language
}

export default function VoiceSettingsPanel({ language }: VoiceSettingsPanelProps) {
  const { cloudMode } = useStore(
    useShallow((s) => ({
      cloudMode: s.cloudMode,
    })),
  )
  const isCloudMode = cloudMode === 'cloud'

  const [config, setConfig] = useState<VoiceModelConfig>(DEFAULT_CONFIG)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [showSttKey, setShowSttKey] = useState(false)
  const [showTtsKey, setShowTtsKey] = useState(false)
  const [showRealtimeKey, setShowRealtimeKey] = useState(false)
  const [autoSpeak, setAutoSpeak] = useState(() => {
    return StorageService.get<string>('voice_auto_speak') === 'true'
  })

  /** 已保存的配置快照（仅 PERSISTED_FIELDS），用于 dirty 检测和"返回应用"重置 */
  const savedSnapshotRef = useRef<string>('')

  /** dirty 检测：当前 config 的 PERSISTED_FIELDS 与已保存快照不一致时为 true */
  const isDirty = useMemo(() => {
    if (!savedSnapshotRef.current) return false
    return snapshotPersisted(config) !== savedSnapshotRef.current
  }, [config])

  // 加载语音模型配置
  const loadConfig = useCallback(async () => {
    try {
      const result = await api.settings.dbGetVoiceModelConfig()
      if (result) {
        const loaded = { ...DEFAULT_CONFIG, ...result }
        setConfig(loaded)
        savedSnapshotRef.current = snapshotPersisted(loaded)
      } else {
        savedSnapshotRef.current = snapshotPersisted(DEFAULT_CONFIG)
      }
    } catch (err) {
      console.error('[VoiceSettings] Load config failed:', err)
      savedSnapshotRef.current = snapshotPersisted(DEFAULT_CONFIG)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  // 保存全部配置
  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      const result = await api.settings.dbSaveVoiceModelConfig(config)
      if (result.success) {
        toast.success(t('provider.voiceModel.saveSuccess', language))
        // 更新已保存快照，清除 dirty 状态
        savedSnapshotRef.current = snapshotPersisted(config)
      } else {
        toast.error(result.error || t('provider.voiceModel.saveFailed', language))
      }
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSaving(false)
    }
  }, [config, language])

  /** "返回应用"：放弃未保存的改动，将 PERSISTED_FIELDS 重置到上次保存的状态 */
  const handleReset = useCallback(() => {
    if (!savedSnapshotRef.current) return
    try {
      const saved = JSON.parse(savedSnapshotRef.current) as Record<string, unknown>
      setConfig((prev) => {
        const next = { ...prev }
        for (const field of PERSISTED_FIELDS) {
          if (saved[field] !== undefined) {
            // 使用索引赋值，字段名和值都来自序列化的 VoiceModelConfig，类型安全
            ;(next as Record<string, unknown>)[field] = saved[field]
          }
        }
        return next
      })
    } catch (err) {
      console.error('[VoiceSettings] Reset failed:', err)
    }
  }, [])

  // 切换模式时立即保存
  const handleModeChange = useCallback(async (mode: VoiceMode) => {
    if (mode === config.mode) return
    const next = { ...config, mode }
    if (mode === 'realtime') {
      next.realtimeEnabled = true
    }
    setConfig(next)
    try {
      await api.settings.dbSaveVoiceModelConfig(next)
    } catch (err) {
      console.error('[VoiceSettings] Save mode failed:', err)
    }
  }, [config])

  const handleToggleStt = useCallback(async (enabled: boolean) => {
    setConfig((prev) => ({ ...prev, sttEnabled: enabled }))
    try {
      await api.settings.dbSetVoiceModelEnabled({ sttEnabled: enabled, ttsEnabled: config.ttsEnabled })
    } catch (err) {
      console.error('[VoiceSettings] Toggle STT failed:', err)
    }
  }, [config.ttsEnabled])

  const handleToggleTts = useCallback(async (enabled: boolean) => {
    setConfig((prev) => ({ ...prev, ttsEnabled: enabled }))
    try {
      await api.settings.dbSetVoiceModelEnabled({ sttEnabled: config.sttEnabled, ttsEnabled: enabled })
    } catch (err) {
      console.error('[VoiceSettings] Toggle TTS failed:', err)
    }
  }, [config.sttEnabled])

  const handleToggleRealtime = useCallback(async (enabled: boolean) => {
    setConfig((prev) => ({ ...prev, realtimeEnabled: enabled }))
    try {
      await api.settings.dbSaveVoiceModelConfig({ ...config, realtimeEnabled: enabled })
    } catch (err) {
      console.error('[VoiceSettings] Toggle realtime failed:', err)
    }
  }, [config])

  // 通用字段更新
  const updateField = useCallback(<K extends keyof VoiceModelConfig>(field: K, value: VoiceModelConfig[K]) => {
    setConfig((prev) => ({ ...prev, [field]: value }))
  }, [])

  // 切换 STT Provider 时自动填充默认值
  const handleSttProviderChange = useCallback((providerId: string) => {
    const preset = getVoiceProviderPreset(providerId)
    if (!preset) {
      updateField('sttProvider', providerId)
      return
    }
    setConfig((prev) => ({
      ...prev,
      sttProvider: providerId,
      sttModel: preset.sttModel || prev.sttModel,
      sttBaseUrl: preset.baseUrl || prev.sttBaseUrl,
    }))
  }, [updateField])

  // 切换 TTS Provider 时自动填充默认值
  const handleTtsProviderChange = useCallback((providerId: string) => {
    const preset = getVoiceProviderPreset(providerId)
    if (!preset) {
      updateField('ttsProvider', providerId)
      return
    }
    setConfig((prev) => ({
      ...prev,
      ttsProvider: providerId,
      ttsModel: preset.ttsModel || prev.ttsModel,
      ttsVoice: preset.ttsVoice || prev.ttsVoice,
      ttsBaseUrl: preset.baseUrl || prev.ttsBaseUrl,
    }))
  }, [updateField])

  // 切换 Realtime Provider 时自动填充默认值
  const handleRealtimeProviderChange = useCallback((providerId: string) => {
    const preset = getRealtimeProviderPreset(providerId)
    if (!preset) {
      updateField('realtimeProvider', providerId)
      return
    }
    setConfig((prev) => ({
      ...prev,
      realtimeProvider: providerId,
      realtimeModel: preset.model || prev.realtimeModel,
      realtimeVoice: preset.voice || prev.realtimeVoice,
      realtimeBaseUrl: preset.baseUrl || prev.realtimeBaseUrl,
    }))
  }, [updateField])

  // 自动播报开关
  const handleAutoSpeakChange = useCallback((value: boolean) => {
    setAutoSpeak(value)
    StorageService.set('voice_auto_speak', String(value))
  }, [])

  // 测试 TTS 语音
  const handleTestTts = useCallback(async () => {
    setTesting(true)
    try {
      const testText = language === 'zh' ? '你好，语音合成测试' : 'Hello, TTS test'
      const blob = await voiceApi.textToSpeech(testText, {
        voice: config.ttsVoice || undefined,
        speed: config.ttsSpeed,
      })
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audio.onended = () => URL.revokeObjectURL(url)
      audio.onerror = () => URL.revokeObjectURL(url)
      audio.play().catch(() => {})
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'TTS test failed')
    } finally {
      setTesting(false)
    }
  }, [language, config.ttsVoice, config.ttsSpeed])

  const tt = (zh: string, en: string) => (language === 'zh' ? zh : en)

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="animate-pulse text-text-muted text-xs">{t('common.loading', language)}</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* ============ 云端模式提示 ============ */}
      {isCloudMode ? (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-accent/5 border border-accent/20">
          <Cloud className="w-4 h-4 text-accent shrink-0" />
          <div className="text-xs">
            <p className="text-text-primary font-medium">
              {t('provider.voiceModel.cloudMode', language)}
            </p>
            <p className="text-text-muted mt-0.5">
              {t('provider.voiceModel.cloudModeDesc', language)}
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* ============ 模式切换 Tab ============ */}
          <div className="flex items-center gap-1 p-1 rounded-lg bg-surface/40 border border-border/30">
            <button
              type="button"
              onClick={() => handleModeChange('split')}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium transition-colors ${
                config.mode === 'split'
                  ? 'bg-accent text-white shadow-sm'
                  : 'text-text-secondary hover:text-text-primary hover:bg-surface-active/50'
              }`}
            >
              <Mic className="w-3.5 h-3.5" />
              {t('provider.voiceModel.modeSplit', language)}
            </button>
            <button
              type="button"
              onClick={() => handleModeChange('realtime')}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium transition-colors ${
                config.mode === 'realtime'
                  ? 'bg-accent text-white shadow-sm'
                  : 'text-text-secondary hover:text-text-primary hover:bg-surface-active/50'
              }`}
            >
              <Radio className="w-3.5 h-3.5" />
              {t('provider.voiceModel.modeRealtime', language)}
            </button>
          </div>

          {/* ============ 拆分式模式 ============ */}
          {config.mode === 'split' && (
            <>
              {/* STT 配置块 */}
              <div className="rounded-xl border border-border/40 bg-surface/30 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Mic className="w-3.5 h-3.5 text-accent" />
                    <div>
                      <p className="text-xs font-semibold text-text-primary">
                        {t('provider.voiceModel.sttSection', language)}
                      </p>
                      <p className="text-[10px] text-text-muted">
                        {t('provider.voiceModel.sttDescription', language)}
                      </p>
                    </div>
                  </div>
                  <ToggleSwitch
                    checked={config.sttEnabled}
                    switchSize="sm"
                    onChange={(e) => handleToggleStt(e.target.checked)}
                  />
                </div>

                {!config.sttEnabled ? (
                  <div className="flex items-center gap-2 p-2.5 rounded-lg bg-surface-active/30 border border-border/30">
                    <Server className="w-3.5 h-3.5 text-text-muted shrink-0" />
                    <p className="text-[11px] text-text-muted">
                      {t('provider.voiceModel.sttDisabledHint', language)}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* Provider */}
                    <Field label={t('provider.voiceModel.provider', language)}>
                      <select
                        value={config.sttProvider}
                        onChange={(e) => handleSttProviderChange(e.target.value)}
                        className="w-full bg-background/50 border border-border rounded-lg px-3 py-2 text-xs text-text-primary focus:border-accent/50 focus:ring-1 focus:ring-accent/20 outline-none"
                      >
                        {VOICE_PROVIDERS.filter((p) => p.supportsStt).map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.displayName}
                            {p.note ? ` — ${p.note}` : ''}
                          </option>
                        ))}
                      </select>
                    </Field>

                    {/* Model */}
                    <Field label={t('provider.voiceModel.model', language)}>
                      <input
                        type="text"
                        value={config.sttModel}
                        onChange={(e) => updateField('sttModel', e.target.value)}
                        placeholder="whisper-1"
                        className="w-full bg-background/50 border border-border rounded-lg px-3 py-2 text-xs text-text-primary font-mono focus:border-accent/50 focus:ring-1 focus:ring-accent/20 outline-none"
                      />
                    </Field>

                    {/* API Key */}
                    <Field label={t('provider.voiceModel.apiKey', language)}>
                      <div className="relative">
                        <input
                          type={showSttKey ? 'text' : 'password'}
                          value={config.sttApiKey}
                          onChange={(e) => updateField('sttApiKey', e.target.value)}
                          placeholder="sk-..."
                          className="w-full bg-background/50 border border-border rounded-lg px-3 py-2 pr-9 text-xs text-text-primary font-mono focus:border-accent/50 focus:ring-1 focus:ring-accent/20 outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => setShowSttKey(!showSttKey)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                        >
                          {showSttKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </Field>

                    {/* Base URL */}
                    <Field label={t('provider.voiceModel.baseUrl', language)}>
                      <input
                        type="text"
                        value={config.sttBaseUrl}
                        onChange={(e) => updateField('sttBaseUrl', e.target.value)}
                        placeholder="https://api.openai.com/v1"
                        className="w-full bg-background/50 border border-border rounded-lg px-3 py-2 text-xs text-text-primary font-mono focus:border-accent/50 focus:ring-1 focus:ring-accent/20 outline-none"
                      />
                    </Field>
                  </div>
                )}
              </div>

              {/* TTS 配置块（含音色、语速、测试按钮） */}
              <div className="rounded-xl border border-border/40 bg-surface/30 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Volume2 className="w-3.5 h-3.5 text-accent" />
                    <div>
                      <p className="text-xs font-semibold text-text-primary">
                        {t('provider.voiceModel.ttsSection', language)}
                      </p>
                      <p className="text-[10px] text-text-muted">
                        {t('provider.voiceModel.ttsDescription', language)}
                      </p>
                    </div>
                  </div>
                  <ToggleSwitch
                    checked={config.ttsEnabled}
                    switchSize="sm"
                    onChange={(e) => handleToggleTts(e.target.checked)}
                  />
                </div>

                {!config.ttsEnabled ? (
                  <div className="flex items-center gap-2 p-2.5 rounded-lg bg-surface-active/30 border border-border/30">
                    <Server className="w-3.5 h-3.5 text-text-muted shrink-0" />
                    <p className="text-[11px] text-text-muted">
                      {t('provider.voiceModel.ttsDisabledHint', language)}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* Provider */}
                    <Field label={t('provider.voiceModel.provider', language)}>
                      <select
                        value={config.ttsProvider}
                        onChange={(e) => handleTtsProviderChange(e.target.value)}
                        className="w-full bg-background/50 border border-border rounded-lg px-3 py-2 text-xs text-text-primary focus:border-accent/50 focus:ring-1 focus:ring-accent/20 outline-none"
                      >
                        {VOICE_PROVIDERS.filter((p) => p.supportsTts).map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.displayName}
                            {p.note ? ` — ${p.note}` : ''}
                          </option>
                        ))}
                      </select>
                    </Field>

                    {/* Model */}
                    <Field label={t('provider.voiceModel.model', language)}>
                      <input
                        type="text"
                        value={config.ttsModel}
                        onChange={(e) => updateField('ttsModel', e.target.value)}
                        placeholder="tts-1"
                        className="w-full bg-background/50 border border-border rounded-lg px-3 py-2 text-xs text-text-primary font-mono focus:border-accent/50 focus:ring-1 focus:ring-accent/20 outline-none"
                      />
                    </Field>

                    {/* Voice（音色） */}
                    <Field label={t('provider.voiceModel.voice', language)}>
                      <input
                        type="text"
                        value={config.ttsVoice}
                        onChange={(e) => updateField('ttsVoice', e.target.value)}
                        placeholder="alloy"
                        className="w-full bg-background/50 border border-border rounded-lg px-3 py-2 text-xs text-text-primary font-mono focus:border-accent/50 focus:ring-1 focus:ring-accent/20 outline-none"
                      />
                    </Field>

                    {/* API Key */}
                    <Field label={t('provider.voiceModel.apiKey', language)}>
                      <div className="relative">
                        <input
                          type={showTtsKey ? 'text' : 'password'}
                          value={config.ttsApiKey}
                          onChange={(e) => updateField('ttsApiKey', e.target.value)}
                          placeholder="sk-..."
                          className="w-full bg-background/50 border border-border rounded-lg px-3 py-2 pr-9 text-xs text-text-primary font-mono focus:border-accent/50 focus:ring-1 focus:ring-accent/20 outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => setShowTtsKey(!showTtsKey)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                        >
                          {showTtsKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </Field>

                    {/* Base URL */}
                    <Field label={t('provider.voiceModel.baseUrl', language)}>
                      <input
                        type="text"
                        value={config.ttsBaseUrl}
                        onChange={(e) => updateField('ttsBaseUrl', e.target.value)}
                        placeholder="https://api.openai.com/v1"
                        className="w-full bg-background/50 border border-border rounded-lg px-3 py-2 text-xs text-text-primary font-mono focus:border-accent/50 focus:ring-1 focus:ring-accent/20 outline-none"
                      />
                    </Field>

                    {/* Speed（语速） */}
                    <Field label={`${t('provider.voiceModel.speed', language)} (${config.ttsSpeed.toFixed(1)}x)`}>
                      <input
                        type="range"
                        min="0.5"
                        max="2.0"
                        step="0.1"
                        value={config.ttsSpeed}
                        onChange={(e) => updateField('ttsSpeed', parseFloat(e.target.value))}
                        className="w-full accent-accent"
                      />
                    </Field>

                    {/* 测试语音按钮 */}
                    <div className="pt-1">
                      <button
                        onClick={handleTestTts}
                        disabled={testing}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent/10 text-accent text-sm font-medium hover:bg-accent/20 transition-colors disabled:opacity-50"
                      >
                        {testing ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Volume2 className="w-4 h-4" />
                        )}
                        {tt('测试语音', 'Test Voice')}
                      </button>
                    </div>
                  </div>
                )}
              </div>

            </>
          )}

          {/* ============ 端到端模式 ============ */}
          {config.mode === 'realtime' && (
            <>
              {/* 模式说明 */}
              <div className="flex items-start gap-2 p-3 rounded-lg bg-accent/5 border border-accent/20">
                <Radio className="w-3.5 h-3.5 text-accent shrink-0 mt-0.5" />
                <p className="text-xs text-text-secondary leading-relaxed">
                  {t('provider.voiceModel.realtimeHint', language)}
                </p>
              </div>

              {/* 实时语音模型配置 */}
              <div className="rounded-xl border border-border/40 bg-surface/30 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Radio className="w-3.5 h-3.5 text-accent" />
                    <div>
                      <p className="text-xs font-semibold text-text-primary">
                        {t('provider.voiceModel.realtimeSection', language)}
                      </p>
                      <p className="text-[10px] text-text-muted">
                        {t('provider.voiceModel.realtimeDescription', language)}
                      </p>
                    </div>
                  </div>
                  <ToggleSwitch
                    checked={config.realtimeEnabled}
                    switchSize="sm"
                    onChange={(e) => handleToggleRealtime(e.target.checked)}
                  />
                </div>

                {!config.realtimeEnabled ? (
                  <div className="flex items-center gap-2 p-2.5 rounded-lg bg-surface-active/30 border border-border/30">
                    <Server className="w-3.5 h-3.5 text-text-muted shrink-0" />
                    <p className="text-[11px] text-text-muted">
                      {t('provider.voiceModel.realtimeDisabledHint', language)}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* Provider */}
                    <Field label={t('provider.voiceModel.provider', language)}>
                      <select
                        value={config.realtimeProvider}
                        onChange={(e) => handleRealtimeProviderChange(e.target.value)}
                        className="w-full bg-background/50 border border-border rounded-lg px-3 py-2 text-xs text-text-primary focus:border-accent/50 focus:ring-1 focus:ring-accent/20 outline-none"
                      >
                        {REALTIME_PROVIDERS.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.displayName}
                            {p.note ? ` — ${p.note}` : ''}
                          </option>
                        ))}
                      </select>
                    </Field>

                    {/* Model */}
                    <Field label={t('provider.voiceModel.model', language)}>
                      <input
                        type="text"
                        value={config.realtimeModel}
                        onChange={(e) => updateField('realtimeModel', e.target.value)}
                        placeholder="gpt-4o-realtime"
                        className="w-full bg-background/50 border border-border rounded-lg px-3 py-2 text-xs text-text-primary font-mono focus:border-accent/50 focus:ring-1 focus:ring-accent/20 outline-none"
                      />
                    </Field>

                    {/* Voice */}
                    <Field label={t('provider.voiceModel.voice', language)}>
                      <input
                        type="text"
                        value={config.realtimeVoice}
                        onChange={(e) => updateField('realtimeVoice', e.target.value)}
                        placeholder="alloy"
                        className="w-full bg-background/50 border border-border rounded-lg px-3 py-2 text-xs text-text-primary font-mono focus:border-accent/50 focus:ring-1 focus:ring-accent/20 outline-none"
                      />
                    </Field>

                    {/* API Key */}
                    <Field label={t('provider.voiceModel.apiKey', language)}>
                      <div className="relative">
                        <input
                          type={showRealtimeKey ? 'text' : 'password'}
                          value={config.realtimeApiKey}
                          onChange={(e) => updateField('realtimeApiKey', e.target.value)}
                          placeholder="sk-..."
                          className="w-full bg-background/50 border border-border rounded-lg px-3 py-2 pr-9 text-xs text-text-primary font-mono focus:border-accent/50 focus:ring-1 focus:ring-accent/20 outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => setShowRealtimeKey(!showRealtimeKey)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                        >
                          {showRealtimeKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </Field>

                    {/* Base URL */}
                    <Field label={t('provider.voiceModel.baseUrl', language)}>
                      <input
                        type="text"
                        value={config.realtimeBaseUrl}
                        onChange={(e) => updateField('realtimeBaseUrl', e.target.value)}
                        placeholder="wss://api.openai.com/v1/realtime"
                        className="w-full bg-background/50 border border-border rounded-lg px-3 py-2 text-xs text-text-primary font-mono focus:border-accent/50 focus:ring-1 focus:ring-accent/20 outline-none"
                      />
                    </Field>
                  </div>
                )}
              </div>

            </>
          )}

          {/* ============ 通用行为设置 ============ */}
          <div className="rounded-xl border border-border/40 bg-surface/30 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Volume2 className="w-3.5 h-3.5 text-accent" />
              <p className="text-xs font-semibold text-text-primary">
                {tt('通用行为', 'General Behavior')}
              </p>
            </div>

            {/* 自动播报 */}
            <div className="flex items-center justify-between gap-4 py-1">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-text-primary">
                  {tt('自动播报', 'Auto Speak')}
                </div>
                <div className="text-xs text-text-muted mt-0.5">
                  {tt('AI 回复后自动语音播报', 'Automatically speak AI responses')}
                </div>
              </div>
              <button
                onClick={() => handleAutoSpeakChange(!autoSpeak)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ${autoSpeak ? 'bg-accent' : 'bg-border/60'}`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-200 ${autoSpeak ? 'translate-x-6' : 'translate-x-1'}`}
                />
              </button>
            </div>
          </div>

        </>
      )}

      {/* ============ 底部弹出保存栏（与全局保存栏样式一致） ============ */}
      {isDirty && !isCloudMode && (
        <div className="absolute bottom-6 right-8 left-8 p-4 rounded-xl bg-surface/95 border border-border/60 shadow-lg flex items-center justify-between z-10 transition-all duration-300">
          <span className="text-xs text-text-muted ml-2 font-medium">
            {t('settings.unsavedChanges', language)}
          </span>
          <div className="flex items-center gap-3">
            <button
              onClick={handleReset}
              className="px-4 py-2 rounded-lg text-text-secondary hover:bg-text-primary/[0.05] transition-colors text-sm"
            >
              {t('settings.backToApp', language)}
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="min-w-[140px] px-6 py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-white text-sm font-bold shadow-lg shadow-accent/20 transition-all duration-300 disabled:opacity-50"
            >
              {saving ? t('common.saving', language) : t('common.save', language)}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * 字段布局组件：label + children 竖直排列
 */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[12px] font-bold text-text-secondary uppercase tracking-wider px-0.5">
        {label}
      </label>
      {children}
    </div>
  )
}
