/**
 * ConversationPanel - 头像窗口对话面板
 *
 * 展开后的对话面板，显示在球体下方，包含：
 * 1. 实时文本流（用户语音转录 + AI 回复 + 工具调用状态）
 * 2. 活动状态栏（AI 正在执行的操作）
 * 3. 控制按钮（静音/打断/关闭）
 *
 * 布局（展开窗口 360×480）：
 * ┌──────────────────────────┐
 * │  [球体]              [×] │  ← 顶部球体区（120px）
 * ├──────────────────────────┤
 * │  实时文本流（滚动）        │  ← 中间文本流（弹性高度）
 * │  ...                     │
 * ├──────────────────────────┤
 * │  [状态栏] [🔇] [⏹] [✕]  │  ← 底部控制栏（48px）
 * └──────────────────────────┘
 *
 * 设计要点：
 * - 透明背景 + 毛玻璃效果，与球体窗口视觉统一
 * - 文本流复用 VoiceTextStream 组件，保证与主窗口体验一致
 * - 控制按钮使用 lucide-react 图标，最小可点击区域 32×32
 */

import { memo } from 'react'
import { Mic, MicOff, Square, X, AlertCircle } from 'lucide-react'
import { VoiceTextStream, type StreamEntry } from '../voice/VoiceTextStream'
import type { VoiceChatState } from '../../composables/useVoiceChat'
import type { ActivityStatus } from '../../utils/voiceActivityStatus'

// ============================================
// 类型定义
// ============================================

export interface ConversationPanelProps {
  /** 当前语音状态 */
  state: VoiceChatState
  /** 实时文本流条目 */
  streamEntries: StreamEntry[]
  /** 当前活动状态（AI 正在执行的工具） */
  activityStatus: ActivityStatus | null
  /** 麦克风是否静音 */
  isMuted: boolean
  /** 错误信息 */
  errorMessage: string | null
  /** 语言 */
  language: 'zh' | 'en'
  /** 关闭对话（断开语音 + 收起窗口） */
  onClose: () => void
  /** 打断 AI 说话 */
  onInterrupt: () => void
  /** 切换麦克风静音 */
  onToggleMute: () => void
}

// ============================================
// 状态文案
// ============================================

const STATE_LABEL = {
  zh: {
    idle: '未连接',
    connecting: '连接中',
    listening: '聆听中',
    recording: '聆听中',
    processing: '思考中',
    speaking: '回答中',
    error: '错误',
  },
  en: {
    idle: 'Idle',
    connecting: 'Connecting',
    listening: 'Listening',
    recording: 'Listening',
    processing: 'Thinking',
    speaking: 'Speaking',
    error: 'Error',
  },
} as const

// ============================================
// 组件
// ============================================

