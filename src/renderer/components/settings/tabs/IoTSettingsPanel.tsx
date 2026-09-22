/**
 * IoT 设置面板主组件
 *
 * 整合五个子视图：
 * - ProviderListPanel：Provider 列表 + CRUD + 连接管理
 * - EntityExplorerPanel：实体快照浏览 + 读数历史查询
 * - SensorFusionPanel：传感器融合配置 + 异常日志
 * - AutomationRulesPanel：自动化联动规则 CRUD
 * - PerformancePanel：Bridge 性能指标
 *
 * 设计原则：
 * - 每个子视图独立组件，便于维护
 * - Provider/Device/Entity/Rule CRUD 通过后端 API（backendApi）
 * - Bridge 连接管理通过 IPC（window.electronAPI.iot.*）
 * - SensorFusion 配置通过 IPC（window.electronAPI.sensorFusion.*）
 *
 * 启动前置条件由本组件统一检查并显式提示，避免「点击启动无反应」：
 * 1. 已登录账号（Bridge 需要登录态访问后端接口）
 * 2. 云端凭据已同步到主进程（登录后自动同步）
 * 3. 至少一个 Provider 依赖的协议适配器可用（HA/MQTT/BLE 内置，
 *    其他协议需安装对应协议插件）
 *
 * @module settings/tabs/IoTSettingsPanel
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Radio,
  RefreshCw,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
} from 'lucide-react'
import { type Language } from '@renderer/i18n'
import { logger } from '@shared/toolkit/LogEngine'
import { backendApi } from '@renderer/adapters/backendApi'
import { toast } from '@components/foundation/NotificationProvider'
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

/** 启动前置条件项 */
interface Prerequisite {
  key: string
  label: string
  detail: string
  /** true 满足；false 未满足；null 尚未确认 */
  ok: boolean | null
  /** 未满足时是否阻止启动 */
  blocking: boolean
}

/**
 * IoT 设置面板
 *
 * 顶部为说明卡片 + Bridge 启停，下方 Tab 切换子视图。
 * Provider 连接状态会同步到 EntityExplorerPanel 以决定是否显示实时快照。
 */
