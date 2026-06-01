import { useState, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Search, Eye, EyeOff, Plus, Trash, Check, Globe, ToggleLeft, Server, X, Lightbulb } from 'lucide-react'
import {
  BUILTIN_SEARCH_ENGINES,
  getBuiltinSearchEngineIds,
  isCustomSearchEngine,
} from '@shared/configuration/searchProviders'
import type { WebSearchConfig, SearchEngineConfig } from '@shared/configuration/configTypes'
import { TextField, ToggleSwitch, ActionButton } from '@components/ui'
import { toast } from '@components/foundation/NotificationProvider'
import { t, type Language } from '@renderer/i18n'

interface SearchEnginePanelProps {
  webSearchConfig: WebSearchConfig
  setWebSearchConfig: (config: WebSearchConfig) => void
  language: Language
}

const BUILTIN_IDS = getBuiltinSearchEngineIds()

export function SearchEnginePanel({ webSearchConfig, setWebSearchConfig, language }: SearchEnginePanelProps) {

  const searchEngines = webSearchConfig.searchEngines || {}
  const activeEngine = webSearchConfig.activeSearchEngine || 'duckduckgo'

  const [selectedEngineId, setSelectedEngineId] = useState<string>(activeEngine)
  const [showApiKey, setShowApiKey] = useState(false)
  const [showAddDialog, setShowAddDialog] = useState(false)

  const builtinEngines = useMemo(() => {
    return BUILTIN_IDS.map(id => {
      const def = BUILTIN_SEARCH_ENGINES[id]
      const config = searchEngines[id]
      return { id, def, config }
    }).filter(e => e.def)
  }, [searchEngines])

  const customEngines = useMemo(() => {
    return Object.entries(searchEngines)
      .filter(([id]) => isCustomSearchEngine(id))
      .map(([id, config]) => ({ id, config }))
  }, [searchEngines])

  const selectedDef = BUILTIN_SEARCH_ENGINES[selectedEngineId]
  const selectedConfig = searchEngines[selectedEngineId]

  const ensureEngineConfig = useCallback((engineId: string): SearchEngineConfig => {
    return searchEngines[engineId] || { enabled: false }
  }, [searchEngines])

  const updateEngineConfig = useCallback((engineId: string, updates: Partial<SearchEngineConfig>) => {
    const current = ensureEngineConfig(engineId)
    const updated = { ...current, ...updates }
    setWebSearchConfig({
      ...webSearchConfig,
      searchEngines: { ...searchEngines, [engineId]: updated },
    })
  }, [webSearchConfig, searchEngines, setWebSearchConfig, ensureEngineConfig])

  const toggleEngine = useCallback((engineId: string) => {
    const current = ensureEngineConfig(engineId)
    updateEngineConfig(engineId, { enabled: !current.enabled })
  }, [ensureEngineConfig, updateEngineConfig])

  const setActiveEngine = useCallback((engineId: string) => {
    setWebSearchConfig({
      ...webSearchConfig,
      activeSearchEngine: engineId,
    })
    setSelectedEngineId(engineId)
  }, [webSearchConfig, setWebSearchConfig])

  const handleAddProvider = useCallback((providerType: string, instanceName: string) => {
    const id = instanceName.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '')
    if (!id) {
      toast.error(t('search.invalidName', language as Language))
      return
    }
    if (searchEngines[id]) {
      toast.error(t('search.providerExists', language as Language))
      return
    }
    const def = BUILTIN_SEARCH_ENGINES[providerType]
    const newConfig: SearchEngineConfig = { enabled: false }
    if (def?.auth.type !== 'none') {
      newConfig.apiKey = ''
    }
    if (providerType === 'searxng') {
      newConfig.extraValues = { baseUrl: '' }
    }
    if (isCustomSearchEngine(providerType)) {
      newConfig.customBaseUrl = ''
    }
    setWebSearchConfig({
      ...webSearchConfig,
      searchEngines: { ...searchEngines, [id]: newConfig },
    })
    setSelectedEngineId(id)
    setShowAddDialog(false)
  }, [ searchEngines, webSearchConfig, setWebSearchConfig])

  const handleDeleteCustom = useCallback((engineId: string) => {
    const updated = { ...searchEngines }
    delete updated[engineId]
    const newActive = activeEngine === engineId ? 'duckduckgo' : activeEngine
    setWebSearchConfig({
      ...webSearchConfig,
      searchEngines: updated,
      activeSearchEngine: newActive,
    })
    if (selectedEngineId === engineId) {
      setSelectedEngineId(newActive)
    }
  }, [searchEngines, activeEngine, selectedEngineId, webSearchConfig, setWebSearchConfig])

  const regionBadge = (hint?: 'global' | 'china' | 'both') => {
    if (!hint || hint === 'both') return null
    return (
      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${hint === 'china' ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'}`}>
        {hint === 'china' ? (t('search.cn', language as Language)) : (t('search.global', language as Language))}
      </span>
    )
  }

  return (
    <div className="flex gap-5 animate-fade-in pb-10">
      <div className="w-52 flex-shrink-0 space-y-3 pr-4 border-r border-border/30">
        <h4 className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
          {t('search.engines', language as Language)}
        </h4>

        <div className="space-y-1 max-h-[calc(100vh-320px)] min-h-[300px] overflow-y-auto no-scrollbar">
          {builtinEngines.map(({ id, def, config }) => (
            <button
              key={id}
              onClick={() => setSelectedEngineId(id)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 ${
                selectedEngineId === id
                  ? 'bg-accent/10 text-text-primary border border-accent/20'
                  : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary border border-transparent'
              }`}
            >
              <ToggleLeft className={`w-3.5 h-3.5 flex-shrink-0 ${config?.enabled ? 'text-green-400' : 'text-text-muted/40'}`} />
              <span className="truncate flex-1 text-left">{language === 'zh' ? def.displayNameZh : def.displayName}</span>
              {def.free && (
                <span className="text-[9px] px-1 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/20">
                  {t('search.free', language as Language)}
                </span>
              )}
            </button>
          ))}

          {customEngines.length > 0 && (
            <>
              <div className="pt-2 pb-1">
                <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                  {t('search.custom', language as Language)}
                </span>
              </div>
              {customEngines.map(({ id, config }) => (
                <button
                  key={id}
                  onClick={() => setSelectedEngineId(id)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 ${
                    selectedEngineId === id
                      ? 'bg-accent/10 text-text-primary border border-accent/20'
                      : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary border border-transparent'
                  }`}
                >
                  <ToggleLeft className={`w-3.5 h-3.5 flex-shrink-0 ${config?.enabled ? 'text-green-400' : 'text-text-muted/40'}`} />
                  <span className="truncate flex-1 text-left">{id}</span>
                </button>
              ))}
            </>
          )}
        </div>

        <button
          onClick={() => setShowAddDialog(true)}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-accent hover:bg-accent/10 border border-dashed border-accent/30 transition-all duration-200"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{t('search.addProvider', language as Language)}</span>
        </button>
      </div>

      <div className="flex-1 min-w-0 space-y-5">
        {selectedDef ? (
          <BuiltinEngineEditor
            engineId={selectedEngineId}
            def={selectedDef}
            config={selectedConfig || { enabled: false }}
            isActive={activeEngine === selectedEngineId}
            language={language}
            showApiKey={showApiKey}
            onToggle={() => toggleEngine(selectedEngineId)}
            onSetActive={() => setActiveEngine(selectedEngineId)}
            onUpdate={updates => updateEngineConfig(selectedEngineId, updates)}
            onToggleShowApiKey={() => setShowApiKey(!showApiKey)}
            regionBadge={regionBadge}
          />
        ) : isCustomSearchEngine(selectedEngineId) ? (
          <CustomEngineEditor
            engineId={selectedEngineId}
            config={selectedConfig || { enabled: false }}
            isActive={activeEngine === selectedEngineId}
            language={language}
            showApiKey={showApiKey}
            onToggle={() => toggleEngine(selectedEngineId)}
            onSetActive={() => setActiveEngine(selectedEngineId)}
            onUpdate={updates => updateEngineConfig(selectedEngineId, updates)}
            onDelete={() => handleDeleteCustom(selectedEngineId)}
            onToggleShowApiKey={() => setShowApiKey(!showApiKey)}
          />
        ) : (
          <div className="flex items-center justify-center h-64 text-text-muted text-sm">
            {t('search.selectEngine', language as Language)}
          </div>
        )}



        <section className="rounded-2xl border border-border/50 bg-surface/20 p-5 backdrop-blur-xl shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <div className="p-1.5 bg-accent/10 rounded-md text-accent">
              <Globe className="w-3.5 h-3.5" />
            </div>
            <h5 className="text-sm font-semibold text-text-primary">{t('search.info', language as Language)}</h5>
          </div>
          <div className="text-xs text-text-muted space-y-1.5">
            <p>{t('search.infoCandidate', language as Language)}</p>
            <p>{t('search.infoActive', language as Language)}</p>
            <p>{t('search.infoFallback', language as Language)}</p>
            <p>{t('search.infoRegion', language as Language)}</p>
          </div>
          <div className="flex items-start gap-2.5 mt-3 pt-3 border-t border-border/20 p-3 rounded-xl bg-accent/10 border border-accent/25 text-[11px] text-text-primary leading-relaxed">
            <Lightbulb className="w-4 h-4 shrink-0 mt-0.5 text-accent" />
            <span>{t('search.mcpTip', language as Language)}</span>
          </div>
        </section>
      </div>

      {showAddDialog && createPortal(
        <AddProviderDialog
          language={language}
          existingIds={Object.keys(searchEngines)}
          onAdd={handleAddProvider}
          onClose={() => setShowAddDialog(false)}
        />,
        document.body,
      )}
    </div>
  )
}

