/**
 * OpenApiSettings — 对外 API 网关设置面板（P0-5）
 *
 * 设计要点：
 * 1. **默认全关**：不监听任何端口。把本机模型额度对外开放必须由用户主动开启。
 * 2. **密钥即准入**：apiKey 走 password 输入框 + 显隐开关（主进程解密返回，与 A2A/VTS 一致），
 *    并提供「生成」按钮 —— 让用户自己编一个强密钥不现实。
 * 3. **对外暴露三重锁**：勾选「允许外部访问」+ 已设密钥（Store 层强制联动）+
 *    保存前二次确认。少任何一道，主进程都会把监听地址降级回 127.0.0.1。
 * 4. **端点速查与请求示例**：第三方客户端对接最容易卡在「路径到底是什么」上，
 *    所以把端点表与可复制的 curl 直接摆在设置页里。
 * 5. **A2A 挂载状态可见**：网关会接管 A2A 的端口，用户必须能看出「现在谁在监听」，
 *    否则会以为 A2A 配错了。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, Copy, Eye, EyeOff, KeyRound, Play, RefreshCw, RotateCw, ShieldAlert, Zap } from 'lucide-react'
import type { Language } from '@renderer/i18n'
import { api } from '@renderer/adapters/electronBridge'
import { logger } from '@shared/toolkit/LogEngine'
import { OPEN_API_ENDPOINTS } from '@shared/protocols/openApiProtocol'
import { useFeatureGuard } from '@hooks/useFeatureGuard'
import type { OpenApiConfig, OpenApiEndpointInfo, OpenApiStatus } from '@renderer/types/electronBridge'

interface OpenApiSettingsProps {
  language: Language
}

/** 本机来源判定（与主进程 openApiProtocol 的环回白名单一致） */
function isLoopback(host: string): boolean {
  const h = (host || '').trim()
  return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(h)
}

// ============================================
// 通用 UI 原子（与 A2aSettings / VtsSettings 保持一致）
// ============================================

function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border/40 bg-surface/70 p-4 space-y-3">
      {title ? <div className="text-sm font-medium text-text-primary">{title}</div> : null}
      {children}
    </section>
  )
}

