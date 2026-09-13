/**
 * 提示音工具
 *
 * 用于任务完成、文件变更待确认等场景的用户提醒。
 * 使用 Web Audio API 合成短促提示音，无需音频文件资源。
 */

import { isSoundAllowed } from '@utils/soundGate'

let sharedCtx: AudioContext | null = null

function getAudioContext(): AudioContext | null {
  try {
    if (!sharedCtx || sharedCtx.state === 'closed') {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return null
      sharedCtx = new Ctor()
    }
    // 浏览器策略要求用户交互后才能播放音频，resume 以防被暂停
    if (sharedCtx.state === 'suspended') {
      void sharedCtx.resume()
    }
    return sharedCtx
  } catch {
    return null
  }
}

interface ToneOptions {
  /** 频率（Hz） */
  freq: number
  /** 开始时间偏移（秒） */
  startOffset: number
  /** 持续时间（秒） */
  duration: number
  /** 音量（0-1） */
  gain: number
  /** 波形类型，默认 sine */
  type?: OscillatorType
}

function playTone(ctx: AudioContext, opts: ToneOptions) {
  const { freq, startOffset, duration, gain, type = 'sine' } = opts
  const now = ctx.currentTime + startOffset
  const osc = ctx.createOscillator()
  const gainNode = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, now)
  gainNode.gain.setValueAtTime(gain, now)
  gainNode.gain.exponentialRampToValueAtTime(0.001, now + duration)
  osc.connect(gainNode)
  gainNode.connect(ctx.destination)
  osc.start(now)
  osc.stop(now + duration)
}

/**
 * 播放任务全部完成提示音（上行三连音）
 * 用于 TodoListPanel 全部完成、文件变更待确认等正向提醒场景。
 */
export function playCompletionSound() {
  if (!isSoundAllowed('taskComplete')) return
  const ctx = getAudioContext()
  if (!ctx) return
  playTone(ctx, { freq: 880, startOffset: 0, duration: 0.15, gain: 0.15 })
  playTone(ctx, { freq: 1108.73, startOffset: 0.12, duration: 0.15, gain: 0.15 })
  playTone(ctx, { freq: 1318.51, startOffset: 0.24, duration: 0.3, gain: 0.12 })
}

/**
 * 播放文件变更待确认提示音（柔和双音）
 * 用于 AI 回复完成且有待接受文件变更时提醒用户。
 */
export function playPendingReviewSound() {
  if (!isSoundAllowed('needApproval')) return
  const ctx = getAudioContext()
  if (!ctx) return
  playTone(ctx, { freq: 660, startOffset: 0, duration: 0.18, gain: 0.14 })
  playTone(ctx, { freq: 880, startOffset: 0.16, duration: 0.25, gain: 0.12 })
}

/**
 * 播放错误提示音（低沉警示音）
 * 用于 AI 执行出错时提醒用户。
 */
export function playErrorSound() {
  if (!isSoundAllowed('taskError')) return
  const ctx = getAudioContext()
  if (!ctx) return
  playTone(ctx, { freq: 330, startOffset: 0, duration: 0.25, gain: 0.15, type: 'square' })
  playTone(ctx, { freq: 262, startOffset: 0.2, duration: 0.35, gain: 0.12, type: 'square' })
}

/**
 * 播放需确认提示音（温和单音）
 * 用于需要用户确认操作时提醒用户。
 */
export function playApprovalSound() {
  if (!isSoundAllowed('needApproval')) return
  const ctx = getAudioContext()
  if (!ctx) return
  playTone(ctx, { freq: 784, startOffset: 0, duration: 0.2, gain: 0.13 })
}
