/**
 * useVrmLipSync — VRM 口型同步 Hook
 *
 * 把「音频能量」转换为可驱动 VRM 嘴部表情（`aa` viseme）的开合值。
 *
 * 两种驱动来源（按优先级自适应）：
 * 1. attachAudioElement(el)：本窗口存在播放 TTS 的 <audio> 元素时，
 *    直接接入 WebAudio AnalyserNode 分析实时音量（延迟最低，跟随最准）。
 * 2. pushVolume(v)：音频在别的窗口/进程播放时，由外部（主窗口 TTS 播放链路）
 *    通过 IPC 推送音量值，本 Hook 负责平滑与衰减。
 *
 * 输出：mouthOpenRef（0~1），由渲染循环逐帧读取，避免 React 重渲染造成的抖动。
 *
 * 移植自 super-ai-browser 的 processOmniStreaming（AnalyserNode 分析思路），
 * 但去掉了 WebSocket 音频传输依赖，改为与 AweeClaw 现有 TTS 链路对接。
 */

import { useCallback, useEffect, useRef } from 'react'

export interface VrmLipSyncOptions {
  /** 平滑系数（0~1，越大越跟手、越小越柔和） */
  smoothing?: number
  /** 无音频输入时的衰减速度（每秒衰减比例） */
  decayPerSecond?: number
  /** 最大开合上限（防止嘴巴张得过大） */
  maxOpen?: number
  /** 音量放大系数（TTS 音量普遍偏小，需要增益） */
  gain?: number
}

export interface VrmLipSyncController {
  /** 当前嘴部开合值（0~1）。渲染循环逐帧读取此 ref，避免触发 React 重渲染 */
  mouthOpenRef: React.MutableRefObject<number>
  /** 接入 <audio> 元素（返回断开函数） */
  attachAudioElement: (el: HTMLAudioElement) => () => void
  /** 外部推送音量（0~1） */
  pushVolume: (volume: number) => void
  /** 立即闭合嘴巴（如中断播放） */
  reset: () => void
  /** 当前是否处于「有声音」状态 */
  isSpeakingRef: React.MutableRefObject<boolean>
}

export function useVrmLipSync(options: VrmLipSyncOptions = {}): VrmLipSyncController {
  const {
    smoothing = 0.35,
    decayPerSecond = 6,
    maxOpen = 0.85,
    gain = 2.2,
  } = options

  /** 目标值（由音频分析或外部推送写入） */
  const targetRef = useRef(0)
  /** 平滑后的当前值（渲染循环读取） */
  const mouthOpenRef = useRef(0)
  const isSpeakingRef = useRef(false)

  /** 最近一次收到音频输入的时间戳（用于衰减判断） */
  const lastInputAtRef = useRef(0)

  /** WebAudio 资源（挂载 audio 元素时创建） */
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null)
  const dataBufferRef = useRef<Uint8Array<ArrayBuffer> | null>(null)
  const rafRef = useRef<number | null>(null)

  /** 外部推送音量 */
  const pushVolume = useCallback(
    (volume: number) => {
      const v = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0
      targetRef.current = Math.min(maxOpen, v * gain)
      lastInputAtRef.current = performance.now()
      isSpeakingRef.current = v > 0.02
    },
    [gain, maxOpen],
  )

  /**
   * 接入 audio 元素：创建 AnalyserNode 并通过 rAF 持续采样能量。
   *
   * 注意：MediaElementAudioSourceNode 对同一元素只能创建一次，
   * 因此调用方需保证元素复用（不要频繁换元素）。
   */
  const attachAudioElement = useCallback(
    (el: HTMLAudioElement): (() => void) => {
      if (typeof window === 'undefined') return () => {}

      try {
        // 复用或新建 AudioContext（浏览器限制：需要用户手势后才能 resume）
        if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
          const Ctor =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
          audioCtxRef.current = new Ctor()
        }
        const ctx = audioCtxRef.current

        // 同一元素重复 attach 时先断开旧连接
        if (sourceRef.current) {
          try {
            sourceRef.current.disconnect()
          } catch {
            /* 忽略重复断开 */
          }
          sourceRef.current = null
        }

        const source = ctx.createMediaElementSource(el)
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 512
        analyser.smoothingTimeConstant = 0.6

        source.connect(analyser)
        // 必须再连到 destination，否则声音不会输出
        analyser.connect(ctx.destination)

        sourceRef.current = source
        analyserRef.current = analyser
        dataBufferRef.current = new Uint8Array(analyser.frequencyBinCount)

        // Autoplay policy：Electron 已设置 no-user-gesture-required，此处仍兜底 resume
        if (ctx.state === 'suspended') {
          void ctx.resume().catch(() => {})
        }

        const sample = (): void => {
          const analyserNode = analyserRef.current
          const buffer = dataBufferRef.current
          if (analyserNode && buffer) {
            // 取时域数据计算 RMS（比频域均值更贴近「说话响度」的主观感受）
            analyserNode.getByteTimeDomainData(buffer)
            let sum = 0
            for (let i = 0; i < buffer.length; i += 1) {
              const centered = (buffer[i] - 128) / 128
              sum += centered * centered
            }
            const rms = Math.sqrt(sum / buffer.length)
            // rms 通常很小（0.02~0.25），乘增益后映射到开合区间
            pushVolume(Math.min(1, rms * 3.2))
          }
          rafRef.current = requestAnimationFrame(sample)
        }

        if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
        rafRef.current = requestAnimationFrame(sample)

        return () => {
          if (rafRef.current != null) {
            cancelAnimationFrame(rafRef.current)
            rafRef.current = null
          }
          try {
            sourceRef.current?.disconnect()
            analyserRef.current?.disconnect()
          } catch {
            /* 忽略断开异常 */
          }
          sourceRef.current = null
          analyserRef.current = null
          dataBufferRef.current = null
          targetRef.current = 0
          isSpeakingRef.current = false
        }
      } catch {
        // 创建失败（如元素已被其他 AudioContext 占用）时静默降级到外部推送模式
        return () => {}
      }
    },
    [pushVolume],
  )

  const reset = useCallback(() => {
    targetRef.current = 0
    mouthOpenRef.current = 0
    isSpeakingRef.current = false
    lastInputAtRef.current = 0
  }, [])

  /**
   * 全局平滑循环：把 targetRef 平滑逼近到 mouthOpenRef，
   * 并在长时间无输入时自动衰减到 0（防止「卡住张嘴」）。
   */
  useEffect(() => {
    let raf = 0
    let lastTime = performance.now()

    const tick = (now: number): void => {
      const dt = Math.min(0.1, (now - lastTime) / 1000)
      lastTime = now

      const silentMs = now - lastInputAtRef.current
      // 超过 180ms 无新音频输入视为停顿时隙，目标归零
      if (silentMs > 180) {
        targetRef.current = 0
        isSpeakingRef.current = false
      }

      const current = mouthOpenRef.current
      const target = targetRef.current
      // 张嘴用 smoothing（快），闭嘴用衰减（稍慢，避免机械感）
      const factor = target > current ? smoothing : Math.min(1, smoothing + decayPerSecond * dt)
      mouthOpenRef.current = current + (target - current) * factor

      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      try {
        sourceRef.current?.disconnect()
        analyserRef.current?.disconnect()
        void audioCtxRef.current?.close()
      } catch {
        /* 忽略清理异常 */
      }
      audioCtxRef.current = null
    }
  }, [smoothing, decayPerSecond])

  return { mouthOpenRef, attachAudioElement, pushVolume, reset, isSpeakingRef }
}
