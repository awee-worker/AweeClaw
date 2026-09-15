/**
 * 本地语音引擎设置面板
 *
 * 功能：
 * 1. 模块总开关
 * 2. 引擎优先级配置
 * 3. ASR 引擎配置
 * 4. TTS 引擎配置
 * 5. GPT-SoVITS 引擎配置
 * 6. 模型下载管理
 * 7. 引擎状态显示
 *
 * 设计要点：
 * 1. 默认关闭：遵循 P1 通用要求
 * 2. 引擎优先级：本地优先/云端优先/仅本地/仅云端
 * 3. 模型管理：显示模型状态，支持下载/删除
 * 4. 状态显示：实时显示引擎状态
 *
 * @module settings/tabs/LocalVoiceSettings
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Mic,
  Volume2,
  Loader2,
  Download,
  Trash2,
  RefreshCw,
  Settings,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Cloud,
  Server,
} from 'lucide-react'
import { ToggleSwitch } from '@components/ui'
import { api } from '@renderer/adapters/electronBridge'
import { toast } from '@components/foundation/NotificationProvider'
import { t, type Language } from '@renderer/i18n'

/** 引擎状态 */
type EngineStatus = 'uninitialized' | 'loading' | 'ready' | 'error'

/** 引擎优先级 */
type EnginePriority = 'local-first' | 'cloud-first' | 'local-only' | 'cloud-only'

/** 本地语音配置 */
interface LocalVoiceConfig {
  enabled: boolean
  priority: EnginePriority
  asr: {
    enabled: boolean
    engine: string
    modelName: string
    modelDir: string
    numThreads: number
    language: string
    useItn: boolean
  }
  tts: {
    enabled: boolean
    engine: string
    modelName: string
    modelDir: string
    numThreads: number
    defaultVoice: string
    defaultSpeed: number
  }
  gptSovits: {
    enabled: boolean
    baseUrl: string
    referenceAudioDir: string
    defaultReferenceAudio: string
    defaultLanguage: string
  }
  modelDownloadDir: string
  autoDownloadModels: boolean
  maxConcurrentDownloads: number
}

/** 引擎状态信息 */
interface EngineStatusInfo {
  enabled: boolean
  status: EngineStatus
  engine: string
}

/** 模型元数据 */
interface ModelMetadata {
  id: string
  name: string
  type: 'asr' | 'tts' | 'gpt-sovits'
  version: string
  description: string
  size: number
  downloadUrl: string
  checksum?: string
  checksumType?: 'md5' | 'sha256'
  filename: string
  extractDir?: string
  needExtract: boolean
}

/** 模块状态 */
interface LocalVoiceStatus {
  enabled: boolean
  priority: EnginePriority
  asr: EngineStatusInfo
  tts: EngineStatusInfo
  gptSovits: { status: EngineStatus; enabled: boolean }
}

/** 默认配置 */
const DEFAULT_CONFIG: LocalVoiceConfig = {
  enabled: false,
  priority: 'cloud-first',
  asr: {
    enabled: false,
    engine: 'sherpa-asr',
    modelName: 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue',
    modelDir: '',
    numThreads: 4,
    language: 'auto',
    useItn: true,
  },
  tts: {
    enabled: false,
    engine: 'sherpa-tts',
    modelName: 'MOSS-TTS-Nano-100M-ONNX',
    modelDir: '',
    numThreads: 4,
    defaultVoice: 'Junhao',
    defaultSpeed: 1.0,
  },
  gptSovits: {
    enabled: false,
    baseUrl: 'http://127.0.0.1:9880',
    referenceAudioDir: '',
    defaultReferenceAudio: '',
    defaultLanguage: 'zh',
  },
  modelDownloadDir: '',
  autoDownloadModels: false,
  maxConcurrentDownloads: 2,
}

/** 默认状态 */
const DEFAULT_STATUS: LocalVoiceStatus = {
  enabled: false,
  priority: 'cloud-first',
  asr: { enabled: false, status: 'uninitialized', engine: 'sherpa-asr' },
  tts: { enabled: false, status: 'uninitialized', engine: 'sherpa-tts' },
  gptSovits: { status: 'uninitialized', enabled: false },
}

interface LocalVoiceSettingsProps {
  language: Language
}

