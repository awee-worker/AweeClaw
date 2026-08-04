/**
 * useWakeWordEngine - 语音唤醒词检测引擎
 *
 * 职责：
 * 1. 持续监听麦克风（当唤醒开关开启且未暂停时）
 * 2. 前端 VAD 检测说话开始/结束
 * 3. 说话结束后，将音频发送到 STT（复用 voiceApi.speechToText）
 * 4. 用 matchWakeWord 匹配转写文本与唤醒词
 * 5. 命中后触发 onWakeWordDetected 回调，进入冷却期
 *
 * 暂停条件（paused = true 时停止检测）：
 * - 主窗口全功能语音对话激活（避免双窗口同时录音冲突）
 * - 头像窗口自身语音对话激活（避免自反馈）
 * - 唤醒开关关闭
 *
 * 性能优化：
 * - VAD 检测间隔 200ms（比 useVoiceChat 的 100ms 更宽松，降低 CPU 占用）
 * - STT 使用本地模式（forceLocal: true），避免每次唤醒检测都消耗云端配额
 * - 冷却期内不录音，降低麦克风 + STT 负载
 *
 * 使用方式：
 *   const engine = useWakeWordEngine({
 *     enabled: wakeWordConfig?.enabled ?? false,
 *     keyword: wakeWordConfig?.keyword ?? '小喵小喵',
 *     sensitivity: wakeWordConfig?.sensitivity ?? 'balanced',
 *     cooldownMs: wakeWordConfig?.cooldownMs ?? 3000,
 *     minSpeechMs: wakeWordConfig?.minSpeechMs ?? 300,
 *     paused: mainConversationActive || avatarConversationActive,
 *     onWakeWordDetected: handleWake,
 *   })
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { convertBlobToWav } from '../utils/audioConverter'
import { voiceApi } from '../services/voiceApi'
import { matchWakeWord } from '../utils/voiceTextUtils'
import { logger } from '@shared/toolkit/LogEngine'

// ============================================
// 类型定义
// ============================================

export interface WakeWordEngineOptions {
  /** 唤醒开关 */
  enabled: boolean
  /** 唤醒词（如「小喵小喵」） */
  keyword: string
  /** 灵敏度 */
  sensitivity: 'strict' | 'balanced' | 'loose'
  /** 冷却时间（ms），命中后在此期间不再检测 */
  cooldownMs: number
  /** 最短说话时间（ms），短于此视为噪音 */
  minSpeechMs: number
  /** 是否暂停（主窗口对话激活或头像对话激活时为 true） */
  paused: boolean
  /** 唤醒词命中回调 */
  onWakeWordDetected: (info: { keyword: string; transcript: string; confidence: number }) => void
  /** 错误回调（可选） */
  onError?: (message: string) => void
}

export interface WakeWordEngineState {
  /** 引擎是否正在运行（已获取麦克风权限并开始 VAD） */
  running: boolean
  /** 是否处于冷却期 */
  cooling: boolean
  /** 是否正在检测说话（recording 状态） */
  detecting: boolean
  /** 是否正在 STT 转写中 */
  transcribing: boolean
  /** 实时音量（0-1） */
  volume: number
  /** 最近一次错误 */
  error: string | null
  /** 是否处于启动延迟期（等待 STARTUP_DELAY 后才获取麦克风） */
  pending: boolean
}

// ============================================
// VAD 常量（比 useVoiceChat 更宽松，降低 CPU 占用）
// ============================================

const VAD_THRESHOLD = 0.012      // 说话检测阈值（RMS），降低阈值提高灵敏度
const VAD_SILENCE_DELAY = 1000   // 说话结束后等待多久（ms）判定说完
const VAD_CHECK_INTERVAL = 200   // VAD 检测间隔（ms），比 useVoiceChat 更宽松
const SAMPLE_RATE = 16000        // 采样率

/** 启动延迟（ms）：应用启动后等待一段时间再获取麦克风，避免启动瞬间占用麦克风 */
const STARTUP_DELAY = 5000

// ============================================
// 主 hook
// ============================================

