/**
 * Provider 设置组件
 * 
 * 重构后版本：移除 CustomProviderEditor 和 AdapterOverridesEditor 依赖
 * 使用内联表单添加自定义厂商，使用 AI SDK 原生配置
 */

import { memo, useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Plus, Trash, Eye, EyeOff, Check, AlertTriangle, X, Server, Sliders, Box, RefreshCw, Pencil, CloudOff } from 'lucide-react'
import {
  PROVIDERS,
  getBuiltinProviderIds,
  type ApiProtocol,
  type OpenAICompatibilityProfile,
  getProviderDefaultHeaders,
  isOpenAIStyleProtocol,
  resolveOpenAICompatibilityProfile,
} from '@configuration/aiProviders'
import { REASONING_EFFORT_VALUES } from '@configuration/modelPersistence'
import { LLM_DEFAULTS } from '@configuration/defaultProfile'
import { globalDecide as globalConfirm } from '@components/foundation/DecisionOverlay'
import { toast } from '@components/foundation/NotificationProvider'
import { ActionButton, TextField, DropdownSelector, ToggleSwitch } from '@components/ui'
import { ProviderIcon } from '@components/ui/ProviderIcon'
import { ProviderSettingsProps } from '../preferencesTypes'
import { isCustomProvider, type ModelConfig, type ModelGenerationParams } from '@renderer/types/modelProvider'
import { ModelCardGrid } from './ModelCardGrid'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { getTokens } from '@services/backendApi'
import type { CloudProviderModel } from '@store/slices/authSlice'
import { t, type Language } from '@renderer/i18n'

// 内置厂商 ID
const BUILTIN_PROVIDER_IDS = getBuiltinProviderIds()

// 协议类型选项
const PROTOCOL_OPTIONS = [
  { value: 'openai', label: 'OpenAI Compatible' },
  { value: 'openai-responses', label: 'OpenAI Responses API' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'google', label: 'Google (Gemini)' },
  { value: 'custom', label: 'Custom' },
]

type EditableHeader = { key: string; value: string; isCustom?: boolean }

const PREDEFINED_HEADER_OPTIONS = [
  { value: '', label: 'DropdownSelector header' },
  { value: 'X-Request-ID', label: 'X-Request-ID' },
  { value: 'X-Organization', label: 'X-Organization' },
  { value: 'X-Project-ID', label: 'X-Project-ID' },
  { value: 'User-Agent', label: 'User-Agent' },
  { value: 'Content-Type', label: 'Content-Type' },
  { value: 'Accept', label: 'Accept' },
]

const PREDEFINED_HEADER_KEYS = new Set(PREDEFINED_HEADER_OPTIONS.map(option => option.value).filter(Boolean))

type ReasoningEffortValue = typeof REASONING_EFFORT_VALUES[number]

const OPENAI_COMPATIBILITY_PROFILE_OPTIONS: Array<{
  value: OpenAICompatibilityProfile
  label: { en: string; zh: string }
}> = [
    {
      value: 'compatible',
      label: { en: 'Compatible (Safe)', zh: '兼容模式（安全）' },
    },
    {
      value: 'full',
      label: { en: 'Full OpenAI', zh: '完整 OpenAI' },
    },
  ]

function getReasoningEffortOptions(
  provider: string,
  protocol: ApiProtocol | undefined,
  openAICompatibilityProfile: OpenAICompatibilityProfile | undefined,
  language: 'en' | 'zh',
): Array<{ value: ReasoningEffortValue; label: string }> {
  const optionLabels: Record<ReasoningEffortValue, { en: string; zh: string }> = {
    none: { en: 'None', zh: '关闭' },
    minimal: { en: 'Minimal', zh: '极低' },
    low: { en: 'Low', zh: '低' },
    medium: { en: 'Medium', zh: '中' },
    high: { en: 'High', zh: '高' },
    xhigh: { en: 'X-High', zh: '极高' },
  }

  const supportedValues: ReasoningEffortValue[] =
    provider === 'anthropic' || protocol === 'anthropic'
      ? ['low', 'medium', 'high']
      : provider === 'gemini' || protocol === 'google'
        ? ['minimal', 'low', 'medium', 'high']
        : isOpenAIStyleProtocol(protocol) && openAICompatibilityProfile === 'compatible'
          ? ['minimal', 'low', 'medium', 'high']
          : [...REASONING_EFFORT_VALUES]

  return supportedValues.map(value => ({
    value,
    label: optionLabels[value][language],
  }))
}

function getReasoningEffortDescription(
  provider: string,
  protocol: ApiProtocol | undefined,
  openAICompatibilityProfile: OpenAICompatibilityProfile | undefined,
  language: 'en' | 'zh',
): string {
  if (provider === 'anthropic' || protocol === 'anthropic') {
    return t('provider.reasoningEffortAnthropic', language as Language)
  }

  if (provider === 'gemini' || protocol === 'google') {
    return t('provider.reasoningEffortGemini', language as Language)
  }

  if (isOpenAIStyleProtocol(protocol) && openAICompatibilityProfile === 'compatible') {
    return t('provider.reasoningEffortCompatible', language as Language)
  }

  if (isOpenAIStyleProtocol(protocol)) {
    return t('provider.reasoningEffortFull', language as Language)
  }

  return t('provider.reasoningEffortDefault', language as Language)
}

function getOpenAICompatibilityProfileDescription(
  protocol: ApiProtocol | undefined,
  language: 'en' | 'zh',
): string {
  if (protocol === 'openai-responses') {
    return t('provider.compatibilityProfileResponses', language as Language)
  }

  return t('provider.compatibilityProfileDefault', language as Language)
}

function getHeaderSelectOptions(language: 'en' | 'zh') {
  return [
    ...PREDEFINED_HEADER_OPTIONS.map(option => ({
      value: option.value,
      label: option.value ? option.label : t('provider.selectHeader', language as Language),
    })),
    { value: 'X-Custom-Header', label: t('provider.customDot', language as Language) },
  ]
}

function splitCustomHeaders(
  headers: Record<string, string> | undefined,
  defaultHeaders: Record<string, string>,
): EditableHeader[] {
  if (!headers) return []

  return Object.entries(headers)
    .filter(([key]) => !Object.prototype.hasOwnProperty.call(defaultHeaders, key))
    .map(([key, value]) => ({
      key,
      value,
      isCustom: !PREDEFINED_HEADER_KEYS.has(key),
    }))
}

function mergeHeaders(
  defaultHeaders: Record<string, string>,
  customHeaders: EditableHeader[],
): Record<string, string> | undefined {
  const merged: Record<string, string> = { ...defaultHeaders }

  for (const header of customHeaders) {
    if (header.key) {
      merged[header.key] = header.value || ''
    }
  }

  return Object.keys(merged).length > 0 ? merged : undefined
}

function isIncompleteHeaderDraft(header: EditableHeader): boolean {
  return !header.key.trim()
}

function reconcileCustomHeaderDrafts(
  persistedHeaders: Record<string, string> | undefined,
  defaultHeaders: Record<string, string>,
  currentDrafts: EditableHeader[],
  preserveDrafts: boolean,
): EditableHeader[] {
  const syncedHeaders = splitCustomHeaders(persistedHeaders, defaultHeaders)
  if (!preserveDrafts) {
    return syncedHeaders
  }

  const incompleteDrafts = currentDrafts.filter(isIncompleteHeaderDraft)
  return incompleteDrafts.length > 0
    ? [...syncedHeaders, ...incompleteDrafts]
    : syncedHeaders
}

const TestConnectionButton = memo(function TestConnectionButton({ localConfig, language }: { localConfig: any; language: 'en' | 'zh' }) {
  const [testing, setTesting] = useState(false)
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  const handleTest = async () => {
    if (!localConfig.apiKey && localConfig.provider !== 'ollama') {
      setStatus('error')
      setErrorMsg(t('provider.enterApiKeyFirst', language as Language))
      return
    }
    setTesting(true)
    setStatus('idle')
    setErrorMsg('')
    try {
      const { checkProviderHealth } = await import('@services/providerHealthAdapter')
      const result = await checkProviderHealth(localConfig.provider, localConfig.apiKey, localConfig.baseUrl, localConfig.protocol)
      if (result.status === 'healthy') {
        setStatus('success')
        toast.success(t('provider.connectionSuccess', language as Language, { latency: result.latency }))
      } else {
        setStatus('error')
        setErrorMsg(result.error || 'Connection failed')
      }
    } catch (err: any) {
      setStatus('error')
      setErrorMsg(err.message || 'Connection failed')
    } finally {
      setTesting(false)
    }
  }
  return (
    <div className="flex items-center gap-3">
      <ActionButton variant="secondary" size="sm" onClick={handleTest} disabled={testing} className="h-9 px-3 text-xs font-medium">
        {testing ? (
          <span className="flex items-center gap-2">
            <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
            {t('provider.testing', language as Language)}
          </span>
        ) : (
          t('provider.testConnection', language as Language)
        )}
      </ActionButton>
      {status === 'success' && (
        <span className="flex items-center gap-1.5 rounded-md border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-xs font-medium text-emerald-400">
          <Check className="w-3 h-3" />
          {t('provider.connected', language as Language)}
        </span>
      )}
      {status === 'error' && (
        <span className="flex items-center gap-1.5 rounded-md border border-red-400/20 bg-red-400/10 px-2 py-1 text-xs font-medium text-red-400" title={errorMsg}>
          <AlertTriangle className="w-3 h-3" />
          {errorMsg.length > 30 ? errorMsg.slice(0, 30) + '...' : errorMsg}
        </span>
      )}
    </div>
  )
})

