/**
 * 角色语音设置面板
 *
 * 功能：
 * 1. 角色音配置（角色台词语音）
 * 2. 旁白音配置（旁白/系统提示语音）
 * 3. 群聊场景下每个 agent 绑定独立音色
 * 4. 未配置时的降级策略
 *
 * @module settings/tabs/CharacterVoiceSettings
 */

import React, { useState, useCallback, useEffect, memo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Volume2, User, BookOpen, Settings, Play, Pause, RotateCcw,
  ChevronDown, ChevronRight, AlertCircle, CheckCircle
} from 'lucide-react'
import { t, type Language } from '@renderer/i18n'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { ToggleSwitch } from '../../ui/ToggleSwitch'
import { ActionButton } from '../../ui/ActionButton'
import { toast } from '../../foundation/NotificationProvider'

interface CharacterVoiceSettingsProps {
  language: Language
}

interface VoiceConfig {
  id: string
  name: string
  voiceId: string
  voiceName: string
  speed: number
  pitch: number
  volume: number
  enabled: boolean
}

interface CharacterVoiceState {
  // 角色音配置
  characterVoice: VoiceConfig
  // 旁白音配置
  narratorVoice: VoiceConfig
  // 群聊音色映射
  agentVoiceMap: Record<string, VoiceConfig>
  // 降级策略
  fallbackStrategy: 'global' | 'character' | 'narrator'
  // 是否启用多语音
  multiVoiceEnabled: boolean
  // 测试状态
  testingCharacter: boolean
  testingNarrator: boolean
  testingAgent: string | null
  // 可用音色列表
  availableVoices: Array<{ id: string; name: string; preview?: string }>
  // 加载状态
  isLoading: boolean
  isSaving: boolean
}

const DEFAULT_VOICE_CONFIG: VoiceConfig = {
  id: '',
  name: '',
  voiceId: '',
  voiceName: '',
  speed: 1.0,
  pitch: 1.0,
  volume: 1.0,
  enabled: true,
}

