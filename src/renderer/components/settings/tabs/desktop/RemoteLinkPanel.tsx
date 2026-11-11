/**
 * 远程联动权限面板
 *
 * 移动端能对这台电脑做什么，由这里的开关决定。配置落在主进程的 deviceLink
 * 存储里，与移动端来申请时弹出的确认框共用同一份数据，因此两边永远一致。
 *
 * 三个显示细节是有意为之：
 * - 展示的是「生效值」而非配置原值：10 分钟临时授权期间开关也显示为开启。
 *   若只显示原值，用户会以为没授权成功，再点一次反而把配置覆盖掉。
 * - 临时授权带倒计时：剩余多少时间直接看得到，不必去猜何时失效。
 * - 临时授权可单独撤销：收回限时放行不该连带关掉「始终允许」。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link2, Link2Off, Loader2, ShieldAlert } from 'lucide-react'
import { api } from '@renderer/adapters/electronBridge'
import { useI18n } from '@renderer/i18n'

type Scope = 'shell' | 'screenshot' | 'clipboard' | 'power' | 'input'
type PrefKey =
  | 'allowRemoteCommand'
  | 'allowClipboardPush'
  | 'allowScreenshot'
  | 'allowPowerControl'
  | 'allowRemoteInput'

type Snapshot = Awaited<ReturnType<typeof api.deviceLink.getPreferences>>
type LinkStatus = Awaited<ReturnType<typeof api.deviceLink.getStatus>>

/**
 * 开关行定义
 *
 * 顺序按权限强弱排列：远程鼠标键盘能直接操作这台机器，放在最前；
 * shell 命令次之；其余为只读或影响有限的类别。
 * tKey 是文案后缀，与 scope 并非一一对应（shell ↔ command）。
 */
const ROWS: Array<{ scope: Scope; key: PrefKey; tKey: string }> = [
  { scope: 'input', key: 'allowRemoteInput', tKey: 'input' },
  { scope: 'shell', key: 'allowRemoteCommand', tKey: 'command' },
  { scope: 'screenshot', key: 'allowScreenshot', tKey: 'screenshot' },
  { scope: 'clipboard', key: 'allowClipboardPush', tKey: 'clipboard' },
  { scope: 'power', key: 'allowPowerControl', tKey: 'power' },
]

/** 毫秒 → m:ss */
function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border/40 bg-surface/70 p-4 space-y-3">
      {title ? <div className="text-sm font-medium text-text-primary">{title}</div> : null}
      {children}
    </section>
  )
}

function Switch({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean
  disabled?: boolean
  onChange: (next: boolean) => void
}) {
  return (
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
  )
}

