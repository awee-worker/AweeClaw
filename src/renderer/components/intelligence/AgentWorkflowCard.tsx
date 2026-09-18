import { memo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  BrainCircuit,
  ChevronDown,
  Wrench,
  FileText,
  AlertCircle,
  RotateCcw,
  FolderOpen,
} from 'lucide-react'
import type { MultiAgentWorkflowPart, AgentWorkflowNode } from '@intelligence/types/conversationModel'

const STATUS_CONFIG: Record<AgentWorkflowNode['status'], { icon: typeof CheckCircle2; colorClass: string; bgClass: string; label: string }> = {
  waiting: { icon: Clock, colorClass: 'text-gray-400', bgClass: 'bg-gray-500/10 border-gray-500/20', label: '等待中' },
  working: { icon: Loader2, colorClass: 'text-blue-400', bgClass: 'bg-blue-500/10 border-blue-500/20', label: '工作中' },
  completed: { icon: CheckCircle2, colorClass: 'text-emerald-400', bgClass: 'bg-emerald-500/10 border-emerald-500/20', label: '已完成' },
  failed: { icon: XCircle, colorClass: 'text-red-400', bgClass: 'bg-red-500/10 border-red-500/20', label: '失败' },
}

const SESSION_STATUS_LABEL: Record<MultiAgentWorkflowPart['status'], string> = {
  planning: '正在规划团队...',
  plan_review: '请审核协作计划',
  executing: '团队协作中',
  completed: '协作完成',
  failed: '协作失败',
}

