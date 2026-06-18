/**
 * PipelineLogViewer - 流水线日志查看器
 *
 * 展示流水线运行的聚合日志，支持按阶段筛选。
 */
import type React from 'react'
import { useState, useCallback } from 'react'
import { Terminal, Copy, Check, Trash2, Filter } from 'lucide-react'
import { useI18n } from '@renderer/i18n'
import type { BuildType } from '../../types'
import type { PipelineRun } from '../../services/PipelineService'
import { pipelineService } from '../../services/PipelineService'

interface PipelineLogViewerProps {
  run: PipelineRun
  onClear?: () => void
}

const PipelineLogViewer: React.FC<PipelineLogViewerProps> = ({
  run,
  onClear,
}) => {
  const { t } = useI18n()
  const [filter, setFilter] = useState<BuildType | 'all'>('all')
  const [copied, setCopied] = useState(false)

  const filteredStages = filter === 'all'
    ? run.stages
    : run.stages.filter(s => s.type === filter)

  const allLogs = filteredStages
    .filter(s => s.output)
    .map(s => `[${s.label}]${s.output}`)
    .join('\n')

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(allLogs).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [allLogs])

  const stageTypes = [...new Set(run.stages.map(s => s.type))]

  return (
    <div className="border-t border-border">
      {/* 工具栏 */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-muted/20">
        <div className="flex items-center gap-1.5">
          <Terminal className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-[10px] font-medium">{t('studio.pipeline.logs')}</span>
          <span className="text-[9px] text-muted-foreground font-mono">{run.id}</span>
        </div>

        <div className="flex items-center gap-1">
          {/* 阶段筛选 */}
          <div className="flex items-center gap-0.5">
            <Filter className="w-3 h-3 text-muted-foreground" />
            <select
              value={filter}
              onChange={e => setFilter(e.target.value as BuildType | 'all')}
              className="px-1.5 py-0.5 rounded border border-border bg-background text-[9px] focus:outline-none focus:border-primary"
            >
              <option value="all">{t('studio.pipeline.all')}</option>
              {stageTypes.map(type => {
                const label = pipelineService.getStageLabel(type)
                return (
                  <option key={type} value={type}>{label.label}</option>
                )
              })}
            </select>
          </div>

          <button
            onClick={handleCopy}
            className="p-1 rounded hover:bg-muted text-muted-foreground"
            title={t('studio.pipeline.copyLogs')}
          >
            {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
          </button>

          {onClear && (
            <button
              onClick={onClear}
              className="p-1 rounded hover:bg-muted text-muted-foreground"
              title={t('studio.pipeline.clearLogs')}
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* 日志内容 */}
      <div className="max-h-48 overflow-auto font-mono text-[10px] leading-relaxed bg-muted/5">
        {allLogs ? (
          <div className="px-3 py-2 whitespace-pre-wrap break-all">
            {filteredStages.map(stage => (
              stage.output ? (
                <div key={stage.id} className="mb-1">
                  <div className="text-muted-foreground/50 text-[9px] mb-0.5">
                    ── {stage.label} ({stage.status}) ──
                  </div>
                  <div className="text-foreground/80">{stage.output}</div>
                </div>
              ) : null
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-center py-4 text-muted-foreground/50">
            <p className="text-[10px]">{t('studio.pipeline.noOutput')}</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default PipelineLogViewer