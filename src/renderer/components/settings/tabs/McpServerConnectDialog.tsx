/**
 * MCP 添加服务器模态框
 * 直接进入手动自定义配置模式（本地 stdio / 远程 HTTP）
 */

import { useState } from 'react'
import {
  Plus,
  AlertCircle,
  Loader2,
  Trash2,
} from 'lucide-react'
import { ActionButton, TextField, OverlayDialog } from '@components/ui'
import { t, type Language } from '@renderer/i18n'

interface McpAddServerModalProps {
  isOpen: boolean
  onClose: () => void
  onAdd: (config: McpServerFormData) => Promise<boolean>
  language: 'en' | 'zh'
  existingServerIds: string[]
}

export interface McpServerFormData {
  type: 'local' | 'remote' | 'builtin'
  id: string
  name: string
  // 本地服务器字段
  command?: string
  args?: string[]
  env?: Record<string, string>
  // 远程服务器字段
  url?: string
  headers?: Record<string, string>
  oauth?: { clientId?: string; clientSecret?: string; scope?: string } | false
  // 内置进程内服务器字段
  builtin?: string
  // 通用字段
  autoApprove?: string[]
  disabled?: boolean
  /** 来源预设 ID */
  presetId?: string
  /** 保存层级 */
  saveLevel?: 'user' | 'workspace'
}

type ServerType = 'local' | 'remote'

