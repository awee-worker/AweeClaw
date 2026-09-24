/**
 * 会话效果面板
 *
 * 回答的是「任务跑得顺不顺」：绕了多少弯路、循环拦了几次、要不要人盯着、
 * 机器同时累不累。刻意不展示任务内容，只看过程指标。
 *
 * 六路数据源的取数方式不一样，所以面板自己合并：
 * - 轨迹 / 审计 / 资源   由主进程聚合，一次 query 拿回
 * - 审批开销             在渲染层本地存储，直接读账本
 * - 离线评测基线         本地评测现场跑，纯计算、不调模型
 * - 价值换算             需要后端 ROI 服务，当前未接线，按待接入呈现
 *
 * 任何一路拿不到都不影响其余部分渲染，缺项会在面板底部逐条列出。
 */

import { useCallback, useEffect, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  Cpu,
  ListChecks,
  RefreshCw,
  Repeat,
  ShieldCheck,
  Trash2,
  TrendingUp,
} from 'lucide-react'
import { logger } from '@toolkit/LogEngine'
import { summarizeApprovalLedger, type ApprovalSummary } from '@intelligence/decision/approvalLedger'
import { buildEvalReport } from '@intelligence/decision/eval/harness'
import type { EvalReport } from '@intelligence/decision/eval/types'

// ============================================================
// 与主进程对齐的报告结构（面板只声明自己用到的字段）
// ============================================================

interface SessionEffectSummary {
  totalSteps: number
  futileRetries: number
  futileRetryRatio: number
  loopDetections: number
  firstUsefulStep: number | null
  compressionEvents: number
  durationMs: number
  sessionCount: number
}

interface AuditEffect {
  allow: number
  deny: number
  error: number
}

interface ResourceEffect {
  avgCpuPercent: number | null
  peakMemoryMB: number | null
  eventLoopDelayMs: number | null
}

interface EffectReport {
  generatedAt: string
  scope: string
  scopeId: string
  session?: SessionEffectSummary
  audit?: AuditEffect
  resource?: ResourceEffect
  notes: string[]
}

interface EffectPanelProps {
  isOpen: boolean
  onClose: () => void
  /** 语言，用于界面文案 */
  language: 'zh' | 'en'
}

/** 统计卡片 */
function MetricCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = 'default',
}: {
  icon: typeof Activity
  label: string
  value: string
  hint?: string
  tone?: 'default' | 'warn' | 'good'
}) {
  const toneClass =
    tone === 'warn' ? 'text-amber-500' : tone === 'good' ? 'text-emerald-500' : 'text-accent'
  return (
    <div className="flex flex-col gap-1.5 p-3 rounded-xl border border-border/30 bg-surface/30">
      <div className="flex items-center gap-1.5">
        <Icon className={`w-3.5 h-3.5 ${toneClass}`} />
        <span className="text-[11px] text-text-muted">{label}</span>
      </div>
      <span className="text-lg font-semibold text-text-primary leading-none">{value}</span>
      {hint && <span className="text-[10px] text-text-muted">{hint}</span>}
    </div>
  )
}

/** 分组标题 */
function SectionTitle({ icon: Icon, text }: { icon: typeof Activity; text: string }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <Icon className="w-3.5 h-3.5 text-accent/70" />
      <span className="text-[11px] font-medium text-text-muted uppercase tracking-wider">{text}</span>
    </div>
  )
}