const TestModelButton = memo(function TestModelButton({ localConfig, language }: { localConfig: any; language: 'en' | 'zh' }) {
  const [testing, setTesting] = useState(false)

  const handleTest = async () => {
    if (!localConfig.apiKey && localConfig.provider !== 'ollama') {
      toast.error(t('provider.enterApiKeyFirst', language as Language))
      return
    }
    if (!localConfig.model) {
      toast.error(t('provider.selectOrEnterModel', language as Language))
      return
    }

    setTesting(true)
    try {
      const { testModelCall } = await import('@services/providerHealthAdapter')
      const result = await testModelCall(localConfig)

      if (result.success) {
        const message = t('provider.callSuccess', language as Language, { latency: result.latency, content: result.content })
        toast.success(message)
      } else {
        const errorMsg = result.error || 'Test failed'
        toast.error(t('provider.callFailed', language as Language, { error: errorMsg }))
      }
    } catch (err: any) {
      toast.error(err.message || 'Test failed')
    } finally {
      setTesting(false)
    }
  }

  return (
    <ActionButton variant="secondary" size="sm" onClick={handleTest} disabled={testing} className="h-9 px-3 text-xs font-medium">
      {testing ? (
        <span className="flex items-center gap-2">
          <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
          {t('provider.calling', language as Language)}
        </span>
      ) : (
        t('provider.testModelCall', language as Language)
      )}
    </ActionButton>
  )
})

const FetchModelsButton = memo(function FetchModelsButton({
  provider,
  apiKey,
  baseUrl,
  protocol,
  language,
  existingModels = [],
  onModelsFetched,
  onModelRemoved,
  onBatchRemoved
}: {
  provider: string;
  apiKey: string;
  baseUrl?: string;
  protocol?: string;
  language: 'en' | 'zh';
  existingModels?: string[];
  onModelsFetched: (models: string[]) => void;
  onModelRemoved?: (model: string) => void;
  onBatchRemoved?: (models: string[]) => void;
}) {
  const [fetching, setFetching] = useState(false)
  const [showList, setShowList] = useState(false)
  const [fetchedModels, setFetchedModels] = useState<string[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 0 })
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  const handleFetch = async () => {
    if (!apiKey && provider !== 'ollama') {
      toast.error(t('provider.enterApiKeyFirst', language as Language))
      return
    }

    // 计算位置
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      setCoords({
        top: rect.bottom + window.scrollY,
        left: rect.left + window.scrollX,
        width: rect.width
      })
    }

    setFetching(true)
    setSearchQuery('')
    try {
      const { fetchModelsCall } = await import('@services/providerHealthAdapter')
      const result = await fetchModelsCall(provider, apiKey, baseUrl, protocol)
      if (result.success && result.models) {
        setFetchedModels(result.models)
        setShowList(true)
        if (result.models.length === 0) {
          toast.info(t('provider.noModelsFound', language as Language))
        }
      } else {
        toast.error(t('provider.fetchFailed', language as Language, { error: result.error }))
      }
    } catch (err: any) {
      toast.error(err.message || 'Fetch failed')
    } finally {
      setFetching(false)
    }
  }

  // 点击外部关闭列表
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        // 还要检查是否点击了 portal 里的内容
        const portal = document.getElementById('fetch-models-portal')
        if (portal && portal.contains(event.target as Node)) return
        setShowList(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // 监听滚动和调整大小以更新位置
  useEffect(() => {
    if (!showList) return

    const updateCoords = () => {
      if (buttonRef.current) {
        const rect = buttonRef.current.getBoundingClientRect()
        setCoords({
          top: rect.bottom + window.scrollY,
          left: rect.left + window.scrollX,
          width: rect.width
        })
      }
    }

    window.addEventListener('scroll', updateCoords, true)
    window.addEventListener('resize', updateCoords)
    return () => {
      window.removeEventListener('scroll', updateCoords, true)
      window.removeEventListener('resize', updateCoords)
    }
  }, [showList])

  // 搜索过滤
  const filteredModels = searchQuery
    ? fetchedModels.filter(m => m.toLowerCase().includes(searchQuery.toLowerCase()))
    : fetchedModels

  const dropdownMenu = showList && fetchedModels.length > 0 && createPortal(
    <div
      id="fetch-models-portal"
      className="fixed z-[9999] mt-2 w-72 overflow-hidden bg-surface border border-border rounded-xl shadow-2xl animate-in fade-in zoom-in duration-200 flex flex-col"
      style={{
        top: coords.top,
        left: Math.max(10, coords.left + coords.width - 288),
        maxHeight: Math.min(384, window.innerHeight - coords.top - 24), // 动态计算：视口底部留 24px 安全边距
      }}
    >
      {/* 搜索和统计 */}
      <div className="p-2 border-b border-border bg-background/50 flex-shrink-0 space-y-1.5">
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder={t('provider.searchModels', language as Language)}
          className="w-full px-2.5 py-1.5 text-xs bg-surface/50 border border-border rounded-lg outline-none focus:border-accent/50 transition-colors text-text-primary placeholder:text-text-muted"
          autoFocus
        />
        <div className="flex items-center justify-between px-1">
          <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider">
            {searchQuery
              ? (t('provider.matchedCount', language as Language, { matched: filteredModels.length, total: fetchedModels.length }))
              : (t('provider.totalModels', language as Language, { count: fetchedModels.length }))
            }
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                const toAdd = filteredModels.filter(m => !existingModels.includes(m))
                if (toAdd.length > 0) onModelsFetched(toAdd)
              }}
              className="text-[10px] text-accent hover:text-accent-hover px-1.5 py-0.5 rounded hover:bg-accent/10 transition-colors"
            >
              {t('provider.selectAll', language as Language)}
            </button>
            <button
              onClick={() => {
                const toRemove = filteredModels.filter(m => existingModels.includes(m))
                if (toRemove.length > 0) onBatchRemoved?.(toRemove)
              }}
              className="text-[10px] text-red-400 hover:text-red-300 px-1.5 py-0.5 rounded hover:bg-red-400/10 transition-colors"
            >
              {t('provider.selectNone', language as Language)}
            </button>
          </div>
        </div>
      </div>
      <div className="overflow-y-auto flex-1 p-1 custom-scrollbar">
        {filteredModels.map(model => {
          const isAdded = existingModels.includes(model)
          return (
            <button
              key={model}
              onClick={() => {
                if (isAdded) {
                  onModelRemoved?.(model)
                } else {
                  onModelsFetched([model])
                }
              }}
              className={`w-full text-left px-3 py-1.5 text-[12px] rounded-lg transition-all flex items-center justify-between group mb-0.5 ${isAdded
                ? 'text-accent bg-accent/5 hover:bg-accent/10'
                : 'text-text-secondary hover:text-accent hover:bg-accent/5 active:scale-[0.98]'
                }`}
            >
              <span className="truncate mr-2 flex-1">{model}</span>
              {isAdded ? (
                <Check className="w-3 h-3" />
              ) : (
                <Plus className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity text-accent" />
              )}
            </button>
          )
        })}
      </div>
      <div className="p-1.5 border-t border-border bg-background/50 flex-shrink-0 flex gap-2">
        <button
          onClick={() => {
            const addedModels = fetchedModels.filter(m => existingModels.includes(m))
            if (addedModels.length > 0) {
              onBatchRemoved?.(addedModels)
            }
            setShowList(false)
          }}
          className="flex-1 py-1.5 text-[11px] font-bold text-text-muted hover:text-red-400 hover:bg-red-400/5 rounded-lg transition-colors uppercase flex items-center justify-center gap-1.5 border border-transparent hover:border-red-400/20"
        >
          <Trash className="w-3 h-3" />
          {t('provider.clearAll', language as Language)}
        </button>
        <button
          onClick={() => {
            const toAdd = fetchedModels.filter(m => !existingModels.includes(m))
            if (toAdd.length > 0) {
              onModelsFetched(toAdd)
            }
            setShowList(false)
          }}
          className="flex-1 py-1.5 text-[11px] font-bold bg-accent text-white hover:bg-accent-hover rounded-lg transition-colors uppercase flex items-center justify-center gap-1.5 shadow-lg shadow-accent/20"
        >
          <Check className="w-3 h-3" />
          {t('provider.addAll', language as Language)}
        </button>
      </div>
    </div>,
    document.body
  )

  return (
    <div className="relative inline-block" ref={containerRef}>
      <ActionButton
        ref={buttonRef}
        variant="secondary"
        size="sm"
        onClick={handleFetch}
        disabled={fetching}
        className="h-8 px-2.5 flex items-center gap-1.5"
        title={t('provider.fetchModelsTip', language as Language)}
      >
        <RefreshCw className={`w-3 h-3 ${fetching ? 'animate-spin' : ''}`} />
        <span className="text-[11px] font-semibold">{t('provider.fetchModels', language as Language)}</span>
      </ActionButton>

      {dropdownMenu}
    </div>
  )
})

