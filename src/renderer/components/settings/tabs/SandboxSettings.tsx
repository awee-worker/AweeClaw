/**
 * SandboxSettings — 代码沙箱设置面板
 *
 * 设计要点：
 * 1. **默认关闭且必须显式选择**：沙箱会改变命令的执行环境（cwd / env / 文件可见性），
 *    默认开启会让既有工作流静默失败（例如依赖 `~/.npmrc`、PATH 里的本地工具链）。
 *    面板第一屏就把「关闭 = 与改造前完全一致」讲清楚。
 * 2. **能力矩阵如实展示**：`local` 不阻断网络、不隐藏文件系统 —— 这是 Node 在裸进程层面
 *    做不到的事，不是没实现。用户必须知道「开了 local 不等于安全了」。
 * 3. **探测结果优先于配置**：功能最糟的失败模式是「UI 说已开启但实际降级到 local 了」。
 *    因此面板同时显示：策略 / 实际生效后端 / 各后端可用性 / 最近降级链 / 最近错误。
 * 4. **降级必须可见**：降级链在每次执行后都会更新，前面板直接列出
 *    「docker → local：xxx」，而不是只留一个总开关的状态。
 * 5. **数据出境提示**：E2B 是云沙箱，命令与工作目录会上传。选了就必须看到红字。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Box, Cloud, Loader2, RefreshCw, ShieldCheck, Square, Terminal } from 'lucide-react'
import type { Language } from '@renderer/i18n'
import { api } from '@renderer/adapters/electronBridge'
import { logger } from '@shared/toolkit/LogEngine'
import type { SandboxConfig, SandboxProbe, SandboxStatus } from '@renderer/types/electronBridge'

interface SandboxSettingsProps {
  language: Language
}

// ============================================
// 通用 UI 原子（与 PowerGuardSettings / VtsSettings 保持一致）
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
}: {
  label: string
  icon?: React.ReactNode
  onClick: () => void
  busy?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-2.5 py-1.5 text-xs text-text-secondary transition-colors hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : icon}
      {label}
    </button>
  )
}

function NumberField({
  label,
  hint,
  value,
  min,
  max,
  step,
  suffix,
  disabled,
  onCommit,
}: {
  label: string
  hint?: string
  value: number
  min: number
  max: number
  step?: number
  suffix?: string
  disabled?: boolean
  onCommit: (next: number) => void
}) {
  const [draft, setDraft] = useState(String(value))

  useEffect(() => {
    setDraft(String(value))
  }, [value])

  const commit = () => {
    const parsed = Number(draft)
    if (!Number.isFinite(parsed)) {
      setDraft(String(value))
      return
    }
    const clamped = Math.max(min, Math.min(max, Math.round(parsed)))
    setDraft(String(clamped))
    if (clamped !== value) onCommit(clamped)
  }

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="text-xs text-text-secondary">{label}</div>
        {hint ? <div className="mt-0.5 text-[11px] text-text-muted">{hint}</div> : null}
      </div>
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          value={draft}
          min={min}
          max={max}
          step={step ?? 1}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
          }}
          className="w-24 rounded-lg border border-border/60 bg-surface px-2 py-1 text-right text-xs text-text-primary disabled:opacity-50"
        />
        {suffix ? <span className="text-[11px] text-text-muted">{suffix}</span> : null}
      </div>
    </div>
  )
}

/** 后端可用性徽标 */
function ProbeBadge({ probe }: { probe: SandboxProbe }) {
  const label =
    probe.kind === 'local' ? 'local' : probe.kind === 'docker' ? 'docker' : 'e2b'
  return (
    <div className="flex items-start gap-2 rounded-lg border border-border/40 bg-surface/60 px-2.5 py-2">
      <span
        className={`mt-0.5 inline-block h-2 w-2 flex-shrink-0 rounded-full ${
          probe.available ? 'bg-emerald-500' : 'bg-amber-500'
        }`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-text-primary">{label}</span>
          <span className="text-[11px] text-text-muted">
            {probe.available ? '可用' : '不可用'}
          </span>
        </div>
        <div className="mt-0.5 break-words text-[11px] text-text-muted">
          {probe.available ? probe.detail : probe.reason}
        </div>
        {probe.available ? (
          <div className="mt-1 flex flex-wrap gap-1.5 text-[10px] text-text-muted">
            <span className={probe.capabilities.networkIsolation ? 'text-emerald-500' : 'text-amber-500'}>
              {probe.capabilities.networkIsolation ? '✓ 网络隔离' : '✗ 网络隔离'}
            </span>
            <span className={probe.capabilities.filesystemIsolation ? 'text-emerald-500' : 'text-amber-500'}>
              {probe.capabilities.filesystemIsolation ? '✓ 文件隔离' : '✗ 文件隔离'}
            </span>
            <span className={probe.capabilities.resourceLimits ? 'text-emerald-500' : 'text-amber-500'}>
              {probe.capabilities.resourceLimits ? '✓ 资源限额' : '✗ 资源限额'}
            </span>
            {probe.capabilities.cloud ? <span className="text-rose-500">· 云端</span> : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** 策略选项 */
function PolicyOption({
  icon,
  title,
  desc,
  active,
  disabled,
  onClick,
}: {
  icon: React.ReactNode
  title: string
  desc: string
  active: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-full rounded-xl border p-3 text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
        active ? 'border-accent bg-accent/10' : 'border-border/50 hover:bg-surface-hover'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={active ? 'text-accent' : 'text-text-muted'}>{icon}</span>
        <span className="text-sm font-medium text-text-primary">{title}</span>
      </div>
      <div className="mt-1 text-xs text-text-muted">{desc}</div>
    </button>
  )
}

// ============================================
// 主组件
// ============================================

export function SandboxSettings({ language }: SandboxSettingsProps) {
  const zh = language === 'zh'

  const [config, setConfig] = useState<SandboxConfig | null>(null)
  const [status, setStatus] = useState<SandboxStatus | null>(null)
  const [issues, setIssues] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [probing, setProbing] = useState(false)

  const applyPayload = useCallback(
    (payload: { config: SandboxConfig; status: SandboxStatus; issues: string[] }) => {
      setConfig(payload.config)
      setStatus(payload.status)
      setIssues(payload.issues)
    },
    [],
  )

  const load = useCallback(async () => {
    try {
      const res = await api.sandbox.getConfig()
      if (res?.success && res.data) {
        applyPayload(res.data)
      } else {
        logger.system.warn('[SandboxSettings] getConfig failed:', res?.error)
      }
    } catch (err) {
      logger.system.warn('[SandboxSettings] getConfig threw:', err)
    } finally {
      setLoading(false)
    }
  }, [applyPayload])

  useEffect(() => {
    void load()
  }, [load])

  // 主进程每次执行后会推送状态，设置页据此看到实时降级链与计数
  useEffect(() => {
    const off = api.sandbox.onStatus((next) => setStatus(next))
    return () => off()
  }, [])

  const patch = useCallback(
    async (next: Partial<SandboxConfig>) => {
      try {
        const res = await api.sandbox.updateConfig(next)
        if (res?.success && res.data) {
          applyPayload(res.data)
        } else {
          logger.system.warn('[SandboxSettings] updateConfig failed:', res?.error)
        }
      } catch (err) {
        logger.system.warn('[SandboxSettings] updateConfig threw:', err)
      }
    },
    [applyPayload],
  )

  const handleReset = useCallback(async () => {
    try {
      const res = await api.sandbox.resetConfig()
      if (res?.success && res.data) applyPayload(res.data)
    } catch (err) {
      logger.system.warn('[SandboxSettings] resetConfig threw:', err)
    }
  }, [applyPayload])

  const handleProbe = useCallback(async () => {
    setProbing(true)
    try {
      const res = await api.sandbox.probe()
      if (res?.success && res.data) setStatus(res.data)
    } catch (err) {
      logger.system.warn('[SandboxSettings] probe threw:', err)
    } finally {
      setProbing(false)
    }
  }, [])

  const probes = status?.probes ?? []
  const probeOf = useMemo(
    () => (kind: string) => probes.find((p) => p.kind === kind),
    [probes],
  )

  const policy = config?.policy ?? 'off'
  const active = status?.activeProvider ?? null

  if (loading) {
    return (
      <div className="flex items-center gap-3 p-6 text-sm text-text-muted">
        <Loader2 className="w-4 h-4 animate-spin" />
        {zh ? '加载中…' : 'Loading…'}
      </div>
    )
  }

  if (!config) {
    return (
      <div className="p-6 text-sm text-text-muted">
        {zh ? '无法读取沙箱配置（主进程模块未就绪）' : 'Sandbox config unavailable'}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* ── 策略 ── */}
      <Card title={zh ? '执行策略' : 'Execution policy'}>
        <div className="grid grid-cols-2 gap-2">
          <PolicyOption
            icon={<Square className="w-4 h-4" />}
            title={zh ? '关闭（默认）' : 'Off (default)'}
            desc={
              zh
                ? 'run_command 与改造前完全一致，直接在工作区终端执行'
                : 'run_command behaves exactly as before'
            }
            active={policy === 'off'}
            onClick={() => void patch({ policy: 'off' })}
          />
          <PolicyOption
            icon={<Terminal className="w-4 h-4" />}
            title={zh ? 'local 受限子进程' : 'local'}
            desc={
              zh
                ? '临时 cwd + 环境变量白名单 + 超时 + 输出上限；不阻断网络、不隐藏文件'
                : 'Restricted subprocess; no network/FS isolation'
            }
            active={policy === 'local'}
            onClick={() => void patch({ policy: 'local' })}
          />
          <PolicyOption
            icon={<Box className="w-4 h-4" />}
            title={zh ? 'docker 容器（推荐）' : 'docker (recommended)'}
            desc={
              zh
                ? '无网络 + 只挂载工作目录 + 内存/CPU/PID 限额 + 只读根文件系统'
                : 'No network, mounted workdir only, resource limits'
            }
            active={policy === 'docker'}
            onClick={() => void patch({ policy: 'docker' })}
          />
          <PolicyOption
            icon={<Cloud className="w-4 h-4" />}
            title={zh ? 'e2b 云沙箱' : 'e2b cloud'}
            desc={
              zh ? '无需本机容器运行时；⚠️ 命令与工作目录会上传至云端' : 'Cloud sandbox; data leaves this machine'
            }
            active={policy === 'e2b'}
            onClick={() => void patch({ policy: 'e2b' })}
          />
        </div>

        {policy === 'off' ? (
          <div className="flex items-start gap-2 rounded-lg border border-border/40 bg-surface/60 px-3 py-2 text-xs text-text-muted">
            <ShieldCheck className="mt-0.5 w-3.5 h-3.5 flex-shrink-0" />
            <span>
              {zh
                ? '当前为关闭状态：run_command 走宿主终端路径，不带任何新增行为。'
                : 'Off: run_command uses the host terminal path with no added behavior.'}
            </span>
          </div>
        ) : null}

        {policy === 'e2b' ? (
          <div className="flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-500">
            <AlertTriangle className="mt-0.5 w-3.5 h-3.5 flex-shrink-0" />
            <span>
              {zh
                ? '合规提示：e2b 为境外云沙箱，命令内容与工作目录文件会离开本机。请勿用于含敏感数据的仓库。'
                : 'Compliance: e2b is a cloud sandbox — commands and workspace files leave this machine.'}
            </span>
          </div>
        ) : null}
      </Card>

      {/* ── 运行状态 ── */}
      <Card title={zh ? '运行状态' : 'Runtime status'}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 text-xs text-text-secondary">
            <div>
              {zh ? '策略：' : 'Policy: '}
              <span className="text-text-primary">{policy}</span>
            </div>
            <div className="mt-0.5">
              {zh ? '实际生效后端：' : 'Active backend: '}
              <span className={active ? 'text-emerald-500' : 'text-amber-500'}>
                {policy === 'off' ? '—' : active ?? (zh ? '无（将拒绝执行）' : 'none')}
              </span>
            </div>
            {status ? (
              <div className="mt-0.5 text-[11px] text-text-muted">
                {zh
                  ? `执行 ${status.totalRuns} 次 · 拒绝 ${status.refusedRuns} 次 · 进行中 ${status.runningCount}`
                  : `runs ${status.totalRuns} · refused ${status.refusedRuns} · running ${status.runningCount}`}
              </div>
            ) : null}
          </div>
          <ActionButton
            label={zh ? '重新检测' : 'Re-probe'}
            icon={<RefreshCw className="w-3.5 h-3.5" />}
            busy={probing}
            onClick={() => void handleProbe()}
          />
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {(['docker', 'local', 'e2b'] as const).map((kind) => {
            const probe = probeOf(kind)
            if (!probe) return null
            return <ProbeBadge key={kind} probe={probe} />
          })}
        </div>

        {status && status.lastDegradations.length > 0 ? (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
            <div className="text-xs font-medium text-amber-500">
              {zh ? '最近一次执行发生了降级' : 'Last run degraded'}
            </div>
            <ul className="mt-1 space-y-0.5 text-[11px] text-amber-500/90">
              {status.lastDegradations.map((d, i) => (
                <li key={`${d.from}-${d.to}-${i}`}>
                  {d.from} → {d.to ?? (zh ? '拒绝执行' : 'refused')}：{d.reason}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {status?.lastError ? (
          <div className="break-words rounded-lg border border-border/40 bg-surface/60 px-3 py-2 text-[11px] text-text-muted">
            {zh ? '最近错误：' : 'Last error: '}
            {status.lastError}
          </div>
        ) : null}

        {issues.length > 0 ? (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
            <ul className="space-y-0.5 text-[11px] text-amber-500">
              {issues.map((issue, i) => (
                <li key={i}>· {issue}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>

      {/* ── 通用参数 ── */}
      <Card title={zh ? '执行限制' : 'Execution limits'}>
        <NumberField
          label={zh ? '单次超时' : 'Timeout'}
          hint={zh ? '超时后先 SIGTERM，宽限期后 SIGKILL 整组回收' : 'SIGTERM then SIGKILL the whole group'}
          value={config.timeoutMs}
          min={1000}
          max={600000}
          step={1000}
          suffix={zh ? '毫秒' : 'ms'}
          disabled={policy === 'off'}
          onCommit={(v) => void patch({ timeoutMs: v })}
        />
        <NumberField
          label={zh ? '输出上限（每流）' : 'Output cap (per stream)'}
          hint={zh ? '超出后截断并在结果中显式标记' : 'Truncated with an explicit marker'}
          value={config.maxOutputBytes}
          min={4096}
          max={16777216}
          step={1024}
          suffix="bytes"
          disabled={policy === 'off'}
          onCommit={(v) => void patch({ maxOutputBytes: v })}
        />
        <ToggleRow
          label={zh ? '工作目录：使用空临时目录' : 'Workdir: empty temp dir'}
          hint={
            zh
              ? '开启后每次执行都在空目录中进行（纯计算）；关闭则在请求的项目目录中执行'
              : 'Run in a fresh temp dir instead of the project dir'
          }
          checked={config.workDirMode === 'temp'}
          disabled={policy === 'off'}
          onChange={(next) => void patch({ workDirMode: next ? 'temp' : 'workspace' })}
        />
        <ToggleRow
          label={zh ? '后端不可用时降级' : 'Fallback when backend unavailable'}
          hint={
            zh
              ? '关闭=严格模式：后端不可用时直接拒绝执行，而不是退回隔离更弱的后端'
              : 'Off = strict: refuse instead of degrading to a weaker backend'
          }
          checked={config.allowFallback}
          disabled={policy === 'off'}
          onChange={(next) => void patch({ allowFallback: next })}
        />
      </Card>

      {/* ── docker 参数 ── */}
      {policy === 'docker' || policy === 'e2b' ? (
        <Card title={zh ? 'Docker 后端' : 'Docker backend'}>
          <div className="flex items-center justify-between gap-4">
            <div className="text-xs text-text-secondary">{zh ? '镜像' : 'Image'}</div>
            <input
              type="text"
              value={config.docker.image}
              onChange={(e) => void patch({ docker: { ...config.docker, image: e.target.value } })}
              className="w-56 rounded-lg border border-border/60 bg-surface px-2 py-1 text-xs text-text-primary"
              placeholder="python:3.11-slim"
            />
          </div>
          <div className="text-[11px] text-text-muted">
            {zh
              ? '镜像必须自带 /bin/sh（distroless 之类无法承载命令行）。首次使用会自动拉取。'
              : 'Image must provide /bin/sh. Pulled on demand.'}
          </div>
          <NumberField
            label={zh ? '内存上限' : 'Memory'}
            value={config.docker.memoryMb}
            min={64}
            max={32768}
            step={64}
            suffix="MB"
            onCommit={(v) => void patch({ docker: { ...config.docker, memoryMb: v } })}
          />
          <NumberField
            label={zh ? 'CPU 核数' : 'CPUs'}
            value={config.docker.cpus}
            min={1}
            max={32}
            onCommit={(v) => void patch({ docker: { ...config.docker, cpus: v } })}
          />
          <NumberField
            label={zh ? '进程数上限' : 'PID limit'}
            hint={zh ? '防 fork 炸弹' : 'Fork-bomb guard'}
            value={config.docker.pidsLimit}
            min={16}
            max={4096}
            onCommit={(v) => void patch({ docker: { ...config.docker, pidsLimit: v } })}
          />
          <ToggleRow
            label={zh ? '允许容器内访问网络' : 'Allow container network'}
            hint={
              zh
                ? '⚠️ 开启后将失去「断网」这一核心隔离能力，仅在命令确实需要联网时开启'
                : '⚠️ Disables the key isolation benefit'
            }
            checked={config.docker.network}
            onChange={(next) => void patch({ docker: { ...config.docker, network: next } })}
          />
        </Card>
      ) : null}

      {/* ── e2b 参数 ── */}
      {policy === 'e2b' ? (
        <Card title={zh ? 'E2B 云沙箱' : 'E2B cloud sandbox'}>
          <div className="flex items-center justify-between gap-4">
            <div className="text-xs text-text-secondary">API Key</div>
            <input
              type="password"
              value={config.e2b.apiKey}
              onChange={(e) => void patch({ e2b: { ...config.e2b, apiKey: e.target.value } })}
              className="w-56 rounded-lg border border-border/60 bg-surface px-2 py-1 text-xs text-text-primary"
              placeholder="e2b_..."
            />
          </div>
          <div className="text-[11px] text-text-muted">
            {zh
              ? 'API Key 使用系统钥匙串加密落盘（与 A2A / VTS 凭证同一机制），读取时会解密回显。'
              : 'Encrypted at rest via the system keychain.'}
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="text-xs text-text-secondary">{zh ? '模板 ID' : 'Template'}</div>
            <input
              type="text"
              value={config.e2b.template}
              onChange={(e) => void patch({ e2b: { ...config.e2b, template: e.target.value } })}
              className="w-56 rounded-lg border border-border/60 bg-surface px-2 py-1 text-xs text-text-primary"
              placeholder="base"
            />
          </div>
          <NumberField
            label={zh ? '云端超时' : 'Cloud timeout'}
            hint={zh ? '与单次超时取较小值' : 'Smaller of the two applies'}
            value={config.e2b.timeoutMs}
            min={1000}
            max={600000}
            step={1000}
            suffix={zh ? '毫秒' : 'ms'}
            onCommit={(v) => void patch({ e2b: { ...config.e2b, timeoutMs: v } })}
          />
          <div className="text-[11px] text-text-muted">
            {zh
              ? '需本机已安装 e2b SDK（npm i e2b）。未安装时该后端不可用，命令会按降级链处理。'
              : 'Requires the e2b SDK (npm i e2b); otherwise this backend is unavailable.'}
          </div>
        </Card>
      ) : null}

      {/* ── 底部操作 ── */}
      <div className="flex items-center justify-between gap-3 pt-1">
        <div className="text-[11px] text-text-muted">
          {zh
            ? '沙箱只改变命令的执行环境，不改变「命令内容是否危险」的既有校验（该层始终生效）。'
            : 'Sandboxing changes where commands run, not the existing danger checks.'}
        </div>
        <ActionButton label={zh ? '恢复默认' : 'Reset'} onClick={() => void handleReset()} />
      </div>
    </div>
  )
}
