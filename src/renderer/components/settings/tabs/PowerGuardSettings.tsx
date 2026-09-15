/**
 * PowerGuardSettings — 防休眠设置面板
 *
 * 设计要点：
 * 1. **默认开启但无害**：模块默认 enabled=true（P1 唯一例外），因为它的价值只在
 *    「长任务被执行到一半时系统睡过去」这种场景体现，默认关掉等于没人会用。
 *    安全边界靠「默认强度只阻止系统空闲休眠」+「只在真有任务持有时才 spawn 进程」保证。
 * 2. **强度是显式三档**：off / 空闲 / 全量。用户需要理解「让屏幕常亮」是额外代价，
 *    而不是被一个笼统的「防止休眠」开关蒙在鼓里。
 * 3. **状态优先展示「是否真的生效」**：这个功能最糟的失败模式不是报错，而是
 *    「UI 说已开启但实际没生效」。因此面板同时显示 生效状态 / 平台机制 / 守护进程 pid /
 *    最近错误，并在平台不支持时给出明确原因。
 * 4. **持有者列表可见**：让用户能看到「是谁在占着防休眠」，配合「立即全部释放」
 *    按钮，把「应用空闲但电脑不休眠」这类问题变成可自助排查的。
 * 5. **平台差异如实说明**：Linux 下 systemd-inhibit 无法阻止显示器关闭，
 *    不能假装做到了。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Coffee, Loader2, Power, RefreshCw, Zap } from 'lucide-react'
import type { Language } from '@renderer/i18n'
import { api } from '@renderer/adapters/electronBridge'
import { logger } from '@shared/toolkit/LogEngine'
import type { PowerGuardConfig, PowerGuardStatus } from '@renderer/types/electronBridge'

interface PowerGuardSettingsProps {
  language: Language
}

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

function ActionButton({
  label,
  icon,
  onClick,
  busy,
  disabled,
  tone = 'default',
}: {
  label: string
  icon?: React.ReactNode
  onClick: () => void
  busy?: boolean
  disabled?: boolean
  tone?: 'default' | 'warn'
}) {
  const toneClass =
    tone === 'warn'
      ? 'border-amber-500/40 text-amber-500 hover:bg-amber-500/10'
      : 'border-border/60 text-text-secondary hover:bg-surface-hover'

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${toneClass}`}
    >
      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : icon}
      {label}
    </button>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-xs font-semibold text-text-muted uppercase tracking-wide">{children}</div>
}

/** 强度档位按钮 */
function ModeOption({
  active,
  title,
  hint,
  onClick,
}: {
  active: boolean
  title: string
  hint: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-lg border px-3 py-2 text-left transition-colors ${
        active
          ? 'border-accent/60 bg-accent/10'
          : 'border-border/50 hover:bg-surface-hover'
      }`}
    >
      <div className="text-xs font-medium text-text-primary">{title}</div>
      <div className="mt-0.5 text-[11px] leading-snug text-text-muted">{hint}</div>
    </button>
  )
}

// ============================================
// 文案
// ============================================

/** 平台机制的人类可读名 */
const SOURCE_LABEL: Record<string, { zh: string; en: string }> = {
  caffeinate: { zh: 'macOS caffeinate', en: 'macOS caffeinate' },
  'systemd-inhibit': { zh: 'systemd-inhibit', en: 'systemd-inhibit' },
  powershell: { zh: 'Windows 执行状态 API', en: 'Windows execution state API' },
  none: { zh: '未生效', en: 'Inactive' },
}

function formatDuration(ms: number, zh: boolean): string {
  if (ms <= 0) return zh ? '立即' : 'immediately'
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  return `${Math.round(ms / 60_000)}min`
}

// ============================================
// 主组件
// ============================================

export function PowerGuardSettings({ language }: PowerGuardSettingsProps) {
  const zh = language === 'zh'
  const tt = useCallback((a: string, b: string) => (zh ? a : b), [zh])

  const [config, setConfig] = useState<PowerGuardConfig | null>(null)
  const [status, setStatus] = useState<PowerGuardStatus | null>(null)
  const [issues, setIssues] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  /** 去抖时长的输入草稿（秒），失焦 / 回车时提交 */
  const [minDurationDraft, setMinDurationDraft] = useState('')

  // --------------------------------------------
  // 加载 + 订阅
  // --------------------------------------------
  const applyPayload = useCallback(
    (payload: { config: PowerGuardConfig; status: PowerGuardStatus; issues: string[] }) => {
      setConfig(payload.config)
      setStatus(payload.status)
      setIssues(payload.issues)
      setMinDurationDraft(String(Math.round(payload.config.minDurationMs / 1000)))
    },
    [],
  )

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const res = await api.powerGuard.getConfig()
        if (cancelled) return
        if (res.success && res.data) {
          applyPayload(res.data)
        } else if (res.error) {
          logger.system.warn('[PowerGuardSettings] 读取配置失败：', res.error)
        }
      } catch (err) {
        logger.system.warn('[PowerGuardSettings] 读取配置异常：', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()

    // 主进程会在生效 / 释放 / 失败时推状态；这里只更新状态，不动配置草稿
    const off = api.powerGuard.onStatus(next => {
      if (cancelled) return
      setStatus(next)
    })

    return () => {
      cancelled = true
      off()
    }
  }, [applyPayload])

  // --------------------------------------------
  // 保存
  // --------------------------------------------
  const patch = useCallback(
    async (partial: Partial<PowerGuardConfig>) => {
      setBusy(true)
      try {
        const res = await api.powerGuard.updateConfig(partial)
        if (res.success && res.data) {
          applyPayload(res.data)
        } else {
          logger.system.warn('[PowerGuardSettings] 保存失败：', res.error)
        }
      } catch (err) {
        logger.system.warn('[PowerGuardSettings] 保存异常：', err)
      } finally {
        setBusy(false)
      }
    },
    [applyPayload],
  )

  const handleRefreshStatus = useCallback(async () => {
    try {
      const res = await api.powerGuard.getStatus()
      if (res.success && res.data) setStatus(res.data)
    } catch (err) {
      logger.system.warn('[PowerGuardSettings] 刷新状态异常：', err)
    }
  }, [])

  const handleReleaseAll = useCallback(async () => {
    setBusy(true)
    try {
      const res = await api.powerGuard.releaseAll()
      if (res.success && res.data) setStatus(res.data)
    } catch (err) {
      logger.system.warn('[PowerGuardSettings] 释放全部持有异常：', err)
    } finally {
      setBusy(false)
    }
  }, [])

  /**
   * 提交去抖时长。
   *
   * 输入框走草稿而不是逐字符提交：一次输入 `15` 会产生 `1` 和 `15` 两次提交，
   * 每次提交都会重算定时器，中间态（1 秒）会让本不该生效的持有者立刻生效。
   */
  const commitMinDuration = useCallback(() => {
    if (!config) return
    const seconds = Number(minDurationDraft)
    if (!Number.isFinite(seconds) || seconds < 0) {
      setMinDurationDraft(String(Math.round(config.minDurationMs / 1000)))
      return
    }
    const next = Math.round(seconds * 1000)
    if (next === config.minDurationMs) return
    void patch({ minDurationMs: next })
  }, [config, minDurationDraft, patch])

  // --------------------------------------------
  // 渲染
  // --------------------------------------------
  const activeHolders = useMemo(
    () => (status?.holders ?? []).filter(h => h.effective),
    [status],
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-4 h-4 animate-spin text-text-muted" />
      </div>
    )
  }

  if (!config || !status) {
    return (
      <div className="text-xs text-text-muted py-4">
        {tt('无法读取防休眠配置，请重启应用后重试。', 'Unable to read power guard config. Restart the app.')}
      </div>
    )
  }

  const sourceLabel = SOURCE_LABEL[status.source] ?? SOURCE_LABEL.none
  const platformHint =
    status.platform === 'linux'
      ? tt(
          'Linux 的 systemd 抑制剂不含「显示器」分类，因此「阻止屏幕关闭」在该平台无法生效（仅阻止系统睡眠）。',
          'systemd inhibitors have no "display" category, so "keep the screen on" cannot work on Linux (system sleep is still blocked).',
        )
      : ''

  return (
    <div className="space-y-4">
      {/* ============ 运行状态 ============ */}
      <Card title={tt('运行状态', 'Status')}>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex h-2 w-2 rounded-full ${
              status.active ? 'bg-emerald-500' : 'bg-text-muted/50'
            }`}
          />
          <span className="text-sm text-text-primary">
            {status.active
              ? tt(
                  `生效中（${status.activeMode === 'system' ? '阻止睡眠 + 屏幕常亮' : '阻止系统空闲睡眠'}）`,
                  `Active (${status.activeMode === 'system' ? 'sleep + display blocked' : 'idle sleep blocked'})`,
                )
              : tt('未生效', 'Inactive')}
          </span>
          <div className="ml-auto">
            <ActionButton
              label={tt('刷新', 'Refresh')}
              icon={<RefreshCw className="w-3.5 h-3.5" />}
              onClick={() => void handleRefreshStatus()}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
          <div className="text-text-muted">{tt('平台机制', 'Mechanism')}</div>
          <div className="text-text-secondary">
            {status.supported ? tt(sourceLabel.zh, sourceLabel.en) : tt('本平台不支持', 'Unsupported')}
          </div>

          <div className="text-text-muted">{tt('守护进程', 'Guard process')}</div>
          <div className="text-text-secondary">
            {status.guardPid ? `pid ${status.guardPid}` : '—'}
          </div>

          <div className="text-text-muted">{tt('启动 / 释放次数', 'Start / stop count')}</div>
          <div className="text-text-secondary">
            {status.startCount} / {status.stopCount}
          </div>

          <div className="text-text-muted">{tt('生效时长', 'Active since')}</div>
          <div className="text-text-secondary">
            {status.startedAt ? new Date(status.startedAt).toLocaleTimeString() : '—'}
          </div>
        </div>

        {/* 持有者 */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <SectionLabel>{tt('防休眠持有者', 'Holders')}</SectionLabel>
            {activeHolders.length > 0 ? (
              <ActionButton
                label={tt('全部释放', 'Release all')}
                tone="warn"
                busy={busy}
                onClick={() => void handleReleaseAll()}
              />
            ) : null}
          </div>

          {activeHolders.length === 0 ? (
            <div className="text-xs text-text-muted">
              {tt('当前没有任何任务在阻止休眠。', 'Nothing is currently holding the guard.')}
            </div>
          ) : (
            <ul className="space-y-1">
              {activeHolders.map(h => (
                <li key={h.reason} className="flex items-center justify-between text-xs">
                  <span className="text-text-secondary">
                    {h.reason === 'agent-task'
                      ? tt('Agent 长任务', 'Agent task')
                      : h.reason === 'manual'
                        ? tt('手动保持唤醒', 'Manual hold')
                        : h.reason}
                  </span>
                  <span className="text-text-muted">
                    ×{h.count} · {new Date(h.since).toLocaleTimeString()}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {activeHolders.length === 0 && (config.manualHold || config.autoTriggerAgentTask) ? (
            <div className="text-[11px] text-text-muted">
              {tt(
                `自动触发需要任务持续超过 ${formatDuration(config.minDurationMs, true)}，短的命令不会启动守护进程。`,
                `Auto-trigger needs a task longer than ${formatDuration(config.minDurationMs, false)}; short commands never spawn a guard.`,
              )}
            </div>
          ) : null}
        </div>

        {/* 错误 / 不支持 */}
        {status.lastError ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-amber-500" />
            <div className="text-xs text-text-secondary">{status.lastError}</div>
          </div>
        ) : null}
      </Card>

      {/* ============ 强度 ============ */}
      <Card title={tt('防休眠强度', 'Level')}>
        <div className="flex gap-2">
          <ModeOption
            active={config.mode === 'off'}
            title={tt('关闭', 'Off')}
            hint={tt('不阻止任何睡眠', 'No sleep prevention')}
            onClick={() => void patch({ mode: 'off' })}
          />
          <ModeOption
            active={config.mode === 'idle'}
            title={tt('空闲防休眠', 'Idle')}
            hint={tt('阻止系统睡眠，允许屏幕关闭', 'Block system sleep, allow display off')}
            onClick={() => void patch({ mode: 'idle' })}
          />
          <ModeOption
            active={config.mode === 'system'}
            title={tt('系统 + 屏幕', 'System + display')}
            hint={tt('同时阻止屏幕关闭（更耗电）', 'Also keep the display on (more power)')}
            onClick={() => void patch({ mode: 'system' })}
          />
        </div>

        {platformHint ? (
          <div className="text-[11px] text-text-muted">{platformHint}</div>
        ) : null}
      </Card>

      {/* ============ 触发规则 ============ */}
      <Card title={tt('触发规则', 'Triggers')}>
        <ToggleRow
          label={tt('启用防休眠', 'Enable power guard')}
          hint={tt(
            '关闭后不阻止任何睡眠，但仍然保留下面的触发规则',
            'When off, nothing is blocked but the rules below are kept',
          )}
          checked={config.enabled}
          onChange={next => void patch({ enabled: next })}
        />

        <ToggleRow
          label={tt('Agent 长任务自动触发', 'Auto during agent tasks')}
          hint={tt(
            'AI 执行多步任务期间自动阻止休眠，任务结束后立即恢复',
            'Prevent sleep while the AI runs a multi-step task, released as soon as it ends',
          )}
          checked={config.autoTriggerAgentTask}
          disabled={!config.enabled}
          onChange={next => void patch({ autoTriggerAgentTask: next })}
        />

        <ToggleRow
          label={tt('手动保持唤醒', 'Manual hold')}
          hint={tt(
            '不依赖任务，一直生效直到你手动关闭（跨重启保留）',
            'Independent of tasks; stays on until you turn it off (persists across restarts)',
          )}
          checked={config.manualHold}
          disabled={!config.enabled}
          onChange={next => void patch({ manualHold: next })}
        />

        {/* 去抖时长 */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm font-medium text-text-primary">
              {tt('最短生效时长', 'Minimum duration')}
            </div>
            <div className="mt-0.5 text-xs text-text-muted">
              {tt(
                '任务短于该时长不会启动守护进程，避免频繁起停（0 表示立即生效）',
                'Tasks shorter than this never spawn a guard process (0 = immediate)',
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <input
              type="number"
              min={0}
              max={300}
              value={minDurationDraft}
              disabled={!config.enabled}
              onChange={e => setMinDurationDraft(e.target.value)}
              onBlur={commitMinDuration}
              onKeyDown={e => {
                if (e.key === 'Enter') e.currentTarget.blur()
              }}
              className="w-20 rounded-lg border border-border/60 bg-surface px-2 py-1 text-right text-xs text-text-primary outline-none focus:border-accent/60 disabled:opacity-50"
            />
            <span className="text-xs text-text-muted">{tt('秒', 'sec')}</span>
          </div>
        </div>

        {issues.length > 0 ? (
          <div className="space-y-1">
            {issues.map(issue => (
              <div key={issue} className="text-[11px] text-amber-500">
                · {issue}
              </div>
            ))}
          </div>
        ) : null}
      </Card>

      {/* ============ 说明 ============ */}
      <Card>
        <div className="flex items-start gap-2">
          <Coffee className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-accent" />
          <div className="space-y-1.5 text-xs text-text-secondary">
            <p>
              {tt(
                '防休眠通过一个常驻子进程持有系统级的「保持唤醒」断言，应用退出或任务结束会立即释放。',
                'The guard is held by a persistent child process holding a system-level wake assertion, released when the task ends or the app exits.',
              )}
            </p>
            <p>
              {tt(
                '检测到上次异常退出留下的残留守护进程时，启动会自动清理，避免出现「应用已关闭但系统仍无法休眠」。',
                'Leftover guard processes from a previous crash are cleaned up automatically on startup, so the system never stays awake after the app is gone.',
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 pt-1 text-[11px] text-text-muted">
          <Power className="w-3 h-3" />
          {tt('当前平台：', 'Platform: ')}
          {status.platform}
          <Zap className="w-3 h-3 ml-2" />
          {status.enabled ? tt('模块已启用', 'enabled') : tt('模块已禁用', 'disabled')}
        </div>
      </Card>
    </div>
  )
}
