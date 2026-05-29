import { memo } from 'react'
import type { WorkspaceAgent } from '@store'

const ROLE_COLORS: Record<string, { body: string; shell: string; accent: string }> = {
  pm: { body: '#E85D3A', shell: '#C94422', accent: '#FFD700' },
  architect: { body: '#4A90D9', shell: '#3570B0', accent: '#7EC8E3' },
  frontend: { body: '#9B59B6', shell: '#7D3C98', accent: '#E8DAEF' },
  backend: { body: '#27AE60', shell: '#1E8449', accent: '#82E0AA' },
  designer: { body: '#E91E8C', shell: '#C2185B', accent: '#F8BBD0' },
  tester: { body: '#F39C12', shell: '#D68910', accent: '#FDEBD0' },
  devops: { body: '#1ABC9C', shell: '#16A085', accent: '#A3E4D7' },
  analyst: { body: '#3498DB', shell: '#2E86C1', accent: '#AED6F1' },
  custom: { body: '#E67E22', shell: '#CA6F1E', accent: '#FAD7A0' },
}

const ROLE_ACCESSORY: Record<string, string> = {
  pm: 'crown',
  architect: 'blueprint',
  frontend: 'palette',
  backend: 'gear',
  designer: 'pen',
  tester: 'bug',
  devops: 'cloud',
  analyst: 'chart',
  custom: 'star',
}

