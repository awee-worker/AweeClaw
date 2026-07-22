/**
 * MQTT 消息发布对话框（阶段9 s9-10）
 *
 * 用于向已连接的 MQTT Provider 发布测试消息：
 * - 选择目标 Provider（仅显示已连接的 MQTT 协议 Provider）
 * - 输入主题、payload、QoS、retain
 * - 调用 window.electronAPI.iot.publishMessage
 *
 * 常见用例：
 * - 测试设备响应：向 home/switch/01/cmd 发布 ON/OFF
 * - 模拟传感器数据：向 home/sensor/test 发布数值
 * - 通知其他订阅者：向 home/notify 发布消息
 *
 * @module settings/tabs/iot/MqttPublishDialog
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Send, X, AlertCircle, CheckCircle2 } from 'lucide-react'
import { OverlayDialog } from '@components/ui'
import { type Language } from '@renderer/i18n'
import { logger } from '@shared/toolkit/LogEngine'

interface MqttPublishDialogProps {
  /** 是否打开 */
  isOpen: boolean
  /** 关闭回调 */
  onClose: () => void
  /** 语言 */
  language: Language
  /** 已连接的 Provider 列表（用于筛选 MQTT 协议） */
  providers: Array<{
    providerId: string
    providerName: string
    protocol: 'homeassistant' | 'mqtt' | 'ble' | 'custom'
    state: 'disconnected' | 'connecting' | 'connected' | 'error' | 'disabled'
  }>
}

/** QoS 选项 */
const QOS_OPTIONS: Array<{ value: 0 | 1 | 2; labelZh: string; labelEn: string }> = [
  { value: 0, labelZh: '0（至多一次）', labelEn: '0 (At most once)' },
  { value: 1, labelZh: '1（至少一次）', labelEn: '1 (At least once)' },
  { value: 2, labelZh: '2（恰好一次）', labelEn: '2 (Exactly once)' },
]

/** 常用主题示例 */
const TOPIC_EXAMPLES = [
  'home/switch/01/cmd',
  'home/light/01/set',
  'home/sensor/test',
  'home/notify',
]

/** 常用 payload 示例 */
const PAYLOAD_EXAMPLES = ['ON', 'OFF', '1', '0', '{"state":"on","brightness":128}']

