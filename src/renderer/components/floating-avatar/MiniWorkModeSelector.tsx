/**
 * MiniWorkModeSelector - 迷你聊天专用的工作模式选择器
 *
 * 与主窗口 WorkModeSelector 功能一致，但：
 * - 不依赖 Zustand store（头像窗口是独立渲染进程，无 store）
 * - 通过 IPC 同步工作模式到主窗口 store
 * - 三种模式：快速（chat）、思考（agent）、专家（plan）
 */

import { memo, useState, useEffect, useRef } from 'react'
import { ChevronDown, Check, Zap, Brain, GraduationCap } from 'lucide-react'
import { api } from '@renderer/adapters/electronBridge'

type WorkMode = 'chat' | 'agent' | 'plan'

interface MiniWorkModeSelectorProps {
  /** 当前工作模式（来自 voiceContext） */
  currentMode: WorkMode | undefined
  /** 语言 */
  language: 'zh' | 'en'
  /** 是否禁用 */
  disabled?: boolean
}

/** 工作模式选项配置 */
const MODES: Array<{
  id: WorkMode
  icon: typeof Zap
  labelZh: string
  labelEn: string
  descZh: string
  descEn: string
  color: string
}> = [
  {
    id: 'chat',
    icon: Zap,
    labelZh: '快速',
    labelEn: 'Quick',
    descZh: '适用于大部分情况',
    descEn: 'Suitable for most situations',
    color: 'rgb(96, 165, 250)',
  },
  {
    id: 'agent',
    icon: Brain,
    labelZh: '思考',
    labelEn: 'Think',
    descZh: '擅长解决更难的问题',
    descEn: 'Excels at harder problems',
    color: 'rgb(var(--accent))',
  },
  {
    id: 'plan',
    icon: GraduationCap,
    labelZh: '专家',
    labelEn: 'Expert',
    descZh: '研究级智能模式',
    descEn: 'Research-grade intelligence',
    color: 'rgb(192, 132, 252)',
  },
]

/** 默认展示值（undefined 时回退到 chat） */
const DISPLAY_DEFAULT: WorkMode = 'chat'

function MiniWorkModeSelectorImpl({
  currentMode,
  language,
  disabled = false,
}: MiniWorkModeSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const isZh = language === 'zh'

  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  const effectiveMode = currentMode ?? DISPLAY_DEFAULT
  const currentModeConfig = MODES.find((m) => m.id === effectiveMode) || MODES[0]
  const Icon = currentModeConfig.icon

  const handleSelect = async (mode: WorkMode) => {
    try {
      await api.floatingAvatar.selectWorkMode(mode)
    } catch (err) {
      console.error('[MiniWorkModeSelector] Select failed:', err)
    }
    setIsOpen(false)
  }

  return (
    <div ref={dropdownRef} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={() => !disabled && setIsOpen((p) => !p)}
        disabled={disabled}
        title={isZh ? '工作模式' : 'Work Mode'}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '0 8px',
          height: 28,
          borderRadius: 8,
          border: '1px solid rgb(var(--border) / 0.4)',
          background: isOpen ? 'rgb(var(--surface) / 0.6)' : 'rgb(var(--surface) / 0.3)',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.4 : 1,
          transition: 'background 0.15s',
          flexShrink: 0,
          fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif',
        }}
      >
        <Icon size={13} color={currentModeConfig.color} />
        <span style={{ fontSize: '12px', color: 'rgb(var(--text-secondary) / 0.9)', whiteSpace: 'nowrap' }}>
          {isZh ? currentModeConfig.labelZh : currentModeConfig.labelEn}
        </span>
        <ChevronDown
          size={11}
          color="rgb(var(--text-muted) / 0.5)"
          style={{ transition: 'transform 0.2s', transform: isOpen ? 'rotate(180deg)' : 'none' }}
        />
      </button>

      {isOpen && (
        <div style={dropdownStyle}>
          <div style={dropdownHeaderStyle}>{isZh ? '工作模式' : 'Work Mode'}</div>
          {MODES.map((m) => {
            const ModeIcon = m.icon
            const isSelected = effectiveMode === m.id
            return (
              <button
                key={m.id}
                onClick={() => void handleSelect(m.id)}
                style={{
                  ...itemStyle,
                  ...(isSelected ? itemSelectedStyle : {}),
                }}
              >
                <ModeIcon size={14} color={m.color} style={{ flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: '12px',
                      fontWeight: 500,
                      color: isSelected ? 'rgb(var(--accent))' : 'rgb(var(--text-primary))',
                    }}
                  >
                    {isZh ? m.labelZh : m.labelEn}
                  </div>
                  <div
                    style={{
                      fontSize: '11px',
                      color: 'rgb(var(--text-muted) / 0.7)',
                      marginTop: 1,
                      lineHeight: 1.3,
                    }}
                  >
                    {isZh ? m.descZh : m.descEn}
                  </div>
                </div>
                {isSelected && <Check size={12} color="rgb(var(--accent))" style={{ flexShrink: 0 }} />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ============================================
// 样式
// ============================================

const dropdownStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 'calc(100% + 8px)',
  left: 0,
  width: 240,
  maxHeight: 280,
  overflowY: 'auto',
  background: 'rgb(var(--background-secondary) / 0.98)',
  backdropFilter: 'blur(20px)',
  border: '1px solid rgb(var(--border) / 0.6)',
  borderRadius: 10,
  boxShadow: '0 -4px 20px rgba(0, 0, 0, 0.4)',
  zIndex: 200,
  padding: 4,
}

const dropdownHeaderStyle: React.CSSProperties = {
  padding: '5px 10px 4px',
  fontSize: '11px',
  fontWeight: 600,
  color: 'rgb(var(--text-muted) / 0.6)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
}

const itemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  padding: '7px 8px',
  borderRadius: 6,
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  width: '100%',
  textAlign: 'left',
  transition: 'background 0.15s',
}

const itemSelectedStyle: React.CSSProperties = {
  background: 'rgb(var(--accent) / 0.1)',
}

export const MiniWorkModeSelector = memo(MiniWorkModeSelectorImpl)
