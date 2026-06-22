/**
 * 桌面控制中心面板（Phase 3）
 *
 * 职责：
 * - 展示系统权限状态（辅助功能 / 屏幕录制）
 * - 提供紧急停止触发与解除入口
 * - 监听权限变化与紧急停止状态变化
 *
 * 设计原则：
 * - 单一职责：仅负责状态展示与用户交互，业务逻辑由主进程处理
 * - 实时响应：通过 IPC 事件订阅状态变化
 * - 国际化：所有文案走 i18n
 */

import { useState, useEffect, useCallback } from 'react'
import {
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  AlertOctagon,
  RefreshCw,
  ExternalLink,
  StopCircle,
  PlayCircle,
  Monitor,
  Camera,
  type LucideIcon,
} from 'lucide-react'
import { api } from '@renderer/adapters/electronBridge'
import { useI18n } from '@renderer/i18n'

// ============ 类型定义 ============

type PermissionStatus = 'granted' | 'denied' | 'not-determined' | 'restricted' | 'not-required'
type PermissionType = 'accessibility' | 'screenCapture'

interface PermissionResult {
  type: PermissionType
  status: PermissionStatus
  needsGuide: boolean
  checkedAt: number
  platform: NodeJS.Platform
}

interface EmergencyStopState {
  stopped: boolean
  triggeredAt: number | null
  source: string | null
  reason: string | null
  triggerCount: number
}

// ============ 常量映射 ============

const PERMISSION_ICONS: Record<PermissionType, LucideIcon> = {
  accessibility: Monitor,
  screenCapture: Camera,
}

const STATUS_ICONS: Record<PermissionStatus, LucideIcon> = {
  granted: ShieldCheck,
  denied: ShieldX,
  'not-determined': ShieldAlert,
  restricted: ShieldAlert,
  'not-required': ShieldCheck,
}

const STATUS_COLORS: Record<PermissionStatus, string> = {
  granted: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30',
  denied: 'text-red-400 bg-red-400/10 border-red-400/30',
  'not-determined': 'text-amber-400 bg-amber-400/10 border-amber-400/30',
  restricted: 'text-amber-400 bg-amber-400/10 border-amber-400/30',
  'not-required': 'text-text-muted bg-surface/30 border-border/40',
}

// ============ 子组件：权限卡片 ============

interface PermissionCardProps {
  result: PermissionResult
  onOpenPreferences: (type: PermissionType) => void
  onRequestAgain: (type: PermissionType) => void
}

