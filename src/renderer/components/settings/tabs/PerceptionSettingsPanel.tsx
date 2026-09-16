/**
 * 感知与预测设置面板
 *
 * 控制 AweeClaw 的物理感知能力和预测能力。
 * - 全局感知开关
 * - 各感知通道独立开关（屏幕/语音/文件/进程/摄像头等）
 * - 数据保留期配置
 * - 隐私模式（不存储任何数据，只做实时推理）
 * - 数据管理（查看统计、清空数据）
 * - 阶段2 新增：行为预测开关 / 置信度阈值 / 预测频率 / 命中率统计 / 模型信息
 *
 * 所有数据本地化处理，保护用户隐私。
 */

import { useState, useEffect, useCallback } from 'react'
import { Eye, EyeOff, Trash2, Shield, Activity, Clock, AlertTriangle, Sparkles, Target, TrendingUp, Calendar, Network, Gauge, Camera, Layers } from 'lucide-react'
import { ToggleSwitch } from '@components/ui'
import { useFeatureGuard } from '@hooks/useFeatureGuard'
import { type Language, t } from '@renderer/i18n'
import { logger } from '@shared/toolkit/LogEngine'
import { SceneTimelineView } from './perception/SceneTimelineView'
import { ImpactAnalysisView } from './perception/ImpactAnalysisView'
import { SystemMonitorView } from './monitoring/SystemMonitorView'
import { CameraPrivacyControl } from './camera/CameraPrivacyControl'
import { FusionEnvironmentView } from './perception/FusionEnvironmentView'

interface PerceptionSettingsPanelProps {
  language: Language
}

/** 感知通道定义 */
interface ChannelConfig {
  key: string
  labelZh: string
  labelEn: string
  descZh: string
  descEn: string
  icon: React.ReactNode
  riskLevel: 'low' | 'medium' | 'high'
}

/** 感知通道清单 */
const CHANNELS: ChannelConfig[] = [
  {
    key: 'screen',
    labelZh: '屏幕感知',
    labelEn: 'Screen',
    descZh: '定时截图并 OCR 识别，记录当前应用和活动类型',
    descEn: 'Capture screen periodically with OCR, record active app and activity',
    icon: <Eye className="w-4 h-4" />,
    riskLevel: 'medium',
  },
  {
    key: 'voice',
    labelZh: '语音感知',
    labelEn: 'Voice',
    descZh: '监听语音输入，识别语音指令和对话内容',
    descEn: 'Listen to voice input, recognize voice commands and conversation',
    icon: <Activity className="w-4 h-4" />,
    riskLevel: 'high',
  },
  {
    key: 'file',
    labelZh: '文件感知',
    labelEn: 'File',
    descZh: '监听文件系统变更，记录文件读写活动',
    descEn: 'Monitor file system changes, record file read/write activity',
    icon: <Activity className="w-4 h-4" />,
    riskLevel: 'low',
  },
  {
    key: 'process',
    labelZh: '进程感知',
    labelEn: 'Process',
    descZh: '监控进程启动和退出，记录系统资源使用',
    descEn: 'Monitor process start/exit, record system resource usage',
    icon: <Activity className="w-4 h-4" />,
    riskLevel: 'low',
  },
  {
    key: 'camera',
    labelZh: '摄像头感知',
    labelEn: 'Camera',
    descZh: '通过摄像头检测人体存在、手势和环境光线',
    descEn: 'Detect human presence, gestures and ambient light via camera',
    icon: <Eye className="w-4 h-4" />,
    riskLevel: 'high',
  },
]

/** 风险等级颜色 */
const RISK_COLORS: Record<ChannelConfig['riskLevel'], string> = {
  low: 'text-emerald-500',
  medium: 'text-amber-500',
  high: 'text-red-500',
}

/** 预测统计类型 */
interface PredictionStats {
  total: number
  hit: number
  hitRate: number
  accepted: number
  rejected: number
  ignored: number
  acceptRate: number
  days: number
}

