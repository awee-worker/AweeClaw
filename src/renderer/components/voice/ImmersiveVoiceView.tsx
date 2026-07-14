/**
 * ImmersiveVoiceView - 沉浸模式
 *
 * 全屏遮罩 + 大球体 + 下方实时滚动文本流。
 * 继承自原 VoiceConversationOverlay 的全屏设计，
 * 增加了底部文本流区域，让用户在沉浸模式下也能看到完整对话内容。
 */

import { memo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Mic, MicOff, Volume2, PhoneOff, AlertCircle, Minimize2 } from 'lucide-react'
import type { VoiceChatState } from '../../composables/useVoiceChat'
import type { ActivityStatus } from '../../utils/voiceActivityStatus'
import type { StreamEntry } from './VoiceTextStream'
import { VoiceTextStream } from './VoiceTextStream'

interface ImmersiveVoiceViewProps {
  state: VoiceChatState
  volume: number
  /** 麦克风是否静音 */
  isMuted: boolean
  streamEntries: StreamEntry[]
  activityStatus: ActivityStatus | null
  errorMessage: string | null
  isZh: boolean
  onClose: () => void
  onInterrupt: () => void
  /** 切换麦克风静音 */
  onToggleMute: () => void
  onMinimize: () => void
  onDismissError: () => void
}

const STATE_CONFIG: Record<VoiceChatState, {
  label: string
  gradient: string
  glow: string
}> = {
  idle: { label: '未连接', gradient: 'from-slate-600 to-slate-800', glow: 'shadow-slate-500/20' },
  connecting: { label: '连接中', gradient: 'from-amber-400 to-orange-600', glow: 'shadow-amber-500/30' },
  listening: { label: '聆听中', gradient: 'from-blue-400 to-indigo-600', glow: 'shadow-blue-500/40' },
  recording: { label: '聆听中', gradient: 'from-emerald-400 to-teal-600', glow: 'shadow-emerald-500/40' },
  processing: { label: '思考中', gradient: 'from-violet-400 to-purple-600', glow: 'shadow-violet-500/40' },
  speaking: { label: '回答中', gradient: 'from-cyan-400 to-blue-600', glow: 'shadow-cyan-500/40' },
  error: { label: '连接错误', gradient: 'from-red-400 to-rose-600', glow: 'shadow-red-500/30' },
}

