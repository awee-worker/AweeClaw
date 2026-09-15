/**
 * A2aSettings — A2A（Agent2Agent）协议设置面板
 *
 * 设计要点：
 * 1. **默认全关**：出站不发请求、入站不监听端口。外部互操作能力必须由用户主动开启。
 * 2. **凭证按密文展示**：token 走 password 输入框 + 显隐开关（主进程解密返回，与 Live/VTS 一致）。
 * 3. **连通性优先**：拉取 Agent Card 成功即视为可用，卡片信息（名称/版本/技能）就地展开
 *    —— 用户能直接确认「对面到底是谁、会做什么」，而不是只看一个「已保存」。
 * 4. **失败信息即展示**：主进程已把网络/HTTP/JSON-RPC 错误翻译成中文，此处原样展示，
 *    不做二次包装（否则会丢掉「为什么连不上」这个唯一有用的信息）。
 * 5. **入站暴露需二次确认**：监听非环回地址是「把本机 AI 开放给网络」，
 *    必须显式勾选确认；未勾选时主进程会把监听地址降级回 127.0.0.1。
 * 6. **试跑闭环**：配置完能当场发一句话验证链路，不必回聊天窗口试。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Link2,
  Play,
  Plus,
  RefreshCw,
  RotateCw,
  Server,
  Trash2,
  Plug,
} from 'lucide-react'
import type { Language } from '@renderer/i18n'
import { api } from '@renderer/adapters/electronBridge'
import { logger } from '@shared/toolkit/LogEngine'
import type {
  A2aAgentCard,
  A2aCallResult,
  A2aConfig,
  A2aInboundConfig,
  A2aServerState,
  A2aStatus,
} from '@renderer/types/electronBridge'

interface A2aSettingsProps {
  language: Language
}

/** 「新建」哨兵：与真实 URL 不可能冲突 */
const NEW_AGENT = '__new_agent__'

// ============================================
// 通用 UI 原子（与 VtsSettings / LiveSettings 保持一致）
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