export function EffectPanel({ isOpen, onClose, language }: EffectPanelProps) {
  const isZh = language === 'zh'

  const [report, setReport] = useState<EffectReport | null>(null)
  const [approval, setApproval] = useState<ApprovalSummary | null>(null)
  const [baseline, setBaseline] = useState<EvalReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // 先把内存里未结清的插件调用窗口落库，避免刚发生的调用在统计里缺席
      await window.electronAPI.effectMetrics.flush()

      const res = await window.electronAPI.effectMetrics.query({
        scope: 'period',
        scopeId: 'recent',
      })

      if (res.success) {
        setReport((res.data as EffectReport) ?? null)
      } else {
        setError(res.error ?? 'query failed')
      }

      // 审批台账是渲染层本地数据，单独读取
      setApproval(summarizeApprovalLedger())
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.settings?.error('[EffectPanel] 加载效果数据失败:', e)
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isOpen) return
    void load()
  }, [isOpen, load])

  // 离线评测是纯计算，但样本量不小，放到面板打开后再跑，避免拖慢弹窗
  useEffect(() => {
    if (!isOpen || baseline) return
    const timer = setTimeout(() => {
      try {
        setBaseline(buildEvalReport())
      } catch (e) {
        logger.settings?.warn('[EffectPanel] 离线评测执行失败:', e)
      }
    }, 0)
    return () => clearTimeout(timer)
  }, [isOpen, baseline])

  const clearAll = useCallback(async () => {
    const confirmed = window.confirm(
      isZh ? '清空全部会话效果数据？此操作不可撤销。' : 'Clear all effect data? This cannot be undone.',
    )
    if (!confirmed) return
    await window.electronAPI.effectMetrics.clearAll()
    await load()
  }, [isZh, load])

  if (!isOpen) return null

  const session = report?.session
  const audit = report?.audit
  const resource = report?.resource
  const hasSession = !!session && session.totalSteps > 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-3xl max-h-[85vh] flex flex-col rounded-2xl border border-border/40 bg-surface shadow-2xl overflow-hidden">
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/30">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-accent" />
            <span className="text-sm font-medium text-text-primary">
              {isZh ? '会话效果' : 'Session Effect'}
            </span>
            <span className="text-[11px] text-text-muted">
              {isZh ? '最近 7 天' : 'last 7 days'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void load()}
              disabled={loading}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] text-text-muted hover:bg-surface-hover disabled:opacity-40 transition-all"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              {isZh ? '刷新' : 'Refresh'}
            </button>
            <button
              onClick={() => void clearAll()}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] text-red-500/80 hover:bg-red-500/10 transition-all"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {isZh ? '清空' : 'Clear'}
            </button>
            <button
              onClick={onClose}
              className="px-2.5 py-1.5 rounded-lg text-[12px] text-text-muted hover:bg-surface-hover transition-all"
            >
              {isZh ? '关闭' : 'Close'}
            </button>
          </div>
        </div>

        {/* 内容 */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {error && (
            <div className="flex items-start gap-2 p-3 rounded-xl border border-amber-500/30 bg-amber-500/10">
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <span className="text-[12px] text-amber-600 dark:text-amber-400">{error}</span>
            </div>
          )}

          {/* 执行轨迹 */}
          <section>
            <SectionTitle icon={Activity} text={isZh ? '执行轨迹' : 'Execution Trajectory'} />
            {hasSession ? (
              <div className="grid grid-cols-4 gap-2.5">
                <MetricCard
                  icon={ListChecks}
                  label={isZh ? '总步数' : 'Steps'}
                  value={String(session!.totalSteps)}
                  hint={isZh ? `累计 ${session!.sessionCount} 次执行` : `${session!.sessionCount} runs`}
                />
                <MetricCard
                  icon={Repeat}
                  label={isZh ? '无效重试' : 'Futile retries'}
                  value={String(session!.futileRetries)}
                  hint={`${(session!.futileRetryRatio * 100).toFixed(1)}%`}
                  tone={session!.futileRetries > 0 ? 'warn' : 'default'}
                />
                <MetricCard
                  icon={AlertTriangle}
                  label={isZh ? '循环检出' : 'Loops caught'}
                  value={String(session!.loopDetections)}
                  tone={session!.loopDetections > 0 ? 'warn' : 'default'}
                />
                <MetricCard
                  icon={Activity}
                  label={isZh ? '首次可用步' : 'First useful step'}
                  value={session!.firstUsefulStep === null ? '—' : String(session!.firstUsefulStep)}
                  hint={isZh ? `压缩 ${session!.compressionEvents} 次` : `${session!.compressionEvents} compressions`}
                />
              </div>
            ) : (
              <p className="text-[12px] text-text-muted">
                {isZh
                  ? '暂无会话轨迹：跑一次带工具调用的任务后即可看到'
                  : 'No trajectory yet: run a task that calls tools'}
              </p>
            )}
          </section>

          <div className="grid grid-cols-2 gap-5">
            {/* 审批开销 */}
            <section>
              <SectionTitle icon={ShieldCheck} text={isZh ? '审批开销' : 'Approvals'} />
              {approval && approval.total > 0 ? (
                <div className="grid grid-cols-2 gap-2.5">
                  <MetricCard
                    icon={ShieldCheck}
                    label={isZh ? '审批总次数' : 'Total'}
                    value={String(approval.total)}
                  />
                  <MetricCard
                    icon={ShieldCheck}
                    label={isZh ? '批准率' : 'Approved'}
                    value={`${Math.round((approval.approved / Math.max(1, approval.total)) * 100)}%`}
                    tone={approval.rejected > 0 ? 'warn' : 'good'}
                  />
                </div>
              ) : (
                <p className="text-[12px] text-text-muted">
                  {isZh ? '本周没有需要确认的操作' : 'No confirmations this week'}
                </p>
              )}
            </section>

            {/* 操作审计 */}
            <section>
              <SectionTitle icon={ListChecks} text={isZh ? '操作审计' : 'Audit'} />
              {audit ? (
                <div className="grid grid-cols-3 gap-2.5">
                  <MetricCard icon={ShieldCheck} label={isZh ? '放行' : 'Allow'} value={String(audit.allow)} tone="good" />
                  <MetricCard icon={AlertTriangle} label={isZh ? '拒绝' : 'Deny'} value={String(audit.deny)} tone={audit.deny > 0 ? 'warn' : 'default'} />
                  <MetricCard icon={AlertTriangle} label={isZh ? '出错' : 'Error'} value={String(audit.error)} tone={audit.error > 0 ? 'warn' : 'default'} />
                </div>
              ) : (
                <p className="text-[12px] text-text-muted">
                  {isZh ? '无审计记录' : 'No audit records'}
                </p>
              )}
            </section>
          </div>

          {/* 资源开销 */}
          <section>
            <SectionTitle icon={Cpu} text={isZh ? '资源开销' : 'Resources'} />
            <div className="grid grid-cols-3 gap-2.5">
              <MetricCard
                icon={Cpu}
                label={isZh ? '平均 CPU' : 'Avg CPU'}
                value={resource?.avgCpuPercent === null || resource?.avgCpuPercent === undefined ? '—' : `${resource.avgCpuPercent.toFixed(1)}%`}
              />
              <MetricCard
                icon={Cpu}
                label={isZh ? '内存峰值' : 'Peak memory'}
                value={resource?.peakMemoryMB === null || resource?.peakMemoryMB === undefined ? '—' : `${Math.round(resource.peakMemoryMB)} MB`}
              />
              <MetricCard
                icon={Activity}
                label={isZh ? '事件循环延迟' : 'Event loop delay'}
                value={resource?.eventLoopDelayMs === null || resource?.eventLoopDelayMs === undefined ? '—' : `${resource.eventLoopDelayMs.toFixed(1)} ms`}
              />
            </div>
          </section>

          {/* 离线基线 */}
          <section>
            <SectionTitle icon={ShieldCheck} text={isZh ? '离线评测基线' : 'Offline Baseline'} />
            {baseline ? (
              <div className="grid grid-cols-4 gap-2.5">
                <MetricCard
                  icon={ShieldCheck}
                  label={isZh ? '工具选择准确率' : 'Tool selection'}
                  value={`${(baseline.toolSelection.accuracy * 100).toFixed(1)}%`}
                />
                <MetricCard
                  icon={ListChecks}
                  label={isZh ? '任务完成率' : 'Task completion'}
                  value={`${(baseline.taskCompletion.rate * 100).toFixed(1)}%`}
                />
                <MetricCard
                  icon={Activity}
                  label={isZh ? 'Token 节省' : 'Token saving'}
                  value={`${(baseline.tokens.avgSavingRatio * 100).toFixed(1)}%`}
                  tone="good"
                />
                <MetricCard
                  icon={AlertTriangle}
                  label={isZh ? '命令漏放行' : 'Under-flagged'}
                  value={String(baseline.commandRisk?.underFlagged ?? 0)}
                  tone={(baseline.commandRisk?.underFlagged ?? 0) > 0 ? 'warn' : 'good'}
                />
              </div>
            ) : (
              <p className="text-[12px] text-text-muted">
                {isZh ? '正在生成离线评测结果…' : 'Running offline evaluation…'}
              </p>
            )}
          </section>

          {/* 价值换算 */}
          <section>
            <SectionTitle icon={TrendingUp} text={isZh ? '价值换算' : 'Value'} />
            <p className="text-[12px] text-text-muted">
              {isZh
                ? '待接入：需要后端 ROI 服务按会话上报数据做换算'
                : 'Not wired yet: requires the backend ROI service'}
            </p>
          </section>

          {/* 数据说明 */}
          {report?.notes && report.notes.length > 0 && (
            <section className="pt-1 border-t border-border/20">
              <span className="text-[11px] text-text-muted">
                {isZh ? '数据说明' : 'Notes'}
              </span>
              <ul className="mt-1.5 space-y-1">
                {report.notes.map((note) => (
                  <li key={note} className="text-[11px] text-text-muted leading-relaxed">
                    · {note}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}

export default EffectPanel
