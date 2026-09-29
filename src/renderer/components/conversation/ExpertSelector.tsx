/**
 * ExpertSelector - 聊天输入框下方的「专家角色」选择器
 *
 * 当前输入区默认执行档位固定为专家档（WorkMode=expert），这里只负责：
 * 1. 自动匹配（当前场景默认角色 + autoMatch）
 * 2. 显式锁定当前场景下的某个角色
 *
 * 专家角色只影响「用哪套方法做事」，不改变安全边界与记忆域。
 */
import { useEffect, useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Check, GraduationCap, Search } from 'lucide-react'
import { useStore } from '@store'
import { useSceneModeStore } from '@renderer/modes/sceneModeStore'
import { useRoleLibraryStore } from '@renderer/modes/roleLibraryStore'
import { getLucideIcon } from '@components/foundation/IconMap'

const POPUP_WIDTH = 268
const POPUP_GAP = 8
const VIEWPORT_MARGIN = 8
const POPUP_MAX_HEIGHT = 420

interface ExpertSelectorProps {
  className?: string
  disabled?: boolean
}

export default function ExpertSelector({ className = '', disabled = false }: ExpertSelectorProps) {
  const language = useStore(s => s.language)
  const currentSceneMode = useSceneModeStore(s => s.currentSceneMode)
  const getRolesByScene = useRoleLibraryStore(s => s.getRolesByScene)
  const defaultRoleId = useRoleLibraryStore(s => s.defaultRoleIds[currentSceneMode])

  const activeExpertId = useStore(s => s.agentConfig?.activeExpertId ?? null)
  const set = useStore(s => s.set)

  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const triggerRef = useRef<HTMLDivElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const sceneRoles = getRolesByScene(currentSceneMode)
  const enabledRoles = sceneRoles.filter(r => r.enabled)
  const activeRole = activeExpertId ? sceneRoles.find(r => r.id === activeExpertId && r.enabled) : null
  const isZh = language === 'zh'

  const visibleRoles = enabledRoles.filter(role => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return role.nameZh.toLowerCase().includes(q)
      || role.name.toLowerCase().includes(q)
      || role.description.toLowerCase().includes(q)
      || role.id.toLowerCase().includes(q)
  })

  /* ---------- 弹窗位置跟随触发按钮（窗口/滚动时刷新） ---------- */
  useEffect(() => {
    if (!isOpen) return
    const trigger = triggerRef.current
    if (!trigger) return
    const el = popupRef.current
    if (el) {
      const rect = trigger.getBoundingClientRect()
      const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - POPUP_WIDTH - VIEWPORT_MARGIN)
      el.style.left = `${Math.min(Math.max(VIEWPORT_MARGIN, rect.left), maxLeft)}px`
      el.style.bottom = `${window.innerHeight - rect.top + POPUP_GAP}px`
    }
    const handleReposition = () => {
      const t = triggerRef.current
      const p = popupRef.current
      if (!t || !p) return
      const rect = t.getBoundingClientRect()
      const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - POPUP_WIDTH - VIEWPORT_MARGIN)
      p.style.left = `${Math.min(Math.max(VIEWPORT_MARGIN, rect.left), maxLeft)}px`
      p.style.bottom = `${window.innerHeight - rect.top + POPUP_GAP}px`
    }
    window.addEventListener('resize', handleReposition)
    window.addEventListener('scroll', handleReposition, true)
    return () => {
      window.removeEventListener('resize', handleReposition)
      window.removeEventListener('scroll', handleReposition, true)
    }
  }, [isOpen])

  /* ---------- 选择动作 ---------- */
  const handleSelectRole = useCallback((roleId: string | null) => {
    if (disabled) return
    set('agentConfig', { ...useStore.getState().agentConfig, activeExpertId: roleId })
    setIsOpen(false)
  }, [disabled, set])

  const openPopup = useCallback(() => {
    if (disabled || isOpen) return
    setSearch('')
    setIsOpen(true)
    requestAnimationFrame(() => searchInputRef.current?.focus({ preventScroll: true }))
  }, [disabled, isOpen])

  const closePopup = useCallback(() => {
    setIsOpen(false)
    setSearch('')
  }, [])

  /* ---------- 点击外部关闭 ---------- */
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: MouseEvent) => {
      if (triggerRef.current?.contains(e.target as Node)) return
      if (popupRef.current?.contains(e.target as Node)) return
      closePopup()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [isOpen])

  return (
    <>
      <div ref={triggerRef} className={`relative ${className}`}>
        <button
          onClick={openPopup}
          disabled={disabled}
          className={`
            flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold
            transition-all duration-200
            ${disabled
              ? 'opacity-40 cursor-not-allowed'
              : isOpen
                ? 'bg-surface-active text-text-primary shadow-[0_0_0_1px_rgba(var(--accent)/0.15)]'
                : activeRole
                  ? 'text-accent border border-transparent hover:border-accent/20 hover:bg-accent/5'
                  : 'text-text-muted hover:text-text-secondary'
          }
        `}
        >
          <GraduationCap className="w-3 h-3 text-purple-400" />
          <span className="max-w-[72px] truncate">
            {activeRole ? activeRole.nameZh : (isZh ? '自动' : 'Auto')}
          </span>
          <ChevronDown className={`w-2.5 h-2.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {isOpen && createPortal(
        <div
          ref={popupRef}
          style={{ width: POPUP_WIDTH, maxHeight: POPUP_MAX_HEIGHT, overflowY: 'auto' }}
          className="fixed z-[9999] bg-surface border border-border rounded-xl shadow-2xl py-1 animate-scale-in"
        >
          <div className="px-3 pt-1.5 pb-2">
            <div className="text-[10px] text-text-muted/70 px-1 mb-1.5">{isZh ? '搜索专家' : 'Search experts'}</div>
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                ref={searchInputRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={isZh ? '按名称、描述或关键词搜索' : 'Search by name, description, keyword'}
                className="w-full pl-7 pr-2 py-1.5 text-[11px] bg-input border border-input-border rounded-lg outline-none focus:border-accent"
              />
            </div>
          </div>

          <div className="border-t border-border/40 mt-1 py-1">
            <button
              onClick={() => handleSelectRole(null)}
              className={`
                w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors
                ${activeExpertId === null
                  ? 'bg-accent/10'
                  : 'hover:bg-surface-active'}
              `}
            >
              <div className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 bg-purple-500/10 text-purple-400">
                <GraduationCap className="w-3.5 h-3.5" strokeWidth={1.8} />
              </div>
              <div className="min-w-0 flex-1">
                <div className={`text-[11px] font-medium truncate ${activeExpertId === null ? 'text-accent' : 'text-text-primary'}`}>
                  {isZh ? '自动匹配' : 'Auto match'}
                </div>
                <div className="text-[10px] text-text-muted/70 truncate">
                  {isZh ? '按场景默认角色与任务特征自动选择' : 'Pick a role automatically by scene and task'}
                </div>
              </div>
              {activeExpertId === null && <Check className="w-3 h-3 flex-shrink-0 text-accent" />}
            </button>

            {visibleRoles.length === 0 && (
              <div className="px-3 py-2 text-[11px] text-text-muted/70">
                {search.trim()
                  ? (isZh ? '未找到匹配的专家' : 'No matching experts found')
                  : (isZh ? '当前场景暂无启用的专家角色' : 'No enabled expert role in this scene')}
              </div>
            )}

            {visibleRoles.map((role) => {
              const RoleIcon = getLucideIcon(role.icon)
              const isActive = activeExpertId === role.id
              const isDefault = defaultRoleId === role.id
              return (
                <button
                  key={role.id}
                  onClick={() => handleSelectRole(role.id)}
                  className={`
                    w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors
                    ${isActive ? 'bg-accent/10' : 'hover:bg-surface-active'}
                  `}
                >
                  <div
                    className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 bg-purple-500/10 text-purple-400"
                  >
                    <RoleIcon className="w-3.5 h-3.5" strokeWidth={1.8} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className={`text-[11px] font-medium leading-tight truncate ${isActive ? 'text-accent' : 'text-text-primary'}`}>
                      {role.nameZh}
                      {isDefault && <span className="ml-1 text-[9px] text-text-muted/60">{isZh ? '默认' : 'default'}</span>}
                    </div>
                    <div className="text-[10px] text-text-muted/70 leading-tight truncate">{role.description}</div>
                  </div>
                  {isActive && <Check className="w-3 h-3 flex-shrink-0 text-accent" />}
                </button>
              )
            })}
          </div>

          <div className="border-t border-border/30 mt-1 pt-1.5 px-3 pb-1.5">
            <div className="text-[10px] text-text-muted/60 leading-snug px-1">
              {isZh ? '专家只改变「做事方法」，不改变安全边界与记忆域' : 'Experts change method only, not safety or memory scope.'}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}


