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
  Pencil,
  X,
  Check,
} from 'lucide-react'
import { ActionButton, TextField } from '@components/ui'
import { toast } from '@components/foundation/NotificationProvider'
import { getAPI } from '../../../adapters/electronBridge'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { BUILTIN_PROVIDERS } from '@shared/configuration/aiProviders'
import { WeixinQRLogin } from './WeixinQRLogin'
import type { ChannelId, ChannelAccountConfig, ChannelAccountSnapshot, ChannelConfig, ChannelSecretSchema } from '@shared/protocols/channel'
import { t, type Language } from '@renderer/i18n'

// 渠道 logo
import feishuLogo from '@renderer/assets/channel/feishu.svg'
import wechatLogo from '@renderer/assets/channel/wechat.svg'
import weixinLogo from '@renderer/assets/channel/weixin.svg'
import dingdingLogo from '@renderer/assets/channel/dingding.svg'
import whatsappLogo from '@renderer/assets/channel/whatsapp.svg'

/** 渠道 logo 组件 */
function ChannelLogo({ channelId, className }: { channelId: ChannelId; className?: string }) {
  const logoMap: Partial<Record<ChannelId, string>> = {
    feishu: feishuLogo,
    wechat: wechatLogo,
    weixin: weixinLogo,
    dingtalk: dingdingLogo,
    whatsapp: whatsappLogo,
  }
  const src = logoMap[channelId]
  if (src) {
    return <img src={src} alt={channelId} className={className || 'w-5 h-5'} />
  }
  // 无 logo 的渠道使用 lucide 图标兜底
  const fallbackIcons: Partial<Record<ChannelId, React.ReactNode>> = {
    whatsapp: <Smartphone className={className || 'w-4 h-4'} />,
    telegram: <MessageCircle className={className || 'w-4 h-4'} />,
    slack: <MessageSquare className={className || 'w-4 h-4'} />,
  }
  return <>{fallbackIcons[channelId] || <MessageCircle className={className || 'w-4 h-4'} />}</>
}

interface ChannelSettingsProps {
  language: 'en' | 'zh'
}

