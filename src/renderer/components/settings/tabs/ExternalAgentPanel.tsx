/**
 * 外部智能体设置面板
 *
 * 功能：
 * - 检测 Claude Code / Codex CLI 可用性（preflight）
 * - 各 Agent 启用开关
 * - API Key 配置（主进程注入子进程环境变量）
 * - 全局开关：是否向 AI 暴露 external_agent_* 工具
 * - 默认权限模式 / 默认超时
 *
 * 所有配置即时保存（electron-store，主进程 external-agent 模块）。
 */

import { useEffect, useState, useCallback } from 'react'
import { Bot, History, Loader2, Key, Play, RefreshCw, ShieldAlert } from 'lucide-react'
import { ToggleSwitch } from '@components/ui'
import { type Language } from '@renderer/i18n'
import { logger } from '@shared/toolkit/LogEngine'
import {
  EXTERNAL_AGENT_DEFS,
  EXTERNAL_AGENT_IDS,
  DEFAULT_EXTERNAL_AGENT_CONFIG,
  type ExternalAgentId,
  type AgentPreflightResult,
  type ExternalAgentConfig,
  type AgentPermissionMode,
  type RecentAgentRun,
} from '@shared/externalAgents'
import { refreshExternalAgentToolsExposed } from '@intelligence/toolkit/externalAgentToolsGate'

interface ExternalAgentPanelProps {
  language: Language
}

const PERMISSION_MODE_OPTIONS: Array<{ value: AgentPermissionMode; labelZh: string; labelEn: string; hintZh?: string; hintEn?: string }> = [
  { value: 'default', labelZh: '默认（只读）', labelEn: 'Default (read-only)' },
  { value: 'acceptEdits', labelZh: '允许编辑文件', labelEn: 'Accept edits', hintZh: 'Agent 可直接修改工作区内文件', hintEn: 'Agent may modify files in the workspace' },
  { value: 'planOnly', labelZh: '仅规划（不执行）', labelEn: 'Plan only', hintZh: 'Agent 只输出方案，不写文件', hintEn: 'Agent plans but does not write files' },
  { value: 'bypass', labelZh: '跳过审批（危险）', labelEn: 'Bypass approvals (dangerous)', hintZh: 'Agent 无需确认即可执行任何命令，慎用', hintEn: 'Agent executes without approval — use with caution' },
]

