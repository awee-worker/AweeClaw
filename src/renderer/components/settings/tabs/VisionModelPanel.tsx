/**
 * 视觉模型配置面板
 *
 * 独立于聊天模型，专门用于桌面视觉智能体（Visual Agent）的模型配置。
 *
 * 运行模式：
 * - 云端模式：使用后端 SystemConfigService 配置的视觉模型，客户端无需配置
 * - 自定义模式：使用本地 vision_model_config 表存储的独立视觉模型配置
 *
 * 配置优先级（在 resolveActiveLLMConfig 中实现）：
 * 1. 云端模式 → 转发到后端 /api/v1/llm/vision/chat/completions
 * 2. 自定义模式 + 视觉模型已启用 → 使用本地视觉模型配置
 * 3. 自定义模式 + 视觉模型未启用 → 回退到当前活跃的聊天模型
 */

import { memo, useState, useEffect, useCallback } from 'react'
import { Eye, EyeOff, Eye as EyeIcon, Server, Cloud, Check } from 'lucide-react'
import { ActionButton, TextField, ToggleSwitch } from '@components/ui'
import { api } from '@renderer/adapters/electronBridge'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { PROVIDERS, getBuiltinProviderIds, type ApiProtocol, type OpenAICompatibilityProfile, resolveOpenAICompatibilityProfile } from '@configuration/aiProviders'
import { toast } from '@components/foundation/NotificationProvider'
import { t, type Language } from '@renderer/i18n'

const BUILTIN_PROVIDER_IDS = getBuiltinProviderIds()

const PROTOCOL_OPTIONS = [
  { value: 'openai', label: 'OpenAI Compatible' },
  { value: 'openai-responses', label: 'OpenAI Responses API' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'google', label: 'Google' },
]

interface VisionModelConfig {
  provider: string
  model: string
  apiKey: string
  baseUrl: string
  timeout: number
  protocol: string
  openAICompatibilityProfile: string
  headers: Record<string, string>
  enabled: boolean
}

const DEFAULT_CONFIG: VisionModelConfig = {
  provider: 'openai',
  model: 'gpt-4o',
  apiKey: '',
  baseUrl: '',
  timeout: 120000,
  protocol: 'openai',
  openAICompatibilityProfile: 'full',
  headers: {},
  enabled: false,
}

