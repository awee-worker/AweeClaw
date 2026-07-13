import { useCallback, useEffect, useRef, useState } from 'react'
import { io, Socket } from 'socket.io-client'
import { getServerUrl, getAccessToken } from '../adapters/backendApi'
import { convertBlobToWav } from '../utils/audioConverter'
import { useAgentStore } from '@intelligence/state/IntelligenceStore'

/**
 * 前端 VAD + 整段音频发送的语音对话 hook
 *
 * 技术路线：
 * 1. 用 Web Audio API 的 AnalyserNode 实时检测音量
 * 2. 音量超过阈值 → 标记"说话开始"
 * 3. 音量低于阈值持续 N 秒 → 标记"说话结束"
 * 4. 把完整录音转 WAV → base64 → 一次性发给后端
 * 5. 后端收到完整音频 → STT → LLM → TTS → 回传音频
 *
 * 优点：
 * - 前端 VAD 更可靠（直接在浏览器分析，无网络延迟）
 * - 后端逻辑极简（收到完整音频直接处理）
 * - 调试方便（前端能看到 VAD 状态和音量值）
 */

export type VoiceChatState =
  | 'idle'          // 未连接
  | 'connecting'    // 连接中
  | 'listening'     // 聆听中（等待用户说话）
  | 'recording'     // 录音中（检测到用户在说话）
  | 'processing'    // 处理中（STT → LLM）
  | 'speaking'      // AI 说话中（播放 TTS）
  | 'error'         // 错误

export interface VoiceChatOptions {
  /** 语言 */
  language?: string
  /** LLM provider */
  provider?: string
  /** LLM model */
  model?: string
  /** 系统提示词 */
  systemPrompt?: string
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
   * 触发时机：AI 音频播放完毕（TTS_END）
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

export function useVoiceChat(options?: VoiceChatOptions) {
  const [state, setState] = useState<VoiceChatState>('idle')
  const [volume, setVolume] = useState(0)
  const [sttText, setSttText] = useState('')
  const [aiText, setAiText] = useState('')

  // refs
  const socketRef = useRef<Socket | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const vadTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const vadStateRef = useRef<'silence' | 'speaking'>('silence')
  const speechStartTimeRef = useRef(0)
  const silenceStartTimeRef = useRef(0)
  const isSpeakingRef = useRef(false)  // AI 是否在说话
  const aiTextRef = useRef('')
  const sttTextRef = useRef('')

  // 播放 TTS 音频
  const ttsAudioContextRef = useRef<AudioContext | null>(null)
  const ttsQueueRef = useRef<{ data: string; contentType: string }[]>([])
  const isPlayingRef = useRef(false)

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

  // 停止所有 TTS 播放
  const stopTtsPlayback = useCallback(() => {
    ttsQueueRef.current = []
    isPlayingRef.current = false
    if (ttsAudioContextRef.current) {
      // 关闭后重建
      ttsAudioContextRef.current.close()
      ttsAudioContextRef.current = null
    }
  }, [])

  // 发送完整音频给后端
  const sendAudioToBackend = useCallback(async (audioBlob: Blob) => {
    const socket = socketRef.current
    if (!socket?.connected) return

    try {
      const wavBlob = await convertBlobToWav(audioBlob)
      const reader = new FileReader()
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1]
        if (base64 && socket.connected) {
          setState('processing')
          // 一次性发送完整音频
          socket.emit('voice:audio_complete', {
            data: base64,
            mimeType: 'audio/wav',
            language: options?.language || 'auto',
            provider: options?.provider,
            model: options?.model,
            systemPrompt: options?.systemPrompt,
            userVoiceConfig: options?.userVoiceConfig,
          })
        }
      }
      reader.readAsDataURL(wavBlob)
    } catch (err) {
      console.error('Failed to send audio:', err)
      setState('listening')
    }
  }, [options])

  // 开始录音
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

  // 停止录音并发送
  const stopRecordingAndSend = useCallback(() => {
    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state !== 'recording') {
      return
    }

    recorder.onstop = () => {
      const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
      audioChunksRef.current = []
      if (audioBlob.size > 0) {
        sendAudioToBackend(audioBlob)
      } else {
        setState('listening')
      }
    }
    recorder.stop()
  }, [sendAudioToBackend])

  // VAD 检测循环
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
          isSpeakingRef.current = false
          socketRef.current?.emit('voice:interrupt', { reason: 'user_interrupt' })
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

  // 停止 VAD
  const stopVadDetection = useCallback(() => {
    if (vadTimerRef.current) {
      clearInterval(vadTimerRef.current)
      vadTimerRef.current = null
    }
  }, [])

  // 连接
  const connect = useCallback(async () => {
    const serverUrl = getServerUrl()
    const token = getAccessToken()
    if (!serverUrl || !token) {
      setState('error')
      return
    }

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

      // 连接 WebSocket
      const socket = io(`${serverUrl}/voice`, {
        transports: ['websocket'],
        auth: { token },
        reconnection: false,
        timeout: 5000,
      })

      socketRef.current = socket

      await new Promise<void>((resolve, reject) => {
        socket.on('connect', () => resolve())
        socket.on('connect_error', (err) => reject(new Error(err.message)))
      })

      // 注册事件
      socket.on('voice:stt_final', (data: { text: string }) => {
        sttTextRef.current = data.text
        setSttText(data.text)
        options?.onUserText?.(data.text)
      })

      socket.on('voice:ai_text', (data: { text: string }) => {
        aiTextRef.current += data.text
        setAiText(aiTextRef.current)
        options?.onAiText?.(data.text)
      })

      socket.on('voice:ai_text_end', (data: { text: string }) => {
        aiTextRef.current = data.text
        setAiText(data.text)
        options?.onAiTextEnd?.(data.text)
      })

      socket.on('voice:tts_audio', (data: { data: string; contentType: string }) => {
        if (!isSpeakingRef.current) {
          isSpeakingRef.current = true
          setState('speaking')
        }
        ttsQueueRef.current.push({ data: data.data, contentType: data.contentType })
        playTtsQueue()
      })

      socket.on('voice:tts_end', () => {
        isSpeakingRef.current = false

        // 触发对话完成回调，让上层把对话保存到聊天历史
        const userText = sttTextRef.current
        const aiFullText = aiTextRef.current
        if (userText.trim() && aiFullText.trim()) {
          options?.onConversationComplete?.(userText, aiFullText)
        }

        // 重置状态，准备下一轮对话
        aiTextRef.current = ''
        sttTextRef.current = ''
        setAiText('')
        setSttText('')
        setState('listening')
      })

      socket.on('voice:error', (data: { code: string; message: string }) => {
        console.error('Voice error:', data)
        options?.onError?.(data.message)
        setState('listening')
      })

      socket.on('disconnect', () => {
        setState('idle')
      })

      // 启动会话
      socket.emit('voice:start', {
        mode: 'continuous',
        language: options?.language || 'auto',
      })

      // 启动 VAD
      startVadDetection()
      setState('listening')
    } catch (err) {
      console.error('Failed to connect voice chat:', err)
      setState('error')
      options?.onError?.((err as Error).message)
    }
  }, [options, startVadDetection, playTtsQueue])

  // 断开
  const disconnect = useCallback(() => {
    stopVadDetection()
    stopTtsPlayback()

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

    // 断开 Socket
    if (socketRef.current) {
      socketRef.current.emit('voice:end', {})
      socketRef.current.disconnect()
      socketRef.current = null
    }

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
      socketRef.current?.emit('voice:interrupt', { reason: 'user_manual' })
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