export function ExternalAgentPanel({ language }: ExternalAgentPanelProps) {
  const isZh = language === 'zh'

  const [config, setConfig] = useState<ExternalAgentConfig>(DEFAULT_EXTERNAL_AGENT_CONFIG)
  const [preflights, setPreflights] = useState<Record<string, AgentPreflightResult | null>>({})
  const [detecting, setDetecting] = useState(false)
  const [saved, setSaved] = useState(false)
  // 最近运行记录（「继续上次任务」）
  const [recentRuns, setRecentRuns] = useState<RecentAgentRun[]>([])
  const [resuming, setResuming] = useState('')
  const [resumeMsg, setResumeMsg] = useState('')

  // ── 加载配置 + 检测可用性 ──
  const loadAll = useCallback(async () => {
    try {
      const cfg = await window.electronAPI.externalAgent.getConfig()
      setConfig({ ...DEFAULT_EXTERNAL_AGENT_CONFIG, ...cfg, enabled: { ...DEFAULT_EXTERNAL_AGENT_CONFIG.enabled, ...(cfg?.enabled || {}) } })
    } catch (e) {
      logger.settings.error('[ExternalAgent] Failed to load config:', e)
    }

    setDetecting(true)
    try {
      const results = await Promise.all(
        EXTERNAL_AGENT_IDS.map(async (id) => {
          try {
            return { id, result: await window.electronAPI.externalAgent.preflight(id) }
          } catch {
            return { id, result: null as AgentPreflightResult | null }
          }
        }),
      )
      const next: Record<string, AgentPreflightResult | null> = {}
      for (const { id, result } of results) next[id] = result
      setPreflights(next)
    } finally {
      setDetecting(false)
    }
  }, [])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  // ── 即时保存 ──
  const save = useCallback(async (patch: Partial<ExternalAgentConfig>) => {
    try {
      const { success, config: next } = await window.electronAPI.externalAgent.saveConfig(patch)
      if (success) {
        setConfig(next)
        setSaved(true)
        setTimeout(() => setSaved(false), 1500)
        // “向 AI 暴露工具”开关变化时同步刷新 LLM 工具门控缓存
        if (patch.toolsExposed !== undefined) {
          void refreshExternalAgentToolsExposed()
        }
      }
    } catch (e) {
      logger.settings.error('[ExternalAgent] Failed to save config:', e)
    }
  }, [])

  const toggleAgent = (id: ExternalAgentId, enabled: boolean) => {
    void save({ enabled: { ...config.enabled, [id]: enabled } })
  }

  const setKey = (id: ExternalAgentId, value: string) => {
    void save({ apiKeys: { ...config.apiKeys, [id]: value || undefined } })
  }

  // ── 最近任务加载 / 继续 ──
  const loadRecent = useCallback(async () => {
    try {
      setRecentRuns(await window.electronAPI.externalAgent.recent())
    } catch {
      /* 主进程不可用时保持空列表 */
    }
  }, [])

  useEffect(() => {
    void loadRecent()
  }, [loadRecent])

  const resumeRun = useCallback(async (run: RecentAgentRun) => {
    if (resuming) return
    setResuming(run.requestId)
    setResumeMsg('')
    try {
      const started = await window.electronAPI.externalAgent.start({
        agent: run.agent,
        task: run.task,
        workdir: run.workdir,
        resumeSession: run.session || undefined,
        permissionMode: config.defaultPermissionMode,
      })
      if (!started.ok) {
        setResumeMsg(isZh ? `继续失败：${started.error || '未知错误'}` : `Resume failed: ${started.error || 'unknown error'}`)
      } else {
        setResumeMsg(isZh ? `已继续任务（会话 ${started.requestId.slice(0, 8)}…），完成后可在聊天中用 external_agent_status 查询。` : `Resumed run (${started.requestId.slice(0, 8)}…); check external_agent_status later.`)
        await loadRecent()
      }
    } catch (e) {
      logger.settings.error('[ExternalAgent] resume failed:', e)
    } finally {
      setResuming('')
    }
  }, [resuming, config.defaultPermissionMode, isZh, loadRecent])

  const clearRuns = useCallback(async () => {
    try {
      await window.electronAPI.externalAgent.clearRecent()
      setRecentRuns([])
    } catch {
      /* ignore */
    }
  }, [])

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      {/* 顶部说明 */}
      <div className="p-5 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl flex items-start gap-4 shadow-sm">
        <div className="p-2 bg-emerald-500/10 rounded-lg shrink-0">
          <Bot className="w-5 h-5 text-emerald-500" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-bold text-emerald-500 mb-1 tracking-tight">
            {isZh ? '外部编码智能体' : 'External Coding Agents'}
          </h3>
          <p className="text-xs text-text-secondary leading-relaxed opacity-90">
            {isZh
              ? '将编码任务委托给本机安装的自主编码智能体（Claude Code / Codex CLI / Cursor Agent）。它们在受控工作区内自主规划、改文件、跑测试，结果回传至 AI 助手。'
              : 'Delegate coding tasks to locally installed autonomous coding agents (Claude Code / Codex CLI / Cursor Agent). They plan, edit files and run tests in a sandboxed workspace, then report back to the assistant.'}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          {saved && (
            <div className="text-[12px] text-text-muted">{isZh ? '已保存' : 'Saved'}</div>
          )}
          <button
            onClick={() => void loadAll()}
            disabled={detecting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-emerald-500/15 text-emerald-500 border border-emerald-500/30 hover:bg-emerald-500/25 disabled:opacity-50 transition-all"
          >
            {detecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            {isZh ? '重新检测' : 'Re-detect'}
          </button>
        </div>
      </div>

      {/* Agent 卡片列表 */}
      <div className="space-y-3">
        {EXTERNAL_AGENT_IDS.map((id) => {
          const def = EXTERNAL_AGENT_DEFS[id]
          const pf = preflights[id]
          const enabled = Boolean(config.enabled[id])
          const usable = Boolean(pf?.available)
          const keyConfigured = Boolean(config.apiKeys?.[id])

          return (
            <div key={id} className="p-4 bg-surface/60 border border-border/40 rounded-2xl shadow-sm space-y-3">
              {/* 头部：名称 + 状态 + 开关 */}
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-500/10 rounded-lg shrink-0">
                  <Bot className="w-4 h-4 text-emerald-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-text-primary">{def.displayName}</span>
                    {pf && (
                      usable ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-medium">
                          {isZh ? '可用' : 'Available'}
                          {pf.version ? ` · ${pf.version}` : ''}
                        </span>
                      ) : (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 font-medium">
                          {isZh ? '不可用' : 'Unavailable'}
                        </span>
                      )
                    )}
                    {detecting && <Loader2 className="w-3 h-3 animate-spin text-text-muted" />}
                  </div>
                  <p className="text-[11px] text-text-muted mt-0.5">{def.description}</p>
                </div>
                <ToggleSwitch
                  checked={enabled}
                  onChange={(e) => toggleAgent(id, e.target.checked)}
                  disabled={!usable || !def.headless}
                  switchSize="sm"
                />
              </div>

              {/* 不可用原因 / 安装指引 */}
              {pf && !usable && pf.reason && (
                <div className="text-[11px] text-amber-400/80 flex items-start gap-1.5">
                  <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{pf.reason}</span>
                </div>
              )}
              {!def.headless && (
                <div className="text-[11px] text-text-muted italic">{def.installHint}</div>
              )}

              {/* API Key */}
              {def.keyEnvVar && (
                <div className="flex items-center gap-2 pt-1 border-t border-border/30">
                  <Key className="w-3.5 h-3.5 text-text-muted shrink-0" />
                  <input
                    type="password"
                    value={config.apiKeys?.[id] || ''}
                    onChange={(e) => setKey(id, e.target.value)}
                    placeholder={isZh ? `${def.keyEnvVar}（留空则使用系统环境变量）` : `${def.keyEnvVar} (empty = use system env var)`}
                    className="flex-1 bg-transparent text-xs text-text-primary placeholder:text-text-muted outline-none px-1 py-1.5 rounded border border-transparent focus:border-emerald-500/30 transition-colors"
                  />
                  {keyConfigured && (
                    <span className="text-[10px] text-emerald-400 shrink-0">{isZh ? '已配置' : 'Set'}</span>
                  )}
                </div>
              )}

              {/* 安装指引 */}
              {def.headless && (
                <div className="text-[11px] text-text-muted flex items-start gap-1.5">
                  <span className="shrink-0 font-mono text-text-secondary">{def.installHint}</span>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* 最近任务（继续上次） */}
      {recentRuns.length > 0 && (
        <div className="p-4 bg-surface/60 border border-border/40 rounded-2xl shadow-sm space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-sm font-medium text-text-primary">
              <History className="w-3.5 h-3.5 text-emerald-500" />
              {isZh ? '最近任务' : 'Recent Runs'}
            </div>
            <button
              onClick={() => void clearRuns()}
              className="text-[11px] text-text-muted hover:text-text-primary transition-colors"
            >
              {isZh ? '清空' : 'Clear'}
            </button>
          </div>
          <div className="space-y-2">
            {recentRuns.map((run) => {
              const def = EXTERNAL_AGENT_DEFS[run.agent]
              const resumable = Boolean(run.session || def.headless)
              return (
                <div key={run.requestId} className="flex items-center gap-3 p-2.5 bg-surface/40 border border-border/30 rounded-xl">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-text-primary truncate" title={run.task}>
                      {def?.displayName || run.agent} · {run.task}
                    </div>
                    <div className="text-[10px] text-text-muted mt-0.5">
                      {run.status}
                      {run.durationMs ? ` · ${Math.round(run.durationMs / 1000)}s` : ''}
                      {run.session ? ` · ${isZh ? '会话' : 'session'} ${run.session.slice(0, 8)}…` : ''}
                    </div>
                  </div>
                  <button
                    onClick={() => void resumeRun(run)}
                    disabled={resuming === run.requestId || !resumable}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium bg-emerald-500/15 text-emerald-500 border border-emerald-500/30 hover:bg-emerald-500/25 disabled:opacity-40 transition-all shrink-0"
                  >
                    {resuming === run.requestId ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Play className="w-3 h-3" />
                    )}
                    {isZh ? '继续' : 'Resume'}
                  </button>
                </div>
              )
            })}
          </div>
          {resumeMsg && (
            <div className="text-[11px] text-emerald-400/90">{resumeMsg}</div>
          )}
        </div>
      )}

      {/* 全局选项 */}
      <div className="p-4 bg-surface/60 border border-border/40 rounded-2xl shadow-sm space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium text-text-primary">
              {isZh ? '向 AI 暴露 external_agent 工具' : 'Expose external_agent tools to AI'}
            </div>
            <p className="text-[11px] text-text-muted mt-0.5">
              {isZh
                ? '开启后 AI 可主动将编码任务委托给外部智能体；建议仅在需要时开启'
                : 'When on, the AI may proactively delegate coding tasks to external agents. Enable only when needed.'}
            </p>
          </div>
          <ToggleSwitch
            checked={config.toolsExposed}
            onChange={(e) => void save({ toolsExposed: e.target.checked })}
            switchSize="sm"
          />
        </div>

        {/* 默认权限模式 */}
        <div className="flex items-center justify-between gap-4 pt-3 border-t border-border/30">
          <div>
            <div className="text-sm font-medium text-text-primary">
              {isZh ? '默认权限模式' : 'Default permission mode'}
            </div>
            <p className="text-[11px] text-text-muted mt-0.5">
              {(PERMISSION_MODE_OPTIONS.find((o) => o.value === (config.defaultPermissionMode || 'acceptEdits'))?.hintZh ??
                PERMISSION_MODE_OPTIONS.find((o) => o.value === (config.defaultPermissionMode || 'acceptEdits'))?.hintEn) ?? ''}
            </p>
          </div>
          <select
            value={config.defaultPermissionMode || 'acceptEdits'}
            onChange={(e) => void save({ defaultPermissionMode: e.target.value as AgentPermissionMode })}
            className="bg-surface-active border border-border/50 rounded-lg px-2 py-1.5 text-xs text-text-primary outline-none focus:border-emerald-500/40"
          >
            {PERMISSION_MODE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {isZh ? o.labelZh : o.labelEn}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  )
}
