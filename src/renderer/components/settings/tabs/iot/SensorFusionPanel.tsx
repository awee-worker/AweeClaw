/**
 * 传感器数据融合面板
 *
 * 功能：
 * - 配置融合服务参数（窗口大小、阈值、卡死超时、联动开关）
 * - 实时展示异常事件日志（订阅 sensorFusion.onAnomaly）
 * - 查看跟踪实体数、累计检测异常数等运行状态
 * - 启动/停止融合服务
 *
 * 数据流：
 * - 配置 R/W：IPC window.electronAPI.sensorFusion.*
 * - 异常事件：IPC window.electronAPI.sensorFusion.onAnomaly 推送
 *
 * @module settings/tabs/iot/SensorFusionPanel
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Activity,
  AlertTriangle,
  Gauge,
  History,
  Loader2,
  Zap,
  Brain,
} from 'lucide-react'
import { type Language, createTranslator } from '@renderer/i18n'
import { logger } from '@shared/toolkit/LogEngine'
import { AnomalyHistoryPanel } from './AnomalyHistoryPanel'
import { EntityTypeOverridesPanel } from './EntityTypeOverridesPanel'

interface SensorFusionPanelProps {
  language: Language
  refreshKey: number
}

/** 实体类型参数覆盖（阶段7 s7-08） */
interface EntityTypeOverride {
  windowSize?: number
  zscoreThreshold?: number
  rateOfChangeThreshold?: number
  stuckValueTimeoutMs?: number
  stuckMinReadings?: number
  cooldownMs?: number
}

/** 融合服务配置（与 electronBridge.d.ts 一致） */
interface FusionConfig {
  enabled: boolean
  windowSize: number
  zscoreThreshold: number
  rateOfChangeThreshold: number
  stuckValueTimeoutMs: number
  stuckMinReadings: number
  causalIntegrationEnabled: boolean
  counterfactualOnAnomaly: boolean
  monitoringIntegrationEnabled: boolean
  cooldownMs: number
  retentionDays: number
  /** 按实体类型差异化配置（阶段7 s7-08） */
  entityTypeOverrides?: Record<string, Partial<EntityTypeOverride>>
}

/** 服务运行状态 */
interface FusionStatus {
  running: boolean
  startedAt?: number
  trackedEntityCount: number
  totalReadingsProcessed: number
  totalAnomaliesDetected: number
  activeAnomalyCount: number
}

/** 异常事件（与 electronBridge.d.ts 一致） */
interface SensorAnomalyEvent {
  id: string
  timestamp: number
  type: 'zscore_outlier' | 'rate_of_change' | 'stuck_value' | 'out_of_range'
  severity: 'info' | 'warning' | 'critical'
  providerId: string
  entityId: string
  externalId: string
  entityType: string
  currentValue: number
  unit?: string
  description: string
  recommendation: string
  zscore?: number
  rateOfChange?: number
  stuckDurationMs?: number
}

const DEFAULT_CONFIG: FusionConfig = {
  enabled: false,
  windowSize: 50,
  zscoreThreshold: 3.0,
  rateOfChangeThreshold: 3.0,
  stuckValueTimeoutMs: 5 * 60 * 1000,
  stuckMinReadings: 5,
  causalIntegrationEnabled: true,
  counterfactualOnAnomaly: false,
  monitoringIntegrationEnabled: true,
  cooldownMs: 60 * 1000,
  retentionDays: 7,
}

/**
 * SensorFusionPanel
 */
