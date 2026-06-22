/**
 * 系统信息面板
 * 展示 CPU、内存、磁盘、网络、电源等信息
 * 支持音量、亮度调节
 */

import { useState, useEffect, useCallback } from 'react'
import { Cpu, MemoryStick, HardDrive, Wifi, Battery, Sun, Volume2, RefreshCw, Monitor } from 'lucide-react'
import { type Language, t } from '@renderer/i18n'
import { ActionButton } from '@components/ui'
import { logger } from '@renderer/toolkit/LogEngine'

interface SystemInfo {
  platform: string
  osVersion: string
  hostname: string
  cpu: { model: string; cores: number; usage: number }
  memory: { total: number; free: number; used: number }
  disk: { total: number; free: number }
  displays: Array<{ id: number; bounds: { x: number; y: number; width: number; height: number }; scaleFactor: number }>
  network: { ip: string; connected: boolean }
  power: { batteryLevel?: number; charging: boolean }
}

interface SystemInfoPanelProps {
  language: Language
}

/** 字节转人类可读 */
function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

export function SystemInfoPanel({ language }: SystemInfoPanelProps) {
  const [info, setInfo] = useState<SystemInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [volume, setVolume] = useState(50)
  const [brightness, setBrightness] = useState(80)

  const loadInfo = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.electronAPI.desktopGetSystemInfo()
      if (result.success) {
        setInfo(result.data)
      }
    } catch (err) {
      logger.desktop?.error?.('[SystemInfoPanel] loadInfo failed:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadInfo()
  }, [loadInfo])

  const handleVolumeChange = useCallback(async (value: number) => {
    setVolume(value)
    try {
      await window.electronAPI.desktopSetVolume(value)
    } catch (err) {
      logger.desktop?.error?.('[SystemInfoPanel] setVolume failed:', err)
    }
  }, [])

  const handleBrightnessChange = useCallback(async (value: number) => {
    setBrightness(value)
    try {
      await window.electronAPI.desktopSetBrightness(value)
    } catch (err) {
      logger.desktop?.error?.('[SystemInfoPanel] setBrightness failed:', err)
    }
  }, [])

  if (loading && !info) {
    return (
      <div className="flex items-center justify-center py-12 text-text-muted text-sm">
        <RefreshCw className="w-4 h-4 animate-spin mr-2" />
        {t('common.loading', language) || '加载中...'}
      </div>
    )
  }

  if (!info) {
    return (
      <div className="text-center py-12 text-text-muted text-sm">
        {t('desktop.noSystemInfo', language) || '无法获取系统信息'}
      </div>
    )
  }

  const memUsagePercent = info.memory.total > 0 ? (info.memory.used / info.memory.total) * 100 : 0

  return (
    <div className="space-y-4">
      {/* 工具栏 */}
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-text-primary">
          {info.hostname} · {info.osVersion}
        </h3>
        <ActionButton onClick={() => void loadInfo()} variant="ghost" size="sm" disabled={loading}>
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </ActionButton>
      </div>

      {/* 信息卡片网格 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* CPU */}
        <InfoCard
          icon={<Cpu className="w-4 h-4" />}
          label={t('desktop.cpu', language) || 'CPU'}
          value={info.cpu.model}
          extra={`${info.cpu.cores} ${t('desktop.cores', language) || '核'} · ${info.cpu.usage.toFixed(1)}%`}
          progress={info.cpu.usage}
        />

        {/* 内存 */}
        <InfoCard
          icon={<MemoryStick className="w-4 h-4" />}
          label={t('desktop.memory', language) || '内存'}
          value={`${formatBytes(info.memory.used)} / ${formatBytes(info.memory.total)}`}
          extra={`${formatBytes(info.memory.free)} ${t('desktop.available', language) || '可用'}`}
          progress={memUsagePercent}
        />

        {/* 网络 */}
        <InfoCard
          icon={<Wifi className="w-4 h-4" />}
          label={t('desktop.network', language) || '网络'}
          value={info.network.ip || 'N/A'}
          extra={info.network.connected ? (t('desktop.connected', language) || '已连接') : (t('desktop.disconnected', language) || '未连接')}
          statusColor={info.network.connected ? 'emerald' : 'red'}
        />

        {/* 电源 */}
        <InfoCard
          icon={<Battery className="w-4 h-4" />}
          label={t('desktop.power', language) || '电源'}
          value={info.power.batteryLevel !== undefined ? `${info.power.batteryLevel}%` : (t('desktop.pluggedIn', language) || '已接电源')}
          extra={info.power.charging ? (t('desktop.charging', language) || '充电中') : ''}
          statusColor={info.power.batteryLevel !== undefined && info.power.batteryLevel < 20 ? 'red' : 'emerald'}
        />

        {/* 显示器 */}
        <InfoCard
          icon={<Monitor className="w-4 h-4" />}
          label={t('desktop.displays', language) || '显示器'}
          value={`${info.displays.length} ${t('desktop.screens', language) || '屏'}`}
          extra={info.displays.map(d => `${d.bounds.width}×${d.bounds.height}`).join(' · ')}
        />

        {/* 磁盘 */}
        <InfoCard
          icon={<HardDrive className="w-4 h-4" />}
          label={t('desktop.disk', language) || '磁盘'}
          value={info.disk.total > 0 ? `${formatBytes(info.disk.free)} / ${formatBytes(info.disk.total)}` : 'N/A'}
          extra={info.disk.total > 0 ? `${formatBytes(info.disk.total - info.disk.free)} ${t('desktop.used', language) || '已用'}` : ''}
        />
      </div>

      {/* 控制滑块 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <SliderControl
          icon={<Volume2 className="w-4 h-4" />}
          label={t('desktop.volume', language) || '音量'}
          value={volume}
          onChange={handleVolumeChange}
        />
        <SliderControl
          icon={<Sun className="w-4 h-4" />}
          label={t('desktop.brightness', language) || '亮度'}
          value={brightness}
          onChange={handleBrightnessChange}
        />
      </div>
    </div>
  )
}

/** 信息卡片 */
function InfoCard({
  icon,
  label,
  value,
  extra,
  progress,
  statusColor,
}: {
  icon: React.ReactNode
  label: string
  value: string
  extra?: string
  progress?: number
  statusColor?: 'emerald' | 'red'
}) {
  const statusClass = statusColor === 'emerald' ? 'text-emerald-600' : statusColor === 'red' ? 'text-red-600' : 'text-text-muted'

  return (
    <div className="p-4 rounded-xl border border-border/40 bg-surface/50">
      <div className="flex items-center gap-2 mb-2">
        <div className="p-1.5 rounded-md bg-accent/10 text-accent">{icon}</div>
        <span className="text-xs font-medium text-text-muted uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-sm text-text-primary font-medium mb-1 truncate" title={value}>{value}</div>
      {extra && <div className={`text-xs ${statusClass}`}>{extra}</div>}
      {progress !== undefined && (
        <div className="mt-2 h-1.5 bg-surface-hover rounded-full overflow-hidden">
          <div
            className="h-full bg-accent rounded-full transition-all"
            style={{ width: `${Math.min(100, progress)}%` }}
          />
        </div>
      )}
    </div>
  )
}

/** 滑块控制 */
function SliderControl({
  icon,
  label,
  value,
  onChange,
}: {
  icon: React.ReactNode
  label: string
  value: number
  onChange: (value: number) => void
}) {
  return (
    <div className="p-4 rounded-xl border border-border/40 bg-surface/50">
      <div className="flex items-center gap-2 mb-3">
        <div className="p-1.5 rounded-md bg-accent/10 text-accent">{icon}</div>
        <span className="text-xs font-medium text-text-muted uppercase tracking-wide">{label}</span>
        <span className="ml-auto text-sm text-text-primary font-medium">{value}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={e => onChange(parseInt(e.target.value, 10))}
        className="w-full accent-accent"
      />
    </div>
  )
}

export default SystemInfoPanel
