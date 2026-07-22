/**
 * 实时指标卡片网格组件
 *
 * 展示当前系统指标的快照，按 4 列网格排列：
 * - CPU 使用率 + 负载均值
 * - 内存使用率 + 可用内存
 * - 磁盘使用率 + IO 速率
 * - 网络上下行速率
 * - 进程数 / 温度 / 电量（如有）
 *
 * 每个卡片显示当前值 + 警告/严重状态色
 */

import { memo } from 'react'
import { Cpu, MemoryStick, HardDrive, Wifi, Activity, Thermometer, Battery, BatteryCharging } from 'lucide-react'
import { t, type Language } from '@renderer/i18n'

/** 系统指标快照 */
export interface MetricsSnapshot {
  timestamp: number
  cpuUsage: number
  cpuLoadAvg1: number
  cpuLoadAvg5: number
  cpuLoadAvg15: number
  memoryUsage: number
  memoryAvailableMB: number
  memoryTotalMB: number
  diskUsage: number
  diskIoReadKBps: number
  diskIoWriteKBps: number
  networkRxKBps: number
  networkTxKBps: number
  processCount: number
  cpuTemperature: number
  batteryPercent: number
  batteryCharging: boolean
}

interface MetricsGridPanelProps {
  metrics: MetricsSnapshot | null
  thresholds: {
    cpuWarning: number
    cpuCritical: number
    memoryWarning: number
    memoryCritical: number
    diskWarning: number
    diskCritical: number
    temperatureWarning: number
    temperatureCritical: number
    batteryLow: number
    processExplosion: number
  }
  language: Language
}

/** 按阈值计算严重度 */
function getSeverity(value: number, warning: number, critical: number): 'normal' | 'warning' | 'critical' {
  if (value >= critical) return 'critical'
  if (value >= warning) return 'warning'
  return 'normal'
}

/** 严重度 → 颜色 */
const SEVERITY_COLORS = {
  normal: 'text-text-primary',
  warning: 'text-amber-500',
  critical: 'text-red-500',
} as const

/** 严重度 → 边框色 */
const SEVERITY_BORDERS = {
  normal: 'border-border/40',
  warning: 'border-amber-500/40',
  critical: 'border-red-500/40',
} as const

interface MetricCardProps {
  icon: React.ReactNode
  label: string
  value: string
  subValue?: string
  severity?: 'normal' | 'warning' | 'critical'
  color?: string
}

function MetricCard({ icon, label, value, subValue, severity = 'normal', color }: MetricCardProps) {
  return (
    <div className={`p-3 bg-surface/20 backdrop-blur-md rounded-xl border ${SEVERITY_BORDERS[severity]}`}>
      <div className="flex items-center gap-2 mb-1.5">
        <div className={color ?? (severity === 'normal' ? 'text-text-muted' : SEVERITY_COLORS[severity])}>
          {icon}
        </div>
        <span className="text-[12px] text-text-muted">{label}</span>
      </div>
      <div className={`font-mono font-bold text-lg ${SEVERITY_COLORS[severity]}`}>
        {value}
      </div>
      {subValue && (
        <div className="text-[12px] text-text-muted mt-0.5">{subValue}</div>
      )}
    </div>
  )
}

