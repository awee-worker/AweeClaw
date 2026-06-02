import { memo, useState, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Check, Trash, Settings2, X, Eye, Sparkles, Cpu, Image, Wrench, Brain, Code, Mic, RotateCcw, Sliders } from 'lucide-react'
import {
  type ModelCapability,
  type ModelConfig,
  type ModelGenerationParams,
  CAPABILITY_META,
  inferCapabilities,
} from '@renderer/types/modelProvider'
import { ActionButton, ToggleSwitch } from '@components/ui'
import { t, type Language } from '@renderer/i18n'

interface ModelCardGridProps {
  models: string[]
  selectedModel: string
  onSelectModel: (model: string) => void
  onRemoveModel: (model: string) => void
  modelConfigs: Record<string, ModelConfig>
  onUpdateModelConfig: (model: string, config: ModelConfig) => void
  language: Language
  providerGenerationParams: Partial<ModelGenerationParams>
}

const CAPABILITY_ICONS: Record<string, React.ReactNode> = {
  llm: <Cpu className="w-2.5 h-2.5" />,
  embedding: <Sparkles className="w-2.5 h-2.5" />,
  vision: <Eye className="w-2.5 h-2.5" />,
  'tool-calling': <Wrench className="w-2.5 h-2.5" />,
  reasoning: <Brain className="w-2.5 h-2.5" />,
  'image-gen': <Image className="w-2.5 h-2.5" />,
  code: <Code className="w-2.5 h-2.5" />,
  audio: <Mic className="w-2.5 h-2.5" />,
}

const ALL_CAPABILITIES: ModelCapability[] = [
  'llm', 'embedding', 'vision', 'tool-calling', 'reasoning', 'image-gen', 'code', 'audio',
]

function CapabilityTag({ capability, language }: { capability: ModelCapability; language: Language }) {
  const meta = CAPABILITY_META[capability]
  if (!meta) return null
  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-semibold border ${meta.bgColor} ${meta.color} uppercase tracking-wider`}>
      {CAPABILITY_ICONS[capability]}
      {meta.label[language]}
    </span>
  )
}

function CapabilityEditor({
  capabilities,
  onChange,
  language,
}: {
  capabilities: ModelCapability[]
  onChange: (caps: ModelCapability[]) => void
  language: Language
}) {
  const toggleCap = (cap: ModelCapability) => {
    if (capabilities.includes(cap)) {
      onChange(capabilities.filter(c => c !== cap))
    } else {
      onChange([...capabilities, cap])
    }
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {ALL_CAPABILITIES.map(cap => {
        const meta = CAPABILITY_META[cap]
        const active = capabilities.includes(cap)
        return (
          <button
            key={cap}
            onClick={() => toggleCap(cap)}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold border transition-all ${
              active
                ? `${meta.bgColor} ${meta.color} border-current/20`
                : 'bg-surface/30 text-text-muted border-border/50 hover:border-border'
            }`}
          >
            {CAPABILITY_ICONS[cap]}
            {meta.label[language]}
          </button>
        )
      })}
    </div>
  )
}

