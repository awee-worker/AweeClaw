/**
 * 因果推理设置面板
 *
 * 控制 AweeClaw 的因果推理能力：
 * - 全局开关与配置（数据保留期、节点上限、抽取置信度）
 * - 因果图管理（节点/边 CRUD，环检测，DAG 验证）
 * - 断言审核（pending → approved/rejected/merged）
 * - 反事实查询（do(X) 干预查询 + 反事实推理）
 * - 数据管理（统计、清空）
 *
 * 设计原则：
 * - 每个功能区域拆分为独立子组件，便于维护
 * - 所有数据本地化处理，云端上报需用户显式开启
 * - 完善的事件处理、状态管理、边界判断
 *
 * @module settings/tabs/CausalReasoningPanel
 */

import { useState, useEffect, useCallback } from 'react'
import { Network, Shield, Activity, Database, GitBranch, Sparkles, Trash2, RefreshCw } from 'lucide-react'
import { ToggleSwitch } from '@components/ui'
import { type Language } from '@renderer/i18n'
import { logger } from '@shared/toolkit/LogEngine'
import { CausalGraphView } from './causal/CausalGraphView'
import { AssertionReviewView } from './causal/AssertionReviewView'
import { CounterfactualQueryView } from './causal/CounterfactualQueryView'

interface CausalReasoningPanelProps {
  language: Language
}

/** 因果推理配置 */
interface CausalConfig {
  enabled: boolean
  autoExtractionEnabled: boolean
  cloudReportingEnabled: boolean
  extractionMinConfidence: number
  counterfactualEnabled: boolean
  maxNodes: number
  retentionDays: number
}

/** 图统计信息 */
interface GraphStats {
  nodeCount: number
  edgeCount: number
  density: number
  componentCount: number
  avgOutDegree: number
  avgInDegree: number
  hasCycle: boolean
}

/** 默认配置 */
const DEFAULT_CONFIG: CausalConfig = {
  enabled: false,
  autoExtractionEnabled: false,
  cloudReportingEnabled: false,
  extractionMinConfidence: 0.6,
  counterfactualEnabled: true,
  maxNodes: 500,
  retentionDays: 90,
}

/** Tab 视图类型 */
type ViewType = 'graph' | 'assertions' | 'counterfactual'

