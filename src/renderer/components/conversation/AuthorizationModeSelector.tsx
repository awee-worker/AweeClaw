/**
 * 授权方式选择器
 *
 * 位于聊天输入框下方紧贴的 Bottom Actions 栏，与 ModeSelector / ModelSelector 并列。
 * 用户选择后即覆盖 autoApprove / freeModeEnabled，成为工具审批的唯一开关。
 *
 * 三种方式：
 * - every-step（手动审批，默认）：所有有副作用操作均需审批（命令、编辑、删除、邮件等）
 * - dangerous-only（自动审批）：仅危险操作（删除文件、危险命令如 rm -rf）需审批
 * - never（完全访问）：所有操作自动执行（主进程安全底线仍独立生效）
 *
 * 注意：只控制 UI 层审批门禁，不影响主进程安全底线（命令黑名单、危险模式、敏感路径、工作区边界）
 */
import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Check, ShieldCheck, ShieldAlert, ShieldOff } from 'lucide-react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import type { AuthorizationMode } from '@shared/configuration/configTypes'

interface AuthorizationModeSelectorProps {
  className?: string
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
    labelZh: '手动审批',
    labelEn: 'Manual Approval',
    descZh: '所有副作用操作均需审批（命令、编辑、删除、邮件等）',
    descEn: 'All side-effect operations require manual approval',
    color: 'text-emerald-400',
  },
  {
    id: 'dangerous-only',
    icon: ShieldAlert,
    labelZh: '自动审批',
    labelEn: 'Auto Approval',
    descZh: '仅危险操作（删除文件、危险命令如 rm -rf）需审批',
    descEn: 'Only dangerous operations (deletion, dangerous commands) require approval',
    color: 'text-amber-400',
  },
  {
    id: 'never',
    icon: ShieldOff,
    labelZh: '完全访问',
    labelEn: 'Full Access',
    descZh: '所有操作自动执行（仍受安全底线限制）',
    descEn: 'All operations auto-execute (still subject to security baseline)',
    color: 'text-red-400',
  },
]

/**
 * authorizationMode 为 undefined（旧版本未设置，回退 autoApprove 逻辑）时，
 * UI 仍展示等效的默认值 dangerous-only，让用户感知当前行为并引导显式选择。
 */
const DISPLAY_DEFAULT: AuthorizationMode = 'every-step'

export default function AuthorizationModeSelector({
  className = '',
  disabled = false,
}: AuthorizationModeSelectorProps) {
  const { language, authorizationMode, set, save } = useStore(
    useShallow(s => ({
      language: s.language,
      authorizationMode: s.authorizationMode,
      set: s.set,
      save: s.save,
    })),
  )
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // 点击外部关闭 dropdown
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

  // undefined 时展示默认值，让用户看到当前等效行为
  const effectiveMode = authorizationMode ?? DISPLAY_DEFAULT
  const currentMode = MODES.find(m => m.id === effectiveMode) || MODES[1]
  const Icon = currentMode.icon
  const isZh = language === 'zh'

  const handleSelect = (mode: AuthorizationMode) => {
    // 选中即写入 store 并持久化，即时生效，刷新后保持
    set('authorizationMode', mode)
    void save()
    setIsOpen(false)
  }

  return (
    <div ref={dropdownRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        className={`
          flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-semibold
          transition-all duration-200
          ${disabled
            ? 'opacity-40 cursor-not-allowed'
            : isOpen
              ? 'bg-surface-active text-text-primary shadow-[0_0_0_1px_rgba(var(--accent)/0.15)]'
              : 'text-text-muted hover:text-text-secondary'
          }
        `}
        title={isZh ? '授权方式' : 'Authorization'}
      >
        <Icon className={`w-3 h-3 ${currentMode.color}`} />
        <span>{isZh ? currentMode.labelZh : currentMode.labelEn}</span>
        <ChevronDown className={`w-2.5 h-2.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute bottom-full left-0 mb-2 w-60 bg-surface border border-border rounded-xl shadow-2xl z-50 py-1 animate-scale-in">
          <div className="px-3 py-1.5 text-[11px] font-semibold text-text-muted uppercase tracking-wider opacity-60">
            {isZh ? '授权方式' : 'Authorization'}
          </div>
          {MODES.map(m => {
            const ModeIcon = m.icon
            const isSelected = effectiveMode === m.id
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => handleSelect(m.id)}
                className={`
                  w-full flex items-center gap-3 px-3 py-2.5 text-left
                  transition-colors
                  ${isSelected ? 'bg-accent/10' : 'hover:bg-surface-hover'}
                `}
              >
                <ModeIcon className={`w-4 h-4 flex-shrink-0 ${m.color}`} />
                <div className="flex-1 min-w-0">
                  <div className={`text-[12px] font-medium ${isSelected ? 'text-accent' : 'text-text-primary'}`}>
                    {isZh ? m.labelZh : m.labelEn}
                  </div>
                  <div className="text-[11px] text-text-muted opacity-80 leading-snug mt-0.5">
                    {isZh ? m.descZh : m.descEn}
                  </div>
                </div>
                {isSelected && <Check className="w-3.5 h-3.5 text-accent flex-shrink-0" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
