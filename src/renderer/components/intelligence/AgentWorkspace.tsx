import { memo, useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  FolderOpen,
  FileText,
  Loader2,
  BrainCircuit,
  AlertCircle,
  CheckCircle2,
  XCircle,
  ExternalLink,
  FileCode,
  FileImage,
  FileType,
  Volume2,
  Clock,
  Wrench,
  ChevronRight,
  RotateCcw,
  LayoutList,
  Activity,
  Package,
  Building2,
} from 'lucide-react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { api } from '@renderer/adapters/electronBridge'
import { logger } from '@toolkit/LogEngine'
import { AgentAvatar } from './AgentAvatar'
import { CatAvatar } from './CatAvatar'
import { TeamOffice } from './TeamOffice'
import { TeamChatPanel } from './TeamChatPanel'
import type { WorkspaceAgent, AgentToolCall, AgentWorkspaceSession } from '@store'
import type { CollaborationPhase } from '@intelligence/multiAgent/TeamCollaborationProtocol'

function getFileIcon(fileName: string) {
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  if (['html', 'css', 'js', 'ts', 'jsx', 'tsx', 'vue', 'py', 'java', 'go', 'rs', 'rb', 'php', 'c', 'cpp', 'h'].includes(ext)) {
    return <FileCode className="w-3 h-3" />
  }
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'webp'].includes(ext)) {
    return <FileImage className="w-3 h-3" />
  }
  if (['json', 'yaml', 'yml', 'toml', 'xml', 'ini', 'env', 'conf'].includes(ext)) {
    return <FileType className="w-3 h-3" />
  }
  return <FileText className="w-3 h-3" />
}

const STATUS_LABEL: Record<WorkspaceAgent['status'], string> = {
  waiting: '等待中',
  working: '工作中',
  completed: '已完成',
  failed: '失败',
  moving: '移动中',
}

const SESSION_LABEL: Record<string, string> = {
  planning: 'AI 正在规划团队...',
  plan_review: '请审核协作计划',
  executing: '团队协作进行中',
  completed: '团队协作已完成',
  failed: '团队协作失败',
}

type WorkspaceTab = 'office' | 'overview' | 'activity' | 'output'

