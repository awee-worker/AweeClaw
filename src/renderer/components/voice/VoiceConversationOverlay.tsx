/**
 * VoiceConversationOverlay - 语音对话覆盖层容器
 *
 * 混合模式架构：
 * - compact: 浮动小窗口（默认），右上角可拖拽，含小球+实时文本流+工具状态
 * - immersive: 沉浸全屏模式，大球体+底部滚动文本流
 *
 * 两种模式可随时切换，共享同一个 useVoiceChat 实例。
 * 模式偏好持久化到 localStorage。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { useVoiceChat } from '../../composables/useVoiceChat'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { api } from '../../adapters/electronBridge'
import { saveVoiceConversationToHistory } from '@intelligence/state/saveConversation'
import { CompactVoiceWindow } from './CompactVoiceWindow'
import { ImmersiveVoiceView } from './ImmersiveVoiceView'

type VoiceMode = 'compact' | 'immersive'

const MODE_STORAGE_KEY = 'voice-conversation-mode'

interface VoiceConversationOverlayProps {
  onClose: () => void
}

export function VoiceConversationOverlay({ onClose }: VoiceConversationOverlayProps) {
  const { language, llmConfig, cloudMode, serverUrl, workspacePath, openFiles, activeFilePath } = useStore(useShallow(s => ({
    language: s.language,
    llmConfig: s.llmConfig,
    cloudMode: s.cloudMode,
    serverUrl: s.serverUrl,
    workspacePath: s.workspacePath,
    openFiles: s.openFiles,
    activeFilePath: s.activeFilePath,
  })))
  const isZh = language === 'zh'
  // 语音对话分流模式：优先使用语音设置独立的云端/自定义模式（voiceModelConfig.cloudMode），
  // 未加载时回退服务商 cloudMode（默认云端）
  const isCloudMode = (voiceModelConfig?.cloudMode ?? (cloudMode === 'cloud' ? 'cloud' : 'local')) === 'cloud'

  // 模式：默认沉浸式，从 localStorage 读取偏好
  const [viewMode, setViewMode] = useState<VoiceMode>(() => {
    try {
      const saved = localStorage.getItem(MODE_STORAGE_KEY)
      if (saved === 'compact' || saved === 'immersive') return saved
    } catch {
      // ignore
    }
    return 'immersive'
  })

  // 持久化模式偏好
  useEffect(() => {
    try {
      localStorage.setItem(MODE_STORAGE_KEY, viewMode)
    } catch {
      // ignore
    }
  }, [viewMode])

  // 错误提示状态
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showError = useCallback((message: string) => {
    setErrorMessage(message)
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current)
    errorTimerRef.current = setTimeout(() => {
      setErrorMessage(null)
    }, 5000)
  }, [])

  const dismissError = useCallback(() => {
    setErrorMessage(null)
    if (errorTimerRef.current) {
      clearTimeout(errorTimerRef.current)
      errorTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current)
    }
  }, [])

  // 保存对话到聊天历史（复用共享工具，头像窗口经 IPC 转发后也走同一逻辑）
  const saveConversationToHistory = useCallback(
    (
      userText: string,
      aiText: string,
      toolCallRecords?: Array<{
        id: string
        name: string
        args: Record<string, unknown>
        success: boolean
        resultSummary: string
      }>,
    ) => {
      saveVoiceConversationToHistory({ userText, aiText, toolCallRecords })
    },
    [],
  )

  // 加载语音模型配置
  const [voiceModelConfig, setVoiceModelConfig] = useState<any>(undefined)

  useEffect(() => {
    let cancelled = false
    api.settings
      .dbGetVoiceModelConfig()
      .then((config) => {
        if (cancelled || !config) return
        setVoiceModelConfig(config)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const voiceMode: 'split' | 'realtime' = voiceModelConfig?.mode || 'split'
  const userVoiceConfig = voiceMode === 'split' ? voiceModelConfig : undefined
  const realtimeConfig = voiceMode === 'realtime' && voiceModelConfig?.realtimeEnabled
    ? {
        endpoint: voiceModelConfig.realtimeBaseUrl || undefined,
        apiKey: voiceModelConfig.realtimeApiKey || undefined,
        voice: voiceModelConfig.realtimeVoice || 'alloy',
        model: voiceModelConfig.realtimeModel || 'gpt-4o-realtime',
        serverVad: false,
      }
    : undefined

  const {
    state,
    volume,
    isMuted,
    activityStatus,
    streamEntries,
    connect,
    disconnect,
    interrupt,
    toggleMute,
  } = useVoiceChat({
    language: 'auto',
    voiceMode,
    cloudMode: isCloudMode ? 'cloud' : 'local',
    serverUrl: serverUrl || undefined,
    llmConfig: llmConfig || undefined,
    userVoiceConfig,
    realtimeConfig,
    workspacePath: workspacePath || undefined,
    openFiles: openFiles?.map(f => f.path).filter(Boolean),
    activeFile: activeFilePath || undefined,
    onConversationComplete: (userText, aiFullText, toolCallRecords) => {
      saveConversationToHistory(userText, aiFullText, toolCallRecords)
    },
    onError: (message) => {
      showError(message)
    },
    onEndConversation: () => {
      // 用户说"结束对话"等指令时，延迟关闭窗口（让告别消息显示一会）
      setTimeout(() => {
        disconnect()
        onClose()
      }, 800)
    },
  })

  // 进入后自动连接
  useEffect(() => {
    connect()
    return () => {
      disconnect()
    }
  }, [])

  const handleInterrupt = useCallback(() => {
    if (state === 'speaking') {
      interrupt()
    }
  }, [state, interrupt])

  const handleClose = useCallback(() => {
    disconnect()
    onClose()
  }, [disconnect, onClose])

  // 空格键打断 + Esc 关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && state === 'speaking') {
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
  }, [state, handleInterrupt, handleClose])

  // 渲染对应模式
  return (
    <AnimatePresence mode="wait">
      {viewMode === 'compact' ? (
        <CompactVoiceWindow
          key="compact"
          state={state}
          volume={volume}
          isMuted={isMuted}
          isZh={isZh}
          onClose={handleClose}
          onInterrupt={handleInterrupt}
          onToggleMute={toggleMute}
          onExpand={() => setViewMode('immersive')}
        />
      ) : (
        <ImmersiveVoiceView
          key="immersive"
          state={state}
          volume={volume}
          isMuted={isMuted}
          streamEntries={streamEntries}
          activityStatus={activityStatus}
          errorMessage={errorMessage}
          isZh={isZh}
          onClose={handleClose}
          onInterrupt={handleInterrupt}
          onToggleMute={toggleMute}
          onDismissError={dismissError}
          onMinimize={() => setViewMode('compact')}
        />
      )}
    </AnimatePresence>
  )
}

export default VoiceConversationOverlay
