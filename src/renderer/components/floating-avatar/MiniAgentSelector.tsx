/**
 * MiniAgentSelector - 迷你聊天专用的自定义智能体选择器
 *
 * 与主窗口 AgentSelector 功能一致，但：
 * - 不依赖 Zustand store（头像窗口是独立渲染进程，无主窗口数据）
 * - 智能体列表 / 当前激活 id 来自 voiceContext（主窗口同步）
 * - 选择时通过 IPC 同步到主窗口 store（主窗口更新 + save + 重新 push voiceContext）
 *
 * 位置：迷你聊天输入框下方授权栏最前面（思考模式前，与主聊天窗口一致）
 */

import { memo, useState, useEffect, useRef } from 'react'
import { Bot, ChevronDown, Check, X, Plus, Settings2 } from 'lucide-react'
import { AgentIcon } from '@components/ui'
import { api } from '@renderer/adapters/electronBridge'
import type { AvatarAgentConfig } from '../../types/electronBridge'

interface MiniAgentSelectorProps {
  /** 自定义智能体配置（来自 voiceContext.agentConfig） */
  agentConfig?: AvatarAgentConfig | null
  /** 语言 */
  language: 'zh' | 'en'
  /** 是否禁用 */
  disabled?: boolean
}

function MiniAgentSelectorImpl({
  agentConfig,
  language,
  disabled = false,
}: MiniAgentSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const isZh = language === 'zh'

  const profiles = (agentConfig?.customAgentProfiles || []).filter((p) => p.enabled)
  const activeId = agentConfig?.activeCustomAgentId ?? null
  const activeProfile = profiles.find((p) => p.id === activeId) || null

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

  const handleSelect = async (id: string | null) => {
    try {
      await api.floatingAvatar.selectAgent(id)
    } catch (err) {
      console.error('[MiniAgentSelector] Select failed:', err)
    }
    setIsOpen(false)
  }

  const handleCreate = async () => {
    setIsOpen(false)
    try {
      // 打开主窗口设置页（用户可创建/管理智能体）
      await api.floatingAvatar.openSettings()
      await api.floatingAvatar.openMainWindow()
    } catch (err) {
      console.error('[MiniAgentSelector] Open settings failed:', err)
    }
  }

  return (
    <div ref={dropdownRef} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={() => !disabled && setIsOpen((p) => !p)}
        disabled={disabled}
        title={isZh ? '智能体' : 'Agent'}
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
          maxWidth: 120,
          fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif',
        }}
      >
        {activeProfile ? (
          <>
            <AgentIcon icon={activeProfile.icon} size={13} className="text-accent" />
            <span
              style={{
                fontSize: '12px',
                color: 'rgb(var(--accent))',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {activeProfile.name}
            </span>
          </>
        ) : (
          <>
            <Bot size={13} color="rgb(var(--text-muted) / 0.8)" />
            <span
              style={{
                fontSize: '12px',
                color: 'rgb(var(--text-secondary) / 0.9)',
                whiteSpace: 'nowrap',
              }}
            >
              {isZh ? '智能体' : 'Agent'}
            </span>
          </>
        )}
        <ChevronDown
          size={11}
          color="rgb(var(--text-muted) / 0.5)"
          style={{ transition: 'transform 0.2s', transform: isOpen ? 'rotate(180deg)' : 'none' }}
        />
      </button>

      {isOpen && (
        <div style={dropdownStyle}>
          <div style={dropdownHeaderStyle}>{isZh ? '智能体' : 'Agent'}</div>

          {profiles.length > 0 ? (
            <>
              {/* 清除选择（不使用智能体） */}
              <button
                onClick={() => void handleSelect(null)}
                style={{
                  ...itemStyle,
                  ...(!activeProfile ? itemSelectedStyle : {}),
                }}
              >
                <X size={13} color="rgb(var(--text-muted) / 0.8)" style={{ flexShrink: 0, marginTop: 2 }} />
                <span style={{ fontSize: '12px', color: 'rgb(var(--text-primary))' }}>
                  {isZh ? '不使用智能体' : 'No Agent'}
                </span>
                {!activeProfile && <Check size={12} color="rgb(var(--accent))" style={{ flexShrink: 0 }} />}
              </button>
              <div style={{ height: 1, background: 'rgb(var(--border) / 0.3)', margin: '4px 0' }} />

              {profiles.map((profile) => {
                const isSelected = activeId === profile.id
                return (
                  <button
                    key={profile.id}
                    onClick={() => void handleSelect(profile.id)}
                    style={{
                      ...itemStyle,
                      ...(isSelected ? itemSelectedStyle : {}),
                    }}
                  >
                    <AgentIcon icon={profile.icon} size={14} className="text-accent" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: '12px',
                          fontWeight: 500,
                          color: isSelected ? 'rgb(var(--accent))' : 'rgb(var(--text-primary))',
                        }}
                      >
                        {profile.name}
                      </div>
                      {profile.description && (
                        <div
                          style={{
                            fontSize: '11px',
                            color: 'rgb(var(--text-muted) / 0.7)',
                            marginTop: 1,
                            lineHeight: 1.3,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {profile.description}
                        </div>
                      )}
                    </div>
                    {isSelected && <Check size={12} color="rgb(var(--accent))" style={{ flexShrink: 0 }} />}
                  </button>
                )
              })}
            </>
          ) : (
            <div style={{ padding: '12px 8px', textAlign: 'center' }}>
              <div style={{ fontSize: '12px', color: 'rgb(var(--text-muted) / 0.7)', marginBottom: 8 }}>
                {isZh ? '暂无可用智能体' : 'No agents available'}
              </div>
              <button
                onClick={() => void handleCreate()}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '5px 10px',
                  borderRadius: 6,
                  border: 'none',
                  background: 'rgb(var(--accent) / 0.1)',
                  color: 'rgb(var(--accent))',
                  fontSize: '12px',
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                <Settings2 size={12} />
                {isZh ? '前往设置创建' : 'Create in Settings'}
              </button>
            </div>
          )}

          {/* 创建智能体入口 */}
          <div style={{ height: 1, background: 'rgb(var(--border) / 0.3)', margin: '4px 0' }} />
          <button
            onClick={() => void handleCreate()}
            style={{ ...itemStyle, color: 'rgb(var(--text-muted) / 0.9)' }}
          >
            <Plus size={13} style={{ flexShrink: 0, marginTop: 2 }} />
            <span style={{ fontSize: '12px' }}>{isZh ? '创建智能体' : 'Create Agent'}</span>
          </button>
        </div>
      )}
    </div>
  )
}

// ============================================
// 样式（与 MiniWorkModeSelector 一致）
// ============================================

const dropdownStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 'calc(100% + 8px)',
  left: 0,
  width: 260,
  maxHeight: 300,
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

export const MiniAgentSelector = memo(MiniAgentSelectorImpl)
