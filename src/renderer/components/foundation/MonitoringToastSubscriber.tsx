/**
 * 监控异常 Toast 订阅器
 *
 * 在 ToastProvider 内部挂载，订阅主进程异常事件推送。
 * 当监控配置启用 notificationsEnabled 时，新异常自动显示 toast。
 *
 * 行为：
 * - 启动时主动调用 monitoring.subscribe() 触发主进程订阅
 * - 通过 monitoring.onAnomalyEvent 接收推送
 * - 根据异常严重度选择 toast 类型：critical → error，warning → warning，info → info
 * - 严重异常显示卡片式 toast（带「查看详情」操作），一般异常显示普通 toast
 */

import { useEffect, useRef } from 'react'
import { toast } from '@components/foundation/NotificationProvider'
import { logger } from '@shared/toolkit/LogEngine'
import { useStore } from '@renderer/state'

/** 异常事件类型 */
interface AnomalyEventItem {
  id: string
  timestamp: number
  type: string
  severity: 'info' | 'warning' | 'critical'
  description: string
  recommendation: string
  status: 'active' | 'resolved' | 'acknowledged'
}

/** 已显示过的异常 ID（避免重复） */
const SHOWN_ANOMALIES = new Set<string>()

export function MonitoringToastSubscriber() {
  const unsubscribeRef = useRef<(() => void) | null>(null)
  const language = useStore((s) => s.language)

  useEffect(() => {
    let mounted = true

    /** 初始化订阅 */
    async function init() {
      try {
        // 先获取配置，判断是否启用通知
        const configRes = await window.electronAPI.monitoring.getConfig()
        if (!configRes.success || !configRes.data) return

        const config = configRes.data as { notificationsEnabled: boolean; enabled: boolean }
        if (!config.enabled || !config.notificationsEnabled) {
          logger.ui?.info('[MonitoringToastSubscriber] 监控通知未启用，跳过订阅')
          return
        }

        // 触发主进程订阅
        await window.electronAPI.monitoring.subscribe()
        if (!mounted) return

        // 注册渲染层监听
        unsubscribeRef.current = window.electronAPI.monitoring.onAnomalyEvent((event) => {
          const anomaly = event as AnomalyEventItem

          // 去重：同一异常 ID 只显示一次
          if (SHOWN_ANOMALIES.has(anomaly.id)) return
          SHOWN_ANOMALIES.add(anomaly.id)

          // 限制 Set 大小
          if (SHOWN_ANOMALIES.size > 100) {
            const first = SHOWN_ANOMALIES.values().next().value
            if (first) SHOWN_ANOMALIES.delete(first)
          }

          // 已解决的异常不显示
          if (anomaly.status !== 'active') return

          // 严重度 → toast 类型
          const message =
            language === 'zh'
              ? anomaly.description
              : anomaly.description

          // 严重异常显示带操作的卡片
          if (anomaly.severity === 'critical') {
            toast.error(message, 10000)
          } else if (anomaly.severity === 'warning') {
            toast.warning(message, 8000)
          } else {
            toast.info(message, 6000)
          }
        })

        logger.ui?.info('[MonitoringToastSubscriber] 订阅成功')
      } catch (e) {
        logger.ui?.warn('[MonitoringToastSubscriber] 订阅失败:', e)
      }
    }

    void init()

    return () => {
      mounted = false
      if (unsubscribeRef.current) {
        unsubscribeRef.current()
        unsubscribeRef.current = null
      }
    }
  }, [language])

  // 该组件不渲染任何 UI
  return null
}