export const VisionModelPanel = memo(function VisionModelPanel({ language }: { language: Language }) {
  const { cloudMode, isAuthenticated } = useStore(
    useShallow((s) => ({
      cloudMode: s.cloudMode,
      isAuthenticated: s.isAuthenticated,
    })),
  )
  const isCloudMode = cloudMode === 'cloud'

  const [config, setConfig] = useState<VisionModelConfig>(DEFAULT_CONFIG)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)
  const [backendVisionModel, setBackendVisionModel] = useState<{ provider: string; model: string } | null>(null)

  // 加载本地视觉模型配置
  const loadConfig = useCallback(async () => {
    try {
      const result = await api.settings.dbGetVisionModelConfig()
      if (result) {
        setConfig({ ...DEFAULT_CONFIG, ...result })
      }
    } catch (err) {
      console.error('[VisionModelPanel] Load config failed:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  // 云端模式下查询后端视觉模型配置
  const loadBackendVisionModel = useCallback(async () => {
    if (!isCloudMode || !isAuthenticated) {
      setBackendVisionModel(null)
      return
    }
    try {
      const serverUrl = (await import('@services/backendApi')).getServerUrl()
      const tokens = (await import('@services/backendApi')).getTokens()
      const res = await fetch(`${serverUrl}/api/v1/llm/vision/model`, {
        headers: { Authorization: `Bearer ${tokens?.accessToken || ''}` },
      })
      if (res.ok) {
        const data = await res.json()
        setBackendVisionModel(data)
      }
    } catch (err) {
      console.error('[VisionModelPanel] Load backend vision model failed:', err)
    }
  }, [isCloudMode, isAuthenticated])

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  useEffect(() => {
    loadBackendVisionModel()
  }, [loadBackendVisionModel])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      const result = await api.settings.dbSaveVisionModelConfig(config)
      if (result.success) {
        toast.success(t('provider.visionModel.saveSuccess', language))
      } else {
        toast.error(result.error || t('provider.visionModel.saveFailed', language))
      }
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSaving(false)
    }
  }, [config, language])

  const handleToggleEnabled = useCallback(async (enabled: boolean) => {
    setConfig((prev) => ({ ...prev, enabled }))
    try {
      await api.settings.dbSetVisionModelEnabled(enabled)
    } catch (err) {
      console.error('[VisionModelPanel] Toggle enabled failed:', err)
    }
  }, [])

  const updateField = useCallback(<K extends keyof VisionModelConfig>(field: K, value: VisionModelConfig[K]) => {
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
      <div className="relative">
        {/* 标题 */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-accent/10 rounded-md text-accent">
              <EyeIcon className="w-3.5 h-3.5" />
            </div>
            <div>
              <h5 className="text-sm font-semibold text-text-primary">
                {t('provider.visionModel.title', language)}
              </h5>
              <p className="text-[10px] text-text-muted mt-0.5">
                {t('provider.visionModel.description', language)}
              </p>
            </div>
          </div>
          {!isCloudMode && (
            <ToggleSwitch
              checked={config.enabled}
              switchSize="sm"
              onChange={(e) => handleToggleEnabled(e.target.checked)}
            />
          )}
        </div>

        {/* 云端模式提示 */}
        {isCloudMode ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 p-3 rounded-lg bg-accent/5 border border-accent/20">
              <Cloud className="w-4 h-4 text-accent shrink-0" />
              <div className="text-xs">
                <p className="text-text-primary font-medium">
                  {t('provider.visionModel.cloudMode', language)}
                </p>
                <p className="text-text-muted mt-0.5">
                  {t('provider.visionModel.cloudModeDesc', language)}
                </p>
              </div>
            </div>
            {backendVisionModel && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-surface/30 border border-border/30">
                <Check className="w-3.5 h-3.5 text-green-500 shrink-0" />
                <div className="text-xs">
                  <span className="text-text-muted">{t('provider.visionModel.backendConfig', language)}: </span>
                  <span className="text-text-primary font-mono">{backendVisionModel.provider} / {backendVisionModel.model}</span>
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* 未启用时的提示 */}
            {!config.enabled ? (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-surface-active/30 border border-border/30">
                <Server className="w-3.5 h-3.5 text-text-muted shrink-0" />
                <p className="text-[11px] text-text-muted">
                  {t('provider.visionModel.disabledHint', language)}
                </p>
              </div>
            ) : (
              /* 启用后才显示的配置表单 */
              <div className="space-y-4">
                {/* Provider 选择 */}
                <div className="space-y-2">
                  <label className="text-[12px] font-bold text-text-secondary uppercase tracking-wider px-0.5">
                    {t('provider.visionModel.provider', language)}
                  </label>
                  <select
                    value={config.provider}
                    onChange={(e) => {
                      const provider = e.target.value
                      const protocol = PROVIDERS[provider]?.protocol || 'openai'
                      const profile = resolveOpenAICompatibilityProfile(provider, protocol as ApiProtocol, undefined) || 'full'
                      updateField('provider', provider)
                      updateField('protocol', protocol)
                      updateField('openAICompatibilityProfile', profile)
                    }}
                    className="w-full bg-background/50 border border-border rounded-lg px-3 py-2 text-xs text-text-primary focus:border-accent/50 focus:ring-1 focus:ring-accent/20 outline-none"
                  >
                    {BUILTIN_PROVIDER_IDS.map((id) => (
                      <option key={id} value={id}>
                        {PROVIDERS[id]?.displayName || id}
                      </option>
                    ))}
                  </select>
                </div>

              {/* 模型名称 */}
              <div className="space-y-2">
                <label className="text-[12px] font-bold text-text-secondary uppercase tracking-wider px-0.5">
                  {t('provider.visionModel.model', language)}
                </label>
                <input
                  type="text"
                  value={config.model}
                  onChange={(e) => updateField('model', e.target.value)}
                  placeholder="gpt-4o"
                  className="w-full bg-background/50 border border-border rounded-lg px-3 py-2 text-xs text-text-primary font-mono focus:border-accent/50 focus:ring-1 focus:ring-accent/20 outline-none"
                />
              </div>

              {/* API Key */}
              <div className="space-y-2">
                <label className="text-[12px] font-bold text-text-secondary uppercase tracking-wider px-0.5">
                  API Key
                </label>
                <div className="relative">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    value={config.apiKey}
                    onChange={(e) => updateField('apiKey', e.target.value)}
                    placeholder="sk-..."
                    className="w-full bg-background/50 border border-border rounded-lg px-3 py-2 pr-9 text-xs text-text-primary font-mono focus:border-accent/50 focus:ring-1 focus:ring-accent/20 outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                  >
                    {showApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {/* Base URL */}
              <div className="space-y-2">
                <label className="text-[12px] font-bold text-text-secondary uppercase tracking-wider px-0.5">
                  {t('provider.visionModel.baseUrl', language)}
                </label>
                <input
                  type="text"
                  value={config.baseUrl}
                  onChange={(e) => updateField('baseUrl', e.target.value)}
                  placeholder="https://api.openai.com/v1"
                  className="w-full bg-background/50 border border-border rounded-lg px-3 py-2 text-xs text-text-primary font-mono focus:border-accent/50 focus:ring-1 focus:ring-accent/20 outline-none"
                />
              </div>

              {/* 保存按钮 */}
              <div className="flex justify-end pt-2">
                <ActionButton
                  onClick={handleSave}
                  disabled={saving || !config.provider || !config.model}
                  variant="primary"
                  size="sm"
                >
                  {saving ? t('common.saving', language) : t('common.save', language)}
                </ActionButton>
              </div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
})
