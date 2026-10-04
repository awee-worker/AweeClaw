/**
 * 邮件未读角标
 *
 * 轮询主进程的本地邮件索引（只读本地缓存，不触发网络请求），
 * 用于左侧导航「邮件中心」入口的数字角标。
 *
 * 三条刷新途径：
 * - 主进程在标记已读 / 同步完成后广播 mail:unread-changed，收到即刷新（邮件中心
 *   在独立窗口里操作，主窗口无法察觉，靠这条事件即时同步角标）；
 * - 窗口重新获得焦点时刷新一次（兜底：从邮件中心窗口切回主窗口）；
 * - 定时轮询兜底，防止事件丢失导致角标长期陈旧。
 */

import { useEffect, useState } from 'react'
import { api } from '@renderer/adapters/electronBridge'

/** 轮询间隔（ms） */
const POLL_INTERVAL = 60_000

export function useMailUnreadCount(): number {
  const [count, setCount] = useState(0)

  useEffect(() => {
    let cancelled = false

    const refresh = async () => {
      try {
        const result = await api.mail.unreadCount()
        if (!cancelled) setCount(result?.count ?? 0)
      } catch {
        // 主进程未就绪时静默忽略，保留上一次的角标值
      }
    }

    void refresh()
    const timer = setInterval(() => void refresh(), POLL_INTERVAL)
    const onFocus = () => void refresh()
    window.addEventListener('focus', onFocus)

    // 主进程广播的未读总数变化：立即采用，无需再查一次 IPC
    const unsubscribe = api.mail.onUnreadChanged((payload) => {
      if (!cancelled && payload) setCount(payload.count ?? 0)
    })

    return () => {
      cancelled = true
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      unsubscribe()
    }
  }, [])

  return count
}
