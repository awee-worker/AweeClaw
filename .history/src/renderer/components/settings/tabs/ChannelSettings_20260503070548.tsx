import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  MessageCircle,
  MessageSquare,
  Smartphone,
  Plus,
  Trash2,
  Power,
  PowerOff,
  RefreshCw,
  Loader2,
  CheckCircle,
  AlertCircle,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronRight,
  Shield,
  Globe,
  Settings2,
} from 'lucide-react'
import { Button, Input } from '@components/ui'
import { toast } from '@components/common/ToastProvider'
import { getAPI } from '@renderer/services/electronAPI'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { BUILTIN_PROVIDERS } from '@shared/config/providers'
import type { ChannelId, ChannelAccountConfig, ChannelAccountSnapshot, ChannelConfig, ChannelSecretSchema, ChannelLLMConfig } from '@shared/types/channel'

const CHANNEL_ICONS: Record<ChannelId, React.ReactNode> = {
  feishu: <MessageCircle className="w-4 h-4" />,
  wechat: <MessageSquare className="w-4 h-4" />,
  whatsapp: <Smartphone className="w-4 h-4" />,
  telegram: <MessageCircle className="w-4 h-4" />,
  dingtalk: <MessageCircle className="w-4 h-4" />,
  slack: <MessageCircle className="w-4 h-4" />,
}

interface ChannelSettingsProps {
  language: 'en' | 'zh'
}