function PermissionCard({ result, onOpenPreferences, onRequestAgain }: PermissionCardProps) {
  const { t } = useI18n()
  const PermIcon = PERMISSION_ICONS[result.type]
  const StatusIcon = STATUS_ICONS[result.status]
  const statusKey = result.status === 'not-determined' ? 'notDetermined' : result.status
  const descKey = result.type === 'accessibility' ? 'desc.accessibility' : 'desc.screenCapture'

  return (
    <div className="rounded-xl border border-border/40 bg-surface/20 p-4 space-y-3">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-accent/10 border border-accent/20">
            <PermIcon className="w-5 h-5 text-accent" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-text-primary">
              {t(`desktop.permission.${result.type}`)}
            </h4>
            <p className="text-xs text-text-muted mt-0.5">
              {t(`desktop.permission.${descKey}`)}
            </p>
          </div>
        </div>
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-medium ${STATUS_COLORS[result.status]}`}>
          <StatusIcon className="w-3.5 h-3.5" />
          {t(`desktop.permission.${statusKey}`)}
        </div>
      </div>

      {result.needsGuide && (
        <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-400/5 border border-amber-400/20 rounded-lg px-3 py-2">
          <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
          <span>{t('desktop.permission.hint')}</span>
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        {result.needsGuide && (
          <button
            onClick={() => onOpenPreferences(result.type)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            {t('desktop.permission.openPreferences')}
          </button>
        )}
        <button
          onClick={() => onRequestAgain(result.type)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-text-secondary bg-surface/40 border border-border/40 hover:bg-surface-hover transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          {t('desktop.permission.requestAgain')}
        </button>
      </div>
    </div>
  )
}

// ============ 子组件：紧急停止卡片 ============

interface EmergencyStopCardProps {
  state: EmergencyStopState
  onTrigger: () => void
  onReset: () => void
}

function EmergencyStopCard({ state, onTrigger, onReset }: EmergencyStopCardProps) {
  const { t, language } = useI18n()
  const isActive = state.stopped

  return (
    <div className={`rounded-xl border p-5 space-y-4 transition-colors ${
      isActive
        ? 'border-red-500/40 bg-red-500/5'
        : 'border-border/40 bg-surface/20'
    }`}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg border ${
            isActive
              ? 'bg-red-500/10 border-red-500/30'
              : 'bg-accent/10 border-accent/20'
          }`}>
            <AlertOctagon className={`w-5 h-5 ${isActive ? 'text-red-400' : 'text-accent'}`} />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-text-primary">
              {t('desktop.emergencyStop')}
            </h4>
            <p className="text-xs text-text-muted mt-0.5">
              {t('desktop.emergencyStop.warning')}
            </p>
          </div>
        </div>
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-medium ${
          isActive
            ? 'text-red-400 bg-red-400/10 border-red-400/30'
            : 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30'
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-red-400 animate-pulse' : 'bg-emerald-400'}`} />
          {isActive ? t('desktop.emergencyStop.active') : t('desktop.emergencyStop.inactive')}
        </div>
      </div>

      {isActive && state.triggeredAt && (
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="space-y-1">
            <span className="text-text-muted">{t('desktop.emergencyStop.triggeredAt')}</span>
            <p className="text-text-primary font-mono">
              {new Date(state.triggeredAt).toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US')}
            </p>
          </div>
          {state.source && (
            <div className="space-y-1">
              <span className="text-text-muted">{t('desktop.emergencyStop.source')}</span>
              <p className="text-text-primary">
                {t(`desktop.source.${state.source}`)}
              </p>
            </div>
          )}
          {state.reason && (
            <div className="space-y-1 col-span-2">
              <span className="text-text-muted">{t('desktop.emergencyStop.reason')}</span>
              <p className="text-text-primary">{state.reason}</p>
            </div>
          )}
          <div className="space-y-1">
            <span className="text-text-muted">{t('desktop.emergencyStop.triggerCount')}</span>
            <p className="text-text-primary font-mono">{state.triggerCount}</p>
          </div>
        </div>
      )}

      <div className="pt-1">
        {isActive ? (
          <button
            onClick={onReset}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 transition-colors"
          >
            <PlayCircle className="w-4 h-4" />
            {t('desktop.emergencyStop.reset')}
          </button>
        ) : (
          <button
            onClick={onTrigger}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 transition-colors"
          >
            <StopCircle className="w-4 h-4" />
            {t('desktop.emergencyStop.trigger')}
          </button>
        )}
      </div>
    </div>
  )
}

// ============ 主组件 ============

export default function DesktopControlPanel() {
  const { t } = useI18n()

  const [permissions, setPermissions] = useState<PermissionResult[]>([])
  const [stopState, setStopState] = useState<EmergencyStopState>({
    stopped: false,
    triggeredAt: null,
    source: null,
    reason: null,
    triggerCount: 0,
  })
  const [loading, setLoading] = useState(false)

  // 加载权限状态
  const loadPermissions = useCallback(async (forceRefresh = false) => {
    setLoading(true)
    try {
      const result = await api.desktop.accessibility.checkAll(forceRefresh)
      if (result.success) {
        setPermissions(result.data as PermissionResult[])
      }
    } catch (err) {
      console.error('[DesktopControlPanel] Failed to load permissions:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  // 加载紧急停止状态
  const loadStopState = useCallback(async () => {
    try {
      const result = await api.desktop.emergencyStop.getState()
      if (result.success) {
        setStopState(result.data as EmergencyStopState)
      }
    } catch (err) {
      console.error('[DesktopControlPanel] Failed to load emergency stop state:', err)
    }
  }, [])

  // 初始化加载
  useEffect(() => {
    loadPermissions()
    loadStopState()
  }, [loadPermissions, loadStopState])

  // 订阅紧急停止状态变化
  useEffect(() => {
    const unsubscribe = api.desktop.emergencyStop.onStateChange((state) => {
      setStopState(state as EmergencyStopState)
    })
    return unsubscribe
  }, [])

  // 订阅权限变化
  useEffect(() => {
    const unsubscribe = api.desktop.accessibility.onPermissionChange(() => {
      loadPermissions(true)
    })
    return unsubscribe
  }, [loadPermissions])

  // 打开系统设置
  const handleOpenPreferences = useCallback(async (type: PermissionType) => {
    try {
      await api.desktop.accessibility.openPreferences(type)
    } catch (err) {
      console.error('[DesktopControlPanel] Failed to open preferences:', err)
    }
  }, [])

  // 重新请求权限
  const handleRequestAgain = useCallback(async (type: PermissionType) => {
    try {
      await api.desktop.accessibility.requestPermission(type)
      await loadPermissions(true)
    } catch (err) {
      console.error('[DesktopControlPanel] Failed to request permission:', err)
    }
  }, [loadPermissions])

  // 触发紧急停止
  const handleTriggerStop = useCallback(async () => {
    const confirmed = window.confirm(t('desktop.emergencyStop.confirmTitle'))
    if (!confirmed) return

    try {
      await api.desktop.emergencyStop.trigger({ source: 'user', reason: 'Triggered from control panel' })
      await loadStopState()
    } catch (err) {
      console.error('[DesktopControlPanel] Failed to trigger emergency stop:', err)
    }
  }, [t, loadStopState])

  // 解除紧急停止
  const handleResetStop = useCallback(async () => {
    const confirmed = window.confirm(t('desktop.emergencyStop.confirmReset'))
    if (!confirmed) return

    try {
      await api.desktop.emergencyStop.reset()
      await loadStopState()
    } catch (err) {
      console.error('[DesktopControlPanel] Failed to reset emergency stop:', err)
    }
  }, [t, loadStopState])

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* 标题区 */}
      <div className="space-y-1">
        <h2 className="text-xl font-semibold text-text-primary tracking-tight">
          {t('desktop.title')}
        </h2>
        <p className="text-sm text-text-muted">
          {t('desktop.subtitle')}
        </p>
      </div>

      {/* 紧急停止卡片（优先展示） */}
      <EmergencyStopCard
        state={stopState}
        onTrigger={handleTriggerStop}
        onReset={handleResetStop}
      />

      {/* 系统权限区 */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text-primary">
            {t('desktop.systemPermissions')}
          </h3>
          <button
            onClick={() => loadPermissions(true)}
            disabled={loading}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-text-secondary bg-surface/40 border border-border/40 hover:bg-surface-hover transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            {t('desktop.permission.checkAll')}
          </button>
        </div>

        {permissions.length === 0 ? (
          <div className="rounded-xl border border-border/40 bg-surface/20 p-8 text-center text-sm text-text-muted">
            {loading ? '...' : '—'}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {permissions.map((perm) => (
              <PermissionCard
                key={perm.type}
                result={perm}
                onOpenPreferences={handleOpenPreferences}
                onRequestAgain={handleRequestAgain}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
