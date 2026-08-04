/**
 * MiniAuthorizationSelector - 迷你聊天专用的授权方式选择器
 *
 * 与主窗口 AuthorizationModeSelector 功能一致，但：
 * - 不依赖 Zustand store（头像窗口是独立渲染进程，无 store）
 * - 通过 IPC 同步授权方式到主窗口 store
 * - 使用内联样式 + CSS 变量跟随主题
 *
 * 三种授权方式：
 * - every-step（每步确认）：所有副作用操作均需审批
 * - dangerous-only（危险确认，默认）：仅危险操作需审批
 * - never（无需确认）：所有操作自动执行
 */

import { memo, useState, useEffect, useRef } from 'react'
import { ChevronDown, Check, ShieldCheck, ShieldAlert, ShieldOff } from 'lucide-react'
import { api } from '@renderer/adapters/electronBridge'

type AuthorizationMode = 'every-step' | 'dangerous-only' | 'never'

interface MiniAuthorizationSelectorProps {
  /** 当前授权方式（来自 voiceContext） */
  currentMode: AuthorizationMode | undefined
  /** 语言 */
  language: 'zh' | 'en'
  /** 是否禁用 */
  disabled?: boolean
}

/** 授权方式选项配置 */
const MODES: Array<{
  id: AuthorizationMode
  icon: typeof ShieldCheck
  labelZh: string
  labelEn: string
  descZh: string
  descEn: string
  color: string
}> = [
  {
    id: 'every-step',
    icon: ShieldCheck,
    labelZh: '每步确认',
    labelEn: 'Every Step',
    descZh: '所有副作用操作均需审批',
    descEn: 'All side-effect operations require approval',
    color: 'rgb(52, 211, 153)',
  },
  {
    id: 'dangerous-only',
    icon: ShieldAlert,
    labelZh: '危险确认',
    labelEn: 'Dangerous Only',
    descZh: '仅危险操作需审批',
    descEn: 'Only dangerous operations require approval',
    color: 'rgb(251, 191, 36)',
  },
  {
    id: 'never',
    icon: ShieldOff,
    labelZh: '无需确认',
    labelEn: 'No Confirmation',
    descZh: '所有操作自动执行',
    descEn: 'All operations auto-execute',
    color: 'rgb(248, 113, 113)',
  },
]

/** 默认展示值（undefined 时回退到 dangerous-only） */
const DISPLAY_DEFAULT: AuthorizationMode = 'dangerous-only'

function MiniAuthorizationSelectorImpl({
  currentMode,
  language,
  disabled = false,
}: MiniAuthorizationSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const isZh = language === 'zh'

  // 点击外部关闭
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
  const currentModeConfig = MODES.find((m) => m.id === effectiveMode) || MODES[1]
  const Icon = currentModeConfig.icon

  const handleSelect = async (mode: AuthorizationMode) => {
    try {
      await api.floatingAvatar.selectAuthorizationMode(mode)
    } catch (err) {
      console.error('[MiniAuthorizationSelector] Select failed:', err)
    }
    setIsOpen(false)
  }

  return (
    <div ref={dropdownRef} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={() => !disabled && setIsOpen((p) => !p)}
        disabled={disabled}
        title={isZh ? '授权方式' : 'Authorization'}
        style={{
          display: 'flex', alignItems: 'center', gap: 3,
          padding: '0 6px', height: 26, borderRadius: 6,
          border: '1px solid rgb(var(--border) / 0.4)',
          background: isOpen ? 'rgb(var(--surface) / 0.6)' : 'rgb(var(--surface) / 0.3)',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.4 : 1,
          transition: 'background 0.15s',
          flexShrink: 0,
        }}
      >
        <Icon size={12} color={currentModeConfig.color} />
        <ChevronDown
          size={10}
          color="rgb(var(--text-muted) / 0.5)"
          style={{ transition: 'transform 0.2s', transform: isOpen ? 'rotate(180deg)' : 'none' }}
        />
      </button>

      {isOpen && (
        <div style={dropdownStyle}>
          <div style={dropdownHeaderStyle}>
            {isZh ? '授权方式' : 'Authorization'}
          </div>
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
                  <div style={{
                    fontSize: '12px', fontWeight: 500,
                    color: isSelected ? 'rgb(var(--accent))' : 'rgb(var(--text-primary))',
                  }}>
                    {isZh ? m.labelZh : m.labelEn}
                  </div>
                  <div style={{
                    fontSize: '11px', color: 'rgb(var(--text-muted) / 0.7)',
                    marginTop: 1, lineHeight: 1.3,
                  }}>
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
  position: 'absolute', bottom: 'calc(100% + 4px)', right: 0,
  width: 220, maxHeight: 280, overflowY: 'auto',
  background: 'rgb(var(--background-secondary) / 0.98)', backdropFilter: 'blur(20px)',
  border: '1px solid rgb(var(--border) / 0.6)', borderRadius: 10,
  boxShadow: '0 -4px 20px rgba(0, 0, 0, 0.4)', zIndex: 100, padding: 4,
}

const dropdownHeaderStyle: React.CSSProperties = {
  padding: '5px 10px 4px',
  fontSize: '11px', fontWeight: 600,
  color: 'rgb(var(--text-muted) / 0.6)',
  textTransform: 'uppercase', letterSpacing: '0.05em',
}

const itemStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'flex-start', gap: 8,
  padding: '7px 8px', borderRadius: 6,
  border: 'none', background: 'transparent',
  cursor: 'pointer', width: '100%', textAlign: 'left',
  transition: 'background 0.15s',
}

const itemSelectedStyle: React.CSSProperties = {
  background: 'rgb(var(--accent) / 0.1)',
}

export const MiniAuthorizationSelector = memo(MiniAuthorizationSelectorImpl)
