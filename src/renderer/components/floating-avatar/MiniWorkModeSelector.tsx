/**
 * MiniWorkModeSelector - 迷你聊天专用的专家档标识
 *
 * 主窗口默认固定为 expert（专家档）。迷你窗口与主窗口保持一致：
 * - 不暴露 chat/agent 切换入口
 * - 通过 IPC 把 expert 同步给主窗口 useModeStore
 */

import { memo } from 'react'
import { ChevronDown, GraduationCap } from 'lucide-react'
import { api } from '@renderer/adapters/electronBridge'

type WorkMode = 'chat' | 'agent' | 'expert'

interface MiniWorkModeSelectorProps {
  /** 当前工作模式（来自 voiceContext，兼容历史值） */
  currentMode: WorkMode | undefined
  /** 语言 */
  language: 'zh' | 'en'
  /** 是否禁用 */
  disabled?: boolean
}

function MiniWorkModeSelectorImpl({ currentMode, language, disabled = false }: MiniWorkModeSelectorProps) {
  const isZh = language === 'zh'
  const isExpert = (currentMode ?? 'expert') === 'expert'

  const handleSelect = async () => {
    if (disabled) return
    try {
      await api.floatingAvatar.selectWorkMode('expert')
    } catch (err) {
      console.error('[MiniWorkModeSelector] Select failed:', err)
    }
  }

  return (
    <button
      onClick={() => void handleSelect()}
      disabled={disabled}
      title={isZh ? '专家档' : 'Expert Mode'}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '0 8px',
        height: 28,
        borderRadius: 8,
        border: '1px solid rgb(var(--border) / 0.4)',
        background: isExpert ? 'rgb(var(--surface) / 0.6)' : 'rgb(var(--surface) / 0.3)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        transition: 'background 0.15s',
        flexShrink: 0,
        fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif',
      }}
    >
      <GraduationCap size={13} color="rgb(192, 132, 252)" />
      <span style={{ fontSize: '12px', color: 'rgb(var(--text-secondary) / 0.9)', whiteSpace: 'nowrap' }}>
        {isZh ? '专家' : 'Expert'}
      </span>
      <ChevronDown size={11} color="rgb(var(--text-muted) / 0.5)" />
    </button>
  )
}

export const MiniWorkModeSelector = memo(MiniWorkModeSelectorImpl)