function ToolCallItem({ toolCall }: { toolCall: AgentToolCall }) {
  const [expanded, setExpanded] = useState(false)

  const statusIcon = toolCall.status === 'completed'
    ? <CheckCircle2 className="w-3 h-3 text-emerald-400" />
    : toolCall.status === 'failed'
      ? <XCircle className="w-3 h-3 text-red-400" />
      : <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />

  const argsPreview = useMemo(() => {
    try {
      const str = JSON.stringify(toolCall.arguments, null, 2)
      return str.length > 200 ? str.slice(0, 200) + '...' : str
    } catch {
      return '{}'
    }
  }, [toolCall.arguments])

  return (
    <div className="rounded-lg border border-border/30 bg-surface/30 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-2.5 py-2 hover:bg-surface/50 transition-colors"
      >
        {statusIcon}
        <Wrench className="w-3 h-3 text-text-muted" />
        <span className="text-xs font-medium text-text-primary flex-1 text-left truncate">
          {toolCall.name}
        </span>
        <ChevronRight className={`w-3 h-3 text-text-muted transition-transform ${expanded ? 'rotate-90' : ''}`} />
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="px-2.5 pb-2 space-y-1.5">
              <div>
                <span className="text-[9px] text-text-muted font-medium uppercase tracking-wider">参数</span>
                <pre className="text-[10px] text-text-secondary bg-background/50 rounded p-1.5 mt-0.5 overflow-x-auto max-h-24 overflow-y-auto">
                  {argsPreview}
                </pre>
              </div>
              {toolCall.result && (
                <div>
                  <span className="text-[9px] text-text-muted font-medium uppercase tracking-wider">结果</span>
                  <pre className="text-[10px] text-text-secondary bg-background/50 rounded p-1.5 mt-0.5 overflow-x-auto max-h-32 overflow-y-auto">
                    {toolCall.result.length > 500 ? toolCall.result.slice(0, 500) + '...' : toolCall.result}
                  </pre>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function AgentDetailPanel({ agent, projectPath, onOpenFile }: {
  agent: WorkspaceAgent
  projectPath?: string
  onOpenFile: (filePath: string) => void
}) {
  const duration = useMemo(() => {
    if (!agent.startedAt) return null
    const end = agent.completedAt || Date.now()
    const sec = Math.round((end - agent.startedAt) / 1000)
    if (sec < 60) return `${sec}s`
    return `${Math.floor(sec / 60)}m ${sec % 60}s`
  }, [agent.startedAt, agent.completedAt])

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="h-full flex flex-col"
    >
      <div className="px-4 py-3 border-b border-border/40">
        <div className="flex items-center gap-3">
          <AgentAvatar agent={agent} size="lg" showName={false} />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-text-primary">{agent.name}</h3>
            <p className={`text-xs mt-0.5 ${
              agent.status === 'working' ? 'text-blue-400' :
              agent.status === 'completed' ? 'text-emerald-400' :
              agent.status === 'failed' ? 'text-red-400' : 'text-text-muted'
            }`}>
              {STATUS_LABEL[agent.status]}
              {duration && <span className="ml-2 text-text-muted">{duration}</span>}
              {agent.retryCount > 0 && <span className="ml-2 text-amber-400">重试 {agent.retryCount} 次</span>}
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        <div>
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">任务描述</h4>
          <p className="text-xs text-text-secondary leading-relaxed">{agent.taskDescription}</p>
        </div>

        {agent.scope && (
          <div>
            <h4 className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">职责范围</h4>
            <p className="text-xs text-text-secondary leading-relaxed">{agent.scope}</p>
          </div>
        )}

        {agent.currentStep && agent.status === 'working' && (
          <div>
            <h4 className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">当前步骤</h4>
            <div className="flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />
              <p className="text-xs text-blue-400">{agent.currentStep}</p>
            </div>
          </div>
        )}

        {agent.errorMessage && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
            <div className="flex items-center gap-1.5 text-xs text-red-400 font-medium mb-1">
              <AlertCircle className="w-3 h-3" />
              错误信息
            </div>
            <p className="text-xs text-red-300/80">{agent.errorMessage}</p>
          </div>
        )}

        {agent.toolCalls.length > 0 && (
          <div>
            <h4 className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">
              工具调用 ({agent.toolCalls.length})
            </h4>
            <div className="space-y-1.5">
              {agent.toolCalls.map(tc => (
                <ToolCallItem key={tc.id} toolCall={tc} />
              ))}
            </div>
          </div>
        )}

        {agent.outputFiles.length > 0 && (
          <div>
            <h4 className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">产出文件</h4>
            <div className="space-y-1">
              {agent.outputFiles.map((file, i) => {
                const displayName = projectPath ? file.replace(projectPath + '/', '') : file
                return (
                  <div
                    key={i}
                    onClick={() => onOpenFile(file)}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-surface/60 hover:bg-accent/10 transition-colors cursor-pointer group"
                  >
                    <span className="text-text-muted group-hover:text-accent transition-colors">
                      {getFileIcon(displayName)}
                    </span>
                    <span className="text-xs text-text-secondary group-hover:text-accent transition-colors truncate flex-1">
                      {displayName}
                    </span>
                    <ExternalLink className="w-3 h-3 text-text-muted/0 group-hover:text-accent transition-colors" />
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  )
}

function AgentGridItem({
  agent,
  isSelected,
  onClick,
}: {
  agent: WorkspaceAgent
  isSelected: boolean
  onClick: () => void
}) {
  return (
    <motion.button
      layout
      onClick={onClick}
      className={`relative flex flex-col items-center gap-2 p-4 rounded-2xl border transition-all ${
        isSelected
          ? 'border-accent/40 bg-accent/5 shadow-lg shadow-accent/10'
          : 'border-border/30 bg-surface/40 hover:bg-surface/70 hover:border-border/50'
      }`}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
    >
      <CatAvatar agent={agent} size="lg" />

      {agent.status === 'working' && agent.currentStep && (
        <p className="text-[9px] text-blue-400 text-center max-w-[100px] truncate">{agent.currentStep}</p>
      )}

      {agent.status === 'working' && agent.progress > 0 && (
        <div className="w-full h-0.5 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full transition-all duration-500"
            style={{ width: `${agent.progress}%` }}
          />
        </div>
      )}

      <div className="flex items-center gap-1.5 text-[9px] text-text-muted">
        {agent.toolCalls.length > 0 && (
          <span className="flex items-center gap-0.5">
            <Wrench className="w-2.5 h-2.5" />
            {agent.toolCalls.length}
          </span>
        )}
        {agent.outputFiles.length > 0 && (
          <span className="flex items-center gap-0.5">
            <FileText className="w-2.5 h-2.5" />
            {agent.outputFiles.length} 文件
          </span>
        )}
      </div>
    </motion.button>
  )
}

function CompletionBanner({ session, onOpenFile }: {
  session: { status: string; projectPath?: string; agents: WorkspaceAgent[]; totalDuration?: number }
  onOpenFile: (filePath: string) => void
}) {
  if (session.status !== 'completed' && session.status !== 'failed') return null

  const completedCount = session.agents.filter(a => a.status === 'completed').length
  const failedCount = session.agents.filter(a => a.status === 'failed').length
  const isAllSuccess = failedCount === 0 && completedCount > 0
  const allFiles = session.agents.flatMap(a => a.outputFiles)
  const totalToolCalls = session.agents.reduce((sum, a) => sum + a.toolCalls.length, 0)

  const ROLE_PREFIXES = ['pm_', 'architect_', 'frontend_', 'backend_', 'designer_', 'tester_', 'devops_', 'analyst_', 'agent_']
  const deliverableFiles = allFiles.filter(f => {
    const name = f.split('/').pop() || ''
    return !(name.endsWith('.md') && ROLE_PREFIXES.some(p => name.startsWith(p)))
  })
  const roleRecordFiles = allFiles.filter(f => !deliverableFiles.includes(f))

  const fileStats = useMemo(() => {
    const extMap = new Map<string, number>()
    for (const file of deliverableFiles.length > 0 ? deliverableFiles : allFiles) {
      const ext = file.split('.').pop()?.toLowerCase() || 'other'
      extMap.set(ext, (extMap.get(ext) || 0) + 1)
    }
    return Array.from(extMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([ext, count]) => ({ ext, count }))
  }, [deliverableFiles, allFiles])

  const handleOpenProjectPath = useCallback(() => {
    if (session.projectPath) {
      api.file.showInFolder(session.projectPath)
    }
  }, [session.projectPath])

  const durationText = useMemo(() => {
    if (!session.totalDuration) return null
    const sec = Math.round(session.totalDuration / 1000)
    if (sec < 60) return `${sec}s`
    return `${Math.floor(sec / 60)}m ${sec % 60}s`
  }, [session.totalDuration])

  return (
    <motion.div
      initial={{ opacity: 0, y: -10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 25 }}
      className={`mx-5 mt-4 p-4 rounded-xl border ${
        isAllSuccess
          ? 'bg-emerald-500/8 border-emerald-500/20'
          : 'bg-amber-500/8 border-amber-500/20'
      }`}
    >
      <div className="flex items-start gap-3">
        {isAllSuccess ? (
          <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
        ) : (
          <XCircle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className={`text-sm font-semibold ${
              isAllSuccess ? 'text-emerald-400' : 'text-amber-400'
            }`}>
              {isAllSuccess ? '协作任务已全部完成' : `协作任务已完成（${completedCount} 成功，${failedCount} 失败）`}
            </h4>
            <Volume2 className="w-3.5 h-3.5 text-text-muted/50" />
          </div>

          <div className="flex items-center gap-3 mt-1.5 text-[10px] text-text-muted">
            <span className="flex items-center gap-1">
              <BrainCircuit className="w-3 h-3" />
              {completedCount + failedCount} 个智能体
            </span>
            <span className="flex items-center gap-1">
              <Wrench className="w-3 h-3" />
              {totalToolCalls} 次工具调用
            </span>
            {durationText && (
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {durationText}
              </span>
            )}
            {deliverableFiles.length > 0 && (
              <span className="flex items-center gap-1 text-accent">
                <Package className="w-3 h-3" />
                {deliverableFiles.length} 个结果文件
              </span>
            )}
          </div>

          {fileStats.length > 0 && (
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              {fileStats.map(({ ext, count }) => (
                <span key={ext} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface/60 text-[10px] text-text-muted">
                  <span className="font-medium text-text-secondary">.{ext}</span>
                  <span>{count}</span>
                </span>
              ))}
            </div>
          )}

          {deliverableFiles.length > 0 && (
            <div className="mt-2.5">
              <span className="text-[10px] text-text-muted font-medium">📦 项目结果文件：</span>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {deliverableFiles.slice(0, 12).map((file, i) => {
                  const displayName = session.projectPath ? file.replace(session.projectPath + '/', '') : file.split('/').pop() || file
                  return (
                    <button
                      key={i}
                      onClick={() => onOpenFile(file)}
                      className="flex items-center gap-1 px-2 py-1 rounded-md bg-accent/5 hover:bg-accent/15 text-xs text-accent transition-colors border border-accent/10"
                    >
                      {getFileIcon(displayName)}
                      {displayName}
                    </button>
                  )
                })}
                {deliverableFiles.length > 12 && (
                  <span className="text-[10px] text-text-muted px-2 py-1">
                    +{deliverableFiles.length - 12} 更多
                  </span>
                )}
              </div>
            </div>
          )}

          {roleRecordFiles.length > 0 && (
            <div className="mt-1.5">
              <span className="text-[10px] text-text-muted">📝 角色工作记录：{roleRecordFiles.map(f => f.split('/').pop()).join(', ')}</span>
            </div>
          )}

          {session.projectPath && (
            <button
              onClick={handleOpenProjectPath}
              className="flex items-center gap-1.5 mt-2 group cursor-pointer"
            >
              <FolderOpen className="w-3.5 h-3.5 text-text-muted group-hover:text-accent flex-shrink-0 transition-colors" />
              <span className="text-xs text-text-muted group-hover:text-accent transition-colors">打开项目文件夹：</span>
              <code className="text-xs text-accent bg-accent/5 group-hover:bg-accent/10 px-1.5 py-0.5 rounded break-all transition-colors">
                {session.projectPath}
              </code>
            </button>
          )}

          {session.projectPath && deliverableFiles.length > 0 && (
            <p className="text-[10px] text-text-muted/60 mt-1.5">
              💡 点击文件名可预览内容，点击上方路径可打开项目文件夹
            </p>
          )}
        </div>
      </div>
    </motion.div>
  )
}

function PlanReviewPanel({ session, onApprove, onReject }: {
  session: { plan?: AgentWorkspaceSession['plan']; summary: string; projectName?: string }
  onApprove: () => void
  onReject: () => void
}) {
  const plan = session.plan
  if (!plan) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-5 mt-4 p-4 rounded-xl border border-purple-500/20 bg-purple-500/5"
    >
      <div className="flex items-center gap-2 mb-3">
        <BrainCircuit className="w-4 h-4 text-purple-400" />
        <span className="text-sm font-semibold text-purple-400">协作计划已生成</span>
      </div>

      <p className="text-xs text-text-secondary mb-3">{session.summary}</p>

      <div className="space-y-2 mb-4">
        {plan.executionOrder.map((layer, layerIdx) => (
          <div key={layerIdx} className="flex items-center gap-2">
            <span className="text-[9px] text-text-muted font-mono w-8 shrink-0">L{layerIdx + 1}</span>
            <div className="flex items-center gap-1.5 flex-wrap">
              {layer.map((agentId) => {
                const agent = plan.agents.find(a => a.id === agentId)
                if (!agent) return null
                return (
                  <div
                    key={agentId}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-surface/60 border border-border/30"
                  >
                    <span className="text-sm">{agent.icon}</span>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-text-primary truncate">{agent.name}</p>
                      <p className="text-[9px] text-text-muted truncate max-w-[160px]">{agent.taskDescription}</p>
                    </div>
                  </div>
                )
              })}
            </div>
            {layerIdx < plan.executionOrder.length - 1 && (
              <ChevronRight className="w-4 h-4 text-text-muted/40 shrink-0" />
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onApprove}
          className="px-4 py-2 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 text-purple-400 text-xs font-medium transition-colors"
        >
          ✅ 确认执行
        </button>
        <button
          onClick={onReject}
          className="px-4 py-2 rounded-lg bg-surface/60 hover:bg-surface/80 text-text-muted text-xs font-medium transition-colors"
        >
          ❌ 取消
        </button>
      </div>
    </motion.div>
  )
}

function ActivityTab({ agents, selectedAgentId, onSelectAgent }: {
  agents: WorkspaceAgent[]
  selectedAgentId: string | null
  onSelectAgent: (id: string | null) => void
}) {
  const activeAgent = selectedAgentId ? agents.find(a => a.id === selectedAgentId) : null
  const allEvents = useMemo(() => {
    return agents
      .flatMap(a => a.progressEvents.map(e => ({ ...e, agentId: a.id, agentName: a.name, agentRole: a.role || 'custom' })))
      .sort((a, b) => a.timestamp - b.timestamp)
  }, [agents])

  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [allEvents.length])

  const EVENT_STYLE: Record<string, { color: string; bg: string; label: string; icon: typeof BrainCircuit }> = {
    thinking: { color: 'text-purple-400', bg: 'bg-purple-500/10', label: '思考', icon: BrainCircuit },
    tool_call: { color: 'text-blue-400', bg: 'bg-blue-500/10', label: '调用工具', icon: Wrench },
    tool_result: { color: 'text-cyan-400', bg: 'bg-cyan-500/10', label: '工具结果', icon: Wrench },
    text_output: { color: 'text-gray-400', bg: 'bg-gray-500/10', label: '输出', icon: FileText },
    error: { color: 'text-red-400', bg: 'bg-red-500/10', label: '错误', icon: AlertCircle },
  }

  return (
    <div className="flex h-full">
      <div className="flex-1 flex flex-col min-w-0">
        <div className="px-4 py-2 border-b border-border/30 flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
            实时活动流
          </span>
          <span className="text-[10px] text-text-muted">{allEvents.length} 条记录</span>
        </div>
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
          {allEvents.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-text-muted text-xs">
              暂无活动记录
            </div>
          ) : (
            <div className="relative">
              <div className="absolute left-[15px] top-2 bottom-2 w-px bg-border/30" />
              <div className="space-y-1">
                {allEvents.map((event, i) => {
                  const style = EVENT_STYLE[event.type] || EVENT_STYLE.text_output
                  const EventIcon = style.icon
                  const time = new Date(event.timestamp).toLocaleTimeString('zh-CN', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })

                  return (
                    <div
                      key={i}
                      className={`relative flex items-start gap-3 pl-1 py-1.5 rounded-lg transition-colors cursor-pointer group ${
                        selectedAgentId === event.agentId ? 'bg-accent/5' : 'hover:bg-surface/30'
                      }`}
                      onClick={() => onSelectAgent(event.agentId === selectedAgentId ? null : event.agentId)}
                    >
                      <div className={`relative z-10 w-[30px] h-[30px] rounded-full ${style.bg} flex items-center justify-center shrink-0`}>
                        <EventIcon className={`w-3 h-3 ${style.color}`} />
                      </div>

                      <div className="flex-1 min-w-0 pt-0.5">
                        <div className="flex items-center gap-2">
                          <CatAvatar role={event.agentRole} size="sm" showName={false} />
                          <span className="text-[11px] font-medium text-text-primary truncate">{event.agentName}</span>
                          <span className={`text-[10px] font-medium ${style.color}`}>{style.label}</span>
                          {event.toolName && (
                            <span className="text-[10px] text-text-muted bg-surface/60 px-1.5 py-0.5 rounded truncate max-w-[120px]">
                              {event.toolName}
                            </span>
                          )}
                          <span className="text-[9px] text-text-muted/50 ml-auto shrink-0">{time}</span>
                        </div>
                        <p className="text-[10px] text-text-muted leading-relaxed mt-0.5 line-clamp-2">
                          {event.content}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {activeAgent && (
        <div className="w-56 flex-shrink-0 border-l border-border/40 bg-surface/20 overflow-y-auto">
          <div className="px-3 py-2 border-b border-border/30">
            <div className="flex items-center gap-2">
              <CatAvatar agent={activeAgent} size="sm" showName={false} />
              <span className="text-xs font-medium text-text-primary">{activeAgent.name}</span>
            </div>
          </div>
          <div className="p-3 space-y-2">
            {activeAgent.toolCalls.length > 0 && (
              <div>
                <span className="text-[9px] text-text-muted font-medium uppercase tracking-wider">
                  工具调用 ({activeAgent.toolCalls.length})
                </span>
                <div className="mt-1 space-y-1">
                  {activeAgent.toolCalls.slice(-5).map(tc => (
                    <ToolCallItem key={tc.id} toolCall={tc} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function OutputTab({ agents, projectPath, onOpenFile }: {
  agents: WorkspaceAgent[]
  projectPath?: string
  onOpenFile: (filePath: string) => void
}) {
  const allOutputFiles = agents.flatMap(a => a.outputFiles)

  const { deliverableFiles, roleRecordFiles } = useMemo(() => {
    const ROLE_PREFIXES = ['pm_', 'architect_', 'frontend_', 'backend_', 'designer_', 'tester_', 'devops_', 'analyst_', 'agent_']
    const deliverable: string[] = []
    const roleRecord: string[] = []
    for (const file of allOutputFiles) {
      const name = file.split('/').pop() || ''
      const isRoleRecord = name.endsWith('.md') && ROLE_PREFIXES.some(p => name.startsWith(p))
      if (isRoleRecord) {
        roleRecord.push(file)
      } else {
        deliverable.push(file)
      }
    }
    return { deliverableFiles: deliverable, roleRecordFiles: roleRecord }
  }, [allOutputFiles])

  if (allOutputFiles.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted text-xs">
        暂无产出文件
      </div>
    )
  }

  return (
    <div className="overflow-y-auto p-4 space-y-4">
      {deliverableFiles.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Package className="w-3.5 h-3.5 text-accent" />
            <h3 className="text-xs font-semibold text-text-primary">项目结果文件</h3>
            <span className="text-[10px] text-text-muted">{deliverableFiles.length} 个</span>
          </div>
          <div className="space-y-1">
            {deliverableFiles.map((file, i) => {
              const displayName = projectPath ? file.replace(projectPath + '/', '') : file.split('/').pop() || file
              return (
                <div
                  key={`d-${i}`}
                  onClick={() => onOpenFile(file)}
                  className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-surface/40 hover:bg-accent/10 transition-colors cursor-pointer group"
                >
                  {getFileIcon(displayName)}
                  <span className="text-xs text-text-secondary group-hover:text-accent transition-colors truncate flex-1">
                    {displayName}
                  </span>
                  <ExternalLink className="w-3 h-3 text-text-muted/0 group-hover:text-accent transition-colors" />
                </div>
              )
            })}
          </div>
        </div>
      )}

      {roleRecordFiles.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <FileText className="w-3.5 h-3.5 text-text-muted" />
            <h3 className="text-xs font-semibold text-text-muted">角色工作记录</h3>
            <span className="text-[10px] text-text-muted">{roleRecordFiles.length} 个</span>
          </div>
          <div className="space-y-1">
            {roleRecordFiles.map((file, i) => {
              const displayName = projectPath ? file.replace(projectPath + '/', '') : file.split('/').pop() || file
              return (
                <div
                  key={`r-${i}`}
                  onClick={() => onOpenFile(file)}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-surface/20 hover:bg-surface/40 transition-colors cursor-pointer group"
                >
                  {getFileIcon(displayName)}
                  <span className="text-xs text-text-muted group-hover:text-text-secondary transition-colors truncate flex-1">
                    {displayName}
                  </span>
                  <ExternalLink className="w-3 h-3 text-text-muted/0 group-hover:text-text-muted transition-colors" />
                </div>
              )
            })}
          </div>
        </div>
      )}

      {deliverableFiles.length === 0 && roleRecordFiles.length > 0 && (
        <div className="p-3 rounded-lg bg-amber-500/8 border border-amber-500/15">
          <p className="text-[10px] text-amber-400/80">
            当前仅有角色工作记录文件。项目结果文件将由各 Agent 使用工具（如 write_file）创建，请确保 Agent 配置中启用了文件写入工具。
          </p>
        </div>
      )}
    </div>
  )
}

export const AgentWorkspace = memo(function AgentWorkspace() {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('office')
  const { session, language, openFile, setActiveFile } = useStore(useShallow(s => ({
    session: s.activeWorkspaceSession,
    language: s.language,
    openFile: s.openFile,
    setActiveFile: s.setActiveFile,
  })))

  const selectedAgent = useMemo(() => {
    if (!session || !selectedAgentId) return null
    return session.agents.find(a => a.id === selectedAgentId) || null
  }, [session, selectedAgentId])

  const handleOpenFile = useCallback(async (filePath: string) => {
    try {
      const content = await api.file.read(filePath)
      if (content != null) {
        openFile(filePath, content)
        setActiveFile(filePath)
      }
    } catch (err) {
      logger.agent.warn('[AgentWorkspace] Failed to open file:', err)
    }
  }, [openFile, setActiveFile])

  if (!session) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <BrainCircuit className="w-12 h-12 text-text-muted/30 mx-auto mb-3" />
          <p className="text-sm text-text-muted">
            {language === 'zh' ? '暂无进行中的智能体协作' : 'No active agent collaboration'}
          </p>
        </div>
      </div>
    )
  }

  const completedCount = session.agents.filter(a => a.status === 'completed').length
  const failedCount = session.agents.filter(a => a.status === 'failed').length
  const totalCount = session.agents.length
  const progressPct = totalCount > 0 ? ((completedCount + failedCount) / totalCount) * 100 : 0

  const TAB_CONFIG: Array<{ id: WorkspaceTab; icon: typeof LayoutList; label: string }> = [
    { id: 'office', icon: Building2, label: '办公室' },
    { id: 'overview', icon: LayoutList, label: '概览' },
    { id: 'activity', icon: Activity, label: '活动' },
    { id: 'output', icon: Package, label: '产出' },
  ]

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 px-5 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BrainCircuit className={`w-4 h-4 ${
              session.status === 'executing' ? 'text-blue-400' :
              session.status === 'completed' ? 'text-emerald-400' :
              session.status === 'failed' ? 'text-red-400' :
              session.status === 'plan_review' ? 'text-purple-400' : 'text-purple-400'
            }`} />
            <span className="text-sm font-semibold text-text-primary">
              {language === 'zh' ? '智能体工作台' : 'Agent Workspace'}
            </span>
          </div>

          <div className="flex items-center gap-3">
            {session.projectPath && (
              <div className="flex items-center gap-1.5 text-[10px] text-text-muted" title={session.projectPath}>
                <FolderOpen className="w-3 h-3 flex-shrink-0" />
                <span className="break-all">{session.projectPath.split('/').pop()}</span>
              </div>
            )}
            <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
              session.status === 'executing' ? 'bg-blue-500/10 text-blue-400' :
              session.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400' :
              session.status === 'failed' ? 'bg-red-500/10 text-red-400' :
              session.status === 'plan_review' ? 'bg-purple-500/10 text-purple-400' : 'bg-purple-500/10 text-purple-400'
            }`}>
              {SESSION_LABEL[session.status]}
            </span>
          </div>
        </div>

        {/* Progress bar */}
        {totalCount > 0 && session.status === 'executing' && (
          <div className="mt-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] text-text-muted">
                {completedCount}/{totalCount} 完成
                {failedCount > 0 && <span className="text-red-400 ml-1">· {failedCount} 失败</span>}
              </span>
              <span className="text-[10px] text-text-muted">{Math.round(progressPct)}%</span>
            </div>
            <div className="h-1 bg-gray-800 rounded-full overflow-hidden">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-blue-500 via-purple-500 to-emerald-500"
                initial={{ width: '0%' }}
                animate={{ width: `${progressPct}%` }}
                transition={{ duration: 0.6, ease: 'easeOut' }}
              />
            </div>
          </div>
        )}

        {session.summary && session.status !== 'plan_review' && (
          <p className="mt-2 text-xs text-text-muted leading-relaxed">{session.summary}</p>
        )}
      </div>

      {/* Plan Review */}
      {session.status === 'plan_review' && (
        <PlanReviewPanel
          session={session}
          onApprove={() => {
            useStore.getState().updateWorkspaceSession({ status: 'executing' })
          }}
          onReject={() => {
            useStore.getState().clearWorkspaceSession()
          }}
        />
      )}

      {/* Tab Bar */}
      {session.status !== 'planning' && session.status !== 'plan_review' && (
        <div className="flex items-center gap-1 px-5 border-b border-border/30">
          {TAB_CONFIG.map(tab => {
            const Icon = tab.icon
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors border-b-2 ${
                  isActive
                    ? 'text-accent border-accent'
                    : 'text-text-muted border-transparent hover:text-text-secondary'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
                {tab.id === 'activity' && session.agents.some(a => a.status === 'working') && (
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                )}
                {tab.id === 'output' && (
                  <span className="text-[9px] text-text-muted">
                    {session.agents.reduce((s, a) => s + a.outputFiles.length, 0)}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}

      {/* Tab Content */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {session.status === 'planning' ? (
          <div className="flex-1 flex items-center justify-center">
            <motion.div
              className="flex flex-col items-center gap-3"
              animate={{ opacity: [0.5, 1, 0.5] }}
              transition={{ duration: 2, repeat: Infinity }}
            >
              <Loader2 className="w-8 h-8 text-purple-400 animate-spin" />
              <p className="text-sm text-text-muted">AI 正在分析任务，规划最佳团队...</p>
            </motion.div>
          </div>
        ) : session.status === 'plan_review' ? (
          <div className="flex-1" />
        ) : activeTab === 'office' ? (
          <div className="flex-1 flex min-h-0">
            <div className="flex-1 min-w-0 flex flex-col">
              <div className="flex-[3] min-h-0 p-3 pb-1.5">
                <TeamOffice
                  agents={session.agents}
                  onAgentClick={(agent) => setSelectedAgentId(selectedAgentId === agent.id ? null : agent.id)}
                  handoffFrom={session.agents.find(a => a.isMoving)?.id}
                  handoffTo={session.agents.find(a => a.isMoving)?.moveTarget}
                  collaborationPhase={(session.collaborationPhase || 'meeting') as CollaborationPhase}
                />
              </div>
              <div className="flex-[2] min-h-0 border-t border-border/40">
                <TeamChatPanel
                  messages={session.teamChat || []}
                  currentPhase={(session.collaborationPhase || 'meeting') as CollaborationPhase}
                />
              </div>
            </div>

            <AnimatePresence>
              {selectedAgent && (
                <div className="w-64 flex-shrink-0 border-l border-border/40 bg-surface/20 overflow-y-auto">
                  <AgentDetailPanel
                    agent={selectedAgent}
                    projectPath={session.projectPath}
                    onOpenFile={handleOpenFile}
                  />
                </div>
              )}
            </AnimatePresence>
          </div>
        ) : activeTab === 'overview' ? (
          <>
            <div className="flex-1 overflow-y-auto px-5 pb-5">
              <div className="grid grid-cols-3 gap-3 mt-4">
                {session.agents.map((agent) => (
                  <AgentGridItem
                    key={agent.id}
                    agent={agent}
                    isSelected={selectedAgentId === agent.id}
                    onClick={() => setSelectedAgentId(selectedAgentId === agent.id ? null : agent.id)}
                  />
                ))}
              </div>

              {session.agents.length > 0 && (
                <div className="mt-5">
                  <h3 className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-2">
                    {language === 'zh' ? '活动时间线' : 'Activity Timeline'}
                  </h3>
                  <div className="space-y-1.5">
                    {session.agents
                      .filter(a => a.startedAt)
                      .sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0))
                      .map((agent) => (
                        <div key={agent.id} className="flex items-center gap-3 px-3 py-1.5 rounded-lg bg-surface/30">
                          <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                            agent.status === 'working' ? 'bg-blue-400' :
                            agent.status === 'completed' ? 'bg-emerald-400' :
                            agent.status === 'failed' ? 'bg-red-400' : 'bg-gray-500'
                          }`} />
                          <span className="text-xs text-text-secondary flex-1">
                            <span className="font-medium text-text-primary">{agent.name}</span>
                            {' — '}
                            {agent.status === 'working' ? agent.currentStep || '正在工作' :
                             agent.status === 'completed' ? '已完成' :
                             agent.status === 'failed' ? '执行失败' : '等待中'}
                          </span>
                          {agent.startedAt && (
                            <span className="text-[10px] text-text-muted">
                              {new Date(agent.startedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </span>
                          )}
                          {agent.retryCount > 0 && (
                            <span className="text-[9px] text-amber-400 flex items-center gap-0.5">
                              <RotateCcw className="w-2.5 h-2.5" />
                              {agent.retryCount}
                            </span>
                          )}
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>

            <AnimatePresence>
              {selectedAgent && (
                <div className="w-72 flex-shrink-0 border-l border-border/40 bg-surface/20 overflow-y-auto">
                  <AgentDetailPanel
                    agent={selectedAgent}
                    projectPath={session.projectPath}
                    onOpenFile={handleOpenFile}
                  />
                </div>
              )}
            </AnimatePresence>
          </>
        ) : activeTab === 'activity' ? (
          <ActivityTab
            agents={session.agents}
            selectedAgentId={selectedAgentId}
            onSelectAgent={setSelectedAgentId}
          />
        ) : (
          <OutputTab
            agents={session.agents}
            projectPath={session.projectPath}
            onOpenFile={handleOpenFile}
          />
        )}
      </div>

      {/* Completion Banner */}
      <CompletionBanner session={session} onOpenFile={handleOpenFile} />
    </div>
  )
})
