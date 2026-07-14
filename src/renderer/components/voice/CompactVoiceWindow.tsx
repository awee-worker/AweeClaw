/**
 * CompactVoiceWindow - 浮动小窗口模式
 *
 * 极简设计：只保留圆球（与沉浸式相同的特效）+ 结束对话按钮。
 * 可拖拽，不显示文本流和工具状态。
 */

import { memo } from 'react'
import { motion } from 'framer-motion'
import { X, Mic, MicOff, Volume2, PhoneOff, Maximize2, GripHorizontal } from 'lucide-react'
import type { VoiceChatState } from '../../composables/useVoiceChat'
import { useDraggableWindow } from '../../composables/useDraggableWindow'

interface CompactVoiceWindowProps {
  state: VoiceChatState
  volume: number
  /** 麦克风是否静音 */
  isMuted: boolean
  isZh: boolean
  onClose: () => void
  onInterrupt: () => void
  /** 切换麦克风静音 */
  onToggleMute: () => void
  onExpand: () => void
}

/** 状态对应的小球颜色（与 ImmersiveVoiceView 保持一致） */
const STATE_COLORS: Record<VoiceChatState, string> = {
  idle: 'from-slate-600 to-slate-800',
  connecting: 'from-amber-400 to-orange-600',
  listening: 'from-blue-400 to-indigo-600',
  recording: 'from-emerald-400 to-teal-600',
  processing: 'from-violet-400 to-purple-600',
  speaking: 'from-cyan-400 to-blue-600',
  error: 'from-red-400 to-rose-600',
}

const WINDOW_WIDTH = 220
const WINDOW_HEIGHT = 260

