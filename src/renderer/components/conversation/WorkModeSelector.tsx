import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Check, Zap, Brain, GraduationCap } from 'lucide-react'
import { WorkMode } from '@/renderer/modes/workModeTypes'
import { useStore } from '@store'

interface ModeSelectorProps {
  mode: WorkMode
  onModeChange: (mode: WorkMode) => void
  className?: string
  disabled?: boolean
}

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
    color: 'text-blue-400',
  },
  {
    id: 'agent',
    icon: Brain,
    labelZh: '思考',
    labelEn: 'Think',
    descZh: '擅长解决更难的问题',
    descEn: 'Excels at harder problems',
    color: 'text-accent',
  },
  {
    id: 'plan',
    icon: GraduationCap,
    labelZh: '专家',
    labelEn: 'Expert',
    descZh: '研究级智能模式',
    descEn: 'Research-grade intelligence',
    color: 'text-purple-400',
  },
]

export default function ModeSelector({ mode, onModeChange, className = '', disabled = false }: ModeSelectorProps) {
  const language = useStore(s => s.language)
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

  const currentMode = MODES.find((m) => m.id === mode) || MODES[0]
  const Icon = currentMode.icon
  const isZh = language === 'zh'

  return (
    <div ref={dropdownRef} className={`relative ${className}`}>
      <div className="flex items-center">
        <button
          onClick={() => !disabled && setIsOpen(!isOpen)}
          className={`
            flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold
            transition-all duration-200
            ${disabled
              ? 'opacity-40 cursor-not-allowed'
              : isOpen
                ? 'bg-surface-active text-text-primary shadow-[0_0_0_1px_rgba(var(--accent)/0.15)]'
                : 'text-text-muted hover:text-text-secondary'
            }
          `}
        >
          <Icon className={`w-3 h-3 ${currentMode.color}`} />
          <span>{isZh ? currentMode.labelZh : currentMode.labelEn}</span>
          <ChevronDown className={`w-2.5 h-2.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {isOpen && (
        <div className="absolute bottom-full left-0 mb-2 w-52 bg-surface border border-border rounded-xl shadow-2xl z-50 py-1 animate-scale-in">
          {MODES.map((m) => {
            const ModeIcon = m.icon
            const isSelected = mode === m.id
            return (
              <button
                key={m.id}
                onClick={() => {
                  onModeChange(m.id)
                  setIsOpen(false)
                }}
                className={`
                  w-full flex items-center gap-3 px-3 py-2.5 text-left
                  transition-colors
                  ${isSelected
                    ? 'bg-accent/10'
                    : 'hover:bg-surface-hover'
                  }
                `}
              >
                <ModeIcon className={`w-4 h-4 ${m.color}`} />
                <div className="flex-1 min-w-0">
                  <div className={`text-xs font-medium ${isSelected ? 'text-accent' : 'text-text-primary'}`}>
                    {isZh ? m.labelZh : m.labelEn}
                  </div>
                  <div className="text-[11px] text-text-muted truncate opacity-80">
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