export function RemoteLinkPanel() {
  const { t } = useI18n()

  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [status, setStatus] = useState<LinkStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyKey, setBusyKey] = useState<PrefKey | null>(null)
  const [revokingScope, setRevokingScope] = useState<Scope | null>(null)
  const [error, setError] = useState('')

  /** 快照取回的时刻，倒计时以它为基准 */
  const fetchedAtRef = useRef(0)
  const [nowTick, setNowTick] = useState(() => Date.now())

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [snap, st] = await Promise.all([
        api.deviceLink.getPreferences(),
        api.deviceLink.getStatus(),
      ])
      fetchedAtRef.current = Date.now()
      setNowTick(fetchedAtRef.current)
      setSnapshot(snap)
      setStatus(st)
      setError('')
    } catch (err) {
      console.error('[RemoteLinkPanel] Failed to load:', err)
      setError(t('desktop.remoteLink.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  /** 某范围的剩余临时授权（已按流逝时间扣减） */
  const remainingOf = useCallback(
    (scope: Scope): number => {
      const base = snapshot?.tempRemaining?.[scope] ?? 0
      if (base <= 0) return 0
      return Math.max(0, base - (nowTick - fetchedAtRef.current))
    },
    [snapshot, nowTick],
  )

  const hasTemp = useMemo(
    () => (snapshot ? (Object.keys(snapshot.tempRemaining) as Scope[]).some((s) => remainingOf(s) > 0) : false),
    [snapshot, remainingOf],
  )

  // 只在确实有临时授权时走秒级刷新，避免无谓的定时器空转
  useEffect(() => {
    if (!hasTemp) return
    const timer = window.setInterval(() => setNowTick(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [hasTemp])

  const toggle = useCallback(
    async (key: PrefKey, next: boolean) => {
      setBusyKey(key)
      try {
        const result = await api.deviceLink.setPreferences({ [key]: next })
        if (!result.ok) throw new Error('save_failed')
        await load()
      } catch (err) {
        console.error('[RemoteLinkPanel] Failed to save:', err)
        setError(t('desktop.remoteLink.saveFailed'))
      } finally {
        setBusyKey(null)
      }
    },
    [load, t],
  )

  const revokeTemp = useCallback(
    async (scope: Scope) => {
      setRevokingScope(scope)
      try {
        await api.deviceLink.clearTempGrant(scope)
        await load()
      } catch (err) {
        console.error('[RemoteLinkPanel] Failed to revoke temp grant:', err)
        setError(t('desktop.remoteLink.saveFailed'))
      } finally {
        setRevokingScope(null)
      }
    },
    [load, t],
  )

  if (loading && !snapshot) {
    return (
      <div className="flex items-center gap-2 text-sm text-text-muted">
        <Loader2 className="w-4 h-4 animate-spin" />
        {t('common.loading')}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* 连接状态 */}
      <div className="flex items-center gap-3 rounded-xl border border-border/40 bg-surface/50 px-4 py-3">
        <div
          className={`p-1.5 rounded-lg ${status?.connected ? 'bg-emerald-500/10' : 'bg-surface-active/40'}`}
        >
          {status?.connected ? (
            <Link2 className="w-4 h-4 text-emerald-400" />
          ) : (
            <Link2Off className="w-4 h-4 text-text-muted" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-text-primary">
            {status?.connected
              ? t('desktop.remoteLink.status.connected')
              : t('desktop.remoteLink.status.disconnected')}
          </div>
          {status?.deviceId ? (
            <div className="mt-0.5 text-xs text-text-muted font-mono truncate">
              {t('desktop.remoteLink.deviceId')}: {status.deviceId}
            </div>
          ) : null}
        </div>
      </div>

      {/* 开关 */}
      <Card title={t('desktop.remoteLink.title')}>
        <p className="text-xs text-text-muted leading-relaxed">{t('desktop.remoteLink.desc')}</p>

        <div className="space-y-4 pt-1">
          {ROWS.map((row) => {
            const checked = snapshot?.preferences?.[row.key] ?? false
            const remaining = remainingOf(row.scope)
            return (
              <div key={row.key} className="space-y-1.5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-text-primary">
                      {t(`desktop.remoteLink.${row.tKey}.label`)}
                    </div>
                    <div className="mt-0.5 text-xs text-text-muted">
                      {t(`desktop.remoteLink.${row.tKey}.hint`)}
                    </div>
                  </div>
                  <Switch
                    checked={checked}
                    disabled={busyKey === row.key}
                    onChange={(next) => void toggle(row.key, next)}
                  />
                </div>

                {remaining > 0 ? (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-500 border border-amber-500/30 font-medium">
                      {t('desktop.remoteLink.tempRemaining', { time: formatRemaining(remaining) })}
                    </span>
                    <button
                      type="button"
                      disabled={revokingScope === row.scope}
                      onClick={() => void revokeTemp(row.scope)}
                      className="text-text-secondary hover:text-text-primary underline underline-offset-2 disabled:opacity-50"
                    >
                      {t('desktop.remoteLink.revokeTemp')}
                    </button>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>

        <p className="text-xs text-text-muted pt-1 border-t border-border/30">
          {t('desktop.remoteLink.footer')}
        </p>
      </Card>

      {error ? (
        <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
          <ShieldAlert className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
          <span className="text-xs text-red-400">{error}</span>
        </div>
      ) : null}
    </div>
  )
}

export default RemoteLinkPanel
