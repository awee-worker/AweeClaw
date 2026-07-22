/**
 * IoT Provider 列表面板
 *
 * 功能：
 * - 展示已注册的 IoT Provider 列表（来自后端 /api/v1/iot/providers）
 * - 新建/编辑/删除 Provider（含协议、endpoint、authConfig、pollIntervalSec）
 * - 测试连接（后端 POST /api/v1/iot/providers/:id/test）
 * - 启动/停止 Bridge 内的 Provider 连接（IPC iot.connectProvider / disconnectProvider）
 *
 * 数据流：
 * - CRUD 操作走后端 REST API（持久化）
 * - 实时连接管理走 IPC（IoTBridge 单例）
 *
 * @module settings/tabs/iot/ProviderListPanel
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import {
  Plus,
  Pencil,
  Trash2,
  Plug,
  PlugZap,
  X,
  Check,
  Loader2,
  Send,
} from 'lucide-react'
import { type Language, createTranslator } from '@renderer/i18n'
import { logger } from '@shared/toolkit/LogEngine'
import { backendApi } from '@renderer/adapters/backendApi'
import { MqttPublishDialog } from './MqttPublishDialog'

interface ProviderListPanelProps {
  language: Language
  refreshKey: number
  bridgeRunning: boolean
  onBridgeChanged: () => void
}

/** 后端 Provider 实体 */
interface IoTProvider {
  id: string
  name: string
  protocol: 'homeassistant' | 'mqtt' | 'ble' | 'custom'
  endpoint: string
  authConfig: Record<string, unknown> | null
  pollIntervalSec: number
  enabled: boolean
  metadata?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

/** Provider 连接状态（来自 Bridge） */
interface ProviderConnState {
  state: 'disconnected' | 'connecting' | 'connected' | 'error' | 'disabled'
  receivedReadings: number
  lastError?: string
  lastDataAt?: number
}

/** 协议列表（label 通过 i18n key 动态获取） */
const PROTOCOLS: Array<IoTProvider['protocol']> = [
  'homeassistant',
  'mqtt',
  'ble',
  'custom',
]

/**
 * ProviderListPanel
 *
 * 父组件传入 refreshKey 触发刷新（与 Bridge 状态切换联动）。
 */
export function ProviderListPanel({
  language,
  refreshKey,
  bridgeRunning,
  onBridgeChanged,
}: ProviderListPanelProps) {
  const t = createTranslator(language)

  const [providers, setProviders] = useState<IoTProvider[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [connStates, setConnStates] = useState<Record<string, ProviderConnState>>({})
  const [editingProvider, setEditingProvider] = useState<IoTProvider | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [showPublishDialog, setShowPublishDialog] = useState(false)

  /** 加载 Provider 列表 */
  const loadProviders = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await backendApi.get<{ items: IoTProvider[] } | IoTProvider[]>(
        '/api/v1/iot/providers',
      )
      const list = Array.isArray(result) ? result : result?.items ?? []
      setProviders(list)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      logger.settings?.error('Failed to load IoT providers:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  /** 加载 Bridge 状态（Provider 连接状态） */
  const loadBridgeStatus = useCallback(async () => {
    try {
      const result = await window.electronAPI.iot.getStatus()
      if (result.success && result.data) {
        const states: Record<string, ProviderConnState> = {}
        for (const p of result.data.providers) {
          states[p.providerId] = {
            state: p.state,
            receivedReadings: p.receivedReadings,
            lastError: p.lastError,
            lastDataAt: p.lastDataAt,
          }
        }
        setConnStates(states)
      }
    } catch (e) {
      logger.settings?.warn('Failed to load Bridge status:', e)
    }
  }, [])

  useEffect(() => {
    void loadProviders()
    void loadBridgeStatus()
  }, [loadProviders, loadBridgeStatus, refreshKey])

  /** 删除 Provider */
  const handleDelete = useCallback(
    async (id: string) => {
      if (!confirm(t('iot.provider.deleteConfirm'))) return
      try {
        await backendApi.delete(`/api/v1/iot/providers/${id}`)
        await loadProviders()
      } catch (e) {
        logger.settings?.error('Failed to delete provider:', e)
        setError(e instanceof Error ? e.message : String(e))
      }
    },
    [t, loadProviders],
  )

  /** 测试连接（后端 API） */
  const handleTestConnection = useCallback(
    async (id: string) => {
      setTestingId(id)
      try {
        const result = await backendApi.post<{ success: boolean; message: string }>(
          `/api/v1/iot/providers/${id}/test`,
        )
        const msg = result?.message ?? 'Test completed'
        alert(msg)
      } catch (e) {
        alert(t('iot.provider.testFailed', { error: (e as Error).message }))
      } finally {
        setTestingId(null)
      }
    },
    [t],
  )

  /** 连接/断开 Provider（IPC Bridge） */
  const handleToggleConnect = useCallback(
    async (id: string) => {
      const state = connStates[id]
      const isConnected = state?.state === 'connected'
      setTogglingId(id)
      try {
        if (isConnected) {
          await window.electronAPI.iot.disconnectProvider(id)
        } else {
          await window.electronAPI.iot.connectProvider(id)
        }
        await loadBridgeStatus()
        onBridgeChanged()
      } catch (e) {
        alert(t('iot.provider.operationFailed', { error: (e as Error).message }))
      } finally {
        setTogglingId(null)
      }
    },
    [connStates, loadBridgeStatus, onBridgeChanged, t],
  )

  /** 是否存在已连接的 MQTT Provider（用于显示"MQTT 发布"按钮） */
  const hasConnectedMqttProvider = useMemo(() => {
    return providers.some(
      (p) => p.protocol === 'mqtt' && connStates[p.id]?.state === 'connected',
    )
  }, [providers, connStates])

  /** MQTT 消息发布对话框所需的 Provider 列表（仅 MQTT 协议且已连接） */
  const publishDialogProviders = useMemo(
    () =>
      providers
        .filter((p) => p.protocol === 'mqtt' && connStates[p.id]?.state === 'connected')
        .map((p) => ({
          providerId: p.id,
          providerName: p.name,
          protocol: p.protocol,
          state: connStates[p.id]?.state ?? 'disconnected',
        })),
    [providers, connStates],
  )

  /** 渲染单个 Provider 行 */
  const renderProviderRow = (p: IoTProvider) => {
    const conn = connStates[p.id]
    const isConnected = conn?.state === 'connected'
    const protocolLabel = t(`iot.protocol.${p.protocol}`)

    return (
      <div
        key={p.id}
        className="p-4 rounded-xl bg-surface/30 border border-border/40 hover:border-border/60 transition-all"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h5 className="text-sm font-semibold text-text-primary truncate">{p.name}</h5>
              <span className="px-2 py-0.5 rounded-md text-[12px] bg-accent/10 text-accent border border-accent/20">
                {protocolLabel}
              </span>
              {!p.enabled && (
                <span className="px-2 py-0.5 rounded-md text-[12px] bg-amber-500/10 text-amber-500 border border-amber-500/20">
                  {t('iot.common.disabled')}
                </span>
              )}
            </div>
            <div className="text-[12px] text-text-muted mt-1 truncate">{p.endpoint}</div>
            <div className="flex items-center gap-3 mt-2 text-[12px] text-text-muted">
              <span>
                {t('iot.provider.poll')}: {p.pollIntervalSec}s
              </span>
              {conn && (
                <>
                  <span>·</span>
                  <span
                    className={
                      isConnected
                        ? 'text-emerald-500'
                        : conn.state === 'error'
                        ? 'text-red-500'
                        : 'text-text-muted'
                    }
                  >
                    {t('iot.provider.state')}: {conn.state}
                  </span>
                  {conn.receivedReadings > 0 && (
                    <>
                      <span>·</span>
                      <span>
                        {t('iot.provider.readings')}: {conn.receivedReadings}
                      </span>
                    </>
                  )}
                  {conn.lastError && (
                    <>
                      <span>·</span>
                      <span className="text-red-500 truncate max-w-[200px]" title={conn.lastError}>
                        {conn.lastError}
                      </span>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => handleTestConnection(p.id)}
              disabled={testingId === p.id}
              className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-hover transition-all"
              title={t('iot.provider.testConnection')}
            >
              {testingId === p.id ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <PlugZap className="w-4 h-4" />
              )}
            </button>
            <button
              onClick={() => setEditingProvider(p)}
              className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-hover transition-all"
              title={t('iot.common.edit')}
            >
              <Pencil className="w-4 h-4" />
            </button>
            <button
              onClick={() => handleDelete(p.id)}
              className="p-1.5 rounded-lg text-text-muted hover:text-red-500 hover:bg-red-500/10 transition-all"
              title={t('iot.common.delete')}
            >
              <Trash2 className="w-4 h-4" />
            </button>
            {bridgeRunning && (
              <button
                onClick={() => handleToggleConnect(p.id)}
                disabled={togglingId === p.id}
                className={`ml-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-all flex items-center gap-1.5 ${
                  isConnected
                    ? 'bg-red-500/15 text-red-500 border-red-500/30 hover:bg-red-500/25'
                    : 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30 hover:bg-emerald-500/25'
                }`}
              >
                {togglingId === p.id ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : isConnected ? (
                  <Plug className="w-3 h-3" />
                ) : (
                  <PlugZap className="w-3 h-3" />
                )}
                {isConnected ? t('iot.provider.disconnect') : t('iot.provider.connect')}
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-bold text-text-primary">
            {t('iot.provider.listTitle')}
          </h4>
          <p className="text-[12px] text-text-muted mt-1">
            {bridgeRunning
              ? t('iot.provider.listSubtitle', { count: providers.length })
              : t('iot.provider.listSubtitleBridgeOff', { count: providers.length })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* MQTT 消息发布按钮（阶段9 s9-10） */}
          {hasConnectedMqttProvider && (
            <button
              onClick={() => setShowPublishDialog(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-cyan-500/15 text-cyan-500 border border-cyan-500/30 hover:bg-cyan-500/25 transition-all"
              title={t('iot.provider.mqttPublish')}
            >
              <Send className="w-3.5 h-3.5" />
              {t('iot.provider.mqttPublish')}
            </button>
          )}
          <button
            onClick={() => setShowCreateForm(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-accent/15 text-accent border border-accent/30 hover:bg-accent/25 transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            {t('iot.provider.new')}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-500 text-[12px]">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-12 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-text-muted" />
        </div>
      ) : providers.length === 0 ? (
        <div className="py-12 text-center text-text-muted text-sm">
          {t('iot.provider.empty')}
        </div>
      ) : (
        <div className="space-y-2">{providers.map(renderProviderRow)}</div>
      )}

      {/* 新建/编辑表单 */}
      {(showCreateForm || editingProvider) && (
        <ProviderEditDialog
          language={language}
          provider={editingProvider}
          onClose={() => {
            setShowCreateForm(false)
            setEditingProvider(null)
          }}
          onSaved={() => {
            setShowCreateForm(false)
            setEditingProvider(null)
            void loadProviders()
          }}
        />
      )}

      {/* MQTT 消息发布对话框（阶段9 s9-10） */}
      <MqttPublishDialog
        isOpen={showPublishDialog}
        onClose={() => setShowPublishDialog(false)}
        language={language}
        providers={publishDialogProviders}
      />
    </div>
  )
}

// ============================================================
// Provider 编辑对话框
// ============================================================

interface ProviderEditDialogProps {
  language: Language
  provider: IoTProvider | null
  onClose: () => void
  onSaved: () => void
}

function ProviderEditDialog({
  language,
  provider,
  onClose,
  onSaved,
}: ProviderEditDialogProps) {
  const t = createTranslator(language)
  const isEdit = !!provider

  const [name, setName] = useState(provider?.name ?? '')
  const [protocol, setProtocol] = useState<IoTProvider['protocol']>(
    provider?.protocol ?? 'homeassistant',
  )
  const [endpoint, setEndpoint] = useState(provider?.endpoint ?? '')
  const [pollIntervalSec, setPollIntervalSec] = useState(provider?.pollIntervalSec ?? 30)
  const [enabled, setEnabled] = useState(provider?.enabled ?? true)
  const [authConfigJson, setAuthConfigJson] = useState(() => {
    if (!provider?.authConfig) return ''
    try {
      return JSON.stringify(provider.authConfig, null, 2)
    } catch {
      return ''
    }
  })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  /** 提交保存 */
  const handleSubmit = useCallback(async () => {
    setFormError(null)
    if (!name.trim()) {
      setFormError(t('iot.provider.nameRequired'))
      return
    }
    if (!endpoint.trim()) {
      setFormError(t('iot.provider.endpointRequired'))
      return
    }

    let authConfig: Record<string, unknown> | null = null
    if (authConfigJson.trim()) {
      try {
        authConfig = JSON.parse(authConfigJson)
      } catch {
        setFormError(t('iot.provider.authConfigInvalid'))
        return
      }
    }

    setSaving(true)
    try {
      const payload = {
        name: name.trim(),
        protocol,
        endpoint: endpoint.trim(),
        pollIntervalSec: Math.max(5, Math.floor(pollIntervalSec)),
        enabled,
        authConfig,
      }
      if (isEdit && provider) {
        await backendApi.put(`/api/v1/iot/providers/${provider.id}`, payload)
      } else {
        await backendApi.post('/api/v1/iot/providers', payload)
      }
      onSaved()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }, [
    name,
    protocol,
    endpoint,
    pollIntervalSec,
    enabled,
    authConfigJson,
    isEdit,
    provider,
    t,
    onSaved,
  ])

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-surface border border-border rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h3 className="text-base font-semibold text-text-primary">
            {isEdit ? t('iot.provider.editTitle') : t('iot.provider.newTitle')}
          </h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-text-muted hover:text-red-500 hover:bg-red-500/10 transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 表单内容 */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
              {t('iot.provider.nameLabel')} <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('iot.provider.namePlaceholder')}
              className="w-full px-3 py-2 rounded-lg bg-surface/40 border border-border/40 text-sm text-text-primary focus:outline-none focus:border-accent/50"
            />
          </div>

          <div>
            <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
              {t('iot.provider.protocolLabel')}
            </label>
            <select
              value={protocol}
              onChange={(e) => setProtocol(e.target.value as IoTProvider['protocol'])}
              className="w-full px-3 py-2 rounded-lg bg-surface/40 border border-border/40 text-sm text-text-primary focus:outline-none focus:border-accent/50"
            >
              {PROTOCOLS.map((p) => (
                <option key={p} value={p}>
                  {t(`iot.protocol.${p}`)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
              {t('iot.provider.endpointLabel')} <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder={
                protocol === 'homeassistant'
                  ? 'http://homeassistant.local:8123'
                  : protocol === 'mqtt'
                  ? 'mqtt://broker.local:1883'
                  : ''
              }
              className="w-full px-3 py-2 rounded-lg bg-surface/40 border border-border/40 text-sm text-text-primary focus:outline-none focus:border-accent/50"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
                {t('iot.provider.pollIntervalLabel')}
              </label>
              <input
                type="number"
                min="5"
                max="3600"
                value={pollIntervalSec}
                onChange={(e) => setPollIntervalSec(parseInt(e.target.value, 10) || 30)}
                className="w-full px-3 py-2 rounded-lg bg-surface/40 border border-border/40 text-sm text-text-primary focus:outline-none focus:border-accent/50"
              />
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  className="rounded"
                />
                {t('iot.provider.enabledLabel')}
              </label>
            </div>
          </div>

          <div>
            <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
              {t('iot.provider.authConfigLabel')}
            </label>
            <textarea
              value={authConfigJson}
              onChange={(e) => setAuthConfigJson(e.target.value)}
              rows={6}
              placeholder={
                protocol === 'homeassistant'
                  ? '{\n  "token": "long-lived-token"\n}'
                  : protocol === 'mqtt'
                  ? '{\n  "username": "user",\n  "password": "pass",\n  "clientId": "aweeclaw",\n  "topic": "#"\n}'
                  : '{}'
              }
              className="w-full px-3 py-2 rounded-lg bg-surface/40 border border-border/40 text-sm text-text-primary font-mono focus:outline-none focus:border-accent/50"
            />
            <p className="text-[12px] text-text-muted mt-1">
              {t('iot.provider.authConfigHint')}
            </p>
          </div>

          {formError && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-500 text-[12px]">
              {formError}
            </div>
          )}
        </div>

        {/* 底部操作栏 */}
        <div className="flex items-center justify-end gap-2 p-5 border-t border-border bg-surface/40">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-hover transition-all"
          >
            {t('iot.common.cancel')}
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-accent text-white hover:bg-accent-hover transition-all flex items-center gap-1.5"
          >
            {saving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Check className="w-3.5 h-3.5" />
            )}
            {t('iot.common.save')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
