/**
 * 多模态融合环境视图（阶段9 s9-06 新增）
 *
 * 全屏弹窗，可视化 4 通道融合感知结果：
 * - 顶部：标题 + 注意力分数 + 自动刷新开关 + 手动刷新按钮
 * - 中部：4 个通道卡片（scene/iot/causal/monitoring）
 *   每个卡片显示：通道名 + 运行状态 + 异常数 + 一行摘要 + 过期标记
 * - 底部：跨通道洞察列表（含严重度图标 + 描述 + 关联通道）
 *
 * 数据来源：window.electronAPI.perceptionFusion.getEnvironmentContext()
 * 自动刷新：每 5 秒一次（可关闭）
 *
 * 用户在 PerceptionSettingsPanel 中点击「融合感知」按钮打开。
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Layers,
  RefreshCw,
  AlertTriangle,
  AlertCircle,
  Info,
  Activity,
  Cpu,
  Network,
  Brain,
  Monitor,
  CheckCircle2,
  XCircle,
  Clock,
} from 'lucide-react'
import { OverlayDialog } from '@components/ui'
import { ToggleSwitch } from '@components/ui'
import { t, type Language } from '@renderer/i18n'
import { logger } from '@shared/toolkit/LogEngine'

interface FusionEnvironmentViewProps {
  /** 是否打开 */
  isOpen: boolean
  /** 关闭回调 */
  onClose: () => void
  /** 语言 */
  language: Language
}

/** 通道名称类型 */
type ChannelName = 'scene' | 'iot' | 'causal' | 'monitoring'

/** 通道摘要 */
interface ChannelSummary {
  name: ChannelName
  running: boolean
  lastUpdateAt: number | null
  anomalyCount: number
  summary: string
  stale: boolean
  data?: unknown
}

/** 跨通道洞察 */
interface CrossChannelInsight {
  type: string
  description: string
  severity: 'info' | 'warning' | 'critical'
  channels: ChannelName[]
}

/** 环境上下文 */
interface EnvironmentContext {
  timestamp: number
  channels: ChannelSummary[]
  totalAnomalyCount: number
  attentionScore: number
  insights: CrossChannelInsight[]
  staleChannels: ChannelName[]
  scene: unknown
  iot: unknown
  causal: unknown
  monitoring: unknown
}

/** 通道配置（图标 + 颜色 + i18n 键） */
const CHANNEL_CONFIG: Record<ChannelName, {
  icon: typeof Activity
  color: string
  bgColor: string
  borderColor: string
  labelKey: string
}> = {
  scene: {
    icon: Activity,
    color: 'text-violet-500',
    bgColor: 'bg-violet-500/10',
    borderColor: 'border-violet-500/30',
    labelKey: 'fusion.channel.scene',
  },
  iot: {
    icon: Network,
    color: 'text-cyan-500',
    bgColor: 'bg-cyan-500/10',
    borderColor: 'border-cyan-500/30',
    labelKey: 'fusion.channel.iot',
  },
  causal: {
    icon: Brain,
    color: 'text-emerald-500',
    bgColor: 'bg-emerald-500/10',
    borderColor: 'border-emerald-500/30',
    labelKey: 'fusion.channel.causal',
  },
  monitoring: {
    icon: Monitor,
    color: 'text-rose-500',
    bgColor: 'bg-rose-500/10',
    borderColor: 'border-rose-500/30',
    labelKey: 'fusion.channel.monitoring',
  },
}

/** 严重度配置 */
const SEVERITY_CONFIG: Record<CrossChannelInsight['severity'], {
  icon: typeof Info
  color: string
  bgColor: string
}> = {
  info: {
    icon: Info,
    color: 'text-blue-500',
    bgColor: 'bg-blue-500/10',
  },
  warning: {
    icon: AlertTriangle,
    color: 'text-amber-500',
    bgColor: 'bg-amber-500/10',
  },
  critical: {
    icon: AlertCircle,
    color: 'text-red-500',
    bgColor: 'bg-red-500/10',
  },
}