export function useWakeWordEngine(options: WakeWordEngineOptions): WakeWordEngineState {
  const {
    enabled,
    keyword,
    sensitivity,
    cooldownMs,
    minSpeechMs,
    paused,
    onWakeWordDetected,
    onError,
  } = options

  const [running, setRunning] = useState(false)
  const [cooling, setCooling] = useState(false)
  const [detecting, setDetecting] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [volume, setVolume] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

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

  // refs - 冷却
  const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastDetectTimeRef = useRef(0)

  // refs - 启动延迟定时器
  const startupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // refs - 最新配置（避免闭包旧值）
  const keywordRef = useRef(keyword)
  const sensitivityRef = useRef(sensitivity)
  const minSpeechMsRef = useRef(minSpeechMs)
  const onWakeWordDetectedRef = useRef(onWakeWordDetected)
  const onErrorRef = useRef(onError)

  keywordRef.current = keyword
  sensitivityRef.current = sensitivity
  minSpeechMsRef.current = minSpeechMs
  onWakeWordDetectedRef.current = onWakeWordDetected
  onErrorRef.current = onError

  // --------------------------------------------
  // 录音控制
  // --------------------------------------------

  const startRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') return
    if (!mediaStreamRef.current) return

    audioChunksRef.current = []
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm'

    try {
      mediaRecorderRef.current = new MediaRecorder(mediaStreamRef.current, {
        mimeType,
        audioBitsPerSecond: 16000,
      })
      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }
      mediaRecorderRef.current.start()
    } catch (err) {
      logger.system.warn('[WakeWordEngine] Failed to start recording:', err)
    }
  }, [])

  const stopRecordingAndTranscribe = useCallback(async () => {
    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state !== 'recording') return

    const speechDuration = Date.now() - speechStartTimeRef.current
    if (speechDuration < minSpeechMsRef.current) {
      // 太短，视为噪音，丢弃
      recorder.onstop = () => {
        audioChunksRef.current = []
      }
      recorder.stop()
      return
    }

    // 等待 recorder.stop() 触发 onstop，然后处理音频
    const audioBlob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
        audioChunksRef.current = []
        resolve(blob)
      }
      recorder.stop()
    })

    if (audioBlob.size === 0) return

    // STT 转写
    setTranscribing(true)
    try {
      const wavBlob = await convertBlobToWav(audioBlob)
      // 使用用户配置的 STT 路径（云端或本地），不强制 forceLocal
      // 否则用户未配置本地 STT 时会直接抛错导致唤醒功能不可用
      const sttResult = await voiceApi.speechToText(wavBlob)

      const transcript = sttResult.text?.trim() || ''
      if (!transcript) {
        logger.system.debug('[WakeWordEngine] Empty transcript, skip')
        return
      }

      // 唤醒词匹配
      const matched = matchWakeWord(
        transcript,
        keywordRef.current,
        sensitivityRef.current,
      )

      if (matched) {
        logger.system.info('[WakeWordEngine] Wake word detected!', {
          keyword: keywordRef.current,
          transcript,
        })

        // 通知回调
        onWakeWordDetectedRef.current({
          keyword: keywordRef.current,
          transcript,
          confidence: sttResult.confidence || 1,
        })

        // 进入冷却期
        enterCooldown()
      } else {
        logger.system.debug('[WakeWordEngine] Not matched', {
          transcript,
          keyword: keywordRef.current,
        })
      }
    } catch (err) {
      const msg = (err as Error).message || String(err)
      logger.system.warn('[WakeWordEngine] STT failed:', msg)
      // STT 配置缺失时给出更明确的提示
      if (msg.includes('STT') || msg.includes('stt')) {
        onErrorRef.current?.(`语音识别失败：${msg}。请在「设置 → 语音设置」中检查 STT 配置。`)
      } else {
        onErrorRef.current?.(`语音识别失败：${msg}`)
      }
    } finally {
      setTranscribing(false)
    }
  }, [])

  // --------------------------------------------
  // 冷却期管理
  // --------------------------------------------

  const enterCooldown = useCallback(() => {
    lastDetectTimeRef.current = Date.now()
    setCooling(true)
    if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current)
    cooldownTimerRef.current = setTimeout(() => {
      setCooling(false)
      cooldownTimerRef.current = null
    }, cooldownMs)
  }, [cooldownMs])

  // --------------------------------------------
  // VAD 检测循环
  // --------------------------------------------

  const startVadDetection = useCallback(() => {
    if (vadTimerRef.current) clearInterval(vadTimerRef.current)

    vadStateRef.current = 'silence'
    speechStartTimeRef.current = 0
    silenceStartTimeRef.current = 0
    setDetecting(false)

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

      if (vadStateRef.current === 'silence') {
        // 检测到说话开始
        if (rms > VAD_THRESHOLD) {
          vadStateRef.current = 'speaking'
          speechStartTimeRef.current = now
          silenceStartTimeRef.current = 0
          startRecording()
          setDetecting(true)
          logger.system.debug('[WakeWordEngine] Speech detected', { rms: rms.toFixed(4) })
        }
      } else {
        // speaking 状态
        if (rms < VAD_THRESHOLD) {
          if (silenceStartTimeRef.current === 0) {
            silenceStartTimeRef.current = now
          }
          // 静音持续超过阈值 → 判定说完
          if (now - silenceStartTimeRef.current >= VAD_SILENCE_DELAY) {
            const duration = now - speechStartTimeRef.current
            logger.system.debug('[WakeWordEngine] Speech ended', {
              durationMs: duration,
              rms: rms.toFixed(4),
            })
            stopRecordingAndTranscribe()
            vadStateRef.current = 'silence'
            silenceStartTimeRef.current = 0
            setDetecting(false)
          }
        } else {
          // 还在说话，重置静音计时
          silenceStartTimeRef.current = 0
        }
      }
    }, VAD_CHECK_INTERVAL)
  }, [startRecording, stopRecordingAndTranscribe])

  const stopVadDetection = useCallback(() => {
    if (vadTimerRef.current) {
      clearInterval(vadTimerRef.current)
      vadTimerRef.current = null
    }
    vadStateRef.current = 'silence'
    setDetecting(false)
    setVolume(0)
  }, [])

  // --------------------------------------------
  // 启动/停止引擎（响应 enabled + paused 变化）
  // --------------------------------------------

  const startEngine = useCallback(async () => {
    if (running) return
    if (!enabled || paused) return

    try {
      // 创建 AudioContext + 获取麦克风
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

      startVadDetection()
      setRunning(true)
      setError(null)
      logger.system.info('[WakeWordEngine] Started', { keyword })
    } catch (err) {
      const msg = (err as Error).message
      logger.system.error('[WakeWordEngine] Start failed:', err)
      setError(msg)
      onErrorRef.current?.(msg)
      setRunning(false)
    }
  }, [enabled, paused, running, startVadDetection, keyword])

  const stopEngine = useCallback(() => {
    // 清除启动延迟定时器
    if (startupTimerRef.current) {
      clearTimeout(startupTimerRef.current)
      startupTimerRef.current = null
    }
    setPending(false)

    stopVadDetection()

    // 停止录音
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      try {
        mediaRecorderRef.current.onstop = () => {
          audioChunksRef.current = []
        }
        mediaRecorderRef.current.stop()
      } catch {
        /* ignore */
      }
    }

    // 关闭媒体流
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop())
      mediaStreamRef.current = null
    }

    // 关闭 AudioContext
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close()
      } catch {
        /* ignore */
      }
      audioContextRef.current = null
    }
    analyserRef.current = null

    // 清除冷却定时器
    if (cooldownTimerRef.current) {
      clearTimeout(cooldownTimerRef.current)
      cooldownTimerRef.current = null
    }

    setRunning(false)
    setCooling(false)
    setDetecting(false)
    setVolume(0)
    logger.system.info('[WakeWordEngine] Stopped')
  }, [stopVadDetection])

  // 响应 enabled / paused 变化（带启动延迟，避免应用启动瞬间占用麦克风）
  useEffect(() => {
    if (enabled && !paused) {
      // 延迟启动：等待 STARTUP_DELAY 后再获取麦克风
      // 避免应用启动瞬间就占用麦克风（macOS 状态栏会显示麦克风图标）
      setPending(true)
      startupTimerRef.current = setTimeout(() => {
        startupTimerRef.current = null
        setPending(false)
        void startEngine()
      }, STARTUP_DELAY)
    } else {
      stopEngine()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, paused])

  // 卸载时清理
  useEffect(() => {
    return () => {
      stopEngine()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    running,
    cooling,
    detecting,
    transcribing,
    volume,
    error,
    pending,
  }
}
