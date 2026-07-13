/**
 * VoiceConversationOverlay - 语音对话覆盖层
 *
 * 使用前端 VAD + 统一 AI 能力方案：
 * 1. 前端用 Web Audio API 实时检测音量
 * 2. 检测到说话开始 → 录音
 * 3. 检测到说话结束（静音 1.5s）→ 处理音频
 * 4. STT → LLM（支持工具调用和插件）→ 过滤舞台指示 → TTS → 播放
 * 5. AI 说话时用户可打断（点击球体或空格键）
 * 6. AI 说完后自动回到聆听状态
 *
 * 云端模式和本地模式都走客户端 api.llm.send()，
 * 具备与普通文字对话完全相同的 AI 能力（工具、插件等）
 */

import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { X, Mic, Volume2, PhoneOff } from 'lucide-react'
import { useVoiceChat } from '../../composables/useVoiceChat'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { api } from '../../adapters/electronBridge'
import { useAgentStore } from '@intelligence/state/IntelligenceStore'

type VoiceState = 'idle' | 'connecting' | 'listening' | 'recording' | 'processing' | 'speaking' | 'error'

const STATE_CONFIG: Record<VoiceState, {
  label: string
  labelEn: string
  gradient: string
  glow: string
}> = {
  idle: {
    label: '未连接',
    labelEn: 'Disconnected',
    gradient: 'from-slate-600 to-slate-800',
    glow: 'shadow-slate-500/20',
  },
  connecting: {
    label: '连接中',
    labelEn: 'Connecting...',
    gradient: 'from-amber-400 to-orange-600',
    glow: 'shadow-amber-500/30',
  },
  listening: {
    label: '聆听中',
    labelEn: 'Listening...',
    gradient: 'from-blue-400 to-indigo-600',
    glow: 'shadow-blue-500/40',
  },
  recording: {
    label: '聆听中',
    labelEn: 'Listening...',
    gradient: 'from-emerald-400 to-teal-600',
    glow: 'shadow-emerald-500/40',
  },
  processing: {
    label: '思考中',
    labelEn: 'Thinking...',
    gradient: 'from-violet-400 to-purple-600',
    glow: 'shadow-violet-500/40',
  },
  speaking: {
    label: '回答中',
    labelEn: 'Speaking...',
    gradient: 'from-cyan-400 to-blue-600',
    glow: 'shadow-cyan-500/40',
  },
  error: {
    label: '连接错误',
    labelEn: 'Error',
    gradient: 'from-red-400 to-rose-600',
    glow: 'shadow-red-500/30',
  },
}

interface VoiceConversationOverlayProps {
  onClose: () => void
}