export function SensorFusionPanel({ language, refreshKey }: SensorFusionPanelProps) {
  const t = createTranslator(language)
  const locale = language === 'zh' ? 'zh-CN' : 'en-US'

  const [config, setConfig] = useState<FusionConfig>(DEFAULT_CONFIG)
  const [status, setStatus] = useState<FusionStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [anomalies, setAnomalies] = useState<SensorAnomalyEvent[]>([])
  const unsubscribeRef = useRef<(() => void) | null>(null)

  /** 加载配置 */
  const loadConfig = useCallback(async () => {
    try {
      const result = await window.electronAPI.sensorFusion.getConfig()
      if (result.success && result.data) {
        setConfig({ ...DEFAULT_CONFIG, ...result.data })
      }
    } catch (e) {
      logger.settings?.error('Failed to load fusion config:', e)
    }
  }, [])

  /** 加载状态 */
  const loadStatus = useCallback(async () => {
    try {
      const result = await window.electronAPI.sensorFusion.getStatus()
      if (result.success && result.data) {
        setStatus(result.data)
      }
    } catch (e) {
      logger.settings?.error('Failed to load fusion status:', e)
    }
  }, [])

  /** 初始加载 */
  useEffect(() => {
    Promise.all([loadConfig(), loadStatus()])
      .catch((e) => logger.settings?.error('Failed to init fusion panel:', e))
      .finally(() => setLoading(false))
  }, [loadConfig, loadStatus, refreshKey])

  /** 订阅异常事件 */
  useEffect(() => {
    const unsub = window.electronAPI.sensorFusion.onAnomaly((event) => {
      setAnomalies((prev) => [event, ...prev].slice(0, 200))
    })
    unsubscribeRef.current = unsub
    return () => {
      unsub()
      unsubscribeRef.current = null
    }
  }, [])

  /** 自动每 5 秒刷新状态 */
  useEffect(() => {
    const timer = setInterval(() => {
      void loadStatus()
    }, 5000)
    return () => clearInterval(timer)
  }, [loadStatus])

  /** 更新配置 */
  const updateConfig = useCallback(
    async (patch: Partial<FusionConfig>) => {
      const newConfig = { ...config, ...patch }
      setConfig(newConfig)
      setSaving(true)
      try {
        await window.electronAPI.sensorFusion.updateConfig(patch)
      } catch (e) {
        logger.settings?.error('Failed to update fusion config:', e)
      } finally {
        setSaving(false)
      }
    },
    [config],
  )

  /** 格式化时间戳 */
  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleString(locale, {
      hour12: false,
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }

  if (loading) {
    return (
      <div className="p-12 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-text-muted" />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-5">
      {/* 顶部状态卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          icon={<Activity className="w-4 h-4" />}
          label={t('iot.fusion.statusLabel')}
          value={status?.running ? t('iot.fusion.statusRunning') : t('iot.fusion.statusStopped')}
          color={status?.running ? 'emerald' : 'amber'}
        />
        <StatCard
          icon={<Gauge className="w-4 h-4" />}
          label={t('iot.fusion.trackedEntities')}
          value={String(status?.trackedEntityCount ?? 0)}
          color="cyan"
        />
        <StatCard
          icon={<Zap className="w-4 h-4" />}
          label={t('iot.fusion.processedReadings')}
          value={String(status?.totalReadingsProcessed ?? 0)}
          color="violet"
        />
        <StatCard
          icon={<AlertTriangle className="w-4 h-4" />}
          label={t('iot.fusion.anomaliesDetected')}
          value={String(status?.totalAnomaliesDetected ?? 0)}
          color={status && status.activeAnomalyCount > 0 ? 'red' : 'teal'}
        />
      </div>

      {/* 全局开关 */}
      <section className="space-y-4 p-5 bg-surface/30 backdrop-blur-md rounded-xl border border-border shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-accent/10 rounded-lg">
              <Activity className="w-4 h-4 text-accent" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-text-primary">
                {t('iot.fusion.enableServiceTitle')}
              </h4>
              <p className="text-[12px] text-text-muted mt-0.5">
                {t('iot.fusion.enableServiceDesc')}
              </p>
            </div>
          </div>
          <ToggleSwitch
            checked={config.enabled}
            onChange={(e) => void updateConfig({ enabled: e.target.checked })}
          />
        </div>
        {saving && (
          <div className="text-[12px] text-text-muted flex items-center gap-1.5">
            <Loader2 className="w-3 h-3 animate-spin" />
            {t('iot.fusion.saving')}
          </div>
        )}
      </section>

      {/* 参数配置 */}
      <section className="space-y-4 p-5 bg-surface/30 backdrop-blur-md rounded-xl border border-border shadow-sm">
        <h4 className="text-sm font-bold text-text-primary">
          {t('iot.fusion.detectionParamsTitle')}
        </h4>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <NumberInput
            label={t('iot.fusion.windowSizeLabel')}
            description={t('iot.fusion.windowSizeDesc')}
            value={config.windowSize}
            min={5}
            max={500}
            onChange={(v) => void updateConfig({ windowSize: v })}
          />
          <NumberInput
            label={t('iot.fusion.zscoreThresholdLabel')}
            description={t('iot.fusion.zscoreThresholdDesc')}
            value={config.zscoreThreshold}
            min={1.5}
            max={10}
            step={0.5}
            onChange={(v) => void updateConfig({ zscoreThreshold: v })}
          />
          <NumberInput
            label={t('iot.fusion.rateOfChangeThresholdLabel')}
            description={t('iot.fusion.rateOfChangeThresholdDesc')}
            value={config.rateOfChangeThreshold}
            min={1.5}
            max={10}
            step={0.5}
            onChange={(v) => void updateConfig({ rateOfChangeThreshold: v })}
          />
          <NumberInput
            label={t('iot.fusion.stuckTimeoutLabel')}
            description={t('iot.fusion.stuckTimeoutDesc')}
            value={Math.floor(config.stuckValueTimeoutMs / 1000)}
            min={30}
            max={3600}
            onChange={(v) => void updateConfig({ stuckValueTimeoutMs: v * 1000 })}
          />
          <NumberInput
            label={t('iot.fusion.cooldownLabel')}
            description={t('iot.fusion.cooldownDesc')}
            value={Math.floor(config.cooldownMs / 1000)}
            min={10}
            max={3600}
            onChange={(v) => void updateConfig({ cooldownMs: v * 1000 })}
          />
          <NumberInput
            label={t('iot.fusion.retentionDaysLabel')}
            description={t('iot.fusion.retentionDaysDesc')}
            value={config.retentionDays}
            min={1}
            max={90}
            onChange={(v) => void updateConfig({ retentionDays: v })}
          />
        </div>
      </section>

      {/* 实体类型差异化配置（阶段7 s7-08） */}
      <EntityTypeOverridesPanel
        language={language}
        overrides={config.entityTypeOverrides ?? {}}
        onChange={(newOverrides) =>
          void updateConfig({ entityTypeOverrides: newOverrides })
        }
      />

      {/* 联动配置 */}
      <section className="space-y-4 p-5 bg-surface/30 backdrop-blur-md rounded-xl border border-border shadow-sm">
        <h4 className="text-sm font-bold text-text-primary">
          {t('iot.fusion.integrationTitle')}
        </h4>

        <ToggleRow
          icon={<Brain className="w-4 h-4 text-violet-500" />}
          iconBg="bg-violet-500/10"
          title={t('iot.fusion.causalIntegrationTitle')}
          description={t('iot.fusion.causalIntegrationDesc')}
          checked={config.causalIntegrationEnabled}
          onChange={(e) => void updateConfig({ causalIntegrationEnabled: e.target.checked })}
        />

        <div className="pt-3 border-t border-border/40">
          <ToggleRow
            icon={<Zap className="w-4 h-4 text-amber-500" />}
            iconBg="bg-amber-500/10"
            title={t('iot.fusion.counterfactualTitle')}
            description={t('iot.fusion.counterfactualDesc')}
            checked={config.counterfactualOnAnomaly}
            onChange={(e) => void updateConfig({ counterfactualOnAnomaly: e.target.checked })}
            disabled={!config.causalIntegrationEnabled}
          />
        </div>

        <div className="pt-3 border-t border-border/40">
          <ToggleRow
            icon={<AlertTriangle className="w-4 h-4 text-cyan-500" />}
            iconBg="bg-cyan-500/10"
            title={t('iot.fusion.monitoringIntegrationTitle')}
            description={t('iot.fusion.monitoringIntegrationDesc')}
            checked={config.monitoringIntegrationEnabled}
            onChange={(e) => void updateConfig({ monitoringIntegrationEnabled: e.target.checked })}
          />
        </div>
      </section>

      {/* 异常事件日志 */}
      <section className="space-y-3 p-5 bg-surface/30 backdrop-blur-md rounded-xl border border-border shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-text-muted" />
            <h4 className="text-sm font-bold text-text-primary">
              {t('iot.fusion.anomalyLogTitle')}
            </h4>
          </div>
          {anomalies.length > 0 && (
            <button
              onClick={() => setAnomalies([])}
              className="text-[12px] text-text-muted hover:text-text-primary"
            >
              {t('iot.fusion.clearLog')}
            </button>
          )}
        </div>
        {anomalies.length === 0 ? (
          <div className="py-8 text-center text-[12px] text-text-muted">
            {config.enabled ? t('iot.fusion.waitingAnomalies') : t('iot.fusion.serviceNotEnabled')}
          </div>
        ) : (
          <div className="space-y-2 max-h-[400px] overflow-y-auto custom-scrollbar">
            {anomalies.map((a) => {
              const sevColor =
                a.severity === 'critical'
                  ? 'red'
                  : a.severity === 'warning'
                  ? 'amber'
                  : 'cyan'
              return (
                <div
                  key={a.id}
                  className={`p-3 rounded-lg border bg-surface/40 border-${sevColor}-500/30`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span
                      className={`px-2 py-0.5 rounded-md text-[12px] bg-${sevColor}-500/10 text-${sevColor}-500 border border-${sevColor}-500/20`}
                    >
                      {t(`iot.anomalyType.${a.type}`)}
                    </span>
                    <span className="text-[12px] text-text-muted">{formatTime(a.timestamp)}</span>
                  </div>
                  <div className="text-sm text-text-primary font-medium">{a.externalId}</div>
                  <div className="text-[12px] text-text-secondary mt-1">{a.description}</div>
                  <div className="text-[12px] text-text-muted mt-1 italic">
                    {t('iot.fusion.tip')}: {a.recommendation}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* 异常事件历史日志面板（阶段7 s7-07） */}
      <AnomalyHistoryPanel language={language} refreshKey={refreshKey} />
    </div>
  )
}

// ============================================================
// 通用子组件
// ============================================================

function StatCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode
  label: string
  value: string
  color: 'purple' | 'cyan' | 'amber' | 'emerald' | 'red' | 'teal' | 'violet'
}) {
  const colorClasses: Record<string, string> = {
    purple: 'bg-purple-500/10 text-purple-500',
    cyan: 'bg-cyan-500/10 text-cyan-500',
    amber: 'bg-amber-500/10 text-amber-500',
    emerald: 'bg-emerald-500/10 text-emerald-500',
    red: 'bg-red-500/10 text-red-500',
    teal: 'bg-teal-500/10 text-teal-500',
    violet: 'bg-violet-500/10 text-violet-500',
  }
  return (
    <div className="p-3 rounded-xl bg-surface/30 border border-border/40 flex items-start gap-3">
      <div className={`p-1.5 rounded-lg ${colorClasses[color]}`}>{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] text-text-muted uppercase tracking-wider">{label}</div>
        <div className="text-base font-bold text-text-primary mt-0.5 truncate">{value}</div>
      </div>
    </div>
  )
}

function NumberInput({
  label,
  description,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string
  description?: string
  value: number
  min?: number
  max?: number
  step?: number
  onChange: (v: number) => void
}) {
  return (
    <div>
      <label className="block text-[12px] font-medium text-text-secondary mb-1">{label}</label>
      <input
        type="number"
        min={min}
        max={max}
        step={step ?? 1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="w-full px-3 py-2 rounded-lg bg-surface/40 border border-border/40 text-sm text-text-primary focus:outline-none focus:border-accent/50"
      />
      {description && <p className="text-[12px] text-text-muted mt-1">{description}</p>}
    </div>
  )
}

function ToggleSwitch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  disabled?: boolean
}) {
  return (
    <label className={`relative inline-block w-10 h-5 ${disabled ? 'opacity-50' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="sr-only"
      />
      <span
        className={`absolute inset-0 rounded-full transition-colors ${
          checked ? 'bg-accent' : 'bg-border'
        }`}
      />
      <span
        className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
          checked ? 'translate-x-5' : ''
        }`}
      />
    </label>
  )
}

function ToggleRow({
  icon,
  iconBg,
  title,
  description,
  checked,
  onChange,
  disabled,
}: {
  icon: React.ReactNode
  iconBg: string
  title: string
  description: string
  checked: boolean
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3 min-w-0">
        <div className={`p-2 rounded-lg ${iconBg} shrink-0`}>{icon}</div>
        <div className="min-w-0">
          <h5 className="text-sm font-medium text-text-primary">{title}</h5>
          <p className="text-[12px] text-text-muted mt-0.5">{description}</p>
        </div>
      </div>
      <ToggleSwitch checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  )
}