function AgentChip({ agent, expanded, onToggle }: { agent: AgentWorkflowNode; expanded: boolean; onToggle: () => void }) {
  const config = STATUS_CONFIG[agent.status]
  const StatusIcon = config.icon
  const hasDetails = (agent.toolCallCount ?? 0) > 0 || (agent.outputFileCount ?? 0) > 0 || agent.errorMessage

  return (
    <div className="min-w-0">
      <motion.button
        layout
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.2 }}
        onClick={hasDetails ? onToggle : undefined}
        className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${config.bgClass} min-w-0 w-full text-left transition-colors ${
          hasDetails ? 'hover:brightness-110 cursor-pointer' : 'cursor-default'
        }`}
      >
        <span className="text-base shrink-0">{agent.icon}</span>
        <div className="flex flex-col min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-text-primary truncate">{agent.name}</span>
            {agent.retryCount != null && agent.retryCount > 0 && (
              <span className="flex items-center gap-0.5 text-[9px] text-amber-400 shrink-0">
                <RotateCcw className="w-2 h-2" />
                {agent.retryCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {agent.currentStep && agent.status === 'working' ? (
              <span className="text-[10px] text-blue-400 truncate">{agent.currentStep}</span>
            ) : (
              <span className="text-[10px] text-text-muted truncate">{agent.description}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {(agent.toolCallCount ?? 0) > 0 && (
            <span className="flex items-center gap-0.5 text-[9px] text-text-muted">
              <Wrench className="w-2.5 h-2.5" />
              {agent.toolCallCount}
            </span>
          )}
          {(agent.outputFileCount ?? 0) > 0 && (
            <span className="flex items-center gap-0.5 text-[9px] text-text-muted">
              <FileText className="w-2.5 h-2.5" />
              {agent.outputFileCount}
            </span>
          )}
          <StatusIcon
            className={`w-3.5 h-3.5 ${config.colorClass} ${agent.status === 'working' ? 'animate-spin' : ''}`}
          />
          {hasDetails && (
            <ChevronDown className={`w-3 h-3 text-text-muted transition-transform ${expanded ? 'rotate-180' : ''}`} />
          )}
        </div>
      </motion.button>

      <AnimatePresence>
        {expanded && hasDetails && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="px-3 py-2 ml-6 space-y-1.5 border-l-2 border-border/30">
              {agent.errorMessage && (
                <div className="flex items-start gap-1.5 text-[10px] text-red-400">
                  <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
                  <span>{agent.errorMessage}</span>
                </div>
              )}
              {(agent.toolCallCount ?? 0) > 0 && (
                <div className="flex items-center gap-1.5 text-[10px] text-text-muted">
                  <Wrench className="w-3 h-3 shrink-0 text-blue-400" />
                  <span>调用了 {agent.toolCallCount} 个工具</span>
                </div>
              )}
              {(agent.outputFileCount ?? 0) > 0 && (
                <div className="flex items-center gap-1.5 text-[10px] text-text-muted">
                  <FileText className="w-3 h-3 shrink-0 text-emerald-400" />
                  <span>生成了 {agent.outputFileCount} 个文件</span>
                </div>
              )}
              {agent.progress != null && agent.progress > 0 && agent.status === 'working' && (
                <div className="w-full h-1 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="meter-fill h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full transition-[width] duration-500"
                    style={{ width: `${agent.progress}%` }}
                  />
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function ConnectorArrow({ active }: { active: boolean }) {
  return (
    <div className="flex items-center justify-center px-1 shrink-0">
      <svg width="20" height="12" viewBox="0 0 20 12">
        <path
          d="M0 6 L14 6 M10 2 L14 6 L10 10"
          fill="none"
          stroke={active ? '#3b82f6' : '#4b5563'}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={active ? 0.8 : 0.4}
        />
      </svg>
    </div>
  )
}

function PlanReviewSection({ part }: { part: MultiAgentWorkflowPart }) {
  if (part.status !== 'plan_review' || !part.executionOrder) return null

  return (
    <div className="mt-2 p-2.5 rounded-lg border border-purple-500/20 bg-purple-500/5">
      <div className="flex items-center gap-1.5 text-[10px] text-purple-400 font-medium mb-2">
        <BrainCircuit className="w-3 h-3" />
        协作计划
      </div>
      <div className="space-y-1.5">
        {part.executionOrder.map((layer, layerIdx) => (
          <div key={layerIdx} className="flex items-center gap-1.5">
            <span className="text-[8px] text-text-muted font-mono w-5 shrink-0">L{layerIdx + 1}</span>
            <div className="flex items-center gap-1 flex-wrap">
              {layer.map((agentId) => {
                const agent = part.agents.find(a => a.id === agentId)
                if (!agent) return null
                return (
                  <span key={agentId} className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface/60 text-[10px] text-text-secondary">
                    <span className="text-xs">{agent.icon}</span>
                    {agent.name}
                  </span>
                )
              })}
            </div>
            {layerIdx < (part.executionOrder?.length ?? 0) - 1 && (
              <span className="text-text-muted/40">→</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export const AgentWorkflowCard = memo(function AgentWorkflowCard({ part }: { part: MultiAgentWorkflowPart }) {
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set())
  const { agents, status, summary, currentAgentId, projectName } = part
  const isPlanning = status === 'planning'
  const isPlanReview = status === 'plan_review'
  const isExecuting = status === 'executing'
  const isCompleted = status === 'completed'
  const isFailed = status === 'failed'

  const completedCount = agents.filter(a => a.status === 'completed').length
  const failedCount = agents.filter(a => a.status === 'failed').length
  const totalCount = agents.length
  const totalToolCalls = agents.reduce((sum, a) => sum + (a.toolCallCount ?? 0), 0)
  const totalOutputFiles = agents.reduce((sum, a) => sum + (a.outputFileCount ?? 0), 0)

  const toggleAgent = (agentId: string) => {
    setExpandedAgents(prev => {
      const next = new Set(prev)
      if (next.has(agentId)) next.delete(agentId)
      else next.add(agentId)
      return next
    })
  }

  return (
    <div className="my-2 rounded-xl border border-border/50 bg-surface overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border/30 flex items-center gap-2">
        <BrainCircuit className={`w-4 h-4 ${
          isExecuting ? 'text-blue-400' :
          isCompleted ? 'text-emerald-400' :
          isFailed ? 'text-red-400' :
          isPlanReview ? 'text-purple-400' : 'text-purple-400'
        }`} />
        <span className="text-xs font-medium text-text-primary">
          {SESSION_STATUS_LABEL[status]}
        </span>
        {projectName && (
          <span className="text-[10px] text-text-muted flex items-center gap-1">
            <FolderOpen className="w-3 h-3" />
            {projectName}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {totalToolCalls > 0 && (
            <span className="flex items-center gap-0.5 text-[9px] text-text-muted">
              <Wrench className="w-2.5 h-2.5" />
              {totalToolCalls}
            </span>
          )}
          {totalOutputFiles > 0 && (
            <span className="flex items-center gap-0.5 text-[9px] text-text-muted">
              <FileText className="w-2.5 h-2.5" />
              {totalOutputFiles}
            </span>
          )}
          {totalCount > 0 && (
            <span className="text-[10px] text-text-muted">
              {completedCount}/{totalCount}
              {failedCount > 0 && <span className="text-red-400"> · {failedCount} 失败</span>}
            </span>
          )}
          {isExecuting && (
            <div className="flex gap-0.5 ml-1">
              {[0, 1, 2].map(i => (
                <motion.div
                  key={i}
                  className="w-1 h-1 rounded-full bg-blue-400"
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="px-4 py-3">
        {isPlanning && (
          <motion.div
            className="flex items-center gap-2 text-xs text-text-muted"
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-400" />
            <span>AI 正在分析任务，规划最佳团队...</span>
          </motion.div>
        )}

        {isPlanReview && (
          <PlanReviewSection part={part} />
        )}

        {agents.length > 0 && !isPlanning && (
          <div className="flex items-center gap-1 flex-wrap">
            {agents.map((agent, i) => (
              <div key={agent.id} className="flex items-center gap-1">
                {i > 0 && (
                  <ConnectorArrow active={agent.status !== 'waiting' || agents[i - 1]?.status === 'completed'} />
                )}
                <AgentChip
                  agent={agent}
                  expanded={expandedAgents.has(agent.id)}
                  onToggle={() => toggleAgent(agent.id)}
                />
              </div>
            ))}
          </div>
        )}

        {currentAgentId && isExecuting && (
          <div className="mt-2 flex items-center gap-1.5 text-[10px] text-blue-400">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>
              {agents.find(a => a.id === currentAgentId)?.name || 'Agent'} 正在工作...
            </span>
          </div>
        )}

        {isCompleted && summary && (
          <div className="mt-2 text-[10px] text-text-muted border-t border-border/20 pt-2">
            {summary}
          </div>
        )}

        {isFailed && (
          <div className="mt-2 text-[10px] text-red-400 flex items-center gap-1.5">
            <AlertCircle className="w-3 h-3" />
            部分智能体执行失败，请查看下方结果
          </div>
        )}
      </div>

      {totalCount > 1 && (
        <div className="h-0.5 bg-gray-800">
          <motion.div
            className="h-full bg-gradient-to-r from-blue-500 to-purple-500"
            initial={{ width: '0%' }}
            animate={{ width: totalCount > 0 ? `${((completedCount + failedCount) / totalCount) * 100}%` : '0%' }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          />
        </div>
      )}
    </div>
  )
})