function ToggleRow({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string
  hint?: string
  checked: boolean
  disabled?: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="text-sm font-medium text-text-primary">{label}</div>
        {hint ? <div className="mt-0.5 text-xs text-text-muted">{hint}</div> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 flex-shrink-0 rounded-full transition-colors ${
          checked ? 'bg-accent' : 'bg-border'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
            checked ? 'left-[18px]' : 'left-0.5'
          }`}
        />
      </button>
    </div>
  )
}

function ActionButton({
  label,
  icon,
  onClick,
  disabled,
  variant = 'ghost',
}: {
  label: string
  icon?: React.ReactNode
  onClick: () => void
  disabled?: boolean
  variant?: 'ghost' | 'primary'
}) {
  const base =
    'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50'
  const style =
    variant === 'primary'
      ? 'bg-accent text-white hover:bg-accent/90'
      : 'border border-border/50 text-text-secondary hover:bg-surface-hover hover:text-text-primary'
  return (
    <button type="button" className={`${base} ${style}`} onClick={onClick} disabled={disabled}>
      {icon}
      {label}
    </button>
  )
}

// ============================================
// 主组件
// ============================================

export function OpenApiSettings({ language }: OpenApiSettingsProps) {
  const zh = language === 'zh'
  // 套餐能力拦截：对外 API 为高级能力，未解锁时禁止开启
  const { requireFeature } = useFeatureGuard()

  const [config, setConfig] = useState<OpenApiConfig | null>(null)
  const [status, setStatus] = useState<OpenApiStatus | null>(null)
  const [issues, setIssues] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // 文本框的草稿态（开关类是即时保存，文本类点保存）
  const [hostDraft, setHostDraft] = useState('127.0.0.1')
  const [portDraft, setPortDraft] = useState('8790')
  const [keyDraft, setKeyDraft] = useState('')
  const [revealKey, setRevealKey] = useState(false)
  const [originDraft, setOriginDraft] = useState('')

  const applyPayload = useCallback(
    (payload: { config?: OpenApiConfig; issues?: string[]; status?: OpenApiStatus }) => {
      if (payload.config) {
        setConfig(payload.config)
        setHostDraft(payload.config.host)
        setPortDraft(String(payload.config.port))
        setKeyDraft(payload.config.apiKey || '')
      }
      if (payload.issues) setIssues(payload.issues)
      if (payload.status) setStatus(payload.status)
    },
    [],
  )

  const load = useCallback(async () => {
    setBusy(true)
    try {
      const [cfgRes, statusRes] = await Promise.all([api.openapi.getConfig(), api.openapi.getStatus()])
      if (cfgRes.success && cfgRes.data) {
        applyPayload({ config: cfgRes.data.config, issues: cfgRes.data.issues })
      } else if (!cfgRes.success) {
        setError(cfgRes.error || (zh ? '读取配置失败' : 'Failed to read config'))
      }
      if (statusRes.success && statusRes.data) setStatus(statusRes.data)
    } catch (err) {
      logger.system.warn('[OpenApiSettings] load failed:', err)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [applyPayload, zh])

  useEffect(() => {
    void load()
  }, [load])

  // 主进程推送变化（端口被占自动 +1、外部请求进来刷新计数）
  useEffect(() => {
    try {
      const off = api.openapi.onChanged((payload) => {
        if (payload?.status) setStatus(payload.status)
      })
      const timer = setInterval(() => {
        void api.openapi.getStatus().then((res) => {
          if (res.success && res.data) setStatus(res.data)
        })
      }, 5000)
      return () => {
        off?.()
        clearInterval(timer)
      }
    } catch (err) {
      logger.system.warn('[OpenApiSettings] subscribe failed:', err)
      return undefined
    }
  }, [])

  /** 保存配置（文本类字段走这里） */
  const save = useCallback(
    async (patch: Partial<OpenApiConfig>, message?: string) => {
      setBusy(true)
      setError(null)
      // 乐观更新：立即切换视觉状态，让用户即时看到反馈
      setConfig((prev) => (prev ? { ...prev, ...patch } : prev))
      try {
        const res = await api.openapi.updateConfig(patch)
        if (!res.success) {
          // 回滚乐观更新
          void load()
          setError(res.error || (zh ? '保存失败' : 'Save failed'))
          return
        }
        if (res.data) applyPayload(res.data)
        setActionMessage(message ?? (zh ? '已保存并应用' : 'Saved and applied'))
      } catch (err) {
        // 回滚乐观更新
        void load()
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
      }
    },
    [applyPayload, load, zh],
  )

  /** 开关类即时保存 */
  const toggle = useCallback(
    (patch: Partial<OpenApiConfig>) => {
      void save(patch)
    },
    [save],
  )

  /** 允许外部访问：需要二次确认 */
  const handleToggleExternal = useCallback(
    (next: boolean) => {
      if (!next) {
        void save({ host: '127.0.0.1', allowExternal: false }, zh ? '已恢复仅本机访问' : 'Restored to localhost only')
        return
      }
      if (!config?.apiKey) {
        setError(
          zh
            ? '对外暴露前必须先设置准入密钥：否则整个局域网都能调用本机模型额度'
            : 'Set an access key before exposing externally',
        )
        return
      }
      const confirmed = window.confirm(
        zh
          ? '确定要允许外部设备访问吗？\n\n开启后，同一网络内的任何设备只要持有准入密钥，就能调用本机模型与工具。请确保网络环境可信。'
          : 'Allow external access? Any device on the network with the key can use this machine.',
      )
      if (!confirmed) return
      void save({ allowExternal: true, host: hostDraft.trim() }, zh ? '已允许外部访问' : 'External access enabled')
    },
    [config?.apiKey, hostDraft, save, zh],
  )

  const handleGenerateKey = useCallback(async () => {
    try {
      const res = await api.openapi.generateKey()
      if (res.success && res.data?.apiKey) {
        setKeyDraft(res.data.apiKey)
        setRevealKey(true)
        setActionMessage(zh ? '已生成新密钥，点击「保存并应用」后生效' : 'Key generated, save to apply')
      } else if (!res.success) {
        setError(res.error || (zh ? '生成密钥失败' : 'Failed to generate key'))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [zh])

  const handleSaveConnection = useCallback(() => {
    const port = Number(portDraft)
    if (!Number.isInteger(port) || port <= 0 || port >= 65536) {
      setError(zh ? '端口必须是 1~65535 之间的整数' : 'Port must be 1-65535')
      return
    }
    const host = hostDraft.trim() || '127.0.0.1'
    const patch: Partial<OpenApiConfig> = { host, port, apiKey: keyDraft.trim() }
    // 把地址改成非环回时，若没开 allowExternal，Store 会自动降级 —— 这里主动同步勾选状态，
    // 避免用户看到「我填了 0.0.0.0 但状态里还是 127.0.0.1」时一头雾水
    if (!isLoopback(host) && !config?.allowExternal) {
      patch.allowExternal = false
    }
    void save(patch, zh ? '端口与密钥已更新' : 'Connection settings updated')
  }, [config?.allowExternal, hostDraft, keyDraft, portDraft, save, zh])

  const handleReset = useCallback(async () => {
    if (!window.confirm(zh ? '恢复默认配置？将清空准入密钥并关闭网关。' : 'Reset to defaults?')) return
    setBusy(true)
    try {
      const res = await api.openapi.resetConfig()
      if (res.success && res.data) applyPayload(res.data)
      else if (!res.success) setError(res.error || (zh ? '重置失败' : 'Reset failed'))
    } finally {
      setBusy(false)
    }
  }, [applyPayload, zh])

  const handleRestart = useCallback(async () => {
    setBusy(true)
    try {
      const res = await api.openapi.restart()
      if (res.success && res.data) setStatus(res.data.status)
      else if (!res.success) setError(res.error || (zh ? '重启失败' : 'Restart failed'))
      else setActionMessage(zh ? '已重新绑定端口' : 'Port rebound')
    } finally {
      setBusy(false)
    }
  }, [zh])

  const copyText = useCallback(
    async (text: string, note: string) => {
      try {
        await navigator.clipboard.writeText(text)
        setActionMessage(note)
      } catch {
        setError(zh ? '复制失败，请手动选择文本' : 'Copy failed')
      }
    },
    [zh],
  )

  const addOrigin = useCallback(() => {
    const raw = originDraft.trim()
    if (!raw) return
    const next = Array.from(new Set([...(config?.corsOrigins || []), raw]))
    setOriginDraft('')
    void save({ corsOrigins: next }, zh ? '已添加来源白名单' : 'Origin added')
  }, [config?.corsOrigins, originDraft, save, zh])

  const removeOrigin = useCallback(
    (origin: string) => {
      const next = (config?.corsOrigins || []).filter((o) => o !== origin)
      void save({ corsOrigins: next }, zh ? '已移除来源' : 'Origin removed')
    },
    [config?.corsOrigins, save, zh],
  )

  const baseUrl = status?.baseUrl || `http://${hostDraft || '127.0.0.1'}:${portDraft || '8790'}`

  const curlExample = useMemo(() => {
    const key = config?.apiKey ? config.apiKey : 'YOUR_API_KEY'
    return [
      `curl ${baseUrl}/v1/models -H "Authorization: Bearer ${key}"`,
      '',
      `curl -N -X POST ${baseUrl}/v1/chat/completions \\`,
      `  -H "Authorization: Bearer ${key}" \\`,
      `  -H "Content-Type: application/json" \\`,
      `  -d '{"model":"agent:YOUR_AGENT_ID","messages":[{"role":"user","content":"你好"}],"stream":true}'`,
    ].join('\n')
  }, [baseUrl, config?.apiKey])

  /** 端点按协议分组 */
  const groupedEndpoints = useMemo(() => {
    const groups: Record<string, OpenApiEndpointInfo[]> = {}
    for (const ep of OPEN_API_ENDPOINTS) {
      if (!groups[ep.group]) groups[ep.group] = []
      groups[ep.group].push(ep)
    }
    return groups
  }, [])

  const groupLabel: Record<string, string> = {
    openai: 'OpenAI 兼容',
    mcp: 'MCP',
    a2a: 'A2A',
    system: zh ? '系统' : 'System',
  }

  if (!config) {
    return (
      <div className="p-4 text-sm text-text-muted">
        {busy ? (zh ? '正在加载…' : 'Loading…') : error || (zh ? '暂无配置' : 'No config')}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* --- 总开关 --- */}
      <Card>
        <ToggleRow
          label={zh ? '启用对外 API 网关' : 'Enable external API gateway'}
          hint={
            zh
              ? '开启后，第三方客户端（Cherry Studio / ChatBox）可用 OpenAI 协议接入本机模型；MCP 客户端可接入本机工具'
              : 'Expose local models via OpenAI protocol and local tools via MCP'
          }
          checked={config.enabled}
          disabled={busy}
          onChange={async (next) => {
            // 套餐能力拦截：开启前校验（对外 API 为高级能力）
            if (next && !(await requireFeature('externalApi'))) return
            toggle({ enabled: next })
          }}
        />
        <div className="flex items-center gap-2 text-xs">
          <span className={`inline-flex h-2 w-2 rounded-full ${status?.running ? 'bg-emerald-500' : 'bg-border'}`} />
          <span className="text-text-muted">
            {status?.running
              ? zh
                ? `运行中 · ${status.host}:${status.port}`
                : `Running · ${status.host}:${status.port}`
              : zh
                ? '未运行'
                : 'Stopped'}
            {status?.requests ? ` · ${zh ? '累计请求' : 'requests'} ${status.requests}` : ''}
            {status?.errors ? ` · ${zh ? '错误' : 'errors'} ${status.errors}` : ''}
          </span>
        </div>
        {status?.a2aMounted ? (
          <div className="rounded-lg bg-surface-hover/60 px-2.5 py-2 text-xs text-text-muted">
            {zh
              ? 'A2A 入站已挂载在本网关的 /a2a 前缀下（与网关共用同一端口，无需单独监听）'
              : 'A2A inbound is mounted at /a2a on this gateway (shared port)'}
          </div>
        ) : status?.a2aEnabled ? (
          <div className="rounded-lg bg-surface-hover/60 px-2.5 py-2 text-xs text-text-muted">
            {zh
              ? 'A2A 入站已启用，但网关未运行 —— 此时 A2A 使用自己的端口独立监听'
              : 'A2A inbound enabled but gateway is stopped — A2A listens on its own port'}
          </div>
        ) : null}
      </Card>

      {/* --- 连接与密钥 --- */}
      <Card title={zh ? '连接与准入' : 'Connection & Access'}>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <div className="mb-1 text-xs text-text-muted">{zh ? '监听地址' : 'Bind host'}</div>
            <input
              type="text"
              value={hostDraft}
              disabled={busy}
              onChange={(e) => setHostDraft(e.target.value)}
              placeholder="127.0.0.1"
              className="w-full rounded-lg border border-border/50 bg-surface px-2.5 py-1.5 text-sm text-text-primary outline-none focus:border-accent"
            />
          </label>
          <label className="block">
            <div className="mb-1 text-xs text-text-muted">{zh ? '端口' : 'Port'}</div>
            <input
              type="text"
              inputMode="numeric"
              value={portDraft}
              disabled={busy}
              onChange={(e) => setPortDraft(e.target.value)}
              placeholder="8790"
              className="w-full rounded-lg border border-border/50 bg-surface px-2.5 py-1.5 text-sm text-text-primary outline-none focus:border-accent"
            />
          </label>
        </div>

        <label className="block">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs text-text-muted">{zh ? '准入密钥（Bearer）' : 'Access key (Bearer)'}</span>
            <div className="flex gap-1.5">
              <ActionButton
                label={zh ? '生成' : 'Generate'}
                icon={<KeyRound className="h-3 w-3" />}
                onClick={() => void handleGenerateKey()}
              />
              <ActionButton
                label={revealKey ? (zh ? '隐藏' : 'Hide') : zh ? '显示' : 'Show'}
                icon={revealKey ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                onClick={() => setRevealKey((v) => !v)}
              />
            </div>
          </div>
          <input
            type={revealKey ? 'text' : 'password'}
            value={keyDraft}
            disabled={busy}
            onChange={(e) => setKeyDraft(e.target.value)}
            placeholder={zh ? '留空 = 沿用已保存的密钥' : 'Empty = keep existing key'}
            className="w-full rounded-lg border border-border/50 bg-surface px-2.5 py-1.5 font-mono text-xs text-text-primary outline-none focus:border-accent"
          />
          <div className="mt-1 text-xs text-text-muted">
            {zh
              ? '所有客户端请求需携带 Authorization: Bearer <密钥>。留空不会清空已有密钥。'
              : 'Clients must send Authorization: Bearer <key>. Empty keeps the existing key.'}
          </div>
        </label>

        <div className="flex items-center gap-2 pt-1">
          <ActionButton
            label={zh ? '保存并应用' : 'Save & apply'}
            icon={<Play className="h-3 w-3" />}
            variant="primary"
            disabled={busy}
            onClick={handleSaveConnection}
          />
          <ActionButton
            label={zh ? '重新绑定端口' : 'Rebind port'}
            icon={<RotateCw className="h-3 w-3" />}
            disabled={busy}
            onClick={() => void handleRestart()}
          />
          <ActionButton
            label={zh ? '刷新' : 'Refresh'}
            icon={<RefreshCw className="h-3 w-3" />}
            disabled={busy}
            onClick={() => void load()}
          />
          <ActionButton label={zh ? '恢复默认' : 'Reset'} disabled={busy} onClick={() => void handleReset()} />
        </div>
      </Card>

      {/* --- 安全 --- */}
      <Card title={zh ? '安全' : 'Security'}>
        <ToggleRow
          label={zh ? '允许外部访问（非本机）' : 'Allow external access'}
          hint={
            zh
              ? '默认仅监听 127.0.0.1。开启后同一网络内的设备可访问，必须已设置准入密钥，保存前会二次确认。'
              : 'Default: localhost only. Requires an access key; shows a confirmation prompt.'
          }
          checked={config.allowExternal}
          disabled={busy}
          onChange={handleToggleExternal}
        />

        <ToggleRow
          label={zh ? '允许外部执行写操作类工具' : 'Allow external write/exec tools'}
          hint={
            zh
              ? '默认关闭：外部 MCP 客户端只能调用只读工具（查询类）。开启后写文件、执行命令等工具也会放行，请仅在完全可信的网络中使用。'
              : 'Off by default: external MCP clients may only call read-only tools.'
          }
          checked={config.allowDangerousToolCall}
          disabled={busy}
          onChange={(next) => toggle({ allowDangerousToolCall: next })}
        />

        <div>
          <div className="mb-1 text-xs text-text-muted">
            {zh ? 'CORS 来源白名单（留空 = 仅本机来源）' : 'CORS origins (empty = localhost only)'}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={originDraft}
              disabled={busy}
              onChange={(e) => setOriginDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addOrigin()
              }}
              placeholder="http://localhost:3000"
              className="flex-1 rounded-lg border border-border/50 bg-surface px-2.5 py-1.5 text-xs text-text-primary outline-none focus:border-accent"
            />
            <ActionButton label={zh ? '添加' : 'Add'} disabled={busy || !originDraft.trim()} onClick={addOrigin} />
          </div>
          {config.corsOrigins.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {config.corsOrigins.map((origin) => (
                <span
                  key={origin}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border/50 px-2 py-0.5 text-xs text-text-secondary"
                >
                  {origin}
                  <button
                    type="button"
                    className="text-text-muted hover:text-red-500"
                    onClick={() => removeOrigin(origin)}
                    aria-label={`remove ${origin}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </Card>

      {/* --- 端点速查 --- */}
      <Card title={zh ? '端点速查' : 'Endpoints'}>
        <div className="space-y-2">
          {Object.entries(groupedEndpoints).map(([group, eps]) => (
            <div key={group}>
              <div className="mb-1 text-xs font-medium text-text-muted">{groupLabel[group] || group}</div>
              <div className="space-y-1">
                {eps.map((ep) => (
                  <div key={`${ep.method} ${ep.path}`} className="flex items-start gap-2 text-xs">
                    <span className="w-10 flex-shrink-0 font-mono text-accent">{ep.method}</span>
                    <span className="font-mono text-text-primary">{ep.path}</span>
                    <span className="min-w-0 flex-1 truncate text-text-muted">{ep.description}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="flex gap-2 pt-1">
          <ActionButton
            label={zh ? '复制 Base URL' : 'Copy base URL'}
            icon={<Copy className="h-3 w-3" />}
            onClick={() => void copyText(baseUrl, zh ? '已复制 Base URL' : 'Base URL copied')}
          />
          <ActionButton
            label={zh ? '复制请求示例' : 'Copy examples'}
            icon={<Copy className="h-3 w-3" />}
            onClick={() => void copyText(curlExample, zh ? '已复制请求示例' : 'Examples copied')}
          />
        </div>
        <pre className="overflow-x-auto rounded-lg bg-surface-hover/60 p-2.5 text-[11px] leading-relaxed text-text-secondary">
          {curlExample}
        </pre>
      </Card>

      {/* --- 运行状态 --- */}
      <Card title={zh ? '运行状态' : 'Runtime'}>
        {status?.recent && status.recent.length > 0 ? (
          <div className="space-y-1">
            {status.recent.slice(0, 8).map((r) => (
              <div key={r.id} className="flex items-center gap-2 text-xs">
                <Activity className={`h-3 w-3 flex-shrink-0 ${r.status >= 400 ? 'text-red-500' : 'text-emerald-500'}`} />
                <span className="w-12 flex-shrink-0 font-mono text-text-muted">{r.method}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-text-secondary">{r.path}</span>
                <span className="flex-shrink-0 text-text-muted">{r.status}</span>
                <span className="w-14 flex-shrink-0 text-right text-text-muted">{r.durationMs}ms</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-text-muted">{zh ? '暂无外部请求记录' : 'No external requests yet'}</div>
        )}
      </Card>

      {/* --- 提示条 --- */}
      {error ? (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-500">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <span className="min-w-0 flex-1">{error}</span>
          <button type="button" className="flex-shrink-0" onClick={() => setError(null)}>
            ×
          </button>
        </div>
      ) : null}

      {actionMessage ? (
        <div className="flex items-start gap-2 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-xs text-text-secondary">
          <Zap className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-accent" />
          <span className="min-w-0 flex-1">{actionMessage}</span>
          <button type="button" className="flex-shrink-0" onClick={() => setActionMessage(null)}>
            ×
          </button>
        </div>
      ) : null}

      {issues.length > 0 ? (
        <div className="space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600">
          {issues.map((issue) => (
            <div key={issue}>{issue}</div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
