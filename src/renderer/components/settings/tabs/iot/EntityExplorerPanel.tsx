/**
 * IoT 实体浏览面板
 *
 * 功能：
 * - 展示 Bridge 维护的实时实体快照（IPC iot.listEntitySnapshots）
 * - 支持按 Provider / 实体类型 / 关键字筛选
 * - 选中实体后展示最近读数历史（后端 GET /api/v1/iot/readings?entityId=xxx）
 * - 订阅 Bridge 事件实时刷新实体状态
 *
 * 数据流：
 * - 实时快照：IPC iot.listEntitySnapshots + onBridgeEvent 增量更新
 * - 历史读数：后端 REST API 查询
 *
 * @module settings/tabs/iot/EntityExplorerPanel
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { Loader2, Search, Activity, History } from 'lucide-react'
import { type Language, createTranslator } from '@renderer/i18n'
import { logger } from '@shared/toolkit/LogEngine'
import { backendApi } from '@renderer/adapters/backendApi'

interface EntityExplorerPanelProps {
  language: Language
  refreshKey: number
  bridgeRunning: boolean
}

/** 实体快照（来自 Bridge） */
interface EntitySnapshot {
  id: string
  deviceId: string
  externalId: string
  entityType: string
  deviceClass?: string | null
  unitOfMeasurement?: string | null
  state: string | number | boolean | null
  attributes: Record<string, unknown>
  lastStateChangedAt: number
}

/** 后端读数记录 */
interface SensorReading {
  id: string
  entityId: string
  value?: number
  stringValue?: string
  unit?: string
  source: string
  recordedAt: string
}

const ENTITY_TYPES = [
  'sensor',
  'binary_sensor',
  'switch',
  'light',
  'climate',
  'cover',
  'lock',
  'media_player',
  'device_tracker',
  'unknown',
] as const

/**
 * EntityExplorerPanel
 */
