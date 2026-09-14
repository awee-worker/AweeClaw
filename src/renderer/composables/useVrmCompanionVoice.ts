/**
 * useVrmCompanionVoice —— VRM 桌面伴侣窗口的语音对话
 *
 * 基于 useVoiceChat 封装，把「主窗口 push 的 VoiceContext」翻译成 useVoiceChat 的
 * options，并把状态/对话完成事件转发回主进程（主窗口负责 UI 联动与落库）。
 *
 * 与 useAvatarVoiceChat 的关系：
 * 两者是同一模式的两份实现（都跑在独立子 renderer 上，都不能访问 @store）。
 * 之所以不直接复用 useAvatarVoiceChat：它把 onEndConversation 写成了空回调，
 * 而伴侣窗口需要据此退出语音态（用户说「结束对话」时收起语音 UI）；
 * 且子窗口语音会随各自的状态机演化（唤醒词 / 悬浮球动画等只在头像窗口存在）。
 *
 * 语音链路（useVoiceChat 的 split 模式）：
 *   VAD 检测 → STT → LLM（可调工具）→ TTS → 播放（音量驱动伴侣口型）
 */

import { useEffect, useMemo, useRef } from 'react'
import { useVoiceChat, type VoiceChatOptions } from './useVoiceChat'
import type { VoiceContextPayload, VoiceModelConfig } from '../types/electronBridge'
import type { LLMConfig } from '@intelligence/providerTypes'

export interface VrmCompanionVoiceOptions {
  /** 语音上下文（来自 useVrmCompanionBridge） */
  voiceContext: VoiceContextPayload | null
  /** 语音状态 / 音量变化（转发主进程，供主窗口联动与音效） */
  onStateChanged?: (state: string, volume: number) => void
  /** 一轮对话完成（用户文本 + AI 文本 + 工具调用记录）→ 主窗口落库 */
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
  /** 用户说「结束对话」等指令时触发（伴侣窗口据此退出语音态） */
  onEndConversation?: () => void
  /** 错误提示 */
  onError?: (message: string) => void
}

/**
 * VoiceContext → useVoiceChat options。
 *
 * 与 useAvatarVoiceChat 的映射规则保持一致（云端/自定义分流、拆分式语音模式），
 * 避免两个子窗口出现「设置相同、行为不同」的割裂感。
 */
function buildVoiceChatOptions(
  voiceContext: VoiceContextPayload | null,
  callbacks: VoiceChatOptions,
): VoiceChatOptions {
  if (!voiceContext) {
    return { language: 'zh', cloudMode: 'cloud', ...callbacks }
  }

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
    // 语音分流优先使用语音设置独立的云端/自定义模式，未设置时回退服务商模式
    cloudMode: vmc?.cloudMode ?? voiceContext.cloudMode,
    serverUrl: voiceContext.serverUrl || undefined,
    llmConfig: (voiceContext.llmConfig as LLMConfig | null) || undefined,
    workspacePath: voiceContext.workspacePath || undefined,
    userVoiceConfig,
    voiceMode: 'split',
    ...callbacks,
  }
}

export function useVrmCompanionVoice(options: VrmCompanionVoiceOptions) {
  const { voiceContext, onStateChanged, onConversationComplete, onEndConversation, onError } = options

  // 用 ref 保存最新回调：避免回调每次渲染变化都重建 useVoiceChat 的 options，
  // 进而避免 useVoiceChat 内部 effect 重跑（会打断正在进行的录音/VAD 循环）。
  const onStateChangedRef = useRef(onStateChanged)
  const onConversationCompleteRef = useRef(onConversationComplete)
  const onEndConversationRef = useRef(onEndConversation)
  const onErrorRef = useRef(onError)
  onStateChangedRef.current = onStateChanged
  onConversationCompleteRef.current = onConversationComplete
  onEndConversationRef.current = onEndConversation
  onErrorRef.current = onError

  const stableCallbacks = useMemo<VoiceChatOptions>(
    () => ({
      onConversationComplete: (userText, aiText, toolCallRecords) => {
        onConversationCompleteRef.current?.(userText, aiText, toolCallRecords)
      },
      onEndConversation: () => {
        onEndConversationRef.current?.()
      },
      onError: (message) => {
        onErrorRef.current?.(message)
      },
    }),
    [],
  )

  const voiceChatOptions = useMemo(
    () => buildVoiceChatOptions(voiceContext, stableCallbacks),
    [voiceContext, stableCallbacks],
  )

  const voiceChat = useVoiceChat(voiceChatOptions)

  // 状态 / 音量 → 主进程（主窗口 UI 联动）
  const { state, volume } = voiceChat
  useEffect(() => {
    onStateChangedRef.current?.(state, volume)
  }, [state, volume])

  return voiceChat
}
