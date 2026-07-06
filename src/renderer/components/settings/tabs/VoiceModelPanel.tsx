/**
 * 语音模型配置面板
 *
 * 独立于聊天模型，专门用于语音识别（STT）和语音合成（TTS）的模型配置。
 *
 * 运行模式：
 * - 云端模式：使用后端 VoiceService 配置的语音服务，调用会计入 Token 配额
 * - 自定义模式：使用本地 voice_model_config 表存储的独立语音模型配置
 *   - STT 和 TTS 分别可启用，互不影响
 *   - 仅支持 OpenAI 兼容协议（Whisper / TTS）
 *
 * 配置优先级（在 voiceApi.ts 中实现）：
 * 1. 云端模式 → 转发到后端 /api/v1/voice/*
 * 2. 自定义模式 + 语音模型已启用 → 使用本地配置直连 Provider
 * 3. 自定义模式 + 未启用 → 抛出错误，提示用户配置
 */

import { memo, useState, useEffect, useCallback } from 'react'
import { Eye, EyeOff, AudioWaveform, Mic, Volume2, Cloud, Server } from 'lucide-react'
import { ActionButton, ToggleSwitch } from '@components/ui'
import { api } from '@renderer/adapters/electronBridge'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { toast } from '@components/foundation/NotificationProvider'
import { t, type Language } from '@renderer/i18n'

interface VoiceModelConfig {
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
}

const DEFAULT_CONFIG: VoiceModelConfig = {
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
}