export default function McpServerConnectDialog({
  isOpen,
  onClose,
  onAdd,
  language,
  existingServerIds,
}: McpAddServerModalProps) {
  const [serverType, setServerType] = useState<ServerType>('local')
  const [formData, setFormData] = useState<McpServerFormData>({
    type: 'local',
    id: '',
    name: '',
    command: '',
    args: [],
    env: {},
    autoApprove: [],
    disabled: false,
  })
  const [argsInput, setArgsInput] = useState('')
  const [autoApproveInput, setAutoApproveInput] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 远程服务器字段
  const [remoteUrl, setRemoteUrl] = useState('')
  const [oauthClientId, setOauthClientId] = useState('')
  const [oauthClientSecret, setOauthClientSecret] = useState('')
  const [oauthScope, setOauthScope] = useState('')
  const [enableOAuth, setEnableOAuth] = useState(true)

  // 自定义环境变量（本地）
  const [customEnvPairs, setCustomEnvPairs] = useState<Array<{ key: string; value: string; id: number }>>([])
  const [nextEnvId, setNextEnvId] = useState(0)

  // 自定义请求头（远程）
  const [customHeaderPairs, setCustomHeaderPairs] = useState<Array<{ key: string; value: string; id: number }>>([])
  const [nextHeaderId, setNextHeaderId] = useState(0)

  // 保存层级
  const [saveLevel, setSaveLevel] = useState<'user' | 'workspace'>('user')

  // env pair 操作
  const addEnvPair = () => {
    setCustomEnvPairs(prev => [...prev, { key: '', value: '', id: nextEnvId }])
    setNextEnvId(n => n + 1)
  }
  const updateEnvPair = (id: number, field: 'key' | 'value', val: string) =>
    setCustomEnvPairs(prev => prev.map(p => p.id === id ? { ...p, [field]: val } : p))
  const removeEnvPair = (id: number) =>
    setCustomEnvPairs(prev => prev.filter(p => p.id !== id))

  // header pair 操作
  const addHeaderPair = () => {
    setCustomHeaderPairs(prev => [...prev, { key: '', value: '', id: nextHeaderId }])
    setNextHeaderId(n => n + 1)
  }
  const updateHeaderPair = (id: number, field: 'key' | 'value', val: string) =>
    setCustomHeaderPairs(prev => prev.map(p => p.id === id ? { ...p, [field]: val } : p))
  const removeHeaderPair = (id: number) =>
    setCustomHeaderPairs(prev => prev.filter(p => p.id !== id))

  // 提交表单
  const handleSubmit = async () => {
    setError(null)
    setIsSubmitting(true)

    try {
      let config: McpServerFormData

      if (serverType === 'remote') {
        if (!formData.id.trim()) throw new Error(t('mcp.fillServerId', language as Language))
        if (!formData.name.trim()) throw new Error(t('mcp.fillServerName', language as Language))
        if (!remoteUrl.trim()) throw new Error(t('mcp.fillServerUrl', language as Language))
        if (existingServerIds.includes(formData.id)) throw new Error(t('mcp.serverIdExists', language as Language))

        const headers: Record<string, string> = {}
        for (const { key, value } of customHeaderPairs) {
          if (key.trim()) headers[key.trim()] = value
        }

        config = {
          type: 'remote',
          id: formData.id,
          name: formData.name,
          url: remoteUrl,
          headers: Object.keys(headers).length > 0 ? headers : undefined,
          oauth: enableOAuth
            ? { clientId: oauthClientId || undefined, clientSecret: oauthClientSecret || undefined, scope: oauthScope || undefined }
            : false,
          autoApprove: autoApproveInput.split(/[,\s]+/).filter(Boolean),
          disabled: false,
        }
      } else {
        if (!formData.id.trim()) throw new Error(t('mcp.fillServerId', language as Language))
        if (!formData.name.trim()) throw new Error(t('mcp.fillServerName', language as Language))
        if (!formData.command?.trim()) throw new Error(t('mcp.fillCommand', language as Language))
        if (existingServerIds.includes(formData.id)) throw new Error(t('mcp.serverIdExists', language as Language))

        const env: Record<string, string> = {}
        for (const { key, value } of customEnvPairs) {
          if (key.trim()) env[key.trim()] = value
        }

        config = {
          type: 'local',
          id: formData.id,
          name: formData.name,
          command: formData.command,
          args: argsInput.split(/\s+/).filter(Boolean),
          env: Object.keys(env).length > 0 ? env : undefined,
          autoApprove: autoApproveInput.split(/[,\s]+/).filter(Boolean),
          disabled: false,
        }
      }

      config.saveLevel = saveLevel
      const success = await onAdd(config)
      if (success) {
        onClose()
        resetForm()
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const resetForm = () => {
    setServerType('local')
    setFormData({ type: 'local', id: '', name: '', command: '', args: [], env: {}, autoApprove: [], disabled: false })
    setArgsInput('')
    setAutoApproveInput('')
    setRemoteUrl('')
    setOauthClientId('')
    setOauthClientSecret('')
    setOauthScope('')
    setEnableOAuth(true)
    setCustomEnvPairs([])
    setCustomHeaderPairs([])
    setError(null)
  }

  return (
    <OverlayDialog
      isOpen={isOpen}
      onClose={() => { onClose(); resetForm() }}
      title={t('mcp.addCustomServer', language as Language)}
      size="2xl"
    >
      <div className="space-y-4">
        {/* ===== 自定义配置视图 ===== */}
        <div className="space-y-4">
          {/* 服务器类型 */}
          <div className="flex gap-2 p-1 bg-surface/30 rounded-lg">
            {(['local', 'remote'] as ServerType[]).map(serverTypeVal => (
              <button
                key={serverTypeVal}
                className={`flex-1 px-4 py-2 text-sm rounded-md transition-colors ${serverType === serverTypeVal ? 'bg-accent text-white' : 'text-text-secondary hover:text-text-primary'}`}
                onClick={() => setServerType(serverTypeVal)}
              >
                {serverTypeVal === 'local' ? (t('mcp.localServerStdio', language as Language)) : (t('mcp.remoteServerHttp', language as Language))}
              </button>
            ))}
          </div>

          {/* 通用字段 */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-text-secondary">{t('mcp.serverId', language as Language)} <span className="text-red-400">*</span></label>
              <TextField value={formData.id} onChange={(e) => setFormData(prev => ({ ...prev, id: e.target.value }))} placeholder="my-server" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-text-secondary">{t('provider.displayName', language as Language)} <span className="text-red-400">*</span></label>
              <TextField value={formData.name} onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))} placeholder="My Server" />
            </div>
          </div>

          {/* 本地服务器字段 */}
          {serverType === 'local' && (
            <>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-text-secondary">{t('mcp.command', language as Language)} <span className="text-red-400">*</span></label>
                <TextField value={formData.command || ''} onChange={(e) => setFormData(prev => ({ ...prev, command: e.target.value }))} placeholder="npx / uvx / node / python..." />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-text-secondary">{t('mcp.arguments', language as Language)}</label>
                <TextField value={argsInput} onChange={(e) => setArgsInput(e.target.value)} placeholder="-y @modelcontextprotocol/server-xxx" />
                <p className="text-xs text-text-muted">{t('mcp.argsHint', language as Language)}</p>
              </div>

              {/* 环境变量 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-text-secondary">{t('mcp.envVars', language as Language)}</label>
                  <ActionButton variant="ghost" size="sm" onClick={addEnvPair} className="text-xs">
                    <Plus className="w-3 h-3 mr-1" />{t('provider.add', language as Language)}
                  </ActionButton>
                </div>
                {customEnvPairs.length === 0 ? (
                  <p className="text-xs text-text-muted py-2">{t('mcp.envVarsHint', language as Language)}</p>
                ) : (
                  <div className="space-y-2">
                    {customEnvPairs.map(pair => (
                      <div key={pair.id} className="flex gap-2 items-center">
                        <TextField value={pair.key} onChange={(e) => updateEnvPair(pair.id, 'key', e.target.value)} placeholder="KEY" className="flex-1 font-mono text-xs" />
                        <span className="text-text-muted text-xs">=</span>
                        <TextField value={pair.value} onChange={(e) => updateEnvPair(pair.id, 'value', e.target.value)} placeholder="value" className="flex-[2] text-xs" />
                        <button onClick={() => removeEnvPair(pair.id)} className="p-1.5 text-text-muted hover:text-red-400 transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {/* 远程服务器字段 */}
          {serverType === 'remote' && (
            <>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-text-secondary">{t('mcp.serverUrl', language as Language)} <span className="text-red-400">*</span></label>
                <TextField value={remoteUrl} onChange={(e) => setRemoteUrl(e.target.value)} placeholder="https://mcp.example.com/api" />
              </div>

              {/* 自定义请求头 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-text-secondary">{t('mcp.requestHeaders', language as Language)}</label>
                  <ActionButton variant="ghost" size="sm" onClick={addHeaderPair} className="text-xs">
                    <Plus className="w-3 h-3 mr-1" />{t('provider.add', language as Language)}
                  </ActionButton>
                </div>
                {customHeaderPairs.length === 0 ? (
                  <p className="text-xs text-text-muted py-1">{t('mcp.headersHint', language as Language)}</p>
                ) : (
                  <div className="space-y-2">
                    {customHeaderPairs.map(pair => (
                      <div key={pair.id} className="flex gap-2 items-center">
                        <TextField value={pair.key} onChange={(e) => updateHeaderPair(pair.id, 'key', e.target.value)} placeholder="Authorization" className="flex-1 font-mono text-xs" />
                        <span className="text-text-muted text-xs">:</span>
                        <TextField value={pair.value} onChange={(e) => updateHeaderPair(pair.id, 'value', e.target.value)} placeholder="Bearer ..." className="flex-[2] text-xs" />
                        <button onClick={() => removeHeaderPair(pair.id)} className="p-1.5 text-text-muted hover:text-red-400 transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* OAuth */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-text-secondary">{t('mcp.oauthAuth', language as Language)}</label>
                  <button
                    className={`relative w-10 h-5 rounded-full transition-colors ${enableOAuth ? 'bg-accent' : 'bg-white/10'}`}
                    onClick={() => setEnableOAuth(!enableOAuth)}
                  >
                    <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${enableOAuth ? 'left-5' : 'left-0.5'}`} />
                  </button>
                </div>
                {enableOAuth && (
                  <div className="space-y-3 p-3 bg-surface/30 rounded-lg">
                    <div className="space-y-1.5">
                      <label className="text-sm text-text-muted">{t('mcp.clientIdOptional', language as Language)}</label>
                      <TextField value={oauthClientId} onChange={(e) => setOauthClientId(e.target.value)}
                        placeholder={t('mcp.clientIdPlaceholder', language as Language)} />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm text-text-muted">{t('mcp.clientSecret', language as Language)}</label>
                      <TextField type="password" value={oauthClientSecret} onChange={(e) => setOauthClientSecret(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm text-text-muted">{t('mcp.scope', language as Language)}</label>
                      <TextField value={oauthScope} onChange={(e) => setOauthScope(e.target.value)} placeholder="read write" />
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-text-secondary">{t('mcp.autoApproveTools', language as Language)}</label>
            <TextField value={autoApproveInput} onChange={(e) => setAutoApproveInput(e.target.value)} placeholder="tool1, tool2, tool3" />
            <p className="text-xs text-text-muted">{t('mcp.autoApproveHint', language as Language)}</p>
          </div>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="flex items-center gap-2 p-3 bg-red-500/10 rounded-lg text-red-400 text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* 保存层级选择 + 底部按钮 */}
        <div className="pt-4 border-t border-border space-y-3">
          <div className="flex items-center gap-3">
            <span className="text-[12px] text-text-muted">{t('mcp.saveTo', language as Language)}</span>
            <div className="flex items-center rounded-md border border-border overflow-hidden">
              {([['user', t('mcp.globalConfig', language as Language)], ['workspace', t('mcp.workspaceConfig', language as Language)]] as ['user' | 'workspace', string][]).map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => setSaveLevel(val)}
                  className={`text-[12px] px-3 py-1 transition-colors ${
                    saveLevel === val
                      ? 'bg-accent/20 text-accent font-medium'
                      : 'bg-black/20 text-text-muted hover:bg-black/30 hover:text-text-secondary'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <ActionButton variant="ghost" onClick={() => { onClose(); resetForm() }}>{t('common.cancel', language as Language)}</ActionButton>
            <ActionButton variant="primary" onClick={handleSubmit} disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {t('mcp.addServer', language as Language)}
            </ActionButton>
          </div>
        </div>
      </div>
    </OverlayDialog>
  )
}
