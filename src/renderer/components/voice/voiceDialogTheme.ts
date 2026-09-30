/**
 * 语音对话的界面主题
 *
 * 语音对话的状态不再由独立浮层呈现，而是就地长在麦克风按钮上：
 * 按钮底色、脉冲环、波形颜色、气泡文案都跟着同一个状态走。
 * 这些映射集中放在这里，避免按钮与气泡各写一份而彼此走样。
 */

import type { VoiceDialogState } from '../../composables/voice/useVoiceDialog'

export interface VoiceStateStyle {
  /** 按钮实心底色（含悬停与投影） */
  solid: string
  /** 脉冲环描边色 */
  ring: string
  /** 状态文案颜色 */
  text: string
  /** 波形颜色（canvas 需要具体色值，不能用 Tailwind 类） */
  wave: string
}

export const VOICE_STATE_STYLE: Record<VoiceDialogState, VoiceStateStyle> = {
  idle: {
    solid: 'bg-slate-500 hover:bg-slate-600 shadow-lg shadow-slate-500/30',
    ring: 'border-slate-300',
    text: 'text-slate-400',
    wave: 'rgb(100, 116, 139)',
  },
  connecting: {
    solid: 'bg-amber-500 hover:bg-amber-600 shadow-lg shadow-amber-500/30',
    ring: 'border-amber-300',
    text: 'text-amber-500',
    wave: 'rgb(245, 158, 11)',
  },
  listening: {
    solid: 'bg-blue-500 hover:bg-blue-600 shadow-lg shadow-blue-500/30',
    ring: 'border-blue-300',
    text: 'text-blue-400',
    wave: 'rgb(59, 130, 246)',
  },
  recording: {
    solid: 'bg-emerald-500 hover:bg-emerald-600 shadow-lg shadow-emerald-500/30',
    ring: 'border-emerald-300',
    text: 'text-emerald-500',
    wave: 'rgb(16, 185, 129)',
  },
  processing: {
    solid: 'bg-violet-500 hover:bg-violet-600 shadow-lg shadow-violet-500/30',
    ring: 'border-violet-300',
    text: 'text-violet-400',
    wave: 'rgb(139, 92, 246)',
  },
  speaking: {
    solid: 'bg-cyan-500 hover:bg-cyan-600 shadow-lg shadow-cyan-500/30',
    ring: 'border-cyan-300',
    text: 'text-cyan-400',
    wave: 'rgb(6, 182, 212)',
  },
  paused: {
    solid: 'bg-orange-500 hover:bg-orange-600 shadow-lg shadow-orange-500/30',
    ring: 'border-orange-300',
    text: 'text-orange-500',
    wave: 'rgb(251, 146, 60)',
  },
  error: {
    solid: 'bg-red-500 hover:bg-red-600 shadow-lg shadow-red-500/30',
    ring: 'border-red-300',
    text: 'text-red-500',
    wave: 'rgb(239, 68, 68)',
  },
}

const LABEL_ZH: Record<VoiceDialogState, string> = {
  idle: '语音对话',
  connecting: '正在启动麦克风…',
  listening: '我在听，请说',
  recording: '正在聆听…',
  processing: '正在思考…',
  speaking: '正在播报…',
  paused: '需要你亲自确认',
  error: '麦克风启动失败',
}

const LABEL_EN: Record<VoiceDialogState, string> = {
  idle: 'Voice',
  connecting: 'Starting microphone…',
  listening: "I'm listening",
  recording: 'Listening…',
  processing: 'Thinking…',
  speaking: 'Speaking…',
  paused: 'Your confirmation is needed',
  error: 'Microphone failed',
}

/** 状态文案：麦克风按钮上方气泡显示的就是它 */
export function voiceStateLabel(state: VoiceDialogState, isZh: boolean): string {
  return isZh ? LABEL_ZH[state] : LABEL_EN[state]
}
