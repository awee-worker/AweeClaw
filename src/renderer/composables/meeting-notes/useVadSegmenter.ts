/**
 * 会议纪要 VAD 分段器（L1 RMS + L2 频谱环境过滤）
 *
 * 职责：
 * 1. 持续监听麦克风（start 后到 pause/finish 前）
 * 2. L1：基于 RMS 阈值检测说话开始/结束
 * 3. L2：基于频谱特征（质心/ZCR/平坦度）过滤环境音（键盘/敲击/白噪）
 * 4. 说话段切分：开始说话 → 录音 → 静音超过 SILENCE_DELAY → 切段，触发 onSegment 回调
 *
 * 与 useWakeWordEngine 的差异：
 * - 不做唤醒词匹配，每次说完即切段输出
 * - 增加 L2 频谱特征过滤，环境音不进 STT
 * - 段时长上限：30s（避免单段过长导致 STT 超时）
 *
 * 性能：
 * - VAD 检测间隔 100ms（平衡响应速度与 CPU 占用）
 * - 录音格式：audio/webm;codecs=opus（与 STT 兼容）
 * - AudioContext 采样率 16000（与 Whisper 模型一致）
 *
 * 使用方式：
 *   const seg = useVadSegmenter({ onSegment: (audio, features) => {...} })
 *   seg.start()
 *   seg.pause()
 *   seg.resume()
 *   seg.stop()
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { logger } from '@shared/toolkit/LogEngine'
import {
  extractFeatures,
  detectVoice,
  RMS_SILENCE,
  RMS_SPEECH,
  type AudioFeatures,
} from '../../utils/audioAnalysis'

// ============================================
// 类型定义
// ============================================

export interface SegmentFeatures {
  /** 段平均 RMS */
  rms: number
  /** 段平均人声概率 0-1 */
  voiceLikelihood: number
  /** 是否判定为环境音 */
  isEnvironment: boolean
  /** 段时长（ms） */
  durationMs: number
}

export interface VadSegmenterOptions {
  /** 录音状态：true=录音中，false=暂停 */
  active: boolean
  /** 检测到新段时回调（已切分好的音频 Blob + 段特征） */
  onSegment: (audioBlob: Blob, features: SegmentFeatures) => void
  /** 错误回调 */
  onError?: (message: string) => void
  /** 音量回调（实时音量 0-1，用于 UI 显示） */
  onVolume?: (volume: number) => void
  /** VAD 状态变化回调（speaking/silence） */
  onVadState?: (speaking: boolean) => void
}

export interface VadSegmenterState {
  /** 是否已获取麦克风权限并正在监听 */
  running: boolean
  /** 是否正在说话（VAD 检测到语音活动） */
  speaking: boolean
  /** 实时音量 0-1 */
  volume: number
  /** 错误信息 */
  error: string | null
}

// ============================================
// 常量
// ============================================

const VAD_CHECK_INTERVAL = 100       // VAD 检测间隔（ms）
const SILENCE_DELAY = 1200           // 静音超过此时长判定说完（ms）
const MIN_SPEECH_MS = 350            // 最短说话时长（短于此视为噪音丢弃）
const MAX_SPEECH_MS = 30000          // 单段最长时长（超过强制切段）
const FFT_SIZE = 1024                // FFT 大小（频谱分析精度）
const SAMPLE_RATE = 16000            // 采样率（与 Whisper 一致）

// ============================================
// Hook 实现
// ============================================

