/**
 * ExpertSelector - 聊天输入框下方的「专家角色」选择器
 *
 * 当前输入区默认执行档位固定为专家档（WorkMode=expert），这里只负责：
 * 1. 自动模式（当前场景默认角色 + autoMatch）
 * 2. 任务计划模式（本轮强制先用 create_task_plan 拆解任务）
 * 3. 显式锁定当前场景下的某个角色
 *
 * 专家角色只影响「用哪套方法做事」，不改变安全边界与记忆域。
 *
 * 快速模式（chat）不进入角色体系（isRoleAgentEnabled 只放行 agent/expert），
 * 该模式下入口整体置灰并改为显示「快速模式」，避免选中态与实际执行不一致。
 */
import { useEffect, useMemo, useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Check, GraduationCap, ListChecks, Search, Zap, AlertTriangle } from 'lucide-react'
import { useStore, useModeStore } from '@store'
import { useSceneModeStore } from '@renderer/modes/sceneModeStore'
import { useRoleLibraryStore } from '@renderer/modes/roleLibraryStore'
import { sceneModeRegistry } from '@intelligence/capabilities/sceneMode/SceneModeRegistry'
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
  /**
   * 全库角色查询 + 角色列表/覆盖订阅
   *
   * 失效判定需要两件事：按 id 查到角色（含不属于当前场景的），以及
   * 角色被停用/删除后能重新计算。getRolesByScene 只覆盖当前场景，
   * 拿不到「原属哪个场景」，所以这里额外订阅全库。
   */
  const getRole = useRoleLibraryStore(s => s.getRole)
  const allRoles = useRoleLibraryStore(s => s.roles)
  const roleOverrides = useRoleLibraryStore(s => s.overrides)

  const activeExpertId = useStore(s => s.agentConfig?.activeExpertId ?? null)
  const taskPlanMode = useStore(s => s.agentConfig?.taskPlanMode ?? false)
  const set = useStore(s => s.set)

  // 快速模式（chat）不进入角色体系：不匹配角色、不注入人设，选了也不生效。
  // 这里显式关掉入口，避免"界面显示已选专家、实际按场景默认人设执行"的错觉。
  const chatMode = useModeStore(s => s.currentMode)
  const roleDisabledByMode = chatMode === 'chat'

  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const triggerRef = useRef<HTMLDivElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const sceneRoles = getRolesByScene(currentSceneMode)
  const enabledRoles = sceneRoles.filter(r => r.enabled)
  const activeRole = activeExpertId ? sceneRoles.find(r => r.id === activeExpertId && r.enabled) : null
  const isZh = language === 'zh'
  // 自动模式 = 未锁定具体专家，且未开启任务计划模式
  const autoModeActive = activeExpertId === null && !taskPlanMode

  /**
   * 锁定专家失效判定
   *
   * agentConfig.activeExpertId 是会话级全局配置，切换场景时不会被清空，而
   * sceneRoles 只含当前场景的角色。于是「切换了场景」「角色被停用」「角色被删」
   * 三种情况都会落到 activeRole === null，但 activeExpertId 仍留着旧值。
   *
   * 这种状态必须显式告知用户，原因有两个：
   * 1. sceneRoleMatcher 在「有锁定 ID 但角色不可用」时直接返回空结果，
   *    不降级到规则匹配 —— 本轮实际走场景默认人设，既不是所选专家，
   *    也不是自动匹配出来的角色；
   * 2. 旧代码此时按钮显示「自动」（见下方 activeRole ? ... : '自动'），
   *    与实际执行不符，用户会误以为仍在自动选择。
   *
   * 快速模式（chat）整体不进入角色体系，那里是「模式禁用」而不是「角色失效」，
   * 由 roleDisabledByMode 单独表达，不参与本判定。
   */
  const expertInvalid = Boolean(activeExpertId && !activeRole && !roleDisabledByMode)
  const invalidExpertRole = useMemo(
    () => (expertInvalid && activeExpertId ? getRole(activeExpertId) : undefined),
    // allRoles / roleOverrides 只用于在角色被停用或删除后触发重算
    [expertInvalid, activeExpertId, getRole, allRoles, roleOverrides],
  )
  /** 失效角色原先所属场景的中文名（角色已被删除时为空） */
  const invalidExpertOriginScene = invalidExpertRole
    ? sceneModeRegistry.getOrDefault(invalidExpertRole.sceneMode)?.displayNameZh
    : undefined

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
    set('agentConfig', { ...useStore.getState().agentConfig, activeExpertId: roleId, taskPlanMode: false })
    setIsOpen(false)
  }, [disabled, set])

  const handleSelectTaskPlanMode = useCallback(() => {
    if (disabled) return
    set('agentConfig', { ...useStore.getState().agentConfig, activeExpertId: null, taskPlanMode: true })
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
          disabled={disabled || roleDisabledByMode}
          title={roleDisabledByMode
            ? (isZh
                ? '快速模式不启用专家角色，切换到思考或专家模式后生效'
                : 'Experts are inactive in Fast mode. Switch to Think or Expert mode.')
            : expertInvalid
              ? (isZh
                  ? `「${invalidExpertRole?.nameZh ?? activeExpertId}」在当前场景不可用${invalidExpertOriginScene ? `（原属「${invalidExpertOriginScene}」场景）` : ''}，本轮按场景默认人设执行，不会再自动匹配其它专家。点击重新选择。`
                  : `"${invalidExpertRole?.nameZh ?? activeExpertId}" is unavailable in the current scene, so this turn falls back to the default persona instead of auto-matching. Click to choose again.`)
              : undefined}
          className={`
            flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold
            transition-all duration-200
            ${disabled || roleDisabledByMode
              ? 'opacity-40 cursor-not-allowed'
              : isOpen
                ? 'bg-surface-active text-text-primary shadow-[0_0_0_1px_rgba(var(--accent)/0.15)]'
                : expertInvalid
                  ? 'text-status-warning border border-status-warning/30 hover:bg-status-warning/10'
                  : activeRole
                    ? 'text-accent border border-transparent hover:border-accent/20 hover:bg-accent/5'
                    : 'text-text-muted hover:text-text-secondary'
          }
        `}
        >
          {roleDisabledByMode
            ? <Zap className="w-3 h-3 text-text-muted" />
            : expertInvalid
              ? <AlertTriangle className="w-3 h-3 text-status-warning" />
              : taskPlanMode
                ? <ListChecks className="w-3 h-3 text-purple-400" />
                : <GraduationCap className="w-3 h-3 text-purple-400" />}
          <span className="max-w-[72px] truncate">
            {/* 快速模式下不展示已锁定的专家名：此刻它并未注入提示词，展示会造成误判 */}
            {roleDisabledByMode
              ? (isZh ? '快速模式' : 'Fast mode')
              : expertInvalid
                ? (isZh ? '专家已失效' : 'Unavailable')
                : taskPlanMode
                  ? (isZh ? '任务计划' : 'Task plan')
                  : activeRole
                    ? activeRole.nameZh
                    : (isZh ? '自动' : 'Auto')}
          </span>
          {!roleDisabledByMode && (
            <ChevronDown className={`w-2.5 h-2.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          )}
        </button>
      </div>

      {isOpen && createPortal(
        <div
          ref={popupRef}
          style={{ width: POPUP_WIDTH, maxHeight: POPUP_MAX_HEIGHT, overflowY: 'auto' }}
          className="fixed z-[9999] bg-popover border border-border rounded-xl shadow-2xl py-1 animate-scale-in"
        >
          <div className="px-3 pt-2 pb-2">
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

          {/*
            失效提示：锁定的专家不在当前场景（切了场景）、已被停用或已被删除。
            此时 sceneRoleMatcher 不会降级到规则匹配，本轮实际按场景默认人设执行，
            所以这里必须把「不会自动匹配其它专家」说清楚，避免用户以为还在自动选择。
          */}
          {expertInvalid && (
            <div className="mx-2 mb-1 flex items-start gap-2 rounded-lg border border-status-warning/25 bg-status-warning/8 px-2.5 py-2">
              <AlertTriangle className="mt-0.5 w-3 h-3 flex-shrink-0 text-status-warning" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[11px] font-medium leading-tight text-status-warning">
                  {isZh
                    ? `「${invalidExpertRole?.nameZh ?? activeExpertId}」不可用`
                    : `"${invalidExpertRole?.nameZh ?? activeExpertId}" is unavailable`}
                </div>
                <div className="mt-0.5 text-[10px] leading-snug text-text-muted/80">
                  {isZh
                    ? `${invalidExpertOriginScene ? `原属「${invalidExpertOriginScene}」场景 · ` : '角色已删除 · '}本轮按场景默认人设执行，不会自动匹配其它专家`
                    : 'This turn uses the default persona; other experts are not auto-matched'}
                </div>
                <button
                  onClick={() => handleSelectRole(null)}
                  className="mt-1 text-[10px] font-medium text-accent hover:underline"
                >
                  {isZh ? '改用自动模式' : 'Switch to auto mode'}
                </button>
              </div>
            </div>
          )}

          <div className="border-t border-border/40 mt-1 py-1">
            <button
              onClick={() => handleSelectRole(null)}
              className={`
                w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors
                ${autoModeActive
                  ? 'bg-accent/10'
                  : 'hover:bg-surface-active'}
              `}
            >
              <div className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 bg-purple-500/10 text-purple-400">
                <GraduationCap className="w-3.5 h-3.5" strokeWidth={1.8} />
              </div>
              <div className="min-w-0 flex-1">
                <div className={`text-[11px] font-medium truncate ${autoModeActive ? 'text-accent' : 'text-text-primary'}`}>
                  {isZh ? '自动模式' : 'Auto mode'}
                </div>
                <div className="text-[10px] text-text-muted/70 truncate">
                  {isZh ? '按场景默认角色与任务特征自动选择' : 'Pick a role automatically by scene and task'}
                </div>
              </div>
              {autoModeActive && <Check className="w-3 h-3 flex-shrink-0 text-accent" />}
            </button>

            <button
              onClick={handleSelectTaskPlanMode}
              className={`
                w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors
                ${taskPlanMode
                  ? 'bg-accent/10'
                  : 'hover:bg-surface-active'}
              `}
            >
              <div className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 bg-purple-500/10 text-purple-400">
                <ListChecks className="w-3.5 h-3.5" strokeWidth={1.8} />
              </div>
              <div className="min-w-0 flex-1">
                <div className={`text-[11px] font-medium truncate ${taskPlanMode ? 'text-accent' : 'text-text-primary'}`}>
                  {isZh ? '任务计划模式' : 'Task plan mode'}
                </div>
                <div className="text-[10px] text-text-muted/70 truncate">
                  {isZh ? '先拆解任务计划，再按计划执行' : 'Break the task into a plan, then execute it'}
                </div>
              </div>
              {taskPlanMode && <Check className="w-3 h-3 flex-shrink-0 text-accent" />}
            </button>

            {/* 任务计划模式是「执行方式」，下面的专家是「执行角色」，两者分属不同维度 */}
            <div className="my-1 mx-3 border-t border-border/50" />

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
        </div>,
        document.body,
      )}
    </>
  )
}


