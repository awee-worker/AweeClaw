/**
 * AgentSelector - 聊天输入框下方的智能体选择器
 * 显示当前激活的智能体，支持切换或新建
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Bot, Plus, ChevronDown, Settings2, X, Eye, EyeOff } from 'lucide-react'
import { useStore } from '@store'
import { t, type Language } from '@renderer/i18n'
import { AgentIcon, ToggleSwitch } from '@components/ui'

/** 弹窗宽度，与内部列表布局保持一致 */
const POPUP_WIDTH = 256
/** 弹窗与触发按钮之间的间距 */
const POPUP_GAP = 8
/** 弹窗距视口边缘的最小留白 */
const VIEWPORT_MARGIN = 8

interface AgentSelectorProps {
  language: Language
  onOpenSettings?: () => void
  onNewAgentCreated?: (agentId: string) => void
  /** 编辑指定智能体（打开设置并定位到其编辑器） */
  onEditAgent?: (agentId: string) => void
  className?: string
  disabled?: boolean
}
export default function AgentSelector({ language, onOpenSettings, onNewAgentCreated, onEditAgent, className = '', disabled = false }: AgentSelectorProps) {
  const isZh = language === 'zh'
  // 分开订阅，避免 useShallow + set 返回新引用导致的无限循环
  const agentConfig = useStore(s => s.agentConfig)
  const set = useStore(s => s.set)
  const profiles = agentConfig?.customAgentProfiles || []
  const activeId = agentConfig?.activeCustomAgentId

  const activeProfile = profiles.find(p => p.id === activeId && p.enabled)
  const [isOpen, setIsOpen] = useState(false)
  // 弹窗挂载到 body 并用 fixed 定位：输入区嵌在多层容器内，就地渲染会被同区域的浮动按钮压住
  const triggerRef = useRef<HTMLDivElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const [popupPos, setPopupPos] = useState<{ left: number; bottom: number } | null>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (triggerRef.current?.contains(target)) return
      if (popupRef.current?.contains(target)) return
      setIsOpen(false)
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  // 弹窗位置跟随触发按钮：窗口尺寸变化或任意容器滚动时同步刷新
  const updatePopupPosition = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - POPUP_WIDTH - VIEWPORT_MARGIN)
    setPopupPos({
      left: Math.min(Math.max(VIEWPORT_MARGIN, rect.left), maxLeft),
      bottom: window.innerHeight - rect.top + POPUP_GAP,
    })
  }, [])

  useEffect(() => {
    if (!isOpen) {
      setPopupPos(null)
      return
    }
    updatePopupPosition()
    const handleReposition = () => updatePopupPosition()
    window.addEventListener('resize', handleReposition)
    window.addEventListener('scroll', handleReposition, true)
    return () => {
      window.removeEventListener('resize', handleReposition)
      window.removeEventListener('scroll', handleReposition, true)
    }
  }, [isOpen, updatePopupPosition])

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

  // 编辑当前选中的智能体（打开设置并定位到对应编辑器）
  const handleEdit = useCallback(() => {
    if (disabled || !activeProfile) return
    setIsOpen(false)
    onEditAgent?.(activeProfile.id)
  }, [disabled, activeProfile, onEditAgent, setIsOpen])

  // AI 产出文件时是否实时打开编辑器预览（默认开启）
  const livePreview = agentConfig?.liveFilePreview !== false
  const livePreviewTip = isZh
    ? `实时预览：${livePreview ? '已开启' : '已关闭'}`
    : `Live preview: ${livePreview ? 'on' : 'off'}`

  const handleToggleLivePreview = useCallback((enabled: boolean) => {
    if (!agentConfig) return
    set('agentConfig', { ...agentConfig, liveFilePreview: enabled })
    // 立即落盘，下次启动仍保持用户选择
    void useStore.getState().save()
  }, [agentConfig, set])

  const enabledProfiles = profiles.filter(p => p.enabled)

  return (
    <>
      <div ref={triggerRef} className={`relative ${className}`}>
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
          {/* 实时预览状态：收起状态下无需展开弹窗即可判断 */}
          <span
            title={livePreviewTip}
            aria-label={livePreviewTip}
            className={`flex-shrink-0 ${livePreview ? 'text-accent' : 'text-text-muted/50'}`}
          >
            {livePreview ? <Eye className="w-2.5 h-2.5" /> : <EyeOff className="w-2.5 h-2.5" />}
          </span>
          <ChevronDown className={`w-2.5 h-2.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>

        {isOpen && popupPos && createPortal(
          <div
            ref={popupRef}
            style={{ left: popupPos.left, bottom: popupPos.bottom, width: POPUP_WIDTH }}
            className="fixed z-[9999] bg-surface border border-border rounded-xl shadow-2xl py-1 animate-scale-in"
          >
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
                      <span className={`block text-xs font-medium truncate ${
                        activeId === profile.id ? 'text-accent' : 'text-text-primary'
                      }`}>
                        {profile.name}
                      </span>
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

            {/* 创建智能体入口 + 编辑当前智能体入口 */}
            <div className="border-t border-border/30 mt-1 pt-1 flex items-center">
              <button
                onClick={() => { setIsOpen(false); onNewAgentCreated?.(''); onOpenSettings?.() }}
                className="flex-1 flex items-center gap-2 px-3 py-2 text-left text-xs text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors min-w-0"
              >
                <Plus className="w-3 h-3 flex-shrink-0" />
                <span className="truncate">{isZh ? '创建智能体' : 'Create Agent'}</span>
              </button>
              <button
                onClick={handleEdit}
                disabled={!activeProfile || disabled}
                title={activeProfile
                  ? (isZh ? `编辑「${activeProfile.name}」` : `Edit "${activeProfile.name}"`)
                  : (isZh ? '请先选择智能体' : 'Select an agent first')}
                className={`flex items-center justify-center w-8 h-8 mr-1 rounded-lg text-xs transition-colors ${
                  activeProfile && !disabled
                    ? 'text-text-muted hover:text-accent hover:bg-accent/10'
                    : 'text-text-muted/30 cursor-not-allowed'
                }`}
              >
                <Settings2 className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* 实时预览开关：AI 产出文件时是否自动在编辑器中打开 */}
            <div className="border-t border-border/30 mt-1 pt-1">
              <div className="flex items-center gap-2.5 px-3 py-2">
                <span className={`flex-shrink-0 ${livePreview ? 'text-accent' : 'text-text-muted'}`}>
                  {livePreview ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                </span>
                <div className="flex-1 min-w-0 text-xs text-text-primary">
                  {isZh ? '实时预览文件' : 'Live File Preview'}
                </div>
                <ToggleSwitch
                  switchSize="sm"
                  className="flex-shrink-0"
                  checked={livePreview}
                  disabled={!agentConfig}
                  onChange={e => handleToggleLivePreview(e.target.checked)}
                  aria-label={isZh ? '实时预览文件' : 'Live File Preview'}
                />
              </div>
            </div>
          </div>,
          document.body
        )}
      </div>

    </>
  )
}