export function useVadSegmenter(options: VadSegmenterOptions): VadSegmenterState {
  const { active, onSegment, onError, onVolume, onVadState } = options

  const [running, setRunning] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [volume, setVolume] = useState(0)
  const [error, setError] = useState<string | null>(null)

  // refs - 音频采集
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])

  // refs - 时域/频域数据缓冲
  // 显式指定为 Uint8Array<ArrayBuffer>，避免 TS 5.7+ 严格模式下的 ArrayBufferLike 类型不兼容
  const timeDataRef = useRef<Uint8Array<ArrayBuffer>>(
    new Uint8Array(new ArrayBuffer(FFT_SIZE)) as Uint8Array<ArrayBuffer>,
  )
  const freqDataRef = useRef<Uint8Array<ArrayBuffer>>(
    new Uint8Array(new ArrayBuffer(FFT_SIZE / 2)) as Uint8Array<ArrayBuffer>,
  )

  // refs - VAD 状态机
  const vadTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const vadStateRef = useRef<'silence' | 'speaking'>('silence')
  const speechStartTimeRef = useRef(0)
  const silenceStartTimeRef = useRef(0)
  const lastSegmentEndTimeRef = useRef(0)

  // refs - 段内特征累计
  const segmentRmsAccRef = useRef(0)
  const segmentRmsCountRef = useRef(0)
  const segmentLikelihoodAccRef = useRef(0)
  const segmentLikelihoodCountRef = useRef(0)
  /** 段内环境音帧数（用于计算环境音帧占比） */
  const segmentEnvFrameCountRef = useRef(0)
  /** 段内是否曾出现明确环境音帧（保留用于日志诊断，不再直接决定整段标记） */
  const segmentIsEnvironmentRef = useRef(false)

  // refs - 最新回调（避免闭包旧值）
  const onSegmentRef = useRef(onSegment)
  const onErrorRef = useRef(onError)
  const onVolumeRef = useRef(onVolume)
  const onVadStateRef = useRef(onVadState)
  const activeRef = useRef(active)

  onSegmentRef.current = onSegment
  onErrorRef.current = onError
  onVolumeRef.current = onVolume
  onVadStateRef.current = onVadState
  activeRef.current = active

  // --------------------------------------------
  // 内部工具
  // --------------------------------------------

  const emitError = useCallback((msg: string): void => {
    setError(msg)
    onErrorRef.current?.(msg)
    logger.system.warn('[VadSegmenter] Error:', msg)
  }, [])

  const setSpeakingState = useCallback((next: boolean): void => {
    if (vadStateRef.current === (next ? 'speaking' : 'silence')) return
    vadStateRef.current = next ? 'speaking' : 'silence'
    setSpeaking(next)
    onVadStateRef.current?.(next)
  }, [])

  /** 启动 MediaRecorder 录音 */
  const startRecorder = useCallback((): void => {
    if (!mediaStreamRef.current) return
    if (mediaRecorderRef.current?.state === 'recording') return

    audioChunksRef.current = []
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm'

    try {
      const recorder = new MediaRecorder(mediaStreamRef.current, {
        mimeType,
        audioBitsPerSecond: 16000,
      })
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }
      recorder.start()
      mediaRecorderRef.current = recorder
    } catch (err) {
      emitError(`启动录音失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }, [emitError])

  /** 停止录音并获取音频 Blob */
  const stopRecorder = useCallback(async (): Promise<Blob | null> => {
    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state !== 'recording') return null

    const blob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
        audioChunksRef.current = []
        resolve(audioBlob)
      }
      recorder.stop()
    })

    mediaRecorderRef.current = null
    return blob
  }, [])

  /** 切段并触发回调 */
  const finalizeSegment = useCallback(async (): Promise<void> => {
    const duration = lastSegmentEndTimeRef.current - speechStartTimeRef.current
    if (duration < MIN_SPEECH_MS) {
      // 段过短，丢弃
      await stopRecorder()
      return
    }

    const audioBlob = await stopRecorder()
    if (!audioBlob || audioBlob.size === 0) return

    // 计算段平均特征
    const avgRms = segmentRmsCountRef.current > 0
      ? segmentRmsAccRef.current / segmentRmsCountRef.current
      : 0
    const avgLikelihood = segmentLikelihoodCountRef.current > 0
      ? segmentLikelihoodAccRef.current / segmentLikelihoodCountRef.current
      : 0
    // 段环境音判定（基于帧占比，避免单帧噪声污染整段）：
    // - 段内环境音帧占比 > 60%：明确环境音段（键盘/敲击/白噪）
    // - 段平均人声概率 < 0.25：低置信度，疑似环境音
    // 两个条件满足其一即判定为环境音，跳过 STT
    // 不再用「任意一帧为环境音即整段标记」的激进逻辑
    const envFrameRatio = segmentLikelihoodCountRef.current > 0
      ? segmentEnvFrameCountRef.current / segmentLikelihoodCountRef.current
      : 0
    const isEnvironment = envFrameRatio > 0.6 || avgLikelihood < 0.25

    if (isEnvironment) {
      logger.system.debug('[VadSegmenter] Segment marked as environment', {
        duration,
        avgRms,
        avgLikelihood,
        envFrameRatio,
        envFrameCount: segmentEnvFrameCountRef.current,
        totalFrames: segmentLikelihoodCountRef.current,
      })
    }

    const features: SegmentFeatures = {
      rms: avgRms,
      voiceLikelihood: avgLikelihood,
      isEnvironment,
      durationMs: duration,
    }

    try {
      onSegmentRef.current(audioBlob, features)
    } catch (err) {
      logger.system.error('[VadSegmenter] onSegment callback error:', err)
    }
  }, [stopRecorder])

  // --------------------------------------------
  // VAD 检测循环
  // --------------------------------------------

  const vadTick = useCallback((): void => {
    if (!activeRef.current) return
    const analyser = analyserRef.current
    if (!analyser) return

    // 采集时域/频域数据
    analyser.getByteTimeDomainData(timeDataRef.current)
    analyser.getByteFrequencyData(freqDataRef.current)

    // 计算特征
    const features: AudioFeatures = extractFeatures(
      timeDataRef.current,
      freqDataRef.current,
      SAMPLE_RATE,
      FFT_SIZE,
    )
    const result = detectVoice(features)

    // 实时音量回调
    setVolume(features.rms)
    onVolumeRef.current?.(features.rms)

    const now = Date.now()
    const state = vadStateRef.current

    if (state === 'silence') {
      // 静音态 → 检测到声音活动 → 进入 speaking
      // VAD 只负责检测"是否有声音"（基于 RMS 响度），不依赖 voiceLikelihood。
      // "是否为人声"由切段时基于段内环境音帧占比 + 段平均概率综合判定，
      // 避免 VAD 阈值过高导致用户说话无法触发录音。
      if (!result.isSilent && features.rms >= RMS_SPEECH) {
        setSpeakingState(true)
        speechStartTimeRef.current = now
        silenceStartTimeRef.current = 0

        // 重置段特征累计
        segmentRmsAccRef.current = features.rms
        segmentRmsCountRef.current = 1
        segmentLikelihoodAccRef.current = result.voiceLikelihood
        segmentLikelihoodCountRef.current = 1
        segmentEnvFrameCountRef.current = result.isEnvironment ? 1 : 0
        segmentIsEnvironmentRef.current = result.isEnvironment

        startRecorder()
      }
    } else {
      // speaking 态 → 累计特征 + 判断是否结束
      segmentRmsAccRef.current += features.rms
      segmentRmsCountRef.current++
      segmentLikelihoodAccRef.current += result.voiceLikelihood
      segmentLikelihoodCountRef.current++
      if (result.isEnvironment) {
        segmentEnvFrameCountRef.current++
        segmentIsEnvironmentRef.current = true
      }

      const duration = now - speechStartTimeRef.current

      // 强制切段（超过最大时长）
      if (duration >= MAX_SPEECH_MS) {
        lastSegmentEndTimeRef.current = now
        void finalizeSegment().then(() => {
          setSpeakingState(false)
          silenceStartTimeRef.current = 0
        })
        return
      }

      // 检测静音
      if (result.isSilent || features.rms < RMS_SILENCE) {
        if (silenceStartTimeRef.current === 0) {
          silenceStartTimeRef.current = now
        } else if (now - silenceStartTimeRef.current >= SILENCE_DELAY) {
          // 静音超过阈值，切段
          lastSegmentEndTimeRef.current = silenceStartTimeRef.current
          void finalizeSegment().then(() => {
            setSpeakingState(false)
            silenceStartTimeRef.current = 0
          })
        }
      } else {
        // 重新开始说话，重置静音计时
        silenceStartTimeRef.current = 0
      }
    }
  }, [finalizeSegment, setSpeakingState, startRecorder])

  // --------------------------------------------
  // 麦克风初始化与清理
  // --------------------------------------------

  const initMicrophone = useCallback(async (): Promise<boolean> => {
    try {
      // macOS 需先通过主进程请求权限
      if (window.electronAPI?.floatingAvatar?.requestMicPermission) {
        const permRes = await window.electronAPI.floatingAvatar.requestMicPermission()
        if (!permRes?.data?.granted) {
          emitError('麦克风权限被拒绝，请在系统设置中授权后重试')
          return false
        }
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: SAMPLE_RATE,
        },
      })
      mediaStreamRef.current = stream

      const audioContext = new AudioContext({ sampleRate: SAMPLE_RATE })
      audioContextRef.current = audioContext

      const source = audioContext.createMediaStreamSource(stream)
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = FFT_SIZE
      analyser.smoothingTimeConstant = 0.4
      source.connect(analyser)
      analyserRef.current = analyser

      return true
    } catch (err) {
      emitError(`获取麦克风失败：${err instanceof Error ? err.message : String(err)}`)
      return false
    }
  }, [emitError])

  const teardownMicrophone = useCallback((): void => {
    // 停止 VAD 定时器
    if (vadTimerRef.current) {
      clearInterval(vadTimerRef.current)
      vadTimerRef.current = null
    }
    // 停止录音
    if (mediaRecorderRef.current?.state === 'recording') {
      try {
        mediaRecorderRef.current.stop()
      } catch {
        /* ignore */
      }
      mediaRecorderRef.current = null
    }
    // 关闭媒体流
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop())
      mediaStreamRef.current = null
    }
    // 关闭 AudioContext
    if (audioContextRef.current) {
      void audioContextRef.current.close().catch(() => undefined)
      audioContextRef.current = null
    }
    analyserRef.current = null
    vadStateRef.current = 'silence'
    setSpeaking(false)
    setVolume(0)
  }, [])

  // --------------------------------------------
  // 响应 active 变化
  // --------------------------------------------

  useEffect(() => {
    if (!active) {
      // 暂停：保留麦克风，仅停止 VAD 检测和录音
      if (vadTimerRef.current) {
        clearInterval(vadTimerRef.current)
        vadTimerRef.current = null
      }
      // 若正在说话，先切段
      if (vadStateRef.current === 'speaking') {
        lastSegmentEndTimeRef.current = Date.now()
        void finalizeSegment().then(() => {
          setSpeakingState(false)
          silenceStartTimeRef.current = 0
        })
      }
      // 停止录音（释放资源）
      if (mediaRecorderRef.current?.state === 'recording') {
        void stopRecorder()
      }
      setRunning(false)
      return
    }

    // 激活：初始化麦克风（如未初始化）+ 启动 VAD 循环
    let cancelled = false
    void (async () => {
      try {
        if (!mediaStreamRef.current) {
          const ok = await initMicrophone()
          if (!ok || cancelled) return
        }
        // AudioContext 可能被 suspend（自动策略）
        if (audioContextRef.current?.state === 'suspended') {
          await audioContextRef.current.resume()
        }
        if (cancelled) return

        setRunning(true)
        setError(null)
        vadStateRef.current = 'silence'
        silenceStartTimeRef.current = 0
        vadTimerRef.current = setInterval(vadTick, VAD_CHECK_INTERVAL)
      } catch (err) {
        if (!cancelled) {
          emitError(`启动 VAD 失败：${err instanceof Error ? err.message : String(err)}`)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [active, initMicrophone, vadTick, emitError, finalizeSegment, setSpeakingState, stopRecorder])

  // --------------------------------------------
  // 组件卸载时清理
  // --------------------------------------------

  useEffect(() => {
    return () => {
      teardownMicrophone()
    }
  }, [teardownMicrophone])

  return { running, speaking, volume, error }
}