function ConversationPanelImpl({
  state,
  streamEntries,
  activityStatus,
  isMuted,
  errorMessage,
  language,
  onClose,
  onInterrupt,
  onToggleMute,
}: ConversationPanelProps) {
  const isZh = language === 'zh'
  const labels = isZh ? STATE_LABEL.zh : STATE_LABEL.en
  const stateLabel = labels[state] || labels.idle
  const isSpeaking = state === 'speaking'
  const isError = state === 'error'
  const isActive = state !== 'idle' && state !== 'error' && state !== 'connecting'

  // 状态指示灯颜色
  const dotColor = isError
    ? '#ef4444'
    : isActive
      ? '#10b981'
      : '#f59e0b'

  return (
    <div style={panelStyle}>
      {/* 文本流区域 */}
      <div style={streamContainerStyle}>
        {streamEntries.length === 0 && !errorMessage && (
          <div style={emptyHintStyle}>
            {isZh ? '开始说话吧...' : 'Start speaking...'}
          </div>
        )}

        {errorMessage && (
          <div style={errorStyle}>
            <AlertCircle size={14} style={{ flexShrink: 0 }} />
            <span>{errorMessage}</span>
          </div>
        )}

        <VoiceTextStream
          entries={streamEntries}
          activity={activityStatus}
          maxHeight="100%"
          autoScroll
        />
      </div>

      {/* 底部控制栏 */}
      <div style={controlBarStyle}>
        {/* 状态指示 */}
        <div style={statusStyle}>
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: dotColor,
              animation: isActive ? 'avatar-dot-pulse 1.5s ease-in-out infinite' : 'none',
            }}
          />
          <span style={statusTextStyle}>{stateLabel}</span>
          {activityStatus && (
            <span style={activityTextStyle}>
              {activityStatus.action}
              {activityStatus.target ? ` ${activityStatus.target}` : ''}
            </span>
          )}
        </div>

        {/* 控制按钮 */}
        <div style={buttonsStyle}>
          {/* 静音 */}
          <button
            onClick={onToggleMute}
            style={buttonStyle}
            title={isZh ? (isMuted ? '取消静音' : '静音') : isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted ? <MicOff size={16} color="#f59e0b" /> : <Mic size={16} color="#a0a0b0" />}
          </button>

          {/* 打断（仅 AI 说话时可用） */}
          <button
            onClick={onInterrupt}
            disabled={!isSpeaking}
            style={{
              ...buttonStyle,
              opacity: isSpeaking ? 1 : 0.4,
              cursor: isSpeaking ? 'pointer' : 'not-allowed',
            }}
            title={isZh ? '打断' : 'Interrupt'}
          >
            <Square size={14} color="#ef4444" fill="currentColor" />
          </button>

          {/* 关闭对话 */}
          <button
            onClick={onClose}
            style={buttonStyle}
            title={isZh ? '结束对话' : 'End conversation'}
          >
            <X size={18} color="#a0a0b0" />
          </button>
        </div>
      </div>

      <style>{`
        @keyframes avatar-dot-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(0.85); }
        }
      `}</style>
    </div>
  )
}

// ============================================
// 样式（内联，避免 CSS 文件依赖）
// ============================================

const panelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  height: 'calc(100% - 120px)', // 减去顶部球体区高度
  background: 'rgba(18, 18, 22, 0.92)',
  backdropFilter: 'blur(20px)',
  borderRadius: '0 0 16px 16px',
  borderTop: '1px solid rgba(255, 255, 255, 0.06)',
  overflow: 'hidden',
}

const streamContainerStyle: React.CSSProperties = {
  flex: 1,
  overflow: 'hidden',
  padding: '12px 14px',
  minHeight: 0, // flex 子项允许收缩
}

const emptyHintStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
  color: 'rgba(160, 160, 176, 0.6)',
  fontSize: '13px',
  fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
}

const errorStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 10px',
  marginBottom: 8,
  background: 'rgba(239, 68, 68, 0.1)',
  border: '1px solid rgba(239, 68, 68, 0.2)',
  borderRadius: 8,
  color: '#f87171',
  fontSize: '12px',
  fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
}

const controlBarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 12px',
  borderTop: '1px solid rgba(255, 255, 255, 0.06)',
  background: 'rgba(10, 10, 12, 0.5)',
  flexShrink: 0,
}

const statusStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flex: 1,
  minWidth: 0, // 允许收缩
}

const statusTextStyle: React.CSSProperties = {
  fontSize: '12px',
  color: 'rgba(200, 200, 210, 0.9)',
  fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
  whiteSpace: 'nowrap',
}

const activityTextStyle: React.CSSProperties = {
  fontSize: '12px',
  color: 'rgba(160, 160, 176, 0.7)',
  fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  marginLeft: 4,
}

const buttonsStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  flexShrink: 0,
}

const buttonStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 8,
  border: '1px solid rgba(255, 255, 255, 0.08)',
  background: 'rgba(255, 255, 255, 0.04)',
  cursor: 'pointer',
  transition: 'background 0.15s, border-color 0.15s',
}

export const ConversationPanel = memo(ConversationPanelImpl)
