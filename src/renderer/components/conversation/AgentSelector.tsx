/**
 * AgentSelector - 聊天输入框下方的智能体选择器
 * 显示当前激活的智能体，支持切换或新建
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import { Bot, Plus, ChevronDown, Settings2, X } from 'lucide-react'
import { useStore } from '@store'
import { t, type Language } from '@renderer/i18n'
import { AgentIcon } from '@components/ui'

interface AgentSelectorProps {
  language: Language
  onOpenSettings?: () => void
  onNewAgentCreated?: (agentId: string) => void
  className?: string
  disabled?: boolean
}
export default function AgentSelector({ language, onOpenSettings, onNewAgentCreated, className = '', disabled = false }: AgentSelectorProps) {
  const isZh = language === 'zh'
  // 分开订阅，避免 useShallow + set 返回新引用导致的无限循环
  const agentConfig = useStore(s => s.agentConfig)
  const set = useStore(s => s.set)
  const profiles = agentConfig?.customAgentProfiles || []
  const activeId = agentConfig?.activeCustomAgentId

  const activeProfile = profiles.find(p => p.id === activeId && p.enabled)
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  const handleSelect = useCallback((id: string) => {
    if (disabled) return
    set('agentConfig', { ...agentConfig!, activeCustomAgentId: id })
    setIsOpen(false)
  }, [disabled, set, agentConfig])

  const handleClear = useCallback(() => {
    if (disabled) return
    set('agentConfig', { ...agentConfig!, activeCustomAgentId: undefined })
    setIsOpen(false)
  }, [disabled, set, agentConfig])

  const enabledProfiles = profiles.filter(p => p.enabled)

  return (
    <>
      <div ref={dropdownRef} className={`relative ${className}`}>
        <button
          onClick={() => !disabled && setIsOpen(!isOpen)}
          disabled={disabled}
          className={`
            flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold
            transition-all duration-200
            ${disabled
              ? 'opacity-40 cursor-not-allowed'
              : isOpen
                ? 'bg-surface-active text-text-primary shadow-[0_0_0_1px_rgba(var(--accent)/0.15)]'
                : activeProfile
                  ? 'text-accent border border-transparent hover:border-accent/20 hover:bg-accent/5'
                  : 'text-text-muted hover:text-text-secondary'
            }
          `}
        >
          {activeProfile ? (
            <>
              <AgentIcon icon={activeProfile.icon} size={16} />
              <span className="max-w-[80px] truncate">{activeProfile.name}</span>
            </>
          ) : (
            <>
              <Bot className="w-3 h-3" />
              <span>{isZh ? '智能体' : 'Agent'}</span>
            </>
          )}
          <ChevronDown className={`w-2.5 h-2.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>

        {isOpen && (
          <div className="absolute bottom-full left-0 mb-2 w-64 bg-surface border border-border rounded-xl shadow-2xl z-50 py-1 animate-scale-in">
            {/* 已创建的智能体列表 */}
            {enabledProfiles.length > 0 ? (
              <>
                {/* 清除选择 */}
                <button
                  onClick={handleClear}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-text-muted hover:bg-surface-hover transition-colors"
                >
                  <X className="w-3 h-3" />
                  {isZh ? '不使用智能体' : 'No Agent'}
                </button>
                <div className="border-t border-border/30 my-1" />
                {enabledProfiles.map(profile => (
                  <button
                    key={profile.id}
                    onClick={() => handleSelect(profile.id)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                      activeId === profile.id ? 'bg-accent/10' : 'hover:bg-surface-hover'
                    }`}
                  >
                    <AgentIcon icon={profile.icon} size={16} />
                    <div className="flex-1 min-w-0">
                      <div className={`text-xs font-medium truncate ${
                        activeId === profile.id ? 'text-accent' : 'text-text-primary'
                      }`}>
                        {profile.name}
                      </div>
                      {profile.description && (
                        <div className="text-[11px] text-text-muted truncate">
                          {profile.description}
                        </div>
                      )}
                    </div>
                    {activeId === profile.id && (
                      <div className="w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0" />
                    )}
                  </button>
                ))}
              </>
            ) : (
              <div className="px-3 py-4 text-center">
                <div className="text-xs text-text-muted mb-3">{t('agent.createFirst', language as Language)}</div>
                <button
                  onClick={() => { setIsOpen(false); onOpenSettings?.() }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-accent/10 hover:bg-accent/20 text-accent rounded-lg text-xs font-medium mx-auto transition-colors"
                >
                  <Settings2 className="w-3 h-3" />
                  {isZh ? '前往设置创建' : 'Create in Settings'}
                </button>
              </div>
            )}

            {/* 创建智能体入口 */}
            <div className="border-t border-border/30 mt-1 pt-1">
              <button
                onClick={() => { setIsOpen(false); onNewAgentCreated?.(''); onOpenSettings?.() }}
                className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
              >
                <Plus className="w-3 h-3" />
                {isZh ? '创建智能体' : 'Create Agent'}
              </button>
            </div>
          </div>
        )}
      </div>

    </>
  )
}