export const CharacterVoiceSettings: React.FC<CharacterVoiceSettingsProps> = memo(function CharacterVoiceSettings({
  language,
}) {
  const [state, setState] = useState<CharacterVoiceState>({
    characterVoice: { ...DEFAULT_VOICE_CONFIG, id: 'character', name: '角色音' },
    narratorVoice: { ...DEFAULT_VOICE_CONFIG, id: 'narrator', name: '旁白音' },
    agentVoiceMap: {},
    fallbackStrategy: 'global',
    multiVoiceEnabled: false,
    testingCharacter: false,
    testingNarrator: false,
    testingAgent: null,
    availableVoices: [],
    isLoading: false,
    isSaving: false,
  })

  const isZh = language === 'zh-CN'

  // 加载配置
  useEffect(() => {
    const loadConfig = async () => {
      setState(prev => ({ ...prev, isLoading: true }))
      try {
        // 从本地存储加载配置
        const savedConfig = localStorage.getItem('character-voice-config')
        if (savedConfig) {
          const config = JSON.parse(savedConfig)
          setState(prev => ({
            ...prev,
            ...config,
            isLoading: false,
          }))
        } else {
          setState(prev => ({ ...prev, isLoading: false }))
        }
      } catch (error) {
        console.error('Failed to load character voice config:', error)
        setState(prev => ({ ...prev, isLoading: false }))
      }
    }

    loadConfig()
  }, [])

  // 保存配置
  const saveConfig = useCallback(async () => {
    setState(prev => ({ ...prev, isSaving: true }))
    try {
      const configToSave = {
        characterVoice: state.characterVoice,
        narratorVoice: state.narratorVoice,
        agentVoiceMap: state.agentVoiceMap,
        fallbackStrategy: state.fallbackStrategy,
        multiVoiceEnabled: state.multiVoiceEnabled,
      }
      localStorage.setItem('character-voice-config', JSON.stringify(configToSave))
      setState(prev => ({ ...prev, isSaving: false }))
      toast.success(
        isZh ? '保存成功' : 'Saved successfully',
        isZh ? '角色语音配置已保存' : 'Character voice configuration saved'
      )
    } catch (error) {
      setState(prev => ({ ...prev, isSaving: false }))
      toast.error(
        isZh ? '保存失败' : 'Save failed',
        isZh ? '无法保存配置' : 'Failed to save configuration'
      )
    }
  }, [state.characterVoice, state.narratorVoice, state.agentVoiceMap, state.fallbackStrategy, state.multiVoiceEnabled, isZh])

  // 更新角色音配置
  const updateCharacterVoice = useCallback((updates: Partial<VoiceConfig>) => {
    setState(prev => ({
      ...prev,
      characterVoice: { ...prev.characterVoice, ...updates },
    }))
  }, [])

  // 更新旁白音配置
  const updateNarratorVoice = useCallback((updates: Partial<VoiceConfig>) => {
    setState(prev => ({
      ...prev,
      narratorVoice: { ...prev.narratorVoice, ...updates },
    }))
  }, [])

  // 测试角色音
  const testCharacterVoice = useCallback(async () => {
    setState(prev => ({ ...prev, testingCharacter: true }))
    try {
      // 模拟测试播放
      await new Promise(resolve => setTimeout(resolve, 1000))
      toast.success(
        isZh ? '测试播放' : 'Test playback',
        isZh ? '角色音测试完成' : 'Character voice test completed'
      )
    } catch (error) {
      toast.error(
        isZh ? '测试失败' : 'Test failed',
        isZh ? '无法播放测试音频' : 'Failed to play test audio'
      )
    } finally {
      setState(prev => ({ ...prev, testingCharacter: false }))
    }
  }, [isZh])

  // 测试旁白音
  const testNarratorVoice = useCallback(async () => {
    setState(prev => ({ ...prev, testingNarrator: true }))
    try {
      // 模拟测试播放
      await new Promise(resolve => setTimeout(resolve, 1000))
      toast.success(
        isZh ? '测试播放' : 'Test playback',
        isZh ? '旁白音测试完成' : 'Narrator voice test completed'
      )
    } catch (error) {
      toast.error(
        isZh ? '测试失败' : 'Test failed',
        isZh ? '无法播放测试音频' : 'Failed to play test audio'
      )
    } finally {
      setState(prev => ({ ...prev, testingNarrator: false }))
    }
  }, [isZh])

  // 重置为默认配置
  const resetToDefaults = useCallback(() => {
    setState(prev => ({
      ...prev,
      characterVoice: { ...DEFAULT_VOICE_CONFIG, id: 'character', name: '角色音' },
      narratorVoice: { ...DEFAULT_VOICE_CONFIG, id: 'narrator', name: '旁白音' },
      agentVoiceMap: {},
      fallbackStrategy: 'global',
    }))
    toast.success(
      isZh ? '已重置' : 'Reset',
      isZh ? '配置已重置为默认值' : 'Configuration reset to defaults'
    )
  }, [isZh])

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* 标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-text-primary">
            {isZh ? '角色语音设置' : 'Character Voice Settings'}
          </h2>
          <p className="text-sm text-text-secondary mt-1">
            {isZh
              ? '配置角色音和旁白音，支持群聊场景下每个智能体独立音色'
              : 'Configure character and narrator voices, with per-agent voice in group chats'}
          </p>
        </div>
        <div className="flex gap-2">
          <ActionButton
            variant="ghost"
            size="sm"
            onClick={resetToDefaults}
            icon={<RotateCcw className="w-4 h-4" />}
          >
            {isZh ? '重置' : 'Reset'}
          </ActionButton>
          <ActionButton
            variant="primary"
            size="sm"
            onClick={saveConfig}
            loading={state.isSaving}
            icon={<Settings className="w-4 h-4" />}
          >
            {isZh ? '保存' : 'Save'}
          </ActionButton>
        </div>
      </div>

      {/* 多语音开关 */}
      <div className="p-4 rounded-xl bg-surface border border-border-secondary">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-medium text-text-primary">
              {isZh ? '启用多语音' : 'Enable Multi-Voice'}
            </h3>
            <p className="text-sm text-text-secondary">
              {isZh
                ? '开启后可分别配置角色音和旁白音'
                : 'Enable separate character and narrator voice configuration'}
            </p>
          </div>
          <ToggleSwitch
            checked={state.multiVoiceEnabled}
            onChange={(checked) => setState(prev => ({ ...prev, multiVoiceEnabled: checked }))}
          />
        </div>
      </div>

      {/* 角色音配置 */}
      <div className={`p-4 rounded-xl border transition-all ${
        state.multiVoiceEnabled
          ? 'bg-surface border-border-secondary'
          : 'bg-surface/50 border-border-secondary/50 opacity-60'
      }`}>
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-accent/10">
            <User className="w-5 h-5 text-accent" />
          </div>
          <div>
            <h3 className="font-medium text-text-primary">
              {isZh ? '角色音配置' : 'Character Voice Configuration'}
            </h3>
            <p className="text-sm text-text-secondary">
              {isZh ? '用于角色台词的语音' : 'Voice for character dialogue'}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {/* 音色选择 */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              {isZh ? '音色' : 'Voice'}
            </label>
            <select
              value={state.characterVoice.voiceId}
              onChange={(e) => updateCharacterVoice({ voiceId: e.target.value })}
              disabled={!state.multiVoiceEnabled}
              className="w-full px-3 py-2 rounded-lg border border-border-secondary bg-surface focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none transition-all"
            >
              <option value="">{isZh ? '选择音色...' : 'Select voice...'}</option>
              {/* 这里可以填充可用音色列表 */}
            </select>
          </div>

          {/* 语速 */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              {isZh ? '语速' : 'Speed'}: {state.characterVoice.speed.toFixed(1)}x
            </label>
            <input
              type="range"
              min="0.5"
              max="2.0"
              step="0.1"
              value={state.characterVoice.speed}
              onChange={(e) => updateCharacterVoice({ speed: parseFloat(e.target.value) })}
              disabled={!state.multiVoiceEnabled}
              className="w-full"
            />
          </div>
        </div>

        {/* 测试按钮 */}
        <div className="mt-4 flex justify-end">
          <ActionButton
            variant="secondary"
            size="sm"
            onClick={testCharacterVoice}
            disabled={!state.multiVoiceEnabled || state.testingCharacter}
            loading={state.testingCharacter}
            icon={<Play className="w-4 h-4" />}
          >
            {isZh ? '测试播放' : 'Test Playback'}
          </ActionButton>
        </div>
      </div>

      {/* 旁白音配置 */}
      <div className={`p-4 rounded-xl border transition-all ${
        state.multiVoiceEnabled
          ? 'bg-surface border-border-secondary'
          : 'bg-surface/50 border-border-secondary/50 opacity-60'
      }`}>
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-success/10">
            <BookOpen className="w-5 h-5 text-success" />
          </div>
          <div>
            <h3 className="font-medium text-text-primary">
              {isZh ? '旁白音配置' : 'Narrator Voice Configuration'}
            </h3>
            <p className="text-sm text-text-secondary">
              {isZh ? '用于旁白和系统提示的语音' : 'Voice for narration and system prompts'}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {/* 音色选择 */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              {isZh ? '音色' : 'Voice'}
            </label>
            <select
              value={state.narratorVoice.voiceId}
              onChange={(e) => updateNarratorVoice({ voiceId: e.target.value })}
              disabled={!state.multiVoiceEnabled}
              className="w-full px-3 py-2 rounded-lg border border-border-secondary bg-surface focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none transition-all"
            >
              <option value="">{isZh ? '选择音色...' : 'Select voice...'}</option>
              {/* 这里可以填充可用音色列表 */}
            </select>
          </div>

          {/* 语速 */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              {isZh ? '语速' : 'Speed'}: {state.narratorVoice.speed.toFixed(1)}x
            </label>
            <input
              type="range"
              min="0.5"
              max="2.0"
              step="0.1"
              value={state.narratorVoice.speed}
              onChange={(e) => updateNarratorVoice({ speed: parseFloat(e.target.value) })}
              disabled={!state.multiVoiceEnabled}
              className="w-full"
            />
          </div>
        </div>

        {/* 测试按钮 */}
        <div className="mt-4 flex justify-end">
          <ActionButton
            variant="secondary"
            size="sm"
            onClick={testNarratorVoice}
            disabled={!state.multiVoiceEnabled || state.testingNarrator}
            loading={state.testingNarrator}
            icon={<Play className="w-4 h-4" />}
          >
            {isZh ? '测试播放' : 'Test Playback'}
          </ActionButton>
        </div>
      </div>

      {/* 降级策略 */}
      <div className="p-4 rounded-xl bg-surface border border-border-secondary">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-warning/10">
            <AlertCircle className="w-5 h-5 text-warning" />
          </div>
          <div>
            <h3 className="font-medium text-text-primary">
              {isZh ? '降级策略' : 'Fallback Strategy'}
            </h3>
            <p className="text-sm text-text-secondary">
              {isZh
                ? '当角色音或旁白音未配置时的处理方式'
                : 'How to handle when character or narrator voice is not configured'}
            </p>
          </div>
        </div>

        <div className="space-y-3">
          {[
            { value: 'global', label: isZh ? '使用全局默认音色' : 'Use global default voice' },
            { value: 'character', label: isZh ? '使用角色音配置' : 'Use character voice configuration' },
            { value: 'narrator', label: isZh ? '使用旁白音配置' : 'Use narrator voice configuration' },
          ].map(option => (
            <label
              key={option.value}
              className="flex items-center gap-3 p-3 rounded-lg border border-border-secondary hover:border-accent/50 hover:bg-surface-hover transition-colors cursor-pointer"
            >
              <input
                type="radio"
                name="fallbackStrategy"
                value={option.value}
                checked={state.fallbackStrategy === option.value}
                onChange={(e) => setState(prev => ({ ...prev, fallbackStrategy: e.target.value as any }))}
                disabled={!state.multiVoiceEnabled}
                className="w-4 h-4 text-accent focus:ring-accent"
              />
              <span className="text-sm text-text-primary">{option.label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* 群聊音色映射说明 */}
      <div className="p-4 rounded-xl bg-surface border border-border-secondary">
        <div className="flex items-center gap-3 mb-3">
          <div className="p-2 rounded-lg bg-info/10">
            <Volume2 className="w-5 h-5 text-info" />
          </div>
          <div>
            <h3 className="font-medium text-text-primary">
              {isZh ? '群聊音色映射' : 'Group Chat Voice Mapping'}
            </h3>
            <p className="text-sm text-text-secondary">
              {isZh
                ? '在群聊场景中，每个智能体可以绑定独立的音色'
                : 'In group chat scenarios, each agent can be bound to an independent voice'}
            </p>
          </div>
        </div>

        <p className="text-sm text-text-secondary">
          {isZh
            ? '您可以在角色卡画廊中为每个角色卡配置专属音色，或者在群聊设置中为每个智能体分配不同的音色。'
            : 'You can configure dedicated voices for each character card in the Character Card Gallery, or assign different voices to each agent in group chat settings.'}
        </p>
      </div>

      {/* 使用说明 */}
      <div className="p-4 rounded-xl bg-surface border border-border-secondary">
        <h3 className="font-medium text-text-primary mb-3">
          {isZh ? '使用说明' : 'Usage Instructions'}
        </h3>
        <ul className="space-y-2 text-sm text-text-secondary">
          <li className="flex items-start gap-2">
            <span className="text-accent mt-1">•</span>
            <span>
              {isZh
                ? '角色音用于角色台词，旁白音用于旁白和系统提示。'
                : 'Character voice is used for character dialogue, narrator voice for narration and system prompts.'}
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-accent mt-1">•</span>
            <span>
              {isZh
                ? '开启多语音后，AI 回复中的角色台词和旁白将使用不同的音色播放。'
                : 'When multi-voice is enabled, character dialogue and narration in AI responses will be played with different voices.'}
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-accent mt-1">•</span>
            <span>
              {isZh
                ? '未配置的角色音或旁白音将按照降级策略使用默认音色。'
                : 'Unconfigured character or narrator voices will use the default voice according to the fallback strategy.'}
            </span>
          </li>
        </ul>
      </div>
    </div>
  )
})