export const MetricsGridPanel = memo(function MetricsGridPanel({
  metrics,
  thresholds,
  language,
}: MetricsGridPanelProps) {
  if (!metrics) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="p-3 bg-surface/20 rounded-xl border border-border/30">
            <div className="w-4 h-4 bg-surface-hover rounded mb-2" />
            <div className="w-16 h-5 bg-surface-hover rounded" />
          </div>
        ))}
      </div>
    )
  }

  const cpuSeverity = getSeverity(metrics.cpuUsage, thresholds.cpuWarning, thresholds.cpuCritical)
  const memSeverity = getSeverity(metrics.memoryUsage, thresholds.memoryWarning, thresholds.memoryCritical)
  const diskSeverity = getSeverity(metrics.diskUsage, thresholds.diskWarning, thresholds.diskCritical)
  const tempSeverity = metrics.cpuTemperature >= 0
    ? getSeverity(metrics.cpuTemperature, thresholds.temperatureWarning, thresholds.temperatureCritical)
    : 'normal'
  const batterySeverity = metrics.batteryPercent >= 0 && !metrics.batteryCharging && metrics.batteryPercent <= thresholds.batteryLow
    ? 'warning'
    : 'normal'

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <MetricCard
        icon={<Cpu className="w-4 h-4" />}
        label={t('monitoring.metrics.cpuUsage', language)}
        value={`${metrics.cpuUsage.toFixed(1)}%`}
        subValue={t('monitoring.metrics.loadAvg', language, {
          avg1: metrics.cpuLoadAvg1.toFixed(2),
          avg5: metrics.cpuLoadAvg5.toFixed(2),
        })}
        severity={cpuSeverity}
      />
      <MetricCard
        icon={<MemoryStick className="w-4 h-4" />}
        label={t('monitoring.metrics.memoryUsage', language)}
        value={`${metrics.memoryUsage.toFixed(1)}%`}
        subValue={t('monitoring.metrics.memoryAvailable', language, {
          available: String(metrics.memoryAvailableMB),
          total: String(metrics.memoryTotalMB),
        })}
        severity={memSeverity}
      />
      <MetricCard
        icon={<HardDrive className="w-4 h-4" />}
        label={t('monitoring.metrics.diskUsage', language)}
        value={`${metrics.diskUsage.toFixed(1)}%`}
        subValue={t('monitoring.metrics.diskIo', language, {
          read: metrics.diskIoReadKBps.toFixed(0),
          write: metrics.diskIoWriteKBps.toFixed(0),
        })}
        severity={diskSeverity}
      />
      <MetricCard
        icon={<Wifi className="w-4 h-4" />}
        label={t('monitoring.metrics.network', language)}
        value={`${(metrics.networkRxKBps / 1024).toFixed(2)} MB/s`}
        subValue={`↑ ${(metrics.networkTxKBps / 1024).toFixed(2)} MB/s`}
      />
      <MetricCard
        icon={<Activity className="w-4 h-4" />}
        label={t('monitoring.metrics.processCount', language)}
        value={String(metrics.processCount)}
        subValue={
          metrics.processCount >= thresholds.processExplosion
            ? t('monitoring.metrics.processExplosion', language)
            : undefined
        }
        severity={metrics.processCount >= thresholds.processExplosion ? 'warning' : 'normal'}
      />
      {metrics.cpuTemperature >= 0 && (
        <MetricCard
          icon={<Thermometer className="w-4 h-4" />}
          label={t('monitoring.metrics.temperature', language)}
          value={`${metrics.cpuTemperature.toFixed(1)}℃`}
          severity={tempSeverity}
        />
      )}
      {metrics.batteryPercent >= 0 && (
        <MetricCard
          icon={metrics.batteryCharging ? <BatteryCharging className="w-4 h-4" /> : <Battery className="w-4 h-4" />}
          label={t('monitoring.metrics.battery', language)}
          value={`${metrics.batteryPercent.toFixed(0)}%`}
          subValue={metrics.batteryCharging ? t('monitoring.metrics.charging', language) : undefined}
          severity={batterySeverity}
        />
      )}
      <MetricCard
        icon={<Activity className="w-4 h-4" />}
        label={t('monitoring.metrics.lastUpdate', language)}
        value={new Date(metrics.timestamp).toLocaleTimeString(
          language === 'zh' ? 'zh-CN' : 'en-US',
          { hour: '2-digit', minute: '2-digit', second: '2-digit' },
        )}
        subValue={t('monitoring.metrics.sampleRate', language)}
      />
    </div>
  )
})