export function IoTSettingsPanel({ language }: IoTSettingsPanelProps) {
  const isZh = language === 'zh'
  // 套餐能力拦截：IoT 集成为高级能力，未解锁时禁止启动 Bridge
  const { requireFeature, isAuthenticated } = useFeatureGuard()

  const [activeView, setActiveView] = useState<SubView>('providers')
  const [bridgeRunning, setBridgeRunning] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [toggling, setToggling] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)

  /** Provider 协议列表（用于前置条件检查） */
  const [providerProtocols, setProviderProtocols] = useState<string[]>([])
  /** 各协议的适配器是否已注册 */
  const [adapterStatus, setAdapterStatus] = useState<Record<string, boolean>>({})

  /** 查询 Bridge 运行状态 */
  const refreshBridgeStatus = useCallback(async () => {
    try {
      const result = await window.electronAPI.iot.isRunning()
      if (result.success && typeof result.data === 'boolean') {
        setBridgeRunning(result.data)
      } else if (!result.success) {
        logger.settings?.error('Query IoT Bridge status failed:', result.error)
      }
    } catch (e) {
      logger.settings?.error('Failed to query IoT Bridge status:', e)
    }
  }, [])

  /** 加载前置条件所需数据：Provider 协议 + 协议适配器状态 */
  const loadPrerequisites = useCallback(async () => {
    if (!isAuthenticated) {
      setProviderProtocols([])
      setAdapterStatus({})
      return
    }
    try {
      const result = await backendApi.get<{ items?: unknown[] } | unknown[]>(
        '/api/v1/iot/providers',
      )
      const list = Array.isArray(result) ? result : result?.items ?? []
      const protocols = Array.from(
        new Set(
          (list as Array<{ protocol?: string }>)
            .map((p) => p.protocol)
            .filter((p): p is string => typeof p === 'string'),
        ),
      )
      setProviderProtocols(protocols)

      const status: Record<string, boolean> = {}
      await Promise.all(
        protocols.map(async (protocol) => {
          const res = await window.electronAPI.iot.hasAdapter(
            protocol as 'homeassistant' | 'mqtt' | 'ble' | 'custom',
          )
          status[protocol] = res.success ? !!res.data : false
        }),
      )
      setAdapterStatus(status)
    } catch (e) {
      logger.settings?.warn('Failed to load IoT prerequisites:', e)
    }
  }, [isAuthenticated])

  useEffect(() => {
    void refreshBridgeStatus()
  }, [refreshBridgeStatus])

  useEffect(() => {
    void loadPrerequisites()
  }, [loadPrerequisites, refreshKey])

  /** 未注册适配器的协议（如自定义协议未安装对应插件） */
  const protocolsWithoutAdapter = useMemo(
    () => providerProtocols.filter((p) => adapterStatus[p] === false),
    [providerProtocols, adapterStatus],
  )

  /** 启动前置条件清单 */
  const prerequisites = useMemo<Prerequisite[]>(() => {
    const items: Prerequisite[] = [
      {
        key: 'login',
        label: isZh ? '已登录 AweeClaw 账号' : 'Signed in to AweeClaw',
        detail: isZh
          ? 'Bridge 需要登录态访问云端 Provider 配置与读数接口'
          : 'The Bridge uses your session to reach provider config and reading APIs',
        ok: isAuthenticated,
        blocking: true,
      },
      {
        key: 'provider',
        label: isZh ? '已创建至少一个 Provider' : 'At least one provider created',
        detail: isZh
          ? '在下方「Provider 管理」中新增 Home Assistant / MQTT 等连接'
          : 'Add a Home Assistant / MQTT connection in the Providers tab below',
        ok: providerProtocols.length > 0,
        blocking: false,
      },
    ]

    if (providerProtocols.length > 0) {
      items.push({
        key: 'adapter',
        label: isZh ? '协议适配器可用' : 'Protocol adapters available',
        detail:
          protocolsWithoutAdapter.length > 0
            ? isZh
              ? `协议 ${protocolsWithoutAdapter.join('、')} 未注册适配器，请安装对应协议插件（内置协议 Home Assistant / MQTT / BLE 无需安装）`
              : `No adapter registered for ${protocolsWithoutAdapter.join(', ')} — install the matching protocol plugin (built-in: Home Assistant / MQTT / BLE)`
            : isZh
              ? '内置协议（Home Assistant / MQTT / BLE）随时可用，无需安装插件'
              : 'Built-in protocols (Home Assistant / MQTT / BLE) are always available',
        ok: protocolsWithoutAdapter.length === 0,
        blocking: false,
      })
    }

    return items
  }, [
    isAuthenticated,
    providerProtocols,
    protocolsWithoutAdapter,
    isZh,
  ])

  /** 未满足的前置条件（用于提示区展示） */
  const unmetPrerequisites = prerequisites.filter((p) => p.ok === false)

  /** 处理 Bridge 启动/停止 */
  const handleToggleBridge = useCallback(async () => {
    if (toggling) return
    setErrorText(null)

    // ─── 停止 ───
    if (bridgeRunning) {
      setToggling(true)
      try {
        const result = await window.electronAPI.iot.stop()
        if (!result.success) {
          const msg = result.error || (isZh ? '停止失败' : 'Failed to stop')
          setErrorText(msg)
          toast.error(isZh ? '停止 Bridge 失败' : 'Failed to stop Bridge', msg)
          return
        }
        await refreshBridgeStatus()
        setRefreshKey((k) => k + 1)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        setErrorText(msg)
        toast.error(isZh ? '停止 Bridge 失败' : 'Failed to stop Bridge', msg)
      } finally {
        setToggling(false)
      }
      return
    }

    // ─── 启动 ───
    // 1. 套餐能力拦截（IoT 集成为高级能力）
    if (!(await requireFeature('iot'))) return

    // 2. 登录态校验：未登录时主进程无法访问后端接口
    if (!isAuthenticated) {
      const msg = isZh
        ? '请先登录 AweeClaw 账号后再启动 Bridge'
        : 'Sign in to your AweeClaw account before starting the Bridge'
      setErrorText(msg)
      toast.warning(isZh ? '无法启动 Bridge' : 'Cannot start Bridge', msg)
      return
    }

    setToggling(true)
    try {
      const result = await window.electronAPI.iot.start()
      if (!result.success) {
        const msg = result.error || (isZh ? '启动失败' : 'Failed to start')
        setErrorText(msg)
        toast.error(isZh ? '启动 Bridge 失败' : 'Failed to start Bridge', msg)
        return
      }
      // 刷新前置条件：Bridge 状态与适配器可用性都可能随之变化
      await loadPrerequisites()
      await refreshBridgeStatus()
      setRefreshKey((k) => k + 1)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setErrorText(msg)
      toast.error(isZh ? '启动 Bridge 失败' : 'Failed to start Bridge', msg)
    } finally {
      setToggling(false)
    }
  }, [
    bridgeRunning,
    toggling,
    isZh,
    isAuthenticated,
    requireFeature,
    refreshBridgeStatus,
    loadPrerequisites,
  ])

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
            disabled={toggling}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-all disabled:opacity-60 disabled:cursor-not-allowed ${
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
            {toggling && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
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

      {/* 启动条件与失败原因 */}
      {!bridgeRunning && (errorText || unmetPrerequisites.length > 0) && (
        <div className="p-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 space-y-3">
          {errorText && (
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <div className="flex-1 space-y-1">
                <h4 className="text-[13px] font-semibold text-amber-500">
                  {isZh ? 'Bridge 启动失败' : 'Bridge failed to start'}
                </h4>
                <p className="text-[12px] text-text-secondary break-all">
                  {errorText}
                </p>
              </div>
            </div>
          )}
          <ul className="space-y-2 pl-7">
            {prerequisites.map((item) => (
              <li key={item.key} className="flex items-start gap-2 text-[12px]">
                {item.ok ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                ) : (
                  <XCircle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                )}
                <span className="flex-1">
                  <span
                    className={
                      item.ok
                        ? 'text-text-secondary'
                        : 'text-text-primary font-medium'
                    }
                  >
                    {item.label}
                  </span>
                  <span className="block text-text-muted mt-0.5">
                    {item.detail}
                  </span>
                </span>
                {item.blocking && !item.ok && (
                  <span className="shrink-0 px-1.5 py-0.5 rounded text-[11px] bg-red-500/10 text-red-500 border border-red-500/20">
                    {isZh ? '必须' : 'Required'}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

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