function BuiltinEngineEditor({
  engineId: _engineId,
  def,
  config,
  isActive,
  language,
  showApiKey,
  onToggle,
  onSetActive,
  onUpdate,
  onToggleShowApiKey,
  regionBadge,
}: {
  engineId: string
  def: NonNullable<typeof BUILTIN_SEARCH_ENGINES[string]>
  config: SearchEngineConfig
  isActive: boolean
  language: Language
  showApiKey: boolean
  onToggle: () => void
  onSetActive: () => void
  onUpdate: (updates: Partial<SearchEngineConfig>) => void
  onToggleShowApiKey: () => void
  regionBadge: (hint?: 'global' | 'china' | 'both') => React.ReactNode
}) {

  return (
    <section className="rounded-2xl border border-border/50 bg-surface/20 p-5 backdrop-blur-xl shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-accent/10 rounded-lg text-accent">
            <Search className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h5 className="text-sm font-semibold text-text-primary">
                {language === 'zh' ? def.displayNameZh : def.displayName}
              </h5>
              {regionBadge(def.regionHint)}
              {def.free && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/20">
                  {t('search.free', language as Language)}
                </span>
              )}
            </div>
            <p className="text-xs text-text-muted mt-0.5">
              {language === 'zh' ? def.descriptionZh : def.description}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={onSetActive}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
              isActive
                ? 'bg-accent text-white shadow-sm'
                : 'bg-surface/50 text-text-secondary hover:bg-accent/10 hover:text-accent border border-border/50'
            }`}
          >
            {isActive ? (
              <span className="flex items-center gap-1.5">
                <Check className="w-3 h-3" />
                {t('search.currentUse', language as Language)}
              </span>
            ) : (
              t('search.setDefault', language as Language)
            )}
          </button>
          <ToggleSwitch checked={config.enabled} onChange={onToggle} />
        </div>
      </div>

      {def.auth.type !== 'none' && (
        <div className="space-y-3 mt-4">
          <div>
            <label className="text-xs font-medium text-text-secondary mb-1.5 block">
              API Key
            </label>
            <div className="relative">
              <TextField
                type={showApiKey ? 'text' : 'password'}
                value={config.apiKey || ''}
                onChange={e => onUpdate({ apiKey: e.target.value })}
                placeholder={def.auth.placeholder}
                className="bg-background/50 border-border text-xs pr-10"
              />
              <button
                type="button"
                onClick={onToggleShowApiKey}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors"
              >
                {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <a
              href={def.auth.helpUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-accent/70 hover:text-accent mt-1 inline-block"
            >
              {t('search.getApiKey', language as Language)} →
            </a>
          </div>
        </div>
      )}

      {def.extraFields && def.extraFields.length > 0 && (
        <div className="space-y-3 mt-4">
          {def.extraFields.map(field => (
            <div key={field.key}>
              <label className="text-xs font-medium text-text-secondary mb-1.5 block">
                {language === 'zh' ? field.labelZh : field.label}
                {field.required && <span className="text-red-400 ml-1">*</span>}
              </label>
              <TextField
                type={field.secret ? 'password' : 'text'}
                value={config.extraValues?.[field.key] || ''}
                onChange={e => {
                  const extraValues = { ...(config.extraValues || {}), [field.key]: e.target.value }
                  onUpdate({ extraValues })
                }}
                placeholder={language === 'zh' ? field.placeholderZh : field.placeholder}
                className="bg-background/50 border-border text-xs"
              />
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 pt-4 border-t border-border/30">
        <div className="flex items-center gap-3">
          <label className="text-xs font-medium text-text-secondary whitespace-nowrap">
            {t('search.timeout', language as Language)}
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={5}
              max={120}
              value={config.timeout ?? ''}
              onChange={e => {
                const val = parseInt(e.target.value, 10)
                if (!isNaN(val) && val >= 5 && val <= 120) {
                  onUpdate({ timeout: val })
                }
              }}
              placeholder="30"
              className="w-16 px-2 py-1 rounded-lg bg-background/50 border border-border text-xs text-text-primary focus:outline-none focus:border-accent/50 transition-colors"
            />
            <span className="text-xs text-text-muted">{t('search.timeoutSec', language as Language)}</span>
          </div>
          <span className="text-[10px] text-text-muted">
            {t('search.timeoutDefault', language as Language)}
          </span>
        </div>
      </div>

      {def.auth.type === 'none' && (
        <div className="flex items-start gap-2 p-2.5 mt-4 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-[11px]">
          <Check className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <p>{t('search.noKeyRequired', language as Language)}</p>
        </div>
      )}
    </section>
  )
}

function CustomEngineEditor({
  engineId,
  config,
  isActive,
  language,
  showApiKey,
  onToggle,
  onSetActive,
  onUpdate,
  onDelete,
  onToggleShowApiKey,
}: {
  engineId: string
  config: SearchEngineConfig
  isActive: boolean
  language: Language
  showApiKey: boolean
  onToggle: () => void
  onSetActive: () => void
  onUpdate: (updates: Partial<SearchEngineConfig>) => void
  onDelete: () => void
  onToggleShowApiKey: () => void
}) {

  return (
    <section className="rounded-2xl border border-border/50 bg-surface/20 p-5 backdrop-blur-xl shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-accent/10 rounded-lg text-accent">
            <Server className="w-5 h-5" />
          </div>
          <div>
            <h5 className="text-sm font-semibold text-text-primary">{engineId}</h5>
            <p className="text-xs text-text-muted mt-0.5">{t('search.customEngine', language as Language)}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={onSetActive}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
              isActive
                ? 'bg-accent text-white shadow-sm'
                : 'bg-surface/50 text-text-secondary hover:bg-accent/10 hover:text-accent border border-border/50'
            }`}
          >
            {isActive ? (
              <span className="flex items-center gap-1.5">
                <Check className="w-3 h-3" />
                {t('search.currentUse', language as Language)}
              </span>
            ) : (
              t('search.setDefault', language as Language)
            )}
          </button>
          <ToggleSwitch checked={config.enabled} onChange={onToggle} />
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium text-text-secondary mb-1.5 block">
            {t('search.apiBaseUrl', language as Language)}
          </label>
          <TextField
            type="text"
            value={config.customBaseUrl || ''}
            onChange={e => onUpdate({ customBaseUrl: e.target.value })}
            placeholder={t('search.apiBaseUrlPlaceholder', language as Language)}
            className="bg-background/50 border-border text-xs"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-text-secondary mb-1.5 block">
            API Key
          </label>
          <div className="relative">
            <TextField
              type={showApiKey ? 'text' : 'password'}
              value={config.apiKey || ''}
              onChange={e => onUpdate({ apiKey: e.target.value })}
              placeholder={t('search.apiKeyOptional', language as Language)}
              className="bg-background/50 border-border text-xs pr-10"
            />
            <button
              type="button"
              onClick={onToggleShowApiKey}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors"
            >
              {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-border/30">
        <div className="flex items-center gap-3">
          <label className="text-xs font-medium text-text-secondary whitespace-nowrap">
            {t('search.timeout', language as Language)}
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={5}
              max={120}
              value={config.timeout ?? ''}
              onChange={e => {
                const val = parseInt(e.target.value, 10)
                if (!isNaN(val) && val >= 5 && val <= 120) {
                  onUpdate({ timeout: val })
                }
              }}
              placeholder="30"
              className="w-16 px-2 py-1 rounded-lg bg-background/50 border border-border text-xs text-text-primary focus:outline-none focus:border-accent/50 transition-colors"
            />
            <span className="text-xs text-text-muted">{t('search.timeoutSec', language as Language)}</span>
          </div>
          <span className="text-[10px] text-text-muted">
            {t('search.timeoutDefault', language as Language)}
          </span>
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-border/30">
        <ActionButton
          variant="danger"
          size="sm"
          onClick={onDelete}
          className="text-xs h-7"
        >
          <Trash className="w-3 h-3 mr-1.5" />
          {t('search.deleteEngine', language as Language)}
        </ActionButton>
      </div>
    </section>
  )
}

