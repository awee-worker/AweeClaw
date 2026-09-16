/**
 * LiveSettings — 直播互动接入设置面板（B站 / YouTube / Twitch）
 *
 * 设计要点：
 * 1. **默认全关**：总开关 + 三平台开关默认 false，必须用户主动开启（合规铁律）。
 * 2. **网页模式默认隐藏**：B站网页模式走非公开接口，必须先在「高级接入方式」里解锁，
 *    并勾选风险确认，选项才会出现；未确认时保存会被拦截。
 * 3. **凭证按密文展示**：SESSDATA / access_key_secret / api_key / token 一律用
 *    password 输入框 + 显隐开关，避免肩窥。
 * 4. **草稿 + 显式保存**：文本类字段只改本地草稿，点「保存并应用」后才下发主进程
 *    （主进程会按需重连，不能每敲一个字符就重启一次连接）。
 *    总开关与两个操作按钮（强制重连 / 停止）即时生效。
 * 5. **状态轮询**：连接态 / 事件计数 / 最近事件每 2s 刷新一次，便于排障。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Eye, EyeOff, RefreshCw, Send, ShieldAlert, Square } from 'lucide-react'
import type { Language } from '@renderer/i18n'
import { api } from '@renderer/adapters/electronBridge'
import { logger } from '@shared/toolkit/LogEngine'
import type {
  LiveAdapterStatus,
  LiveConfig,
  LiveStatus,
} from '@renderer/types/electronBridge'
import { useFeatureGuard } from '@hooks/useFeatureGuard'

interface LiveSettingsProps {
  language: Language
}

// ============================================
// 通用 UI 原子
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
function StateBadge({ status, zh }: { status: LiveAdapterStatus; zh: boolean }) {
  const map: Record<LiveAdapterStatus['state'], { zh: string; en: string; className: string }> = {
    idle: { zh: '未启动', en: 'idle', className: 'border-border/50 text-text-muted' },
    connecting: { zh: '连接中', en: 'connecting', className: 'border-amber-400/50 text-amber-400' },
    connected: { zh: '已连接', en: 'connected', className: 'border-emerald-400/50 text-emerald-400' },
    reconnecting: { zh: '重连中', en: 'reconnecting', className: 'border-amber-400/50 text-amber-400' },
    error: { zh: '出错', en: 'error', className: 'border-red-400/50 text-red-400' },
    stopped: { zh: '已停止', en: 'stopped', className: 'border-border/50 text-text-muted' },
  }
  const item = map[status.state]
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[11px] ${item.className}`}>
      {zh ? item.zh : item.en}
    </span>
  )
}

/** 平台状态行 */
function PlatformStatusRow({
  status,
  label,
  zh,
}: {
  status: LiveAdapterStatus
  label: string
  zh: boolean
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <span className="text-text-primary">{label}</span>
      <StateBadge status={status} zh={zh} />
      <span className="text-text-muted">
        {zh ? '事件' : 'events'}：{status.eventCount}
      </span>
      {status.retryCount > 0 ? (
        <span className="text-text-muted">
          {zh ? '重试' : 'retries'}：{status.retryCount}
        </span>
      ) : null}
      {status.message ? <span className="text-red-400/90">{status.message}</span> : null}
    </div>
  )
}

/** 表单小标题 */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-xs font-medium text-text-muted uppercase tracking-wide">{children}</div>
}

// ============================================
// 面板
// ============================================