export function ChannelSettings({ language }: ChannelSettingsProps) {
  const api = getAPI()
  const { llmConfig, providerConfigs } = useStore(useShallow(s => ({ llmConfig: s.llmConfig, providerConfigs: s.providerConfigs })))
  const [channels, setChannels] = useState<Array<{ id: ChannelId; meta: { label: string; labelZh: string; description: string; descriptionZh: string; icon: string; order: number } }>>([])
  const [configs, setConfigs] = useState<ChannelConfig[]>([])
  const [statuses, setStatuses] = useState<ChannelAccountSnapshot[]>([])
  const [secretSchemas, setSecretSchemas] = useState<Partial<Record<ChannelId, ChannelSecretSchema[]>>>({})
  const [expandedChannel, setExpandedChannel] = useState<ChannelId | null>(null)
  const [expandedAccount, setExpandedAccount] = useState<string | null>(null)
  const [showAddAccount, setShowAddAccount] = useState<ChannelId | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({})
  const [newAccountForm, setNewAccountForm] = useState<Partial<ChannelAccountConfig>>({
    id: '',
    name: '',
    enabled: true,
    credentials: {},
  })

  const [loading, setLoading] = useState(true)

  const availableProviders = useMemo(() => {
    const providers: Array<{ id: string; name: string; models: string[] }> = []
    for (const [id, def] of Object.entries(BUILTIN_PROVIDERS)) {
      const config = providerConfigs[id]
      const hasKey = !!(config?.apiKey || (llmConfig.provider === id && llmConfig.apiKey))
      if (!hasKey) continue
      const builtinModelIds = new Set(def.models)
      const customModels = config?.customModels?.filter(m => !builtinModelIds.has(m)) || []
      providers.push({
        id,
        name: def.displayName,
        models: [...def.models, ...customModels],
      })
    }
    for (const [id, config] of Object.entries(providerConfigs)) {
      if (!id.startsWith('custom-') || !config?.apiKey) continue
      providers.push({
        id,
        name: config.displayName || id,
        models: config.customModels || [],
      })
    }
    return providers
  }, [providerConfigs, llmConfig])

  useEffect(() => {
    loadData()
  }, [])

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      await api.channel.initialize()
      const channelsRes = await api.channel.getRegisteredChannels()
      const configsRes = await api.channel.getAllConfigs()
      const statusesRes = await api.channel.getAllAccountStatuses()
      if (channelsRes?.channels) setChannels(channelsRes.channels)
      if (configsRes?.configs) setConfigs(configsRes.configs)
      if (statusesRes?.statuses) setStatuses(statusesRes.statuses)
      const schemas: Partial<Record<ChannelId, ChannelSecretSchema[]>> = {}
      for (const ch of channelsRes?.channels || []) {
        const res = await api.channel.getSecretSchema(ch.id)
        schemas[ch.id as ChannelId] = res?.schema || []
      }
      setSecretSchemas(schemas)
    } catch (err) {
      console.error('Failed to load channel data:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  const handleConnect = async (channelId: ChannelId, accountId: string) => {
    setActionLoading(`${channelId}:${accountId}`)
    try {
      await api.channel.connectAccount(channelId, accountId)
      toast.success(language === 'zh' ? '连接成功' : 'Connected')
      await loadData()
    } catch (err: any) {
      toast.error(err?.message || (language === 'zh' ? '连接失败' : 'Connection failed'))
    } finally {
      setActionLoading(null)
    }
  }

  const handleDisconnect = async (channelId: ChannelId, accountId: string) => {
    setActionLoading(`${channelId}:${accountId}`)
    try {
      await api.channel.disconnectAccount(channelId, accountId)
      toast.success(language === 'zh' ? '已断开' : 'Disconnected')
      await loadData()
    } catch (err: any) {
      toast.error(err?.message || (language === 'zh' ? '断开失败' : 'Disconnect failed'))
    } finally {
      setActionLoading(null)
    }
  }

  const handleRemoveAccount = async (channelId: ChannelId, accountId: string) => {
    try {
      await api.channel.removeAccount(channelId, accountId)
      toast.success(language === 'zh' ? '已删除' : 'Removed')
      await loadData()
    } catch (err: any) {
      toast.error(err?.message || (language === 'zh' ? '删除失败' : 'Remove failed'))
    }
  }

  const handleAddAccount = async () => {
    if (!showAddAccount) return
    const schema = secretSchemas[showAddAccount] || []
    const missingRequired = schema.filter(s => s.required && !newAccountForm.credentials?.[s.key])
    if (missingRequired.length > 0) {
      toast.error(language === 'zh' ? '请填写所有必填项' : 'Please fill all required fields')
      return
    }
    if (!newAccountForm.id) {
      toast.error(language === 'zh' ? '请输入账户ID' : 'Please enter account ID')
      return
    }
    const account: ChannelAccountConfig = {
      id: newAccountForm.id,
      name: newAccountForm.name || newAccountForm.id,
      enabled: newAccountForm.enabled ?? true,
      credentials: newAccountForm.credentials || {},
      llmConfig: newAccountForm.llmConfig?.useGlobal === false
        ? newAccountForm.llmConfig
        : undefined,
    }
    try {
      await api.channel.addAccount(showAddAccount, account)
      toast.success(language === 'zh' ? '添加成功' : 'Account added')
      setShowAddAccount(null)
      setNewAccountForm({ id: '', name: '', enabled: true, credentials: {} })
      await loadData()
    } catch (err: any) {
      toast.error(err?.message || (language === 'zh' ? '添加失败' : 'Add failed'))
    }
  }

  const handleValidateCredentials = async (channelId: ChannelId) => {
    try {
      const result = await api.channel.validateCredentials(channelId, newAccountForm.credentials || {})
      if (result?.valid) {
        toast.success(language === 'zh' ? '验证通过' : 'Valid credentials')
      } else {
        toast.error(result?.error || (language === 'zh' ? '验证失败' : 'Invalid credentials'))
      }
    } catch (err: any) {
      toast.error(err?.message || (language === 'zh' ? '验证失败' : 'Validation failed'))
    }
  }

  const getAccountStatus = (_channelId: ChannelId, accountId: string): ChannelAccountSnapshot | undefined => {
    return statuses.find(s => s.accountId === accountId)
  }

  const getConfig = (channelId: ChannelId): ChannelConfig | undefined => {
    return configs.find(c => c.id === channelId)
  }

  const renderStatusBadge = (status?: ChannelAccountSnapshot) => {
    if (!status) return <span className="text-xs text-text-muted">—</span>
    switch (status.status) {
      case 'connected':
        return (
          <span className="flex items-center gap-1 text-xs text-green-500">
            <CheckCircle className="w-3 h-3" />
            {language === 'zh' ? '已连接' : 'Connected'}
          </span>
        )
      case 'connecting':
        return (
          <span className="flex items-center gap-1 text-xs text-yellow-500">
            <Loader2 className="w-3 h-3 animate-spin" />
            {language === 'zh' ? '连接中' : 'Connecting'}
          </span>
        )
      case 'error':
        return (
          <span className="flex items-center gap-1 text-xs text-red-500" title={status.lastError || ''}>
            <AlertCircle className="w-3 h-3" />
            {language === 'zh' ? '错误' : 'Error'}
          </span>
        )
      default:
        return (
          <span className="flex items-center gap-1 text-xs text-text-muted">
            <PowerOff className="w-3 h-3" />
            {language === 'zh' ? '未连接' : 'Disconnected'}
          </span>
        )
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-text-primary">
          {language === 'zh' ? '多渠道集成' : 'Multi-Channel Integration'}
        </h3>
        <Button variant="ghost" size="sm" onClick={loadData} disabled={loading}>
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      <p className="text-sm text-text-muted">
        {language === 'zh'
          ? '配置即时通讯平台集成，支持飞书、企业微信、WhatsApp等渠道的消息收发。'
          : 'Configure IM platform integrations for messaging across Feishu, WeCom, WhatsApp, and more.'}
      </p>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="flex items-center gap-3 text-sm text-text-muted">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>{language === 'zh' ? '正在加载渠道配置...' : 'Loading channel configuration...'}</span>
          </div>
        </div>
      ) : channels.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-text-muted">
          <MessageCircle className="w-8 h-8 mb-3 opacity-50" />
          <p className="text-sm">{language === 'zh' ? '暂无可用的渠道插件' : 'No channel plugins available'}</p>
          <p className="text-xs mt-1">{language === 'zh' ? '请检查渠道服务是否正常启动' : 'Please check if the channel service is running properly'}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {channels.sort((a, b) => a.meta.order - b.meta.order).map(channel => {
          const config = getConfig(channel.id)
          const schema = secretSchemas[channel.id] || []
          const isExpanded = expandedChannel === channel.id
          const accounts = config?.accounts || []

          return (
            <div key={channel.id} className="rounded-xl border border-border/50 bg-surface/50 overflow-hidden">
              <button
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-active/30 transition-colors"
                onClick={() => setExpandedChannel(isExpanded ? null : channel.id)}
              >
                {CHANNEL_ICONS[channel.id]}
                <div className="flex-1 text-left">
                  <div className="text-sm font-medium text-text-primary">
                    {language === 'zh' ? channel.meta.labelZh : channel.meta.label}
                  </div>
                  <div className="text-xs text-text-muted">
                    {language === 'zh' ? channel.meta.descriptionZh : channel.meta.description}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {accounts.length > 0 && (
                    <span className="text-xs text-text-muted">
                      {accounts.filter(a => a.enabled).length}/{accounts.length} {language === 'zh' ? '账户' : 'accounts'}
                    </span>
                  )}
                  {isExpanded ? <ChevronDown className="w-4 h-4 text-text-muted" /> : <ChevronRight className="w-4 h-4 text-text-muted" />}
                </div>
              </button>

              {isExpanded && (
                <div className="border-t border-border/30 px-4 py-3 space-y-3">
                  {accounts.length === 0 && (
                    <div className="text-sm text-text-muted py-2 text-center">
                      {language === 'zh' ? '暂无账户，点击下方添加' : 'No accounts yet. Add one below.'}
                    </div>
                  )}

                  {accounts.map(account => {
                    const status = getAccountStatus(channel.id, account.id)
                    const isAccountExpanded = expandedAccount === account.id
                    const isLoading = actionLoading === `${channel.id}:${account.id}`

                    return (
                      <div key={account.id} className="rounded-lg border border-border/30 bg-surface/30">
                        <div className="flex items-center gap-3 px-3 py-2">
                          <button
                            className="text-text-muted hover:text-text-primary"
                            onClick={() => setExpandedAccount(isAccountExpanded ? null : account.id)}
                          >
                            {isAccountExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                          </button>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm text-text-primary truncate">{account.name || account.id}</div>
                          </div>
                          {renderStatusBadge(status)}
                          <div className="flex items-center gap-1">
                            {status?.connected ? (
                              <Button variant="ghost" size="sm" onClick={() => handleDisconnect(channel.id, account.id)} disabled={isLoading}>
                                {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <PowerOff className="w-3 h-3" />}
                              </Button>
                            ) : (
                              <Button variant="ghost" size="sm" onClick={() => handleConnect(channel.id, account.id)} disabled={isLoading}>
                                {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Power className="w-3 h-3" />}
                              </Button>
                            )}
                            <Button variant="ghost" size="sm" onClick={() => handleRemoveAccount(channel.id, account.id)}>
                              <Trash2 className="w-3 h-3 text-red-400" />
                            </Button>
                          </div>
                        </div>

                        {isAccountExpanded && (
                          <div className="border-t border-border/20 px-3 py-2 space-y-2">
                            {schema.map(s => (
                              <div key={s.key} className="space-y-1">
                                <label className="text-xs text-text-muted">
                                  {language === 'zh' ? s.labelZh : s.label}
                                  {s.required && <span className="text-red-400 ml-1">*</span>}
                                </label>
                                <div className="relative">
                                  <Input
                                    type={s.secret && !showSecrets[`${account.id}:${s.key}`] ? 'password' : 'text'}
                                    value={account.credentials[s.key] || ''}
                                    readOnly
                                    className="text-xs pr-8"
                                    placeholder={s.placeholder}
                                  />
                                  {s.secret && (
                                    <button
                                      className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                                      onClick={() => setShowSecrets(prev => ({ ...prev, [`${account.id}:${s.key}`]: !prev[`${account.id}:${s.key}`] }))}
                                    >
                                      {showSecrets[`${account.id}:${s.key}`] ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                            <div className="border-t border-border/20 pt-2 mt-1">
                              <div className="flex items-center gap-1.5 mb-1">
                                <Settings2 className="w-3 h-3 text-text-muted" />
                                <span className="text-xs text-text-muted">
                                  {language === 'zh' ? '模型' : 'Model'}
                                </span>
                              </div>
                              {account.llmConfig?.useGlobal === false ? (
                                <span className="text-xs text-text-primary">
                                  {account.llmConfig.provider}/{account.llmConfig.model}
                                </span>
                              ) : (
                                <span className="text-xs text-text-muted">
                                  {language === 'zh'
                                    ? `全局: ${llmConfig.provider}/${llmConfig.model}`
                                    : `Global: ${llmConfig.provider}/${llmConfig.model}`}
                                </span>
                              )}
                            </div>
                            {status?.lastError && (
                              <div className="text-xs text-red-400 bg-red-500/10 rounded px-2 py-1">
                                {status.lastError}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}

                  {showAddAccount === channel.id ? (
                    <div className="rounded-lg border border-accent/30 bg-accent/5 p-3 space-y-3">
                      <h4 className="text-sm font-medium text-text-primary">
                        {language === 'zh' ? '添加新账户' : 'Add New Account'}
                      </h4>
                      <div className="space-y-2">
                        <div>
                          <label className="text-xs text-text-muted">
                            {language === 'zh' ? '账户ID' : 'Account ID'} <span className="text-red-400">*</span>
                          </label>
                          <Input
                            value={newAccountForm.id || ''}
                            onChange={e => setNewAccountForm(prev => ({ ...prev, id: e.target.value }))}
                            placeholder={language === 'zh' ? '例如: my-feishu-bot' : 'e.g. my-feishu-bot'}
                            className="text-xs"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-text-muted">
                            {language === 'zh' ? '账户名称' : 'Account Name'}
                          </label>
                          <Input
                            value={newAccountForm.name || ''}
                            onChange={e => setNewAccountForm(prev => ({ ...prev, name: e.target.value }))}
                            placeholder={language === 'zh' ? '例如: 我的飞书机器人' : 'e.g. My Feishu Bot'}
                            className="text-xs"
                          />
                        </div>
                        {schema.map(s => (
                          <div key={s.key}>
                            <label className="text-xs text-text-muted">
                              {language === 'zh' ? s.labelZh : s.label}
                              {s.required && <span className="text-red-400 ml-1">*</span>}
                            </label>
                            <div className="relative">
                              <Input
                                type={s.secret && !showSecrets[`new:${s.key}`] ? 'password' : 'text'}
                                value={newAccountForm.credentials?.[s.key] || ''}
                                onChange={e => setNewAccountForm(prev => ({
                                  ...prev,
                                  credentials: { ...prev.credentials, [s.key]: e.target.value },
                                }))}
                                placeholder={s.placeholder}
                                className="text-xs pr-8"
                              />
                              {s.secret && (
                                <button
                                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                                  onClick={() => setShowSecrets(prev => ({ ...prev, [`new:${s.key}`]: !prev[`new:${s.key}`] }))}
                                >
                                  {showSecrets[`new:${s.key}`] ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                                </button>
                              )}
                            </div>
                            <p className="text-xs text-text-muted mt-0.5">
                              {language === 'zh' ? s.descriptionZh : s.description}
                            </p>
                          </div>
                        ))}

                        <div className="border-t border-border/30 pt-2 mt-2">
                          <div className="flex items-center gap-2 mb-2">
                            <Settings2 className="w-3.5 h-3.5 text-text-muted" />
                            <label className="text-xs font-medium text-text-muted">
                              {language === 'zh' ? '模型配置' : 'Model Configuration'}
                            </label>
                          </div>
                          <div className="flex items-center gap-2 mb-2">
                            <button
                              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs transition-colors ${
                                (newAccountForm.llmConfig?.useGlobal !== false)
                                  ? 'bg-accent/10 text-accent border border-accent/30'
                                  : 'text-text-muted hover:text-text-primary border border-border/30'
                              }`}
                              onClick={() => setNewAccountForm(prev => ({
                                ...prev,
                                llmConfig: { ...prev.llmConfig, useGlobal: true },
                              }))}
                            >
                              <Globe className="w-3 h-3" />
                              {language === 'zh' ? '使用全局配置' : 'Use Global'}
                            </button>
                            <button
                              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs transition-colors ${
                                (newAccountForm.llmConfig?.useGlobal === false)
                                  ? 'bg-accent/10 text-accent border border-accent/30'
                                  : 'text-text-muted hover:text-text-primary border border-border/30'
                              }`}
                              onClick={() => setNewAccountForm(prev => ({
                                ...prev,
                                llmConfig: {
                                  useGlobal: false,
                                  provider: prev.llmConfig?.provider || llmConfig.provider,
                                  model: prev.llmConfig?.model || llmConfig.model,
                                },
                              }))}
                            >
                              <Settings2 className="w-3 h-3" />
                              {language === 'zh' ? '自定义' : 'Custom'}
                            </button>
                          </div>
                          {newAccountForm.llmConfig?.useGlobal === false && (
                            <div className="space-y-2 pl-1">
                              <div>
                                <label className="text-xs text-text-muted">
                                  {language === 'zh' ? '供应商' : 'Provider'}
                                </label>
                                <select
                                  value={newAccountForm.llmConfig?.provider || ''}
                                  onChange={e => {
                                    const providerId = e.target.value
                                    const provider = availableProviders.find(p => p.id === providerId)
                                    const defaultModel = provider?.models[0] || ''
                                    setNewAccountForm(prev => ({
                                      ...prev,
                                      llmConfig: { useGlobal: false, provider: providerId, model: defaultModel },
                                    }))
                                  }}
                                  className="w-full mt-1 px-2 py-1.5 rounded-md border border-border/50 bg-surface text-xs text-text-primary focus:outline-none focus:border-accent/40"
                                >
                                  <option value="">{language === 'zh' ? '选择供应商' : 'Select provider'}</option>
                                  {availableProviders.map(p => (
                                    <option key={p.id} value={p.id}>{p.name}</option>
                                  ))}
                                </select>
                              </div>
                              {newAccountForm.llmConfig?.provider && (
                                <div>
                                  <label className="text-xs text-text-muted">
                                    {language === 'zh' ? '模型' : 'Model'}
                                  </label>
                                  <select
                                    value={newAccountForm.llmConfig?.model || ''}
                                    onChange={e => setNewAccountForm(prev => ({
                                      ...prev,
                                      llmConfig: { useGlobal: false, provider: prev.llmConfig?.provider, model: e.target.value },
                                    }))}
                                    className="w-full mt-1 px-2 py-1.5 rounded-md border border-border/50 bg-surface text-xs text-text-primary focus:outline-none focus:border-accent/40"
                                  >
                                    <option value="">{language === 'zh' ? '选择模型' : 'Select model'}</option>
                                    {availableProviders.find(p => p.id === newAccountForm.llmConfig?.provider)?.models.map(m => (
                                      <option key={m} value={m}>{m}</option>
                                    ))}
                                  </select>
                                </div>
                              )}
                            </div>
                          )}
                          {(newAccountForm.llmConfig?.useGlobal !== false) && (
                            <p className="text-xs text-text-muted">
                              {language === 'zh'
                                ? `将使用全局配置: ${llmConfig.provider}/${llmConfig.model}`
                                : `Will use global config: ${llmConfig.provider}/${llmConfig.model}`}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button variant="ghost" size="sm" onClick={() => handleValidateCredentials(channel.id)}>
                          <Shield className="w-3 h-3 mr-1" />
                          {language === 'zh' ? '验证凭据' : 'Validate'}
                        </Button>
                        <div className="flex-1" />
                        <Button variant="ghost" size="sm" onClick={() => { setShowAddAccount(null); setNewAccountForm({ id: '', name: '', enabled: true, credentials: {} }) }}>
                          {language === 'zh' ? '取消' : 'Cancel'}
                        </Button>
                        <Button variant="primary" size="sm" onClick={handleAddAccount}>
                          {language === 'zh' ? '添加' : 'Add'}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button variant="ghost" size="sm" className="w-full" onClick={() => { setShowAddAccount(channel.id); setNewAccountForm({ id: '', name: '', enabled: true, credentials: {} }) }}>
                      <Plus className="w-4 h-4 mr-1" />
                      {language === 'zh' ? '添加账户' : 'Add Account'}
                    </Button>
                  )}
                </div>
              )}
            </div>
          )
        })}
        </div>
      )}
    </div>
  )
}
