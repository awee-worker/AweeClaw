/**
 * AudiobookSettings — 有声书设置面板
 *
 * 功能：
 * 1. 模块总开关
 * 2. TTS 引擎配置
 * 3. 音色选择
 * 4. 语速配置
 * 5. 并发数配置
 * 6. 输出格式配置
 *
 * 设计要点：
 * 1. 默认关闭：遵循 P1 通用要求
 * 2. 配置持久化：配置保存到 settings-db
 * 3. 实时预览：配置变更实时生效
 *
 * @module components/audiobook/AudiobookSettings
 */

import { useState, useEffect, useCallback } from 'react'
import {
  BookOpen,
  Volume2,
  Settings,
  Loader2,
  AlertTriangle,
  CheckCircle,
} from 'lucide-react'
import { ToggleSwitch } from '@components/ui'
import { api } from '@renderer/adapters/electronBridge'
import { toast } from '@components/foundation/NotificationProvider'
import { t, type Language } from '@renderer/i18n'

// ============================================
// 类型定义
// ============================================

/** TTS 引擎类型 */
type TtsEngineType = 'cloud' | 'local-sherpa' | 'local-gpt-sovits'

/** 有声书配置 */
interface AudiobookConfig {
  enabled: boolean
  defaultEngine: TtsEngineType
  defaultVoice: string
  defaultSpeed: number
  defaultConcurrency: number
  defaultFormat: 'mp3' | 'wav'
  defaultMaxSegmentLength: number
  defaultMaxRetries: number
  defaultChapterSilenceMs: number
}

// ============================================
// 默认配置
// ============================================

const DEFAULT_CONFIG: AudiobookConfig = {
  enabled: false,
  defaultEngine: 'cloud',
  defaultVoice: '',
  defaultSpeed: 1.0,
  defaultConcurrency: 2,
  defaultFormat: 'mp3',
  defaultMaxSegmentLength: 500,
  defaultMaxRetries: 3,
  defaultChapterSilenceMs: 800,
}

// ============================================
// AudiobookSettings 组件
// ============================================

interface AudiobookSettingsProps {
  language: Language
}

