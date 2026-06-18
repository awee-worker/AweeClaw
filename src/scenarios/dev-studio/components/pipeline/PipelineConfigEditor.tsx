/**
 * PipelineConfigEditor - 流水线配置编辑器
 *
 * 编辑流水线阶段配置：启用/禁用、命令、超时、触发方式。
 */
import type React from 'react'
import { useState, useCallback } from 'react'
import {
  Save, X, Plus, Trash2, ChevronUp, ChevronDown, GripVertical,
  Clock, Terminal, Play, Timer,
} from 'lucide-react'
import { useI18n } from '@renderer/i18n'
import type { PipelineConfig, PipelineStageConfig, BuildType } from '../../types'
import { pipelineService } from '../../services/PipelineService'
import type { PipelineConfigInput } from '../../services/PipelineService'

interface PipelineConfigEditorProps {
  projectId: string
  config: PipelineConfig | null
  onSave: (config: PipelineConfig) => void
  onCancel: () => void
}

const STAGE_TYPES: BuildType[] = ['lint', 'build', 'test', 'deploy', 'preview']

const PipelineConfigEditor: React.FC<PipelineConfigEditorProps> = ({
  projectId,
  config,
  onSave,
  onCancel,
}) => {
  const { t } = useI18n()
  const [name, setName] = useState(config?.name ?? 'Default Pipeline')
  const [stages, setStages] = useState<PipelineStageConfig[]>(
    config?.stages ?? pipelineService.getDefaultStages(),
  )
  const [trigger, setTrigger] = useState<'manual' | 'push' | 'schedule'>(config?.trigger ?? 'manual')
  const [schedule, setSchedule] = useState(config?.schedule ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSave = useCallback(async () => {
    if (!name.trim()) {
      setError(t('studio.pipeline.nameRequired'))
      return
    }

    setSaving(true)
    setError(null)
    try {
      const input: PipelineConfigInput = {
        name: name.trim(),
        stages,
        trigger,
        schedule: trigger === 'schedule' ? schedule : undefined,
      }

      let result: PipelineConfig
      if (config?.id) {
        await pipelineService.updatePipelineConfig(config.id, input)
        result = { ...config, ...input, stages, schedule: schedule ?? '', updatedAt: new Date().toISOString() }
      } else {
        result = await pipelineService.createPipelineConfig(projectId, input)
      }

      onSave(result)
    } catch (err) {
      setError(t('studio.pipeline.saveFailed'))
    } finally {
      setSaving(false)
    }
  }, [name, stages, trigger, schedule, config, projectId, onSave])

  const updateStage = useCallback((index: number, updates: Partial<PipelineStageConfig>) => {
    setStages(prev => {
      const next = [...prev]
      next[index] = { ...next[index], ...updates }
      return next
    })
  }, [])

  const moveStage = useCallback((index: number, direction: 'up' | 'down') => {
    setStages(prev => {
      const next = [...prev]
      const target = direction === 'up' ? index - 1 : index + 1
      if (target < 0 || target >= next.length) return prev
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }, [])

  const addStage = useCallback(() => {
    const newStage: PipelineStageConfig = {
      id: `stage-${Date.now()}`,
      type: 'build',
      label: t('studio.pipeline.newStage'),
      labelZh: t('studio.pipeline.newStage'),
      command: 'echo "new stage"',
      enabled: true,
      timeout: 120000,
    }
    setStages(prev => [...prev, newStage])
  }, [])

  const removeStage = useCallback((index: number) => {
    setStages(prev => prev.filter((_, i) => i !== index))
  }, [])

  return (
    <div className="flex flex-col h-full">
      {/* 头部 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium">
            {config ? t('studio.pipeline.editTitle') : t('studio.pipeline.newTitle')}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onCancel}
            className="p-1 rounded hover:bg-muted text-muted-foreground"
          >
            <X className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <Save className="w-3 h-3" />
            {saving ? t('studio.pipeline.saving') : t('studio.pipeline.save')}
          </button>
        </div>
      </div>

      {/* 表单 */}
      <div className="flex-1 overflow-auto p-3 space-y-3">
        {/* 名称 */}
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-muted-foreground">{t('studio.pipeline.pipelineName')}</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder={t('studio.pipeline.namePlaceholder')}
            className="w-full px-2 py-1.5 rounded border border-border bg-background text-xs focus:outline-none focus:border-primary"
          />
        </div>

        {/* 触发方式 */}
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-muted-foreground">{t('studio.pipeline.trigger')}</label>
          <div className="flex gap-1">
            {(['manual', 'push', 'schedule'] as const).map(triggerType => (
              <button
                key={triggerType}
                onClick={() => setTrigger(triggerType)}
                className={`px-2.5 py-1 rounded text-[10px] capitalize transition-colors ${
                  trigger === triggerType
                    ? 'bg-primary/10 text-primary border border-primary/30'
                    : 'bg-muted/30 text-muted-foreground border border-transparent hover:bg-muted/50'
                }`}
              >
                {triggerType === 'manual' && <Play className="w-3 h-3 inline mr-1" />}
                {triggerType === 'push' && <Terminal className="w-3 h-3 inline mr-1" />}
                {triggerType === 'schedule' && <Clock className="w-3 h-3 inline mr-1" />}
                {t(`studio.pipeline.trigger.${triggerType}`)}
              </button>
            ))}
          </div>
          {trigger === 'schedule' && (
            <input
              type="text"
              value={schedule}
              onChange={e => setSchedule(e.target.value)}
              placeholder="0 0 * * * (cron expression)"
              className="w-full px-2 py-1 mt-1 rounded border border-border bg-background text-[10px] font-mono focus:outline-none focus:border-primary"
            />
          )}
        </div>

        {/* 阶段列表 */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label className="text-[10px] font-medium text-muted-foreground">{t('studio.pipeline.stages')}</label>
            <button
              onClick={addStage}
              className="flex items-center gap-0.5 text-[10px] text-primary hover:underline"
            >
              <Plus className="w-3 h-3" />
              {t('studio.pipeline.addStage')}
            </button>
          </div>

          <div className="space-y-1">
            {stages.map((stage, i) => (
              <div
                key={stage.id}
                className="flex items-start gap-2 px-2.5 py-2 rounded-md border border-border bg-card"
              >
                {/* 排序 */}
                <div className="flex flex-col gap-0.5 pt-0.5">
                  <button
                    onClick={() => moveStage(i, 'up')}
                    disabled={i === 0}
                    className="p-0.5 rounded hover:bg-muted disabled:opacity-30"
                  >
                    <ChevronUp className="w-3 h-3 text-muted-foreground" />
                  </button>
                  <GripVertical className="w-3 h-3 text-muted-foreground/30" />
                  <button
                    onClick={() => moveStage(i, 'down')}
                    disabled={i === stages.length - 1}
                    className="p-0.5 rounded hover:bg-muted disabled:opacity-30"
                  >
                    <ChevronDown className="w-3 h-3 text-muted-foreground" />
                  </button>
                </div>

                {/* 启用开关 */}
                <label className="flex items-center gap-1 pt-1 flex-shrink-0">
                  <input
                    type="checkbox"
                    checked={stage.enabled}
                    onChange={e => updateStage(i, { enabled: e.target.checked })}
                    className="w-3 h-3 rounded"
                  />
                  <span className="text-[9px] text-muted-foreground">{i + 1}</span>
                </label>

                {/* 阶段配置 */}
                <div className="flex-1 space-y-1">
                  <div className="flex gap-1">
                    <select
                      value={stage.type}
                      onChange={e => updateStage(i, { type: e.target.value as BuildType })}
                      className="px-1.5 py-0.5 rounded border border-border bg-background text-[9px] focus:outline-none focus:border-primary"
                    >
                      {STAGE_TYPES.map(sType => (
                        <option key={sType} value={sType}>{t(`studio.pipeline.stage.${sType}`)}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={stage.label}
                      onChange={e => updateStage(i, { label: e.target.value })}
                      placeholder={t('studio.pipeline.labelPlaceholder')}
                      className="flex-1 px-1.5 py-0.5 rounded border border-border bg-background text-[9px] focus:outline-none focus:border-primary"
                    />
                  </div>
                  <div className="flex gap-1">
                    <input
                      type="text"
                      value={stage.command}
                      onChange={e => updateStage(i, { command: e.target.value })}
                      placeholder={t('studio.pipeline.commandPlaceholder')}
                      className="flex-1 px-1.5 py-0.5 rounded border border-border bg-background text-[9px] font-mono focus:outline-none focus:border-primary"
                    />
                    <div className="flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-border bg-background">
                      <Timer className="w-3 h-3 text-muted-foreground" />
                      <input
                        type="number"
                        value={Math.round((stage.timeout ?? 120000) / 1000)}
                        onChange={e => updateStage(i, { timeout: Number(e.target.value) * 1000 })}
                        className="w-10 text-[9px] text-right bg-transparent focus:outline-none"
                        min={1}
                      />
                      <span className="text-[8px] text-muted-foreground">s</span>
                    </div>
                  </div>
                </div>

                {/* 删除 */}
                <button
                  onClick={() => removeStage(i)}
                  className="p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-500 flex-shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}

            {stages.length === 0 && (
              <p className="text-[10px] text-muted-foreground text-center py-3">
                {t('studio.pipeline.noStages')}
              </p>
            )}
          </div>
        </div>

        {/* 错误 */}
        {error && (
          <div className="px-2 py-1.5 rounded bg-red-500/10 text-[10px] text-red-500">
            {error}
          </div>
        )}
      </div>
    </div>
  )
}

export default PipelineConfigEditor