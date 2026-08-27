/**
 * useAvatarVoiceChat - 头像窗口语音对话 hook
 *
 * 基于 useVoiceChat 封装，适配头像窗口的场景：
 * 1. 从 VoiceContext（IPC 同步）构建 useVoiceChat 所需的 options
 * 2. 转发语音状态变化到主进程（floating-avatar:voice-state-changed）
 * 3. 转发对话完成到主进程（floating-avatar:save-conversation）
 * 4. 暴露 connect/disconnect/interrupt 供 AvatarApp 调用
 *
 * 与主窗口 useVoiceChat 的区别：
 * - 不依赖 @store，所有配置来自 VoiceContext（主窗口 push）
 * - 状态变化通过 IPC 转发，主窗口可联动 UI（如显示「头像对话中」）
 * - 对话历史通过 IPC 转发到主窗口保存（头像窗口不维护本地历史）
 *
 * 使用方式：
 *   const voice = useAvatarVoiceChat({
 *     voiceContext: bridge.voiceContext,
 *     onStateChanged: (state) => bridge.notifyVoiceStateChanged({ state, volume }),
 *     onConversationComplete: (userText, aiText, tools) => bridge.notifySaveConversation({...}),
 *   })
 *   voice.connect()    // 开始对话
 *   voice.disconnect() // 结束对话
 */

import { useEffect, useMemo, useRef } from 'react'
import { useVoiceChat, type VoiceChatOptions } from './useVoiceChat'
import type {
  VoiceContextPayload,
  VoiceModelConfig,
} from '../types/electronBridge'
import type { LLMConfig } from '@intelligence/providerTypes'

// ============================================
// 类型定义
// ============================================

export interface AvatarVoiceChatOptions {
  /** 语音上下文（来自 useAvatarBridge） */
  voiceContext: VoiceContextPayload | null
  /** 语音状态变化回调（转发到主进程） */
  onStateChanged?: (state: string, volume: number) => void
  /** 对话完成回调（转发到主进程保存） */
  onConversationComplete?: (
    userText: string,
    aiText: string,
    toolCallRecords?: Array<{
      id: string
      name: string
      args: Record<string, unknown>
      success: boolean
      resultSummary: string
    }>,
  ) => void
  /** 错误回调 */
  onError?: (message: string) => void
}

// ============================================
// 工具函数：VoiceContext → useVoiceChat options
// ============================================

/**
 * 将 VoiceContextPayload 转换为 useVoiceChat 的 options
 *
 * 字段映射：
 * - voiceContext.language → options.language
 * - voiceContext.cloudMode → options.cloudMode
 * - voiceContext.serverUrl → options.serverUrl
 * - voiceContext.llmConfig → options.llmConfig（类型转换）
 * - voiceContext.workspacePath → options.workspacePath
 * - voiceContext.voiceModelConfig → options.userVoiceConfig（字段映射）
 */
function buildVoiceChatOptions(
  voiceContext: VoiceContextPayload | null,
  callbacks: VoiceChatOptions,
): VoiceChatOptions {
  if (!voiceContext) {
    return {
      language: 'zh',
      cloudMode: 'cloud',
      ...callbacks,
    }
  }

  // 将 voiceModelConfig 映射为 useVoiceChat 的 userVoiceConfig
  const vmc = voiceContext.voiceModelConfig as VoiceModelConfig | null
  const userVoiceConfig: VoiceChatOptions['userVoiceConfig'] = vmc
    ? {
        sttEnabled: vmc.sttEnabled,
        sttProvider: vmc.sttProvider,
        sttModel: vmc.sttModel,
        sttApiKey: vmc.sttApiKey,
        sttBaseUrl: vmc.sttBaseUrl,
        ttsEnabled: vmc.ttsEnabled,
        ttsProvider: vmc.ttsProvider,
        ttsModel: vmc.ttsModel,
        ttsVoice: vmc.ttsVoice,
        ttsApiKey: vmc.ttsApiKey,
        ttsBaseUrl: vmc.ttsBaseUrl,
        ttsSpeed: vmc.ttsSpeed,
      }
    : undefined

  return {
    language: voiceContext.language === 'en' ? 'en' : 'zh',
    // 语音分流模式：优先使用语音设置独立的云端/自定义模式（voiceModelConfig.cloudMode），
    // 未设置时回退 VoiceContext.cloudMode（服务商 cloudMode）
    cloudMode: vmc?.cloudMode ?? voiceContext.cloudMode,
    serverUrl: voiceContext.serverUrl || undefined,
    llmConfig: (voiceContext.llmConfig as LLMConfig | null) || undefined,
    workspacePath: voiceContext.workspacePath || undefined,
    userVoiceConfig,
    voiceMode: 'split', // 头像窗口默认使用拆分式模式
    ...callbacks,
  }
}

// ============================================
// 主 hook
// ============================================

export function useAvatarVoiceChat(options: AvatarVoiceChatOptions) {
  const { voiceContext, onStateChanged, onConversationComplete, onError } = options

  // 用 ref 保存最新回调，避免 useVoiceChat 因回调变化频繁重建
  const onStateChangedRef = useRef(onStateChanged)
  const onConversationCompleteRef = useRef(onConversationComplete)
  const onErrorRef = useRef(onError)
  onStateChangedRef.current = onStateChanged
  onConversationCompleteRef.current = onConversationComplete
  onErrorRef.current = onError

  // 构建 useVoiceChat 的回调（稳定引用，不随外部回调变化重建）
  const stableCallbacks = useMemo<VoiceChatOptions>(
    () => ({
      onConversationComplete: (userText, aiText, toolCallRecords) => {
        onConversationCompleteRef.current?.(userText, aiText, toolCallRecords)
      },
      onError: (message) => {
        onErrorRef.current?.(message)
      },
      onEndConversation: () => {
        // 用户说"结束对话"时，useVoiceChat 内部会 disconnect，这里无需额外处理
      },
    }),
    [],
  )

  // 构建 options（voiceContext 变化时重建）
  const voiceChatOptions = useMemo(
    () => buildVoiceChatOptions(voiceContext, stableCallbacks),
    [voiceContext, stableCallbacks],
  )

  const voiceChat = useVoiceChat(voiceChatOptions)

  // 转发状态变化到主进程
  const { state, volume } = voiceChat
  useEffect(() => {
    onStateChangedRef.current?.(state, volume)
  }, [state, volume])

  return voiceChat
}