function AddProviderDialog({
  language,
  existingIds,
  onAdd,
  onClose,
}: {
  language: Language
  existingIds: string[]
  onAdd: (providerType: string, instanceName: string) => void
  onClose: () => void
}) {
  const [selectedType, setSelectedType] = useState<string>('')
  const [instanceName, setInstanceName] = useState('')

  const providerOptions = useMemo(() => {
    const options: { id: string; name: string; desc: string; free: boolean }[] = []
    for (const [id, def] of Object.entries(BUILTIN_SEARCH_ENGINES)) {
      options.push({
        id,
        name: language === 'zh' ? def.displayNameZh : def.displayName,
        desc: language === 'zh' ? def.descriptionZh : def.description,
        free: def.free,
      })
    }
    options.push({
      id: '_custom',
      name: t('search.customApi', language as Language),
      desc: t('search.customApiDesc', language as Language),
      free: false,
    })
    return options
  }, [language])

  const handleAdd = () => {
    if (!selectedType) {
      toast.error(t('search.selectProviderType', language as Language))
      return
    }
    const name = instanceName.trim() || selectedType
    const id = name.toLowerCase().replace(/[^a-z0-9_-]/g, '')
    if (existingIds.includes(id)) {
      toast.error(t('search.providerNameExists', language as Language))
      return
    }
    onAdd(selectedType, name)
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-surface border border-border/50 rounded-2xl shadow-2xl w-[460px] max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/30">
          <h3 className="text-sm font-semibold text-text-primary">{t('search.addProviderTitle', language as Language)}</h3>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <label className="text-xs font-medium text-text-secondary mb-2 block">
              {t('search.providerTypeSelect', language as Language)}
            </label>
            <div className="grid grid-cols-2 gap-2 max-h-[280px] overflow-y-auto no-scrollbar">
              {providerOptions.map(opt => (
                <button
                  key={opt.id}
                  onClick={() => {
                    setSelectedType(opt.id)
                    if (!instanceName) setInstanceName(opt.id)
                  }}
                  className={`p-3 rounded-xl border text-left transition-all duration-200 ${
                    selectedType === opt.id
                      ? 'border-accent bg-accent/5 shadow-sm ring-1 ring-accent/20'
                      : 'border-border/50 bg-surface/30 hover:border-accent/30 hover:bg-surface/50'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium text-text-primary truncate">{opt.name}</span>
                    {opt.free && (
                      <span className="text-[9px] px-1 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/20 shrink-0">
                        {t('search.free', language as Language)}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-text-muted mt-1 line-clamp-2">{opt.desc}</p>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-text-secondary mb-1.5 block">
              {t('search.instanceName', language as Language)}
            </label>
            <TextField
              value={instanceName}
              onChange={e => setInstanceName(e.target.value)}
              placeholder={t('search.instanceNamePlaceholder', language as Language)}
              className="bg-background/50 border-border text-xs"
            />
            <p className="text-[10px] text-text-muted mt-1">
              {t('search.instanceNameDesc', language as Language)}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-border/30">
          <ActionButton variant="secondary" size="sm" onClick={onClose} className="text-xs h-8 px-4">
            {t('statusBar.cancel', language as Language)}
          </ActionButton>
          <ActionButton variant="primary" size="sm" onClick={handleAdd} className="text-xs h-8 px-4">
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            {t('provider.add', language as Language)}
          </ActionButton>
        </div>
      </div>
    </div>
  )
}