export function CausalReasoningPanel({ language }: CausalReasoningPanelProps) {
  const isZh = language === 'zh'

  // 配置状态
  const [config, setConfig] = useState<CausalConfig>(DEFAULT_CONFIG)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [stats, setStats] = useState<GraphStats | null>(null)

  // 当前视图
  const [activeView, setActiveView] = useState<ViewType>('graph')

  /** 加载配置 */
  const loadConfig = useCallback(async () => {
    try {
      const result = await window.electronAPI.causal.getConfig()
      if (result.success && result.data) {
        const data = result.data
        setConfig({
          enabled: data.enabled,
          autoExtractionEnabled: data.autoExtractionEnabled,
          cloudReportingEnabled: data.cloudReportingEnabled,
          extractionMinConfidence: data.extractionMinConfidence,
          counterfactualEnabled: data.counterfactualEnabled,
          maxNodes: data.maxNodes,
          retentionDays: data.retentionDays,
        })
      }
    } catch (e) {
      logger.settings?.error('Failed to load causal config:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  /** 加载统计 */
  const loadStats = useCallback(async () => {
    try {
      const result = await window.electronAPI.causal.getStats()
      if (result.success && result.data) {
        setStats(result.data as GraphStats)
      }
    } catch (e) {
      logger.settings?.error('Failed to load causal stats:', e)
    }
  }, [])

  useEffect(() => {
    loadConfig()
    loadStats()
  }, [loadConfig, loadStats])

  /** 更新配置项 */
  const updateConfig = useCallback(
    async (updates: Partial<CausalConfig>) => {
      const newConfig = { ...config, ...updates }
      setConfig(newConfig)
      setSaving(true)
      try {
        await window.electronAPI.causal.updateConfig(updates)
      } catch (e) {
        logger.settings?.error('Failed to update causal config:', e)
      } finally {
        setSaving(false)
      }
    },
    [config],
  )

  /** 清空所有数据 */
  const handleClearData = useCallback(async () => {
    if (!confirm(
      isZh ? '确定要清空所有因果推理数据吗？此操作不可撤销。' : 'Clear all causal reasoning data? This cannot be undone.'
    )) {
      return
    }
    try {
      await window.electronAPI.causal.clearAllData()
      await loadStats()
    } catch (e) {
      logger.settings?.error('Failed to clear causal data:', e)
    }
  }, [isZh, loadStats])

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
      <div className="p-5 bg-purple-500/10 border border-purple-500/20 rounded-2xl flex items-start gap-4 shadow-sm">
        <div className="p-2 bg-purple-500/10 rounded-lg shrink-0">
          <Network className="w-5 h-5 text-purple-500" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-bold text-purple-500 mb-1 tracking-tight">
            {isZh ? '因果推理引擎' : 'Causal Reasoning Engine'}
          </h3>
          <p className="text-xs text-text-secondary leading-relaxed opacity-90">
            {isZh
              ? '构建因果图、抽取因果关系断言、执行 do-calculus 干预查询与反事实推理。基于 Pearl 因果框架，让 AI 具备因果推断能力。所有数据本地存储，保护隐私。'
              : 'Build causal graphs, extract causal assertions, perform do-calculus intervention queries and counterfactual reasoning. Based on Pearl causal framework, giving AI causal inference capabilities. All data stored locally for privacy.'}
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
              onClick={() => void loadStats()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-surface/40 text-text-secondary border border-border/40 hover:bg-surface-hover transition-all"
              title={isZh ? '刷新统计' : 'Refresh stats'}
            >
              <RefreshCw className="w-3.5 h-3.5" />
              {isZh ? '刷新' : 'Refresh'}
            </button>
            <button
              onClick={handleClearData}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-red-500/15 text-red-500 border border-red-500/30 hover:bg-red-500/25 transition-all"
              title={isZh ? '清空所有数据' : 'Clear all data'}
            >
              <Trash2 className="w-3.5 h-3.5" />
              {isZh ? '清空' : 'Clear'}
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
                {isZh ? '启用因果推理' : 'Enable Causal Reasoning'}
              </h4>
              <p className="text-[12px] text-text-muted mt-0.5">
                {isZh ? '主开关，关闭后所有因果推理功能停止' : 'Master switch, all features stop when off'}
              </p>
            </div>
          </div>
          <ToggleSwitch
            checked={config.enabled}
            onChange={(e) => updateConfig({ enabled: e.target.checked })}
          />
        </div>

        {/* 自动抽取 */}
        <div className="pt-4 border-t border-border/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-cyan-500/10 rounded-lg">
                <Sparkles className="w-4 h-4 text-cyan-500" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-text-primary">
                  {isZh ? '自动抽取断言' : 'Auto Extract Assertions'}
                </h4>
                <p className="text-[12px] text-text-muted mt-0.5">
                  {isZh ? '从事件流自动抽取因果断言（每 5 分钟）' : 'Auto extract assertions from event stream (every 5 min)'}
                </p>
              </div>
            </div>
            <ToggleSwitch
              checked={config.autoExtractionEnabled}
              onChange={(e) => updateConfig({ autoExtractionEnabled: e.target.checked })}
            />
          </div>
        </div>

        {/* 反事实查询 */}
        <div className="pt-4 border-t border-border/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-violet-500/10 rounded-lg">
                <GitBranch className="w-4 h-4 text-violet-500" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-text-primary">
                  {isZh ? '反事实查询' : 'Counterfactual Query'}
                </h4>
                <p className="text-[12px] text-text-muted mt-0.5">
                  {isZh ? '允许执行 do(X) 干预与反事实推理' : 'Allow do(X) intervention and counterfactual reasoning'}
                </p>
              </div>
            </div>
            <ToggleSwitch
              checked={config.counterfactualEnabled}
              onChange={(e) => updateConfig({ counterfactualEnabled: e.target.checked })}
            />
          </div>
        </div>

        {/* 云端上报 */}
        <div className="pt-4 border-t border-border/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-500/10 rounded-lg">
                <Shield className="w-4 h-4 text-amber-500" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-text-primary">
                  {isZh ? '云端上报' : 'Cloud Reporting'}
                </h4>
                <p className="text-[12px] text-text-muted mt-0.5">
                  {isZh ? '将因果图数据上报到云端（用于跨设备同步）' : 'Sync causal graph data to cloud (for cross-device sync)'}
                </p>
              </div>
            </div>
            <ToggleSwitch
              checked={config.cloudReportingEnabled}
              onChange={(e) => updateConfig({ cloudReportingEnabled: e.target.checked })}
            />
          </div>
        </div>
      </section>

      {/* 统计卡片 */}
      {stats && (
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            icon={<Network className="w-4 h-4" />}
            label={isZh ? '节点数' : 'Nodes'}
            value={String(stats.nodeCount)}
            color="purple"
          />
          <StatCard
            icon={<GitBranch className="w-4 h-4" />}
            label={isZh ? '边数' : 'Edges'}
            value={String(stats.edgeCount)}
            color="cyan"
          />
          <StatCard
            icon={<Activity className="w-4 h-4" />}
            label={isZh ? '连通分量' : 'Components'}
            value={String(stats.componentCount)}
            color="amber"
          />
          <StatCard
            icon={<Database className="w-4 h-4" />}
            label={isZh ? '图密度' : 'Density'}
            value={(stats.density * 100).toFixed(1) + '%'}
            color="emerald"
          />
        </section>
      )}

      {/* 参数配置 */}
      <section className="space-y-4 p-6 bg-surface/20 backdrop-blur-md rounded-2xl border border-border shadow-sm">
        <h4 className="text-sm font-bold text-text-primary">
          {isZh ? '高级配置' : 'Advanced Configuration'}
        </h4>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-[12px] font-medium text-text-secondary mb-2">
              {isZh ? '抽取最小置信度' : 'Extraction Min Confidence'}
            </label>
            <input
              type="number"
              min="0"
              max="1"
              step="0.1"
              value={config.extractionMinConfidence}
              onChange={(e) =>
                updateConfig({ extractionMinConfidence: parseFloat(e.target.value) || 0 })
              }
              className="w-full px-3 py-2 rounded-lg bg-surface/40 border border-border/40 text-sm text-text-primary focus:outline-none focus:border-accent/50"
            />
          </div>

          <div>
            <label className="block text-[12px] font-medium text-text-secondary mb-2">
              {isZh ? '最大节点数' : 'Max Nodes'}
            </label>
            <input
              type="number"
              min="10"
              max="5000"
              step="50"
              value={config.maxNodes}
              onChange={(e) =>
                updateConfig({ maxNodes: parseInt(e.target.value, 10) || 500 })
              }
              className="w-full px-3 py-2 rounded-lg bg-surface/40 border border-border/40 text-sm text-text-primary focus:outline-none focus:border-accent/50"
            />
          </div>

          <div>
            <label className="block text-[12px] font-medium text-text-secondary mb-2">
              {isZh ? '保留天数' : 'Retention Days'}
            </label>
            <input
              type="number"
              min="1"
              max="365"
              value={config.retentionDays}
              onChange={(e) =>
                updateConfig({ retentionDays: parseInt(e.target.value, 10) || 90 })
              }
              className="w-full px-3 py-2 rounded-lg bg-surface/40 border border-border/40 text-sm text-text-primary focus:outline-none focus:border-accent/50"
            />
          </div>
        </div>
      </section>

      {/* Tab 切换 */}
      <section className="space-y-4">
        <div className="flex items-center gap-1 p-1 bg-surface/40 rounded-xl border border-border/40 w-fit">
          {(
            [
              { key: 'graph' as const, label: isZh ? '因果图' : 'Graph' },
              { key: 'assertions' as const, label: isZh ? '断言审核' : 'Assertions' },
              { key: 'counterfactual' as const, label: isZh ? '反事实查询' : 'Counterfactual' },
            ]
          ).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveView(tab.key)}
              className={`px-4 py-1.5 rounded-lg text-[12px] font-medium transition-all ${
                activeView === tab.key
                  ? 'bg-accent text-white shadow-sm'
                  : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* 视图内容 */}
        <div className="bg-surface/20 backdrop-blur-md rounded-2xl border border-border shadow-sm overflow-hidden">
          {activeView === 'graph' && <CausalGraphView language={language} />}
          {activeView === 'assertions' && <AssertionReviewView language={language} />}
          {activeView === 'counterfactual' && <CounterfactualQueryView language={language} />}
        </div>
      </section>
    </div>
  )
}

/** 统计卡片子组件 */
function StatCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode
  label: string
  value: string
  color: 'purple' | 'cyan' | 'amber' | 'emerald'
}) {
  const colorClasses = {
    purple: 'bg-purple-500/10 text-purple-500',
    cyan: 'bg-cyan-500/10 text-cyan-500',
    amber: 'bg-amber-500/10 text-amber-500',
    emerald: 'bg-emerald-500/10 text-emerald-500',
  }
  return (
    <div className="p-4 rounded-xl bg-surface/30 border border-border/40 flex items-start gap-3">
      <div className={`p-2 rounded-lg ${colorClasses[color]}`}>{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-text-muted uppercase tracking-wider">{label}</div>
        <div className="text-lg font-bold text-text-primary mt-0.5 truncate">{value}</div>
      </div>
    </div>
  )
}
