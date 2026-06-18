/**
 * AgentPipelineProgress - 流水线进度可视化
 *
 * 展示开发流水线各阶段进度：Lint → Build → Test → Deploy → Preview
 */
import type React from 'react'
import { Workflow, CheckCircle2, XCircle, Loader2, Circle, Play, Clock } from 'lucide-react'
import { useI18n } from '@renderer/i18n'
import type { AgentSessionState } from '../../services/AgentSessionService'
import type { BuildType, BuildStatus } from '../../types'

interface PipelineStage {
  id: BuildType
  label: string
  status: BuildStatus
  durationMs?: number
  error?: string
}

interface AgentPipelineProgressProps {
  session?: AgentSessionState | null
  /** 外部传入的流水线阶段 */
  stages?: PipelineStage[]
  onTrigger?: (stage: BuildType) => void
}

const DEFAULT_STAGES: PipelineStage[] = [
  { id: 'lint', label: 'Lint', status: 'pending' },
  { id: 'build', label: 'Build', status: 'pending' },
  { id: 'test', label: 'Test', status: 'pending' },
  { id: 'deploy', label: 'Deploy', status: 'pending' },
  { id: 'preview', label: 'Preview', status: 'pending' },
]

const STATUS_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  pending: Circle,
  running: Loader2,
  success: CheckCircle2,
  failed: XCircle,
  cancelled: XCircle,
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'text-muted-foreground/40',
  running: 'text-blue-500',
  success: 'text-emerald-500',
  failed: 'text-red-500',
  cancelled: 'text-orange-500',
}

const AgentPipelineProgress: React.FC<AgentPipelineProgressProps> = ({
  session: _session,
  stages = DEFAULT_STAGES,
  onTrigger,
}) => {
  const { t } = useI18n()
  const completedCount = stages.filter(s => s.status === 'success').length
  const progress = stages.length > 0 ? Math.round((completedCount / stages.length) * 100) : 0

  const formatDuration = (ms?: number): string => {
    if (!ms) return '--'
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(1)}s`
  }

  return (
    <div className="flex flex-col h-full">
      {/* 头部进度 */}
      <div className="px-3 py-2 border-b border-border">
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-1.5">
            <Workflow className="w-3.5 h-3.5 text-purple-400" />
            <span className="text-xs font-medium">{t('studio.agent.pipeline')}</span>
          </div>
          <span className="text-[10px] text-muted-foreground">{progress}%</span>
        </div>
        {/* 进度条 */}
        <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* 阶段列表 */}
      <div className="flex-1 overflow-auto p-2">
        <div className="relative">
          {/* 连接线 */}
          <div className="absolute left-[11px] top-2 bottom-2 w-px bg-border" />

          <div className="space-y-0.5">
            {stages.map((stage) => {
              const Icon = STATUS_ICONS[stage.status] ?? Circle
              const color = STATUS_COLORS[stage.status]
              const isRunning = stage.status === 'running'

              return (
                <div key={stage.id} className="flex items-start gap-2 py-1.5 pl-1">
                  {/* 图标 */}
                  <div className={`relative z-10 flex-shrink-0 ${color}`}>
                    <Icon className={`w-4 h-4 ${isRunning ? 'animate-spin' : ''}`} />
                  </div>

                  {/* 内容 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium">{t(`studio.pipeline.stage.${stage.id}`)}</span>
                      <div className="flex items-center gap-1.5">
                        {stage.durationMs !== undefined && (
                          <span className="flex items-center gap-0.5 text-[9px] text-muted-foreground">
                            <Clock className="w-2.5 h-2.5" />
                            {formatDuration(stage.durationMs)}
                          </span>
                        )}
                        {stage.status === 'pending' && onTrigger && (
                          <button
                            onClick={() => onTrigger(stage.id)}
                            className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                            title={t('studio.agent.runStage', { stage: t(`studio.pipeline.stage.${stage.id}`) })}
                          >
                            <Play className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                    {stage.status === 'running' && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">{t('studio.agent.running')}</p>
                    )}
                    {stage.error && (
                      <p className="text-[10px] text-red-500 mt-0.5">{stage.error}</p>
                    )}
                    {stage.status === 'success' && (
                      <p className="text-[10px] text-emerald-500 mt-0.5">{t('studio.agent.completed')}</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

export default AgentPipelineProgress