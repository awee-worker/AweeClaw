/**
 * PipelineStageList - 流水线阶段列表
 *
 * 可视化展示流水线各阶段：Lint → Build → Test → Deploy → Preview
 */
import type React from 'react'
import { useState } from 'react'
import {
  CheckCircle2, XCircle, Loader2, Circle, Clock, ChevronDown, ChevronUp,
  Code2, Package, FlaskConical, Cloud, Monitor,
} from 'lucide-react'
import { useI18n } from '@renderer/i18n'
import type { PipelineConfig, BuildType, BuildStatus, PipelineStageConfig } from '../../types'
import type { PipelineRun, PipelineRunStage } from '../../services/PipelineService'

interface PipelineStageListProps {
  config: PipelineConfig
  activeRun?: PipelineRun | null
  onStageClick?: (stageType: BuildType) => void
}

const STAGE_ICONS: Record<BuildType, React.ComponentType<{ className?: string }>> = {
  lint: Code2,
  build: Package,
  test: FlaskConical,
  deploy: Cloud,
  preview: Monitor,
}

const STAGE_COLORS: Record<BuildType, string> = {
  lint: 'border-l-amber-400',
  build: 'border-l-blue-400',
  test: 'border-l-emerald-400',
  deploy: 'border-l-sky-400',
  preview: 'border-l-purple-400',
}

const STATUS_ICONS: Record<BuildStatus, React.ComponentType<{ className?: string }>> = {
  pending: Circle,
  running: Loader2,
  success: CheckCircle2,
  failed: XCircle,
  cancelled: XCircle,
}

const STATUS_COLORS: Record<BuildStatus, string> = {
  pending: 'text-muted-foreground',
  running: 'text-blue-500',
  success: 'text-emerald-500',
  failed: 'text-red-500',
  cancelled: 'text-orange-500',
}

const PipelineStageList: React.FC<PipelineStageListProps> = ({
  config,
  activeRun,
  onStageClick,
}) => {
  const { t } = useI18n()
  const [expandedStage, setExpandedStage] = useState<BuildType | null>(null)

  const getStageState = (stage: PipelineStageConfig): PipelineRunStage | undefined => {
    return activeRun?.stages.find(s => s.type === stage.type)
  }

  const getProgress = (): number => {
    const enabled = config.stages.filter(s => s.enabled)
    if (enabled.length === 0) return 0
    const completed = enabled.filter(s => {
      const state = getStageState(s)
      return state?.status === 'success' || state?.status === 'failed'
    })
    return Math.round((completed.length / enabled.length) * 100)
  }

  const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
    return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
  }

  const progress = getProgress()
  const enabledStages = config.stages.filter(s => s.enabled)

  return (
    <div className="flex flex-col">
      {/* 进度条 */}
      <div className="px-3 py-2 border-b border-border">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-medium">{config.name}</span>
            <span className="text-[9px] text-muted-foreground">
              {t(`studio.pipeline.trigger.${config.trigger}`)}
            </span>
          </div>
          <span className="text-[10px] text-muted-foreground">{progress}%</span>
        </div>
        <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* 阶段列表 */}
      <div className="p-2 space-y-1">
        {enabledStages.length === 0 ? (
          <p className="text-[10px] text-muted-foreground text-center py-4">
            {t('studio.pipeline.noStagesEnabled')}
          </p>
        ) : (
          enabledStages.map((stage, i) => {
            const state = getStageState(stage)
            const status = state?.status ?? 'pending'
            const StatusIcon = STATUS_ICONS[status]
            const Icon = STAGE_ICONS[stage.type] ?? Circle
            const isExpanded = expandedStage === stage.type
            const isLast = i === enabledStages.length - 1

            return (
              <div key={stage.id}>
                {/* 阶段行 */}
                <button
                  onClick={() => {
                    if (state?.output) {
                      setExpandedStage(isExpanded ? null : stage.type)
                    }
                    onStageClick?.(stage.type)
                  }}
                  className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-md border bg-card hover:border-primary/30 transition-colors text-left border-l-2 ${STAGE_COLORS[stage.type] ?? 'border-l-slate-300'}`}
                >
                  {/* 状态图标 */}
                  <div className={`flex-shrink-0 ${STATUS_COLORS[status]}`}>
                    <StatusIcon className={`w-4 h-4 ${status === 'running' ? 'animate-spin' : ''}`} />
                  </div>

                  {/* 阶段图标 */}
                  <div className="flex-shrink-0 w-6 h-6 rounded bg-muted/30 flex items-center justify-center">
                    <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                  </div>

                  {/* 阶段信息 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-medium">{stage.label}</span>
                      <span className="text-[9px] text-muted-foreground capitalize">{t(`studio.pipeline.status.${status}`)}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[9px] text-muted-foreground font-mono truncate">
                        {stage.command}
                      </span>
                      {state?.durationMs ? (
                        <span className="flex items-center gap-0.5 text-[9px] text-muted-foreground flex-shrink-0">
                          <Clock className="w-2.5 h-2.5" />
                          {formatDuration(state.durationMs)}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  {/* 展开按钮 */}
                  {state?.output && (
                    <div className="flex-shrink-0">
                      {isExpanded ? (
                        <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                      )}
                    </div>
                  )}
                </button>

                {/* 展开日志 */}
                {isExpanded && state?.output && (
                  <div className="mx-2 mb-1 px-3 py-2 rounded bg-muted/20 text-[10px] font-mono text-muted-foreground whitespace-pre-wrap max-h-32 overflow-auto">
                    {state.output}
                  </div>
                )}

                {/* 连接线 */}
                {!isLast && (
                  <div className="flex justify-center py-0.5">
                    <div className="w-px h-3 bg-border" />
                  </div>
                )}
              </div>
            )
          })
        )}

        {/* 禁用阶段 */}
        {config.stages.filter(s => !s.enabled).length > 0 && (
          <div className="mt-3 pt-2 border-t border-border/50">
            <span className="text-[9px] text-muted-foreground/50 px-2">{t('studio.pipeline.disabledStages')}</span>
            {config.stages.filter(s => !s.enabled).map(disabled => {
              const Icon = STAGE_ICONS[disabled.type] ?? Circle
              return (
                <div
                  key={disabled.id}
                  className="flex items-center gap-2 px-2.5 py-1.5 opacity-40"
                >
                  <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-[10px] text-muted-foreground">{disabled.label}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export default PipelineStageList