export function MqttPublishDialog({
  isOpen,
  onClose,
  language,
  providers,
}: MqttPublishDialogProps) {
  const isZh = language === 'zh'

  // 筛选已连接的 MQTT Provider
  const mqttProviders = useMemo(
    () => providers.filter((p) => p.protocol === 'mqtt' && p.state === 'connected'),
    [providers],
  )

  const [selectedProviderId, setSelectedProviderId] = useState<string>('')
  const [topic, setTopic] = useState('')
  const [payload, setPayload] = useState('')
  const [qos, setQos] = useState<0 | 1 | 2>(0)
  const [retain, setRetain] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  // 自动选择第一个可用的 MQTT Provider
  useEffect(() => {
    if (mqttProviders.length > 0 && !selectedProviderId) {
      setSelectedProviderId(mqttProviders[0].providerId)
    }
    if (selectedProviderId && !mqttProviders.some((p) => p.providerId === selectedProviderId)) {
      setSelectedProviderId(mqttProviders[0]?.providerId ?? '')
    }
  }, [mqttProviders, selectedProviderId])

  // 重置状态当关闭时
  useEffect(() => {
    if (!isOpen) {
      setResult(null)
      setPublishing(false)
    }
  }, [isOpen])

  /** 发布消息 */
  const handlePublish = useCallback(async () => {
    if (!selectedProviderId || !topic.trim()) return

    setPublishing(true)
    setResult(null)
    try {
      const res = await window.electronAPI.iot.publishMessage(
        selectedProviderId,
        topic.trim(),
        payload,
        { qos, retain },
      )
      if (res.success && res.data) {
        setResult({
          ok: res.data.success,
          message: res.data.message,
        })
      } else {
        setResult({
          ok: false,
          message: res.error ?? (isZh ? '发布失败' : 'Publish failed'),
        })
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setResult({ ok: false, message: msg })
      logger.settings?.error('[MqttPublishDialog] 发布失败:', e)
    } finally {
      setPublishing(false)
    }
  }, [selectedProviderId, topic, payload, qos, retain, isZh])

  /** 无可用 Provider 时提示 */
  if (isOpen && mqttProviders.length === 0) {
    return (
      <OverlayDialog
        isOpen={isOpen}
        onClose={onClose}
        title={isZh ? 'MQTT 消息发布' : 'MQTT Publish'}
        size="md"
      >
        <div className="p-6 space-y-4">
          <div className="flex items-start gap-3 p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl">
            <AlertCircle className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />
            <div>
              <div className="text-sm font-medium text-amber-500">
                {isZh ? '无可用 MQTT Provider' : 'No MQTT Provider available'}
              </div>
              <div className="text-[12px] text-amber-500/70 mt-1">
                {isZh
                  ? '请先连接一个 MQTT 协议的 Provider，再使用消息发布功能。'
                  : 'Please connect a MQTT protocol provider first before publishing messages.'}
              </div>
            </div>
          </div>
          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 text-[12px] font-medium rounded-lg bg-surface/40 border border-border/40 text-text-secondary hover:bg-surface-hover transition-all"
            >
              {isZh ? '关闭' : 'Close'}
            </button>
          </div>
        </div>
      </OverlayDialog>
    )
  }

  return (
    <OverlayDialog
      isOpen={isOpen}
      onClose={onClose}
      title={isZh ? 'MQTT 消息发布' : 'MQTT Publish'}
      size="md"
    >
      <div className="p-6 space-y-4">
        {/* Provider 选择 */}
        <div className="space-y-1.5">
          <label className="text-[12px] font-medium text-text-primary">
            {isZh ? '目标 Provider' : 'Target Provider'}
          </label>
          <select
            value={selectedProviderId}
            onChange={(e) => setSelectedProviderId(e.target.value)}
            className="w-full text-[12px] bg-surface border border-border/60 rounded-lg p-2.5 text-text-primary focus:outline-none focus:border-accent"
          >
            {mqttProviders.map((p) => (
              <option key={p.providerId} value={p.providerId}>
                {p.providerName} ({p.providerId.slice(0, 8)})
              </option>
            ))}
          </select>
        </div>

        {/* 主题 */}
        <div className="space-y-1.5">
          <label className="text-[12px] font-medium text-text-primary">
            {isZh ? '主题' : 'Topic'} <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="home/switch/01/cmd"
            className="w-full text-[12px] font-mono bg-surface border border-border/60 rounded-lg p-2.5 text-text-primary focus:outline-none focus:border-accent"
          />
          {/* 主题示例 */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] text-text-muted">
              {isZh ? '示例:' : 'Examples:'}
            </span>
            {TOPIC_EXAMPLES.map((t) => (
              <button
                key={t}
                onClick={() => setTopic(t)}
                className="text-[11px] px-1.5 py-0.5 rounded bg-surface/40 border border-border/40 text-text-secondary hover:text-text-primary hover:bg-surface-hover font-mono transition-all"
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Payload */}
        <div className="space-y-1.5">
          <label className="text-[12px] font-medium text-text-primary">
            {isZh ? '消息内容' : 'Payload'}
          </label>
          <textarea
            value={payload}
            onChange={(e) => setPayload(e.target.value)}
            placeholder={isZh ? 'ON / OFF / {"state":"on"}' : 'ON / OFF / {"state":"on"}'}
            className="w-full min-h-[80px] text-[12px] font-mono bg-surface border border-border/60 rounded-lg p-2.5 text-text-primary focus:outline-none focus:border-accent resize-y custom-scrollbar"
          />
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] text-text-muted">
              {isZh ? '示例:' : 'Examples:'}
            </span>
            {PAYLOAD_EXAMPLES.map((p) => (
              <button
                key={p}
                onClick={() => setPayload(p)}
                className="text-[11px] px-1.5 py-0.5 rounded bg-surface/40 border border-border/40 text-text-secondary hover:text-text-primary hover:bg-surface-hover font-mono transition-all"
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* QoS + Retain */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-text-primary">
              {isZh ? 'QoS' : 'QoS'}
            </label>
            <select
              value={qos}
              onChange={(e) => setQos(Number(e.target.value) as 0 | 1 | 2)}
              className="w-full text-[12px] bg-surface border border-border/60 rounded-lg p-2.5 text-text-primary focus:outline-none focus:border-accent"
            >
              {QOS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {isZh ? opt.labelZh : opt.labelEn}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-text-primary">
              {isZh ? '保留消息' : 'Retain'}
            </label>
            <button
              onClick={() => setRetain((v) => !v)}
              className={`w-full text-[12px] font-medium rounded-lg p-2.5 border transition-all ${
                retain
                  ? 'bg-cyan-500/15 text-cyan-500 border-cyan-500/30'
                  : 'bg-surface text-text-secondary border-border/40 hover:bg-surface-hover'
              }`}
            >
              {retain
                ? isZh ? '✓ 保留' : '✓ Retain'
                : isZh ? '不保留' : 'No retain'}
            </button>
          </div>
        </div>

        {/* 结果提示 */}
        {result && (
          <div
            className={`p-3 rounded-lg border flex items-start gap-2 ${
              result.ok
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500'
                : 'bg-red-500/10 border-red-500/30 text-red-500'
            }`}
          >
            {result.ok ? (
              <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            )}
            <div className="flex-1">
              <div className="text-[12px] font-medium">
                {result.ok
                  ? isZh ? '发布成功' : 'Published'
                  : isZh ? '发布失败' : 'Publish failed'}
              </div>
              <div className="text-[12px] opacity-70 mt-0.5 break-all">{result.message}</div>
            </div>
          </div>
        )}

        {/* 操作按钮 */}
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/40">
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-lg bg-surface/40 border border-border/40 text-text-secondary hover:bg-surface-hover transition-all"
          >
            <X className="w-3.5 h-3.5" />
            {isZh ? '关闭' : 'Close'}
          </button>
          <button
            onClick={() => void handlePublish()}
            disabled={publishing || !selectedProviderId || !topic.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-lg bg-cyan-500/15 text-cyan-500 border border-cyan-500/30 hover:bg-cyan-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            <Send className={`w-3.5 h-3.5 ${publishing ? 'animate-pulse' : ''}`} />
            {publishing
              ? isZh ? '发布中...' : 'Publishing...'
              : isZh ? '发布' : 'Publish'}
          </button>
        </div>
      </div>
    </OverlayDialog>
  )
}
