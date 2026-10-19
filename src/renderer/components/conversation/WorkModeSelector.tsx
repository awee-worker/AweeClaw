import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Check, GraduationCap, UserRound, Zap } from 'lucide-react'
import { useStore, useModeStore } from '@store'
import { useSceneModeStore } from '@renderer/modes/sceneModeStore'
import { useRoleLibraryStore } from '@renderer/modes/roleLibraryStore'
import { getLucideIcon } from '@components/foundation/IconMap'

interface ModeSelectorProps {
  className?: string
  disabled?: boolean
}

export default function ModeSelector({ className = '', disabled = false }: ModeSelectorProps) {
  const language = useStore(s => s.language)
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const currentSceneMode = useSceneModeStore(s => s.currentSceneMode)
  const getRolesByScene = useRoleLibraryStore(s => s.getRolesByScene)
  const defaultRoleId = useRoleLibraryStore(s => s.defaultRoleIds[currentSceneMode])

  const activeExpertId = useStore(s => s.agentConfig?.activeExpertId ?? null)
  const set = useStore(s => s.set)

  // 快速模式（chat）不进入角色体系：不匹配角色、不注入人设，选了也不生效。
  // 与输入框下方的 ExpertSelector 保持同一口径，避免两个入口给出不一致的状态。
  const chatMode = useModeStore(s => s.currentMode)
  const roleDisabledByMode = chatMode === 'chat'

  const sceneRoles = getRolesByScene(currentSceneMode)
  const enabledRoles = sceneRoles.filter(r => r.enabled)
  const activeRole = activeExpertId ? sceneRoles.find(r => r.id === activeExpertId && r.enabled) : null

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

  // 切到快速模式时弹窗若仍开着，会留下一个「可点但无效」的专家列表，直接收起
  useEffect(() => {
    if (roleDisabledByMode) setIsOpen(false)
  }, [roleDisabledByMode])

  const isZh = language === 'zh'
  const expertLabel = activeRole?.nameZh || (isZh ? '自动' : 'Auto')
  // 快速模式下不展示已锁定的专家名：此刻它并未注入提示词，展示会造成误判
  const buttonLabel = roleDisabledByMode
    ? (isZh ? '专家 · 快速模式不可用' : 'Expert · unavailable in Fast mode')
    : isZh
      ? `专家 · ${expertLabel}`
      : `Expert · ${expertLabel}`

  const handleSelectExpert = (roleId: string | null) => {
    if (disabled || roleDisabledByMode) return
    set('agentConfig', { ...useStore.getState().agentConfig, activeExpertId: roleId })
    setIsOpen(false)
  }

  return (
    <div ref={dropdownRef} className={`relative ${className}`}>
      <button
        onClick={() => {
          if (disabled || roleDisabledByMode) return
          setIsOpen(!isOpen)
        }}
        disabled={disabled || roleDisabledByMode}
        title={roleDisabledByMode
          ? (isZh
              ? '快速模式不启用专家角色，切换到思考或专家模式后生效'
              : 'Experts are inactive in Fast mode. Switch to Think or Expert mode.')
          : undefined}
        className={`
          flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold
          transition-all duration-200
          ${disabled || roleDisabledByMode
            ? 'opacity-40 cursor-not-allowed'
            : isOpen
              ? 'bg-surface-active text-text-primary shadow-[0_0_0_1px_rgba(var(--accent)/0.15)]'
              : 'text-text-muted hover:text-text-secondary'
          }
        `}
      >
        {roleDisabledByMode
          ? <Zap className="w-3 h-3 text-text-muted" />
          : <GraduationCap className="w-3 h-3" style={{ color: '#c084fc' }} />}
        <span className="max-w-[112px] truncate">{buttonLabel}</span>
        {!roleDisabledByMode && (
          <ChevronDown className={`w-2.5 h-2.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        )}
      </button>

      {isOpen && (
        <div className="absolute bottom-full left-0 mb-2 w-56 bg-surface border border-border rounded-xl shadow-2xl z-50 py-1 animate-scale-in">
          <div className="px-3 py-1.5 text-[10px] font-medium text-text-muted/70">
            {isZh ? '专家设置' : 'Expert settings'}
          </div>

          <div className="border-t border-border/40 py-1">
            <button
              onClick={() => handleSelectExpert(null)}
              className={`
                w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors
                ${activeExpertId === null ? 'bg-accent/10' : 'hover:bg-surface-hover'}
              `}
            >
              <UserRound className="w-4 h-4 text-text-muted" />
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-medium text-text-primary">
                  {isZh ? '自动匹配' : 'Auto match'}
                </div>
                <div className="text-[10px] text-text-muted/70 truncate">
                  {isZh ? '按当前任务自动匹配专家方法' : 'Match the scene expert automatically'}
                </div>
              </div>
              {activeExpertId === null && <Check className="w-3 h-3 flex-shrink-0 text-accent" />}
            </button>

            {enabledRoles.length > 0 ? (
              enabledRoles.map((role) => {
                const RoleIcon = getLucideIcon(role.icon)
                const isActive = activeExpertId === role.id
                const isDefault = defaultRoleId === role.id
                return (
                  <button
                    key={role.id}
                    onClick={() => handleSelectExpert(role.id)}
                    className={`
                      w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors
                      ${isActive ? 'bg-accent/10' : 'hover:bg-surface-hover'}
                    `}
                  >
                    <div
                      className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 ${
                        isActive ? 'bg-accent/15 text-accent' : 'bg-surface-active/60 text-text-muted'
                      }`}
                    >
                      <RoleIcon className="w-3.5 h-3.5" strokeWidth={1.8} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className={`text-[11px] font-medium leading-tight truncate ${isActive ? 'text-accent' : 'text-text-primary'}`}>
                        {role.nameZh}
                        {isDefault && <span className="ml-1 text-[9px] text-text-muted/60">默认</span>}
                      </div>
                      <div className="text-[10px] text-text-muted/70 leading-tight truncate">{role.description}</div>
                    </div>
                    {isActive && <Check className="w-3 h-3 flex-shrink-0 text-accent" />}
                  </button>
                )
              })
            ) : (
              <div className="px-3 py-2 text-[11px] text-text-muted/70">
                {isZh ? '当前场景暂无启用的专家' : 'No enabled expert for this scene'}
              </div>
            )}

            <div className="border-t border-border/30 mt-1 pt-1.5 px-3 pb-1.5">
              <div className="text-[10px] text-text-muted/60 leading-snug px-1">
                {isZh
                  ? '专家只改变「做事方法」，不改变安全边界与记忆域'
                  : 'Experts change methods only, not safety or memory scope.'}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
