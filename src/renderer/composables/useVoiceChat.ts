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

/**
 * 前端 VAD + 统一语音对话 hook
 *
 * 核心设计：云端模式和本地模式走完全相同的 AI 能力路径
 *
 * 【统一流程】（两种模式都一样）
 * 1. 前端 VAD 检测说话开始/结束
 * 2. 完整录音 → voiceApi.speechToText()（自动分流：云端→后端 API，本地→用户配置）
 * 3. runVoiceToolLoop()（走客户端主进程 api.llm.send()，支持工具调用和插件）
 *    - 云端模式：LLM 配置含 cloudMode=true/serverUrl/accessToken，主进程路由到后端代理
 *    - 本地模式：LLM 配置含 apiKey/baseUrl，直连用户配置的模型
 * 4. stripNonSpeakableContent() 过滤舞台指示
 * 5. voiceApi.textToSpeech()（自动分流：云端→后端 API，本地→用户配置）
 * 6. 前端播放音频
 *
 * 关键优势：
 * - 两种模式都支持完整的工具调用和插件能力（与普通文字对话完全对等）
 * - 前端 VAD 更可靠（直接在浏览器分析，无网络延迟）
 * - STT/TTS 自动根据 cloudMode 分流，云端模式计 Token，本地模式用用户自己的 Key
 */

export type VoiceChatState =
  | 'idle'          // 未连接
  | 'connecting'    // 连接中
  | 'listening'     // 聆听中（等待用户说话）
  | 'recording'     // 录音中（检测到用户在说话）
  | 'processing'    // 处理中（STT → LLM → 工具调用）
  | 'speaking'      // AI 说话中（播放 TTS）
  | 'error'         // 错误

export interface VoiceChatOptions {
  /** 语言 */
  language?: string
  /** 云端/本地模式（决定 STT/TTS 走后端还是用户配置） */
  cloudMode?: 'cloud' | 'local'
  /** 完整 LLM 配置（云端模式含 cloudMode/serverUrl/accessToken，本地模式含 apiKey/baseUrl） */
  llmConfig?: LLMConfig
  /** 系统提示词 */
  systemPrompt?: string
  /** 工作区路径（让 AI 知道用户当前的工作目录） */
  workspacePath?: string
  /** 当前打开的文件列表 */
  openFiles?: string[]
  /** 当前激活的文件 */
  activeFile?: string
  /** 用户自定义 STT/TTS 配置 */
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

// VAD 参数
const VAD_THRESHOLD = 0.015      // 说话检测阈值（RMS）
const VAD_SILENCE_DELAY = 1500   // 说话结束后等待多久（ms）判定说完
const VAD_MIN_SPEECH_TIME = 300  // 最短说话时间（ms），短于此视为噪音
const VAD_CHECK_INTERVAL = 100   // VAD 检测间隔（ms）
const SAMPLE_RATE = 16000        // 采样率
// 对话历史裁剪：保留 system + 最近 N 条消息
const MAX_HISTORY_MESSAGES = 30

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

  // refs - 对话历史（LLMMessage 格式，支持工具调用上下文）
  const conversationHistoryRef = useRef<LLMMessage[]>([])

  // refs - 中断控制
  const abortControllerRef = useRef<AbortController | null>(null)

  // refs - TTS 播放
  const ttsAudioContextRef = useRef<AudioContext | null>(null)
  const ttsQueueRef = useRef<{ data: string; contentType: string }[]>([])
  const isPlayingRef = useRef(false)

  // ============================================================
  // TTS 播放
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
  // 核心：统一处理完整音频（STT → LLM+工具 → TTS → 播放）
  // ============================================================

  const processAudio = useCallback(async (audioBlob: Blob) => {
    try {
      const wavBlob = await convertBlobToWav(audioBlob)

      // 阶段 1：STT（voiceApi 自动分流云端/本地）
      setState('processing')
      const sttResult = await voiceApi.speechToText(wavBlob, {
        language: options?.language,
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
      const llmConfig: LLMConfig = options?.llmConfig || {
        provider: 'openai',
        model: 'gpt-4o',
        apiKey: '',
        baseUrl: '',
      }

      // 阶段 4：构建消息列表
      // 首次调用时初始化 system 消息
      if (conversationHistoryRef.current.length === 0) {
        conversationHistoryRef.current.push({
          role: 'system',
          content: systemPrompt,
        })
      }

      // 添加用户消息
      conversationHistoryRef.current.push({
        role: 'user',
        content: sttResult.text,
      })

      // 裁剪历史（保留 system + 最近 N 条消息）
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
      // runVoiceToolLoop 会 mutate messages 数组（追加 assistant/tool 消息）
      // 内部会通过 onTextChunk 回调流式输出文本
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

      // 清理 abort controller
      abortControllerRef.current = null

      const aiFullText = result.content || aiTextRef.current

      if (!aiFullText.trim()) {
        // LLM 没有返回文本，回到聆听状态
        // 移除刚才添加的用户消息（因为没有对应的 AI 回复）
        conversationHistoryRef.current.pop()
        setState('listening')
        return
      }

      // 如果有错误但仍有文本，继续 TTS（部分结果也读出来）
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
        // 没有可朗读的内容，直接回到聆听
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
      })

      // 转为 base64 播放
      const reader = new FileReader()
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1]
        if (base64) {
          ttsQueueRef.current.push({ data: base64, contentType: 'audio/mp3' })
          playTtsQueue()
        }
      }
      reader.readAsDataURL(ttsBlob)

      // 等待播放完成（轮询）
      const checkPlaybackComplete = setInterval(() => {
        if (!isPlayingRef.current && ttsQueueRef.current.length === 0) {
          clearInterval(checkPlaybackComplete)
          isSpeakingRef.current = false

          // 触发对话完成回调
          if (sttTextRef.current.trim() && aiFullText.trim()) {
            options?.onConversationComplete?.(sttTextRef.current, aiFullText)
          }

          // 重置状态，准备下一轮对话
          aiTextRef.current = ''
          sttTextRef.current = ''
          setAiText('')
          setSttText('')
          setState('listening')
        }
      }, 200)

    } catch (err) {
      console.error('Voice processing failed:', err)
      isSpeakingRef.current = false
      abortControllerRef.current = null
      options?.onError?.((err as Error).message)
      setState('listening')
    }
  }, [options, playTtsQueue])

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
        processAudio(audioBlob)
      } else {
        setState('listening')
      }
    }
    recorder.stop()
  }, [processAudio])

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

          // 中断当前 LLM 请求
          if (abortControllerRef.current) {
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
    cloudModeRef.current = mode

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

      // 启动 VAD（两种模式都一样，不需要 WebSocket）
      startVadDetection()
      setState('listening')
    } catch (err) {
      console.error('Failed to connect voice chat:', err)
      setState('error')
      options?.onError?.((err as Error).message)
    }
  }, [options, startVadDetection])

  const disconnect = useCallback(() => {
    stopVadDetection()
    stopTtsPlayback()

    // 中断当前 LLM 请求
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
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

      // 中断当前 LLM 请求
      if (abortControllerRef.current) {
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