function AddProviderDialog({
  language,
  onSave,
  onCancel
}: {
  language: 'en' | 'zh'
  onSave: (config: { displayName: string; baseUrl: string; apiKey: string; protocol: string; model: string; customModels: string[] }) => void
  onCancel: () => void
}) {
  const [displayName, setDisplayName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [protocol, setProtocol] = useState('openai')
  const [model, setModel] = useState('')
  const [customModels, setCustomModels] = useState<string[]>([])

  const handleSubmit = () => {
    if (!displayName.trim() || !baseUrl.trim()) {
      toast.error(t('provider.pleaseEnterNameAndEndpoint', language as Language))
      return
    }
    onSave({
      displayName: displayName.trim(),
      baseUrl: baseUrl.trim(),
      apiKey,
      protocol,
      model: model.trim() || customModels[0] || '',
      customModels: [...new Set([...customModels, ...(model ? [model] : [])])]
    })
  }

  const handleFetchModels = (models: string[]) => {
    const newModels = models.filter(m => !customModels.includes(m))
    if (newModels.length > 0) {
      setCustomModels([...customModels, ...newModels])
      if (!model && newModels.length > 0) {
        setModel(newModels[0])
      }
      toast.success(t('provider.fetchedAndAdded', language as Language, { count: newModels.length }))
    }
  }

  const handleBatchRemoveModels = (models: string[]) => {
    const remaining = customModels.filter(m => !models.includes(m))
    setCustomModels(remaining)
    if (models.includes(model)) {
      setModel(remaining[0] || '')
    }
    toast.success(t('provider.clearedModels', language as Language, { count: models.length }))
  }

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-surface border border-border/50 rounded-2xl shadow-2xl w-[560px] max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/30">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 bg-accent/10 rounded-md text-accent">
              <Plus className="w-3.5 h-3.5" />
            </div>
            <h3 className="text-sm font-semibold text-text-primary">
              {t('provider.addProviderTitle', language as Language)}
            </h3>
          </div>
          <button onClick={onCancel} className="p-1 rounded-md hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-text-secondary">
                {t('provider.displayName', language as Language)}
              </label>
              <TextField
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={t('provider.displayNamePlaceholder', language as Language)}
                className="bg-background/50 border-border text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-text-secondary">
                {t('provider.protocolType', language as Language)}
              </label>
              <DropdownSelector
                value={protocol}
                onChange={setProtocol}
                options={PROTOCOL_OPTIONS}
                className="bg-background/50 border-border"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-text-secondary">
              {t('provider.apiEndpointLabel', language as Language)}
            </label>
            <TextField
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.example.com/v1"
              className="bg-background/50 border-border font-mono text-xs"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-text-secondary">API Key</label>
              <TextField
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
                className="bg-background/50 border-border font-mono text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-text-secondary">
                  {t('provider.defaultModelLabel', language as Language)}
                </label>
                <FetchModelsButton
                  provider="custom"
                  apiKey={apiKey}
                  baseUrl={baseUrl}
                  protocol={protocol}
                  language={language}
                  existingModels={customModels}
                  onModelsFetched={handleFetchModels}
                  onModelRemoved={(m) => setCustomModels(customModels.filter(x => x !== m))}
                  onBatchRemoved={handleBatchRemoveModels}
                />
              </div>
              <TextField
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={t('provider.defaultModelPlaceholder', language as Language)}
                className="bg-background/50 border-border text-xs"
              />
            </div>
          </div>

          {customModels.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-text-secondary">
                {t('provider.addedModelsCount', language as Language, { count: customModels.length })}
              </label>
              <div className="flex flex-wrap gap-2 max-h-24 overflow-y-auto p-2 bg-background/30 rounded-xl border border-border/50 custom-scrollbar">
                {customModels.map(m => (
                  <div key={m} className="group flex items-center gap-1.5 px-2 py-1 bg-surface/50 rounded-md border border-border text-xs text-text-secondary hover:border-accent/30 transition-all">
                    <span className="truncate max-w-[150px]">{m}</span>
                    <button
                      onClick={() => setCustomModels(customModels.filter(x => x !== m))}
                      className="text-text-muted hover:text-red-400 opacity-50 group-hover:opacity-100 transition-all"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-border/30">
          <ActionButton variant="secondary" size="sm" onClick={onCancel} className="text-xs h-8 px-4">
            {t('provider.cancelEdit', language as Language)}
          </ActionButton>
          <ActionButton variant="primary" size="sm" onClick={handleSubmit} className="text-xs h-8 px-4">
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            {t('provider.add', language as Language)}
          </ActionButton>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export function ModelProviderPanel({
  localConfig,
  setLocalConfig,
  localProviderConfigs,
  setLocalProviderConfigs,
  showApiKey,
  setShowApiKey,
  selectedProvider,
  providers,
  language,
}: ProviderSettingsProps) {
  const [newModelName, setNewModelName] = useState('')
  const [isAddingCustom, setIsAddingCustom] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [logitBiasString, setLogitBiasString] = useState('')
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null)
  const [editingProviderName, setEditingProviderName] = useState('')
  const previousProviderRef = useRef(localConfig.provider)

  const {
    cloudMode,
    isAuthenticated,
    cloudModels,
    serverUrl,
    setCloudMode,
    fetchCloudModels,
  } = useStore(
    useShallow((s) => ({
      cloudMode: s.cloudMode,
      isAuthenticated: s.isAuthenticated,
      cloudModels: s.cloudModels,
      serverUrl: s.serverUrl,
      setCloudMode: s.setCloudMode,
      fetchCloudModels: s.fetchCloudModels,
    })),
  )

  const isCloudMode = cloudMode === 'cloud'

  useEffect(() => {
    if (isCloudMode && isAuthenticated) {
      fetchCloudModels().catch(() => {})
    }
  }, [isCloudMode, isAuthenticated])

  const handleModeChange = useCallback(
    (mode: 'local' | 'cloud') => {
      // 切换模式时同步更新 localConfig 的云端字段
      // setCloudMode 已更新 store.llmConfig，这里同步 localConfig 防止 handleSave 覆盖
      if (mode === 'cloud') {
        const tokens = getTokens()
        setLocalConfig({
          ...localConfig,
          cloudMode: true as any,
          serverUrl,
          accessToken: tokens?.accessToken,
          refreshToken: tokens?.refreshToken,
        })
      } else {
        setLocalConfig({
          ...localConfig,
          cloudMode: false as any,
          serverUrl: undefined,
          accessToken: undefined,
          refreshToken: undefined,
        })
      }
      setCloudMode(mode)
      if (mode === 'cloud' && isAuthenticated) {
        fetchCloudModels().catch(() => {})
      }
    },
    [setCloudMode, isAuthenticated, fetchCloudModels, localConfig, setLocalConfig, serverUrl],
  )

  const handleSelectCloudProvider = useCallback(
    (cloudProvider: CloudProviderModel) => {
      const providerName = cloudProvider.provider.toLowerCase()
      const firstModel = cloudProvider.models[0] || ''
      setLocalConfig({
        ...localConfig,
        provider: providerName,
        model: firstModel,
        baseUrl: cloudProvider.baseUrl || localConfig.baseUrl,
      })
    },
    [localConfig, setLocalConfig],
  )

  const cloudProviderOptions = useMemo(() => {
    if (!cloudModels || cloudModels.length === 0) return []
    return cloudModels.map((cp) => ({
      id: cp.provider.toLowerCase(),
      name: cp.displayName || cp.provider.charAt(0) + cp.provider.slice(1).toLowerCase(),
      models: cp.models,
      baseUrl: cp.baseUrl,
      logo: cp.logo,
    }))
  }, [cloudModels])

  const cloudModelOptions = useMemo(() => {
    const currentProvider = (localConfig.provider || '').toUpperCase()
    const found = cloudModels?.find((cp) => cp.provider === currentProvider || (localConfig.provider && cp.provider.toLowerCase() === localConfig.provider))
    if (!found) return []
    return found.models.map((m) => ({ value: m, label: m }))
  }, [cloudModels, localConfig.provider])

  // Headers 状态
  const [customHeaders, setCustomHeaders] = useState<EditableHeader[]>([])

  // 从 localProviderConfigs 获取自定义厂商列表
  const customProviders = useMemo(() => {
    return Object.entries(localProviderConfigs)
      .filter(([id]) => isCustomProvider(id))
      .map(([id, config]) => ({ id, config }))
  }, [localProviderConfigs])

  // 当前选中的是自定义 Provider 吗？
  const isCustomSelected = isCustomProvider(localConfig.provider)
  const selectedCustomConfig = isCustomSelected ? localProviderConfigs[localConfig.provider] : null
  const selectedProviderProtocol = (selectedProvider as { protocol?: ApiProtocol } | undefined)?.protocol

  const currentProtocol = useMemo<ApiProtocol | undefined>(() => {
    return localConfig.protocol
      ?? selectedCustomConfig?.protocol
      ?? selectedProviderProtocol
  }, [localConfig.protocol, selectedCustomConfig?.protocol, selectedProviderProtocol])

  const currentOpenAICompatibilityProfile = useMemo(
    () => resolveOpenAICompatibilityProfile(
      localConfig.provider,
      currentProtocol,
      localConfig.openAICompatibilityProfile ?? selectedCustomConfig?.openAICompatibilityProfile,
    ),
    [
      currentProtocol,
      localConfig.openAICompatibilityProfile,
      localConfig.provider,
      selectedCustomConfig?.openAICompatibilityProfile,
    ],
  )

  const defaultHeaders = useMemo(
    () => getProviderDefaultHeaders(localConfig.provider, currentProtocol),
    [localConfig.provider, currentProtocol],
  )

  const reasoningEffortOptions = useMemo(
    () => getReasoningEffortOptions(
      localConfig.provider,
      currentProtocol,
      currentOpenAICompatibilityProfile,
      language,
    ),
    [currentOpenAICompatibilityProfile, currentProtocol, language, localConfig.provider],
  )

  const reasoningEffortDescription = useMemo(
    () => getReasoningEffortDescription(
      localConfig.provider,
      currentProtocol,
      currentOpenAICompatibilityProfile,
      language,
    ),
    [currentOpenAICompatibilityProfile, currentProtocol, language, localConfig.provider],
  )

  const openAICompatibilityProfileOptions = useMemo(
    () => OPENAI_COMPATIBILITY_PROFILE_OPTIONS.map(option => ({
      value: option.value,
      label: option.label[language],
    })),
    [language],
  )

  const openAICompatibilityProfileDescription = useMemo(
    () => getOpenAICompatibilityProfileDescription(currentProtocol, language),
    [currentProtocol, language],
  )

  const selectedReasoningEffort = useMemo(() => {
    const currentValue = localConfig.reasoningEffort ?? 'medium'
    const preferredFallback = reasoningEffortOptions.find(option => option.value === 'medium')?.value
      ?? reasoningEffortOptions[0]?.value

    return reasoningEffortOptions.some(option => option.value === currentValue)
      ? currentValue
      : preferredFallback ?? 'medium'
  }, [localConfig.reasoningEffort, reasoningEffortOptions])

  const headerSelectOptions = useMemo(
    () => getHeaderSelectOptions(language),
    [language],
  )

  const startEditingCustomProvider = (id: string, displayName: string) => {
    setEditingProviderId(id)
    setEditingProviderName(displayName)
  }

  const cancelEditingCustomProvider = () => {
    setEditingProviderId(null)
    setEditingProviderName('')
  }

  const saveEditingCustomProvider = () => {
    const nextName = editingProviderName.trim()
    if (!editingProviderId || !nextName) return

    setLocalProviderConfigs({
      ...localProviderConfigs,
      [editingProviderId]: {
        ...localProviderConfigs[editingProviderId],
        displayName: nextName,
        updatedAt: Date.now(),
      },
    })

    cancelEditingCustomProvider()
  }

  const syncCustomHeaders = useCallback((nextHeaders: EditableHeader[]) => {
    setCustomHeaders(nextHeaders)
    setLocalConfig({
      ...localConfig,
      headers: mergeHeaders(defaultHeaders, nextHeaders),
    })
  }, [defaultHeaders, localConfig, setLocalConfig])

  // Sync logitBiasString with localConfig
  useEffect(() => {
    setLogitBiasString(localConfig.logitBias ? JSON.stringify(localConfig.logitBias, null, 2) : '')
  }, [localConfig.logitBias])

  // 不再使用 useEffect 同步，而是在初始化时设置
  // customHeaders 只用于额外的请求头，不包括默认请求头
  useEffect(() => {
    const preserveDrafts = previousProviderRef.current === localConfig.provider

    // 每次切换 provider 或者 config.headers 被外部重新加载时，我们需要恢复 customHeaders UI 状态。
    // 未完成的自定义 header 草稿只保留在本地 UI，不写入持久化 headers。
    setCustomHeaders(currentDrafts =>
      reconcileCustomHeaderDrafts(
        localConfig.headers,
        defaultHeaders,
        currentDrafts,
        preserveDrafts,
      ),
    )

    previousProviderRef.current = localConfig.provider
  }, [defaultHeaders, localConfig.headers, localConfig.provider])

  // 添加模型到本地配置
  const handleAddModel = (name?: string) => {
    const modelName = name || newModelName
    if (!modelName.trim()) return

    const namesToAdd = modelName.split(',').map(s => s.trim()).filter(Boolean)
    handleBatchAddModels(namesToAdd)
    if (!name) setNewModelName('')
  }

  // 批量添加模型
  const handleBatchAddModels = useCallback((models: string[]) => {
    if (models.length === 0) return

    const currentConfig = localProviderConfigs[localConfig.provider] || {}
    const currentModels = currentConfig.customModels || []

    // 过滤掉已存在的
    const newModels = models.filter(n => !currentModels.includes(n))
    if (newModels.length === 0) return

    const updatedConfigs = {
      ...localProviderConfigs,
      [localConfig.provider]: {
        ...currentConfig,
        customModels: [...currentModels, ...newModels]
      }
    }

    setLocalProviderConfigs(updatedConfigs)

    toast.success(t('provider.addedModels', language as Language, { count: newModels.length }))
  }, [language, localConfig.provider, localProviderConfigs, setLocalProviderConfigs])

  // 删除模型从本地配置
  const handleRemoveModel = async (model: string) => {
    const confirmed = await globalConfirm({
      title: t('provider.removedModel', language as Language, { name: model }),
      message: t('provider.deleteProviderMessage', language as Language, { name: model }),
      variant: 'danger',
    })
    if (!confirmed) return
    handleBatchRemoveModels([model])
  }

  // 批量删除模型
  const handleBatchRemoveModels = useCallback((models: string[]) => {
    const currentConfig = localProviderConfigs[localConfig.provider]
    if (!currentConfig) return

    const updatedModelConfigs = { ...(currentConfig.modelConfigs || {}) }
    for (const m of models) {
      delete updatedModelConfigs[m]
    }

    const updatedConfigs = {
      ...localProviderConfigs,
      [localConfig.provider]: {
        ...currentConfig,
        customModels: (currentConfig.customModels || []).filter(m => !models.includes(m)),
        modelConfigs: updatedModelConfigs,
      }
    }

    setLocalProviderConfigs(updatedConfigs)

    if (models.includes(localConfig.model || '')) {
      const remaining = (currentConfig.customModels || []).filter(m => !models.includes(m))
      setLocalConfig({
        ...localConfig,
        model: remaining.length > 0 ? remaining[0] : '',
      })
    }

    if (models.length === 1) {
      toast.success(t('provider.removedModel', language as Language, { name: models[0] }))
    } else {
      toast.success(t('provider.clearedModels', language as Language, { count: models.length }))
    }
  }, [language, localConfig.model, localConfig.provider, localProviderConfigs, setLocalConfig, setLocalProviderConfigs])

  const handleUpdateModelConfig = useCallback((model: string, config: ModelConfig) => {
    const currentConfig = localProviderConfigs[localConfig.provider]
    if (!currentConfig) return

    const updatedConfigs = {
      ...localProviderConfigs,
      [localConfig.provider]: {
        ...currentConfig,
        modelConfigs: {
          ...(currentConfig.modelConfigs || {}),
          [model]: config,
        },
      },
    }

    setLocalProviderConfigs(updatedConfigs)
  }, [localConfig.provider, localProviderConfigs, setLocalProviderConfigs])

  const providerGenerationParams = useMemo((): Partial<ModelGenerationParams> => {
    return {
      maxTokens: localConfig.maxTokens ?? LLM_DEFAULTS.maxTokens,
      temperature: localConfig.temperature ?? LLM_DEFAULTS.temperature,
      topP: localConfig.topP ?? LLM_DEFAULTS.topP,
      topK: localConfig.topK,
      frequencyPenalty: localConfig.frequencyPenalty,
      presencePenalty: localConfig.presencePenalty,
      stopSequences: localConfig.stopSequences,
      seed: localConfig.seed,
      logitBias: localConfig.logitBias,
      enableThinking: localConfig.enableThinking,
      thinkingBudget: localConfig.thinkingBudget,
      reasoningEffort: localConfig.reasoningEffort,
      maxRetries: localConfig.maxRetries,
      toolChoice: (typeof localConfig.toolChoice === 'string' ? localConfig.toolChoice : undefined) as 'auto' | 'none' | 'required' | undefined,
      parallelToolCalls: localConfig.parallelToolCalls,
    }
  }, [localConfig])

  // 选择内置 Provider
  const handleSelectBuiltinProvider = (providerId: string, skipSaveCurrent = false) => {
    // 保存当前配置（仅当当前 provider 未被删除时）
    let updatedConfigs = localProviderConfigs
    if (!skipSaveCurrent && (localProviderConfigs[localConfig.provider] || BUILTIN_PROVIDER_IDS.includes(localConfig.provider))) {
      updatedConfigs = {
        ...localProviderConfigs,
        [localConfig.provider]: {
          ...localProviderConfigs[localConfig.provider],
          displayName: localProviderConfigs[localConfig.provider]?.displayName,
          apiKey: localConfig.apiKey,
          baseUrl: localConfig.baseUrl,
          timeout: localConfig.timeout,
          model: localConfig.model,
          headers: localConfig.headers,
          openAICompatibilityProfile: localConfig.openAICompatibilityProfile,
          protocol: localConfig.protocol,
        },
      }
      setLocalProviderConfigs(updatedConfigs)
    }

    // 加载新 Provider 配置
    const nextConfig = updatedConfigs[providerId] || {}
    const providerInfo = PROVIDERS[providerId]
    setLocalConfig({
      ...localConfig,
      provider: providerId,
      apiKey: nextConfig.apiKey || '',
      baseUrl: nextConfig.baseUrl || providerInfo?.baseUrl || '',
      timeout: nextConfig.timeout || providerInfo?.defaults.timeout || 120000,
      model: nextConfig.model || providerInfo?.models[0] || '',
      headers: nextConfig.headers || {},
      openAICompatibilityProfile: resolveOpenAICompatibilityProfile(
        providerId,
        nextConfig.protocol || providerInfo?.protocol,
        nextConfig.openAICompatibilityProfile,
      ),
      protocol: nextConfig.protocol || providerInfo?.protocol || 'openai',
    })
    setIsAddingCustom(false)
  }

  // 选择自定义 Provider
  const handleSelectCustomProvider = (id: string) => {
    // 保存当前配置（包括 headers）
    const updatedConfigs = {
      ...localProviderConfigs,
      [localConfig.provider]: {
        ...localProviderConfigs[localConfig.provider],
        displayName: localProviderConfigs[localConfig.provider]?.displayName,
        apiKey: localConfig.apiKey,
        baseUrl: localConfig.baseUrl,
        timeout: localConfig.timeout,
        model: localConfig.model,
        headers: localConfig.headers,
        openAICompatibilityProfile: localConfig.openAICompatibilityProfile,
        protocol: localConfig.protocol,
      },
    }
    setLocalProviderConfigs(updatedConfigs)

    // 获取自定义厂商配置（从更新后的配置中获取）
    const customConfig = updatedConfigs[id] || {}
    const models = customConfig.customModels || []

    setLocalConfig({
      ...localConfig,
      provider: id,
      apiKey: customConfig.apiKey || '',
      baseUrl: customConfig.baseUrl || '',
      timeout: customConfig.timeout || 120000,
      model: customConfig.model || models[0] || '',
      headers: customConfig.headers || {},
      openAICompatibilityProfile: resolveOpenAICompatibilityProfile(
        id,
        customConfig.protocol,
        customConfig.openAICompatibilityProfile,
      ),
      protocol: customConfig.protocol || 'openai',
    })
    setIsAddingCustom(false)
  }

  // 添加自定义 Provider（只更新本地状态）
  const handleAddCustomProvider = (config: { displayName: string; baseUrl: string; apiKey: string; protocol: string; model: string; customModels: string[] }) => {
    const id = `custom-${Date.now()}`
    const newConfig = {
      displayName: config.displayName,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      protocol: config.protocol as ApiProtocol,
      model: config.model,
      openAICompatibilityProfile: resolveOpenAICompatibilityProfile(
        id,
        config.protocol as ApiProtocol,
      ),
      customModels: config.customModels || (config.model ? [config.model] : []),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    // 只更新本地状态，保存时由 PreferencesDialog 统一处理
    setLocalProviderConfigs({
      ...localProviderConfigs,
      [id]: newConfig
    })

    toast.success(t('provider.providerAdded', language as Language, { name: config.displayName }))
    setIsAddingCustom(false)

    // 自动选择新添加的 Provider
    setLocalConfig({
      ...localConfig,
      provider: id,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      timeout: 120000,
      openAICompatibilityProfile: resolveOpenAICompatibilityProfile(
        id,
        config.protocol as ApiProtocol,
      ),
      model: config.model,
      protocol: config.protocol as ApiProtocol, // 增加协议同步
    })
  }

  // 删除自定义 Provider（只更新本地状态）
  const handleDeleteCustomProvider = async (e: React.MouseEvent, id: string, name: string) => {
    e.stopPropagation()
    const confirmed = await globalConfirm({
      title: t('provider.deleteProviderTitle', language as Language),
      message: t('provider.deleteProviderMessage', language as Language, { name: name }),
      variant: 'danger',
    })
    if (confirmed) {
      // 如果当前选中的是被删除的 provider，先切换到默认（跳过保存当前配置）
      if (localConfig.provider === id) {
        handleSelectBuiltinProvider('openai', true)
      }

      // 从本地配置中删除（放在切换之后，确保不会被重新创建）
      const { [id]: _removed, ...rest } = localProviderConfigs
      void _removed
      setLocalProviderConfigs(rest)
    }
  }

  const builtinProviders = useMemo(
    () => providers.filter((p) => BUILTIN_PROVIDER_IDS.includes(p.id)),
    [providers],
  )
  const availableModels = useMemo(() => {
    const modelsSet = new Set<string>()

    const localCustomModels = localProviderConfigs[localConfig.provider]?.customModels || []
    localCustomModels.forEach((model: string) => modelsSet.add(model))

    if (localConfig.model) {
      modelsSet.add(localConfig.model)
    }

    return Array.from(modelsSet)
  }, [localConfig.model, localConfig.provider, localProviderConfigs])

  return (
    <div className="flex gap-5 animate-fade-in h-[calc(100vh-180px)]">
      {/* 左侧边栏：运行模式 + 服务商 */}
      <div className="w-52 flex-shrink-0 space-y-3 pr-4 border-r border-border/30 overflow-y-auto custom-scrollbar">
        {/* 运行模式 */}
        <div className="space-y-2">
          <h4 className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
            {t('provider.mode', language as Language)}
          </h4>
          <div className="flex rounded-lg border border-border/50 bg-surface/20 p-0.5">
            <button
              onClick={() => handleModeChange('cloud')}
              className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                isCloudMode
                  ? 'bg-accent text-white shadow-sm'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {t('provider.cloud', language as Language)}
            </button>
            <button
              onClick={() => handleModeChange('local')}
              className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                !isCloudMode
                  ? 'bg-accent text-white shadow-sm'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {t('provider.custom', language as Language)}
            </button>
          </div>
          {isCloudMode && !isAuthenticated && (
            <div className="flex items-center gap-1.5 p-2 rounded-md bg-accent/5 border border-accent/20 text-[10px] text-text-secondary">
              <CloudOff className="w-3 h-3 shrink-0 text-accent/60" />
              <span>{t('provider.loginRequired', language as Language)}</span>
            </div>
          )}
        </div>

        <div className="border-t border-border/30" />

      {/* 服务商列表 */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <h4 className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
            {isCloudMode
              ? t('provider.cloudProviders', language as Language)
              : t('provider.providers', language as Language)}
          </h4>
        </div>

        <div className="space-y-0.5 max-h-[calc(100vh-380px)] overflow-y-auto custom-scrollbar -mx-1 px-1">
          {isCloudMode ? (
            cloudProviderOptions.length === 0 ? (
              <div className="text-center py-4 text-text-muted text-[10px]">
                {isAuthenticated
                  ? t('provider.noAvailableProviders', language as Language)
                  : t('provider.pleaseLogin', language as Language)}
              </div>
            ) : (
              cloudProviderOptions.map((cp) => (
                <button
                  key={cp.id}
                  onClick={() => handleSelectCloudProvider({ provider: cp.id.toUpperCase(), models: cp.models, baseUrl: cp.baseUrl })}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left text-xs transition-all ${
                    localConfig.provider === cp.id || localConfig.provider === cp.id.toUpperCase()
                      ? 'bg-accent/10 text-accent border border-accent/20'
                      : 'hover:bg-surface/30 text-text-secondary border border-transparent'
                  }`}
                >
                  <ProviderIcon providerId={cp.id} size={18} className="flex-shrink-0" />
                  <span className="font-medium truncate flex-1">{cp.name}</span>
                  <span className="text-[10px] text-text-muted">{cp.models.length}</span>
                  {(localConfig.provider === cp.id || localConfig.provider === cp.id.toUpperCase()) && (
                    <Check className="w-3 h-3 flex-shrink-0" strokeWidth={3} />
                  )}
                </button>
              ))
            )
          ) : (
            <>
              {builtinProviders.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleSelectBuiltinProvider(p.id)}
                  className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left text-xs transition-all ${
                    localConfig.provider === p.id
                      ? 'bg-accent/10 text-accent border border-accent/20'
                      : 'hover:bg-surface/30 text-text-secondary border border-transparent'
                  } ${localProviderConfigs[p.id]?.enabled !== true ? 'opacity-50' : ''}`}
                >
                  <ProviderIcon providerId={p.id} size={16} className="flex-shrink-0" />
                  <span className="font-medium truncate flex-1">{p.name}</span>
                  {localProviderConfigs[p.id]?.enabled !== true && (
                    <span className="text-[9px] text-text-muted bg-surface-active/50 px-1.5 py-0.5 rounded">
                      {t('provider.providerDisabled', language as Language)}
                    </span>
                  )}
                  {localConfig.provider === p.id && (
                    <Check className="w-3 h-3 flex-shrink-0" strokeWidth={3} />
                  )}
                </button>
              ))}

              {customProviders.map(({ id, config }) => {
                const displayName = config.displayName || id
                const isEditing = editingProviderId === id
                return (
                  <div
                    key={id}
                    onClick={() => handleSelectCustomProvider(id)}
                    className={`group relative w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left text-xs cursor-pointer transition-all ${
                      localConfig.provider === id
                        ? 'bg-accent/10 text-accent border border-accent/20'
                        : 'hover:bg-surface/30 text-text-secondary border border-transparent'
                    } ${config.enabled !== true ? 'opacity-50' : ''}`}
                  >
                    {isEditing ? (
                      <>
                        <ProviderIcon providerId={id} size={16} className="flex-shrink-0" />
                        <input
                          value={editingProviderName}
                          onChange={(e) => setEditingProviderName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); saveEditingCustomProvider() }
                            if (e.key === 'Escape') { e.preventDefault(); cancelEditingCustomProvider() }
                          }}
                          autoFocus
                          className="flex-1 bg-transparent text-xs font-medium outline-none text-text-primary placeholder:text-text-muted/85 min-w-0"
                          placeholder="Name"
                        />
                        <div className="flex items-center gap-0.5 flex-shrink-0">
                          <button
                            onClick={(e) => { e.stopPropagation(); saveEditingCustomProvider() }}
                            disabled={!editingProviderName.trim()}
                            className="p-0.5 rounded hover:bg-accent/10 text-accent disabled:opacity-40"
                          >
                            <Check className="w-3 h-3" strokeWidth={3} />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); cancelEditingCustomProvider() }}
                            className="p-0.5 rounded hover:bg-red-500/10 text-text-muted hover:text-red-500"
                          >
                            <X className="w-3 h-3" strokeWidth={3} />
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <ProviderIcon providerId={id} size={16} className="flex-shrink-0" />
                        <span className="font-medium truncate flex-1">{displayName}</span>
                        {config.enabled !== true && (
                          <span className="text-[9px] text-text-muted bg-surface-active/50 px-1.5 py-0.5 rounded">
                            {t('provider.providerDisabled', language as Language)}
                          </span>
                        )}
                        {localConfig.provider === id && (
                          <Check className="w-3 h-3 flex-shrink-0" strokeWidth={3} />
                        )}
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                          <button
                            onClick={(e) => { e.stopPropagation(); startEditingCustomProvider(id, displayName) }}
                            className="p-0.5 rounded hover:bg-accent/10 text-text-muted hover:text-accent"
                            title={t('provider.rename', language as Language)}
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                          <button
                            onClick={(e) => handleDeleteCustomProvider(e, id, displayName)}
                            className="p-0.5 rounded hover:bg-red-500/10 text-text-muted hover:text-red-500"
                            title={t('provider.deleteProvider', language as Language)}
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )
              })}
            </>
          )}
        </div>
        {!isCloudMode && (
          <button
            onClick={() => setIsAddingCustom(true)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-accent hover:bg-accent/10 border border-dashed border-accent/30 transition-all duration-200"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{t('provider.addProviderTitle', language as Language)}</span>
          </button>
        )}
      </div>
      </div>

      {/* 右侧内容：配置详情 */}
      <div className="flex-1 min-w-0 space-y-4 overflow-y-auto custom-scrollbar pr-1">
          <>
          {/* 服务商启用开关 */}
          {!isCloudMode && (() => {
            const currentProviderConfig = localProviderConfigs[localConfig.provider]
            const providerEnabled = currentProviderConfig?.enabled === true
            return (
              <div className="flex items-center justify-between rounded-xl border border-border/50 bg-surface/20 px-4 py-3">
                <div className="flex items-center gap-2">
                  <div className={`p-1.5 rounded-md ${providerEnabled ? 'bg-green-500/10 text-green-500' : 'bg-surface-active/50 text-text-muted'}`}>
                    <Server className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <span className="text-xs font-semibold text-text-primary">
                      {providerEnabled
                        ? t('provider.enableProvider', language as Language)
                        : t('provider.disableProvider', language as Language)}
                    </span>
                    {!providerEnabled && (
                      <p className="text-[10px] text-text-muted mt-0.5">
                        {t('provider.providerDisabled', language as Language)}
                      </p>
                    )}
                  </div>
                </div>
                <ToggleSwitch
                  checked={providerEnabled}
                  switchSize="sm"
                  onChange={() => {
                    setLocalProviderConfigs({
                      ...localProviderConfigs,
                      [localConfig.provider]: {
                        ...(currentProviderConfig || {}),
                        enabled: !providerEnabled,
                      },
                    })
                  }}
                />
              </div>
            )
          })()}

          {/* 认证 & 网络配置 - 仅本地模式 */}
          {!isCloudMode && (
          <section className="rounded-2xl border border-border/50 bg-surface/20 p-5 backdrop-blur-xl shadow-sm relative overflow-hidden group">
            <div className="absolute inset-0 bg-gradient-to-br from-accent/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
            <div className="relative">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-accent/10 rounded-md text-accent">
                  <Server className="w-3.5 h-3.5" />
                </div>
                <h5 className="text-sm font-semibold text-text-primary">
                  {t('provider.connection', language as Language)}
                </h5>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <TestConnectionButton localConfig={localConfig} language={language} />
                <TestModelButton localConfig={localConfig} language={language} />
              </div>
            </div>

            {/* 基础配置：三列布局 */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-5 mb-6">
              {/* API Key */}
              <div className="md:col-span-5 space-y-2">
                <label className="text-[12px] font-bold text-text-secondary uppercase tracking-wider px-0.5">
                  API Key
                </label>
                <TextField
                  type={showApiKey ? 'text' : 'password'}
                  value={localConfig.apiKey ?? ''}
                  onChange={(e) => setLocalConfig({ ...localConfig, apiKey: e.target.value })}
                  placeholder={PROVIDERS[localConfig.provider]?.auth.placeholder || 'sk-...'}
                  className="bg-background/40 border-border/60 focus:border-accent/50 focus:ring-accent/20 font-mono text-xs h-10 transition-all"
                  rightIcon={
                    <button onClick={() => setShowApiKey(!showApiKey)} className="text-text-muted hover:text-text-primary p-1.5 hover:bg-surface/50 rounded-md transition-colors">
                      {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  }
                />
              </div>

              {/* API 端点 */}
              <div className="md:col-span-5 space-y-2">
                <label className="text-[12px] font-bold text-text-secondary uppercase tracking-wider px-0.5">
                  {t('provider.apiEndpointLabel', language as Language)}
                </label>
                <TextField
                  value={localConfig.baseUrl || ''}
                  onChange={(e) => setLocalConfig({ ...localConfig, baseUrl: e.target.value || undefined })}
                  placeholder="https://api.example.com/v1"
                  className="bg-background/40 border-border/60 focus:border-accent/50 focus:ring-accent/20 text-xs font-mono h-10 transition-all"
                />
              </div>

              {/* 超时时间 */}
              <div className="md:col-span-2 space-y-2">
                <label className="text-[12px] font-bold text-text-secondary uppercase tracking-wider px-0.5">
                  {t('provider.timeout', language as Language)}
                </label>
                <TextField
                  type="number"
                  value={(localConfig.timeout || 120000) / 1000}
                  onChange={(e) => setLocalConfig({ ...localConfig, timeout: (parseInt(e.target.value) || 120) * 1000 })}
                  min={10}
                  className="bg-background/40 border-border/60 focus:border-accent/50 focus:ring-accent/20 text-xs h-10 transition-all"
                />
              </div>
            </div>

            {/* 底部功能栏：协议选择 + 提示信息 */}
            <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] items-start gap-4 pt-5 border-t border-border/50">
              <div className="w-full space-y-3">

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                  <div className="space-y-2">
                    <label className="text-[12px] font-bold text-text-secondary uppercase tracking-wider px-0.5">
                      {t('provider.protocol', language as Language)}
                    </label>
                    <DropdownSelector
                      value={localConfig.protocol || (isCustomSelected ? selectedCustomConfig?.protocol : (selectedProvider as any)?.protocol) || 'openai'}
                      onChange={(val) => {
                        const nextProtocol = val as ApiProtocol
                        setLocalConfig({
                          ...localConfig,
                          protocol: nextProtocol,
                          openAICompatibilityProfile: resolveOpenAICompatibilityProfile(
                            localConfig.provider,
                            nextProtocol,
                            localConfig.openAICompatibilityProfile,
                          ),
                        })
                      }}
                      options={PROTOCOL_OPTIONS}
                      className="w-full max-w-[320px] bg-background/40 border-border/60 h-9 text-xs"
                    />
                    <p className="text-[11px] text-text-muted leading-relaxed max-w-md">
                      {t('provider.openAICompatibilityProfile', language as Language)}
                    </p>
                  </div>
                  {isCustomSelected && isOpenAIStyleProtocol(currentProtocol) && currentOpenAICompatibilityProfile && (
                    <div className="space-y-2 md:pt-0">
                      <label className="text-[12px] font-bold text-text-secondary uppercase tracking-wider px-0.5">
                        {t('provider.openAICompatibilityProfile', language as Language)}
                      </label>
                      <DropdownSelector
                        value={currentOpenAICompatibilityProfile}
                        onChange={(value) => setLocalConfig({
                          ...localConfig,
                          openAICompatibilityProfile: value as OpenAICompatibilityProfile,
                        })}
                        options={openAICompatibilityProfileOptions}
                        className="w-full max-w-[320px] bg-background/40 border-border/60 h-9 text-xs"
                      />
                      <p className="text-[11px] text-text-muted leading-relaxed max-w-md">
                        {openAICompatibilityProfileDescription}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
            </div>
          </section>
          )}

          <section className="rounded-2xl border border-border/50 bg-surface/20 p-5 backdrop-blur-xl shadow-sm relative overflow-hidden group">
            <div className="absolute inset-0 bg-gradient-to-br from-accent/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
            <div className="relative">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-accent/10 rounded-md text-accent">
                    <Box className="w-3.5 h-3.5" />
                  </div>
                  <h5 className="text-sm font-semibold text-text-primary">
                    {t('provider.model', language as Language)}
                  </h5>
                </div>
                {!isCloudMode && (
                <FetchModelsButton
                  provider={localConfig.provider}
                  apiKey={localConfig.apiKey}
                  baseUrl={localConfig.baseUrl}
                  protocol={isCustomSelected ? selectedCustomConfig?.protocol : localConfig.protocol}
                  language={language}
                  existingModels={availableModels}
                  onModelsFetched={(models) => {
                    handleBatchAddModels(models)
                  }}
                  onModelRemoved={(m) => handleRemoveModel(m)}
                  onBatchRemoved={(models) => handleBatchRemoveModels(models)}
                />
                )}
              </div>

              <div className="space-y-4">
                {!isCloudMode && (
                <div className="flex gap-2">
                  <TextField
                    value={newModelName}
                    onChange={(e) => setNewModelName(e.target.value)}
                    placeholder={t('provider.enterModelName', language as Language)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddModel()}
                    className="flex-1 h-9 text-xs bg-background/50 border-border"
                  />
                  <ActionButton variant="secondary" size="sm" onClick={() => handleAddModel()} disabled={!newModelName.trim()} className="h-9 px-3">
                    <Plus className="w-4 h-4" />
                  </ActionButton>
                </div>
                )}

                {isCloudMode ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {cloudModelOptions.map((opt) => {
                      const isSelected = localConfig.model === opt.value
                      return (
                        <button
                          key={opt.value}
                          onClick={() => setLocalConfig({ ...localConfig, model: opt.value })}
                          className={`relative rounded-xl border p-3 text-left transition-all duration-200 ${
                            isSelected
                              ? 'bg-accent/10 border-accent/30 shadow-md shadow-accent/10'
                              : 'bg-surface/30 border-border/50 hover:border-border hover:bg-surface/50'
                          }`}
                        >
                          {isSelected && (
                            <div className="absolute top-2 right-2">
                              <Check className="w-3 h-3 text-accent" strokeWidth={3} />
                            </div>
                          )}
                          <span className={`text-xs font-medium font-mono truncate block ${
                            isSelected ? 'text-accent' : 'text-text-primary'
                          }`}>
                            {opt.label}
                          </span>
                        </button>
                      )
                    })}
                    {cloudModelOptions.length === 0 && (
                      <div className="col-span-full text-center py-6 text-text-muted text-xs">
                        {t('provider.noModels', language as Language)}
                      </div>
                    )}
                  </div>
                ) : (
                  <ModelCardGrid
                    models={availableModels}
                    selectedModel={localConfig.model ?? ''}
                    onSelectModel={(model) => setLocalConfig({ ...localConfig, model })}
                    onRemoveModel={handleRemoveModel}
                    modelConfigs={localProviderConfigs[localConfig.provider]?.modelConfigs || {}}
                    onUpdateModelConfig={handleUpdateModelConfig}
                    language={language as Language}
                    providerGenerationParams={providerGenerationParams}
                  />
                )}
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-border/50 bg-surface/20 backdrop-blur-xl shadow-sm relative overflow-hidden group">
            <div className="absolute inset-0 bg-gradient-to-br from-accent/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
            
            <button 
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="w-full flex items-center justify-between p-5 cursor-pointer focus:outline-none relative z-10"
            >
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-accent/10 rounded-md text-accent">
                  <Sliders className="w-3.5 h-3.5" />
                </div>
                <div className="text-left">
                  <h5 className="text-sm font-semibold text-text-primary">
                    {t('provider.generation', language as Language)}
                  </h5>
                  <p className="text-[11px] text-text-muted mt-0.5">
                    {t('provider.generationDefaultDesc', language as Language)}
                  </p>
                </div>
              </div>
              <div className={`p-1.5 rounded-full bg-surface-hover transition-transform duration-300 ${showAdvanced ? 'rotate-180' : ''}`}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
            </button>

            <div className={`grid transition-all duration-300 ease-in-out ${showAdvanced ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
              <div className="overflow-hidden">
                <div className="p-5 pt-0 space-y-5 relative z-10">
              <div className="space-y-5">

                  {/* Max Tokens */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-xs text-text-secondary">{t('provider.maxTokens', language as Language)}</label>
                      <span className="text-xs font-mono bg-background/50 px-1.5 py-0.5 rounded text-accent">
                        {localConfig.maxTokens ?? LLM_DEFAULTS.maxTokens}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={1024}
                      max={32768}
                      step={1024}
                      value={localConfig.maxTokens ?? LLM_DEFAULTS.maxTokens}
                      onChange={(e) => setLocalConfig({
                        ...localConfig,
                        maxTokens: parseInt(e.target.value)
                      })}
                      className="w-full h-1.5 bg-surface-active rounded-full appearance-none cursor-pointer accent-accent hover:accent-accent-hover"
                    />
                  </div>

                  {/* Temperature */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-xs text-text-secondary">
                        {t('provider.temperature', language as Language)}
                      </label>
                      <span className="text-xs font-mono bg-background/50 px-1.5 py-0.5 rounded text-accent">
                        {(localConfig.temperature ?? LLM_DEFAULTS.temperature).toFixed(1)}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={2}
                      step={0.1}
                      value={localConfig.temperature ?? LLM_DEFAULTS.temperature}
                      onChange={(e) => setLocalConfig({
                        ...localConfig,
                        temperature: parseFloat(e.target.value)
                      })}
                      className="w-full h-1.5 bg-surface-active rounded-full appearance-none cursor-pointer accent-accent hover:accent-accent-hover"
                    />
                    <div className="flex justify-between text-[11px] text-text-muted px-1">
                      <span>{t('provider.precise', language as Language)}</span>
                      <span>{t('provider.creative', language as Language)}</span>
                    </div>
                  </div>

                  {/* Top P */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <label className="text-xs text-text-secondary">Top P</label>
                        <p className="text-[11px] text-text-muted">
                          {t('provider.topPDesc', language as Language)}
                        </p>
                      </div>
                      <span className="text-xs font-mono bg-background/50 px-1.5 py-0.5 rounded text-accent">
                        {(localConfig.topP ?? LLM_DEFAULTS.topP).toFixed(2)}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={localConfig.topP ?? LLM_DEFAULTS.topP}
                      onChange={(e) => setLocalConfig({
                        ...localConfig,
                        topP: parseFloat(e.target.value)
                      })}
                      className="w-full h-1.5 bg-surface-active rounded-full appearance-none cursor-pointer accent-accent hover:accent-accent-hover"
                    />
                  </div>

                  {/* Top K */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <label className="text-xs text-text-secondary">Top K</label>
                        <p className="text-[11px] text-text-muted">
                          {t('provider.topKDesc', language as Language)}
                        </p>
                      </div>
                      <span className="text-xs font-mono bg-background/50 px-1.5 py-0.5 rounded text-accent">
                        {localConfig.topK ?? 'Default'}
                      </span>
                    </div>
                    <input
                      type="number"
                      min={0}
                      value={localConfig.topK ?? ''}
                      onChange={(e) => setLocalConfig({
                        ...localConfig,
                        topK: e.target.value ? parseInt(e.target.value) : undefined
                      })}
                      placeholder="Default"
                      className="w-full bg-surface-active rounded-lg px-3 py-1.5 text-xs border border-border focus:border-accent focus:ring-1 focus:ring-accent/50 outline-none transition-all"
                    />
                  </div>

                  {/* 深度思考模式 */}
                  <div className="space-y-3 pt-3 border-t border-border/50">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5 flex-1">
                        <label className="text-xs font-medium text-text-secondary">
                          {t('provider.extendedThinking', language as Language)}
                        </label>
                        <p className="text-[11px] text-text-muted">
                          {t('provider.extendedThinkingDesc', language as Language)}
                        </p>
                      </div>
                      <ToggleSwitch
                        checked={localConfig.enableThinking ?? false}
                        onChange={(e) => setLocalConfig({ ...localConfig, enableThinking: e.target.checked })}
                        className="flex-shrink-0"
                      />
                    </div>

                    {/* 思考模式详细配置 - 仅在启用时展示 */}
                    {localConfig.enableThinking && (
                      <div className="space-y-3 pl-1 animate-in fade-in slide-in-from-top-1 duration-200">
                        {/* 推理深度 */}
                        <div className="space-y-2">
                          <div className="space-y-0.5">
                            <label className="text-xs text-text-secondary">
                              {t('provider.reasoningEffort', language as Language)}
                            </label>
                            <p className="text-[11px] text-text-muted">
                              {reasoningEffortDescription}
                            </p>
                          </div>
                          <DropdownSelector
                            options={reasoningEffortOptions}
                            value={selectedReasoningEffort}
                            onChange={(val) => setLocalConfig({ ...localConfig, reasoningEffort: val as typeof REASONING_EFFORT_VALUES[number] })}
                          />
                        </div>

                        {/* Thinking Budget */}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                              <label className="text-xs text-text-secondary">
                                {t('provider.thinkingBudget', language as Language)}
                              </label>
                              <p className="text-[11px] text-text-muted">
                                {t('provider.thinkingBudgetDesc', language as Language)}
                              </p>
                            </div>
                            <span className="text-xs font-mono bg-background/50 px-1.5 py-0.5 rounded text-accent">
                              {(localConfig.thinkingBudget || 10000).toLocaleString()}
                            </span>
                          </div>
                          <input
                            type="range"
                            min={1024}
                            max={100000}
                            step={1024}
                            value={localConfig.thinkingBudget || 10000}
                            onChange={(e) => setLocalConfig({
                              ...localConfig,
                              thinkingBudget: parseInt(e.target.value)
                            })}
                            className="w-full h-1.5 bg-surface-active rounded-full appearance-none cursor-pointer accent-accent hover:accent-accent-hover"
                          />
                          <div className="flex justify-between text-[11px] text-text-muted px-1">
                            <span>1K</span>
                            <span>100K</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="space-y-4 pt-3 border-t border-border/50">
                    <div className="space-y-0.5">
                      <label className="text-xs font-medium text-text-secondary">
                        {t('provider.requestBehavior', language as Language)}
                      </label>
                      <p className="text-[11px] text-text-muted">
                        {t('provider.requestBehaviorDesc', language as Language)}
                      </p>
                    </div>

                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div className="space-y-1.5">
                        <label className="text-xs text-text-secondary">
                          {t('provider.toolChoice', language as Language)}
                        </label>
                        <DropdownSelector
                          value={typeof localConfig.toolChoice === 'string' ? localConfig.toolChoice : 'required'}
                          onChange={(value) => setLocalConfig({
                            ...localConfig,
                            toolChoice: value as 'auto' | 'none' | 'required',
                          })}
                          options={[
                            { value: 'auto', label: t('provider.toolChoiceAuto', language as Language) },
                            { value: 'required', label: t('provider.toolChoiceRequired', language as Language) },
                            { value: 'none', label: t('provider.toolChoiceNone', language as Language) },
                          ]}
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs text-text-secondary">
                          {t('provider.maxRetries', language as Language)}
                        </label>
                        <TextField
                          type="number"
                          min={0}
                          max={10}
                          value={localConfig.maxRetries ?? LLM_DEFAULTS.maxRetries}
                          onChange={(e) => setLocalConfig({
                            ...localConfig,
                            maxRetries: Math.max(0, parseInt(e.target.value || '0', 10) || 0),
                          })}
                          className="bg-surface-active border-border text-xs h-9"
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between rounded-lg border border-border/60 bg-background/30 px-3 py-2.5">
                      <div className="space-y-0.5 pr-4">
                        <label className="text-xs text-text-secondary">
                          {t('provider.parallelToolCalls', language as Language)}
                        </label>
                        <p className="text-[11px] text-text-muted">
                          {t('provider.parallelToolCallsDesc', language as Language)}
                        </p>
                      </div>
                      <ToggleSwitch
                        checked={localConfig.parallelToolCalls ?? LLM_DEFAULTS.parallelToolCalls}
                        onChange={(e) => setLocalConfig({
                          ...localConfig,
                          parallelToolCalls: e.target.checked,
                        })}
                        className="flex-shrink-0"
                      />
                    </div>
                  </div>

                  {/* Frequency Penalty */}
                  <div className="space-y-3 pt-3 border-t border-border/50">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <label className="text-xs text-text-secondary">Frequency Penalty</label>
                        <p className="text-[11px] text-text-muted">
                          {t('provider.frequencyPenaltyDesc', language as Language)}
                        </p>
                      </div>
                      <span className="text-xs font-mono bg-background/50 px-1.5 py-0.5 rounded text-accent">
                        {(localConfig.frequencyPenalty || 0).toFixed(1)}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={-2}
                      max={2}
                      step={0.1}
                      value={localConfig.frequencyPenalty || 0}
                      onChange={(e) => setLocalConfig({
                        ...localConfig,
                        frequencyPenalty: parseFloat(e.target.value)
                      })}
                      className="w-full h-1.5 bg-surface-active rounded-full appearance-none cursor-pointer accent-accent hover:accent-accent-hover"
                    />
                  </div>

                  {/* Presence Penalty */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <label className="text-xs text-text-secondary">Presence Penalty</label>
                        <p className="text-[11px] text-text-muted">
                          {t('provider.presencePenaltyDesc', language as Language)}
                        </p>
                      </div>
                      <span className="text-xs font-mono bg-background/50 px-1.5 py-0.5 rounded text-accent">
                        {(localConfig.presencePenalty || 0).toFixed(1)}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={-2}
                      max={2}
                      step={0.1}
                      value={localConfig.presencePenalty || 0}
                      onChange={(e) => setLocalConfig({
                        ...localConfig,
                        presencePenalty: parseFloat(e.target.value)
                      })}
                      className="w-full h-1.5 bg-surface-active rounded-full appearance-none cursor-pointer accent-accent hover:accent-accent-hover"
                    />
                  </div>

                  {/* Seed */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <label className="text-xs text-text-secondary">Seed</label>
                        <p className="text-[11px] text-text-muted">
                          {t('provider.seedDesc', language as Language)}
                        </p>
                      </div>
                      <span className="text-xs font-mono bg-background/50 px-1.5 py-0.5 rounded text-accent">
                        {localConfig.seed ?? 'Random'}
                      </span>
                    </div>
                    <input
                      type="number"
                      value={localConfig.seed ?? ''}
                      onChange={(e) => setLocalConfig({
                        ...localConfig,
                        seed: e.target.value ? parseInt(e.target.value) : undefined
                      })}
                      placeholder="Random"
                      className="w-full bg-surface-active rounded-lg px-3 py-1.5 text-xs border border-border focus:border-accent focus:ring-1 focus:ring-accent/50 outline-none transition-all"
                    />
                  </div>

                  {/* Stop Sequences */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <label className="text-xs text-text-secondary">Stop Sequences</label>
                        <p className="text-[11px] text-text-muted">
                          {t('provider.stopSequencesDesc', language as Language)}
                        </p>
                      </div>
                      <span className="text-[11px] text-text-muted bg-background/50 px-1.5 py-0.5 rounded">
                        Comma separated
                      </span>
                    </div>
                    <input
                      type="text"
                      value={localConfig.stopSequences?.join(', ') || ''}
                      onChange={(e) => {
                        const val = e.target.value
                        setLocalConfig({
                          ...localConfig,
                          stopSequences: val ? val.split(',').map(s => s.trim()).filter(Boolean) : undefined
                        })
                      }}
                      placeholder="e.g. \n, User:"
                      className="w-full bg-surface-active rounded-lg px-3 py-1.5 text-xs border border-border focus:border-accent focus:ring-1 focus:ring-accent/50 outline-none transition-all"
                    />
                  </div>

                  {/* Logit Bias */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <label className="text-xs text-text-secondary">Logit Bias (JSON)</label>
                        <p className="text-[11px] text-text-muted">
                          {t('provider.logitBiasDesc', language as Language)}
                        </p>
                      </div>
                      <span className="text-[11px] text-text-muted bg-background/50 px-1.5 py-0.5 rounded">
                        Token ID: Bias
                      </span>
                    </div>
                    <textarea
                      value={logitBiasString}
                      onChange={(e) => setLogitBiasString(e.target.value)}
                      onBlur={() => {
                        try {
                          if (!logitBiasString.trim()) {
                            setLocalConfig({ ...localConfig, logitBias: undefined })
                            return
                          }
                          const parsed = JSON.parse(logitBiasString)
                          if (typeof parsed === 'object' && parsed !== null) {
                            setLocalConfig({ ...localConfig, logitBias: parsed })
                          }
                        } catch {
                          // Invalid JSON
                        }
                      }}
                      placeholder='{"50256": -100}'
                      className="w-full h-20 bg-surface-active rounded-lg px-3 py-1.5 text-xs border border-border focus:border-accent focus:ring-1 focus:ring-accent/50 outline-none transition-all font-mono"
                    />
                  </div>

                  {/* Custom Headers */}
                  <div className="space-y-3 pt-3 border-t border-border/50">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <label className="text-xs text-text-secondary">
                          {t('provider.customHeaders', language as Language)}
                        </label>
                        <p className="text-[11px] text-text-muted">
                          {t('provider.customHeadersDesc', language as Language)}
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          setCustomHeaders([...customHeaders, { key: '', value: '' }])
                        }}
                        className="text-xs text-accent hover:text-accent-hover flex items-center gap-1 flex-shrink-0"
                      >
                        <Plus className="w-3 h-3" />
                        {t('provider.add', language as Language)}
                      </button>
                    </div>

                    {/* 默认请求头（可编辑） */}
                    {(() => {
                      const defaultKeys = Object.keys(defaultHeaders)

                      return defaultKeys.length > 0 && (
                        <div className="space-y-2">
                          <div className="text-[11px] font-medium text-text-muted uppercase tracking-wider">
                            {t('provider.defaultHeadersEditable', language as Language)}
                          </div>
                          {defaultKeys.map((key) => {
                            const defaultValue = defaultHeaders[key]
                            const currentValue = localConfig.headers?.[key] ?? defaultValue
                            return (
                              <div key={key} className="p-3 bg-surface/20 rounded-lg border border-accent/20 space-y-2">
                                <div className="flex items-center justify-between">
                                  <TextField
                                    type="text"
                                    value={key}
                                    onChange={(e) => {
                                      const newKey = e.target.value
                                      if (!newKey) return

                                      // 重命名 key
                                      const newHeaders = { ...localConfig.headers }
                                      delete newHeaders[key]
                                      newHeaders[newKey] = currentValue
                                      setLocalConfig({
                                        ...localConfig,
                                        headers: newHeaders
                                      })
                                    }}
                                    className="flex-1 bg-background/50 border-border text-xs font-mono h-8"
                                  />
                                  <span className="text-[11px] text-accent bg-accent/10 px-2 py-0.5 rounded-full border border-accent/20 flex-shrink-0 ml-2">
                                    {t('provider.defaultLabel', language as Language)}
                                  </span>
                                </div>
                                <TextField
                                  type="text"
                                  value={currentValue}
                                  onChange={(e) => {
                                    const newHeaders = { ...localConfig.headers, [key]: e.target.value }
                                    setLocalConfig({
                                      ...localConfig,
                                      headers: newHeaders
                                    })
                                  }}
                                  placeholder={defaultValue}
                                  className="bg-background/50 border-border text-xs font-mono h-8"
                                />
                                <p className="text-[11px] text-text-muted">
                                  {t('provider.apiKeyUsePlaceholder', language as Language)}
                                </p>
                              </div>
                            )
                          })}
                        </div>
                      )
                    })()}

                    {/* 自定义请求头 */}
                    {customHeaders.length > 0 && (
                      <div className="space-y-2">
                        {Object.keys(defaultHeaders).length > 0 && (
                          <div className="text-[11px] font-medium text-text-muted uppercase tracking-wider">
                            {t('provider.additionalHeaders', language as Language)}
                          </div>
                        )}
                        {customHeaders.map((header, index) => (
                          <div key={index} className="space-y-1.5 p-2.5 bg-background/30 rounded-lg border border-border/50">
                            <div className="flex items-start gap-2">
                              <div className="flex-1 space-y-1.5">
                                <DropdownSelector
                                  value={header.isCustom ? 'X-Custom-Header' : header.key}
                                  onChange={(value) => {
                                    const newHeaders = [...customHeaders]
                                    if (value === 'X-Custom-Header') {
                                      newHeaders[index].isCustom = true
                                      newHeaders[index].key = ''
                                    } else {
                                      newHeaders[index].isCustom = false
                                      newHeaders[index].key = value
                                    }
                                    syncCustomHeaders(newHeaders)
                                  }}
                                  options={headerSelectOptions}
                                  className="w-full bg-surface-active border-border text-xs h-8"
                                />
                                {header.isCustom && (
                                  <TextField
                                    type="text"
                                    value={header.key}
                                    onChange={(e) => {
                                      const newHeaders = [...customHeaders]
                                      newHeaders[index].key = e.target.value
                                      syncCustomHeaders(newHeaders)
                                    }}
                                    placeholder={t('provider.headerName', language as Language)}
                                    className="bg-surface-active border-border text-xs font-mono h-8"
                                  />
                                )}
                                <TextField
                                  type="text"
                                  value={header.value}
                                  onChange={(e) => {
                                    const newHeaders = [...customHeaders]
                                    newHeaders[index].value = e.target.value
                                    syncCustomHeaders(newHeaders)
                                  }}
                                  placeholder={t('provider.value', language as Language)}
                                  className="bg-surface-active border-border text-xs font-mono h-8"
                                />
                              </div>
                              <button
                                onClick={() => {
                                  const newHeaders = customHeaders.filter((_, i) => i !== index)
                                  syncCustomHeaders(newHeaders)
                                }}
                                className="p-1 text-red-400 hover:text-red-300 hover:bg-red-400/10 rounded transition-colors flex-shrink-0 mt-0.5"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {customHeaders.length === 0 && Object.keys(defaultHeaders).length === 0 && (
                      <div className="text-[11px] text-text-muted bg-background/50 px-3 py-2 rounded-lg border border-border text-center">
                        {t('provider.clickAddHeaders', language as Language)}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
          </section>
          </>
      </div>
      {isAddingCustom && !isCloudMode && (
        <AddProviderDialog
          language={language}
          onSave={handleAddCustomProvider}
          onCancel={() => setIsAddingCustom(false)}
        />
      )}
    </div>
  )
}