export function VoiceConversationOverlay({ onClose }: VoiceConversationOverlayProps) {
  const { language, llmConfig, cloudMode, workspacePath, openFiles, activeFilePath } = useStore(useShallow(s => ({
    language: s.language,
    llmConfig: s.llmConfig,
    cloudMode: s.cloudMode,
    workspacePath: s.workspacePath,
    openFiles: s.openFiles,
    activeFilePath: s.activeFilePath,
  })))
  const isZh = language === 'zh'
  const isCloudMode = cloudMode === 'cloud'

  // 保存对话到聊天历史的函数
  // 直接调用 store 的 addUserMessage + addAssistantMessage + finalizeAssistant
  // 不触发 LLM 调用（语音对话已通过 voiceToolLoop 完成完整 LLM + 工具调用流程）
  const saveConversationToHistory = useCallback(
    (userText: string, aiText: string) => {
      try {
        const store = useAgentStore.getState()
        // 添加用户消息
        store.addUserMessage(userText)
        // 添加 AI 消息（流式标记为完成）
        const assistantId = store.addAssistantMessage(aiText)
        // 标记完成
        if (assistantId) {
          store.finalizeAssistant(assistantId)
        }
      } catch {
        // 保存失败不影响语音对话流程
      }
    },
    [],
  )

  // 加载用户自定义语音配置（本地模式下使用）
  const [userVoiceConfig, setUserVoiceConfig] = useState<
    | {
        sttEnabled: boolean
        sttProvider?: string
        sttModel?: string
        sttApiKey?: string
        sttBaseUrl?: string
        ttsEnabled: boolean
        ttsProvider?: string
        ttsModel?: string
        ttsVoice?: string
        ttsApiKey?: string
        ttsBaseUrl?: string
        ttsSpeed?: number
      }
    | undefined
  >(undefined)

  useEffect(() => {
    if (isCloudMode) return
    let cancelled = false
    api.settings
      .dbGetVoiceModelConfig()
      .then((config) => {
        if (cancelled || !config) return
        if (config.sttEnabled || config.ttsEnabled) {
          setUserVoiceConfig(config)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [isCloudMode])

  const {
    state,
    volume,
    connect,
    disconnect,
    interrupt,
  } = useVoiceChat({
    language: 'auto',
    // 云端/本地模式：决定 STT/TTS 走后端 API 还是用户配置
    cloudMode: isCloudMode ? 'cloud' : 'local',
    // 完整 LLM 配置：
    // - 云端模式含 cloudMode=true/serverUrl/accessToken，主进程路由到后端代理
    // - 本地模式含 apiKey/baseUrl，直连用户配置的模型
    // 两种模式都走客户端 api.llm.send()，支持完整的工具调用和插件能力
    llmConfig: llmConfig || undefined,
    userVoiceConfig,
    // 工作区上下文：让 AI 知道用户当前的工作目录和打开的文件
    workspacePath: workspacePath || undefined,
    openFiles: openFiles?.map(f => f.path).filter(Boolean),
    activeFile: activeFilePath || undefined,
    // AI 音频播放完毕后，把这一轮对话保存到聊天历史
    onConversationComplete: (userText, aiFullText) => {
      saveConversationToHistory(userText, aiFullText)
    },
  })

  const currentState = state as VoiceState
  const config = STATE_CONFIG[currentState] || STATE_CONFIG.idle

  // 进入后自动连接
  useEffect(() => {
    connect()
    return () => {
      disconnect()
    }
  }, [])

  const handleInterrupt = useCallback(() => {
    if (currentState === 'speaking') {
      interrupt()
    }
  }, [currentState, interrupt])

  const handleClose = useCallback(() => {
    disconnect()
    onClose()
  }, [disconnect, onClose])

  // 空格键打断 + Esc 关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && currentState === 'speaking') {
        e.preventDefault()
        handleInterrupt()
      }
      if (e.code === 'Escape') {
        e.preventDefault()
        handleClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentState, handleInterrupt, handleClose])

  const isSpeaking = currentState === 'speaking'
  const isListening = currentState === 'listening' || currentState === 'recording'
  const isActive = currentState !== 'idle' && currentState !== 'error' && currentState !== 'connecting'

  // 音量条高度（用于球体呼吸效果）
  const volumeScale = Math.min(1 + volume * 3, 1.15)

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-background/95 backdrop-blur-xl"
    >
      {/* 顶部状态栏 */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-3 z-10">
        <div className="flex items-center gap-2.5">
          <div className={`w-2 h-2 rounded-full ${
            currentState === 'error' ? 'bg-red-500' :
            isActive ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
          }`} />
          <span className="text-sm font-medium text-text-primary">
            {isZh ? '语音对话' : 'Voice Conversation'}
          </span>
        </div>

        <button
          onClick={handleClose}
          className="w-7 h-7 rounded-full flex items-center justify-center transition-colors bg-surface/60 hover:bg-red-500/20 border border-border/40 hover:border-red-500/40"
          title={isZh ? '关闭（Esc）' : 'Close (Esc)'}
        >
          <X className="w-3.5 h-3.5 text-text-primary hover:text-red-400" />
        </button>
      </div>

      {/* 中央球体区域 */}
      <div className="flex-1 flex flex-col items-center justify-center gap-6 px-4">
        <div className="relative flex items-center justify-center">
          {/* 聆听/录音时的扩散波纹 */}
          {isListening && (
            <>
              <motion.div
                className="absolute rounded-full border-2 border-blue-400/40"
                animate={{ scale: [1, 1.8, 1.8], opacity: [0.6, 0, 0] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeOut' }}
                style={{ width: 180, height: 180 }}
              />
              <motion.div
                className="absolute rounded-full border-2 border-blue-400/30"
                animate={{ scale: [1, 1.8, 1.8], opacity: [0.4, 0, 0] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeOut', delay: 0.6 }}
                style={{ width: 180, height: 180 }}
              />
            </>
          )}

          {/* AI 说话时的光圈 */}
          {isSpeaking && (
            <motion.div
              className="absolute rounded-full bg-cyan-400/20 blur-xl"
              animate={{ scale: [1, 1.3, 1], opacity: [0.5, 0.8, 0.5] }}
              transition={{ duration: 0.8, repeat: Infinity, ease: 'easeInOut' }}
              style={{ width: 220, height: 220 }}
            />
          )}

          {/* 处理中的旋转环 */}
          {currentState === 'processing' && (
            <motion.div
              className="absolute rounded-full border-t-2 border-violet-400 border-r-transparent border-b-transparent border-l-transparent"
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
              style={{ width: 200, height: 200 }}
            />
          )}

          {/* 连接中的脉冲 */}
          {currentState === 'connecting' && (
            <motion.div
              className="absolute rounded-full border-2 border-amber-400/50"
              animate={{ scale: [1, 1.2, 1], opacity: [0.8, 0.3, 0.8] }}
              transition={{ duration: 1, repeat: Infinity, ease: 'easeInOut' }}
              style={{ width: 180, height: 180 }}
            />
          )}

          {/* 主球体 - 音量驱动呼吸效果 */}
          <motion.button
            onClick={handleInterrupt}
            disabled={!isSpeaking}
            whileHover={isSpeaking ? { scale: 1.05 } : undefined}
            whileTap={isSpeaking ? { scale: 0.95 } : undefined}
            className={`relative w-40 h-40 rounded-full bg-gradient-to-br ${config.gradient} shadow-2xl ${config.glow} transition-all duration-300 ${
              isSpeaking ? 'cursor-pointer' : 'cursor-default'
            }`}
            animate={{
              scale: isListening ? volumeScale : isSpeaking ? [1, 1.06, 1] : 1,
            }}
            transition={{
              scale: {
                duration: isSpeaking ? 0.8 : 0.1,
                repeat: isSpeaking ? Infinity : 0,
                ease: 'easeInOut',
              },
            }}
          >
            <div className="absolute inset-4 rounded-full bg-gradient-to-br from-white/20 to-transparent" />

            <div className="absolute inset-0 flex items-center justify-center">
              {currentState === 'idle' || currentState === 'connecting' ? (
                <div className="w-7 h-7 rounded-full border-2 border-white/40 border-t-white animate-spin" />
              ) : isSpeaking ? (
                <div className="flex items-center gap-1">
                  {[0, 1, 2, 3, 4].map(i => (
                    <motion.div
                      key={i}
                      className="w-1 h-7 bg-white/80 rounded-full"
                      animate={{ height: [8, 22, 12, 18, 8] }}
                      transition={{
                        duration: 0.6,
                        repeat: Infinity,
                        delay: i * 0.1,
                        ease: 'easeInOut',
                      }}
                    />
                  ))}
                </div>
              ) : currentState === 'recording' ? (
                <div className="flex items-center gap-1">
                  {[0, 1, 2, 3].map(i => (
                    <motion.div
                      key={i}
                      className="w-1.5 bg-white/90 rounded-full"
                      animate={{ height: [6, 20, 10, 16, 6] }}
                      transition={{
                        duration: 0.5,
                        repeat: Infinity,
                        delay: i * 0.12,
                        ease: 'easeInOut',
                      }}
                      style={{ height: 6 + volume * 30 }}
                    />
                  ))}
                </div>
              ) : currentState === 'listening' ? (
                <Mic className="w-9 h-9 text-white/90" />
              ) : currentState === 'processing' ? (
                <div className="flex items-center gap-1.5">
                  {[0, 1, 2].map(i => (
                    <motion.div
                      key={i}
                      className="w-2.5 h-2.5 bg-white/80 rounded-full"
                      animate={{ opacity: [0.3, 1, 0.3] }}
                      transition={{
                        duration: 0.8,
                        repeat: Infinity,
                        delay: i * 0.2,
                        ease: 'easeInOut',
                      }}
                    />
                  ))}
                </div>
              ) : (
                <Volume2 className="w-9 h-9 text-white/70" />
              )}
            </div>
          </motion.button>
        </div>
      </div>

      {/* 底部控制栏 */}
      <div className="absolute bottom-0 left-0 right-0 flex items-center justify-center gap-3 px-4 py-4">
        {isSpeaking && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="text-xs text-text-muted mr-2"
          >
            {isZh ? '点击球体或按空格键打断' : 'Click orb or press Space to interrupt'}
          </motion.div>
        )}

        <button
          onClick={handleClose}
          className="px-4 py-2 rounded-full bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors flex items-center gap-2 border border-red-500/30"
        >
          <PhoneOff className="w-3.5 h-3.5" />
          <span className="text-sm font-medium">
            {isZh ? '结束对话' : 'End Call'}
          </span>
        </button>
      </div>
    </motion.div>
  )
}

export default VoiceConversationOverlay
