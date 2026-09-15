/**
 * VmcSettings — VMC 协议设置面板
 *
 * 功能：
 * 1. 模块总开关
 * 2. 出站配置（发送目标）
 * 3. 入站配置（监听端口、IP 白名单）
 * 4. 心跳配置
 * 5. 状态监控
 * 6. 统计信息
 *
 * 设计要点：
 * 1. 默认关闭：遵循 P1 通用要求
 * 2. 配置持久化：配置保存到 vmc/vmc_config.json
 * 3. 实时状态：通过定时轮询同步运行时状态
 *
 * @module components/settings/VmcSettings
 */

import { useState, useEffect, useCallback } from 'react'
import {
  Send,
  RadioReceiver,
  Heart,
  Shield,
  BarChart3,
  Loader2,
  AlertTriangle,
  CheckCircle,
  RefreshCw,
} from 'lucide-react'
import { ToggleSwitch } from '@components/ui'
import { api } from '@renderer/adapters/electronBridge'
import { toast } from '@components/foundation/NotificationProvider'
import { t, type Language } from '@renderer/i18n'
import type { VmcConfig, VmcState } from '@renderer/types/electronBridge'

// ============================================
// 类型定义
// ============================================

interface VmcSettingsProps {
  language: Language
}

// ============================================
// 组件
// ============================================

