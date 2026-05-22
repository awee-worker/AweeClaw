import { useState, useEffect, useCallback } from 'react'
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  Activity,
  Clock,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
} from 'lucide-react'
import { backendApi, isAuthenticated } from '@services/backendApi'

interface DashboardMetrics {
  today: {
    total: number
    success: number
    failed: number
    avgDurationMs: number | null
  }
  recent: {
    hourly: Array<{ hour: string; count: number }>
    daily: Array<{ date: string; count: number; successRate: number }>
  }
  nodes: Array<{
    nodeType: string
    count: number
    avgDurationMs: number
    failureRate: number
  }>
  active: number
}

interface MonitorDashboardProps {
  visible: boolean
  onClose: () => void
  language?: 'en' | 'zh'
}

const MONITOR_BASE = '/api/workflow-monitor'

export default function MonitorDashboard({
  visible,
  onClose,
  language = 'zh',
}: MonitorDashboardProps) {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadMetrics = useCallback(async () => {
    if (!isAuthenticated()) return
    setLoading(true)
    setError(null)
    try {
      const data = await backendApi.get<DashboardMetrics>(
        `${MONITOR_BASE}/dashboard`,
      )
      setMetrics(data)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (visible) {
      loadMetrics()
    }
  }, [visible, loadMetrics])

  if (!visible) return null

  const t = (zh: string, en: string) => (language === 'zh' ? zh : en)

  const successRate =
    metrics && metrics.today.total > 0
      ? Math.round((metrics.today.success / metrics.today.total) * 100)
      : 0

  const formatDuration = (ms: number | null) => {
    if (ms === null || ms === undefined) return '-'
    if (ms < 1000) return `${ms}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
    return `${(ms / 60000).toFixed(1)}m`
  }

  const maxHourlyCount = metrics
    ? Math.max(1, ...metrics.recent.hourly.map((h) => h.count))
    : 1

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[900px] max-h-[80vh] bg-[var(--background)] border border-[var(--border)] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <Header
          language={language}
          loading={loading}
          onClose={onClose}
          onRefresh={loadMetrics}
        />

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading && !metrics && (
            <LoadingState language={language} />
          )}

          {error && (
            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-400">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                <span>{error}</span>
              </div>
            </div>
          )}

          {metrics && (
            <>
              <div className="grid grid-cols-4 gap-4">
                <MetricCard
                  icon={<Activity className="w-4 h-4" />}
                  label={t('今日执行', 'Today Runs')}
                  value={String(metrics.today.total)}
                  sub={t('次', 'runs')}
                  accent="blue"
                />
                <MetricCard
                  icon={<CheckCircle2 className="w-4 h-4" />}
                  label={t('成功率', 'Success Rate')}
                  value={`${successRate}%`}
                  sub={`${metrics.today.success}/${metrics.today.total}`}
                  accent={successRate >= 90 ? 'green' : successRate >= 70 ? 'amber' : 'red'}
                />
                <MetricCard
                  icon={<TrendingDown className="w-4 h-4" />}
                  label={t('失败数', 'Failed')}
                  value={String(metrics.today.failed)}
                  sub={t('次', 'runs')}
                  accent={metrics.today.failed > 0 ? 'red' : 'green'}
                />
                <MetricCard
                  icon={<Clock className="w-4 h-4" />}
                  label={t('平均耗时', 'Avg Duration')}
                  value={formatDuration(metrics.today.avgDurationMs)}
                  sub={t('活跃: ', 'Active: ') + String(metrics.active)}
                  accent="purple"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <ChartCard
                  title={t('24小时趋势', '24h Trend')}
                  icon={<TrendingUp className="w-3.5 h-3.5" />}
                >
                  <div className="flex items-end gap-[2px] h-32 pt-2">
                    {metrics.recent.hourly.map((h) => (
                      <div
                        key={h.hour}
                        className="flex-1 group relative"
                        style={{ height: '100%' }}
                      >
                        <div
                          className="w-full bg-[var(--accent)]/60 group-hover:bg-[var(--accent)] rounded-t transition-all"
                          style={{
                            height: `${(h.count / maxHourlyCount) * 100}%`,
                          }}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-between text-[10px] text-[var(--text-muted)]/50 mt-1">
                    <span>24h ago</span>
                    <span>{t('现在', 'now')}</span>
                  </div>
                </ChartCard>

                <ChartCard
                  title={t('7日成功率', '7-Day Success Rate')}
                  icon={<TrendingUp className="w-3.5 h-3.5" />}
                >
                  <div className="flex items-end gap-1 h-32 pt-2">
                    {metrics.recent.daily.map((d) => (
                      <div
                        key={d.date}
                        className="flex-1 flex flex-col items-center gap-1"
                      >
                        <span className="text-[10px] text-[var(--text-primary)] font-mono">
                          {d.successRate}%
                        </span>
                        <div className="w-full flex-1 bg-[var(--border)]/20 rounded-t relative overflow-hidden">
                          <div
                            className={`absolute bottom-0 w-full rounded-t transition-all ${
                              d.successRate >= 90
                                ? 'bg-green-500/60'
                                : d.successRate >= 70
                                  ? 'bg-amber-500/60'
                                  : 'bg-red-500/60'
                            }`}
                            style={{ height: `${d.successRate}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-[var(--text-muted)]/50">
                          {d.date.slice(5)}
                        </span>
                      </div>
                    ))}
                  </div>
                </ChartCard>
              </div>

              <NodeStatsSection
                nodes={metrics.nodes}
                language={language}
                formatDuration={formatDuration}
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Header({
  language,
  loading,
  onClose,
  onRefresh,
}: {
  language: 'en' | 'zh'
  loading: boolean
  onClose: () => void
  onRefresh: () => void
}) {
  return (
    <div className="flex items-center justify-between px-6 py-3 border-b border-[var(--border)]/60">
      <div className="flex items-center gap-2">
        <BarChart3 className="w-4 h-4 text-[var(--accent)]" />
        <span className="text-sm font-semibold text-[var(--text-primary)]">
          {language === 'zh' ? '运行监控' : 'Run Monitor'}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onRefresh}
          disabled={loading}
          className="p-1.5 rounded-lg hover:bg-[var(--border)]/30 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
        >
          <RefreshCw
            className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`}
          />
        </button>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-[var(--border)]/30 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
        >
          <XCircle className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

function MetricCard({
  icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub: string
  accent: 'blue' | 'green' | 'amber' | 'red' | 'purple'
}) {
  const colors: Record<string, string> = {
    blue: 'text-blue-400',
    green: 'text-green-400',
    amber: 'text-amber-400',
    red: 'text-red-400',
    purple: 'text-purple-400',
  }

  return (
    <div className="p-4 rounded-xl bg-[var(--border)]/10 border border-[var(--border)]/20">
      <div className="flex items-center gap-2 mb-2">
        <span className={colors[accent]}>{icon}</span>
        <span className="text-xs text-[var(--text-muted)]">{label}</span>
      </div>
      <div className={`text-2xl font-bold ${colors[accent]}`}>{value}</div>
      <div className="text-[11px] text-[var(--text-muted)]/60 mt-1">{sub}</div>
    </div>
  )
}

function ChartCard({
  title,
  icon,
  children,
}: {
  title: string
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="p-4 rounded-xl bg-[var(--border)]/10 border border-[var(--border)]/20">
      <div className="flex items-center gap-1.5 mb-3">
        <span className="text-[var(--text-muted)]">{icon}</span>
        <span className="text-xs font-medium text-[var(--text-muted)]">{title}</span>
      </div>
      {children}
    </div>
  )
}

function NodeStatsSection({
  nodes,
  language,
  formatDuration,
}: {
  nodes: DashboardMetrics['nodes']
  language: 'en' | 'zh'
  formatDuration: (ms: number | null) => string
}) {
  if (!nodes || nodes.length === 0) return null

  const t = (zh: string, en: string) => (language === 'zh' ? zh : en)

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Activity className="w-3.5 h-3.5 text-[var(--text-muted)]" />
        <span className="text-xs font-medium text-[var(--text-muted)]">
          {t('节点执行统计', 'Node Execution Stats')}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[var(--border)]/30">
              <th className="text-left py-2 px-3 text-[var(--text-muted)] font-medium">
                {t('节点类型', 'Type')}
              </th>
              <th className="text-right py-2 px-3 text-[var(--text-muted)] font-medium">
                {t('执行次数', 'Count')}
              </th>
              <th className="text-right py-2 px-3 text-[var(--text-muted)] font-medium">
                {t('平均耗时', 'Avg')}
              </th>
              <th className="text-right py-2 px-3 text-[var(--text-muted)] font-medium">
                {t('失败率', 'Fail %')}
              </th>
            </tr>
          </thead>
          <tbody>
            {nodes
              .filter((n) => n.count > 0)
              .sort((a, b) => b.count - a.count)
              .map((node) => (
                <tr
                  key={node.nodeType}
                  className="border-b border-[var(--border)]/10 hover:bg-[var(--border)]/5"
                >
                  <td className="py-2 px-3 text-[var(--text-primary)] font-medium">
                    {node.nodeType}
                  </td>
                  <td className="py-2 px-3 text-right text-[var(--text-primary)]">
                    {node.count}
                  </td>
                  <td className="py-2 px-3 text-right text-[var(--text-muted)]">
                    {formatDuration(node.avgDurationMs)}
                  </td>
                  <td className="py-2 px-3 text-right">
                    <span
                      className={
                        node.failureRate > 10
                          ? 'text-red-400'
                          : node.failureRate > 5
                            ? 'text-amber-400'
                            : 'text-green-400'
                      }
                    >
                      {node.failureRate}%
                    </span>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function LoadingState({ language }: { language: 'en' | 'zh' }) {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <RefreshCw className="w-8 h-8 text-[var(--accent)] animate-spin mb-4" />
      <span className="text-sm text-[var(--text-muted)]">
        {language === 'zh' ? '加载监控数据...' : 'Loading metrics...'}
      </span>
    </div>
  )
}