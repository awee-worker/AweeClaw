import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { ChevronDown, Check, Search, Cloud } from 'lucide-react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { BUILTIN_PROVIDERS, getBuiltinProvider } from '@shared/configuration/aiProviders'
import { backendApi, getServerUrl } from '@services/backendApi'

const PROVIDER_ICONS: Record<string, string> = {
  openai: '🤖',
  anthropic: '🧠',
  gemini: '✨',
  deepseek: '🔍',
  groq: '⚡',
  mistral: '🌀',
  ollama: '🦙',
}

interface FlatModel {
  id: string
  name: string
  providerId: string
  providerName: string
  isCustom?: boolean
}

interface ModelSelectorProps {
  className?: string
  alignLeft?: boolean
}

export default function ModelSelector({ className = '', alignLeft = false }: ModelSelectorProps) {
  const { llmConfig, update, providerConfigs, save, cloudMode, isAuthenticated } = useStore(useShallow(s => ({
    llmConfig: s.llmConfig,
    update: s.update,
    providerConfigs: s.providerConfigs,
    save: s.save,
    cloudMode: s.cloudMode,
    isAuthenticated: s.isAuthenticated,
  })))
  const [isOpen, setIsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [cloudModels, setCloudModels] = useState<FlatModel[]>([])
  const containerRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!isOpen) {
      setSearchQuery('')
      return
    }

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)

    const focusTimer = setTimeout(() => {
      if (searchInputRef.current) {
        searchInputRef.current.focus({ preventScroll: true })
      }
    }, 50)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      clearTimeout(focusTimer)
    }
  }, [isOpen])

  const hasApiKey = useCallback((providerId: string) => {
    const config = providerConfigs[providerId]
    if (config?.apiKey) return true
    return llmConfig.provider === providerId && !!llmConfig.apiKey
  }, [llmConfig, providerConfigs])

  const fetchCloudModels = useCallback(() => {
    if (cloudMode !== 'cloud' || !isAuthenticated) {
      setCloudModels([])
      return
    }

    const serverUrl = getServerUrl()
    if (!serverUrl) return

    backendApi
      .get<Array<{ provider: string; models: string[] }>>('/api/v1/llm/models')
      .then((data) => {
        const flat: FlatModel[] = []
        for (const item of data) {
          for (const modelId of item.models) {
            flat.push({
              id: modelId,
              name: modelId.split('/').pop() || modelId,
              providerId: item.provider.toLowerCase(),
              providerName: item.provider,
            })
          }
        }
        setCloudModels(flat)
      })
      .catch(() => {
        setCloudModels([])
      })
  }, [cloudMode, isAuthenticated])

  useEffect(() => {
    fetchCloudModels()
  }, [fetchCloudModels])

  useEffect(() => {
    if (isOpen && cloudMode === 'cloud' && isAuthenticated) {
      fetchCloudModels()
    }
  }, [isOpen, cloudMode, isAuthenticated, fetchCloudModels])

  const allModels = useMemo<FlatModel[]>(() => {
    if (cloudMode === 'cloud' && isAuthenticated && cloudModels.length > 0) {
      return cloudModels
    }

    const models: FlatModel[] = []
    const seen = new Set<string>()

    for (const [providerId, provider] of Object.entries(BUILTIN_PROVIDERS)) {
      if (!hasApiKey(providerId)) continue

      const providerConfig = providerConfigs[providerId]
      const customModels = providerConfig?.customModels || []
      const builtinModelIds = new Set(provider.models)

      for (const id of provider.models) {
        const key = `${providerId}::${id}`
        if (!seen.has(key)) {
          seen.add(key)
          models.push({ id, name: id.split('/').pop() || id, providerId, providerName: provider.displayName })
        }
      }

      for (const id of customModels) {
        if (builtinModelIds.has(id)) continue
        const key = `${providerId}::${id}`
        if (!seen.has(key)) {
          seen.add(key)
          models.push({ id, name: id.split('/').pop() || id, providerId, providerName: provider.displayName, isCustom: true })
        }
      }
    }

    for (const [providerId, config] of Object.entries(providerConfigs)) {
      if (!providerId.startsWith('custom-')) continue
      if (!config?.apiKey) continue

      const modelIds = config.customModels || []
      const providerName = config.displayName || providerId

      for (const id of modelIds) {
        const key = `${providerId}::${id}`
        if (!seen.has(key)) {
          seen.add(key)
          models.push({ id, name: id.split('/').pop() || id, providerId, providerName, isCustom: true })
        }
      }
    }

    return models
  }, [providerConfigs, hasApiKey, cloudMode, isAuthenticated, cloudModels])

  const getIcon = useCallback((providerId: string) => {
    return PROVIDER_ICONS[providerId] || '🔮'
  }, [])

  const currentModel = useMemo(() => {
    return allModels.find(m => m.providerId === llmConfig.provider && m.id === llmConfig.model) || allModels[0] || null
  }, [allModels, llmConfig.provider, llmConfig.model])

  const applyProviderConfig = useCallback((providerId: string, modelId: string) => {
    if (cloudMode === 'cloud' && isAuthenticated) {
      update('llmConfig', { provider: providerId, model: modelId })
      save()
      return
    }

    if (llmConfig.provider === providerId) {
      update('llmConfig', { model: modelId })
      save()
      return
    }

    const builtinProvider = getBuiltinProvider(providerId)
    const config = providerConfigs[providerId]

    update('llmConfig', {
      provider: providerId,
      model: modelId,
      apiKey: config?.apiKey || '',
      baseUrl: config?.baseUrl || builtinProvider?.baseUrl,
      timeout: config?.timeout || builtinProvider?.defaults.timeout || llmConfig.timeout,
      protocol: builtinProvider?.protocol || config?.protocol,
      headers: config?.headers,
    })
    save()
  }, [llmConfig.provider, llmConfig.timeout, providerConfigs, update, save, cloudMode, isAuthenticated])

  const filteredModels = useMemo(() => {
    if (!searchQuery.trim()) return allModels

    const query = searchQuery.toLowerCase()
    return allModels.filter(m =>
      m.name.toLowerCase().includes(query) ||
      m.id.toLowerCase().includes(query) ||
      m.providerName.toLowerCase().includes(query)
    )
  }, [allModels, searchQuery])

  if (!currentModel) return null

  return (
    <div ref={containerRef} className={`${alignLeft ? '' : 'relative'} flex items-center ${className}`}>
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        className={`
          inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium border border-transparent
          transition-all duration-200
          ${isOpen
            ? 'bg-surface-active text-text-primary shadow-[0_0_0_2px_rgba(var(--accent)/0.15)]'
            : 'bg-white/[0.03] text-text-secondary hover:text-text-primary hover:bg-white/[0.08]'
          }
        `}
      >
        {cloudMode === 'cloud' && isAuthenticated ? (
          <Cloud className="w-3 h-3 text-accent flex-shrink-0" />
        ) : (
          <span className="text-[11px] grayscale opacity-80 flex-shrink-0">{getIcon(currentModel.providerId)}</span>
        )}
        <span className="truncate max-w-[200px]" title={currentModel.name}>
          {currentModel.name}
        </span>
        <ChevronDown className={`w-3 h-3 text-text-muted transition-transform flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute bottom-full left-0 mb-2 max-w-[320px] w-[calc(100%-30px)] max-h-[360px] flex flex-col bg-surface border border-border rounded-xl shadow-2xl z-50 animate-scale-in overflow-hidden">
          <div className="p-2 border-b border-border/50 sticky top-0 bg-surface/95 backdrop-blur-sm z-10 rounded-t-xl shrink-0">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="搜索模型..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full bg-background border border-border rounded-lg pl-8 pr-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted/85 focus:outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20 transition-all custom-scrollbar"
              />
            </div>
          </div>

          <div className="overflow-y-auto flex-1 p-1 custom-scrollbar">
            {filteredModels.length === 0 ? (
              <div className="py-6 text-center text-xs text-text-muted">无相关模型</div>
            ) : (
              filteredModels.map(model => {
                const isSelected = llmConfig.provider === model.providerId && llmConfig.model === model.id
                return (
                  <button
                    key={`${model.providerId}-${model.id}`}
                    onClick={() => {
                      applyProviderConfig(model.providerId, model.id)
                      setIsOpen(false)
                    }}
                    className={`
                      w-full flex items-center justify-between px-3 py-2 rounded-lg text-left text-xs transition-colors mb-0.5 last:mb-0
                      ${isSelected ? 'bg-accent/10 text-accent font-medium' : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'}
                    `}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="text-[11px] grayscale opacity-60 flex-shrink-0">
                        {cloudMode === 'cloud' && isAuthenticated
                          ? <Cloud className="w-3 h-3 text-accent" />
                          : getIcon(model.providerId)}
                      </span>
                      <span className="truncate" title={model.name}>{model.name}</span>
                      {model.isCustom && (
                        <span className="flex-shrink-0 px-1.5 py-0.5 text-[10px] bg-purple-500/10 text-purple-500 rounded border border-purple-500/20">
                          Custom
                        </span>
                      )}
                    </span>
                    {isSelected && <Check className="w-3.5 h-3.5 flex-shrink-0 ml-2" />}
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