function LobsterSVG({ role, size = 48 }: { role: string; size?: number }) {
  const colors = ROLE_COLORS[role] || ROLE_COLORS.custom
  const accessory = ROLE_ACCESSORY[role] || 'star'

  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id={`body-${role}`} cx="50%" cy="40%" r="50%">
          <stop offset="0%" stopColor={colors.body} />
          <stop offset="100%" stopColor={colors.shell} />
        </radialGradient>
        <filter id={`glow-${role}`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="1" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>

      <g filter={`url(#glow-${role})`}>
        {/* Left claw */}
        <ellipse cx="10" cy="30" rx="6" ry="4" fill={colors.shell} transform="rotate(-20 10 30)" />
        <ellipse cx="8" cy="28" rx="3" ry="2" fill={colors.accent} opacity="0.6" transform="rotate(-20 8 28)" />

        {/* Right claw */}
        <ellipse cx="38" cy="30" rx="6" ry="4" fill={colors.shell} transform="rotate(20 38 30)" />
        <ellipse cx="40" cy="28" rx="3" ry="2" fill={colors.accent} opacity="0.6" transform="rotate(20 40 28)" />

        {/* Body */}
        <ellipse cx="24" cy="28" rx="10" ry="12" fill={`url(#body-${role})`} />

        {/* Tail segments */}
        <ellipse cx="24" cy="40" rx="6" ry="3" fill={colors.shell} opacity="0.8" />
        <ellipse cx="24" cy="43" rx="4" ry="2" fill={colors.shell} opacity="0.6" />

        {/* Head */}
        <circle cx="24" cy="18" r="9" fill={`url(#body-${role})`} />

        {/* Eyes */}
        <circle cx="20" cy="16" r="2.5" fill="white" />
        <circle cx="28" cy="16" r="2.5" fill="white" />
        <circle cx="20.5" cy="15.5" r="1.2" fill="#1a1a2e" />
        <circle cx="28.5" cy="15.5" r="1.2" fill="#1a1a2e" />
        <circle cx="21" cy="15" r="0.4" fill="white" />
        <circle cx="29" cy="15" r="0.4" fill="white" />

        {/* Antennae */}
        <path d="M20 12 Q16 6 12 4" stroke={colors.accent} strokeWidth="1" fill="none" strokeLinecap="round" />
        <path d="M28 12 Q32 6 36 4" stroke={colors.accent} strokeWidth="1" fill="none" strokeLinecap="round" />
        <circle cx="12" cy="4" r="1" fill={colors.accent} />
        <circle cx="36" cy="4" r="1" fill={colors.accent} />

        {/* Mouth */}
        <path d="M21 22 Q24 24 27 22" stroke={colors.shell} strokeWidth="0.8" fill="none" />

        {/* Accessory based on role */}
        {accessory === 'crown' && (
          <g transform="translate(24, 8)">
            <polygon points="0,-4 2,0 -2,0" fill={colors.accent} />
            <polygon points="-4,-2 -2,0 -6,0" fill={colors.accent} />
            <polygon points="4,-2 2,0 6,0" fill={colors.accent} />
            <rect x="-5" y="0" width="10" height="2" rx="0.5" fill={colors.accent} />
          </g>
        )}
        {accessory === 'blueprint' && (
          <g transform="translate(24, 7)">
            <rect x="-4" y="-3" width="8" height="6" rx="0.5" fill={colors.accent} opacity="0.8" />
            <line x1="-2" y1="-1" x2="2" y2="-1" stroke={colors.shell} strokeWidth="0.5" />
            <line x1="-2" y1="0.5" x2="2" y2="0.5" stroke={colors.shell} strokeWidth="0.5" />
          </g>
        )}
        {accessory === 'palette' && (
          <g transform="translate(24, 7)">
            <circle cx="0" cy="0" r="3" fill={colors.accent} opacity="0.8" />
            <circle cx="-1" cy="-1" r="0.6" fill="#FF6B6B" />
            <circle cx="1" cy="-1" r="0.6" fill="#4ECDC4" />
            <circle cx="0" cy="1" r="0.6" fill="#FFE66D" />
          </g>
        )}
        {accessory === 'gear' && (
          <g transform="translate(24, 7)">
            <circle cx="0" cy="0" r="3" fill={colors.accent} opacity="0.8" />
            <circle cx="0" cy="0" r="1.5" fill={colors.shell} />
            <circle cx="0" cy="0" r="0.8" fill={colors.accent} />
          </g>
        )}
        {accessory === 'pen' && (
          <g transform="translate(24, 7)">
            <rect x="-1" y="-4" width="2" height="7" rx="0.5" fill={colors.accent} />
            <polygon points="0,4 -1,3 1,3" fill={colors.shell} />
          </g>
        )}
        {accessory === 'bug' && (
          <g transform="translate(24, 7)">
            <circle cx="0" cy="0" r="2.5" fill={colors.accent} opacity="0.8" />
            <line x1="-1.5" y1="-1" x2="-3" y2="-2.5" stroke={colors.accent} strokeWidth="0.6" />
            <line x1="1.5" y1="-1" x2="3" y2="-2.5" stroke={colors.accent} strokeWidth="0.6" />
          </g>
        )}
        {accessory === 'cloud' && (
          <g transform="translate(24, 6)">
            <circle cx="0" cy="0" r="2.5" fill={colors.accent} opacity="0.7" />
            <circle cx="-2" cy="0.5" r="2" fill={colors.accent} opacity="0.7" />
            <circle cx="2" cy="0.5" r="2" fill={colors.accent} opacity="0.7" />
          </g>
        )}
        {accessory === 'chart' && (
          <g transform="translate(24, 7)">
            <rect x="-3" y="-3" width="6" height="6" rx="0.5" fill={colors.accent} opacity="0.8" />
            <rect x="-2" y="1" width="1.2" height="2" fill={colors.shell} />
            <rect x="-0.2" y="-1" width="1.2" height="4" fill={colors.shell} />
            <rect x="1.6" y="-2" width="1.2" height="5" fill={colors.shell} />
          </g>
        )}
        {accessory === 'star' && (
          <g transform="translate(24, 7)">
            <polygon
              points="0,-3.5 0.8,-1.2 3.3,-1.2 1.3,0.4 2,2.8 0,1.4 -2,2.8 -1.3,0.4 -3.3,-1.2 -0.8,-1.2"
              fill={colors.accent}
            />
          </g>
        )}
      </g>
    </svg>
  )
}

export const LobsterAvatar = memo(function LobsterAvatar({
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
          background: `linear-gradient(135deg, ${ROLE_COLORS[agentRole]?.body || '#E67E22'}20, ${ROLE_COLORS[agentRole]?.shell || '#CA6F1E'}10)`,
        }}
      >
        <LobsterSVG role={agentRole} size={pxSize} />
      </div>

      {showName && agent && (
        <div className="flex flex-col items-center">
          <span className={`text-xs font-medium text-text-primary leading-tight text-center max-w-[100px]`}>
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
