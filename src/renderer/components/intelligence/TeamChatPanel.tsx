import { memo, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  MessageSquare,
  Vote,
  ArrowRightLeft,
  Megaphone,
  HelpCircle,
  Send,
} from 'lucide-react'
import type { TeamChatMessage } from '@store'
import type { CollaborationPhase } from '@intelligence/multiAgent/TeamCollaborationProtocol'
import { PHASE_LABEL_MAP } from '@intelligence/multiAgent/TeamCollaborationProtocol'

const MESSAGE_TYPE_CONFIG: Record<TeamChatMessage['type'], {
  icon: typeof MessageSquare
  color: string
  bgColor: string
  label: string
}> = {
  discuss: { icon: MessageSquare, color: 'text-blue-400', bgColor: 'bg-blue-500/10', label: '讨论' },
  delegate: { icon: ArrowRightLeft, color: 'text-purple-400', bgColor: 'bg-purple-500/10', label: '分配' },
  handoff: { icon: ArrowRightLeft, color: 'text-amber-400', bgColor: 'bg-amber-500/10', label: '交接' },
  vote: { icon: Vote, color: 'text-emerald-400', bgColor: 'bg-emerald-500/10', label: '投票' },
  announce: { icon: Megaphone, color: 'text-orange-400', bgColor: 'bg-orange-500/10', label: '公告' },
  question: { icon: HelpCircle, color: 'text-cyan-400', bgColor: 'bg-cyan-500/10', label: '提问' },
}

function ChatBubble({ message }: { message: TeamChatMessage }) {
  const config = MESSAGE_TYPE_CONFIG[message.type] || MESSAGE_TYPE_CONFIG.announce
  const Icon = config.icon
  const isSystem = message.fromAgentId === 'system'

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={`flex gap-2 ${isSystem ? 'justify-center' : ''}`}
    >
      {isSystem ? (
        <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] ${config.bgColor} ${config.color} font-medium`}>
          <Icon className="w-3 h-3" />
          {message.content}
        </div>
      ) : (
        <>
          <div className={`w-6 h-6 rounded-full ${config.bgColor} flex items-center justify-center shrink-0 mt-0.5`}>
            <span className="text-[10px]">🐱</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-[11px] font-semibold text-text-primary">{message.fromAgentName}</span>
              <span className={`text-[9px] px-1.5 py-0.5 rounded ${config.bgColor} ${config.color}`}>
                {config.label}
              </span>
              {message.toAgentId && (
                <span className="text-[9px] text-text-muted">
                  → {message.toAgentId}
                </span>
              )}
              <span className="text-[9px] text-text-muted/50 ml-auto">
                {new Date(message.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            </div>
            <p className="text-[11px] text-text-secondary leading-relaxed">{message.content}</p>
            {message.attachments && message.attachments.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {message.attachments.map((file, i) => (
                  <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-surface/60 text-text-muted border border-border/30">
                    📎 {file.split('/').pop()}
                  </span>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </motion.div>
  )
}

function PhaseIndicator({ currentPhase }: { currentPhase: CollaborationPhase }) {
  const phases: CollaborationPhase[] = ['meeting', 'discussion', 'voting', 'delegation', 'execution', 'handoff', 'review', 'completed']
  const currentIdx = phases.indexOf(currentPhase)

  return (
    <div className="flex items-center gap-0.5 px-3 py-2">
      {phases.map((phase, idx) => (
        <div key={phase} className="flex items-center">
          <div
            className={`w-2 h-2 rounded-full transition-all duration-300 ${
              idx < currentIdx ? 'bg-emerald-400' :
              idx === currentIdx ? 'bg-blue-400 scale-125 shadow-[0_0_6px_rgba(96,165,250,0.5)]' :
              'bg-gray-600'
            }`}
            title={PHASE_LABEL_MAP[phase]}
          />
          {idx < phases.length - 1 && (
            <div className={`w-3 h-0.5 ${idx < currentIdx ? 'bg-emerald-400' : 'bg-gray-700'}`} />
          )}
        </div>
      ))}
      <span className="text-[9px] text-text-muted ml-2">{PHASE_LABEL_MAP[currentPhase]}</span>
    </div>
  )
}

export const TeamChatPanel = memo(function TeamChatPanel({
  messages,
  currentPhase,
  className = '',
}: {
  messages: TeamChatMessage[]
  currentPhase: CollaborationPhase
  className?: string
}) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages.length])

  return (
    <div className={`flex flex-col h-full ${className}`}>
      <PhaseIndicator currentPhase={currentPhase} />

      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/30">
        <Send className="w-3.5 h-3.5 text-accent" />
        <span className="text-xs font-semibold text-text-primary">团队频道</span>
        <span className="text-[9px] text-text-muted ml-auto">{messages.length} 条消息</span>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-text-muted text-xs">
            等待团队会议开始...
          </div>
        ) : (
          <AnimatePresence>
            {messages.map((msg) => (
              <ChatBubble key={msg.id} message={msg} />
            ))}
          </AnimatePresence>
        )}
      </div>
    </div>
  )
})
