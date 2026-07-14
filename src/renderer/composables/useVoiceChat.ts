import { useCallback, useEffect, useRef, useState } from 'react'
import { convertBlobToWav } from '../utils/audioConverter'
import { voiceApi } from '../services/voiceApi'
import {
  stripNonSpeakableContent,
  buildVoiceSystemPrompt,
} from '../utils/voiceTextUtils'
import { runVoiceToolLoop } from '@intelligence/voice/voiceToolLoop'
import type {
  LLMConfig,
  LLMMessage,
} from '@intelligence/providerTypes'
import { api } from '@renderer/adapters/electronBridge'
import { logger } from '@shared/toolkit/LogEngine'
import { useStore } from '@store'
import { io, type Socket } from 'socket.io-client'
import { getTokens } from '@services/backendApi'

/**
 * 前端 VAD + 统一语音对话 hook
 *
 * 支持两种语音模式：
 *
 * 【拆分式 split】（默认）
 * 1. 前端 VAD 检测说话开始/结束
 * 2. 完整录音 → voiceApi.speechToText()（自动分流：云端→后端 API，本地→用户配置）
 * 3. runVoiceToolLoop()（走客户端主进程 api.llm.send()，支持工具调用和插件）
 * 4. stripNonSpeakableContent() 过滤舞台指示
 * 5. voiceApi.textToSpeech()（自动分流：云端→后端 API，本地→用户配置）
 * 6. 前端播放音频
 *
 * 【端到端 realtime】
 * 1. 前端 VAD 检测说话开始/结束
 * 2. 完整录音 → WebSocket 发送到后端 → 后端转发到 OpenAI Realtime API
 * 3. 后端返回音频流 → 前端实时播放
 * 4. 端到端模式延迟更低，对话更自然（模型自带 STT + LLM + TTS）
 * 5. 打断通过 WebSocket 发送 voice:interrupt 事件
 */

// ============================================
// 类型定义
// ============================================

export type VoiceChatState =
  | 'idle'          // 未连接
  | 'connecting'    // 连接中
  | 'listening'     // 聆听中（等待用户说话）
  | 'recording'     // 录音中（检测到用户在说话）
  | 'processing'    // 处理中（STT → LLM → 工具调用）
  | 'speaking'      // AI 说话中（播放 TTS）
  | 'error'         // 错误

/** 语音模式：拆分式或端到端 */
export type VoiceMode = 'split' | 'realtime'

