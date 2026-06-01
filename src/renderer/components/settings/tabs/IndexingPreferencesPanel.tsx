/**
 * 索引设置组件
 */

import { api } from '../../../adapters/electronBridge'
import { logger } from '@toolkit/LogEngine'
import { useState, useEffect, useCallback } from 'react'
import { Eye, EyeOff, AlertTriangle, Database, Settings2, Zap, Brain } from 'lucide-react'
import { useStore } from '@store'
import { toast } from '@components/foundation/NotificationProvider'
import { ActionButton, TextField, DropdownSelector } from '@components/ui'
import {Language, t} from '@renderer/i18n'
import type { EmbeddingConfigInput, IndexStatus } from '@renderer/types/electronBridge'

interface IndexSettingsProps {
  language: Language
}

type IndexMode = 'structural' | 'semantic'

interface EmbeddingConfigState {
  provider: string
  apiKey: string
  model: string
  baseUrl: string
}

const DEFAULT_EMBEDDING_CONFIG: EmbeddingConfigState = {
  provider: 'jina',
  apiKey: '',
  model: '',
  baseUrl: '',
}

export function IndexingPreferencesPanel({ language }: IndexSettingsProps) {
  const workspacePath = useStore(s => s.workspacePath)
  const [indexMode, setIndexMode] = useState<IndexMode>('structural')
  const [embeddingConfig, setEmbeddingConfig] = useState<EmbeddingConfigState>(DEFAULT_EMBEDDING_CONFIG)
  const [showApiKey, setShowApiKey] = useState(false)
  const [isIndexing, setIsIndexing] = useState(false)
  const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const EMBEDDING_PROVIDERS = [
    { id: 'jina', name: 'Jina AI', description: t('settings.free100mtokensmonth', language as Language) },
    { id: 'voyage', name: 'Voyage AI', description: t('settings.free50mtokens', language as Language) },
    { id: 'cohere', name: 'Cohere', description: t('settings.free100callsmin', language as Language) },
    { id: 'ollama', name: 'Ollama', description: t('settings.local', language as Language) },
    { id: 'transformers', name: 'Transformers.js', description: t('settings.localnativenoollama', language as Language) },
    { id: 'openai', name: 'OpenAI', description: t('settings.paid', language as Language) },
    { id: 'custom', name: t('settings.custom', language as Language), description: 'OpenAI API compatible' },
  ]

  const TRANSFORMERS_MODELS = [
    { id: 'Xenova/multilingual-e5-small', name: 'Multilingual E5 Small', description: t('settings.bestbalanceoptimizedforencn', language as Language) },
    { id: 'Xenova/bge-small-zh-v1.5', name: 'BGE Small ZH', description: t('settings.bestforpurechineseprojects', language as Language) },
    { id: 'Xenova/all-MiniLM-L6-v2', name: 'MiniLM L6 (English)', description: t('settings.fastestmostlyforenglish', language as Language) },
    { id: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2', name: 'MiniLM L12 Multilingual', description: t('settings.stableandgeneralmultilingual', language as Language) },
    { id: 'custom', name: t('settings.custommodel', language as Language), description: '' },
  ]

  // 加载配置
  useEffect(() => {
    api.settings.get('indexConfig').then(config => {
      if (config) {
        const cfg = config as { mode?: IndexMode; embedding?: Partial<EmbeddingConfigState> }
        if (cfg.mode) setIndexMode(cfg.mode)
        if (cfg.embedding) setEmbeddingConfig(prev => ({ ...prev, ...cfg.embedding }))
      }
    })
  }, [])

  // 监听索引状态
  useEffect(() => {
    if (!workspacePath) return

    const loadStatus = async () => {
      try {
        const status = await api.index.status(workspacePath)
        setIndexStatus(status)
        if (status.mode) setIndexMode(status.mode)
      } catch (e) {
        logger.ui.warn('[IndexingPreferencesPanel] Failed to load index status:', e)
      }
    }

    loadStatus()
    const unsubscribe = api.index.onProgress((status) => {
      setIndexStatus(status)
      setIsIndexing(status.isIndexing)
    })

    return unsubscribe
  }, [workspacePath])

  // 切换索引模式
  const handleModeChange = useCallback(async (mode: IndexMode) => {
    setIndexMode(mode)
    // 保存到配置文件
    const currentConfig = await api.settings.get('indexConfig') as { mode?: string; embedding?: object } || {}
    await api.settings.set('indexConfig', { ...currentConfig, mode })
    // 同步到索引服务
    if (workspacePath) {
      await api.index.setMode(workspacePath, mode)
    }
    toast.success(t('settings.switchedtoindexmode', language as Language, { mode: mode, p1: mode === 'structural' ? '结构化' : '语义' }))
  }, [workspacePath, language])

  // 保存 Embedding 配置
  const handleSaveEmbeddingConfig = async () => {
    if (embeddingConfig.provider === 'custom' && !embeddingConfig.baseUrl) {
      toast.error(t('settings.customservicerequiresapiurl', language as Language))
      return
    }

    const configToSave: EmbeddingConfigInput = {
      provider: embeddingConfig.provider as EmbeddingConfigInput['provider'],
    }
    if (embeddingConfig.apiKey) configToSave.apiKey = embeddingConfig.apiKey
    if (embeddingConfig.model) configToSave.model = embeddingConfig.model
    if (embeddingConfig.baseUrl) configToSave.baseUrl = embeddingConfig.baseUrl

    try {
      // 保存到配置文件（统一使用 indexConfig）
      const currentConfig = await api.settings.get('indexConfig') as { mode?: string; embedding?: object } || {}
      await api.settings.set('indexConfig', { ...currentConfig, embedding: configToSave })
      // 同步到索引服务
      if (workspacePath) {
        await api.index.updateEmbeddingConfig(workspacePath, configToSave)
      }
      toast.success(t('settings.configurationsaved', language as Language))
    } catch (error) {
      logger.settings.error('[IndexingPreferencesPanel] Save failed:', error)
      toast.error(t('settings.savefailed', language as Language))
    }
  }

  // 开始索引
  const handleStartIndexing = async () => {
    if (!workspacePath) {
      toast.error(t('settings.pleaseopenaworkspacefirst', language as Language))
      return
    }

    setIsIndexing(true)
    try {
      if (indexMode === 'semantic') {
        await handleSaveEmbeddingConfig()
      }
      await api.index.start(workspacePath)
      toast.success(t('settings.indexingstarted', language as Language))
    } catch (error) {
      logger.settings.error('[IndexingPreferencesPanel] Start indexing failed:', error)
      toast.error(t('settings.failedtostartindexing', language as Language))
      setIsIndexing(false)
    }
  }

  // 清除索引
  const handleClearIndex = async () => {
    if (!workspacePath) return
    try {
      await api.index.clear(workspacePath)
      toast.success(t('settings.indexcleared', language as Language))
      setIndexStatus(null)
    } catch {
      toast.error(t('settings.failedtoclear', language as Language))
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* 索引模式选择 */}
      <section>
        <h4 className="text-xs font-medium text-text-secondary uppercase tracking-wider mb-3">
          {t('settings.indexmode', language as Language)}
        </h4>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => handleModeChange('structural')}
            className={`p-4 rounded-xl border transition-all text-left ${indexMode === 'structural'
              ? 'border-accent bg-accent/10'
              : 'border-border-subtle bg-surface/30 hover:border-border'
              }`}
          >
            <div className="flex items-center gap-2 mb-2">
              <Zap className={`w-4 h-4 ${indexMode === 'structural' ? 'text-accent' : 'text-text-muted'}`} />
              <span className="font-medium text-sm">{t('settings.structural', language as Language)}</span>
              <span className="text-xs px-1.5 py-0.5 rounded bg-success/20 text-success">
                {t('settings.recommended', language as Language)}
              </span>
            </div>
            <p className="text-xs text-text-muted">
              {t('settings.zeroconfiglocalbasedon', language as Language)}
            </p>
          </button>

          <button
            onClick={() => handleModeChange('semantic')}
            className={`p-4 rounded-xl border transition-all text-left ${indexMode === 'semantic'
              ? 'border-accent bg-accent/10'
              : 'border-border-subtle bg-surface/30 hover:border-border'
              }`}
          >
            <div className="flex items-center gap-2 mb-2">
              <Brain className={`w-4 h-4 ${indexMode === 'semantic' ? 'text-accent' : 'text-text-muted'}`} />
              <span className="font-medium text-sm">{t('settings.semantic', language as Language)}</span>
            </div>
            <p className="text-xs text-text-muted">
              {t('settings.requiresembeddingapibettersemantic', language as Language)}
            </p>
          </button>
        </div>
      </section>

      {/* 语义模式配置 */}
      {indexMode === 'semantic' && (
        <section className="animate-slide-down">
          <h4 className="text-xs font-medium text-text-secondary uppercase tracking-wider mb-3">
            {t('settings.embeddingconfiguration', language as Language)}
          </h4>
          <div className="p-4 bg-surface/30 rounded-xl border border-border-subtle space-y-4">
            <div>
              <label className="text-sm font-medium text-text-primary block mb-2">
                {t('settings.provider2', language as Language)}
              </label>
              <DropdownSelector
                value={embeddingConfig.provider}
                onChange={(v) => setEmbeddingConfig(prev => ({ ...prev, provider: v, model: '', baseUrl: v === 'custom' ? prev.baseUrl : '' }))}
                options={EMBEDDING_PROVIDERS.map(p => ({ value: p.id, label: `${p.name} - ${p.description}` }))}
              />
            </div>

            {embeddingConfig.provider === 'custom' && (
              <div>
                <label className="text-sm font-medium text-text-primary block mb-2">
                  API URL <span className="text-error">*</span>
                </label>
                <TextField
                  type="text"
                  value={embeddingConfig.baseUrl}
                  onChange={(e) => setEmbeddingConfig(prev => ({ ...prev, baseUrl: e.target.value }))}
                  placeholder="https://your-service.com/v1/embeddings"
                />
              </div>
            )}

            {embeddingConfig.provider !== 'ollama' && embeddingConfig.provider !== 'transformers' && (
              <div>
                <label className="text-sm font-medium text-text-primary block mb-2">API Key</label>
                <div className="relative">
                  <TextField
                    type={showApiKey ? 'text' : 'password'}
                    value={embeddingConfig.apiKey}
                    onChange={(e) => setEmbeddingConfig(prev => ({ ...prev, apiKey: e.target.value }))}
                    placeholder={t('settings.enterapikey', language as Language)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                  >
                    {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            )}

            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-2 text-xs text-text-muted hover:text-accent transition-colors"
            >
              <Settings2 className="w-3.5 h-3.5" />
              <span className={`transition-transform ${showAdvanced ? 'rotate-90' : ''}`}>▶</span>
              {t('settings.advanced', language as Language)}
            </button>

            {(showAdvanced || embeddingConfig.provider === 'transformers') && (
              <div className="space-y-3 animate-slide-down">
                <div>
                  <label className="text-xs text-text-muted block mb-1">
                    {t('settings.modelname', language as Language)}
                  </label>
                  {embeddingConfig.provider === 'transformers' ? (
                    <div className="space-y-2">
                      <DropdownSelector
                        value={TRANSFORMERS_MODELS.some(m => m.id === embeddingConfig.model) ? embeddingConfig.model : 'custom'}
                        onChange={(v) => {
                          if (v === 'custom') {
                            // 不清除 model，让用户可以基于当前值修改
                          } else {
                            setEmbeddingConfig(prev => ({ ...prev, model: v }))
                          }
                        }}
                        options={TRANSFORMERS_MODELS.map(m => ({
                          value: m.id,
                          label: m.description ? `${m.name} - ${m.description}` : m.name
                        }))}
                      />
                      {(embeddingConfig.model === 'custom' || !TRANSFORMERS_MODELS.some(m => m.id === embeddingConfig.model)) && (
                        <div className="mt-2">
                          <TextField
                            type="text"
                            value={embeddingConfig.model === 'custom' ? '' : embeddingConfig.model}
                            onChange={(e) => setEmbeddingConfig(prev => ({ ...prev, model: e.target.value }))}
                            placeholder="e.g. Xenova/multilingual-e5-small"
                          />
                          <p className="text-[11px] text-text-muted mt-1">
                            {t('settings.entermodelidentifierfromhuggingface', language as Language)}
                          </p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <TextField
                      type="text"
                      value={embeddingConfig.model}
                      onChange={(e) => setEmbeddingConfig(prev => ({ ...prev, model: e.target.value }))}
                      placeholder="e.g. text-embedding-3-small"
                    />
                  )}
                </div>
              </div>
            )}

            <ActionButton variant="secondary" size="sm" onClick={handleSaveEmbeddingConfig}>
              {t('settings.saveconfiguration', language as Language)}
            </ActionButton>
          </div>
        </section>
      )}

      {/* 索引状态和操作 */}
      <section>
        <h4 className="text-xs font-medium text-text-secondary uppercase tracking-wider mb-3">
          {t('settings.indexstatus', language as Language)}
        </h4>

        {indexStatus && (
          <div className="p-4 bg-surface/30 rounded-xl border border-border-subtle mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-text-primary">
                {indexStatus.message || (indexStatus.isIndexing
                  ? (t('settings.indexing2', language as Language))
                  : (t('settings.ready', language as Language)))}
              </span>
              <span className="text-xs px-2 py-0.5 rounded bg-surface border border-border-subtle">
                {indexStatus.mode === 'structural'
                  ? (t('settings.structural2', language as Language))
                  : (t('settings.semantic2', language as Language))}
              </span>
            </div>
            <div className="text-xs text-text-muted space-y-1">
              <div>{t('settings.files', language as Language)}: {indexStatus.indexedFiles} / {indexStatus.totalFiles}</div>
              <div>{t('settings.chunks', language as Language)}: {indexStatus.totalChunks}</div>
              {indexStatus.lastIndexedAt && (
                <div>{t('settings.lastindexed', language as Language)}: {new Date(indexStatus.lastIndexedAt).toLocaleString()}</div>
              )}
            </div>
            {indexStatus.isIndexing && (
              <div className="mt-2 h-1 bg-surface rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent transition-all duration-300"
                  style={{ width: `${indexStatus.totalFiles ? (indexStatus.indexedFiles / indexStatus.totalFiles) * 100 : 0}%` }}
                />
              </div>
            )}
          </div>
        )}

        <div className="flex gap-3">
          <ActionButton
            variant="primary"
            onClick={handleStartIndexing}
            disabled={isIndexing || !workspacePath}
            leftIcon={<Database className="w-4 h-4" />}
          >
            {isIndexing
              ? (t('settings.indexing3', language as Language))
              : (t('settings.startindexing', language as Language))}
          </ActionButton>
          <ActionButton variant="secondary" onClick={handleClearIndex} disabled={!workspacePath}>
            {t('settings.clearindex', language as Language)}
          </ActionButton>
        </div>

        {!workspacePath && (
          <div className="flex items-center gap-2 text-xs text-warning mt-3">
            <AlertTriangle className="w-4 h-4" />
            {t('settings.pleaseopenaworkspacefirst2', language as Language)}
          </div>
        )}
      </section>
    </div>
  )
}