function ModelParamsEditor({
  model,
  config,
  providerDefaults,
  onSave,
  onCancel,
  language,
}: {
  model: string
  config: ModelConfig
  providerDefaults: Partial<ModelGenerationParams>
  onSave: (params: ModelGenerationParams | undefined) => void
  onCancel: () => void
  language: Language
}) {
  const hasCustom = config.generationParams !== undefined
  const [useCustom, setUseCustom] = useState(hasCustom)
  const [params, setParams] = useState<ModelGenerationParams>(
    config.generationParams ?? { ...providerDefaults },
  )

  const updateParam = <K extends keyof ModelGenerationParams>(key: K, value: ModelGenerationParams[K]) => {
    setParams(prev => ({ ...prev, [key]: value }))
  }

  const handleSave = () => {
    if (useCustom) {
      onSave(params)
    } else {
      onSave(undefined)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-surface border border-border/50 rounded-2xl shadow-2xl w-[520px] max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/30">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 bg-accent/10 rounded-md text-accent">
              <Settings2 className="w-3.5 h-3.5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-text-primary">
                {t('provider.modelParams', language)}
              </h3>
              <p className="text-[11px] text-text-muted font-mono truncate max-w-[320px]">{model}</p>
            </div>
          </div>
          <button onClick={onCancel} className="p-1 rounded-md hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="flex items-center justify-between rounded-lg border border-border/60 bg-background/30 px-3 py-2.5">
            <div className="space-y-0.5 pr-4">
              <label className="text-xs text-text-secondary">
                {t('provider.useCustomParams', language)}
              </label>
              <p className="text-[11px] text-text-muted">
                {useCustom
                  ? t('provider.customParamsActive', language)
                  : t('provider.inheritProviderParams', language)}
              </p>
            </div>
            <ToggleSwitch
              checked={useCustom}
              onChange={e => setUseCustom(e.target.checked)}
              className="flex-shrink-0"
            />
          </div>

          {useCustom && (
            <div className="space-y-4 animate-in fade-in slide-in-from-top-1 duration-200">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider">
                  {t('provider.generation', language)}
                </span>
                <button
                  onClick={() => setParams({ ...providerDefaults })}
                  className="text-[10px] text-accent hover:text-accent-hover flex items-center gap-1"
                >
                  <RotateCcw className="w-3 h-3" />
                  {t('provider.resetToDefault', language)}
                </button>
              </div>

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-text-secondary">{t('provider.maxTokens', language)}</label>
                    <span className="text-xs font-mono bg-background/50 px-1.5 py-0.5 rounded text-accent">{params.maxTokens ?? 8192}</span>
                  </div>
                  <input type="range" min={1024} max={32768} step={1024} value={params.maxTokens ?? 8192} onChange={e => updateParam('maxTokens', parseInt(e.target.value))} className="w-full h-1.5 bg-surface-active rounded-full appearance-none cursor-pointer accent-accent" />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-text-secondary">{t('provider.temperature', language)}</label>
                    <span className="text-xs font-mono bg-background/50 px-1.5 py-0.5 rounded text-accent">{(params.temperature ?? 0.7).toFixed(1)}</span>
                  </div>
                  <input type="range" min={0} max={2} step={0.1} value={params.temperature ?? 0.7} onChange={e => updateParam('temperature', parseFloat(e.target.value))} className="w-full h-1.5 bg-surface-active rounded-full appearance-none cursor-pointer accent-accent" />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-text-secondary">Top P</label>
                    <span className="text-xs font-mono bg-background/50 px-1.5 py-0.5 rounded text-accent">{(params.topP ?? 1).toFixed(2)}</span>
                  </div>
                  <input type="range" min={0} max={1} step={0.05} value={params.topP ?? 1} onChange={e => updateParam('topP', parseFloat(e.target.value))} className="w-full h-1.5 bg-surface-active rounded-full appearance-none cursor-pointer accent-accent" />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-text-secondary">Top K</label>
                    <span className="text-xs font-mono bg-background/50 px-1.5 py-0.5 rounded text-accent">{params.topK ?? 'Default'}</span>
                  </div>
                  <input type="number" min={0} value={params.topK ?? ''} onChange={e => updateParam('topK', e.target.value ? parseInt(e.target.value) : undefined)} placeholder="Default" className="w-full bg-surface-active rounded-lg px-3 py-1.5 text-xs border border-border focus:border-accent outline-none" />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-text-secondary">Frequency Penalty</label>
                    <span className="text-xs font-mono bg-background/50 px-1.5 py-0.5 rounded text-accent">{(params.frequencyPenalty ?? 0).toFixed(1)}</span>
                  </div>
                  <input type="range" min={-2} max={2} step={0.1} value={params.frequencyPenalty ?? 0} onChange={e => updateParam('frequencyPenalty', parseFloat(e.target.value))} className="w-full h-1.5 bg-surface-active rounded-full appearance-none cursor-pointer accent-accent" />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-text-secondary">Presence Penalty</label>
                    <span className="text-xs font-mono bg-background/50 px-1.5 py-0.5 rounded text-accent">{(params.presencePenalty ?? 0).toFixed(1)}</span>
                  </div>
                  <input type="range" min={-2} max={2} step={0.1} value={params.presencePenalty ?? 0} onChange={e => updateParam('presencePenalty', parseFloat(e.target.value))} className="w-full h-1.5 bg-surface-active rounded-full appearance-none cursor-pointer accent-accent" />
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-border/30">
          <ActionButton variant="secondary" size="sm" onClick={onCancel} className="text-xs h-8 px-4">
            {t('provider.cancelEdit', language)}
          </ActionButton>
          <ActionButton variant="primary" size="sm" onClick={handleSave} className="text-xs h-8 px-4">
            <Check className="w-3.5 h-3.5 mr-1.5" />
            {t('provider.save', language)}
          </ActionButton>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function ModelCard({
  model,
  isSelected,
  capabilities,
  hasCustomParams,
  enabled,
  onSelect,
  onRemove,
  onEditCapabilities,
  onEditParams,
  onToggleEnabled,
  language,
}: {
  model: string
  isSelected: boolean
  capabilities: ModelCapability[]
  hasCustomParams: boolean
  enabled: boolean
  onSelect: () => void
  onRemove: () => void
  onEditCapabilities: () => void
  onEditParams: () => void
  onToggleEnabled: () => void
  language: Language
}) {
  return (
    <div
      onClick={enabled ? onSelect : undefined}
      className={`relative rounded-xl border p-3 transition-all duration-200 ${
        enabled ? 'cursor-pointer' : 'cursor-default opacity-50'
      } ${
        isSelected && enabled
          ? 'bg-accent/10 border-accent/30 shadow-md shadow-accent/10'
          : 'bg-surface/30 border-border/50 hover:border-border hover:bg-surface/50'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {isSelected && enabled && (
            <Check className="w-3.5 h-3.5 text-accent flex-shrink-0" strokeWidth={3} />
          )}
          <span className={`text-xs font-medium truncate ${isSelected && enabled ? 'text-accent' : 'text-text-primary'}`}>
            {model}
          </span>
          {!enabled && (
            <span className="text-[9px] text-text-muted bg-surface-active/50 px-1.5 py-0.5 rounded">
              {t('provider.modelDisabled', language)}
            </span>
          )}
        </div>
        <div className="flex-shrink-0">
          <ToggleSwitch
            checked={enabled}
            switchSize="sm"
            onChange={e => { e.stopPropagation(); onToggleEnabled() }}
          />
        </div>
      </div>

      <div className="flex items-center justify-between mt-2">
        <div className="flex flex-wrap gap-1">
          {capabilities.map(cap => (
            <CapabilityTag key={cap} capability={cap} language={language} />
          ))}
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button
            onClick={e => { e.stopPropagation(); onEditCapabilities() }}
            className="p-1 rounded hover:bg-accent/10 text-text-muted hover:text-accent transition-colors"
            title={t('provider.editCapabilities', language)}
          >
            <Settings2 className="w-3 h-3" />
          </button>
          <button
            onClick={e => { e.stopPropagation(); onEditParams() }}
            className={`p-1 rounded hover:bg-accent/10 transition-colors ${hasCustomParams ? 'text-accent' : 'text-text-muted hover:text-accent'}`}
            title={t('provider.modelParams', language)}
          >
            <Sliders className="w-3 h-3" />
          </button>
          <button
            onClick={e => { e.stopPropagation(); onRemove() }}
            className="p-1 rounded hover:bg-red-500/10 text-text-muted hover:text-red-400 transition-colors"
            title={t('provider.deleteProvider', language)}
          >
            <Trash className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  )
}

function CapabilityEditorDialog({
  model,
  capabilities,
  onSave,
  onCancel,
  language,
}: {
  model: string
  capabilities: ModelCapability[]
  onSave: (caps: ModelCapability[]) => void
  onCancel: () => void
  language: Language
}) {
  const [localCaps, setLocalCaps] = useState<ModelCapability[]>(capabilities)

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-surface border border-border/50 rounded-2xl shadow-2xl w-[440px] max-h-[70vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/30">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 bg-accent/10 rounded-md text-accent">
              <Settings2 className="w-3.5 h-3.5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-text-primary">
                {t('provider.editCapabilities', language)}
              </h3>
              <p className="text-[11px] text-text-muted font-mono truncate max-w-[280px]">{model}</p>
            </div>
          </div>
          <button onClick={onCancel} className="p-1 rounded-md hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <CapabilityEditor capabilities={localCaps} onChange={setLocalCaps} language={language} />
        </div>

        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-border/30">
          <ActionButton variant="secondary" size="sm" onClick={onCancel} className="text-xs h-8 px-4">
            {t('provider.cancelEdit', language)}
          </ActionButton>
          <ActionButton variant="primary" size="sm" onClick={() => onSave(localCaps)} className="text-xs h-8 px-4">
            <Check className="w-3.5 h-3.5 mr-1.5" />
            {t('provider.save', language)}
          </ActionButton>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export const ModelCardGrid = memo(function ModelCardGrid({
  models,
  selectedModel,
  onSelectModel,
  onRemoveModel,
  modelConfigs,
  onUpdateModelConfig,
  language,
  providerGenerationParams,
}: ModelCardGridProps) {
  const [editingCapModel, setEditingCapModel] = useState<string | null>(null)
  const [editingParamsModel, setEditingParamsModel] = useState<string | null>(null)

  const getModelCapabilities = useCallback((model: string): ModelCapability[] => {
    const config = modelConfigs[model]
    if (config?.capabilities && config.capabilities.length > 0) {
      return config.capabilities
    }
    return inferCapabilities(model)
  }, [modelConfigs])

  const handleSaveCapabilities = useCallback((model: string, caps: ModelCapability[]) => {
    const existing = modelConfigs[model]
    onUpdateModelConfig(model, {
      ...existing,
      capabilities: caps,
    })
    setEditingCapModel(null)
  }, [modelConfigs, onUpdateModelConfig])

  const handleSaveParams = useCallback((model: string, params: ModelGenerationParams | undefined) => {
    const existing = modelConfigs[model]
    onUpdateModelConfig(model, {
      ...existing,
      capabilities: existing?.capabilities ?? inferCapabilities(model),
      generationParams: params,
    })
    setEditingParamsModel(null)
  }, [modelConfigs, onUpdateModelConfig])

  const groupedModels = useMemo(() => {
    const groups: Record<string, string[]> = {}
    for (const model of models) {
      const caps = getModelCapabilities(model)
      const primaryCap = caps[0] ?? 'llm'
      if (!groups[primaryCap]) groups[primaryCap] = []
      groups[primaryCap].push(model)
    }
    return groups
  }, [models, getModelCapabilities])

  const groupOrder: string[] = ['llm', 'code', 'reasoning', 'vision', 'tool-calling', 'embedding', 'image-gen', 'audio']
  const sortedGroups = Object.entries(groupedModels).sort(([a], [b]) => {
    const ai = groupOrder.indexOf(a)
    const bi = groupOrder.indexOf(b)
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
  })

  return (
    <div className="space-y-3">
      {sortedGroups.map(([group, groupModels]) => {
        const meta = CAPABILITY_META[group as ModelCapability]
        return (
          <div key={group}>
            <div className="flex items-center gap-2 mb-2">
              <span className={`text-[10px] font-bold uppercase tracking-wider ${meta?.color ?? 'text-text-muted'}`}>
                {meta?.label[language] ?? group}
              </span>
              <span className="text-[10px] text-text-muted">({groupModels.length})</span>
            </div>
            <div className="grid grid-cols-1 gap-2">
              {groupModels.map(model => {
                const modelConfig = modelConfigs[model]
                const modelEnabled = modelConfig?.enabled === true
                return (
                  <ModelCard
                    key={model}
                    model={model}
                    isSelected={selectedModel === model}
                    capabilities={getModelCapabilities(model)}
                    hasCustomParams={modelConfig?.generationParams !== undefined}
                    enabled={modelEnabled}
                    onSelect={() => onSelectModel(model)}
                    onRemove={() => onRemoveModel(model)}
                    onEditCapabilities={() => setEditingCapModel(model)}
                    onEditParams={() => setEditingParamsModel(model)}
                    onToggleEnabled={() => {
                      const existing = modelConfigs[model]
                      onUpdateModelConfig(model, {
                        ...existing,
                        capabilities: existing?.capabilities ?? inferCapabilities(model),
                        enabled: !modelEnabled,
                      })
                    }}
                    language={language}
                  />
                )
              })}
            </div>
          </div>
        )
      })}

      {editingCapModel && (
        <CapabilityEditorDialog
          model={editingCapModel}
          capabilities={getModelCapabilities(editingCapModel)}
          onSave={caps => handleSaveCapabilities(editingCapModel, caps)}
          onCancel={() => setEditingCapModel(null)}
          language={language}
        />
      )}

      {editingParamsModel && (
        <ModelParamsEditor
          model={editingParamsModel}
          config={modelConfigs[editingParamsModel] ?? { capabilities: inferCapabilities(editingParamsModel) }}
          providerDefaults={providerGenerationParams}
          onSave={params => handleSaveParams(editingParamsModel, params)}
          onCancel={() => setEditingParamsModel(null)}
          language={language}
        />
      )}
    </div>
  )
})