export interface VoiceChatOptions {
  /** 语言 */
  language?: string
  /**
   * 语音模式
   * - split: 拆分式（STT + LLM + TTS 三段）
   * - realtime: 端到端实时语音（如 OpenAI gpt-4o-realtime）
   */
  voiceMode?: VoiceMode
  /** 云端/本地模式（决定 STT/TTS 走后端还是用户配置） */
  cloudMode?: 'cloud' | 'local'
  /** 完整 LLM 配置（拆分式模式使用） */
  llmConfig?: LLMConfig
  /** 系统提示词 */
  systemPrompt?: string
  /** 工作区路径（让 AI 知道用户当前的工作目录） */
  workspacePath?: string
  /** 当前打开的文件列表 */
  openFiles?: string[]
  /** 当前激活的文件 */
  activeFile?: string
  /** 用户自定义 STT/TTS 配置（拆分式模式使用） */
  userVoiceConfig?: {
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
  /** 端到端实时语音模型配置（端到端模式使用） */
  realtimeConfig?: {
    /** realtime API 的 WebSocket URL（如 wss://api.openai.com/v1/realtime） */
    endpoint?: string
    /** realtime API 的 API Key */
    apiKey?: string
    /** 语音音色（如 alloy、echo、nova 等） */
    voice?: string
    /** 模型名（如 gpt-4o-realtime） */
    model?: string
    /** 是否开启服务端 VAD */
    serverVad?: boolean
  }
  /** 用户说话回调 */
  onUserText?: (text: string) => void
  /** AI 回复文本回调（流式） */
  onAiText?: (text: string) => void
  /** AI 回复完成回调 */
  onAiTextEnd?: (fullText: string) => void
  /**
   * 一轮对话完成回调（用户文本 + AI 完整文本）
   * 触发时机：AI 音频播放完毕
   * 用于把对话内容保存到聊天历史
   */
  onConversationComplete?: (userText: string, aiText: string) => void
  /** 错误回调 */
  onError?: (message: string) => void
}

// ============================================
// 常量
// ============================================

// VAD 参数
const VAD_THRESHOLD = 0.015      // 说话检测阈值（RMS）
const VAD_SILENCE_DELAY = 1500   // 说话结束后等待多久（ms）判定说完
const VAD_MIN_SPEECH_TIME = 300  // 最短说话时间（ms），短于此视为噪音
const VAD_CHECK_INTERVAL = 100   // VAD 检测间隔（ms）
const SAMPLE_RATE = 16000        // 采样率
// 对话历史裁剪：保留 system + 最近 N 条消息
const MAX_HISTORY_MESSAGES = 30

// ============================================
// 音频工具函数
// ============================================

/**
 * 将 Blob 转为 base64 字符串
 */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const base64 = result.split(',')[1] || ''
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

// ============================================
// 主 hook
// ============================================

export function useVoiceChat(options?: VoiceChatOptions) {
  const [state, setState] = useState<VoiceChatState>('idle')
  const [volume, setVolume] = useState(0)
  const [sttText, setSttText] = useState('')
  const [aiText, setAiText] = useState('')

  // refs - 音频采集
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])

  // refs - VAD 状态机
  const vadTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const vadStateRef = useRef<'silence' | 'speaking'>('silence')
  const speechStartTimeRef = useRef(0)
  const silenceStartTimeRef = useRef(0)

  // refs - 对话状态
  const isSpeakingRef = useRef(false)  // AI 是否在说话
  const aiTextRef = useRef('')
  const sttTextRef = useRef('')
  const cloudModeRef = useRef<'cloud' | 'local'>('cloud')
  const voiceModeRef = useRef<VoiceMode>('split')

  // refs - 对话历史（LLMMessage 格式，支持工具调用上下文）
  const conversationHistoryRef = useRef<LLMMessage[]>([])

  // refs - 中断控制
  const abortControllerRef = useRef<AbortController | null>(null)

  // refs - TTS 播放（拆分式模式使用）
  const ttsAudioContextRef = useRef<AudioContext | null>(null)
  const ttsQueueRef = useRef<{ data: string; contentType: string }[]>([])
  const isPlayingRef = useRef(false)

  // refs - 端到端模式 WebSocket
  const socketRef = useRef<Socket | null>(null)

  // ============================================================
  // TTS 播放（拆分式模式）
  // ============================================================

  const playTtsQueue = useCallback(async () => {
    if (isPlayingRef.current) return
    const item = ttsQueueRef.current.shift()
    if (!item) return

    isPlayingRef.current = true
    try {
      if (!ttsAudioContextRef.current) {
        ttsAudioContextRef.current = new AudioContext({ sampleRate: 24000 })
      }
      const audioBuffer = await ttsAudioContextRef.current.decodeAudioData(
        Uint8Array.from(atob(item.data), c => c.charCodeAt(0)).buffer
      )
      const source = ttsAudioContextRef.current.createBufferSource()
      source.buffer = audioBuffer
      source.connect(ttsAudioContextRef.current.destination)
      source.onended = () => {
        isPlayingRef.current = false
        // 播放下一个
        if (ttsQueueRef.current.length > 0) {
          playTtsQueue()
        }
      }
      source.start()
    } catch {
      isPlayingRef.current = false
    }
  }, [])

  const stopTtsPlayback = useCallback(() => {
    ttsQueueRef.current = []
    isPlayingRef.current = false
    if (ttsAudioContextRef.current) {
      ttsAudioContextRef.current.close()
      ttsAudioContextRef.current = null
    }
  }, [])

  // ============================================================
  // 端到端模式：实时音频播放
  // ============================================================

  /**
   * 播放后端返回的 PCM16 音频块
   * 后端通过 voice:tts_audio 事件发送 base64 编码的 PCM16 数据
   */
  const playRealtimeAudioChunk = useCallback(async (base64Data: string) => {
    try {
      if (!ttsAudioContextRef.current) {
        ttsAudioContextRef.current = new AudioContext({ sampleRate: 24000 })
      }
      // 将 base64 PCM16 解码为 AudioBuffer
      const pcm16 = atob(base64Data)
      const bytes = new Uint8Array(pcm16.length)
      for (let i = 0; i < pcm16.length; i++) {
        bytes[i] = pcm16.charCodeAt(i)
      }
      const view = new DataView(bytes.buffer)
      const float32 = new Float32Array(bytes.length / 2)
      for (let i = 0; i < float32.length; i++) {
        float32[i] = view.getInt16(i * 2, true) / 32768
      }
      const audioBuffer = ttsAudioContextRef.current.createBuffer(1, float32.length, 24000)
      audioBuffer.copyToChannel(float32, 0)
      const source = ttsAudioContextRef.current.createBufferSource()
      source.buffer = audioBuffer
      source.connect(ttsAudioContextRef.current.destination)
      source.onended = () => {
        // 继续播放队列中的下一个
        if (ttsQueueRef.current.length > 0) {
          const next = ttsQueueRef.current.shift()!
          playRealtimeAudioChunk(next.data)
        } else {
          isPlayingRef.current = false
        }
      }
      source.start()
    } catch (err) {
      logger.system.warn('[VoiceChat] Failed to play realtime audio chunk:', err)
      isPlayingRef.current = false
    }
  }, [])

  // ============================================================
  // 拆分式模式：核心处理（STT → LLM+工具 → TTS → 播放）
  // ============================================================

  const processAudio = useCallback(async (audioBlob: Blob) => {
    try {
      const wavBlob = await convertBlobToWav(audioBlob)

      // 阶段 1：STT（voiceApi 自动分流云端/本地）
      setState('processing')
      const sttResult = await voiceApi.speechToText(wavBlob, {
        language: options?.language,
        // 拆分式模式：强制使用用户配置的 STT，不受 cloudMode 影响
        forceLocal: voiceModeRef.current === 'split',
      })

      if (!sttResult.text.trim()) {
        setState('listening')
        return
      }

      sttTextRef.current = sttResult.text
      setSttText(sttResult.text)
      options?.onUserText?.(sttResult.text)

      // 阶段 2：构建系统提示词（注入工作区上下文）
      const systemPrompt = buildVoiceSystemPrompt({
        basePrompt: options?.systemPrompt,
        workspacePath: options?.workspacePath,
        openFiles: options?.openFiles,
        activeFile: options?.activeFile,
      })

      // 阶段 3：构建 LLM 配置
      // 始终从 store 获取最新 llmConfig，避免 Overlay 传入的闭包旧值导致 cloudMode 字段未同步
      const storeState = useStore.getState()
      const llmConfig: LLMConfig = {
        ...(storeState.llmConfig || {
          provider: 'openai',
          model: 'gpt-4o',
          apiKey: '',
          baseUrl: '',
        }),
      }

      // 云端模式兜底：如果 authSlice.cloudMode === 'cloud' 但 llmConfig 中 cloudMode 字段缺失，
      // 自动补充 cloudMode/serverUrl/accessToken，确保主进程走后端代理而非本地 apiKey
      if (storeState.cloudMode === 'cloud' && !llmConfig.cloudMode) {
        const tokens = getTokens()
        llmConfig.cloudMode = true
        llmConfig.serverUrl = storeState.serverUrl
        llmConfig.accessToken = tokens?.accessToken
        llmConfig.refreshToken = tokens?.refreshToken
        logger.system.info('[VoiceChat] 云端模式兜底：补充 llmConfig 的 cloudMode 字段')
      }

      logger.system.info('[VoiceChat] LLM 配置:', {
        provider: llmConfig.provider,
        model: llmConfig.model,
        cloudMode: llmConfig.cloudMode,
        authCloudMode: storeState.cloudMode,
        hasApiKey: !!llmConfig.apiKey,
        hasAccessToken: !!llmConfig.accessToken,
      })

      // 阶段 4：构建消息列表
      if (conversationHistoryRef.current.length === 0) {
        conversationHistoryRef.current.push({
          role: 'system',
          content: systemPrompt,
        })
      }

      conversationHistoryRef.current.push({
        role: 'user',
        content: sttResult.text,
      })

      // 裁剪历史
      if (conversationHistoryRef.current.length > MAX_HISTORY_MESSAGES + 1) {
        const system = conversationHistoryRef.current[0]
        const recent = conversationHistoryRef.current.slice(-MAX_HISTORY_MESSAGES)
        conversationHistoryRef.current = [system, ...recent]
      }

      // 创建本次请求的 AbortController
      const abortController = new AbortController()
      abortControllerRef.current = abortController

      // 重置 AI 文本
      aiTextRef.current = ''
      setAiText('')

      // 阶段 5：调用 LLM 工具循环（支持工具调用和插件）
      const result = await runVoiceToolLoop({
        config: llmConfig,
        messages: conversationHistoryRef.current,
        systemPrompt,
        workspacePath: options?.workspacePath || null,
        onTextChunk: (chunk) => {
          aiTextRef.current += chunk
          setAiText(aiTextRef.current)
          options?.onAiText?.(chunk)
        },
        abortSignal: abortController.signal,
      })

      abortControllerRef.current = null

      const aiFullText = result.content || aiTextRef.current

      if (!aiFullText.trim()) {
        conversationHistoryRef.current.pop()
        setState('listening')
        return
      }

      if (result.error && !aiFullText.trim()) {
        options?.onError?.(result.error)
        conversationHistoryRef.current.pop()
        setState('listening')
        return
      }

      options?.onAiTextEnd?.(aiFullText)

      // 阶段 6：过滤舞台指示 → TTS
      const speakableText = stripNonSpeakableContent(aiFullText)
      if (!speakableText.trim()) {
        if (sttTextRef.current.trim() && aiFullText.trim()) {
          options?.onConversationComplete?.(sttTextRef.current, aiFullText)
        }
        aiTextRef.current = ''
        sttTextRef.current = ''
        setAiText('')
        setSttText('')
        setState('listening')
        return
      }

      setState('speaking')
      isSpeakingRef.current = true

      // 阶段 7：TTS（voiceApi 自动分流云端/本地）
      const ttsBlob = await voiceApi.textToSpeech(speakableText, {
        voice: options?.userVoiceConfig?.ttsVoice,
        speed: options?.userVoiceConfig?.ttsSpeed,
        format: 'mp3',
        // 拆分式模式：强制使用用户配置的 TTS，不受 cloudMode 影响
        forceLocal: voiceModeRef.current === 'split',
      })

      // 转为 base64 播放
      const base64 = await blobToBase64(ttsBlob)
      if (base64) {
        ttsQueueRef.current.push({ data: base64, contentType: 'audio/mp3' })
        playTtsQueue()
      }

      // 等待播放完成（轮询）
      const checkPlaybackComplete = setInterval(() => {
        if (!isPlayingRef.current && ttsQueueRef.current.length === 0) {
          clearInterval(checkPlaybackComplete)
          isSpeakingRef.current = false

          if (sttTextRef.current.trim() && aiFullText.trim()) {
            options?.onConversationComplete?.(sttTextRef.current, aiFullText)
          }

          aiTextRef.current = ''
          sttTextRef.current = ''
          setAiText('')
          setSttText('')
          setState('listening')
        }
      }, 200)

    } catch (err) {
      logger.system.error('Voice processing failed:', err)
      isSpeakingRef.current = false
      abortControllerRef.current = null
      options?.onError?.((err as Error).message)
      setState('listening')
    }
  }, [options, playTtsQueue])

  // ============================================================
  // 端到端模式：发送完整音频到后端
  // ============================================================

  const processAudioRealtime = useCallback(async (audioBlob: Blob) => {
    const socket = socketRef.current
    if (!socket || !socket.connected) {
      options?.onError?.('端到端语音连接未建立')
      setState('listening')
      return
    }

    try {
      setState('processing')

      // 将音频转为 WAV 格式
      const wavBlob = await convertBlobToWav(audioBlob)

      // 将 WAV 转为 base64
      const base64Audio = await blobToBase64(wavBlob)

      // 发送完整音频到后端，后端会转发到 OpenAI Realtime API
      socket.emit('voice:audio_complete', {
        data: base64Audio,
        mimeType: 'audio/wav',
        language: options?.language || 'auto',
        pipeline: 'realtime',
      })

      // 后端会通过 voice:tts_audio / voice:stt_final / voice:ai_text 等事件返回结果
      // 这些事件在 setupRealtimeSocketListeners 中处理
    } catch (err) {
      logger.system.error('Realtime voice processing failed:', err)
      options?.onError?.((err as Error).message)
      setState('listening')
    }
  }, [options])

  // ============================================================
  // 端到端模式：设置 WebSocket 事件监听
  // ============================================================

  const setupRealtimeSocketListeners = useCallback((socket: Socket) => {
    // 会话已启动
    socket.on('voice:session_started', (data: { sessionId: string; pipeline: string }) => {
      logger.system.info('[VoiceChat] Realtime session started:', data.sessionId)
    })

    // 用户语音转录完成
    socket.on('voice:stt_final', (data: { text: string; language?: string }) => {
      sttTextRef.current = data.text
      setSttText(data.text)
      options?.onUserText?.(data.text)
    })

    // 用户语音转录增量
    socket.on('voice:stt_partial', (data: { text: string }) => {
      setSttText(data.text)
    })

    // AI 音频增量
    socket.on('voice:tts_audio', (data: { data: string; contentType: string; isFinal: boolean }) => {
      if (data.data) {
        if (!isSpeakingRef.current) {
          isSpeakingRef.current = true
          setState('speaking')
        }
        ttsQueueRef.current.push({ data: data.data, contentType: data.contentType || 'audio/pcm' })
        if (!isPlayingRef.current) {
          playRealtimeAudioChunk(data.data)
          isPlayingRef.current = true
          // 移除刚刚入队的第一个，因为已经直接播放了
          ttsQueueRef.current.shift()
        }
      }
      if (data.isFinal) {
        // 音频流结束
      }
    })

    // TTS 播放结束
    socket.on('voice:tts_end', () => {
      isSpeakingRef.current = false

      // 触发对话完成回调
      if (sttTextRef.current.trim() && aiTextRef.current.trim()) {
        options?.onConversationComplete?.(sttTextRef.current, aiTextRef.current)
      }

      // 重置状态
      aiTextRef.current = ''
      sttTextRef.current = ''
      setAiText('')
      setSttText('')
      setState('listening')
    })

    // AI 文本转录增量
    socket.on('voice:ai_text', (data: { text: string; isFinal: boolean }) => {
      aiTextRef.current += data.text
      setAiText(aiTextRef.current)
      options?.onAiText?.(data.text)
    })

    // AI 文本转录完成
    socket.on('voice:ai_text_end', (data: { text: string }) => {
      aiTextRef.current = data.text
      setAiText(data.text)
      options?.onAiTextEnd?.(data.text)
    })

    // 错误
    socket.on('voice:error', (data: { code: string; message: string }) => {
      logger.system.error('[VoiceChat] Realtime error:', data.code, data.message)
      options?.onError?.(data.message)
      setState('listening')
    })

    // 断开连接
    socket.on('disconnect', () => {
      logger.system.info('[VoiceChat] Realtime socket disconnected')
    })
  }, [options, playRealtimeAudioChunk])

  // ============================================================
  // 端到端模式：建立 WebSocket 连接
  // ============================================================

  const connectRealtimeSocket = useCallback(async (): Promise<void> => {
    const realtimeConfig = options?.realtimeConfig
    if (!realtimeConfig) {
      throw new Error('端到端模式缺少 realtimeConfig 配置')
    }

    // 获取后端地址
    const appConfig = await api.settings.getAppConfig()
    const serverUrl = appConfig?.serverUrl || ''
    if (!serverUrl) {
      throw new Error('未配置后端服务器地址，请在设置中配置')
    }

    // 获取访问令牌
    const tokens = getTokens()
    if (!tokens?.accessToken) {
      throw new Error('未登录，请先登录后再使用端到端语音')
    }

    return new Promise((resolve, reject) => {
      const socketUrl = `${serverUrl}/voice`

      const socket = io(socketUrl, {
        auth: { token: tokens.accessToken },
        transports: ['websocket'],
        reconnection: false,
        timeout: 10_000,
      })

      socketRef.current = socket

      socket.on('connect', () => {
        logger.system.info('[VoiceChat] Realtime socket connected')

        // 发送 voice:start 事件启动会话
        socket.emit('voice:start', {
          language: options?.language || 'auto',
          mode: 'continuous',
          enableVad: false, // 前端 VAD
          pipeline: 'realtime',
          provider: realtimeConfig.model?.includes('gpt') ? 'openai' : 'custom',
          model: realtimeConfig.model || 'gpt-4o-realtime',
          realtimeConfig: {
            endpoint: realtimeConfig.endpoint,
            apiKey: realtimeConfig.apiKey,
            voice: realtimeConfig.voice || 'alloy',
            serverVad: realtimeConfig.serverVad ?? false,
          },
          systemPrompt: options?.systemPrompt,
        })

        setupRealtimeSocketListeners(socket)
        resolve()
      })

      socket.on('connect_error', (err: Error) => {
        logger.system.error('[VoiceChat] Realtime socket connect error:', err.message)
        reject(new Error(`端到端语音连接失败: ${err.message}`))
      })

      socket.on('error', (err: Error) => {
        logger.system.error('[VoiceChat] Realtime socket error:', err.message)
        reject(err)
      })
    })
  }, [options, setupRealtimeSocketListeners])

  // ============================================================
  // 录音控制
  // ============================================================

  const startRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') return
    audioChunksRef.current = []

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm'

    try {
      mediaRecorderRef.current = new MediaRecorder(mediaStreamRef.current!, {
        mimeType,
        audioBitsPerSecond: 16000,
      })

      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      mediaRecorderRef.current.start()
    } catch {
      // 录音启动失败
    }
  }, [])

  const stopRecordingAndSend = useCallback(() => {
    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state !== 'recording') {
      return
    }

    recorder.onstop = () => {
      const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
      audioChunksRef.current = []
      if (audioBlob.size > 0) {
        // 根据模式选择处理路径
        if (voiceModeRef.current === 'realtime') {
          processAudioRealtime(audioBlob)
        } else {
          processAudio(audioBlob)
        }
      } else {
        setState('listening')
      }
    }
    recorder.stop()
  }, [processAudio, processAudioRealtime])

  // ============================================================
  // VAD 检测循环
  // ============================================================

  const startVadDetection = useCallback(() => {
    if (vadTimerRef.current) clearInterval(vadTimerRef.current)

    vadStateRef.current = 'silence'
    speechStartTimeRef.current = 0
    silenceStartTimeRef.current = 0

    vadTimerRef.current = setInterval(() => {
      const analyser = analyserRef.current
      if (!analyser) return

      const dataArray = new Uint8Array(analyser.frequencyBinCount)
      analyser.getByteTimeDomainData(dataArray)

      // 计算 RMS
      let sum = 0
      for (let i = 0; i < dataArray.length; i++) {
        const v = (dataArray[i] - 128) / 128
        sum += v * v
      }
      const rms = Math.sqrt(sum / dataArray.length)
      setVolume(rms)

      const now = Date.now()

      // AI 说话时也检测用户打断
      if (isSpeakingRef.current) {
        if (rms > VAD_THRESHOLD * 2) {
          // 用户打断了 AI
          stopTtsPlayback()

          // 端到端模式：发送打断事件
          if (voiceModeRef.current === 'realtime' && socketRef.current?.connected) {
            socketRef.current.emit('voice:interrupt', { reason: 'user_interrupt' })
          }

          // 拆分式模式：中断当前 LLM 请求
          if (voiceModeRef.current === 'split' && abortControllerRef.current) {
            abortControllerRef.current.abort()
            abortControllerRef.current = null
          }

          isSpeakingRef.current = false
          // 开始录音
          startRecording()
          vadStateRef.current = 'speaking'
          speechStartTimeRef.current = now
          setState('recording')
        }
        return
      }

      // 正常 VAD 状态机
      if (vadStateRef.current === 'silence') {
        // 检测到说话开始
        if (rms > VAD_THRESHOLD) {
          vadStateRef.current = 'speaking'
          speechStartTimeRef.current = now
          silenceStartTimeRef.current = 0
          startRecording()
          setState('recording')
        }
      } else {
        // speaking 状态
        if (rms < VAD_THRESHOLD) {
          // 音量低于阈值
          if (silenceStartTimeRef.current === 0) {
            silenceStartTimeRef.current = now
          }

          // 静音持续时间超过阈值 → 判定说完
          if (now - silenceStartTimeRef.current >= VAD_SILENCE_DELAY) {
            // 最短说话时间检查
            if (now - speechStartTimeRef.current >= VAD_MIN_SPEECH_TIME) {
              stopRecordingAndSend()
              vadStateRef.current = 'silence'
              silenceStartTimeRef.current = 0
            } else {
              // 太短，视为噪音，重置
              const recorder = mediaRecorderRef.current
              if (recorder?.state === 'recording') {
                recorder.onstop = () => {
                  audioChunksRef.current = []
                }
                recorder.stop()
              }
              vadStateRef.current = 'silence'
              setState('listening')
            }
          }
        } else {
          // 还在说话，重置静音计时
          silenceStartTimeRef.current = 0
        }
      }
    }, VAD_CHECK_INTERVAL)
  }, [startRecording, stopRecordingAndSend, stopTtsPlayback])

  const stopVadDetection = useCallback(() => {
    if (vadTimerRef.current) {
      clearInterval(vadTimerRef.current)
      vadTimerRef.current = null
    }
  }, [])

  // ============================================================
  // 连接 / 断开
  // ============================================================

  const connect = useCallback(async () => {
    const mode = options?.cloudMode || 'cloud'
    const voiceMode = options?.voiceMode || 'split'
    cloudModeRef.current = mode
    voiceModeRef.current = voiceMode

    setState('connecting')

    try {
      // 创建 AudioContext + AnalyserNode
      audioContextRef.current = new AudioContext({ sampleRate: SAMPLE_RATE })
      mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: SAMPLE_RATE,
          channelCount: 1,
        },
      })

      const source = audioContextRef.current.createMediaStreamSource(mediaStreamRef.current)
      const analyser = audioContextRef.current.createAnalyser()
      analyser.fftSize = 512
      analyser.smoothingTimeConstant = 0.5
      source.connect(analyser)
      analyserRef.current = analyser

      // 初始化对话历史
      conversationHistoryRef.current = []

      // 端到端模式：建立 WebSocket 连接
      if (voiceMode === 'realtime') {
        await connectRealtimeSocket()
      }

      // 启动 VAD（两种模式都一样）
      startVadDetection()
      setState('listening')
    } catch (err) {
      logger.system.error('Failed to connect voice chat:', err)
      setState('error')
      options?.onError?.((err as Error).message)
    }
  }, [options, startVadDetection, connectRealtimeSocket])

  const disconnect = useCallback(() => {
    stopVadDetection()
    stopTtsPlayback()

    // 中断当前 LLM 请求
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }

    // 端到端模式：断开 WebSocket
    if (socketRef.current) {
      socketRef.current.emit('voice:end', {})
      socketRef.current.disconnect()
      socketRef.current = null
    }

    // 停止录音
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop()
    }

    // 关闭媒体流
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => t.stop())
      mediaStreamRef.current = null
    }

    // 关闭 AudioContext
    if (audioContextRef.current) {
      audioContextRef.current.close()
      audioContextRef.current = null
    }
    analyserRef.current = null

    // 清理对话历史
    conversationHistoryRef.current = []

    isSpeakingRef.current = false
    aiTextRef.current = ''
    sttTextRef.current = ''
    setState('idle')
  }, [stopVadDetection, stopTtsPlayback])

  // 手动打断 AI
  const interrupt = useCallback(() => {
    if (isSpeakingRef.current) {
      stopTtsPlayback()
      isSpeakingRef.current = false

      // 端到端模式：发送打断事件
      if (voiceModeRef.current === 'realtime' && socketRef.current?.connected) {
        socketRef.current.emit('voice:interrupt', { reason: 'user_interrupt' })
      }

      // 拆分式模式：中断当前 LLM 请求
      if (voiceModeRef.current === 'split' && abortControllerRef.current) {
        abortControllerRef.current.abort()
        abortControllerRef.current = null
      }

      setState('listening')
    }
  }, [stopTtsPlayback])

  // 清理
  useEffect(() => {
    return () => {
      disconnect()
    }
  }, [disconnect])

  return {
    state,
    volume,
    sttText,
    aiText,
    connect,
    disconnect,
    interrupt,
  }
}
