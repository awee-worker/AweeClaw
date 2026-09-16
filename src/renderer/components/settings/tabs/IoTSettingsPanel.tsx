/**
 * IoT 设置面板主组件
 *
 * 整合四个子视图：
 * - ProviderListPanel：Provider 列表 + CRUD + 连接管理
 * - EntityExplorerPanel：实体快照浏览 + 读数历史查询
 * - SensorFusionPanel：传感器融合配置 + 异常日志
 * - AutomationRulesPanel：自动化联动规则 CRUD（阶段8 s8-02）
 *
 * 设计原则：
 * - 每个子视图独立组件，便于维护
 * - Provider/Device/Entity/Rule CRUD 通过后端 API（backendApi）
 * - Bridge 连接管理通过 IPC（window.electronAPI.iot.*）
 * - SensorFusion 配置通过 IPC（window.electronAPI.sensorFusion.*）
 *
 * @module settings/tabs/IoTSettingsPanel
 */

import { useState, useEffect, useCallback } from 'react'
import { Radio, RefreshCw } from 'lucide-react'
import { type Language } from '@renderer/i18n'
import { logger } from '@shared/toolkit/LogEngine'
import { useFeatureGuard } from '@hooks/useFeatureGuard'
import { ProviderListPanel } from './iot/ProviderListPanel'
import { EntityExplorerPanel } from './iot/EntityExplorerPanel'
import { SensorFusionPanel } from './iot/SensorFusionPanel'
import { AutomationRulesPanel } from './iot/AutomationRulesPanel'
import { PerformancePanel } from './iot/PerformancePanel'

interface IoTSettingsPanelProps {
  language: Language
}

/** 子视图类型 */
type SubView = 'providers' | 'entities' | 'fusion' | 'rules' | 'performance'

/**
 * IoT 设置面板
 *
 * 顶部为说明卡片，下方 Tab 切换三个子视图。
 * Provider 连接状态会同步到 EntityExplorerPanel 以决定是否显示实时快照。
 */
export function IoTSettingsPanel({ language }: IoTSettingsPanelProps) {
  const isZh = language === 'zh'
  // 套餐能力拦截：IoT 集成为高级能力，未解锁时禁止启动 Bridge
  const { requireFeature } = useFeatureGuard()

  const [activeView, setActiveView] = useState<SubView>('providers')
  const [bridgeRunning, setBridgeRunning] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  /** 查询 Bridge 运行状态 */
  const refreshBridgeStatus = useCallback(async () => {
    try {
      const result = await window.electronAPI.iot.isRunning()
      if (result.success && typeof result.data === 'boolean') {
        setBridgeRunning(result.data)
      }
    } catch (e) {
      logger.settings?.error('Failed to query IoT Bridge status:', e)
    }
  }, [])

  useEffect(() => {
    refreshBridgeStatus()
  }, [refreshBridgeStatus])

  /** 处理 Bridge 启动/停止 */
  const handleToggleBridge = useCallback(async () => {
    // 套餐能力拦截：启动前校验（IoT 集成为高级能力）
    if (!bridgeRunning && !(await requireFeature('iot'))) return
    try {
      if (bridgeRunning) {
        await window.electronAPI.iot.stop()
      } else {
        await window.electronAPI.iot.start()
      }
      await refreshBridgeStatus()
      setRefreshKey((k) => k + 1)
    } catch (e) {
      logger.settings?.error('Failed to toggle IoT Bridge:', e)
    }
  }, [bridgeRunning, refreshBridgeStatus, requireFeature])

  /** 刷新所有子视图 */
  const handleRefreshAll = useCallback(() => {
    setRefreshKey((k) => k + 1)
  }, [])

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      {/* 顶部说明卡片 */}
      <div className="p-5 bg-teal-500/10 border border-teal-500/20 rounded-2xl flex items-start gap-4 shadow-sm">
        <div className="p-2 bg-teal-500/10 rounded-lg shrink-0">
          <Radio className="w-5 h-5 text-teal-500" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-bold text-teal-500 mb-1 tracking-tight">
            {isZh ? 'IoT 设备集成' : 'IoT Integration'}
          </h3>
          <p className="text-xs text-text-secondary leading-relaxed opacity-90">
            {isZh
              ? '连接 Home Assistant / MQTT 等 IoT 平台，订阅传感器实时数据。融合分析将异常事件联动到因果推理与监控服务，构建完整的物理感知能力。'
              : 'Connect to IoT platforms (Home Assistant / MQTT), subscribe to real-time sensor data. Fusion analysis links anomaly events to causal reasoning and monitoring services for complete physical perception.'}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <button
            onClick={handleToggleBridge}
            className={`px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-all ${
              bridgeRunning
                ? 'bg-red-500/15 text-red-500 border-red-500/30 hover:bg-red-500/25'
                : 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30 hover:bg-emerald-500/25'
            }`}
            title={
              bridgeRunning
                ? isZh
                  ? '停止 Bridge'
                  : 'Stop Bridge'
                : isZh
                ? '启动 Bridge'
                : 'Start Bridge'
            }
          >
            {bridgeRunning
              ? isZh
                ? '运行中 · 点击停止'
                : 'Running · Click to stop'
              : isZh
              ? '已停止 · 点击启动'
              : 'Stopped · Click to start'}
          </button>
          <button
            onClick={handleRefreshAll}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-surface/40 text-text-secondary border border-border/40 hover:bg-surface-hover transition-all"
            title={isZh ? '刷新所有数据' : 'Refresh all'}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            {isZh ? '刷新' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Tab 切换 */}
      <div className="flex items-center gap-1 p-1 bg-surface/40 rounded-xl border border-border/40 w-fit">
        {(
          [
            {
              key: 'providers' as const,
              label: isZh ? 'Provider 管理' : 'Providers',
            },
            {
              key: 'entities' as const,
              label: isZh ? '实体浏览' : 'Entities',
            },
            {
              key: 'fusion' as const,
              label: isZh ? '数据融合' : 'Fusion',
            },
            {
              key: 'rules' as const,
              label: isZh ? '联动规则' : 'Rules',
            },
            {
              key: 'performance' as const,
              label: isZh ? '性能指标' : 'Performance',
            },
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

      {/* 子视图内容 */}
      <div className="bg-surface/20 backdrop-blur-md rounded-2xl border border-border shadow-sm overflow-hidden">
        {activeView === 'providers' && (
          <ProviderListPanel
            language={language}
            refreshKey={refreshKey}
            bridgeRunning={bridgeRunning}
            onBridgeChanged={refreshBridgeStatus}
          />
        )}
        {activeView === 'entities' && (
          <EntityExplorerPanel
            language={language}
            refreshKey={refreshKey}
            bridgeRunning={bridgeRunning}
          />
        )}
        {activeView === 'fusion' && (
          <SensorFusionPanel language={language} refreshKey={refreshKey} />
        )}
        {activeView === 'rules' && (
          <AutomationRulesPanel language={language} refreshKey={refreshKey} />
        )}
        {activeView === 'performance' && (
          <PerformancePanel language={language} refreshKey={refreshKey} />
        )}
      </div>
    </div>
  )
}
