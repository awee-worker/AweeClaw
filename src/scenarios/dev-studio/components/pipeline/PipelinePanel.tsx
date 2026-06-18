/**
 * PipelinePanel - 流水线主面板
 *
 * 集成 PipelineStageList、PipelineLogViewer 和 PipelineConfigEditor。
 */
import type React from 'react'
import { useState, useCallback, useEffect } from 'react'
import { Workflow, Play, Plus, Loader2, Settings } from 'lucide-react'
import { useI18n } from '@renderer/i18n'
import { pipelineService } from '../../services/PipelineService'
import type { PipelineConfig } from '../../types'
import type { PipelineRun } from '../../services/PipelineService'
import PipelineStageList from './PipelineStageList'
import PipelineLogViewer from './PipelineLogViewer'
import PipelineConfigEditor from './PipelineConfigEditor'

interface PipelinePanelProps {
  projectId?: string
  projectName?: string
}

const PipelinePanel: React.FC<PipelinePanelProps> = ({
  projectId,
  projectName,
}) => {
  const { t } = useI18n()
  const [configs, setConfigs] = useState<PipelineConfig[]>([])
  const [selectedConfig, setSelectedConfig] = useState<PipelineConfig | null>(null)
  const [activeRun, setActiveRun] = useState<PipelineRun | null>(null)
  const [showConfigEditor, setShowConfigEditor] = useState(false)
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadConfigs = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const result = await pipelineService.getProjectPipelineConfigs(projectId)
      setConfigs(result)
      if (result.length > 0 && !selectedConfig) {
        setSelectedConfig(result[0])
      }
    } catch (err) {
      setError(t('studio.pipeline.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [projectId, selectedConfig])

  useEffect(() => {
    loadConfigs()
  }, [loadConfigs])

  const handleRun = useCallback(async () => {
    if (!projectId || !selectedConfig) return
    setRunning(true)
    setError(null)
    try {
      const run = await pipelineService.createPipelineRun(projectId, selectedConfig.id)
      await pipelineService.startPipelineRun(run.id)
      setActiveRun(run)
    } catch (err) {
      setError(t('studio.pipeline.startFailed'))
    } finally {
      setRunning(false)
    }
  }, [projectId, selectedConfig])

  const handleConfigSaved = useCallback((config: PipelineConfig) => {
    setShowConfigEditor(false)
    setSelectedConfig(config)
    setConfigs(prev => {
      const idx = prev.findIndex(c => c.id === config.id)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = config
        return next
      }
      return [...prev, config]
    })
  }, [])

  if (!projectId) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2 p-4">
        <Workflow className="w-8 h-8 opacity-30" />
        <p className="text-xs">{t('studio.pipeline.selectProject')}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* 头部 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-1.5">
          <Workflow className="w-3.5 h-3.5 text-purple-400" />
          <span className="text-xs font-medium">{t('studio.pipeline.title')}</span>
          {projectName && (
            <span className="text-[10px] text-muted-foreground">{projectName}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              setSelectedConfig(null)
              setShowConfigEditor(true)
            }}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-muted/50 hover:bg-muted"
          >
            <Plus className="w-3 h-3" />
            {t('studio.pipeline.new')}
          </button>
          {selectedConfig && (
            <>
              <button
                onClick={() => setShowConfigEditor(true)}
                className="p-1 rounded hover:bg-muted text-muted-foreground"
                title={t('studio.pipeline.editConfig')}
              >
                <Settings className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleRun}
                disabled={running || activeRun?.status === 'running'}
                className="flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {running ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Play className="w-3 h-3" />
                )}
                {running ? t('studio.pipeline.starting') : t('studio.pipeline.run')}
              </button>
            </>
          )}
        </div>
      </div>

      {/* 配置选择器 */}
      {configs.length > 1 && (
        <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border bg-muted/10 overflow-x-auto">
          {configs.map(c => (
            <button
              key={c.id}
              onClick={() => setSelectedConfig(c)}
              className={`px-2 py-0.5 rounded text-[10px] whitespace-nowrap transition-colors ${
                selectedConfig?.id === c.id
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      {/* 内容区 */}
      <div className="flex-1 overflow-auto">
        {error && (
          <div className="px-3 py-1.5 text-[10px] text-red-500 bg-red-500/5 border-b border-red-500/10">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : showConfigEditor ? (
          <PipelineConfigEditor
            projectId={projectId}
            config={selectedConfig}
            onSave={handleConfigSaved}
            onCancel={() => setShowConfigEditor(false)}
          />
        ) : selectedConfig ? (
          <div className="flex flex-col h-full">
            {/* 阶段列表 */}
            <PipelineStageList
              config={selectedConfig}
              activeRun={activeRun}
              onStageClick={() => {}}
            />

            {/* 运行日志 */}
            {activeRun && (
              <PipelineLogViewer
                run={activeRun}
                onClear={() => setActiveRun(null)}
              />
            )}
          </div>
        ) : configs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-2">
            <Workflow className="w-8 h-8 opacity-30" />
            <p className="text-xs">{t('studio.pipeline.noConfigs')}</p>
            <button
              onClick={() => {
                setSelectedConfig(null)
                setShowConfigEditor(true)
              }}
              className="px-3 py-1 rounded text-[10px] bg-primary/10 text-primary hover:bg-primary/20"
            >
              {t('studio.pipeline.createPipeline')}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default PipelinePanel