function Field({
  label,
  value,
  placeholder,
  hint,
  disabled,
  secret,
  revealed,
  onToggleReveal,
  onChange,
}: {
  label: string
  value: string
  placeholder?: string
  hint?: string
  disabled?: boolean
  secret?: boolean
  revealed?: boolean
  onToggleReveal?: () => void
  onChange: (next: string) => void
}) {
  return (
    <div className="space-y-1">
      <div className="text-sm text-text-primary">{label}</div>
      <div className="flex items-center gap-2">
        <input
          type={secret && !revealed ? 'password' : 'text'}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 min-w-0 rounded-lg border border-border/50 bg-background/60 px-3 py-1.5 text-xs text-text-primary disabled:opacity-50"
        />
        {secret ? (
          <button
            type="button"
            onClick={onToggleReveal}
            className="rounded-lg border border-border/50 p-1.5 text-text-muted hover:text-text-primary"
            title={revealed ? '隐藏' : '显示'}
          >
            {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        ) : null}
      </div>
      {hint ? <div className="text-xs text-text-muted">{hint}</div> : null}
    </div>
  )
}

function ActionButton({
  label,
  icon,
  disabled,
  onClick,
}: {
  label: string
  icon?: React.ReactNode
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg border border-border/50 px-2.5 py-1.5 text-xs text-text-primary transition-colors hover:border-accent/60 hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
    >
      {icon}
      {label}
    </button>
  )
}

/** 连通性徽标 */
function ReachBadge({ server, zh }: { server: A2aServerState; zh: boolean }) {
  if (server.reachable === null) {
    return (
      <span className="rounded-full border border-border/50 px-2 py-0.5 text-[11px] text-text-muted">
        {zh ? '未测试' : 'untested'}
      </span>
    )
  }
  if (server.reachable) {
    return (
      <span className="rounded-full border border-emerald-400/50 px-2 py-0.5 text-[11px] text-emerald-400">
        {zh ? '可达' : 'reachable'}
        {server.latencyMs !== null ? ` · ${server.latencyMs}ms` : ''}
      </span>
    )
  }
  return (
    <span className="rounded-full border border-red-400/50 px-2 py-0.5 text-[11px] text-red-400">
      {zh ? '不可达' : 'unreachable'}
    </span>
  )
}

/** 编辑器草稿（与持久化结构解耦：技能与请求头在 UI 上都是多行文本） */
interface AgentDraft {
  url: string
  description: string
  skillsText: string
  token: string
  headersText: string
  enabled: boolean
}

function toDraft(url: string, server?: A2aServerState): AgentDraft {
  return {
    url,
    description: server?.description ?? '',
    skillsText: (server?.skills ?? []).join(', '),
    token: '',
    headersText: '',
    enabled: server?.enabled ?? true,
  }
}

// ============================================
// 面板
// ============================================

export function A2aSettings({ language }: A2aSettingsProps) {
  const zh = language === 'zh'

  const [config, setConfig] = useState<A2aConfig | null>(null)
  const [servers, setServers] = useState<A2aServerState[]>([])
  const [status, setStatus] = useState<A2aStatus | null>(null)
  const [issues, setIssues] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  /** 正在执行的动作标识（按钮禁用 + 该行显示 loading） */
  const [busy, setBusy] = useState<string | null>(null)
  const [actionMessage, setActionMessage] = useState<string | null>(null)

  /** 编辑中的 agent（NEW_AGENT 表示新建） */
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<AgentDraft>(toDraft(''))
  const [revealToken, setRevealToken] = useState(false)

  /** 展开展示 Agent Card 的 agent */
  const [expandedCard, setExpandedCard] = useState<string | null>(null)

  /** 试跑输入与结果 */
  const [probeQuery, setProbeQuery] = useState('')
  const [probeResult, setProbeResult] = useState<A2aCallResult | null>(null)

  /** 入站草稿（地址/端口等改动需要点保存才应用） */
  const [inboundDraft, setInboundDraft] = useState<A2aInboundConfig | null>(null)
  const [revealInboundToken, setRevealInboundToken] = useState(false)

  const pollRef = useRef<number | null>(null)

  // --------------------------------------------
  // 加载
  // --------------------------------------------
  const loadConfig = useCallback(async () => {
    try {
      const res = await api.a2a.getConfig()
      if (res.success && res.data) {
        setConfig(res.data.config)
        setIssues(res.data.issues)
        setInboundDraft((prev) => prev ?? res.data!.config.inbound)
        setError(null)
      } else if (!res.success) {
        setError(res.error ?? 'load failed')
      }
    } catch (err) {
      logger.system.warn('[A2aSettings] load config failed:', err)
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const refreshServers = useCallback(async () => {
    try {
      const res = await api.a2a.listServers()
      if (res.success && res.data) {
        setServers(res.data.servers)
        setStatus(res.data.status)
      }
    } catch (err) {
      logger.system.debug('[A2aSettings] list servers failed:', err)
    }
  }, [])

  useEffect(() => {
    void loadConfig()
    void refreshServers()

    // 主进程推送：配置或探测结果变化（也覆盖「工具体刷新」这条链路）
    const off = api.a2a.onChanged((payload) => {
      try {
        setStatus(payload.status)
        setServers(payload.status.servers)
      } catch (err) {
        logger.system.debug('[A2aSettings] push handling failed:', err)
      }
    })

    // 轮询兜底：入站请求计数只在主进程内存里变化，没有推送事件
    pollRef.current = window.setInterval(() => void refreshServers(), 5000)

    return () => {
      off()
      if (pollRef.current !== null) window.clearInterval(pollRef.current)
    }
  }, [loadConfig, refreshServers])

  const refreshAll = useCallback(async () => {
    await loadConfig()
    await refreshServers()
  }, [loadConfig, refreshServers])

  // --------------------------------------------
  // 动作
  // --------------------------------------------
  const handleToggleEnabled = useCallback(
    async (next: boolean) => {
      setBusy('module')
      // 乐观更新：立即切换视觉状态，让用户即时看到反馈
      setConfig((prev) => (prev ? { ...prev, enabled: next } : prev))
      try {
        const res = await api.a2a.updateConfig({ enabled: next })
        if (res.success && res.data) {
          setConfig(res.data.config)
          setIssues(res.data.issues)
          setActionMessage(
            next
              ? zh
                ? '已开启：模型下一次请求即可看到 a2a_tool_call 工具'
                : 'Enabled: the model will see a2a_tool_call on its next request'
              : zh
                ? '已关闭：a2a_tool_call 工具已从模型工具列表中移除'
                : 'Disabled: a2a_tool_call removed from the model tool list',
          )
        } else if (!res.success) {
          // 回滚乐观更新
          void loadConfig()
          setError(res.error ?? 'update failed')
        }
      } catch (err) {
        void loadConfig()
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(null)
      }
    },
    [zh, loadConfig],
  )

  const handleSaveAgent = useCallback(async () => {
    const url = draft.url.trim()
    if (!url) {
      setError(zh ? '请填写 A2A 智能体地址' : 'Agent URL is required')
      return
    }

    let headers: Record<string, string> = {}
    if (draft.headersText.trim()) {
      try {
        const parsed = JSON.parse(draft.headersText)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
        headers = parsed as Record<string, string>
      } catch {
        setError(zh ? '自定义请求头必须是合法的 JSON 对象' : 'Custom headers must be a valid JSON object')
        return
      }
    }

    setBusy('save')
    try {
      // token 留空 = 沿用已保存的凭证（不在 DOM 里平铺解密后的密钥）
      const patch: Parameters<typeof api.a2a.upsertServer>[1] = {
        description: draft.description.trim(),
        skills: draft.skillsText
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        headers,
        enabled: draft.enabled,
      }
      if (draft.token) patch.token = draft.token

      const res = await api.a2a.upsertServer(url, patch)

      if (res.success && res.data) {
        setConfig(res.data.config)
        setIssues(res.data.issues)
        setError(null)
        setEditing(null)
        setDraft(toDraft(''))
        setRevealToken(false)
        await refreshServers()
        setActionMessage(zh ? '已保存，正在测试连通性…' : 'Saved. Testing connectivity…')
        // 保存后顺手探一次：把「配好了但连不上」当场暴露出来
        void handleTest(url)
      } else if (!res.success) {
        setError(res.error ?? 'save failed')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }, [draft, zh, refreshServers])

  const handleTest = useCallback(
    async (url: string) => {
      setBusy(`test:${url}`)
      try {
        const res = await api.a2a.testConnection(url)
        if (res.success && res.data) {
          const s = res.data.server
          setActionMessage(
            s.reachable
              ? zh
                ? `连通成功${s.card?.name ? `：${s.card.name}` : ''}`
                : `Connected${s.card?.name ? `: ${s.card.name}` : ''}`
              : s.lastError || (zh ? '连接失败' : 'Connection failed'),
          )
          if (s.reachable) setExpandedCard(url)
          else setExpandedCard(null)
        } else if (!res.success) {
          setError(res.error ?? 'test failed')
        }
        await refreshServers()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(null)
      }
    },
    [zh, refreshServers],
  )

  const handleToggleAgent = useCallback(
    async (server: A2aServerState) => {
      setBusy(`toggle:${server.url}`)
      try {
        const res = await api.a2a.upsertServer(server.url, { enabled: !server.enabled })
        if (res.success && res.data) {
          setConfig(res.data.config)
          setIssues(res.data.issues)
        } else if (!res.success) {
          setError(res.error ?? 'toggle failed')
        }
        await refreshServers()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(null)
      }
    },
    [refreshServers],
  )

  const handleRemoveAgent = useCallback(
    async (server: A2aServerState) => {
      setBusy(`remove:${server.url}`)
      try {
        const res = await api.a2a.removeServer(server.url)
        if (res.success && res.data) {
          setConfig(res.data.config)
          setIssues(res.data.issues)
          if (editing === server.url) setEditing(null)
          if (expandedCard === server.url) setExpandedCard(null)
        } else if (!res.success) {
          setError(res.error ?? 'remove failed')
        }
        await refreshServers()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(null)
      }
    },
    [editing, expandedCard, refreshServers],
  )

  const handleProbe = useCallback(async () => {
    const target = editing === NEW_AGENT ? draft.url.trim() : editing ?? ''
    if (!target || !probeQuery.trim()) return

    setBusy('probe')
    setProbeResult(null)
    try {
      const res = await api.a2a.call(target, probeQuery.trim())
      if (res.success && res.data) setProbeResult(res.data)
      else if (!res.success) setError(res.error ?? 'call failed')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }, [draft.url, editing, probeQuery])

  const applyInbound = useCallback(
    async (patch: Partial<A2aInboundConfig>, label: string) => {
      if (!config) return
      setBusy(`inbound:${label}`)
      try {
        const next = { ...config.inbound, ...patch }
        const res = await api.a2a.updateConfig({ inbound: next })
        if (res.success && res.data) {
          setConfig(res.data.config)
          setIssues(res.data.issues)
          setInboundDraft(res.data.config.inbound)
        } else if (!res.success) {
          setError(res.error ?? 'update failed')
        }
        await refreshServers()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(null)
      }
    },
    [config, refreshServers],
  )

  const handleRestartInbound = useCallback(async () => {
    setBusy('inbound:restart')
    try {
      const res = await api.a2a.restartInbound()
      if (res.success && res.data) setStatus(res.data.status)
      else if (!res.success) setError(res.error ?? 'restart failed')
      await refreshServers()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }, [refreshServers])

  const handleReset = useCallback(async () => {
    setBusy('reset')
    try {
      const res = await api.a2a.resetConfig()
      if (res.success && res.data) {
        setConfig(res.data.config)
        setIssues(res.data.issues)
        setInboundDraft(res.data.config.inbound)
        setEditing(null)
        setExpandedCard(null)
        setActionMessage(zh ? '已恢复默认（所有 token 已清空）' : 'Reset to defaults (all tokens cleared)')
      }
      await refreshServers()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }, [zh, refreshServers])

  const copyText = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setActionMessage(zh ? `已复制：${text}` : `Copied: ${text}`)
    } catch (err) {
      logger.system.warn('[A2aSettings] copy failed:', err)
    }
  }, [zh])

  // --------------------------------------------
  // 派生
  // --------------------------------------------
  const enabledCount = useMemo(() => servers.filter((s) => s.enabled).length, [servers])
  const inbound = status?.inbound ?? null
  const toolVisible = Boolean(config?.enabled) && enabledCount > 0

  // --------------------------------------------
  // 渲染
  // --------------------------------------------
  return (
    <div className="space-y-4">
      {/* 概览 */}
      <Card title={zh ? 'A2A（Agent2Agent）协议' : 'A2A (Agent2Agent) protocol'}>
        <div className="text-xs leading-relaxed text-text-muted">
          {zh
            ? 'A2A 是「智能体级」互操作协议：把外部智能体当成一位会自己干活的同事来调用。它与 MCP（工具级）、Skills、HTTP 请求共同组成 AweeClaw 的四大自定义接口。'
            : 'A2A is an agent-level interoperability protocol: call an external agent as a capable colleague. Together with MCP (tool-level), Skills and HTTP requests, it completes AweeClaw’s four custom interfaces.'}
        </div>
        <ToggleRow
          label={zh ? '启用 A2A 出站' : 'Enable A2A outbound'}
          hint={
            zh
              ? '开启后，模型会获得 a2a_tool_call 工具，可调用下方「已启用」的智能体'
              : 'When on, the model receives the a2a_tool_call tool for enabled agents below'
          }
          checked={Boolean(config?.enabled)}
          disabled={!config || busy === 'module'}
          onChange={(next) => void handleToggleEnabled(next)}
        />
        <div className="flex flex-wrap items-center gap-3 text-xs text-text-muted">
          <span>{zh ? `已配置 ${servers.length} 个 · 已启用 ${enabledCount} 个` : `${servers.length} configured · ${enabledCount} enabled`}</span>
          <span
            className={`rounded-full border px-2 py-0.5 text-[11px] ${
              toolVisible
                ? 'border-emerald-400/50 text-emerald-400'
                : 'border-border/50 text-text-muted'
            }`}
          >
            {toolVisible
              ? zh
                ? '工具对模型可见'
                : 'Tool visible to model'
              : zh
                ? '工具对模型不可见'
                : 'Tool hidden from model'}
          </span>
          <ActionButton
            label={zh ? '刷新' : 'Refresh'}
            icon={<RefreshCw className="h-3.5 w-3.5" />}
            onClick={() => void refreshAll()}
          />
          <ActionButton
            label={zh ? '恢复默认' : 'Reset'}
            disabled={busy === 'reset'}
            onClick={() => void handleReset()}
          />
        </div>
        {actionMessage ? <div className="text-xs text-accent">{actionMessage}</div> : null}
        {error ? (
          <div className="rounded-lg border border-red-400/40 bg-red-400/5 px-3 py-2 text-xs text-red-400">
            {error}
          </div>
        ) : null}
        {issues.length > 0 ? (
          <ul className="space-y-1 text-xs text-amber-400">
            {issues.map((issue) => (
              <li key={issue}>· {issue}</li>
            ))}
          </ul>
        ) : null}
      </Card>

      {/* Agent 列表 */}
      <Card
        title={zh ? `外部智能体（${servers.length}）` : `External agents (${servers.length})`}
      >
        {servers.length === 0 ? (
          <div className="text-xs text-text-muted">
            {zh
              ? '尚未配置任何智能体。点击下方「添加智能体」填入对方的 A2A 服务地址。'
              : 'No agents yet. Use “Add agent” below with the peer’s A2A service URL.'}
          </div>
        ) : null}

        <div className="space-y-2">
          {servers.map((server) => {
            const isEditing = editing === server.url
            const isCardOpen = expandedCard === server.url
            return (
              <div key={server.url} className="rounded-xl border border-border/40 bg-background/40 p-3 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <Server className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />
                      <span className="truncate font-mono text-xs text-text-primary" title={server.url}>
                        {server.url}
                      </span>
                      <ReachBadge server={server} zh={zh} />
                      {server.hasToken ? (
                        <span className="rounded-full border border-border/50 px-2 py-0.5 text-[11px] text-text-muted">
                          {zh ? '已配置 Token' : 'token set'}
                        </span>
                      ) : null}
                    </div>
                    <div className="text-xs text-text-muted">
                      {server.description || (zh ? '（未填写用途描述）' : '(no description)')}
                    </div>
                    {server.skills.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {server.skills.map((skill) => (
                          <span
                            key={skill}
                            className="rounded-md border border-border/40 bg-surface/60 px-1.5 py-0.5 text-[11px] text-text-muted"
                          >
                            {skill}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {server.reachable === false && server.lastError ? (
                      <div className="text-[11px] text-red-400">{server.lastError}</div>
                    ) : null}
                  </div>

                  <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-1.5">
                    <ActionButton
                      label={server.enabled ? (zh ? '已启用' : 'enabled') : zh ? '已停用' : 'disabled'}
                      icon={<Link2 className="h-3.5 w-3.5" />}
                      disabled={busy === `toggle:${server.url}`}
                      onClick={() => void handleToggleAgent(server)}
                    />
                    <ActionButton
                      label={zh ? '测试' : 'Test'}
                      icon={<Activity className="h-3.5 w-3.5" />}
                      disabled={busy === `test:${server.url}`}
                      onClick={() => void handleTest(server.url)}
                    />
                    <ActionButton
                      label={zh ? '编辑' : 'Edit'}
                      icon={<Plug className="h-3.5 w-3.5" />}
                      onClick={() => {
                        setEditing(server.url)
                        setDraft(toDraft(server.url, server))
                        setProbeResult(null)
                        setRevealToken(false)
                      }}
                    />
                    <ActionButton
                      label={zh ? '删除' : 'Delete'}
                      icon={<Trash2 className="h-3.5 w-3.5" />}
                      disabled={busy === `remove:${server.url}`}
                      onClick={() => void handleRemoveAgent(server)}
                    />
                  </div>
                </div>

                {/* Agent Card 展开 */}
                {isCardOpen && server.card ? (
                  <AgentCardView card={server.card} zh={zh} />
                ) : null}

                {/* 行内编辑 */}
                {isEditing ? (
                  <div className="space-y-2 rounded-lg border border-border/40 bg-surface/40 p-3">
                    <Field
                      label={zh ? '用途描述（会拼进工具描述，帮助模型判断何时调用）' : 'Description (included in tool description)'}
                      value={draft.description}
                      placeholder={zh ? '例如：负责翻译长文，支持中英日' : 'e.g. long-form translation'}
                      onChange={(v) => setDraft({ ...draft, description: v })}
                    />
                    <Field
                      label={zh ? '技能标签（逗号分隔）' : 'Skill tags (comma separated)'}
                      value={draft.skillsText}
                      placeholder="translate, summarize"
                      onChange={(v) => setDraft({ ...draft, skillsText: v })}
                    />
                    <Field
                      label={zh ? '访问 Token（可选，Bearer 认证）' : 'Access token (optional, Bearer)'}
                      value={draft.token}
                      secret
                      revealed={revealToken}
                      onToggleReveal={() => setRevealToken((v) => !v)}
                      hint={zh ? '留空表示沿用已保存的凭证' : 'Leave empty to keep the stored credential'}
                      onChange={(v) => setDraft({ ...draft, token: v })}
                    />
                    <Field
                      label={zh ? '自定义请求头（可选，JSON）' : 'Custom headers (optional, JSON)'}
                      value={draft.headersText}
                      placeholder='{"X-API-Key": "..."}'
                      onChange={(v) => setDraft({ ...draft, headersText: v })}
                    />
                    <ToggleRow
                      label={zh ? '启用该智能体' : 'Enable this agent'}
                      checked={draft.enabled}
                      onChange={(v) => setDraft({ ...draft, enabled: v })}
                    />

                    {/* 试跑 */}
                    <div className="space-y-2 rounded-lg border border-border/40 bg-background/40 p-2">
                      <div className="text-xs text-text-muted">
                        {zh ? '试跑：向该智能体发一句话，验证链路是否通' : 'Probe: send one message to verify the link'}
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          value={probeQuery}
                          placeholder={zh ? '例如：用一句话介绍你自己' : 'e.g. introduce yourself in one sentence'}
                          onChange={(e) => setProbeQuery(e.target.value)}
                          className="flex-1 min-w-0 rounded-lg border border-border/50 bg-background/60 px-3 py-1.5 text-xs text-text-primary"
                        />
                        <ActionButton
                          label={zh ? '发送' : 'Send'}
                          icon={<Play className="h-3.5 w-3.5" />}
                          disabled={busy === 'probe' || !probeQuery.trim()}
                          onClick={() => void handleProbe()}
                        />
                      </div>
                      {probeResult ? (
                        <div className="space-y-1">
                          <div className={`text-[11px] ${probeResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                            {probeResult.ok
                              ? zh
                                ? `成功 · ${probeResult.durationMs}ms`
                                : `OK · ${probeResult.durationMs}ms`
                              : zh
                                ? '失败'
                                : 'failed'}
                          </div>
                          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/40 bg-surface/60 p-2 text-[11px] text-text-muted">
                            {probeResult.ok ? probeResult.text : probeResult.error}
                          </pre>
                        </div>
                      ) : null}
                    </div>

                    <div className="flex items-center gap-2">
                      <ActionButton
                        label={busy === 'save' ? (zh ? '保存中…' : 'Saving…') : zh ? '保存' : 'Save'}
                        disabled={busy === 'save'}
                        onClick={() => void handleSaveAgent()}
                      />
                      <ActionButton
                        label={zh ? '取消' : 'Cancel'}
                        onClick={() => {
                          setEditing(null)
                          setDraft(toDraft(''))
                          setProbeResult(null)
                        }}
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>

        {/* 新建 */}
        {editing === NEW_AGENT ? (
          <div className="space-y-2 rounded-xl border border-accent/40 bg-accent/5 p-3">
            <Field
              label={zh ? 'A2A 智能体地址' : 'A2A agent URL'}
              value={draft.url}
              placeholder="http://127.0.0.1:9999"
              hint={zh ? '对方 A2A 服务的根地址（Agent Card 位于 /.well-known/agent.json）' : 'Peer A2A service root (card at /.well-known/agent.json)'}
              onChange={(v) => setDraft({ ...draft, url: v })}
            />
            <Field
              label={zh ? '用途描述' : 'Description'}
              value={draft.description}
              placeholder={zh ? '例如：负责翻译长文，支持中英日' : 'e.g. long-form translation'}
              onChange={(v) => setDraft({ ...draft, description: v })}
            />
            <Field
              label={zh ? '技能标签（逗号分隔）' : 'Skill tags (comma separated)'}
              value={draft.skillsText}
              placeholder="translate, summarize"
              onChange={(v) => setDraft({ ...draft, skillsText: v })}
            />
            <Field
              label={zh ? '访问 Token（可选）' : 'Access token (optional)'}
              value={draft.token}
              secret
              revealed={revealToken}
              onToggleReveal={() => setRevealToken((v) => !v)}
              onChange={(v) => setDraft({ ...draft, token: v })}
            />
            <Field
              label={zh ? '自定义请求头（可选，JSON）' : 'Custom headers (optional, JSON)'}
              value={draft.headersText}
              placeholder='{"X-API-Key": "..."}'
              onChange={(v) => setDraft({ ...draft, headersText: v })}
            />
            <div className="flex items-center gap-2">
              <ActionButton
                label={busy === 'save' ? (zh ? '保存中…' : 'Saving…') : zh ? '保存并测试' : 'Save & test'}
                disabled={busy === 'save'}
                onClick={() => void handleSaveAgent()}
              />
              <ActionButton
                label={zh ? '取消' : 'Cancel'}
                onClick={() => {
                  setEditing(null)
                  setDraft(toDraft(''))
                }}
              />
            </div>
          </div>
        ) : (
          <ActionButton
            label={zh ? '添加智能体' : 'Add agent'}
            icon={<Plus className="h-3.5 w-3.5" />}
            onClick={() => {
              setEditing(NEW_AGENT)
              setDraft(toDraft(''))
              setRevealToken(false)
              setProbeResult(null)
            }}
          />
        )}
      </Card>

      {/* 入站服务 */}
      <Card title={zh ? '入站：把 AweeClaw 暴露为 A2A 智能体' : 'Inbound: expose AweeClaw as an A2A agent'}>
        <ToggleRow
          label={zh ? '启用入站服务' : 'Enable inbound server'}
          hint={zh ? '默认关闭。开启后外部智能体可调用本机 AI（走当前配置的模型）' : 'Off by default. When on, external agents can call your local AI'}
          checked={Boolean(inboundDraft?.enabled)}
          disabled={!inboundDraft || busy === 'inbound:enable'}
          onChange={(next) => void applyInbound({ enabled: next }, 'enable')}
        />

        {inboundDraft?.enabled ? (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field
                label={zh ? '监听地址' : 'Bind host'}
                value={inboundDraft.host}
                placeholder="127.0.0.1"
                hint={zh ? '改动后需点「应用地址与端口」' : 'Requires “Apply host & port”'}
                onChange={(v) => setInboundDraft({ ...inboundDraft, host: v })}
              />
              <Field
                label={zh ? '端口' : 'Port'}
                value={String(inboundDraft.port)}
                placeholder="8790"
                hint={zh ? '端口被占用时会自动 +1 重试' : 'Auto-increments on conflict'}
                onChange={(v) =>
                  setInboundDraft({ ...inboundDraft, port: Number(v.replace(/[^0-9]/g, '')) || 0 })
                }
              />
              <Field
                label={zh ? '对外声明名称' : 'Agent name'}
                value={inboundDraft.agentName}
                onChange={(v) => setInboundDraft({ ...inboundDraft, agentName: v })}
              />
              <Field
                label={zh ? '访问 Token' : 'Access token'}
                value={inboundDraft.token}
                secret
                revealed={revealInboundToken}
                onToggleReveal={() => setRevealInboundToken((v) => !v)}
                hint={zh ? '设置后，JSON-RPC 调用必须携带 Authorization: Bearer <token>' : 'When set, JSON-RPC requires Authorization: Bearer <token>'}
                onChange={(v) => setInboundDraft({ ...inboundDraft, token: v })}
              />
            </div>

            {!isLoopback(inboundDraft.host) ? (
              <div className="space-y-2 rounded-lg border border-amber-400/40 bg-amber-400/5 p-3">
                <ToggleRow
                  label={zh ? '允许外部（非本机）访问' : 'Allow non-local access'}
                  hint={
                    zh
                      ? '风险：监听非环回地址意味着局域网/公网可达。必须同时设置访问 Token；未勾选时会被强制降级回 127.0.0.1'
                      : 'Risk: non-loopback binding is reachable from your network. Set an access token; without this flag it is downgraded to 127.0.0.1'
                  }
                  checked={inboundDraft.allowExternal}
                  disabled={busy === 'inbound:allowExternal'}
                  onChange={(next) => void applyInbound({ allowExternal: next }, 'allowExternal')}
                />
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <ActionButton
                label={busy === 'inbound:endpoint' ? (zh ? '应用中…' : 'Applying…') : zh ? '应用地址与端口' : 'Apply host & port'}
                disabled={busy === 'inbound:endpoint'}
                onClick={() =>
                  void applyInbound(
                    { host: inboundDraft.host, port: inboundDraft.port, agentName: inboundDraft.agentName, token: inboundDraft.token },
                    'endpoint',
                  )
                }
              />
              <ActionButton
                label={busy === 'inbound:restart' ? (zh ? '重启中…' : 'Restarting…') : zh ? '重启服务' : 'Restart'}
                icon={<RotateCw className="h-3.5 w-3.5" />}
                disabled={busy === 'inbound:restart'}
                onClick={() => void handleRestartInbound()}
              />
            </div>

            {inbound ? (
              <div className="space-y-2 rounded-lg border border-border/40 bg-background/40 p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[11px] ${
                      inbound.running
                        ? 'border-emerald-400/50 text-emerald-400'
                        : 'border-border/50 text-text-muted'
                    }`}
                  >
                    {inbound.running ? (zh ? '监听中' : 'listening') : zh ? '未运行' : 'stopped'}
                  </span>
                  <span className="font-mono">{inbound.url}</span>
                  <ActionButton
                    label={zh ? '复制地址' : 'Copy'}
                    icon={<Copy className="h-3.5 w-3.5" />}
                    onClick={() => void copyText(inbound.url)}
                  />
                  <ActionButton
                    label={zh ? '复制卡片地址' : 'Copy card'}
                    icon={<Copy className="h-3.5 w-3.5" />}
                    onClick={() => void copyText(inbound.cardUrl)}
                  />
                </div>
                <div className="text-[11px] text-text-muted">
                  {zh
                    ? `已处理请求 ${inbound.requests} 次 · 失败 ${inbound.errors} 次${
                        inbound.lastRequestAt ? ` · 最近 ${new Date(inbound.lastRequestAt).toLocaleTimeString()}` : ''
                      } · 鉴权：${inbound.tokenRequired ? '要求 Bearer Token' : '无（仅限本机）'}`
                    : `requests ${inbound.requests} · errors ${inbound.errors} · auth: ${inbound.tokenRequired ? 'Bearer required' : 'none (local only)'}`}
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
                  <ExternalLink className="h-3 w-3" />
                  {zh
                    ? '对方可用此地址发现技能：Agent Card 返回 name / version / skills'
                    : 'Peers discover skills here: the card returns name / version / skills'}
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </Card>

      {/* 最近调用 */}
      {status && status.recent.length > 0 ? (
        <Card title={zh ? '最近调用' : 'Recent calls'}>
          <div className="space-y-1">
            {status.recent.map((record) => (
              <div key={record.id} className="flex items-start justify-between gap-3 text-[11px]">
                <div className="min-w-0">
                  <span className={record.ok ? 'text-emerald-400' : 'text-red-400'}>
                    {record.ok ? 'OK' : 'FAIL'}
                  </span>
                  <span className="ml-2 font-mono text-text-muted">{record.url}</span>
                  <div className="truncate text-text-muted" title={record.query}>
                    {record.query}
                  </div>
                  {record.error ? <div className="text-red-400">{record.error}</div> : null}
                </div>
                <div className="flex-shrink-0 text-text-muted">
                  {record.durationMs}ms · {new Date(record.at).toLocaleTimeString()}
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  )
}

/** 展示 Agent Card 的核心信息 */
function AgentCardView({ card, zh }: { card: A2aAgentCard; zh: boolean }) {
  return (
    <div className="space-y-2 rounded-lg border border-border/40 bg-surface/40 p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium text-text-primary">{card.name}</span>
        {card.version ? <span className="text-text-muted">v{card.version}</span> : null}
        {card.protocolVersion ? (
          <span className="rounded-full border border-border/50 px-2 py-0.5 text-[11px] text-text-muted">
            protocol {card.protocolVersion}
          </span>
        ) : null}
        <span className="rounded-full border border-border/50 px-2 py-0.5 text-[11px] text-text-muted">
          streaming: {card.capabilities?.streaming ? 'on' : 'off'}
        </span>
      </div>
      {card.description ? <div className="text-xs text-text-muted">{card.description}</div> : null}
      {card.provider?.organization ? (
        <div className="text-[11px] text-text-muted">
          {zh ? '提供方' : 'provider'}：{card.provider.organization}
        </div>
      ) : null}
      {card.skills && card.skills.length > 0 ? (
        <div className="space-y-1">
          <div className="text-[11px] uppercase tracking-wide text-text-muted">
            {zh ? '技能' : 'skills'}
          </div>
          <ul className="space-y-1">
            {card.skills.map((skill) => (
              <li key={skill.id} className="text-xs text-text-muted">
                <span className="text-text-primary">{skill.name || skill.id}</span>
                {skill.description ? ` — ${skill.description}` : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

/** 是否环回地址（与主进程 A2aStore 的白名单保持一致） */
function isLoopback(host: string): boolean {
  return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host.trim())
}

export default A2aSettings