export function AudiobookSettings({ language }: AudiobookSettingsProps) {
  const [config, setConfig] = useState<AudiobookConfig>(DEFAULT_CONFIG)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  // ============================================
  // 配置管理
  // ============================================

  /** 加载配置 */
  const loadConfig = useCallback(async () => {
    try {
      setLoading(true)
      // 从 settings-db 加载配置
      const result = await api.settingsDb.get('audiobook')
      if (result.success && result.data) {
        setConfig({ ...DEFAULT_CONFIG, ...result.data })
      }
    } catch (error) {
      console.error('[AudiobookSettings] 加载配置失败:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  /** 保存配置 */
  const saveConfig = useCallback(async (newConfig: Partial<AudiobookConfig>) => {
    try {
      setSaving(true)
      const updatedConfig = { ...config, ...newConfig }
      setConfig(updatedConfig)

      // 保存到 settings-db
      const result = await api.settingsDb.set('audiobook', updatedConfig)
      if (result.success) {
        toast.success('配置已保存', '有声书配置已更新')
      } else {
        toast.error('保存失败', result.error)
      }
    } catch (error) {
      toast.error('保存失败', error instanceof Error ? error.message : '未知错误')
    } finally {
      setSaving(false)
    }
  }, [config])

  /** 初始化 */
  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  // ============================================
  // 配置变更
  // ============================================

  /** 切换启用状态 */
  const handleToggleEnabled = useCallback(async (enabled: boolean) => {
    await saveConfig({ enabled })
  }, [saveConfig])

  /** 切换引擎 */
  const handleEngineChange = useCallback(async (engine: TtsEngineType) => {
    await saveConfig({ defaultEngine: engine })
  }, [saveConfig])

  /** 切换音色 */
  const handleVoiceChange = useCallback(async (voice: string) => {
    await saveConfig({ defaultVoice: voice })
  }, [saveConfig])

  /** 切换语速 */
  const handleSpeedChange = useCallback(async (speed: number) => {
    await saveConfig({ defaultSpeed: speed })
  }, [saveConfig])

  /** 切换并发数 */
  const handleConcurrencyChange = useCallback(async (concurrency: number) => {
    await saveConfig({ defaultConcurrency: concurrency })
  }, [saveConfig])

  /** 切换输出格式 */
  const handleFormatChange = useCallback(async (format: 'mp3' | 'wav') => {
    await saveConfig({ defaultFormat: format })
  }, [saveConfig])

  /** 切换最大段落长度 */
  const handleMaxSegmentLengthChange = useCallback(async (length: number) => {
    await saveConfig({ defaultMaxSegmentLength: length })
  }, [saveConfig])

  /** 切换最大重试次数 */
  const handleMaxRetriesChange = useCallback(async (retries: number) => {
    await saveConfig({ defaultMaxRetries: retries })
  }, [saveConfig])

  /** 切换章节静音时长 */
  const handleChapterSilenceMsChange = useCallback(async (ms: number) => {
    await saveConfig({ defaultChapterSilenceMs: ms })
  }, [saveConfig])

  // ============================================
  // 渲染
  // ============================================

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* 标题 */}
      <div className="flex items-center gap-2">
        <BookOpen className="w-5 h-5" />
        <h3 className="text-lg font-semibold">有声书设置</h3>
      </div>

      {/* 模块总开关 */}
      <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
        <div>
          <div className="font-medium">启用有声书</div>
          <div className="text-sm text-gray-500">
            开启后可将文档转换为有声书
          </div>
        </div>
        <ToggleSwitch
          checked={config.enabled}
          onChange={handleToggleEnabled}
          disabled={saving}
        />
      </div>

      {/* 配置区域 */}
      {config.enabled && (
        <div className="space-y-4">
          {/* TTS 引擎 */}
          <div className="p-4 border rounded-lg">
            <div className="flex items-center gap-2 mb-4">
              <Volume2 className="w-4 h-4" />
              <div className="font-medium">TTS 引擎</div>
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="engine"
                  value="cloud"
                  checked={config.defaultEngine === 'cloud'}
                  onChange={() => handleEngineChange('cloud')}
                  disabled={saving}
                />
                <span>云端 TTS</span>
                <span className="text-sm text-gray-500">（消耗 API 额度）</span>
              </label>

              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="engine"
                  value="local-sherpa"
                  checked={config.defaultEngine === 'local-sherpa'}
                  onChange={() => handleEngineChange('local-sherpa')}
                  disabled={saving}
                />
                <span>本地 Sherpa TTS</span>
                <span className="text-sm text-gray-500">（需下载模型）</span>
              </label>

              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="engine"
                  value="local-gpt-sovits"
                  checked={config.defaultEngine === 'local-gpt-sovits'}
                  onChange={() => handleEngineChange('local-gpt-sovits')}
                  disabled={saving}
                />
                <span>本地 GPT-SoVITS</span>
                <span className="text-sm text-gray-500">（声音克隆）</span>
              </label>
            </div>
          </div>

          {/* 音色配置 */}
          <div className="p-4 border rounded-lg">
            <div className="flex items-center gap-2 mb-4">
              <Settings className="w-4 h-4" />
              <div className="font-medium">音色配置</div>
            </div>

            <div className="space-y-4">
              {/* 音色选择 */}
              <div>
                <label className="block text-sm font-medium mb-1">默认音色</label>
                <input
                  type="text"
                  value={config.defaultVoice}
                  onChange={(e) => handleVoiceChange(e.target.value)}
                  placeholder="输入音色名称"
                  className="w-full px-3 py-2 border rounded"
                  disabled={saving}
                />
              </div>

              {/* 语速 */}
              <div>
                <label className="block text-sm font-medium mb-1">
                  语速: {config.defaultSpeed.toFixed(1)}x
                </label>
                <input
                  type="range"
                  min="0.5"
                  max="2.0"
                  step="0.1"
                  value={config.defaultSpeed}
                  onChange={(e) => handleSpeedChange(parseFloat(e.target.value))}
                  className="w-full"
                  disabled={saving}
                />
                <div className="flex justify-between text-xs text-gray-500">
                  <span>0.5x</span>
                  <span>1.0x</span>
                  <span>2.0x</span>
                </div>
              </div>
            </div>
          </div>

          {/* 高级配置 */}
          <div className="p-4 border rounded-lg">
            <div className="flex items-center gap-2 mb-4">
              <Settings className="w-4 h-4" />
              <div className="font-medium">高级配置</div>
            </div>

            <div className="space-y-4">
              {/* 并发数 */}
              <div>
                <label className="block text-sm font-medium mb-1">
                  并发数: {config.defaultConcurrency}
                </label>
                <input
                  type="range"
                  min="1"
                  max="5"
                  step="1"
                  value={config.defaultConcurrency}
                  onChange={(e) => handleConcurrencyChange(parseInt(e.target.value))}
                  className="w-full"
                  disabled={saving}
                />
                <div className="flex justify-between text-xs text-gray-500">
                  <span>1</span>
                  <span>2</span>
                  <span>3</span>
                  <span>4</span>
                  <span>5</span>
                </div>
              </div>

              {/* 输出格式 */}
              <div>
                <label className="block text-sm font-medium mb-1">输出格式</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="format"
                      value="mp3"
                      checked={config.defaultFormat === 'mp3'}
                      onChange={() => handleFormatChange('mp3')}
                      disabled={saving}
                    />
                    <span>MP3</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="format"
                      value="wav"
                      checked={config.defaultFormat === 'wav'}
                      onChange={() => handleFormatChange('wav')}
                      disabled={saving}
                    />
                    <span>WAV</span>
                  </label>
                </div>
              </div>

              {/* 最大段落长度 */}
              <div>
                <label className="block text-sm font-medium mb-1">
                  最大段落长度: {config.defaultMaxSegmentLength} 字
                </label>
                <input
                  type="range"
                  min="200"
                  max="1000"
                  step="50"
                  value={config.defaultMaxSegmentLength}
                  onChange={(e) => handleMaxSegmentLengthChange(parseInt(e.target.value))}
                  className="w-full"
                  disabled={saving}
                />
                <div className="flex justify-between text-xs text-gray-500">
                  <span>200</span>
                  <span>500</span>
                  <span>1000</span>
                </div>
              </div>

              {/* 最大重试次数 */}
              <div>
                <label className="block text-sm font-medium mb-1">
                  最大重试次数: {config.defaultMaxRetries}
                </label>
                <input
                  type="range"
                  min="1"
                  max="5"
                  step="1"
                  value={config.defaultMaxRetries}
                  onChange={(e) => handleMaxRetriesChange(parseInt(e.target.value))}
                  className="w-full"
                  disabled={saving}
                />
                <div className="flex justify-between text-xs text-gray-500">
                  <span>1</span>
                  <span>3</span>
                  <span>5</span>
                </div>
              </div>

              {/* 章节静音时长 */}
              <div>
                <label className="block text-sm font-medium mb-1">
                  章节静音时长: {config.defaultChapterSilenceMs}ms
                </label>
                <input
                  type="range"
                  min="0"
                  max="2000"
                  step="100"
                  value={config.defaultChapterSilenceMs}
                  onChange={(e) => handleChapterSilenceMsChange(parseInt(e.target.value))}
                  className="w-full"
                  disabled={saving}
                />
                <div className="flex justify-between text-xs text-gray-500">
                  <span>0ms</span>
                  <span>800ms</span>
                  <span>2000ms</span>
                </div>
              </div>
            </div>
          </div>

          {/* 提示信息 */}
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-blue-500 mt-0.5" />
              <div className="text-sm text-blue-800">
                <p className="font-medium mb-1">使用提示</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>批量 TTS 会消耗大量 API 额度，请谨慎使用</li>
                  <li>建议先小批量测试，确认效果后再批量处理</li>
                  <li>支持断点续传，中断后可继续执行</li>
                  <li>EPUB 解析仅用于用户自有文件</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 保存状态 */}
      {saving && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>保存中...</span>
        </div>
      )}
    </div>
  )
}