export function PerceptionSettingsPanel({ language }: PerceptionSettingsPanelProps) {
  const isZh = language === 'zh'
  // 套餐能力拦截：感知预测为高级能力，未解锁时禁止开启
  const { requireFeature } = useFeatureGuard()

  // 配置状态（阶段2 扩展：enablePrediction / confidenceThreshold / predictionIntervalSec）
  const [config, setConfig] = useState<{
    enablePerception: boolean
    enablePrediction: boolean
    channels: Record<string, boolean>
    retentionDays: number
    privacyMode: boolean
    cloudFallback: boolean
    saveScreenshots: boolean
    confidenceThreshold: number
    predictionIntervalSec: number
  }>({
    enablePerception: false,
    enablePrediction: false,
    channels: { screen: false, voice: false, file: true, process: true, camera: false },
    retentionDays: 30,
    privacyMode: false,
    cloudFallback: false,
    saveScreenshots: false,
    confidenceThreshold: 0.4,
    predictionIntervalSec: 120,
  })

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [stats, setStats] = useState<{ totalScenes: number; totalBehaviors: number } | null>(null)
  const [predictionStats, setPredictionStats] = useState<PredictionStats | null>(null)
  const [showTimelineView, setShowTimelineView] = useState(false)
  const [showImpactView, setShowImpactView] = useState(false)
  const [showMonitorView, setShowMonitorView] = useState(false)
  const [showCameraView, setShowCameraView] = useState(false)
  const [showFusionView, setShowFusionView] = useState(false)

  /** 加载配置 */
  const loadConfig = useCallback(async () => {
    try {
      const result = await window.electronAPI.perception.getPrivacyConfig()
      if (result.success && result.data) {
        const data = result.data as Record<string, unknown>
        setConfig({
          enablePerception: Boolean(data.enablePerception),
          enablePrediction: Boolean(data.enablePrediction ?? false),
          channels: (data.channels as Record<string, boolean>) ?? config.channels,
          retentionDays: Number(data.retentionDays ?? 30),
          privacyMode: Boolean(data.privacyMode),
          cloudFallback: Boolean(data.cloudFallback),
          saveScreenshots: Boolean(data.saveScreenshots),
          confidenceThreshold: Number(data.confidenceThreshold ?? 0.4),
          predictionIntervalSec: Number(data.predictionIntervalSec ?? 120),
        })
      }
    } catch (e) {
      logger.settings.error('Failed to load perception config:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  /** 加载统计 */
  const loadStats = useCallback(async () => {
    try {
      const result = await window.electronAPI.perception.getRecentScenes(1000)
      if (result.success && result.data) {
        setStats({ totalScenes: (result.data as unknown[]).length, totalBehaviors: 0 })
      }
    } catch (e) {
      logger.settings.error('Failed to load perception stats:', e)
    }
  }, [])

  /** 加载预测命中率统计（阶段2 新增） */
  const loadPredictionStats = useCallback(async () => {
    try {
      const res = await window.electronAPI.perception.getPredictionStats()
      if (res?.success && res.data) {
        setPredictionStats(res.data as PredictionStats)
      }
    } catch (e) {
      logger.settings.error('Failed to load prediction stats:', e)
    }
  }, [])

  useEffect(() => {
    loadConfig()
    loadStats()
    loadPredictionStats()
  }, [loadConfig, loadStats, loadPredictionStats])

  /** 更新配置项 */
  const updateConfig = useCallback(async (updates: Partial<typeof config>) => {
    const newConfig = { ...config, ...updates }
    setConfig(newConfig)
    setSaving(true)
    try {
      await window.electronAPI.perception.updatePrivacyConfig(updates)
    } catch (e) {
      logger.settings.error('Failed to update perception config:', e)
    } finally {
      setSaving(false)
    }
  }, [config])

  /** 切换通道开关 */
  const toggleChannel = useCallback((channelKey: string, enabled: boolean) => {
    updateConfig({
      channels: { ...config.channels, [channelKey]: enabled },
    })
  }, [config.channels, updateConfig])

  /** 清空所有数据 */
  const handleClearData = useCallback(async () => {
    if (!confirm(isZh ? '确定要清空所有感知数据吗？此操作不可撤销。' : 'Clear all perception data? This cannot be undone.')) {
      return
    }
    try {
      await window.electronAPI.perception.clearAllData()
      await loadStats()
      await loadPredictionStats()
    } catch (e) {
      logger.settings.error('Failed to clear perception data:', e)
    }
  }, [isZh, loadStats, loadPredictionStats])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      {/* 顶部说明 */}
      <div className="p-5 bg-violet-500/10 border border-violet-500/20 rounded-2xl flex items-start gap-4 shadow-sm">
        <div className="p-2 bg-violet-500/10 rounded-lg shrink-0">
          <Eye className="w-5 h-5 text-violet-500" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-bold text-violet-500 mb-1 tracking-tight">
            {isZh ? '物理感知与预测' : 'Physical Perception & Prediction'}
          </h3>
          <p className="text-xs text-text-secondary leading-relaxed opacity-90">
            {isZh
              ? '让 AI 持续感知屏幕、语音、文件等物理状态，基于历史行为模式预测您的下一步操作。所有数据本地存储，保护隐私。'
              : 'Let AI continuously perceive screen, voice, file and other physical states, predict your next action based on historical patterns. All data stored locally for privacy.'}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          {saving && (
            <div className="text-[12px] text-text-muted flex items-center gap-1.5">
              <div className="w-3 h-3 border border-accent border-t-transparent rounded-full animate-spin" />
              {isZh ? '保存中' : 'Saving'}
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowMonitorView(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-red-500/15 text-red-500 border border-red-500/30 hover:bg-red-500/25 transition-all"
              title={t('monitoring.viewMonitorDesc', language)}
            >
              <Gauge className="w-3.5 h-3.5" />
              {t('monitoring.viewMonitor', language)}
            </button>
            <button
              onClick={() => setShowCameraView(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-fuchsia-500/15 text-fuchsia-500 border border-fuchsia-500/30 hover:bg-fuchsia-500/25 transition-all"
              title={t('camera.viewCameraDesc', language)}
            >
              <Camera className="w-3.5 h-3.5" />
              {t('camera.viewCamera', language)}
            </button>
            <button
              onClick={() => setShowTimelineView(true)}
              disabled={!config.enablePerception}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-violet-500/15 text-violet-500 border border-violet-500/30 hover:bg-violet-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              title={t('perception.timeline.viewTimelineDesc', language)}
            >
              <Calendar className="w-3.5 h-3.5" />
              {t('perception.timeline.viewTimeline', language)}
            </button>
            <button
              onClick={() => setShowImpactView(true)}
              disabled={!config.enablePerception}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-cyan-500/15 text-cyan-500 border border-cyan-500/30 hover:bg-cyan-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              title={t('perception.impact.viewImpactDesc', language)}
            >
              <Network className="w-3.5 h-3.5" />
              {t('perception.impact.viewImpact', language)}
            </button>
            <button
              onClick={() => setShowFusionView(true)}
              disabled={!config.enablePerception}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-amber-500/15 text-amber-500 border border-amber-500/30 hover:bg-amber-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              title={t('fusion.viewFusionDesc', language)}
            >
              <Layers className="w-3.5 h-3.5" />
              {t('fusion.viewFusion', language)}
            </button>
          </div>
        </div>
      </div>

      {/* 全局开关 */}
      <section className="space-y-4 p-6 bg-surface/20 backdrop-blur-md rounded-2xl border border-border shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-accent/10 rounded-lg">
              <Activity className="w-4 h-4 text-accent" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-text-primary">
                {isZh ? '启用感知能力' : 'Enable Perception'}
              </h4>
              <p className="text-[12px] text-text-muted mt-0.5">
                {isZh ? '主开关，关闭后所有感知通道都将停止' : 'Master switch, all channels stop when off'}
              </p>
            </div>
          </div>
          <ToggleSwitch
            checked={config.enablePerception}
            onChange={async (e) => {
              // 套餐能力拦截：开启前校验（感知预测为高级能力）
              if (e.target.checked && !(await requireFeature('perception'))) return
              updateConfig({ enablePerception: e.target.checked })
            }}
          />
        </div>

        {/* 隐私模式 */}
        <div className="pt-4 border-t border-border/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-500/10 rounded-lg">
                <Shield className="w-4 h-4 text-emerald-500" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-text-primary">
                  {isZh ? '隐私模式' : 'Privacy Mode'}
                </h4>
                <p className="text-[12px] text-text-muted mt-0.5">
                  {isZh
                    ? '不保存任何感知数据，只在内存中做实时推理'
                    : 'Do not persist any data, only real-time inference in memory'}
                </p>
              </div>
            </div>
            <ToggleSwitch
              checked={config.privacyMode}
              onChange={(e) => updateConfig({ privacyMode: e.target.checked })}
            />
          </div>
        </div>
      </section>

      {/* 感知通道 */}
      <section className="space-y-3 p-6 bg-surface/20 backdrop-blur-md rounded-2xl border border-border shadow-sm">
        <h4 className="text-[12px] font-bold text-text-muted uppercase tracking-widest opacity-60 ml-1 mb-3">
          {isZh ? '感知通道' : 'Perception Channels'}
        </h4>
        {CHANNELS.map(channel => {
          const enabled = config.channels[channel.key] ?? false
          return (
            <div
              key={channel.key}
              className={`flex items-center justify-between p-3 rounded-xl border transition-all ${
                enabled
                  ? 'border-accent/30 bg-accent/5'
                  : 'border-border/40 bg-surface/30'
              }`}
            >
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <div className={`p-1.5 rounded-md ${enabled ? 'bg-accent/10' : 'bg-text-muted/10'}`}>
                  {channel.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-text-primary">
                      {isZh ? channel.labelZh : channel.labelEn}
                    </span>
                    <span className={`text-[10px] uppercase font-bold ${RISK_COLORS[channel.riskLevel]}`}>
                      {channel.riskLevel}
                    </span>
                  </div>
                  <p className="text-[12px] text-text-muted mt-0.5 leading-relaxed">
                    {isZh ? channel.descZh : channel.descEn}
                  </p>
                </div>
              </div>
              <ToggleSwitch
                checked={enabled}
                onChange={(e) => toggleChannel(channel.key, e.target.checked)}
                disabled={!config.enablePerception}
              />
            </div>
          )
        })}
      </section>

      {/* 数据保留与存储 */}
      <section className="space-y-4 p-6 bg-surface/20 backdrop-blur-md rounded-2xl border border-border shadow-sm">
        <h4 className="text-[12px] font-bold text-text-muted uppercase tracking-widest opacity-60 ml-1">
          {isZh ? '数据保留与存储' : 'Data Retention & Storage'}
        </h4>

        {/* 保留期 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Clock className="w-4 h-4 text-text-muted" />
            <div>
              <span className="text-sm font-medium text-text-primary">
                {isZh ? '数据保留期' : 'Retention Period'}
              </span>
              <p className="text-[12px] text-text-muted mt-0.5">
                {isZh ? '超过保留期的数据会自动清理' : 'Data older than retention period is auto-cleaned'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={365}
              value={config.retentionDays}
              onChange={(e) => updateConfig({ retentionDays: Math.max(1, Math.min(365, Number(e.target.value))) })}
              className="w-20 px-2 py-1 text-sm bg-surface border border-border rounded-md text-text-primary focus:outline-none focus:border-accent"
            />
            <span className="text-[12px] text-text-muted">
              {isZh ? '天' : 'days'}
            </span>
          </div>
        </div>

        {/* 保存截图 */}
        <div className="pt-4 border-t border-border/50 flex items-center justify-between">
          <div className="flex items-start gap-3">
            <EyeOff className="w-4 h-4 text-text-muted mt-0.5" />
            <div>
              <span className="text-sm font-medium text-text-primary">
                {isZh ? '保存截图原始数据' : 'Save Screenshot Data'}
              </span>
              <p className="text-[12px] text-text-muted mt-0.5">
                {isZh
                  ? '默认关闭以节省磁盘和保护隐私，只保存 OCR 文本摘要'
                  : 'Default off to save disk and protect privacy, only OCR text summary is saved'}
              </p>
            </div>
          </div>
          <ToggleSwitch
            checked={config.saveScreenshots}
            onChange={(e) => updateConfig({ saveScreenshots: e.target.checked })}
          />
        </div>

        {/* 云端兜底 */}
        <div className="pt-4 border-t border-border/50 flex items-center justify-between">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5" />
            <div>
              <span className="text-sm font-medium text-text-primary">
                {isZh ? '云端兜底' : 'Cloud Fallback'}
              </span>
              <p className="text-[12px] text-text-muted mt-0.5">
                {isZh
                  ? '本地模型无法处理时回退到云端（默认关闭，启用后部分数据会上传）'
                  : 'Fallback to cloud when local model cannot process (default off, enabling uploads some data)'}
              </p>
            </div>
          </div>
          <ToggleSwitch
            checked={config.cloudFallback}
            onChange={(e) => updateConfig({ cloudFallback: e.target.checked })}
          />
        </div>
      </section>

      {/* 阶段2：行为预测配置 */}
      <section className="space-y-4 p-6 bg-surface/20 backdrop-blur-md rounded-2xl border border-border shadow-sm">
        <h4 className="text-[12px] font-bold text-text-muted uppercase tracking-widest opacity-60 ml-1 mb-3 flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5" />
          {t('perception.settings.predictionSection', language)}
        </h4>

        {/* 行为预测开关 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-violet-500/10 rounded-lg">
              <Sparkles className="w-4 h-4 text-violet-500" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-text-primary">
                {t('perception.settings.enablePrediction', language)}
              </h4>
              <p className="text-[12px] text-text-muted mt-0.5">
                {t('perception.settings.enablePredictionDesc', language)}
              </p>
            </div>
          </div>
          <ToggleSwitch
            checked={config.enablePrediction}
            onChange={(e) => updateConfig({ enablePrediction: e.target.checked })}
            disabled={!config.enablePerception}
          />
        </div>

        {/* 置信度阈值 */}
        <div className="pt-4 border-t border-border/50">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <Target className="w-4 h-4 text-text-muted" />
              <div>
                <span className="text-sm font-medium text-text-primary">
                  {t('perception.settings.confidenceThreshold', language)}
                </span>
                <p className="text-[12px] text-text-muted mt-0.5">
                  {t('perception.settings.confidenceThresholdDesc', language)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={0.1}
                max={0.9}
                step={0.05}
                value={config.confidenceThreshold}
                onChange={(e) =>
                  updateConfig({ confidenceThreshold: Number(e.target.value) })
                }
                disabled={!config.enablePrediction}
                className="w-32 accent-violet-500"
              />
              <span className="text-[12px] font-mono text-text-primary w-10 text-right">
                {(config.confidenceThreshold * 100).toFixed(0)}%
              </span>
            </div>
          </div>
        </div>

        {/* 预测频率 */}
        <div className="pt-4 border-t border-border/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Clock className="w-4 h-4 text-text-muted" />
              <div>
                <span className="text-sm font-medium text-text-primary">
                  {t('perception.settings.predictionInterval', language)}
                </span>
                <p className="text-[12px] text-text-muted mt-0.5">
                  {t('perception.settings.predictionIntervalDesc', language)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={30}
                max={600}
                step={10}
                value={config.predictionIntervalSec}
                onChange={(e) =>
                  updateConfig({
                    predictionIntervalSec: Math.max(30, Math.min(600, Number(e.target.value))),
                  })
                }
                disabled={!config.enablePrediction}
                className="w-20 px-2 py-1 text-sm bg-surface border border-border rounded-md text-text-primary focus:outline-none focus:border-accent"
              />
              <span className="text-[12px] text-text-muted">
                {isZh ? '秒' : 'sec'}
              </span>
            </div>
          </div>
        </div>

        {/* 命中率统计 */}
        <div className="pt-4 border-t border-border/50">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-4 h-4 text-text-muted" />
            <span className="text-sm font-medium text-text-primary">
              {t('perception.settings.hitRateStats', language)}
            </span>
            {predictionStats && (
              <span className="text-[12px] text-text-muted">
                ({t('perception.settings.last30Days', language)})
              </span>
            )}
          </div>
          {predictionStats && predictionStats.total > 0 ? (
            <div className="grid grid-cols-3 gap-3">
              <StatCard
                label={t('perception.settings.totalPredictions', language)}
                value={String(predictionStats.total)}
              />
              <StatCard
                label={t('perception.settings.hitRate', language)}
                value={`${(predictionStats.hitRate * 100).toFixed(1)}%`}
                sub={`${predictionStats.hit} / ${predictionStats.total}`}
              />
              <StatCard
                label={t('perception.settings.accepted', language)}
                value={String(predictionStats.accepted)}
                sub={`${(predictionStats.acceptRate * 100).toFixed(1)}%`}
              />
              <StatCard
                label={t('perception.settings.rejected', language)}
                value={String(predictionStats.rejected)}
              />
              <StatCard
                label={t('perception.settings.ignored', language)}
                value={String(predictionStats.ignored)}
              />
              <StatCard
                label={t('perception.settings.hitCount', language)}
                value={String(predictionStats.hit)}
              />
            </div>
          ) : (
            <div className="text-[12px] text-text-muted text-center py-4">
              {t('perception.settings.noStats', language)}
            </div>
          )}
        </div>

        {/* 模型信息 */}
        <div className="pt-4 border-t border-border/50">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="w-3.5 h-3.5 text-text-muted" />
            <span className="text-[12px] font-bold text-text-muted uppercase tracking-widest opacity-60">
              {t('perception.settings.modelInfo', language)}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[12px]">
            <div className="flex items-center justify-between p-2 rounded-lg bg-surface/40 border border-border/40">
              <span className="text-text-muted">
                {t('perception.settings.embeddingModel', language)}
              </span>
              <span className="font-mono text-text-primary">all-MiniLM-L6-v2</span>
            </div>
            <div className="flex items-center justify-between p-2 rounded-lg bg-surface/40 border border-border/40">
              <span className="text-text-muted">
                {t('perception.settings.modelVersion', language)}
              </span>
              <span className="font-mono text-text-primary">v2.0.0</span>
            </div>
          </div>
        </div>
      </section>

      {/* 数据管理 */}
      <section className="space-y-4 p-6 bg-surface/20 backdrop-blur-md rounded-2xl border border-border shadow-sm">
        <h4 className="text-[12px] font-bold text-text-muted uppercase tracking-widest opacity-60 ml-1">
          {isZh ? '数据管理' : 'Data Management'}
        </h4>

        {/* 统计信息 */}
        {stats && (
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-xl bg-surface/40 border border-border/40">
              <div className="text-[12px] text-text-muted">{isZh ? '场景记录' : 'Scenes'}</div>
              <div className="text-lg font-bold text-text-primary mt-1">{stats.totalScenes}</div>
            </div>
            <div className="p-3 rounded-xl bg-surface/40 border border-border/40">
              <div className="text-[12px] text-text-muted">{isZh ? '行为记录' : 'Behaviors'}</div>
              <div className="text-lg font-bold text-text-primary mt-1">{stats.totalBehaviors}</div>
            </div>
          </div>
        )}

        {/* 清空数据 */}
        <button
          onClick={handleClearData}
          className="w-full flex items-center justify-center gap-2 p-3 rounded-xl border border-red-500/30 bg-red-500/5 text-red-500 hover:bg-red-500/10 transition-all text-sm font-medium"
        >
          <Trash2 className="w-4 h-4" />
          {isZh ? '清空所有感知数据' : 'Clear All Perception Data'}
        </button>
      </section>

      {/* 场景时间轴可视化弹窗 */}
      <SceneTimelineView
        isOpen={showTimelineView}
        onClose={() => setShowTimelineView(false)}
        language={language}
      />

      {/* 代码影响分析弹窗 */}
      <ImpactAnalysisView
        isOpen={showImpactView}
        onClose={() => setShowImpactView(false)}
        language={language}
      />

      {/* 系统监控面板弹窗 */}
      <SystemMonitorView
        isOpen={showMonitorView}
        onClose={() => setShowMonitorView(false)}
        language={language}
      />

      {/* 摄像头隐私控制弹窗（阶段3） */}
      <CameraPrivacyControl
        isOpen={showCameraView}
        onClose={() => setShowCameraView(false)}
        language={language}
      />

      {/* 融合环境上下文视图弹窗（阶段9） */}
      <FusionEnvironmentView
        isOpen={showFusionView}
        onClose={() => setShowFusionView(false)}
        language={language}
      />
    </div>
  )
}

// ============================================================
// 子组件：统计卡片
// ============================================================

interface StatCardProps {
  label: string
  value: string
  sub?: string
}

function StatCard({ label, value, sub }: StatCardProps) {
  return (
    <div className="p-3 rounded-xl bg-surface/40 border border-border/40">
      <div className="text-[12px] text-text-muted">{label}</div>
      <div className="text-lg font-bold text-text-primary mt-1">{value}</div>
      {sub && <div className="text-[12px] text-text-muted mt-0.5">{sub}</div>}
    </div>
  )
}