export function LiveSettings({ language }: LiveSettingsProps) {
  const zh = language === 'zh'
  // 套餐能力拦截：直播互动为高级能力，未解锁时禁止开启
  const { requireFeature } = useFeatureGuard()

  const [saved, setSaved] = useState<LiveConfig | null>(null)
  const [draft, setDraft] = useState<LiveConfig | null>(null)
  const [status, setStatus] = useState<LiveStatus | null>(null)
  const [issues, setIssues] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [testText, setTestText] = useState('')

  /** 高级接入方式解锁（网页模式默认不可见） */
  const [advancedUnlocked, setAdvancedUnlocked] = useState(false)
  /** 凭证显隐（按字段名） */
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})

  const dirty = useMemo(
    () => !!saved && !!draft && JSON.stringify(saved) !== JSON.stringify(draft),
    [saved, draft],
  )

  const toggleReveal = useCallback((field: string) => {
    setRevealed(prev => ({ ...prev, [field]: !prev[field] }))
  }, [])

  // --------------------------------------------
  // 初始化 / 状态轮询
  // --------------------------------------------
  const loadConfig = useCallback(async () => {
    try {
      const res = await api.live.getConfig()
      if (res.success && res.data) {
        setSaved(res.data.config)
        setDraft(res.data.config)
        setIssues(res.data.issues)
        setError(null)
        // 已保存为网页模式时自动解锁高级设置，否则用户看不到自己选的选项
        if (res.data.config.bilibiliType === 'web' || res.data.config.bilibiliWebRiskAccepted) {
          setAdvancedUnlocked(true)
        }
      } else if (!res.success) {
        setError(res.error ?? 'load failed')
      }
    } catch (err) {
      logger.system.warn('[LiveSettings] load config failed:', err)
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const refreshStatus = useCallback(async () => {
    try {
      const res = await api.live.getStatus()
      if (res.success && res.data) setStatus(res.data)
    } catch (err) {
      logger.system.warn('[LiveSettings] load status failed:', err)
    }
  }, [])

  useEffect(() => {
    void loadConfig()
    void refreshStatus()
    const timer = setInterval(() => void refreshStatus(), 2000)
    return () => clearInterval(timer)
  }, [loadConfig, refreshStatus])

  // --------------------------------------------
  // 派生
  // --------------------------------------------
  const patchDraft = useCallback((patch: Partial<LiveConfig>) => {
    setDraft(prev => (prev ? { ...prev, ...patch } : prev))
  }, [])

  /** 网页模式风险未确认时禁止保存（主进程也会二次拦截） */
  const webRiskBlocked =
    !!draft && draft.bilibiliEnabled && draft.bilibiliType === 'web' && !draft.bilibiliWebRiskAccepted

  /**
   * 保存并应用。
   *
   * 只提交脏字段：避免把「用户没动过的凭证」重新写一遍盘。
   */
  const handleSave = useCallback(async () => {
    if (!draft || !saved) return
    if (webRiskBlocked) {
      setError(zh ? '请先勾选并确认网页模式的风险提示' : 'Please accept the web-mode risk notice first')
      return
    }

    setBusy(true)
    try {
      const patch: Record<string, unknown> = {}
      for (const key of Object.keys(draft) as Array<keyof LiveConfig>) {
        if (draft[key] !== saved[key]) patch[key] = draft[key]
      }

      const res = await api.live.updateConfig(patch as Partial<LiveConfig>)
      if (res.success && res.data) {
        setSaved(res.data.config)
        setDraft(res.data.config)
        setIssues(res.data.issues)
        setError(null)
      } else if (!res.success) {
        setError(res.error ?? 'save failed')
      }
      void refreshStatus()
    } catch (err) {
      logger.system.warn('[LiveSettings] save failed:', err)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [draft, saved, webRiskBlocked, zh, refreshStatus])

  /** 总开关：即时生效（这是唯一的全局闸门） */
  const handleToggleEnabled = useCallback(
    async (next: boolean) => {
      // 套餐能力拦截：开启前校验（直播互动为高级能力）
      if (next && !(await requireFeature('liveInteraction'))) return
      setBusy(true)
      try {
        const res = await api.live.setEnabled(next)
        if (res.success && res.data) {
          setSaved(res.data.config)
          setDraft(res.data.config)
          setIssues(res.data.issues)
          setError(null)
        } else if (!res.success) {
          setError(res.error ?? 'toggle failed')
        }
        void refreshStatus()
      } catch (err) {
        logger.system.warn('[LiveSettings] toggle failed:', err)
      } finally {
        setBusy(false)
      }
    },
    [refreshStatus],
  )

  const handleReload = useCallback(async () => {
    setBusy(true)
    try {
      const res = await api.live.reload()
      if (!res.success) setError(res.error ?? 'reload failed')
      void refreshStatus()
    } catch (err) {
      logger.system.warn('[LiveSettings] reload failed:', err)
    } finally {
      setBusy(false)
    }
  }, [refreshStatus])

  const handleStop = useCallback(async () => {
    setBusy(true)
    try {
      const res = await api.live.stop()
      if (!res.success) setError(res.error ?? 'stop failed')
      void refreshStatus()
    } catch (err) {
      logger.system.warn('[LiveSettings] stop failed:', err)
    } finally {
      setBusy(false)
    }
  }, [refreshStatus])

  /** 自测：合成一条事件走完整链路（总线 → 悬浮层 + 渲染层） */
  const handlePushTest = useCallback(async () => {
    const text = testText.trim() || (zh ? '测试弹幕：你好，AweeClaw！' : 'Test danmaku: hello!')
    try {
      await api.live.pushTest({ content: text, danmu_type: 'danmaku', platform: 'bilibili' })
      setTestText('')
    } catch (err) {
      logger.system.warn('[LiveSettings] push test failed:', err)
    }
  }, [testText, zh])

  // --------------------------------------------
  // 渲染
  // --------------------------------------------
  if (!draft || !saved) {
    return (
      <div className="p-4 text-sm text-text-muted">
        {zh ? '加载中…' : 'Loading…'}
        {error ? <div className="mt-2 text-xs text-red-400">{error}</div> : null}
      </div>
    )
  }

  const bilibiliStatus = status?.platforms.find(item => item.platform === 'bilibili')
  const youtubeStatus = status?.platforms.find(item => item.platform === 'youtube')
  const twitchStatus = status?.platforms.find(item => item.platform === 'twitch')

  return (
    <div className="space-y-4 p-1">
      {/* ============================================
       * 总开关 / 运行状态
       * ============================================ */}
      <Card>
        <ToggleRow
          label={zh ? '启用直播互动' : 'Enable live integration'}
          hint={
            zh
              ? '默认关闭。开启后才会连接下方已启用的平台'
              : 'Off by default. Enabled platforms connect only when this is on'
          }
          checked={draft.enabled}
          disabled={busy}
          onChange={next => void handleToggleEnabled(next)}
        />

        {status ? (
          <div className="space-y-1.5 border-t border-border/30 pt-2">
            {bilibiliStatus ? (
              <PlatformStatusRow status={bilibiliStatus} label="Bilibili" zh={zh} />
            ) : null}
            {youtubeStatus ? (
              <PlatformStatusRow status={youtubeStatus} label="YouTube" zh={zh} />
            ) : null}
            {twitchStatus ? <PlatformStatusRow status={twitchStatus} label="Twitch" zh={zh} /> : null}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
              <span>
                {zh ? '已投递' : 'Delivered'}：{status.totalEvents}
              </span>
              <span>
                {zh ? '去重命中' : 'Duplicates'}：{status.duplicatedEvents}
              </span>
              <span>
                {zh ? '洪水丢弃' : 'Dropped'}：{status.droppedEvents}
              </span>
            </div>
          </div>
        ) : null}

        <div className="flex items-center gap-2 border-t border-border/30 pt-2">
          <button
            type="button"
            onClick={() => void handleReload()}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg border border-border/50 px-3 py-1.5 text-xs text-text-primary hover:bg-surface disabled:opacity-40"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {zh ? '强制重连' : 'Reconnect'}
          </button>
          <button
            type="button"
            onClick={() => void handleStop()}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg border border-border/50 px-3 py-1.5 text-xs text-text-primary hover:bg-surface disabled:opacity-40"
          >
            <Square className="h-3.5 w-3.5" />
            {zh ? '停止全部' : 'Stop all'}
          </button>
        </div>
      </Card>

      {/* ============================================
       * B站
       * ============================================ */}
      <Card title={zh ? 'B站' : 'Bilibili'}>
        <ToggleRow
          label={zh ? '启用 B站' : 'Enable Bilibili'}
          hint={
            zh
              ? '开放平台是官方授权方式，推荐优先使用'
              : 'Open Live Platform is the officially authorised path'
          }
          checked={draft.bilibiliEnabled}
          onChange={next => patchDraft({ bilibiliEnabled: next })}
        />

        {draft.bilibiliEnabled ? (
          <>
            {draft.bilibiliType === 'open_live' ? (
              <>
                <SectionLabel>{zh ? '开放平台凭证' : 'Open platform credentials'}</SectionLabel>
                <Field
                  label="AccessKeyId"
                  value={draft.bilibiliAccessKeyId}
                  secret
                  revealed={!!revealed.bilibiliAccessKeyId}
                  onToggleReveal={() => toggleReveal('bilibiliAccessKeyId')}
                  onChange={next => patchDraft({ bilibiliAccessKeyId: next })}
                />
                <Field
                  label="AccessKeySecret"
                  value={draft.bilibiliAccessKeySecret}
                  secret
                  revealed={!!revealed.bilibiliAccessKeySecret}
                  onToggleReveal={() => toggleReveal('bilibiliAccessKeySecret')}
                  onChange={next => patchDraft({ bilibiliAccessKeySecret: next })}
                />
                <Field
                  label="AppId"
                  value={draft.bilibiliAppId}
                  hint={zh ? '开放平台项目 ID（数字）' : 'Numeric project id'}
                  onChange={next => patchDraft({ bilibiliAppId: next })}
                />
                <Field
                  label={zh ? '主播身份码' : 'Room owner auth code'}
                  value={draft.bilibiliRoomOwnerAuthCode}
                  secret
                  revealed={!!revealed.bilibiliRoomOwnerAuthCode}
                  onToggleReveal={() => toggleReveal('bilibiliRoomOwnerAuthCode')}
                  onChange={next => patchDraft({ bilibiliRoomOwnerAuthCode: next })}
                />
              </>
            ) : null}

            {/* ---------- 高级接入方式（网页模式，默认隐藏） ---------- */}
            {!advancedUnlocked ? (
              <div className="space-y-2 border-t border-border/30 pt-2">
                <button
                  type="button"
                  onClick={() => setAdvancedUnlocked(true)}
                  className="rounded-lg border border-border/50 px-3 py-1.5 text-xs text-text-muted hover:text-text-primary"
                >
                  {zh ? '解锁高级接入方式（网页模式）' : 'Unlock advanced mode (web)'}
                </button>
                <div className="text-xs text-text-muted leading-relaxed">
                  {zh
                    ? '网页模式使用非公开接口读取弹幕，可能违反平台服务条款，请自行评估风险后使用。'
                    : 'Web mode uses a non-public interface. Use at your own risk.'}
                </div>
              </div>
            ) : (
              <div className="space-y-3 border-t border-border/30 pt-2">
                <SectionLabel>{zh ? '接入方式' : 'Connection mode'}</SectionLabel>
                <div className="flex gap-2">
                  {(
                    [
                      { id: 'open_live' as const, label: zh ? '开放平台' : 'Open platform' },
                      { id: 'web' as const, label: zh ? '网页模式' : 'Web mode' },
                    ]
                  ).map(item => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => patchDraft({ bilibiliType: item.id })}
                      className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                        draft.bilibiliType === item.id
                          ? 'border-accent bg-accent/10 text-text-primary'
                          : 'border-border/50 text-text-muted hover:text-text-primary'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>

                {draft.bilibiliType === 'web' ? (
                  <div className="space-y-3 rounded-xl border border-amber-400/40 bg-amber-400/5 p-3">
                    <div className="flex items-start gap-2">
                      <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-400" />
                      <div className="text-xs text-amber-200/90 leading-relaxed">
                        {zh
                          ? '网页模式依赖非公开接口（需 SESSDATA），存在账号风控与服务条款风险。请确认你了解并自行承担该风险。'
                          : 'Web mode relies on a non-public interface and requires SESSDATA. Confirm you accept the risk.'}
                      </div>
                    </div>
                    <ToggleRow
                      label={zh ? '我已确认并承担风险' : 'I accept the risk'}
                      checked={draft.bilibiliWebRiskAccepted}
                      onChange={next => patchDraft({ bilibiliWebRiskAccepted: next })}
                    />
                    <Field
                      label={zh ? '直播间号' : 'Room id'}
                      value={draft.bilibiliRoomId}
                      placeholder="21521874"
                      disabled={!draft.bilibiliWebRiskAccepted}
                      onChange={next => patchDraft({ bilibiliRoomId: next })}
                    />
                    <Field
                      label="SESSDATA"
                      value={draft.bilibiliSessdata}
                      secret
                      revealed={!!revealed.bilibiliSessdata}
                      onToggleReveal={() => toggleReveal('bilibiliSessdata')}
                      disabled={!draft.bilibiliWebRiskAccepted}
                      hint={zh ? '浏览器 Cookie 中的 SESSDATA 值' : 'SESSDATA cookie value'}
                      onChange={next => patchDraft({ bilibiliSessdata: next })}
                    />
                  </div>
                ) : null}
              </div>
            )}
          </>
        ) : null}
      </Card>

      {/* ============================================
       * YouTube
       * ============================================ */}
      <Card title="YouTube">
        <ToggleRow
          label={zh ? '启用 YouTube' : 'Enable YouTube'}
          hint={
            zh
              ? '走官方 Data API v3 轮询，无合规风险；注意每日配额 10000'
              : 'Official Data API v3 polling; 10k daily quota'
          }
          checked={draft.youtubeEnabled}
          onChange={next => patchDraft({ youtubeEnabled: next })}
        />

        {draft.youtubeEnabled ? (
          <>
            <Field
              label={zh ? '视频 ID' : 'Video id'}
              value={draft.youtubeVideoId}
              placeholder="dQw4w9WgXcQ"
              hint={zh ? '直播对应的 video id（不是频道 id）' : 'Video id of the live stream'}
              onChange={next => patchDraft({ youtubeVideoId: next })}
            />
            <Field
              label="API Key"
              value={draft.youtubeApiKey}
              secret
              revealed={!!revealed.youtubeApiKey}
              onToggleReveal={() => toggleReveal('youtubeApiKey')}
              onChange={next => patchDraft({ youtubeApiKey: next })}
            />
          </>
        ) : null}
      </Card>

      {/* ============================================
       * Twitch
       * ============================================ */}
      <Card title="Twitch">
        <ToggleRow
          label={zh ? '启用 Twitch' : 'Enable Twitch'}
          hint={
            zh
              ? 'IRC 只读弹幕无需 Token；留空即可匿名连接'
              : 'Read-only IRC works anonymously; a token is optional'
          }
          checked={draft.twitchEnabled}
          onChange={next => patchDraft({ twitchEnabled: next })}
        />

        {draft.twitchEnabled ? (
          <>
            <Field
              label={zh ? '频道名' : 'Channel'}
              value={draft.twitchChannel}
              placeholder="forsen"
              onChange={next => patchDraft({ twitchChannel: next })}
            />
            <Field
              label={zh ? '登录名' : 'Login name'}
              value={draft.twitchUsername}
              placeholder={zh ? '留空则匿名只读' : 'Leave empty for anonymous'}
              onChange={next => patchDraft({ twitchUsername: next })}
            />
            <Field
              label={zh ? 'OAuth Token' : 'OAuth token'}
              value={draft.twitchAccessToken}
              secret
              revealed={!!revealed.twitchAccessToken}
              onToggleReveal={() => toggleReveal('twitchAccessToken')}
              hint={
                zh
                  ? '填写 Token 时必须同时填写登录名（NICK 需与 Token 归属一致）'
                  : 'If a token is set, the login name must match it'
              }
              onChange={next => patchDraft({ twitchAccessToken: next })}
            />
          </>
        ) : null}
      </Card>

      {/* ============================================
       * 自测 + 最近事件
       * ============================================ */}
      <Card title={zh ? '链路自测' : 'Pipeline self-test'}>
        <div className="flex items-center gap-2">
          <input
            value={testText}
            placeholder={zh ? '输入一条测试弹幕…' : 'Type a test danmaku…'}
            onChange={e => setTestText(e.target.value)}
            className="flex-1 min-w-0 rounded-lg border border-border/50 bg-background/60 px-3 py-1.5 text-xs text-text-primary"
          />
          <button
            type="button"
            onClick={() => void handlePushTest()}
            className="flex items-center gap-1.5 rounded-lg border border-border/50 px-3 py-1.5 text-xs text-text-primary hover:bg-surface"
          >
            <Send className="h-3.5 w-3.5" />
            {zh ? '推送' : 'Push'}
          </button>
        </div>
        <div className="text-xs text-text-muted leading-relaxed">
          {zh
            ? '自测事件会经统一总线投递到字幕/弹幕悬浮层与主窗口，用来验证下游链路（不依赖任何平台连接）。'
            : 'The test event goes through the unified bus to the overlay and main window.'}
        </div>

        {status && status.recentEvents.length > 0 ? (
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-xl border border-border/30 bg-background/40 p-2">
            {status.recentEvents.map(event => (
              <div key={event.id} className="flex items-start gap-2 text-xs">
                <span className="flex-shrink-0 text-text-muted">{event.platform}</span>
                <span className="flex-shrink-0 text-text-muted">[{event.danmu_type}]</span>
                <span className="min-w-0 break-all text-text-primary">{event.content}</span>
              </div>
            ))}
          </div>
        ) : null}
      </Card>

      {/* ============================================
       * 保存
       * ============================================ */}
      <div className="sticky bottom-0 space-y-2 rounded-2xl border border-border/40 bg-surface/90 p-3 backdrop-blur">
        {issues.length > 0 ? (
          <ul className="space-y-0.5 text-xs text-amber-400/90">
            {issues.map(issue => (
              <li key={issue}>· {issue}</li>
            ))}
          </ul>
        ) : null}

        {webRiskBlocked ? (
          <div className="text-xs text-red-400">
            {zh
              ? '网页模式需要先勾选风险确认，否则无法保存。'
              : 'Web mode requires accepting the risk notice before saving.'}
          </div>
        ) : null}

        {error ? <div className="text-xs text-red-400">{error}</div> : null}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setDraft(saved)}
            disabled={!dirty || busy}
            className="rounded-lg border border-border/50 px-3 py-1.5 text-xs text-text-primary hover:bg-surface disabled:opacity-40"
          >
            {zh ? '撤销修改' : 'Revert'}
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!dirty || busy || webRiskBlocked}
            className="rounded-lg border border-accent/60 bg-accent/10 px-3 py-1.5 text-xs text-text-primary hover:bg-accent/20 disabled:opacity-40"
          >
            {busy ? (zh ? '处理中…' : 'Working…') : zh ? '保存并应用' : 'Save & apply'}
          </button>
          {dirty ? (
            <span className="text-xs text-text-muted">
              {zh ? '有未保存的修改' : 'Unsaved changes'}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export default LiveSettings