function ImmersiveVoiceViewImpl({
  state: currentState,
  volume,
  isMuted,
  streamEntries,
  activityStatus,
  errorMessage,
  isZh,
  onClose,
  onInterrupt,
  onToggleMute,
  onMinimize,
  onDismissError,
}: ImmersiveVoiceViewProps) {
  const config = STATE_CONFIG[currentState] || STATE_CONFIG.idle
  const isSpeaking = currentState === 'speaking'
  const isListening = currentState === 'listening' || currentState === 'recording'
  const isActive = currentState !== 'idle' && currentState !== 'error' && currentState !== 'connecting'
  const volumeScale = Math.min(1 + volume * 3, 1.15)

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="absolute inset-0 z-30 flex flex-col bg-background/95 backdrop-blur-xl"
    >
      {/* 顶部状态栏 */}
      <div className="flex items-center justify-between px-4 py-3 z-10 flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className={`w-2 h-2 rounded-full ${
            currentState === 'error' ? 'bg-red-500' :
            isActive ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
          }`} />
          <span className="text-sm font-medium text-text-primary">
            {isZh ? '语音对话' : 'Voice Conversation'}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={onMinimize}
            className="w-7 h-7 rounded-full flex items-center justify-center transition-colors bg-surface/60 hover:bg-surface border border-border/40"
            title={isZh ? '浮动模式' : 'Floating Mode'}
          >
            <Minimize2 className="w-3.5 h-3.5 text-text-primary" />
          </button>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full flex items-center justify-center transition-colors bg-surface/60 hover:bg-red-500/20 border border-border/40 hover:border-red-500/40"
            title={isZh ? '关闭（Esc）' : 'Close (Esc)'}
          >
            <X className="w-3.5 h-3.5 text-text-primary hover:text-red-400" />
          </button>
        </div>
      </div>

      {/* 球体区域 */}
      <div className="flex-1 flex flex-col items-center justify-center gap-6 px-4 min-h-0">
        <div className="relative flex items-center justify-center flex-shrink-0">
          {/* 聆听/录音时的扩散波纹 */}
          {isListening && (
            <>
              <motion.div
                className="absolute rounded-full border-2 border-blue-400/40"
                animate={{ scale: [1, 1.8, 1.8], opacity: [0.6, 0, 0] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeOut' }}
                style={{ width: 180, height: 180 }}
              />
              <motion.div
                className="absolute rounded-full border-2 border-blue-400/30"
                animate={{ scale: [1, 1.8, 1.8], opacity: [0.4, 0, 0] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeOut', delay: 0.6 }}
                style={{ width: 180, height: 180 }}
              />
            </>
          )}

          {/* AI 说话时的光圈 */}
          {isSpeaking && (
            <motion.div
              className="absolute rounded-full bg-cyan-400/20 blur-xl"
              animate={{ scale: [1, 1.3, 1], opacity: [0.5, 0.8, 0.5] }}
              transition={{ duration: 0.8, repeat: Infinity, ease: 'easeInOut' }}
              style={{ width: 220, height: 220 }}
            />
          )}

          {/* 处理中的旋转环 */}
          {currentState === 'processing' && (
            <motion.div
              className="absolute rounded-full border-t-2 border-violet-400 border-r-transparent border-b-transparent border-l-transparent"
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
              style={{ width: 200, height: 200 }}
            />
          )}

          {/* 连接中的脉冲 */}
          {currentState === 'connecting' && (
            <motion.div
              className="absolute rounded-full border-2 border-amber-400/50"
              animate={{ scale: [1, 1.2, 1], opacity: [0.8, 0.3, 0.8] }}
              transition={{ duration: 1, repeat: Infinity, ease: 'easeInOut' }}
              style={{ width: 180, height: 180 }}
            />
          )}

          {/* 主球体 */}
          <motion.button
            onClick={onInterrupt}
            disabled={!isSpeaking}
            whileHover={isSpeaking ? { scale: 1.05 } : undefined}
            whileTap={isSpeaking ? { scale: 0.95 } : undefined}
            className={`relative w-40 h-40 rounded-full bg-gradient-to-br ${config.gradient} shadow-2xl ${config.glow} transition-all duration-300 ${
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
            <div className="absolute inset-4 rounded-full bg-gradient-to-br from-white/20 to-transparent" />

            <div className="absolute inset-0 flex items-center justify-center">
              {currentState === 'idle' || currentState === 'connecting' ? (
                <div className="w-7 h-7 rounded-full border-2 border-white/40 border-t-white animate-spin" />
              ) : isSpeaking ? (
                <div className="flex items-center gap-1">
                  {[0, 1, 2, 3, 4].map(i => (
                    <motion.div
                      key={i}
                      className="w-1 h-7 bg-white/80 rounded-full"
                      animate={{ height: [8, 22, 12, 18, 8] }}
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
                <div className="flex items-center gap-1">
                  {[0, 1, 2, 3].map(i => (
                    <motion.div
                      key={i}
                      className="w-1.5 bg-white/90 rounded-full"
                      animate={{ height: [6, 20, 10, 16, 6] }}
                      transition={{
                        duration: 0.5,
                        repeat: Infinity,
                        delay: i * 0.12,
                        ease: 'easeInOut',
                      }}
                      style={{ height: 6 + volume * 30 }}
                    />
                  ))}
                </div>
              ) : currentState === 'listening' ? (
                isMuted ? (
                  <MicOff className="w-9 h-9 text-white/90" />
                ) : (
                  <Mic className="w-9 h-9 text-white/90" />
                )
              ) : currentState === 'processing' ? (
                <div className="flex items-center gap-1.5">
                  {[0, 1, 2].map(i => (
                    <motion.div
                      key={i}
                      className="w-2.5 h-2.5 bg-white/80 rounded-full"
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
                <Volume2 className="w-9 h-9 text-white/70" />
              )}
            </div>
          </motion.button>
        </div>
      </div>

      {/* 底部实时文本流区域 */}
      <div className="flex-shrink-0 border-t border-border/30 bg-surface/30 backdrop-blur-sm">
        <div className="px-4 pt-2 pb-1 flex items-center justify-between">
          <span className="text-[12px] text-text-muted font-medium">
            {isZh ? '实时对话' : 'Live Transcript'}
          </span>
          <span className="text-[12px] text-text-muted">
            {streamEntries.length} {isZh ? '条' : 'msgs'}
          </span>
        </div>
        <VoiceTextStream
          entries={streamEntries}
          activity={activityStatus}
          maxHeight="180px"
        />
      </div>

      {/* 错误提示 */}
      <AnimatePresence>
        {errorMessage && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="absolute bottom-20 left-1/2 -translate-x-1/2 z-20 max-w-md"
          >
            <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-red-500/15 border border-red-500/40 backdrop-blur-md shadow-lg">
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-[13px] text-red-300 leading-relaxed flex-1">
                {errorMessage}
              </p>
              <button
                onClick={onDismissError}
                className="flex-shrink-0 text-red-400/60 hover:text-red-300 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 底部控制栏 */}
      <div className="flex items-center justify-center gap-3 px-4 py-4 flex-shrink-0">
        {isSpeaking && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="text-xs text-text-muted mr-2"
          >
            {isZh ? '点击球体或按空格键打断' : 'Click orb or press Space to interrupt'}
          </motion.div>
        )}

        <button
          onClick={onToggleMute}
          className={`px-4 py-2 rounded-full transition-colors flex items-center gap-2 border ${
            isMuted
              ? 'bg-red-500/15 text-red-400 hover:bg-red-500/25 border-red-500/30'
              : 'bg-surface/60 text-text-primary hover:bg-surface border-border/40'
          }`}
          title={isMuted ? (isZh ? '取消静音' : 'Unmute') : (isZh ? '静音麦克风' : 'Mute Microphone')}
        >
          {isMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
          <span className="text-sm font-medium">
            {isMuted ? (isZh ? '已静音' : 'Muted') : (isZh ? '静音' : 'Mute')}
          </span>
        </button>

        <button
          onClick={onClose}
          className="px-4 py-2 rounded-full bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors flex items-center gap-2 border border-red-500/30"
        >
          <PhoneOff className="w-3.5 h-3.5" />
          <span className="text-sm font-medium">
            {isZh ? '结束对话' : 'End Call'}
          </span>
        </button>
      </div>
    </motion.div>
  )
}

export const ImmersiveVoiceView = memo(ImmersiveVoiceViewImpl)