export function EntityExplorerPanel({
  language,
  refreshKey,
  bridgeRunning,
}: EntityExplorerPanelProps) {
  const t = createTranslator(language)
  const locale = language === 'zh' ? 'zh-CN' : 'en-US'

  const [snapshots, setSnapshots] = useState<EntitySnapshot[]>([])
  const [loading, setLoading] = useState(true)
  const [keyword, setKeyword] = useState('')
  const [typeFilter, setTypeFilter] = useState<string>('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [readings, setReadings] = useState<SensorReading[]>([])
  const [loadingReadings, setLoadingReadings] = useState(false)

  /** 实时事件订阅取消函数 */
  const unsubscribeRef = useRef<(() => void) | null>(null)

  /** 加载实体快照 */
  const loadSnapshots = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.electronAPI.iot.listEntitySnapshots()
      if (result.success && result.data) {
        setSnapshots(result.data as EntitySnapshot[])
      }
    } catch (e) {
      logger.settings?.error('Failed to load entity snapshots:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  /** 加载指定实体的历史读数 */
  const loadReadings = useCallback(async (entityId: string) => {
    setLoadingReadings(true)
    try {
      const result = await backendApi.get<{ items: SensorReading[] } | SensorReading[]>(
        `/api/v1/iot/readings?entityId=${encodeURIComponent(entityId)}&limit=100`,
      )
      const list = Array.isArray(result) ? result : result?.items ?? []
      setReadings(list)
    } catch (e) {
      logger.settings?.error('Failed to load readings:', e)
      setReadings([])
    } finally {
      setLoadingReadings(false)
    }
  }, [])

  /** 初始加载 + refreshKey 变化时重新加载 */
  useEffect(() => {
    void loadSnapshots()
  }, [loadSnapshots, refreshKey])

  /** 订阅 Bridge 事件实时更新 */
  useEffect(() => {
    if (!bridgeRunning) return
    const unsub = window.electronAPI.iot.onBridgeEvent((event) => {
      if (event.type === 'entity:update' && event.entity) {
        setSnapshots((prev) => {
          const idx = prev.findIndex((s) => s.id === event.entity!.entityId)
          if (idx === -1) return prev
          const updated = [...prev]
          updated[idx] = {
            ...updated[idx],
            state: event.entity!.state,
            attributes: event.entity!.attributes,
            lastStateChangedAt: event.entity!.timestamp,
          }
          return updated
        })
      }
    })
    unsubscribeRef.current = unsub
    return () => {
      unsub()
      unsubscribeRef.current = null
    }
  }, [bridgeRunning])

  /** 选中实体变化时加载历史读数 */
  useEffect(() => {
    if (selectedId) {
      void loadReadings(selectedId)
    } else {
      setReadings([])
    }
  }, [selectedId, loadReadings])

  /** 应用筛选 */
  const filteredSnapshots = snapshots.filter((s) => {
    if (typeFilter && s.entityType !== typeFilter) return false
    if (keyword) {
      const lower = keyword.toLowerCase()
      if (
        !s.externalId.toLowerCase().includes(lower) &&
        !String(s.state ?? '').toLowerCase().includes(lower)
      ) {
        return false
      }
    }
    return true
  })

  /** 格式化时间戳 */
  const formatTime = (ts: number | string) => {
    const date = typeof ts === 'string' ? new Date(ts) : new Date(ts)
    return date.toLocaleString(locale, {
      hour12: false,
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }

  return (
    <div className="p-6">
      <div className="mb-4">
        <h4 className="text-sm font-bold text-text-primary">
          {t('iot.entity.explorerTitle')}
        </h4>
        <p className="text-[12px] text-text-muted mt-1">
          {bridgeRunning
            ? t('iot.entity.explorerSubtitleOn', { count: snapshots.length })
            : t('iot.entity.explorerSubtitleOff')}
        </p>
      </div>

      {!bridgeRunning && (
        <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-500 text-[12px] mb-4">
          {t('iot.entity.bridgeNotRunningTip')}
        </div>
      )}

      {/* 筛选栏 */}
      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder={t('iot.entity.searchPlaceholder')}
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-surface/40 border border-border/40 text-sm text-text-primary focus:outline-none focus:border-accent/50"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="px-3 py-2 rounded-lg bg-surface/40 border border-border/40 text-sm text-text-primary focus:outline-none focus:border-accent/50"
        >
          <option value="">{t('iot.entity.allTypes')}</option>
          {ENTITY_TYPES.map((et) => (
            <option key={et} value={et}>
              {et}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="py-12 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-text-muted" />
        </div>
      ) : filteredSnapshots.length === 0 ? (
        <div className="py-12 text-center text-text-muted text-sm">
          {t('iot.entity.empty')}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* 实体列表 */}
          <div className="space-y-2 max-h-[480px] overflow-y-auto custom-scrollbar pr-2">
            {filteredSnapshots.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelectedId(s.id)}
                className={`w-full text-left p-3 rounded-lg border transition-all ${
                  selectedId === s.id
                    ? 'bg-accent/10 border-accent/30'
                    : 'bg-surface/30 border-border/40 hover:border-border/60'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-text-primary truncate">
                    {s.externalId}
                  </span>
                  <span className="px-2 py-0.5 rounded-md text-[12px] bg-surface/40 text-text-muted border border-border/40 shrink-0">
                    {s.entityType}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-1.5">
                  <Activity className="w-3 h-3 text-text-muted" />
                  <span className="text-[12px] text-text-secondary truncate">
                    {String(s.state ?? '-')}
                    {s.unitOfMeasurement ? ` ${s.unitOfMeasurement}` : ''}
                  </span>
                  <span className="text-[12px] text-text-muted ml-auto">
                    {formatTime(s.lastStateChangedAt)}
                  </span>
                </div>
              </button>
            ))}
          </div>

          {/* 实体详情 + 历史读数 */}
          <div className="bg-surface/30 rounded-lg border border-border/40 p-4 max-h-[480px] overflow-y-auto custom-scrollbar">
            {selectedId ? (
              <>
                {(() => {
                  const sel = snapshots.find((s) => s.id === selectedId)
                  if (!sel) return null
                  return (
                    <div className="space-y-3">
                      <div>
                        <div className="text-[12px] text-text-muted uppercase tracking-wider">
                          {t('iot.entity.idLabel')}
                        </div>
                        <div className="text-sm font-mono text-text-primary break-all">
                          {sel.externalId}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <div className="text-[12px] text-text-muted uppercase tracking-wider">
                            {t('iot.entity.currentStateLabel')}
                          </div>
                          <div className="text-sm text-text-primary font-semibold">
                            {String(sel.state ?? '-')}
                            {sel.unitOfMeasurement ? ` ${sel.unitOfMeasurement}` : ''}
                          </div>
                        </div>
                        <div>
                          <div className="text-[12px] text-text-muted uppercase tracking-wider">
                            {t('iot.entity.typeLabel')}
                          </div>
                          <div className="text-sm text-text-primary">{sel.entityType}</div>
                        </div>
                      </div>
                      {sel.deviceClass && (
                        <div>
                          <div className="text-[12px] text-text-muted uppercase tracking-wider">
                            {t('iot.entity.deviceClassLabel')}
                          </div>
                          <div className="text-sm text-text-primary">{sel.deviceClass}</div>
                        </div>
                      )}
                      {Object.keys(sel.attributes).length > 0 && (
                        <div>
                          <div className="text-[12px] text-text-muted uppercase tracking-wider mb-1">
                            {t('iot.entity.attributesLabel')}
                          </div>
                          <pre className="text-[12px] text-text-secondary bg-surface/40 p-2 rounded-md overflow-x-auto">
                            {JSON.stringify(sel.attributes, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )
                })()}

                {/* 历史读数 */}
                <div className="mt-4 pt-4 border-t border-border/40">
                  <div className="flex items-center gap-2 mb-2">
                    <History className="w-3.5 h-3.5 text-text-muted" />
                    <span className="text-sm font-medium text-text-primary">
                      {t('iot.entity.recentReadingsLabel')}
                    </span>
                  </div>
                  {loadingReadings ? (
                    <div className="py-4 flex items-center justify-center">
                      <Loader2 className="w-4 h-4 animate-spin text-text-muted" />
                    </div>
                  ) : readings.length === 0 ? (
                    <div className="py-4 text-center text-[12px] text-text-muted">
                      {t('iot.entity.noReadings')}
                    </div>
                  ) : (
                    <div className="space-y-1 max-h-[200px] overflow-y-auto custom-scrollbar">
                      {readings.map((r) => (
                        <div
                          key={r.id}
                          className="flex items-center justify-between text-[12px] py-1 px-2 rounded hover:bg-surface/40"
                        >
                          <span className="font-mono text-text-primary">
                            {r.value !== undefined ? r.value : r.stringValue ?? '-'}
                            {r.unit ? ` ${r.unit}` : ''}
                          </span>
                          <span className="text-text-muted ml-2">{formatTime(r.recordedAt)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="py-12 text-center text-[12px] text-text-muted">
                {t('iot.entity.selectPrompt')}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