export const VoiceModelPanel = memo(function VoiceModelPanel({ language }: { language: Language }) {
  const { cloudMode } = useStore(
    useShallow((s) => ({
      cloudMode: s.cloudMode,
    })),
  )
  const isCloudMode = cloudMode === 'cloud'

  const [config, setConfig] = useState<VoiceModelConfig>(DEFAULT_CONFIG)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showSttKey, setShowSttKey] = useState(false)
  const [showTtsKey, setShowTtsKey] = useState(false)

  // 加载本地语音模型配置
  const loadConfig = useCallback(async () => {
    try {
      const result = await api.settings.dbGetVoiceModelConfig()
      if (result) {
        setConfig({ ...DEFAULT_CONFIG, ...result })
      }
    } catch (err) {
      console.error('[VoiceModelPanel] Load config failed:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      const result = await api.settings.dbSaveVoiceModelConfig(config)
      if (result.success) {
        toast.success(t('provider.voiceModel.saveSuccess', language))
      } else {
        toast.error(result.error || t('provider.voiceModel.saveFailed', language))
      }
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSaving(false)
    }
  }, [config, language])

  const handleToggleStt = useCallback(async (enabled: boolean) => {
    setConfig((prev) => ({ ...prev, sttEnabled: enabled }))
    try {
      await api.settings.dbSetVoiceModelEnabled({ sttEnabled: enabled, ttsEnabled: config.ttsEnabled })
    } catch (err) {
      console.error('[VoiceModelPanel] Toggle STT failed:', err)
    }
  }, [config.ttsEnabled])

  const handleToggleTts = useCallback(async (enabled: boolean) => {
    setConfig((prev) => ({ ...prev, ttsEnabled: enabled }))
    try {
      await api.settings.dbSetVoiceModelEnabled({ sttEnabled: config.sttEnabled, ttsEnabled: enabled })
    } catch (err) {
      console.error('[VoiceModelPanel] Toggle TTS failed:', err)
    }
  }, [config.sttEnabled])

  const updateSttField = useCallback(<K extends keyof VoiceModelConfig>(field: K, value: VoiceModelConfig[K]) => {
    setConfig((prev) => ({ ...prev, [field]: value }))
  }, [])

  const updateTtsField = useCallback(<K extends keyof VoiceModelConfig>(field: K, value: VoiceModelConfig[K]) => {
    setConfig((prev) => ({ ...prev, [field]: value }))
  }, [])

  if (loading) {
    return (
      <section className="rounded-2xl border border-border/50 bg-surface/20 p-5 backdrop-blur-xl shadow-sm">
        <div className="animate-pulse text-text-muted text-xs">{t('common.loading', language)}</div>
      </section>
    )
  }

  return (
    <section className="rounded-2xl border border-border/50 bg-surface/20 p-5 backdrop-blur-xl shadow-sm relative overflow-hidden group">
      <div className="absolute inset-0 bg-gradient-to-br from-accent/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
      <div className="relative space-y-5">
        {/* 标题 */}
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-accent/10 rounded-md text-accent">
            <AudioWaveform className="w-3.5 h-3.5" />
          </div>
          <div>
            <h5 className="text-sm font-semibold text-text-primary">
              {t('provider.voiceModel.title', language)}
            </h5>
            <p className="text-[10px] text-text-muted mt-0.5">
              {t('provider.voiceModel.description', language)}
            </p>
          </div>
        </div>

        {/* 云端模式提示 */}
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
            {/* ============ STT 区块 ============ */}
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
                  <div className="space-y-1.5">
                    <label className="text-[12px] font-bold text-text-secondary uppercase tracking-wider px-0.5">
                      {t('provider.voiceModel.provider', language)}
                    </label>
                    <select
                      value={config.sttProvider}
                      onChange={(e) => updateSttField('sttProvider', e.target.value)}
                      className="w-full bg-background/50 border border-border rounded-lg px-3 py-2 text-xs text-text-primary focus:border-accent/50 focus:ring-1 focus:ring-accent/20 outline-none"
                    >
                      <option value="openai">OpenAI</option>
                      <option value="azure">Azure OpenAI</option>
                      <option value="aliyun">Aliyun (DashScope)</option>
                      <option value="custom">Custom (OpenAI Compatible)</option>
                    </select>
                  </div>

                  {/* Model */}
                  <div className="space-y-1.5">
                    <label className="text-[12px] font-bold text-text-secondary uppercase tracking-wider px-0.5">
                      {t('provider.voiceModel.model', language)}
                    </label>
                    <input
                      type="text"
                      value={config.sttModel}
                      onChange={(e) => updateSttField('sttModel', e.target.value)}
                      placeholder="whisper-1"
                      className="w-full bg-background/50 border border-border rounded-lg px-3 py-2 text-xs text-text-primary font-mono focus:border-accent/50 focus:ring-1 focus:ring-accent/20 outline-none"
                    />
                  </div>

                  {/* API Key */}
                  <div className="space-y-1.5">
                    <label className="text-[12px] font-bold text-text-secondary uppercase tracking-wider px-0.5">
                      {t('provider.voiceModel.apiKey', language)}
                    </label>
                    <div className="relative">
                      <input
                        type={showSttKey ? 'text' : 'password'}
                        value={config.sttApiKey}
                        onChange={(e) => updateSttField('sttApiKey', e.target.value)}
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
                  </div>

                  {/* Base URL */}
                  <div className="space-y-1.5">
                    <label className="text-[12px] font-bold text-text-secondary uppercase tracking-wider px-0.5">
                      {t('provider.voiceModel.baseUrl', language)}
                    </label>
                    <input
                      type="text"
                      value={config.sttBaseUrl}
                      onChange={(e) => updateSttField('sttBaseUrl', e.target.value)}
                      placeholder="https://api.openai.com/v1"
                      className="w-full bg-background/50 border border-border rounded-lg px-3 py-2 text-xs text-text-primary font-mono focus:border-accent/50 focus:ring-1 focus:ring-accent/20 outline-none"
                    />
                  </div>

                  {/* Recognition Language */}
                  <div className="space-y-1.5">
                    <label className="text-[12px] font-bold text-text-secondary uppercase tracking-wider px-0.5">
                      {t('provider.voiceModel.language', language)}
                    </label>
                    <select
                      value={config.sttLanguage}
                      onChange={(e) => updateSttField('sttLanguage', e.target.value)}
                      className="w-full bg-background/50 border border-border rounded-lg px-3 py-2 text-xs text-text-primary focus:border-accent/50 focus:ring-1 focus:ring-accent/20 outline-none"
                    >
                      <option value="auto">{t('provider.voiceModel.languageAuto', language)}</option>
                      <option value="zh">{t('provider.voiceModel.languageZh', language)}</option>
                      <option value="en">{t('provider.voiceModel.languageEn', language)}</option>
                      <option value="ja">{t('provider.voiceModel.languageJa', language)}</option>
                    </select>
                  </div>
                </div>
              )}
            </div>

            {/* ============ TTS 区块 ============ */}
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
                  <div className="space-y-1.5">
                    <label className="text-[12px] font-bold text-text-secondary uppercase tracking-wider px-0.5">
                      {t('provider.voiceModel.provider', language)}
                    </label>
                    <select
                      value={config.ttsProvider}
                      onChange={(e) => updateTtsField('ttsProvider', e.target.value)}
                      className="w-full bg-background/50 border border-border rounded-lg px-3 py-2 text-xs text-text-primary focus:border-accent/50 focus:ring-1 focus:ring-accent/20 outline-none"
                    >
                      <option value="openai">OpenAI</option>
                      <option value="azure">Azure OpenAI</option>
                      <option value="aliyun">Aliyun (DashScope)</option>
                      <option value="custom">Custom (OpenAI Compatible)</option>
                    </select>
                  </div>

                  {/* Model */}
                  <div className="space-y-1.5">
                    <label className="text-[12px] font-bold text-text-secondary uppercase tracking-wider px-0.5">
                      {t('provider.voiceModel.model', language)}
                    </label>
                    <input
                      type="text"
                      value={config.ttsModel}
                      onChange={(e) => updateTtsField('ttsModel', e.target.value)}
                      placeholder="tts-1"
                      className="w-full bg-background/50 border border-border rounded-lg px-3 py-2 text-xs text-text-primary font-mono focus:border-accent/50 focus:ring-1 focus:ring-accent/20 outline-none"
                    />
                  </div>

                  {/* Voice */}
                  <div className="space-y-1.5">
                    <label className="text-[12px] font-bold text-text-secondary uppercase tracking-wider px-0.5">
                      {t('provider.voiceModel.voice', language)}
                    </label>
                    <input
                      type="text"
                      value={config.ttsVoice}
                      onChange={(e) => updateTtsField('ttsVoice', e.target.value)}
                      placeholder="alloy"
                      className="w-full bg-background/50 border border-border rounded-lg px-3 py-2 text-xs text-text-primary font-mono focus:border-accent/50 focus:ring-1 focus:ring-accent/20 outline-none"
                    />
                  </div>

                  {/* API Key */}
                  <div className="space-y-1.5">
                    <label className="text-[12px] font-bold text-text-secondary uppercase tracking-wider px-0.5">
                      {t('provider.voiceModel.apiKey', language)}
                    </label>
                    <div className="relative">
                      <input
                        type={showTtsKey ? 'text' : 'password'}
                        value={config.ttsApiKey}
                        onChange={(e) => updateTtsField('ttsApiKey', e.target.value)}
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
                  </div>

                  {/* Base URL */}
                  <div className="space-y-1.5">
                    <label className="text-[12px] font-bold text-text-secondary uppercase tracking-wider px-0.5">
                      {t('provider.voiceModel.baseUrl', language)}
                    </label>
                    <input
                      type="text"
                      value={config.ttsBaseUrl}
                      onChange={(e) => updateTtsField('ttsBaseUrl', e.target.value)}
                      placeholder="https://api.openai.com/v1"
                      className="w-full bg-background/50 border border-border rounded-lg px-3 py-2 text-xs text-text-primary font-mono focus:border-accent/50 focus:ring-1 focus:ring-accent/20 outline-none"
                    />
                  </div>

                  {/* Speed */}
                  <div className="space-y-1.5">
                    <label className="text-[12px] font-bold text-text-secondary uppercase tracking-wider px-0.5">
                      {t('provider.voiceModel.speed', language)} ({config.ttsSpeed.toFixed(1)}x)
                    </label>
                    <input
                      type="range"
                      min="0.5"
                      max="2.0"
                      step="0.1"
                      value={config.ttsSpeed}
                      onChange={(e) => updateTtsField('ttsSpeed', parseFloat(e.target.value))}
                      className="w-full accent-accent"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* 保存按钮（任一启用时显示） */}
            {(config.sttEnabled || config.ttsEnabled) && (
              <div className="flex justify-end pt-1">
                <ActionButton
                  onClick={handleSave}
                  disabled={saving}
                  variant="primary"
                  size="sm"
                >
                  {saving ? t('common.saving', language) : t('common.save', language)}
                </ActionButton>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
})
