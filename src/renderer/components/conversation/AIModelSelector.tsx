import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Check, Search, Cloud, Puzzle } from 'lucide-react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { BUILTIN_PROVIDERS, getBuiltinProvider } from '@shared/configuration/aiProviders'
import { backendApi, getServerUrl } from '@services/backendApi'
import { ProviderIcon } from '@components/ui/ProviderIcon'

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
  disabled?: boolean
}

export default function ModelSelector({ className = '', alignLeft = false, disabled = false }: ModelSelectorProps) {
  const { llmConfig, update, providerConfigs, save, cloudMode, isAuthenticated, setCloudMode, serverUrl } = useStore(useShallow(s => ({
    llmConfig: s.llmConfig,
    update: s.update,
    providerConfigs: s.providerConfigs,
    save: s.save,
    cloudMode: s.cloudMode,
    isAuthenticated: s.isAuthenticated,
    setCloudMode: s.setCloudMode,
    serverUrl: s.serverUrl,
  })))
  const [isOpen, setIsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  // Tab 状态：跟随 cloudMode，但弹窗内可以独立切换
  const [activeTab, setActiveTab] = useState<'local' | 'cloud'>(cloudMode === 'cloud' ? 'cloud' : 'local')
  const [cloudModels, setCloudModels] = useState<FlatModel[]>([])
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({})
  const containerRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // 动态计算弹出层位置（Portal 渲染到 body）
  const updateDropdownPosition = useCallback(() => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    setDropdownStyle({
      position: 'fixed',
      bottom: window.innerHeight - rect.top + 8,
      left: rect.left,
      width: Math.min(320, rect.width + 60),
      maxHeight: 400,
    })
  }, [])

  useEffect(() => {
    if (!isOpen) {
      setSearchQuery('')
      return
    }

    updateDropdownPosition()

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      const insideTrigger = containerRef.current?.contains(target)
      const insideDropdown = dropdownRef.current?.contains(target)
      if (!insideTrigger && !insideDropdown) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    window.addEventListener('resize', updateDropdownPosition)
    window.addEventListener('scroll', updateDropdownPosition, true)

    const focusTimer = setTimeout(() => {
      if (searchInputRef.current) {
        searchInputRef.current.focus({ preventScroll: true })
      }
    }, 50)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      window.removeEventListener('resize', updateDropdownPosition)
      window.removeEventListener('scroll', updateDropdownPosition, true)
      clearTimeout(focusTimer)
    }
  }, [isOpen, updateDropdownPosition])

  // 打开弹窗时同步 tab 状态
  useEffect(() => {
    if (isOpen) {
      setActiveTab(cloudMode === 'cloud' ? 'cloud' : 'local')
    }
  }, [isOpen, cloudMode])

  // 获取云端模型列表
  const fetchCloudModels = useCallback(() => {
    if (!isAuthenticated) {
      setCloudModels([])
      return
    }

    const sUrl = getServerUrl() || serverUrl
    if (!sUrl) return

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
  }, [isAuthenticated, serverUrl])

  // 弹窗打开时，如果 cloud tab 激活，获取云端模型
  useEffect(() => {
    if (isOpen && activeTab === 'cloud' && isAuthenticated) {
      fetchCloudModels()
    }
  }, [isOpen, activeTab, isAuthenticated, fetchCloudModels])

  // 构建本地模型列表
  const localModels = useMemo<FlatModel[]>(() => {
    const models: FlatModel[] = []
    const seen = new Set<string>()

    for (const [providerId, provider] of Object.entries(BUILTIN_PROVIDERS)) {
      const providerConfig = providerConfigs[providerId]
      if (providerConfig?.enabled !== true) continue
      if (!providerConfig?.apiKey && !llmConfig.apiKey && providerId !== 'ollama') continue

      const customModels = providerConfig?.customModels || []
      const builtinModelIds = new Set(provider.models)
      const modelConfigs = providerConfig?.modelConfigs || {}

      for (const id of provider.models) {
        if (modelConfigs[id]?.enabled !== true) continue
        const key = `${providerId}::${id}`
        if (!seen.has(key)) {
          seen.add(key)
          models.push({ id, name: id.split('/').pop() || id, providerId, providerName: provider.displayName })
        }
      }

      for (const id of customModels) {
        if (modelConfigs[id]?.enabled !== true) continue
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
      if (config?.enabled !== true) continue
      if (!config?.apiKey) continue

      const modelIds = config.customModels || []
      const providerName = config.displayName || providerId
      const modelConfigs = config?.modelConfigs || {}

      for (const id of modelIds) {
        if (modelConfigs[id]?.enabled !== true) continue
        const key = `${providerId}::${id}`
        if (!seen.has(key)) {
          seen.add(key)
          models.push({ id, name: id.split('/').pop() || id, providerId, providerName, isCustom: true })
        }
      }
    }

    return models
  }, [providerConfigs, llmConfig.apiKey])

  // 当前 tab 对应的模型列表
  const allModels = useMemo<FlatModel[]>(() => {
    if (activeTab === 'cloud') {
      return cloudModels
    }
    return localModels
  }, [activeTab, cloudModels, localModels])

  const currentModel = useMemo(() => {
    return allModels.find(m => m.providerId === llmConfig.provider && m.id === llmConfig.model) || allModels[0] || null
  }, [allModels, llmConfig.provider, llmConfig.model])

  // Tab 切换：调用 setCloudMode 同步云端字段
  const handleTabSwitch = useCallback((tab: 'local' | 'cloud') => {
    if (tab === activeTab) return
    setActiveTab(tab)
    setCloudMode(tab)
    setSearchQuery('')
  }, [activeTab, setCloudMode])

  const applyProviderConfig = useCallback((providerId: string, modelId: string) => {
    if (activeTab === 'cloud' && isAuthenticated) {
      update('llmConfig', { provider: providerId, model: modelId })
      save()
      return
    }

    // 本地模式：切换 provider 时恢复对应的 apiKey/baseUrl
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
  }, [llmConfig.provider, llmConfig.timeout, providerConfigs, update, save, activeTab, isAuthenticated])

  const filteredModels = useMemo(() => {
    if (!searchQuery.trim()) return allModels

    const query = searchQuery.toLowerCase()
    return allModels.filter(m =>
      m.name.toLowerCase().includes(query) ||
      m.id.toLowerCase().includes(query) ||
      m.providerName.toLowerCase().includes(query)
    )
  }, [allModels, searchQuery])

  const isCloud = cloudMode === 'cloud' && isAuthenticated

  return (
    <div ref={containerRef} className={`${alignLeft ? '' : 'relative'} flex items-center ${className}`}>
      <button
        onClick={() => !disabled && setIsOpen((prev) => !prev)}
        className={`
          inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium border border-transparent
          transition-all duration-200
          ${disabled
            ? 'opacity-40 cursor-not-allowed'
            : isOpen
              ? 'bg-surface-active text-text-primary shadow-[0_0_0_2px_rgba(var(--accent)/0.15)]'
              : 'bg-white/[0.03] text-text-secondary hover:text-text-primary hover:bg-white/[0.08]'
          }
        `}
      >
        <ProviderIcon providerId={currentModel?.providerId || llmConfig.provider} size={14} className="opacity-80 flex-shrink-0" />
        <span className="truncate max-w-[200px]" title={currentModel?.name || llmConfig.model}>
          {currentModel?.name || llmConfig.model || '选择模型'}
        </span>
        {isCloud && <Cloud className="w-3 h-3 text-accent flex-shrink-0" />}
        <ChevronDown className={`w-3 h-3 text-text-muted transition-transform flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && createPortal(
        <div
          ref={dropdownRef}
          style={dropdownStyle}
          className="flex flex-col bg-surface border border-border min-w-[200px] rounded-xl shadow-2xl z-[9999] animate-scale-in overflow-hidden"
        >
          {/* Tab 切换栏 */}
          <div className="flex items-center gap-1 px-2 pt-2 pb-1 border-b border-border/50 shrink-0">
            <button
              onClick={() => handleTabSwitch('local')}
              className={`
                flex flex-1 items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all
                ${activeTab === 'local'
                  ? 'bg-surface-active text-text-primary'
                  : 'text-text-muted hover:text-text-secondary hover:bg-surface-hover'
                }
              `}
            >
              <Puzzle className="w-3.5 h-3.5" />
              <span>自定义</span>
            </button>
            <button
              onClick={() => handleTabSwitch('cloud')}
              disabled={!isAuthenticated}
              className={`
                flex flex-1 items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all
                ${activeTab === 'cloud'
                  ? 'bg-surface-active text-text-primary'
                  : 'text-text-muted hover:text-text-secondary hover:bg-surface-hover'
                }
                ${!isAuthenticated ? 'opacity-40 cursor-not-allowed' : ''}
              `}
              title={!isAuthenticated ? '请先登录' : undefined}
            >
              <Cloud className="w-3.5 h-3.5" />
              <span>云端</span>
            </button>
          </div>

          {/* 搜索框 */}
          <div className="p-2 border-b border-border/50 sticky top-0 bg-surface/95 backdrop-blur-sm z-10 shrink-0">
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

          {/* 模型列表 */}
          <div className="overflow-y-auto flex-1 p-1 custom-scrollbar">
            {/* 云端未登录提示 */}
            {activeTab === 'cloud' && !isAuthenticated ? (
              <div className="py-6 px-4 text-center">
                <Cloud className="w-6 h-6 text-text-muted/40 mx-auto mb-2" />
                <p className="text-xs text-text-muted">请先登录后使用云端模型</p>
              </div>
            ) : filteredModels.length === 0 ? (
              <div className="py-6 text-center text-xs text-text-muted">
                {activeTab === 'cloud' ? '暂无可用云端模型' : '无相关模型'}
              </div>
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
                      <ProviderIcon providerId={model.providerId} size={14} className="flex-shrink-0 opacity-60" />
                      <span className="truncate" title={model.name}>{model.name}</span>
                      {activeTab === 'cloud' && <Cloud className="w-3 h-3 text-accent flex-shrink-0" />}
                    </span>
                    {isSelected && <Check className="w-3.5 h-3.5 flex-shrink-0 ml-2" />}
                  </button>
                )
              })
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 场景感知模型选择器                                                */
/* ------------------------------------------------------------------ */

import type { ScenarioDomain } from '@configuration/defaultProfile'

/** 场景模型选择策略 */
export interface ScenarioModelSelectPolicy {
  /** 场景类型 */
  domain: ScenarioDomain
  /** 允许的 Provider 列表（空表示全部允许） */
  allowedProviders: string[]
  /** 禁止的 Provider 列表 */
  blockedProviders: string[]
  /** 推荐模型列表 */
  recommendedModels: string[]
  /** 是否显示场景推荐标签 */
  showRecommendationTag: boolean
  /** 是否限制模型选择 */
  restrictModelSelection: boolean
  /** 最大 token 数限制 */
  maxTokensLimit: number
}

/** 场景模型选择策略预设 */
const SCENARIO_MODEL_SELECT_POLICIES: Record<ScenarioDomain, ScenarioModelSelectPolicy> = {
  /** 法律场景：推荐高精度模型，限制 token */
  legal: {
    domain: 'legal',
    allowedProviders: [],
    blockedProviders: [],
    recommendedModels: ['gpt-4o', 'claude-3-5-sonnet', 'gemini-1.5-pro'],
    showRecommendationTag: true,
    restrictModelSelection: false,
    maxTokensLimit: 16384,
  },

  /** 医疗场景：仅允许高精度模型，严格限制 */
  medical: {
    domain: 'medical',
    allowedProviders: ['openai', 'anthropic'],
    blockedProviders: [],
    recommendedModels: ['gpt-4o', 'claude-3-5-sonnet'],
    showRecommendationTag: true,
    restrictModelSelection: true,
    maxTokensLimit: 12288,
  },

  /** 教育场景：允许所有模型，推荐经济型 */
  education: {
    domain: 'education',
    allowedProviders: [],
    blockedProviders: [],
    recommendedModels: ['gpt-4o-mini', 'claude-3-5-haiku', 'gemini-1.5-flash'],
    showRecommendationTag: true,
    restrictModelSelection: false,
    maxTokensLimit: 8192,
  },

  /** 通用场景：无限制 */
  general: {
    domain: 'general',
    allowedProviders: [],
    blockedProviders: [],
    recommendedModels: [],
    showRecommendationTag: false,
    restrictModelSelection: false,
    maxTokensLimit: 0,
  },
}

/**
 * 获取场景模型选择策略
 */
export function getScenarioModelSelectPolicy(
  domain: ScenarioDomain,
): ScenarioModelSelectPolicy {
  return SCENARIO_MODEL_SELECT_POLICIES[domain]
}

/**
 * 过滤场景允许的模型
 */
export function filterModelsByScenario(
  models: FlatModel[],
  domain: ScenarioDomain,
): { allowed: FlatModel[]; blocked: FlatModel[] } {
  const policy = SCENARIO_MODEL_SELECT_POLICIES[domain]

  if (!policy.restrictModelSelection) {
    return { allowed: models, blocked: [] }
  }

  const allowed: FlatModel[] = []
  const blocked: FlatModel[] = []

  for (const model of models) {
    const isAllowed =
      policy.allowedProviders.length === 0 ||
      policy.allowedProviders.includes(model.providerId)
    const isBlocked = policy.blockedProviders.includes(model.providerId)

    if (isAllowed && !isBlocked) {
      allowed.push(model)
    } else {
      blocked.push(model)
    }
  }

  return { allowed, blocked }
}

/**
 * 检查模型是否为场景推荐模型
 */
export function isRecommendedModel(
  modelId: string,
  domain: ScenarioDomain,
): boolean {
  const policy = SCENARIO_MODEL_SELECT_POLICIES[domain]
  return policy.recommendedModels.includes(modelId)
}

/**
 * 获取场景 token 限制
 */
export function getScenarioMaxTokensLimit(
  domain: ScenarioDomain,
  userMaxTokens?: number,
): number | undefined {
  const policy = SCENARIO_MODEL_SELECT_POLICIES[domain]
  if (policy.maxTokensLimit === 0) return userMaxTokens
  if (userMaxTokens === undefined) return policy.maxTokensLimit
  return Math.min(userMaxTokens, policy.maxTokensLimit)
}
