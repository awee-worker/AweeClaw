import { memo } from 'react'
import { motion } from 'framer-motion'
import { CheckCircle2, XCircle, Loader2, Clock, ArrowRight } from 'lucide-react'
import type { WorkspaceAgent } from '@store'

const AGENT_COLORS: Record<string, string> = {
  '📋': 'from-blue-500 to-cyan-400',
  '🏗️': 'from-orange-500 to-amber-400',
  '🎨': 'from-pink-500 to-rose-400',
  '💻': 'from-green-500 to-emerald-400',
  '⚙️': 'from-violet-500 to-purple-400',
  '🗄️': 'from-teal-500 to-cyan-400',
  '🧪': 'from-yellow-500 to-orange-400',
  '🔍': 'from-indigo-500 to-blue-400',
  '📝': 'from-sky-500 to-blue-400',
  '🚀': 'from-red-500 to-orange-400',
  '🛡️': 'from-emerald-500 to-green-400',
  '📊': 'from-purple-500 to-violet-400',
}

const STATUS_RING: Record<WorkspaceAgent['status'], string> = {
  waiting: 'ring-gray-500/30',
  working: 'ring-blue-400/60',
  completed: 'ring-emerald-400/50',
  failed: 'ring-red-400/50',
  moving: 'ring-amber-400/50',
}

function StatusBadge({ status }: { status: WorkspaceAgent['status'] }) {
  switch (status) {
    case 'working':
      return (
        <motion.div
          className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-blue-500 border-2 border-background flex items-center justify-center"
          animate={{ scale: [1, 1.15, 1] }}
          transition={{ duration: 1.5, repeat: Infinity }}
        >
          <Loader2 className="w-2.5 h-2.5 text-white animate-spin" />
        </motion.div>
      )
    case 'completed':
      return (
        <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-emerald-500 border-2 border-background flex items-center justify-center">
          <CheckCircle2 className="w-2.5 h-2.5 text-white" />
        </div>
      )
    case 'failed':
      return (
        <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-red-500 border-2 border-background flex items-center justify-center">
          <XCircle className="w-2.5 h-2.5 text-white" />
        </div>
      )
    case 'moving':
      return (
        <motion.div
          className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-amber-500 border-2 border-background flex items-center justify-center"
          animate={{ x: [0, 2, 0, -2, 0] }}
          transition={{ duration: 0.8, repeat: Infinity }}
        >
          <ArrowRight className="w-2.5 h-2.5 text-white" />
        </motion.div>
      )
    default:
      return (
        <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-gray-500 border-2 border-background flex items-center justify-center">
          <Clock className="w-2.5 h-2.5 text-white" />
        </div>
      )
  }
}

export const AgentAvatar = memo(function AgentAvatar({
  agent,
  size = 'md',
  showName = true,
  onClick,
}: {
  agent: WorkspaceAgent
  size?: 'sm' | 'md' | 'lg'
  showName?: boolean
  onClick?: () => void
}) {
  const sizeMap = { sm: 'w-8 h-8 text-sm', md: 'w-11 h-11 text-lg', lg: 'w-14 h-14 text-xl' }
  const nameSizeMap = { sm: 'text-[10px]', md: 'text-xs', lg: 'text-sm' }
  const gradient = AGENT_COLORS[agent.icon] || 'from-gray-500 to-gray-400'

  return (
    <div
      className={`flex flex-col items-center gap-1 ${onClick ? 'cursor-pointer' : ''}`}
      onClick={onClick}
    >
      <div className={`relative ${sizeMap[size]} rounded-full ring-2 ${STATUS_RING[agent.status]} ${agent.status === 'working' ? 'ring-offset-2 ring-offset-background' : ''}`}>
        <div className={`w-full h-full rounded-full bg-gradient-to-br ${gradient} flex items-center justify-center shadow-lg`}>
          <span className="select-none drop-shadow-sm">{agent.icon}</span>
        </div>

        {agent.status === 'working' && (
          <motion.div
            className="absolute inset-0 rounded-full bg-blue-400/20"
            animate={{ opacity: [0, 0.5, 0] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          />
        )}

        <StatusBadge status={agent.status} />
      </div>

      {showName && (
        <div className="flex flex-col items-center">
          <span className={`${nameSizeMap[size]} font-medium text-text-primary leading-tight text-center max-w-[100px]`}>
            {agent.name}
          </span>
          {agent.status === 'working' && (
            <motion.span
              className="text-[9px] text-blue-400"
              animate={{ opacity: [0.5, 1, 0.5] }}
              transition={{ duration: 1.5, repeat: Infinity }}
            >
              工作中...
            </motion.span>
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
