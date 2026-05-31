import { memo } from 'react'
import type { WorkspaceAgent } from '@store'

type CatVariant = 'orange' | 'tuxedo' | 'calico' | 'gray' | 'black' | 'white'

const VARIANT_COLORS: Record<CatVariant, { body: string; accent: string; patch: string; nose: string; ear: string }> = {
  orange: { body: '#E8913A', accent: '#F5C97A', patch: '#D47B20', nose: '#E8A0A0', ear: '#F0B0B0' },
  tuxedo: { body: '#2A2A2A', accent: '#FAFAFA', patch: '#1A1A1A', nose: '#D08080', ear: '#C07070' },
  calico: { body: '#F5F0E8', accent: '#E8913A', patch: '#3A3A3A', nose: '#E8A0A0', ear: '#F0B0B0' },
  gray: { body: '#8A8A8A', accent: '#B0B0B0', patch: '#6A6A6A', nose: '#C09090', ear: '#B08080' },
  black: { body: '#1A1A1A', accent: '#333333', patch: '#0A0A0A', nose: '#A07070', ear: '#906060' },
  white: { body: '#F5F5F0', accent: '#FFFFFF', patch: '#E8E8E0', nose: '#E0A0A0', ear: '#F0B0B0' },
}

const ROLE_VARIANT: Record<string, CatVariant> = {
  pm: 'orange',
  architect: 'gray',
  frontend: 'calico',
  backend: 'tuxedo',
  designer: 'white',
  tester: 'black',
  devops: 'orange',
  analyst: 'calico',
  custom: 'orange',
}

function CatSVG({ variant, size = 48 }: { variant: CatVariant; size?: number }) {
  const c = VARIANT_COLORS[variant]

  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id={`cat-body-${variant}`} cx="50%" cy="40%" r="50%">
          <stop offset="0%" stopColor={c.accent} />
          <stop offset="100%" stopColor={c.body} />
        </radialGradient>
        <filter id={`cat-glow-${variant}`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="1" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>

      <g filter={`url(#cat-glow-${variant})`}>
        {/* Tail */}
        <path d="M34 38 Q40 32 38 26" stroke={c.body} strokeWidth="2.5" fill="none" strokeLinecap="round" />

        {/* Body */}
        <ellipse cx="24" cy="32" rx="10" ry="9" fill={`url(#cat-body-${variant})`} />

        {/* Belly */}
        <ellipse cx="24" cy="34" rx="6" ry="5" fill={c.accent} opacity="0.7" />

        {/* Patches for calico/tuxedo */}
        {(variant === 'calico' || variant === 'tuxedo') && (
          <>
            <ellipse cx="18" cy="30" rx="4" ry="3" fill={c.patch} opacity="0.8" />
            <ellipse cx="30" cy="34" rx="3" ry="2.5" fill={variant === 'calico' ? c.accent : c.accent} opacity="0.7" />
          </>
        )}

        {/* Front paws */}
        <ellipse cx="18" cy="40" rx="3" ry="2" fill={c.accent} />
        <ellipse cx="30" cy="40" rx="3" ry="2" fill={c.accent} />

        {/* Head */}
        <circle cx="24" cy="18" r="10" fill={`url(#cat-body-${variant})`} />

        {/* Left ear */}
        <polygon points="16,14 14,4 20,10" fill={c.body} />
        <polygon points="16.5,13 15,6 19,10.5" fill={c.ear} opacity="0.8" />

        {/* Right ear */}
        <polygon points="32,14 34,4 28,10" fill={c.body} />
        <polygon points="31.5,13 33,6 29,10.5" fill={c.ear} opacity="0.8" />

        {/* Eyes */}
        <ellipse cx="20" cy="17" rx="2.5" ry="3" fill="#2A2A3E" />
        <ellipse cx="28" cy="17" rx="2.5" ry="3" fill="#2A2A3E" />
        <ellipse cx="20" cy="17" rx="1.8" ry="2.2" fill="#7EC8E3" />
        <ellipse cx="28" cy="17" rx="1.8" ry="2.2" fill="#7EC8E3" />
        <ellipse cx="20" cy="17" rx="0.8" ry="1.5" fill="#111" />
        <ellipse cx="28" cy="17" rx="0.8" ry="1.5" fill="#111" />
        <circle cx="21" cy="16" r="0.5" fill="white" />
        <circle cx="29" cy="16" r="0.5" fill="white" />

        {/* Nose */}
        <ellipse cx="24" cy="20.5" rx="1.5" ry="1" fill={c.nose} />

        {/* Mouth */}
        <path d="M22 21.5 Q24 23 26 21.5" stroke="#5A3A3A" strokeWidth="0.6" fill="none" />

        {/* Whiskers */}
        <line x1="12" y1="19" x2="19" y2="20" stroke="#CCC" strokeWidth="0.4" opacity="0.6" />
        <line x1="12" y1="21" x2="19" y2="21" stroke="#CCC" strokeWidth="0.4" opacity="0.6" />
        <line x1="12" y1="23" x2="19" y2="22" stroke="#CCC" strokeWidth="0.4" opacity="0.6" />
        <line x1="36" y1="19" x2="29" y2="20" stroke="#CCC" strokeWidth="0.4" opacity="0.6" />
        <line x1="36" y1="21" x2="29" y2="21" stroke="#CCC" strokeWidth="0.4" opacity="0.6" />
        <line x1="36" y1="23" x2="29" y2="22" stroke="#CCC" strokeWidth="0.4" opacity="0.6" />
      </g>
    </svg>
  )
}

export const CatAvatar = memo(function CatAvatar({
  agent,
  role,
  size = 'md',
  showName = true,
  onClick,
}: {
  agent?: WorkspaceAgent
  role?: string
  size?: 'sm' | 'md' | 'lg'
  showName?: boolean
  onClick?: () => void
}) {
  const sizeMap = { sm: 32, md: 44, lg: 56 }
  const pxSize = sizeMap[size]
  const agentRole = role || agent?.role || 'custom'
  const agentStatus = agent?.status || 'waiting'
  const catVariant = ROLE_VARIANT[agentRole] || 'orange'
  const colors = VARIANT_COLORS[catVariant]

  return (
    <div
      className={`flex flex-col items-center gap-1 ${onClick ? 'cursor-pointer' : ''}`}
      onClick={onClick}
    >
      <div
        className={`
          rounded-2xl flex items-center justify-center
          ${agentStatus === 'working' ? 'ring-2 ring-blue-400/50 ring-offset-1 ring-offset-background' : ''}
          ${agentStatus === 'completed' ? 'ring-2 ring-emerald-400/40' : ''}
          ${agentStatus === 'failed' ? 'ring-2 ring-red-400/40' : ''}
          transition-all duration-300
        `}
        style={{
          width: pxSize + 8,
          height: pxSize + 8,
          background: `linear-gradient(135deg, ${colors.body}20, ${colors.accent}10)`,
        }}
      >
        <CatSVG variant={catVariant} size={pxSize} />
      </div>

      {showName && agent && (
        <div className="flex flex-col items-center">
          <span className="text-xs font-medium text-text-primary leading-tight text-center max-w-[100px]">
            {agent.name}
          </span>
          {agent.status === 'working' && (
            <span className="text-[9px] text-blue-400 animate-pulse">工作中...</span>
          )}
          {agent.status === 'completed' && (
            <span className="text-[9px] text-emerald-400">已完成</span>
          )}
          {agent.status === 'failed' && (
            <span className="text-[9px] text-red-400">失败</span>
          )}
        </div>
      )}
    </div>
  )
})

export type { CatVariant }