export function VmcSettings({ language }: VmcSettingsProps) {
  const zh = language === 'zh'

  // 状态
  const [config, setConfig] = useState<VmcConfig | null>(null)
  const [state, setState] = useState<VmcState | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 刷新配置和状态
  const refresh = useCallback(async () => {
    try {
      const [configRes, stateRes] = await Promise.all([
        api.vmc.getConfig(),
        api.vmc.getState(),
      ])

      if (configRes.success && configRes.data) {
        setConfig(configRes.data)
      }
      if (stateRes.success && stateRes.data) {
        setState(stateRes.data)
      }
      setError(null)
    } catch (err) {
      console.error('[VmcSettings] Load failed:', err)
      setError(zh ? '读取配置失败' : 'Failed to load settings')
    } finally {
      setLoading(false)
    }
  }, [zh])

  // 初始化
  useEffect(() => {
    void refresh()
  }, [refresh])

  // 定时刷新状态
  useEffect(() => {
    const timer = setInterval(() => {
      void refresh()
    }, 2000)
    return () => clearInterval(timer)
  }, [refresh])

  // 更新配置
  const updateConfig = useCallback(async (update: Partial<VmcConfig>) => {
    setSaving(true)
    try {
      const res = await api.vmc.updateConfig(update)
      if (res.success && res.data) {
        setConfig(res.data)
        toast.success(zh ? '配置已保存' : 'Settings saved')
      } else {
        toast.error(zh ? '保存失败' : 'Failed to save')
      }
    } catch (err) {
      console.error('[VmcSettings] Update failed:', err)
      toast.error(zh ? '保存失败' : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }, [zh])

  // 重置配置
  const resetConfig = useCallback(async () => {
    setSaving(true)
    try {
      const res = await api.vmc.resetConfig()
      if (res.success && res.data) {
        setConfig(res.data)
        toast.success(zh ? '配置已重置' : 'Settings reset')
      } else {
        toast.error(zh ? '重置失败' : 'Failed to reset')
      }
    } catch (err) {
      console.error('[VmcSettings] Reset failed:', err)
      toast.error(zh ? '重置失败' : 'Failed to reset')
    } finally {
      setSaving(false)
    }
  }, [zh])

  // 重置统计信息
  const resetStats = useCallback(async () => {
    try {
      await api.vmc.resetStats()
      await refresh()
      toast.success(zh ? '统计已重置' : 'Stats reset')
    } catch (err) {
      console.error('[VmcSettings] Reset stats failed:', err)
    }
  }, [zh, refresh])

  // 加载中
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-text-muted" />
      </div>
    )
  }

  // 错误
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-2">
        <AlertTriangle className="w-6 h-6 text-red-500" />
        <p className="text-sm text-red-500">{error}</p>
        <button
          onClick={() => void refresh()}
          className="text-sm text-accent hover:underline"
        >
          {zh ? '重试' : 'Retry'}
        </button>
      </div>
    )
  }

  // 无配置
  if (!config) {
    return null
  }

  return (
    <div className="space-y-6">
      {/* 模块总开关 */}
      <section className="rounded-2xl border border-border/40 bg-surface/70 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-text-primary">
              {zh ? 'VMC 协议' : 'VMC Protocol'}
            </h3>
            <p className="text-xs text-text-muted mt-1">
              {zh
                ? '双向动作捕捉协议，支持 VSeeFace、Warudo 等应用'
                : 'Bidirectional motion capture protocol, supports VSeeFace, Warudo, etc.'}
            </p>
          </div>
          <ToggleSwitch
            checked={config.enabled}
            onChange={(checked) => void updateConfig({ enabled: checked })}
            disabled={saving}
          />
        </div>

        {!config.enabled && (
          <div className="flex items-center gap-2 text-xs text-text-muted bg-surface-hover rounded-lg p-2">
            <AlertTriangle className="w-4 h-4" />
            <span>
              {zh
                ? '启用后可将 VRM 动作数据发送到外部应用，或接收外部数据驱动模型'
                : 'Enable to send VRM motion data to external apps, or receive data to drive the model'}
            </span>
          </div>
        )}
      </section>

      {/* 出站配置 */}
      <section className="rounded-2xl border border-border/40 bg-surface/70 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Send className="w-4 h-4 text-accent" />
          <h3 className="text-sm font-medium text-text-primary">
            {zh ? '出站设置' : 'Send Settings'}
          </h3>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-text-primary">
              {zh ? '启用出站' : 'Enable Send'}
            </div>
            <div className="text-xs text-text-muted">
              {zh
                ? '将 AweeClaw 的 VRM 动作发送到外部应用'
                : 'Send AweeClaw VRM motion to external apps'}
            </div>
          </div>
          <ToggleSwitch
            checked={config.send.enabled}
            onChange={(checked) =>
              void updateConfig({
                send: { ...config.send, enabled: checked },
              })
            }
            disabled={saving || !config.enabled}
          />
        </div>

        {config.send.enabled && (
          <div className="space-y-3 pl-4 border-l-2 border-accent/20">
            <div>
              <label className="text-xs text-text-muted">
                {zh ? '目标主机' : 'Target Host'}
              </label>
              <input
                type="text"
                value={config.send.host}
                onChange={(e) =>
                  void updateConfig({
                    send: { ...config.send, host: e.target.value },
                  })
                }
                className="w-full mt-1 px-3 py-1.5 text-sm bg-surface border border-border rounded-lg"
                placeholder="127.0.0.1"
              />
            </div>
            <div>
              <label className="text-xs text-text-muted">
                {zh ? '目标端口' : 'Target Port'}
              </label>
              <input
                type="number"
                value={config.send.port}
                onChange={(e) =>
                  void updateConfig({
                    send: { ...config.send, port: parseInt(e.target.value) || 39540 },
                  })
                }
                className="w-full mt-1 px-3 py-1.5 text-sm bg-surface border border-border rounded-lg"
                min={1}
                max={65535}
              />
            </div>
          </div>
        )}
      </section>

      {/* 入站配置 */}
      <section className="rounded-2xl border border-border/40 bg-surface/70 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <RadioReceiver className="w-4 h-4 text-accent" />
          <h3 className="text-sm font-medium text-text-primary">
            {zh ? '入站设置' : 'Receive Settings'}
          </h3>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-text-primary">
              {zh ? '启用入站' : 'Enable Receive'}
            </div>
            <div className="text-xs text-text-muted">
              {zh
                ? '接收外部 VMC 数据驱动 AweeClaw 的 VRM 模型'
                : 'Receive external VMC data to drive AweeClaw VRM model'}
            </div>
          </div>
          <ToggleSwitch
            checked={config.receive.enabled}
            onChange={(checked) =>
              void updateConfig({
                receive: { ...config.receive, enabled: checked },
              })
            }
            disabled={saving || !config.enabled}
          />
        </div>

        {config.receive.enabled && (
          <div className="space-y-3 pl-4 border-l-2 border-accent/20">
            <div>
              <label className="text-xs text-text-muted">
                {zh ? '监听端口' : 'Listen Port'}
              </label>
              <input
                type="number"
                value={config.receive.port}
                onChange={(e) =>
                  void updateConfig({
                    receive: { ...config.receive, port: parseInt(e.target.value) || 39539 },
                  })
                }
                className="w-full mt-1 px-3 py-1.5 text-sm bg-surface border border-border rounded-lg"
                min={1}
                max={65535}
              />
            </div>
            <div>
              <label className="text-xs text-text-muted">
                {zh ? '允许的 IP（每行一个）' : 'Allowed IPs (one per line)'}
              </label>
              <textarea
                value={config.receive.allowedIps.join('\n')}
                onChange={(e) =>
                  void updateConfig({
                    receive: {
                      ...config.receive,
                      allowedIps: e.target.value
                        .split('\n')
                        .map((s) => s.trim())
                        .filter(Boolean),
                    },
                  })
                }
                className="w-full mt-1 px-3 py-1.5 text-sm bg-surface border border-border rounded-lg"
                rows={3}
                placeholder="127.0.0.1"
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-text-primary">
                  {zh ? '同步表情' : 'Sync Expression'}
                </div>
                <div className="text-xs text-text-muted">
                  {zh
                    ? '接收外部表情数据驱动 VRM 模型'
                    : 'Receive external expression data to drive VRM model'}
                </div>
              </div>
              <ToggleSwitch
                checked={config.receive.syncExpression}
                onChange={(checked) =>
                  void updateConfig({
                    receive: { ...config.receive, syncExpression: checked },
                  })
                }
                disabled={saving}
              />
            </div>
          </div>
        )}
      </section>

      {/* 心跳配置 */}
      <section className="rounded-2xl border border-border/40 bg-surface/70 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Heart className="w-4 h-4 text-accent" />
          <h3 className="text-sm font-medium text-text-primary">
            {zh ? '心跳设置' : 'Heartbeat Settings'}
          </h3>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-text-primary">
              {zh ? '启用心跳' : 'Enable Heartbeat'}
            </div>
            <div className="text-xs text-text-muted">
              {zh
                ? '定期发送心跳包保持连接（VSeeFace 等应用需要）'
                : 'Send periodic heartbeat to maintain connection (required by VSeeFace, etc.)'}
            </div>
          </div>
          <ToggleSwitch
            checked={config.heartbeat.enabled}
            onChange={(checked) =>
              void updateConfig({
                heartbeat: { ...config.heartbeat, enabled: checked },
              })
            }
            disabled={saving || !config.enabled}
          />
        </div>

        {config.heartbeat.enabled && (
          <div>
            <label className="text-xs text-text-muted">
              {zh ? '心跳间隔（毫秒）' : 'Heartbeat Interval (ms)'}
            </label>
            <input
              type="number"
              value={config.heartbeat.intervalMs}
              onChange={(e) =>
                void updateConfig({
                  heartbeat: {
                    ...config.heartbeat,
                    intervalMs: parseInt(e.target.value) || 1000,
                  },
                })
              }
              className="w-full mt-1 px-3 py-1.5 text-sm bg-surface border border-border rounded-lg"
              min={100}
              max={10000}
            />
          </div>
        )}
      </section>

      {/* 状态监控 */}
      {state && (
        <section className="rounded-2xl border border-border/40 bg-surface/70 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-accent" />
              <h3 className="text-sm font-medium text-text-primary">
                {zh ? '状态监控' : 'Status Monitor'}
              </h3>
            </div>
            <button
              onClick={() => void resetStats()}
              className="text-xs text-text-muted hover:text-accent flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" />
              {zh ? '重置统计' : 'Reset Stats'}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-surface-hover rounded-lg p-3">
              <div className="text-xs text-text-muted">
                {zh ? '出站状态' : 'Sender Status'}
              </div>
              <div className="flex items-center gap-1 mt-1">
                {state.senderActive ? (
                  <CheckCircle className="w-4 h-4 text-green-500" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-text-muted" />
                )}
                <span className="text-sm">
                  {state.senderActive
                    ? zh ? '运行中' : 'Running'
                    : zh ? '已停止' : 'Stopped'}
                </span>
              </div>
            </div>

            <div className="bg-surface-hover rounded-lg p-3">
              <div className="text-xs text-text-muted">
                {zh ? '入站状态' : 'Receiver Status'}
              </div>
              <div className="flex items-center gap-1 mt-1">
                {state.receiverActive ? (
                  <CheckCircle className="w-4 h-4 text-green-500" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-text-muted" />
                )}
                <span className="text-sm">
                  {state.receiverActive
                    ? zh ? '运行中' : 'Running'
                    : zh ? '已停止' : 'Stopped'}
                </span>
              </div>
            </div>

            <div className="bg-surface-hover rounded-lg p-3">
              <div className="text-xs text-text-muted">
                {zh ? '发送帧数' : 'Sent Frames'}
              </div>
              <div className="text-lg font-medium mt-1">
                {state.stats.sentFrames}
              </div>
            </div>

            <div className="bg-surface-hover rounded-lg p-3">
              <div className="text-xs text-text-muted">
                {zh ? '接收帧数' : 'Received Frames'}
              </div>
              <div className="text-lg font-medium mt-1">
                {state.stats.receivedFrames}
              </div>
            </div>

            <div className="bg-surface-hover rounded-lg p-3 col-span-2">
              <div className="text-xs text-text-muted">
                {zh ? '错误次数' : 'Errors'}
              </div>
              <div className="text-lg font-medium mt-1 text-red-500">
                {state.stats.errors}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* 重置按钮 */}
      <div className="flex justify-end">
        <button
          onClick={() => void resetConfig()}
          disabled={saving}
          className="px-4 py-2 text-sm text-text-muted hover:text-accent border border-border rounded-lg hover:border-accent transition-colors"
        >
          {zh ? '重置为默认配置' : 'Reset to Defaults'}
        </button>
      </div>
    </div>
  )
}