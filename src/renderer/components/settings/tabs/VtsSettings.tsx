/**
 * VtsSettings — VTS（VTube Studio）联动设置面板
 *
 * 设计要点：
 * 1. **默认关闭**：与直播模块同一约束，外部应用的模型接管能力必须由用户主动开启。
 * 2. **授权是显式动作**：首次连接会在 VTS 侧弹授权窗，token 落盘后免授权。
 *    token 失效时（VTS 重启换密钥 / 用户在 VTS 里撤销）会收到 authenticated:false，
 *    此时面板给出「重新授权」按钮而不是反复自动重连 —— 后者只会反复弹窗骚扰用户。
 * 3. **token 按密文展示**：password 输入框 + 显隐开关。
 * 4. **草稿 + 显式保存**：只有「连接参数」（地址 / 插件名 / token）变化才需要重连，
 *    因此这些字段走草稿；口型模式、开关类选项即时生效（保存后主进程原地生效不重连）。
 * 5. **口型可视化**：实时显示 MouthOpen 值 —— 这是判断「算法是否在工作」最快的信号，
 *    比看 VTS 画面还直接。
 * 6. **与 VRM 伴侣的口型互斥提示**：两者可同时连接，但同一份 TTS 音频不该被两套
 *    口型链路同时消费，面板顶部明确提示。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Activity, Eye, EyeOff, Link2, Link2Off, Play, RefreshCw, Square, Unplug } from 'lucide-react'
import type { Language } from '@renderer/i18n'
import { api } from '@renderer/adapters/electronBridge'
import { logger } from '@shared/toolkit/LogEngine'
import type { VtsConfig, VtsConnectionState, VtsStatus } from '@renderer/types/electronBridge'
import { useFeatureGuard } from '@hooks/useFeatureGuard'

interface VtsSettingsProps {
  language: Language
}

// ============================================
// 通用 UI 原子（与 LiveSettings 保持一致）
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
            checked ? 'left-[1.15rem]' : 'left-0.5'
          }`}
        />
      </button>
    </div>
  )
}

/** 文本输入行（secret 时用 password + 显隐按钮） */
function Field({
  label,
  value,
  placeholder,
  disabled,
  secret,
  revealed,
  onToggleReveal,
  hint,
  onChange,
}: {
  label: string
  value: string
  placeholder?: string
  disabled?: boolean
  secret?: boolean
  revealed?: boolean
  onToggleReveal?: () => void
  hint?: string
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
          onChange={e => onChange(e.target.value)}
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

/** 连接状态徽标 */
function StateBadge({ state, zh }: { state: VtsConnectionState; zh: boolean }) {
  const map: Record<VtsConnectionState, { zh: string; en: string; className: string }> = {
    idle: { zh: '未启动', en: 'idle', className: 'border-border/50 text-text-muted' },
    connecting: { zh: '连接中', en: 'connecting', className: 'border-amber-400/50 text-amber-400' },
    authenticating: {
      zh: '等待授权',
      en: 'authenticating',
      className: 'border-amber-400/50 text-amber-400',
    },
    connected: { zh: '已连接', en: 'connected', className: 'border-emerald-400/50 text-emerald-400' },
    error: { zh: '出错', en: 'error', className: 'border-red-400/50 text-red-400' },
    stopped: { zh: '已断开', en: 'stopped', className: 'border-border/50 text-text-muted' },
  }
  const item = map[state]
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[11px] ${item.className}`}>
      {zh ? item.zh : item.en}
    </span>
  )
}

/** 小按钮 */
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

/** 表单小标题 */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-xs font-medium text-text-muted uppercase tracking-wide">{children}</div>
}

// ============================================
// 面板
// ============================================

export function VtsSettings({ language }: VtsSettingsProps) {
  const zh = language === 'zh'
  // 套餐能力拦截：VTS 联动为高级能力，未解锁时禁止开启
  const { requireFeature } = useFeatureGuard()

  const [saved, setSaved] = useState<VtsConfig | null>(null)
  const [draft, setDraft] = useState<VtsConfig | null>(null)
  const [status, setStatus] = useState<VtsStatus | null>(null)
  const [issues, setIssues] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  /** 连接动作的独立错误（与配置错误分开显示，避免互相覆盖） */
  const [connectError, setConnectError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [manualName, setManualName] = useState('')
  const [actionMessage, setActionMessage] = useState<string | null>(null)

  const dirty = useMemo(
    () => !!saved && !!draft && JSON.stringify(saved) !== JSON.stringify(draft),
    [saved, draft],
  )

  /** 轮询定时器引用（卸载时必须清掉） */
  const pollRef = useRef<number | null>(null)

  // --------------------------------------------
  // 初始化 / 状态订阅 + 轮询
  // --------------------------------------------
  const loadConfig = useCallback(async () => {
    try {
      const res = await api.vts.getConfig()
      if (res.success && res.data) {
        setSaved(res.data.config)
        setDraft(res.data.config)
        setIssues(res.data.issues)
        setError(null)
      } else if (!res.success) {
        setError(res.error ?? 'load failed')
      }
    } catch (err) {
      logger.system.warn('[VtsSettings] load config failed:', err)
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const refreshStatus = useCallback(async () => {
    try {
      const res = await api.vts.getStatus()
      if (res.success && res.data) setStatus(res.data)
    } catch (err) {
      logger.system.debug('[VtsSettings] load status failed:', err)
    }
  }, [])

  useEffect(() => {
    void loadConfig()
    void refreshStatus()

    // 订阅：连接状态 / 模型数据变化时立即刷新（不必等下一次轮询）
    const off = api.vts.onStatus(payload => {
      try {
        setStatus(payload.status)
      } catch (err) {
        logger.system.debug('[VtsSettings] status push failed:', err)
      }
    })

    // 轮询：口型值与帧统计只在主进程内存里变化，没有推送事件
    pollRef.current = window.setInterval(() => void refreshStatus(), 800)

    return () => {
      off()
      if (pollRef.current !== null) {
        window.clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [loadConfig, refreshStatus])

  // --------------------------------------------
  // 派生
  // --------------------------------------------
  const patchDraft = useCallback((patch: Partial<VtsConfig>) => {
    setDraft(prev => (prev ? { ...prev, ...patch } : prev))
  }, [])

  const connectionReady = !!status?.enabled && !!status?.authenticated

  // --------------------------------------------
  // 动作
  // --------------------------------------------

  /** 保存并应用：只提交脏字段，避免把用户没动过的 token 重写一遍盘 */
  const handleSave = useCallback(async () => {
    if (!draft || !saved) return

    setBusy(true)
    setError(null)
    try {
      const patch: Record<string, unknown> = {}
      for (const key of Object.keys(draft) as Array<keyof VtsConfig>) {
        if (draft[key] !== saved[key]) patch[key] = draft[key]
      }

      // 没有脏字段就不下发：applyConfig 收到空 patch 也会走一遍指纹比对，
      // 虽然不会重连，但白白多一次 IPC + 落盘
      if (Object.keys(patch).length === 0) {
        setBusy(false)
        return
      }

      const res = await api.vts.updateConfig(patch as Partial<VtsConfig>)
      if (res.success && res.data) {
        setSaved(res.data.config)
        setDraft(res.data.config)
        setIssues(res.data.issues)
      } else if (!res.success) {
        setError(res.error ?? 'save failed')
      }
      void refreshStatus()
    } catch (err) {
      logger.system.warn('[VtsSettings] save failed:', err)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [draft, saved, refreshStatus])

  /** 总开关：即时生效 */
  const handleToggleEnabled = useCallback(
    async (next: boolean) => {
      // 套餐能力拦截：开启前校验（VTS 联动为高级能力）
      if (next && !(await requireFeature('vts'))) return
      setBusy(true)
      setConnectError(null)
      try {
        const res = await api.vts.updateConfig({ enabled: next })
        if (res.success && res.data) {
          setSaved(res.data.config)
          setDraft(res.data.config)
          setIssues(res.data.issues)
        }
        // 开启时连接失败要显式告知：否则用户会以为「开了但没反应」
        const statusRes = await api.vts.getStatus()
        if (statusRes.success && statusRes.data) {
          setStatus(statusRes.data)
          if (next && !statusRes.data.authenticated && statusRes.data.message) {
            setConnectError(statusRes.data.message)
          }
        }
      } catch (err) {
        logger.system.warn('[VtsSettings] toggle failed:', err)
      } finally {
        setBusy(false)
      }
    },
    [],
  )

  const handleConnect = useCallback(async () => {
    setBusy(true)
    setConnectError(null)
    try {
      const res = await api.vts.connect()
      if (!res.success) setConnectError(res.error ?? 'connect failed')
      void refreshStatus()
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [refreshStatus])

  const handleReconnect = useCallback(async () => {
    setBusy(true)
    setConnectError(null)
    try {
      const res = await api.vts.reconnect()
      if (!res.success) setConnectError(res.error ?? 'reconnect failed')
      void refreshStatus()
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [refreshStatus])

  const handleDisconnect = useCallback(async () => {
    setBusy(true)
    try {
      await api.vts.disconnect()
      void refreshStatus()
    } catch (err) {
      logger.system.warn('[VtsSettings] disconnect failed:', err)
    } finally {
      setBusy(false)
    }
  }, [refreshStatus])

  const handleSelfTest = useCallback(async () => {
    setActionMessage(null)
    try {
      const res = await api.vts.selfTest(1500)
      setActionMessage(
        res.success
          ? zh
            ? `已注入 ${res.data?.queued ?? 0} 帧，观察 VTS 模型嘴型`
            : `Queued ${res.data?.queued ?? 0} frames — watch the model's mouth`
          : (res.error ?? 'self test failed'),
      )
      void refreshStatus()
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : String(err))
    }
  }, [refreshStatus, zh])

  const handleClearAudio = useCallback(async () => {
    try {
      await api.vts.clearAudio()
      void refreshStatus()
    } catch (err) {
      logger.system.warn('[VtsSettings] clear audio failed:', err)
    }
  }, [refreshStatus])

  const handleManualTrigger = useCallback(async () => {
    const name = manualName.trim()
    if (!name) return
    setActionMessage(null)
    try {
      const res = await api.vts.trigger(name)
      if (res.success) {
        const hit = res.data?.triggered
        setActionMessage(
          hit
            ? zh
              ? `已触发 ${hit.kind === 'expression' ? '表情' : '热键'}：${hit.name}`
              : `Triggered ${hit.kind}: ${hit.name}`
            : zh
              ? `未找到名为「${name}」的表情或热键`
              : `No expression or hotkey named "${name}"`,
        )
      } else {
        setActionMessage(res.error ?? 'trigger failed')
      }
      void refreshStatus()
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : String(err))
    }
  }, [manualName, refreshStatus, zh])

  const handleRefreshData = useCallback(async () => {
    try {
      const res = await api.vts.refreshData()
      if (res.success && res.data) setStatus(res.data)
    } catch (err) {
      logger.system.warn('[VtsSettings] refresh data failed:', err)
    }
  }, [])

  // --------------------------------------------
  // 渲染
  // --------------------------------------------
  const mouthPercent = Math.round(Math.min(1, Math.max(0, status?.mouthOpen ?? 0)) * 100)

  return (
    <div className="space-y-4">
      {/* ---------- 总开关 ---------- */}
      <Card>
        <ToggleRow
          label={zh ? '启用 VTS 联动' : 'Enable VTS integration'}
          hint={
            zh
              ? '在 VTube Studio 中打开「设置 → API → 允许插件访问」，再回到本页连接。'
              : 'Enable “Allow Plugin API” in VTube Studio → Settings → API, then connect here.'
          }
          checked={!!draft?.enabled}
          disabled={busy}
          onChange={next => void handleToggleEnabled(next)}
        />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <StateBadge state={status?.state ?? 'idle'} zh={zh} />
          {status?.message ? <span className="text-text-muted">{status.message}</span> : null}
        </div>
        {connectError ? (
          <div className="rounded-lg border border-red-400/40 bg-red-500/5 px-3 py-2 text-xs text-red-400">
            {connectError}
          </div>
        ) : null}
        <div className="rounded-lg border border-amber-400/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-300/90">
          {zh
            ? '提示：VTS 与「桌面伴侣（VRM）」可同时连接，但同一份 TTS 音频的口型数据源只应有一个 —— 两者都开会造成嘴型互相覆盖。'
            : 'Note: VTS and the VRM desktop companion can both stay connected, but only one should consume the TTS audio for lip sync — running both makes the mouth jitter.'}
        </div>
      </Card>

      {/* ---------- 连接 ---------- */}
      <Card title={zh ? '连接与授权' : 'Connection & Auth'}>
        <Field
          label={zh ? 'VTS API 地址' : 'VTS API URL'}
          value={draft?.url ?? ''}
          placeholder="ws://127.0.0.1:8001"
          disabled={busy || !draft?.enabled}
          hint={zh ? '仅支持本机环回地址（VTS 不提供远程 API）' : 'Loopback only'}
          onChange={next => patchDraft({ url: next })}
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            label={zh ? '插件名' : 'Plugin name'}
            value={draft?.pluginName ?? ''}
            disabled={busy || !draft?.enabled}
            hint={zh ? '在 VTS 授权弹窗中展示' : 'Shown in the VTS auth dialog'}
            onChange={next => patchDraft({ pluginName: next })}
          />
          <Field
            label={zh ? '开发者' : 'Developer'}
            value={draft?.pluginDeveloper ?? ''}
            disabled={busy || !draft?.enabled}
            onChange={next => patchDraft({ pluginDeveloper: next })}
          />
        </div>
        <Field
          label={zh ? '授权令牌（token）' : 'Auth token'}
          value={draft?.token ?? ''}
          disabled={busy || !draft?.enabled}
          secret
          revealed={revealed}
          onToggleReveal={() => setRevealed(v => !v)}
          hint={
            zh
              ? '首次连接时由 VTS 下发并自动加密保存；清空后点「重新授权」可再次发起'
              : 'Issued by VTS on first connect and stored encrypted; clear it then click Re-authorize'
          }
          onChange={next => patchDraft({ token: next })}
        />

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <ActionButton
            label={zh ? '连接' : 'Connect'}
            icon={<Link2 className="h-3.5 w-3.5" />}
            disabled={busy || !draft?.enabled}
            onClick={() => void handleConnect()}
          />
          <ActionButton
            label={zh ? '重新授权' : 'Re-authorize'}
            icon={<RefreshCw className="h-3.5 w-3.5" />}
            disabled={busy || !draft?.enabled}
            onClick={() => void handleReconnect()}
          />
          <ActionButton
            label={zh ? '断开' : 'Disconnect'}
            icon={<Link2Off className="h-3.5 w-3.5" />}
            disabled={busy}
            onClick={() => void handleDisconnect()}
          />
          {dirty ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleSave()}
              className="ml-auto rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {zh ? '保存并应用' : 'Save & apply'}
            </button>
          ) : null}
        </div>

        {issues.length ? (
          <ul className="space-y-1 text-xs text-amber-400/90">
            {issues.map(item => (
              <li key={item}>· {item}</li>
            ))}
          </ul>
        ) : null}
        {error ? <div className="text-xs text-red-400">{error}</div> : null}
      </Card>

      {/* ---------- 口型 ---------- */}
      <Card title={zh ? '口型同步' : 'Lip sync'}>
        <ToggleRow
          label={zh ? 'AI 说话时自动驱动口型' : 'Auto lip sync on AI speech'}
          hint={
            zh
              ? '开启后，TTS 音频会自动转发给 VTS 做口型分析（需已连接）'
              : 'TTS audio is forwarded to VTS for lip analysis (requires connection)'
          }
          checked={!!draft?.autoLipSync}
          disabled={busy || !draft?.enabled}
          onChange={next => patchDraft({ autoLipSync: next })}
        />

        <div className="space-y-1">
          <SectionLabel>{zh ? '驱动模式' : 'Mode'}</SectionLabel>
          <div className="flex flex-wrap gap-2">
            {(
              [
                {
                  value: 'fft' as const,
                  zh: '频谱分离（推荐）',
                  en: 'Spectral (recommended)',
                  hint: zh ? '区分元音/辅音，口型更自然' : 'Separates vowels/consonants',
                },
                {
                  value: 'rms' as const,
                  zh: '仅音量',
                  en: 'Volume only',
                  hint: zh ? '不跑 FFT，CPU 占用最低' : 'No FFT, lowest CPU',
                },
              ]
            ).map(option => {
              const active = draft?.lipSyncMode === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  disabled={busy || !draft?.enabled}
                  onClick={() => patchDraft({ lipSyncMode: option.value })}
                  className={`rounded-lg border px-3 py-1.5 text-left text-xs transition-colors disabled:opacity-50 ${
                    active
                      ? 'border-accent/60 bg-accent/10 text-accent'
                      : 'border-border/50 text-text-primary hover:border-accent/40'
                  }`}
                >
                  <div>{zh ? option.zh : option.en}</div>
                  <div className="text-[11px] text-text-muted">{option.hint}</div>
                </button>
              )
            })}
          </div>
        </div>

        {/* 实时口型（判断算法是否在工作的最快信号） */}
        <div className="space-y-1">
          <SectionLabel>
            {zh ? '实时口型' : 'Live mouth'}：{mouthPercent}%
          </SectionLabel>
          <div className="h-2 w-full overflow-hidden rounded-full bg-border/40">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-100"
              style={{ width: `${mouthPercent}%` }}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted">
          <span>
            {zh ? '已发送帧' : 'frames sent'}：{status?.framesSent ?? 0}
          </span>
          <span>
            {zh ? '丢弃帧' : 'dropped'}：{status?.framesDropped ?? 0}
          </span>
          <span>
            {zh ? '待发送' : 'pending'}：{status?.pendingFrames ?? 0}
          </span>
          <span>
            {zh ? '最近帧' : 'last frame'}：
            {status?.lastFrameAt ? new Date(status.lastFrameAt).toLocaleTimeString() : '—'}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <ActionButton
            label={zh ? '自测（1.5s 正弦波）' : 'Self test (1.5s tone)'}
            icon={<Play className="h-3.5 w-3.5" />}
            disabled={busy || !connectionReady}
            onClick={() => void handleSelfTest()}
          />
          <ActionButton
            label={zh ? '中断口型' : 'Stop mouth'}
            icon={<Square className="h-3.5 w-3.5" />}
            disabled={!connectionReady}
            onClick={() => void handleClearAudio()}
          />
        </div>
        {actionMessage ? <div className="text-xs text-text-muted">{actionMessage}</div> : null}
      </Card>

      {/* ---------- 触发 ---------- */}
      <Card title={zh ? '表情与热键' : 'Expressions & Hotkeys'}>
        <ToggleRow
          label={zh ? '允许 AI 触发模型表情' : 'Allow AI to trigger expressions'}
          checked={!!draft?.enabledExpressions}
          disabled={busy || !draft?.enabled}
          onChange={next => patchDraft({ enabledExpressions: next })}
        />
        <ToggleRow
          label={zh ? '允许 AI 触发热键' : 'Allow AI to trigger hotkeys'}
          checked={!!draft?.enabledMotions}
          disabled={busy || !draft?.enabled}
          onChange={next => patchDraft({ enabledMotions: next })}
        />

        <div className="flex items-center gap-2 pt-1">
          <input
            type="text"
            value={manualName}
            placeholder={zh ? '输入表情/热键名' : 'Expression or hotkey name'}
            disabled={!connectionReady}
            spellCheck={false}
            onChange={e => setManualName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') void handleManualTrigger()
            }}
            className="flex-1 min-w-0 rounded-lg border border-border/50 bg-background/60 px-3 py-1.5 text-xs text-text-primary disabled:opacity-50"
          />
          <ActionButton
            label={zh ? '触发' : 'Trigger'}
            disabled={!connectionReady || !manualName.trim()}
            onClick={() => void handleManualTrigger()}
          />
        </div>
        <div className="text-xs text-text-muted">
          {zh
            ? 'AI 输出中的 <名字> 标签会在回复结束后触发；VTS 里 ToggleExpression 类热键已自动排除，避免与表情通道重复。'
            : 'Tags like <name> in AI output fire after the reply settles; ToggleExpression hotkeys are excluded to avoid double-triggering.'}
        </div>

        {/* 模型清单 */}
        <div className="space-y-2 pt-1">
          <div className="flex items-center justify-between gap-2">
            <SectionLabel>
              {zh ? '模型表情' : 'Expressions'}（{status?.expressions.length ?? 0}）
            </SectionLabel>
            <ActionButton
              label={zh ? '刷新清单' : 'Refresh'}
              icon={<RefreshCw className="h-3.5 w-3.5" />}
              disabled={!connectionReady}
              onClick={() => void handleRefreshData()}
            />
          </div>
          {status?.expressions.length ? (
            <div className="flex flex-wrap gap-1.5">
              {status.expressions.map(exp => (
                <button
                  key={`${exp.name}-${exp.file}`}
                  type="button"
                  disabled={!connectionReady}
                  onClick={() => {
                    setManualName(exp.name)
                    void api.vts.trigger(exp.name)
                  }}
                  className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors disabled:opacity-50 ${
                    exp.active
                      ? 'border-emerald-400/50 text-emerald-400'
                      : 'border-border/50 text-text-muted hover:border-accent/50 hover:text-accent'
                  }`}
                >
                  {exp.active ? '● ' : ''}
                  {exp.name}
                </button>
              ))}
            </div>
          ) : (
            <div className="text-xs text-text-muted">
              {zh ? '未获取到表情清单（连接后自动拉取）' : 'No expressions loaded yet'}
            </div>
          )}

          <SectionLabel>
            {zh ? '模型热键' : 'Hotkeys'}（{status?.hotkeys.length ?? 0}）
          </SectionLabel>
          {status?.hotkeys.length ? (
            <div className="flex flex-wrap gap-1.5">
              {status.hotkeys.map(hk => (
                <button
                  key={hk.hotkeyID}
                  type="button"
                  disabled={!connectionReady}
                  onClick={() => {
                    setManualName(hk.name)
                    void api.vts.trigger(hk.name)
                  }}
                  className="inline-flex items-center gap-1 rounded-full border border-border/50 px-2.5 py-1 text-[11px] text-text-muted transition-colors hover:border-accent/50 hover:text-accent disabled:opacity-50"
                >
                  <Activity className="h-3 w-3" />
                  {hk.name}
                </button>
              ))}
            </div>
          ) : (
            <div className="text-xs text-text-muted">
              {zh ? '未获取到热键清单' : 'No hotkeys loaded yet'}
            </div>
          )}
        </div>
      </Card>

      {/* ---------- 重置 ---------- */}
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <ActionButton
            label={zh ? '恢复默认（清除授权）' : 'Reset (clears auth)'}
            icon={<Unplug className="h-3.5 w-3.5" />}
            disabled={busy}
            onClick={() => {
              void (async () => {
                setBusy(true)
                try {
                  const res = await api.vts.resetConfig()
                  if (res.success && res.data) {
                    setSaved(res.data.config)
                    setDraft(res.data.config)
                    setIssues(res.data.issues)
                    setConnectError(null)
                  }
                  void refreshStatus()
                } catch (err) {
                  logger.system.warn('[VtsSettings] reset failed:', err)
                } finally {
                  setBusy(false)
                }
              })()
            }}
          />
          <span className="text-xs text-text-muted">
            {zh
              ? '会清空 token 并断开连接，下次连接需在 VTS 中重新授权'
              : 'Clears the token and disconnects; next connect requires re-authorization'}
          </span>
        </div>
      </Card>
    </div>
  )
}