/** 自动刷新间隔（ms） */
const AUTO_REFRESH_INTERVAL_MS = 5000

export function FusionEnvironmentView({
  isOpen,
  onClose,
  language,
}: FusionEnvironmentViewProps) {
  const [context, setContext] = useState<EnvironmentContext | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  /** 加载环境上下文 */
  const loadContext = useCallback(async () => {
    if (!window.electronAPI?.perceptionFusion) {
      setError(t('fusion.notAvailable', language))
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await window.electronAPI.perceptionFusion.getEnvironmentContext()
      if (result.success && result.data) {
        setContext(result.data as EnvironmentContext)
      } else {
        setError(result.error ?? t('fusion.loadError', language))
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.agent?.warn('[FusionEnvironmentView] 加载失败:', msg)
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [language])

  /** 初次加载 + isOpen 变化时重新加载 */
  useEffect(() => {
    if (isOpen) {
      void loadContext()
    }
  }, [isOpen, loadContext])

  /** 自动刷新定时器 */
  useEffect(() => {
    if (!isOpen || !autoRefresh) {
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current)
        refreshTimerRef.current = null
      }
      return
    }

    refreshTimerRef.current = setInterval(() => {
      void loadContext()
    }, AUTO_REFRESH_INTERVAL_MS)

    return () => {
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current)
        refreshTimerRef.current = null
      }
    }
  }, [isOpen, autoRefresh, loadContext])

  /** 注意力分数颜色 */
  const attentionColor = context
    ? context.attentionScore >= 0.7
      ? 'text-red-500'
      : context.attentionScore >= 0.4
        ? 'text-amber-500'
        : 'text-emerald-500'
    : 'text-text-muted'

  /** 注意力分数背景 */
  const attentionBgColor = context
    ? context.attentionScore >= 0.7
      ? 'bg-red-500/10 border-red-500/30'
      : context.attentionScore >= 0.4
        ? 'bg-amber-500/10 border-amber-500/30'
        : 'bg-emerald-500/10 border-emerald-500/30'
    : 'bg-surface/20 border-border'

  return (
    <OverlayDialog isOpen={isOpen} onClose={onClose} size="5xl">
      <div className="p-6 space-y-5">
        {/* 顶部：标题 + 注意力分数 + 自动刷新 + 手动刷新 */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-3">
              <h3 className="text-base font-bold text-text-primary">
                {t('fusion.title', language)}
              </h3>
              {/* 注意力分数徽章 */}
              <div className={`flex items-center gap-1.5 px-3 py-1 rounded-lg border ${attentionBgColor}`}>
                <Cpu className={`w-3.5 h-3.5 ${attentionColor}`} />
                <span className="text-[12px] text-text-secondary">
                  {t('fusion.attention', language)}
                </span>
                <span className={`text-[12px] font-bold ${attentionColor}`}>
                  {context ? `${(context.attentionScore * 100).toFixed(0)}%` : '--'}
                </span>
              </div>
            </div>
            <p className="text-[12px] text-text-muted mt-0.5">
              {t('fusion.subtitle', language)}
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* 自动刷新开关 */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface/40 border border-border/40">
              <RefreshCw className={`w-3.5 h-3.5 ${autoRefresh ? 'text-emerald-500' : 'text-text-muted'}`} />
              <span className="text-[12px] text-text-secondary">
                {t('fusion.autoRefresh', language)}
              </span>
              <ToggleSwitch
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
              />
            </div>

            {/* 手动刷新 */}
            <button
              onClick={() => void loadContext()}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-accent/10 text-accent border border-accent/30 hover:bg-accent/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              {t('fusion.refresh', language)}
            </button>
          </div>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-500 text-[12px]">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* 中部：4 通道卡片网格 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {(context?.channels ?? []).map((channel) => {
            const cfg = CHANNEL_CONFIG[channel.name]
            const Icon = cfg.icon
            return (
              <div
                key={channel.name}
                className={`p-4 rounded-xl border ${cfg.borderColor} ${cfg.bgColor} backdrop-blur-sm`}
              >
                {/* 通道标题行 */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Icon className={`w-4 h-4 ${cfg.color}`} />
                    <span className="text-sm font-semibold text-text-primary">
                      {t(cfg.labelKey, language)}
                    </span>
                    {/* 运行状态 */}
                    {channel.running ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 text-text-muted" />
                    )}
                  </div>
                  {/* 异常 + 过期标记 */}
                  <div className="flex items-center gap-2">
                    {channel.anomalyCount > 0 && (
                      <span className="px-2 py-0.5 rounded-full bg-red-500/15 text-red-500 text-[12px] font-medium">
                        {channel.anomalyCount} {t('fusion.anomalies', language)}
                      </span>
                    )}
                    {channel.stale && (
                      <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-500 text-[12px] font-medium">
                        {t('fusion.stale', language)}
                      </span>
                    )}
                  </div>
                </div>
                {/* 通道摘要 */}
                <p className="text-[12px] text-text-secondary leading-relaxed break-words">
                  {channel.summary}
                </p>
                {/* 最后更新时间 */}
                {channel.lastUpdateAt && (
                  <div className="flex items-center gap-1 mt-2 text-[12px] text-text-muted">
                    <Clock className="w-3 h-3" />
                    <span>
                      {t('fusion.lastUpdate', language)}: {formatTimestamp(channel.lastUpdateAt, language)}
                    </span>
                  </div>
                )}
              </div>
            )
          })}

          {/* 无数据占位 */}
          {!context && !loading && !error && (
            <div className="col-span-full p-8 text-center text-text-muted text-sm">
              {t('fusion.noData', language)}
            </div>
          )}
        </div>

        {/* 底部：跨通道洞察 */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-accent" />
            <h4 className="text-sm font-semibold text-text-primary">
              {t('fusion.insights', language)}
            </h4>
            {context && context.insights.length > 0 && (
              <span className="text-[12px] text-text-muted">
                ({context.insights.length})
              </span>
            )}
          </div>

          {/* 洞察列表 */}
          {context && context.insights.length > 0 ? (
            <div className="space-y-2">
              {context.insights.map((insight, idx) => {
                const cfg = SEVERITY_CONFIG[insight.severity]
                const Icon = cfg.icon
                return (
                  <div
                    key={`${insight.type}-${idx}`}
                    className={`flex items-start gap-2.5 p-3 rounded-lg border border-border/40 ${cfg.bgColor}`}
                  >
                    <Icon className={`w-4 h-4 ${cfg.color} flex-shrink-0 mt-0.5`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] text-text-primary leading-relaxed">
                        {insight.description}
                      </p>
                      <div className="flex items-center gap-1.5 mt-1.5">
                        {/* 关联通道 */}
                        {insight.channels.map((ch) => {
                          const chCfg = CHANNEL_CONFIG[ch]
                          const ChIcon = chCfg.icon
                          return (
                            <span
                              key={ch}
                              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[12px] ${chCfg.bgColor} ${chCfg.color}`}
                            >
                              <ChIcon className="w-3 h-3" />
                              {t(chCfg.labelKey, language)}
                            </span>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="p-4 text-center text-[12px] text-text-muted">
              {t('fusion.noInsights', language)}
            </div>
          )}
        </div>

        {/* 底部状态栏 */}
        {context && (
          <div className="flex items-center justify-between pt-3 border-t border-border/40 text-[12px] text-text-muted">
            <div className="flex items-center gap-3">
              <span>
                {t('fusion.totalAnomalies', language)}: {context.totalAnomalyCount}
              </span>
              <span>·</span>
              <span>
                {t('fusion.staleChannels', language)}: {context.staleChannels.length}
              </span>
            </div>
            <span>
              {t('fusion.generatedAt', language)}: {formatTimestamp(context.timestamp, language)}
            </span>
          </div>
        )}
      </div>
    </OverlayDialog>
  )
}

/** 格式化时间戳 */
function formatTimestamp(ts: number, language: Language): string {
  const date = new Date(ts)
  const isZh = language === 'zh'
  const time = date.toLocaleTimeString(isZh ? 'zh-CN' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  return time
}