function WebhookUrlDisplay({ channelId, language }: { channelId: ChannelId; language: 'en' | 'zh' }) {
  const api = getAPI()
  const [webhookInfo, setWebhookInfo] = useState<{ running: boolean; port: number; url: string } | null>(null)

  useEffect(() => {
    api.channel.getWebhookInfo().then(res => {
      if (res?.success) setWebhookInfo({ running: res.running, port: res.port, url: res.url })
    }).catch(() => {})
  }, [])

  const path = channelId === 'wechat' ? '/webhook/wechat' : '/webhook/whatsapp'
  const fullUrl = webhookInfo ? `${webhookInfo.url}${path}` : ''

  return (
    <div className="rounded-lg border border-border/30 bg-surface/30 px-3 py-2 space-y-1">
      <div className="text-xs font-medium text-text-muted">
        {t('settings.webhookcallbackurl', language as Language)}
      </div>
      <div className="flex items-center gap-2">
        <code className="flex-1 text-xs bg-surface-active/30 px-2 py-1 rounded text-text-primary break-all">
          {fullUrl || (t('settings.notrunning', language as Language))}
        </code>
        {fullUrl && (
          <ActionButton
            variant="ghost"
            size="sm"
            onClick={() => {
              navigator.clipboard.writeText(fullUrl)
              toast.success(t('settings.copied', language as Language))
            }}
          >
            <CheckCircle className="w-3 h-3" />
          </ActionButton>
        )}
      </div>
      <div className="text-xs text-text-muted">
        {t('settings.usethisurlasthe', language as Language)}
      </div>
    </div>
  )
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
  const [addingAccount, setAddingAccount] = useState(false)
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({})
  const [newAccountForm, setNewAccountForm] = useState<Partial<ChannelAccountConfig>>({
    id: '',
    name: '',
    enabled: true,
    credentials: {},
  })
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<Partial<ChannelAccountConfig>>({})

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
      toast.success(t('settings.connected', language as Language))
      await loadData()
    } catch (err: any) {
      toast.error(err?.message || (t('settings.connectionfailed', language as Language)))
    } finally {
      setActionLoading(null)
    }
  }

  const handleDisconnect = async (channelId: ChannelId, accountId: string) => {
    setActionLoading(`${channelId}:${accountId}`)
    try {
      await api.channel.disconnectAccount(channelId, accountId)
      toast.success(t('settings.disconnected', language as Language))
      await loadData()
    } catch (err: any) {
      toast.error(err?.message || (t('settings.disconnectfailed', language as Language)))
    } finally {
      setActionLoading(null)
    }
  }

  const handleRemoveAccount = async (channelId: ChannelId, accountId: string) => {
    try {
      await api.channel.removeAccount(channelId, accountId)
      toast.success(t('settings.removed', language as Language))
      await loadData()
    } catch (err: any) {
      toast.error(err?.message || (t('settings.removefailed', language as Language)))
    }
  }

  const handleAddAccount = async () => {
    if (!showAddAccount || addingAccount) return
    const schema = secretSchemas[showAddAccount] || []
    const missingRequired = schema.filter(s => s.required && !newAccountForm.credentials?.[s.key])
    if (missingRequired.length > 0) {
      toast.error(t('settings.pleasefillallrequiredfields', language as Language))
      return
    }
    if (!newAccountForm.id) {
      toast.error(t('settings.pleaseenteraccountid', language as Language))
      return
    }
    setAddingAccount(true)
    const account: ChannelAccountConfig = {
      id: newAccountForm.id,
      name: newAccountForm.name || newAccountForm.id,
      enabled: newAccountForm.enabled ?? true,
      credentials: newAccountForm.credentials || {},
      llmConfig: undefined,
    }
    try {
      await api.channel.addAccount(showAddAccount, account)
      toast.success(t('settings.accountadded', language as Language))
      setShowAddAccount(null)
      setNewAccountForm({ id: '', name: '', enabled: true, credentials: {} })
      await loadData()
    } catch (err: any) {
      toast.error(err?.message || (t('settings.addfailed', language as Language)))
    } finally {
      setAddingAccount(false)
    }
  }

  const handleValidateCredentials = async (channelId: ChannelId) => {
    try {
      const result = await api.channel.validateCredentials(channelId, newAccountForm.credentials || {})
      if (result?.valid) {
        toast.success(t('settings.validcredentials', language as Language))
      } else {
        toast.error(result?.error || (t('settings.invalidcredentials', language as Language)))
      }
    } catch (err: any) {
      toast.error(err?.message || (t('settings.validationfailed', language as Language)))
    }
  }

  const startEditAccount = (channelId: ChannelId, account: ChannelAccountConfig) => {
    setEditingAccountId(`${channelId}:${account.id}`)
    setEditForm({
      id: account.id,
      name: account.name,
      enabled: account.enabled,
      credentials: { ...account.credentials },
    })
  }

  const handleSaveAccount = async (channelId: ChannelId) => {
    if (!editForm.id) return
    const config = getConfig(channelId)
    if (!config) return
    const original = config.accounts.find(a => a.id === editForm.id)
    if (!original) return

    const updated: ChannelAccountConfig = {
      ...original,
      name: editForm.name || editForm.id,
      credentials: { ...original.credentials, ...editForm.credentials },
      llmConfig: undefined,
    }

    try {
      await api.channel.updateAccount(channelId, updated)
      toast.success(t('settings.saved', language as Language))
      setEditingAccountId(null)
      setEditForm({})
      await loadData()
    } catch (err: any) {
      toast.error(err?.message || (t('settings.savefailed', language as Language)))
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
            {t('settings.connected2', language as Language)}
          </span>
        )
      case 'connecting':
        return (
          <span className="flex items-center gap-1 text-xs text-yellow-500">
            <Loader2 className="w-3 h-3 animate-spin" />
            {t('settings.connecting', language as Language)}
          </span>
        )
      case 'error':
        return (
          <span className="flex items-center gap-1 text-xs text-red-500" title={status.lastError || ''}>
            <AlertCircle className="w-3 h-3" />
            {t('settings.error', language as Language)}
          </span>
        )
      default:
        return (
          <span className="flex items-center gap-1 text-xs text-text-muted">
            <PowerOff className="w-3 h-3" />
            {t('settings.disconnected2', language as Language)}
          </span>
        )
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-text-primary">
          {t('settings.multichannelintegration', language as Language)}
        </h3>
        <ActionButton variant="ghost" size="sm" onClick={loadData} disabled={loading}>
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </ActionButton>
      </div>

      <p className="text-sm text-text-muted">
        {t('settings.configureimplatformintegrationsfor', language as Language)}
      </p>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="flex items-center gap-3 text-sm text-text-muted">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>{t('settings.progressindicatorchannelconfiguration', language as Language)}</span>
          </div>
        </div>
      ) : channels.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-text-muted">
          <MessageCircle className="w-8 h-8 mb-3 opacity-50" />
          <p className="text-sm">{t('settings.nochannelpluginsavailable', language as Language)}</p>
          <p className="text-xs mt-1">{t('settings.pleasecheckifthechannel', language as Language)}</p>
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
                <ChannelLogo channelId={channel.id} />
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
                      {accounts.filter(a => a.enabled).length}/{accounts.length} {t('settings.accounts', language as Language)}
                    </span>
                  )}
                  {isExpanded ? <ChevronDown className="w-4 h-4 text-text-muted" /> : <ChevronRight className="w-4 h-4 text-text-muted" />}
                </div>
              </button>

              {isExpanded && (
                <div className="border-t border-border/30 px-4 py-3 space-y-3">
                  {accounts.length === 0 && (
                    <div className="text-sm text-text-muted py-2 text-center">
                      {t('settings.noaccountsyetaddone', language as Language)}
                    </div>
                  )}

                  {(channel.id === 'wechat' || channel.id === 'whatsapp') && (
                    <WebhookUrlDisplay channelId={channel.id} language={language} />
                  )}

                  {channel.id === 'weixin' && (
                    <WeixinQRLogin
                      language={language}
                      onLoginSuccess={async (token, baseUrl) => {
                        // 扫码登录成功后，自动添加账户
                        const accountId = `weixin-bot-${Date.now().toString(36)}`
                        const account: ChannelAccountConfig = {
                          id: accountId,
                          name: language === 'zh' ? '我的微信机器人' : 'My WeChat Bot',
                          enabled: true,
                          credentials: { token, baseUrl },
                        }
                        try {
                          await api.channel.addAccount('weixin', account)
                          toast.success(language === 'zh' ? '微信登录成功，账户已自动添加' : 'WeChat login successful, account auto-added')
                          await loadData()
                        } catch (err: any) {
                          // 自动添加失败时，回退到手动填写
                          toast.error(err?.message || (language === 'zh' ? '自动添加失败，请手动添加' : 'Auto-add failed, please add manually'))
                          setShowAddAccount('weixin')
                          setNewAccountForm({
                            id: accountId,
                            name: language === 'zh' ? '我的微信机器人' : 'My WeChat Bot',
                            enabled: true,
                            credentials: { token, baseUrl },
                          })
                        }
                      }}
                    />
                  )}

                  {accounts.map(account => {
                    const status = getAccountStatus(channel.id, account.id)
                    const isAccountExpanded = expandedAccount === account.id
                    const isLoading = actionLoading === `${channel.id}:${account.id}`
                    const isEditing = editingAccountId === `${channel.id}:${account.id}`

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
                              <ActionButton variant="ghost" size="sm" onClick={() => handleDisconnect(channel.id, account.id)} disabled={isLoading}>
                                {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <PowerOff className="w-3 h-3" />}
                              </ActionButton>
                            ) : (
                              <ActionButton variant="ghost" size="sm" onClick={() => handleConnect(channel.id, account.id)} disabled={isLoading}>
                                {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Power className="w-3 h-3" />}
                              </ActionButton>
                            )}
                            <ActionButton variant="ghost" size="sm" onClick={() => {
                              if (isEditing) {
                                setEditingAccountId(null)
                                setEditForm({})
                              } else {
                                startEditAccount(channel.id, account)
                              }
                              setExpandedAccount(isAccountExpanded ? null : account.id)
                            }}>
                              {isEditing ? <X className="w-3 h-3" /> : <Pencil className="w-3 h-3" />}
                            </ActionButton>
                            <ActionButton variant="ghost" size="sm" onClick={() => handleRemoveAccount(channel.id, account.id)}>
                              <Trash2 className="w-3 h-3 text-red-400" />
                            </ActionButton>
                          </div>
                        </div>

                        {isAccountExpanded && (
                          <div className="border-t border-border/20 px-3 py-2 space-y-2">
                            {isEditing ? (
                              <>
                                <div>
                                  <label className="text-xs text-text-muted">
                                    {t('settings.accountname', language as Language)}
                                  </label>
                                  <TextField
                                    value={editForm.name || ''}
                                    onChange={e => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                                    className="text-xs"
                                  />
                                </div>
                                {schema.map(s => (
                                  <div key={s.key} className="space-y-1">
                                    <label className="text-xs text-text-muted">
                                      {language === 'zh' ? s.labelZh : s.label}
                                    </label>
                                    <div className="relative">
                                      <TextField
                                        type={s.secret && !showSecrets[`edit:${s.key}`] ? 'password' : 'text'}
                                        value={editForm.credentials?.[s.key] ?? account.credentials[s.key] ?? ''}
                                        onChange={e => setEditForm(prev => ({
                                          ...prev,
                                          credentials: { ...prev.credentials, [s.key]: e.target.value },
                                        }))}
                                        placeholder={s.placeholder}
                                        className="text-xs pr-8"
                                      />
                                      {s.secret && (
                                        <button
                                          className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                                          onClick={() => setShowSecrets(prev => ({ ...prev, [`edit:${s.key}`]: !prev[`edit:${s.key}`] }))}
                                        >
                                          {showSecrets[`edit:${s.key}`] ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                ))}

                                <div className="flex items-center gap-2 pt-2 border-t border-border/20">
                                  <div className="flex-1" />
                                  <ActionButton variant="ghost" size="sm" onClick={() => { setEditingAccountId(null); setEditForm({}) }}>
                                    {t('settings.cancel', language as Language)}
                                  </ActionButton>
                                  <ActionButton variant="primary" size="sm" onClick={() => handleSaveAccount(channel.id)}>
                                    <Check className="w-3 h-3 mr-1" />
                                    {t('settings.save', language as Language)}
                                  </ActionButton>
                                </div>
                              </>
                            ) : (
                              <>
                                {schema.map(s => (
                                  <div key={s.key} className="space-y-1">
                                    <label className="text-xs text-text-muted">
                                      {language === 'zh' ? s.labelZh : s.label}
                                    </label>
                                    <div className="relative">
                                      <TextField
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
                              </>
                            )}
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
                        {t('settings.addnewaccount', language as Language)}
                      </h4>
                      <div className="space-y-2">
                        <div>
                          <label className="text-xs text-text-muted">
                            {t('settings.accountid', language as Language)} <span className="text-red-400">*</span>
                          </label>
                          <TextField
                            value={newAccountForm.id || ''}
                            onChange={e => setNewAccountForm(prev => ({ ...prev, id: e.target.value }))}
                            placeholder={language === 'zh' ? `例如: my-${showAddAccount}-bot` : `e.g. my-${showAddAccount}-bot`}
                            className="text-xs"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-text-muted">
                            {t('settings.accountname2', language as Language)}
                          </label>
                          <TextField
                            value={newAccountForm.name || ''}
                            onChange={e => setNewAccountForm(prev => ({ ...prev, name: e.target.value }))}
                            placeholder={(() => {
                              const nameMap: Record<string, string> = {
                                feishu: language === 'zh' ? '例如: 我的飞书机器人' : 'e.g. My Feishu Bot',
                                wechat: language === 'zh' ? '例如: 我的企业微信机器人' : 'e.g. My WeChat Work Bot',
                                weixin: language === 'zh' ? '例如: 我的微信机器人' : 'e.g. My WeChat Bot',
                                whatsapp: language === 'zh' ? '例如: 我的WhatsApp机器人' : 'e.g. My WhatsApp Bot',
                                telegram: language === 'zh' ? '例如: 我的Telegram机器人' : 'e.g. My Telegram Bot',
                                dingtalk: language === 'zh' ? '例如: 我的钉钉机器人' : 'e.g. My DingTalk Bot',
                                slack: language === 'zh' ? '例如: 我的Slack机器人' : 'e.g. My Slack Bot',
                              }
                              return nameMap[showAddAccount || ''] || (language === 'zh' ? '例如: 我的机器人' : 'e.g. My Bot')
                            })()}
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
                              <TextField
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
                      </div>
                      <div className="flex items-center gap-2">
                        <ActionButton variant="ghost" size="sm" onClick={() => handleValidateCredentials(channel.id)}>
                          <Shield className="w-3 h-3 mr-1" />
                          {t('settings.validate', language as Language)}
                        </ActionButton>
                        <div className="flex-1" />
                        <ActionButton variant="ghost" size="sm" onClick={() => { setShowAddAccount(null); setNewAccountForm({ id: '', name: '', enabled: true, credentials: {} }) }}>
                          {t('settings.cancel2', language as Language)}
                        </ActionButton>
                        <ActionButton variant="primary" size="sm" onClick={handleAddAccount} disabled={addingAccount}>
                          {addingAccount ? <Loader2 className="w-3 h-3 animate-spin" /> : t('settings.add', language as Language)}
                        </ActionButton>
                      </div>
                    </div>
                  ) : (
                    <ActionButton variant="ghost" size="sm" className="w-full" onClick={() => { setShowAddAccount(channel.id); setNewAccountForm({ id: '', name: '', enabled: true, credentials: {} }) }}>
                      <Plus className="w-4 h-4 mr-1" />
                      {t('settings.addaccount', language as Language)}
                    </ActionButton>
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