export default function LocalVoiceSettings({ language }: LocalVoiceSettingsProps) {
  const [config, setConfig] = useState<LocalVoiceConfig>(DEFAULT_CONFIG)
  const [status, setStatus] = useState<LocalVoiceStatus>(DEFAULT_STATUS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState<string | null>(null)
  const [availableModels, setAvailableModels] = useState<ModelMetadata[]>([])
  const [downloadingModels, setDownloadingModels] = useState<Set<string>>(new Set())

  // 加载配置和状态
  const loadConfigAndStatus = useCallback(async () => {
    try {
      setLoading(true)
      
      // 加载配置
      const configResult = await api.localVoice.getConfig()
      if (configResult.success) {
        setConfig(configResult.data as LocalVoiceConfig)
      }

      // 加载状态
      const statusResult = await api.localVoice.getStatus()
      if (statusResult.success) {
        setStatus(statusResult.data as LocalVoiceStatus)
      }

      // 加载可用模型
      const modelsResult = await api.localVoice.getAvailableModels()
      if (modelsResult.success) {
        setAvailableModels(modelsResult.data as ModelMetadata[])
      }
    } catch (err) {
      console.error('[LocalVoiceSettings] Load failed:', err)
      toast.error(t('provider.localVoice.loadFailed', language))
    } finally {
      setLoading(false)
    }
  }, [language])

  useEffect(() => {
    loadConfigAndStatus()
  }, [loadConfigAndStatus])

  // 保存配置
  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      const result = await api.localVoice.updateConfig(config)
      if (result.success) {
        toast.success(t('provider.localVoice.saveSuccess', language))
        // 重新加载状态
        const statusResult = await api.localVoice.getStatus()
        if (statusResult.success) {
          setStatus(statusResult.data as LocalVoiceStatus)
        }
      } else {
        toast.error(result.error || t('provider.localVoice.saveFailed', language))
      }
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSaving(false)
    }
  }, [config, language])

  // 重置配置
  const handleReset = useCallback(async () => {
    try {
      const result = await api.localVoice.resetConfig()
      if (result.success) {
        setConfig(result.data as LocalVoiceConfig)
        toast.success(t('provider.localVoice.resetSuccess', language))
      }
    } catch (err) {
      toast.error((err as Error).message)
    }
  }, [language])

  // 更新配置字段
  const updateConfig = useCallback((field: string, value: any) => {
    setConfig(prev => {
      const keys = field.split('.')
      if (keys.length === 1) {
        return { ...prev, [field]: value }
      } else if (keys.length === 2) {
        const [section, key] = keys
        return {
          ...prev,
          [section]: {
            ...(prev[section as keyof LocalVoiceConfig] as any),
            [key]: value,
          },
        }
      }
      return prev
    })
  }, [])

  // 测试引擎
  const handleTest = useCallback(async (engineType: 'asr' | 'tts' | 'gpt-sovits') => {
    setTesting(engineType)
    try {
      let result
      if (engineType === 'asr') {
        result = await api.localVoice.initializeAsr()
      } else if (engineType === 'tts') {
        result = await api.localVoice.initializeTts()
      } else {
        result = await api.localVoice.initializeGptSovits()
      }

      if (result.success) {
        toast.success(t(`provider.localVoice.${engineType}TestSuccess`, language))
        // 重新加载状态
        const statusResult = await api.localVoice.getStatus()
        if (statusResult.success) {
          setStatus(statusResult.data as LocalVoiceStatus)
        }
        if (statusResult.success) {
          setStatus(statusResult.data)
        }
      } else {
        toast.error(result.error || t(`provider.localVoice.${engineType}TestFailed`, language))
      }
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setTesting(null)
    }
  }, [language])

  // 下载模型
  const handleDownloadModel = useCallback(async (modelId: string) => {
    setDownloadingModels(prev => new Set(prev).add(modelId))
    
    try {
      const result = await api.localVoice.downloadModel({ modelId })
      if (result.success) {
        toast.success(t('provider.localVoice.downloadSuccess', language))
      } else {
        toast.error(result.error || t('provider.localVoice.downloadFailed', language))
      }
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setDownloadingModels(prev => {
        const next = new Set(prev)
        next.delete(modelId)
        return next
      })
    }
  }, [language])

  // 取消下载
  const handleCancelDownload = useCallback(async (modelId: string) => {
    try {
      await api.localVoice.cancelDownload({ modelId })
      toast.success(t('provider.localVoice.downloadCancelled', language))
    } catch (err) {
      toast.error((err as Error).message)
    }
  }, [language])

  // 格式化文件大小
  const formatSize = useCallback((bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
  }, [])

  // 获取状态图标
  const getStatusIcon = useCallback((status: EngineStatus) => {
    switch (status) {
      case 'ready':
        return <CheckCircle className="w-4 h-4 text-green-500" />
      case 'loading':
        return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
      case 'error':
        return <XCircle className="w-4 h-4 text-red-500" />
      default:
        return <AlertTriangle className="w-4 h-4 text-text-muted" />
    }
  }, [])

  // 获取状态文本
  const getStatusText = useCallback((status: EngineStatus) => {
    switch (status) {
      case 'ready':
        return t('provider.localVoice.statusReady', language)
      case 'loading':
        return t('provider.localVoice.statusLoading', language)
      case 'error':
        return t('provider.localVoice.statusError', language)
      default:
        return t('provider.localVoice.statusUninitialized', language)
    }
  }, [language])

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        <span className="ml-2 text-text-secondary">{t('provider.localVoice.loading', language)}</span>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* 模块总开关 */}
      <div className="flex items-center justify-between p-4 bg-surface/70 rounded-lg border border-border/40">
        <div>
          <h3 className="text-lg font-medium text-text-primary">
            {t('provider.localVoice.title', language)}
          </h3>
          <p className="text-sm text-text-muted">
            {t('provider.localVoice.description', language)}
          </p>
        </div>
        <ToggleSwitch
          checked={config.enabled}
          onChange={(checked) => updateConfig('enabled', checked)}
        />
      </div>

      {config.enabled && (
        <>
          {/* 引擎优先级 */}
          <div className="p-4 bg-surface/70 rounded-lg border border-border/40">
            <h4 className="font-medium text-text-primary mb-3">
              {t('provider.localVoice.priorityTitle', language)}
            </h4>
            <div className="grid grid-cols-2 gap-3">
              {(['local-first', 'cloud-first', 'local-only', 'cloud-only'] as EnginePriority[]).map((priority) => (
                <button
                  key={priority}
                  className={`p-3 rounded-lg border text-left transition-colors ${
                    config.priority === priority
                      ? 'border-accent bg-accent/10 text-text-primary shadow-sm'
                      : 'border-border/50 bg-surface/30 hover:border-accent/30 hover:bg-surface/50'
                  }`}
                  onClick={() => updateConfig('priority', priority)}
                >
                  <div className="flex items-center gap-2">
                    {priority.includes('local') ? (
                      <Server className={`w-4 h-4 ${config.priority === priority ? 'text-accent' : 'text-text-muted'}`} />
                    ) : (
                      <Cloud className={`w-4 h-4 ${config.priority === priority ? 'text-accent' : 'text-text-muted'}`} />
                    )}
                    <span className="font-medium">
                      {t(`provider.localVoice.priority.${priority}`, language)}
                    </span>
                  </div>
                  <p className="text-xs text-text-muted mt-1">
                    {t(`provider.localVoice.priority.${priority}Desc`, language)}
                  </p>
                </button>
              ))}
            </div>
          </div>

          {/* ASR 配置 */}
          <div className="p-4 bg-surface/70 rounded-lg border border-border/40">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <Mic className="w-5 h-5 text-blue-500" />
                <div>
                  <h4 className="font-medium text-text-primary">
                    {t('provider.localVoice.asrTitle', language)}
                  </h4>
                  <p className="text-sm text-text-muted">
                    {t('provider.localVoice.asrDescription', language)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {getStatusIcon(status.asr.status)}
                <span className="text-sm text-text-secondary">
                  {getStatusText(status.asr.status)}
                </span>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-text-primary">
                  {t('provider.localVoice.asrEnabled', language)}
                </span>
                <ToggleSwitch
                  checked={config.asr.enabled}
                  onChange={(checked) => updateConfig('asr.enabled', checked)}
                />
              </div>

              {config.asr.enabled && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-text-primary mb-1">
                      {t('provider.localVoice.asrModel', language)}
                    </label>
                    <select
                      value={config.asr.modelName}
                      onChange={(e) => updateConfig('asr.modelName', e.target.value)}
                      className="w-full p-2 border border-border rounded-md"
                    >
                      <option value="sherpa-onnx-sense-voice-zh-en-ja-ko-yue">
                        Sherpa-ONNX SenseVoice (中英日韩粤)
                      </option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-text-primary mb-1">
                      {t('provider.localVoice.asrLanguage', language)}
                    </label>
                    <select
                      value={config.asr.language}
                      onChange={(e) => updateConfig('asr.language', e.target.value)}
                      className="w-full p-2 border border-border rounded-md"
                    >
                      <option value="auto">{t('provider.localVoice.languageAuto', language)}</option>
                      <option value="zh">{t('provider.localVoice.languageZh', language)}</option>
                      <option value="en">{t('provider.localVoice.languageEn', language)}</option>
                      <option value="ja">{t('provider.localVoice.languageJa', language)}</option>
                      <option value="ko">{t('provider.localVoice.languageKo', language)}</option>
                      <option value="yue">{t('provider.localVoice.languageYue', language)}</option>
                    </select>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-text-primary">
                      {t('provider.localVoice.asrItn', language)}
                    </span>
                    <ToggleSwitch
                      checked={config.asr.useItn}
                      onChange={(checked) => updateConfig('asr.useItn', checked)}
                    />
                  </div>

                  <button
                    className="w-full py-2 px-4 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50"
                    onClick={() => handleTest('asr')}
                    disabled={testing === 'asr'}
                  >
                    {testing === 'asr' ? (
                      <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                    ) : (
                      t('provider.localVoice.testAsr', language)
                    )}
                  </button>
                </>
              )}
            </div>
          </div>

          {/* TTS 配置 */}
          <div className="p-4 bg-surface/70 rounded-lg border border-border/40">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <Volume2 className="w-5 h-5 text-green-500" />
                <div>
                  <h4 className="font-medium text-text-primary">
                    {t('provider.localVoice.ttsTitle', language)}
                  </h4>
                  <p className="text-sm text-text-muted">
                    {t('provider.localVoice.ttsDescription', language)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {getStatusIcon(status.tts.status)}
                <span className="text-sm text-text-secondary">
                  {getStatusText(status.tts.status)}
                </span>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-text-primary">
                  {t('provider.localVoice.ttsEnabled', language)}
                </span>
                <ToggleSwitch
                  checked={config.tts.enabled}
                  onChange={(checked) => updateConfig('tts.enabled', checked)}
                />
              </div>

              {config.tts.enabled && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-text-primary mb-1">
                      {t('provider.localVoice.ttsModel', language)}
                    </label>
                    <select
                      value={config.tts.modelName}
                      onChange={(e) => updateConfig('tts.modelName', e.target.value)}
                      className="w-full p-2 border border-border rounded-md"
                    >
                      <option value="MOSS-TTS-Nano-100M-ONNX">
                        MOSS TTS Nano (轻量级)
                      </option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-text-primary mb-1">
                      {t('provider.localVoice.ttsVoice', language)}
                    </label>
                    <select
                      value={config.tts.defaultVoice}
                      onChange={(e) => updateConfig('tts.defaultVoice', e.target.value)}
                      className="w-full p-2 border border-border rounded-md"
                    >
                      <option value="Junhao">Junhao (男声)</option>
                      <option value="Xiaoxiao">Xiaoxiao (女声)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-text-primary mb-1">
                      {t('provider.localVoice.ttsSpeed', language)}: {config.tts.defaultSpeed.toFixed(1)}x
                    </label>
                    <input
                      type="range"
                      min="0.5"
                      max="2.0"
                      step="0.1"
                      value={config.tts.defaultSpeed}
                      onChange={(e) => updateConfig('tts.defaultSpeed', parseFloat(e.target.value))}
                      className="w-full"
                    />
                  </div>

                  <button
                    className="w-full py-2 px-4 bg-green-500 text-white rounded-md hover:bg-green-600 disabled:opacity-50"
                    onClick={() => handleTest('tts')}
                    disabled={testing === 'tts'}
                  >
                    {testing === 'tts' ? (
                      <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                    ) : (
                      t('provider.localVoice.testTts', language)
                    )}
                  </button>
                </>
              )}
            </div>
          </div>

          {/* GPT-SoVITS 配置 */}
          <div className="p-4 bg-surface/70 rounded-lg border border-border/40">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <Settings className="w-5 h-5 text-purple-500" />
                <div>
                  <h4 className="font-medium text-text-primary">
                    {t('provider.localVoice.gptSovitsTitle', language)}
                  </h4>
                  <p className="text-sm text-text-muted">
                    {t('provider.localVoice.gptSovitsDescription', language)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {getStatusIcon(status.gptSovits.status)}
                <span className="text-sm text-text-secondary">
                  {getStatusText(status.gptSovits.status)}
                </span>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-text-primary">
                  {t('provider.localVoice.gptSovitsEnabled', language)}
                </span>
                <ToggleSwitch
                  checked={config.gptSovits.enabled}
                  onChange={(checked) => updateConfig('gptSovits.enabled', checked)}
                />
              </div>

              {config.gptSovits.enabled && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-text-primary mb-1">
                      {t('provider.localVoice.gptSovitsUrl', language)}
                    </label>
                    <input
                      type="text"
                      value={config.gptSovits.baseUrl}
                      onChange={(e) => updateConfig('gptSovits.baseUrl', e.target.value)}
                      placeholder="http://127.0.0.1:9880"
                      className="w-full p-2 border border-border rounded-md"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-text-primary mb-1">
                      {t('provider.localVoice.gptSovitsLanguage', language)}
                    </label>
                    <select
                      value={config.gptSovits.defaultLanguage}
                      onChange={(e) => updateConfig('gptSovits.defaultLanguage', e.target.value)}
                      className="w-full p-2 border border-border rounded-md"
                    >
                      <option value="zh">中文</option>
                      <option value="en">English</option>
                      <option value="ja">日本語</option>
                    </select>
                  </div>

                  <button
                    className="w-full py-2 px-4 bg-purple-500 text-white rounded-md hover:bg-purple-600 disabled:opacity-50"
                    onClick={() => handleTest('gpt-sovits')}
                    disabled={testing === 'gpt-sovits'}
                  >
                    {testing === 'gpt-sovits' ? (
                      <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                    ) : (
                      t('provider.localVoice.testGptSovits', language)
                    )}
                  </button>
                </>
              )}
            </div>
          </div>

          {/* 模型管理 */}
          <div className="p-4 bg-surface/70 rounded-lg border border-border/40">
            <h4 className="font-medium text-text-primary mb-4">
              {t('provider.localVoice.modelManagement', language)}
            </h4>

            <div className="space-y-3">
              {availableModels.map((model) => (
                <div key={model.id} className="flex items-center justify-between p-3 bg-surface-hover rounded-lg">
                  <div>
                    <h5 className="font-medium text-text-primary">{model.name}</h5>
                    <p className="text-sm text-text-muted">{model.description}</p>
                    <p className="text-xs text-text-muted">
                      {formatSize(model.size)} • {model.type.toUpperCase()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {downloadingModels.has(model.id) ? (
                      <button
                        className="px-3 py-1 text-sm bg-red-500 text-white rounded-md hover:bg-red-600"
                        onClick={() => handleCancelDownload(model.id)}
                      >
                        {t('provider.localVoice.cancelDownload', language)}
                      </button>
                    ) : (
                      <button
                        className="px-3 py-1 text-sm bg-blue-500 text-white rounded-md hover:bg-blue-600"
                        onClick={() => handleDownloadModel(model.id)}
                      >
                        <Download className="w-4 h-4 inline mr-1" />
                        {t('provider.localVoice.download', language)}
                      </button>
                    )}
                  </div>
                </div>
              ))}

              {availableModels.length === 0 && (
                <p className="text-sm text-text-muted text-center py-4">
                  {t('provider.localVoice.noModels', language)}
                </p>
              )}
            </div>
          </div>

          {/* 保存按钮 */}
          <div className="flex justify-end gap-3">
            <button
              className="px-4 py-2 text-text-primary bg-surface-hover rounded-md hover:bg-gray-200"
              onClick={handleReset}
            >
              {t('provider.localVoice.reset', language)}
            </button>
            <button
              className="px-4 py-2 text-white bg-blue-500 rounded-md hover:bg-blue-600 disabled:opacity-50"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin inline mr-1" />
              ) : null}
              {t('provider.localVoice.save', language)}
            </button>
          </div>
        </>
      )}
    </div>
  )
}