function CompactVoiceWindowImpl({
  state: currentState,
  volume,
  isMuted,
  isZh,
  onClose,
  onInterrupt,
  onToggleMute,
  onExpand,
}: CompactVoiceWindowProps) {
  const { position, isDragging, dragHandleProps } = useDraggableWindow({
    defaultPosition: {
      x: window.innerWidth - WINDOW_WIDTH - 10,
      y: 60,
    },
    storageKey: 'voice-compact-window-pos',
    windowSize: { width: WINDOW_WIDTH, height: WINDOW_HEIGHT },
  })

  const isActive = currentState !== 'idle' && currentState !== 'error' && currentState !== 'connecting'
  const isSpeaking = currentState === 'speaking'
  const isListening = currentState === 'listening' || currentState === 'recording'
  const gradient = STATE_COLORS[currentState] || STATE_COLORS.idle
  const volumeScale = Math.min(1 + volume * 3, 1.15)

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8, x: 50 }}
      animate={{ opacity: 1, scale: 1, x: 0 }}
      exit={{ opacity: 0, scale: 0.8, x: 50 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className={`fixed z-50 flex flex-col items-center bg-surface/90 backdrop-blur-xl border border-border/50 rounded-2xl shadow-2xl overflow-hidden ${
        isDragging ? 'cursor-grabbing' : ''
      }`}
      style={{
        left: position.x,
        top: position.y,
        width: WINDOW_WIDTH,
        height: WINDOW_HEIGHT,
      }}
    >
      {/* 拖拽栏 + 操作按钮 */}
      <div
        {...dragHandleProps}
        className={`flex items-center justify-between w-full px-2 py-1.5 bg-surface/80 border-b border-border/30 ${
          isDragging ? 'cursor-grabbing' : 'cursor-grab hover:bg-surface'
        }`}
      >
        <div className="flex items-center gap-1.5">
          <GripHorizontal className="w-3 h-3 text-text-muted" />
          <div className={`w-1.5 h-1.5 rounded-full ${
            currentState === 'error' ? 'bg-red-500' :
            isActive ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
          }`} />
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={onExpand}
            className="w-5 h-5 rounded flex items-center justify-center transition-colors hover:bg-surface hover:text-text-primary text-text-muted"
            title={isZh ? '沉浸模式' : 'Immersive'}
          >
            <Maximize2 className="w-3 h-3" />
          </button>
          <button
            onClick={onClose}
            className="w-5 h-5 rounded flex items-center justify-center transition-colors hover:bg-red-500/20 hover:text-red-400 text-text-muted"
            title={isZh ? '关闭' : 'Close'}
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* 球体区域（与沉浸式相同的特效） */}
      <div className="flex-1 flex items-center justify-center">
        <div className="relative flex items-center justify-center">
          {/* 聆听/录音时的扩散波纹 */}
          {isListening && (
            <>
              <motion.div
                className="absolute rounded-full border-2 border-blue-400/40"
                animate={{ scale: [1, 1.8, 1.8], opacity: [0.6, 0, 0] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeOut' }}
                style={{ width: 120, height: 120 }}
              />
              <motion.div
                className="absolute rounded-full border-2 border-blue-400/30"
                animate={{ scale: [1, 1.8, 1.8], opacity: [0.4, 0, 0] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeOut', delay: 0.6 }}
                style={{ width: 120, height: 120 }}
              />
            </>
          )}

          {/* AI 说话时的光圈 */}
          {isSpeaking && (
            <motion.div
              className="absolute rounded-full bg-cyan-400/20 blur-xl"
              animate={{ scale: [1, 1.3, 1], opacity: [0.5, 0.8, 0.5] }}
              transition={{ duration: 0.8, repeat: Infinity, ease: 'easeInOut' }}
              style={{ width: 150, height: 150 }}
            />
          )}

          {/* 处理中的旋转环 */}
          {currentState === 'processing' && (
            <motion.div
              className="absolute rounded-full border-t-2 border-violet-400 border-r-transparent border-b-transparent border-l-transparent"
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
              style={{ width: 130, height: 130 }}
            />
          )}

          {/* 连接中的脉冲 */}
          {currentState === 'connecting' && (
            <motion.div
              className="absolute rounded-full border-2 border-amber-400/50"
              animate={{ scale: [1, 1.2, 1], opacity: [0.8, 0.3, 0.8] }}
              transition={{ duration: 1, repeat: Infinity, ease: 'easeInOut' }}
              style={{ width: 120, height: 120 }}
            />
          )}

          {/* 主球体 - 与沉浸式相同的呼吸效果 */}
          <motion.button
            onClick={onInterrupt}
            disabled={!isSpeaking}
            whileHover={isSpeaking ? { scale: 1.05 } : undefined}
            whileTap={isSpeaking ? { scale: 0.95 } : undefined}
            className={`relative w-24 h-24 rounded-full bg-gradient-to-br ${gradient} shadow-2xl transition-all duration-300 ${
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
            <div className="absolute inset-3 rounded-full bg-gradient-to-br from-white/20 to-transparent" />

            <div className="absolute inset-0 flex items-center justify-center">
              {currentState === 'idle' || currentState === 'connecting' ? (
                <div className="w-5 h-5 rounded-full border-2 border-white/40 border-t-white animate-spin" />
              ) : isSpeaking ? (
                <div className="flex items-center gap-0.5">
                  {[0, 1, 2, 3, 4].map(i => (
                    <motion.div
                      key={i}
                      className="w-0.5 h-5 bg-white/80 rounded-full"
                      animate={{ height: [6, 16, 8, 13, 6] }}
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
                <div className="flex items-center gap-0.5">
                  {[0, 1, 2, 3].map(i => (
                    <motion.div
                      key={i}
                      className="w-1 bg-white/90 rounded-full"
                      animate={{ height: [4, 14, 7, 11, 4] }}
                      transition={{
                        duration: 0.5,
                        repeat: Infinity,
                        delay: i * 0.12,
                        ease: 'easeInOut',
                      }}
                      style={{ height: 4 + volume * 20 }}
                    />
                  ))}
                </div>
              ) : currentState === 'listening' ? (
                isMuted ? (
                  <MicOff className="w-6 h-6 text-white/90" />
                ) : (
                  <Mic className="w-6 h-6 text-white/90" />
                )
              ) : currentState === 'processing' ? (
                <div className="flex items-center gap-1">
                  {[0, 1, 2].map(i => (
                    <motion.div
                      key={i}
                      className="w-1.5 h-1.5 bg-white/80 rounded-full"
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
                <Volume2 className="w-6 h-6 text-white/70" />
              )}
            </div>
          </motion.button>
        </div>
      </div>

      {/* 底部按钮：静音 + 结束对话 */}
      <div className="flex items-center justify-center gap-2 pb-3 pt-1">
        <button
          onClick={onToggleMute}
          className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors border ${
            isMuted
              ? 'bg-red-500/15 text-red-400 hover:bg-red-500/25 border-red-500/30'
              : 'bg-surface/60 text-text-muted hover:bg-surface hover:text-text-primary border-border/40'
          }`}
          title={isMuted ? (isZh ? '取消静音' : 'Unmute') : (isZh ? '静音麦克风' : 'Mute Microphone')}
        >
          {isMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
        </button>
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors border border-red-500/30"
        >
          <PhoneOff className="w-3 h-3" />
          <span className="text-[12px] font-medium">
            {isZh ? '结束对话' : 'End'}
          </span>
        </button>
      </div>
    </motion.div>
  )
}

export const CompactVoiceWindow = memo(CompactVoiceWindowImpl)
