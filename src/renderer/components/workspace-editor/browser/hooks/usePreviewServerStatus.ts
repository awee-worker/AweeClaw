/**
 * 订阅某个预览会话的服务存活状态
 *
 * 订阅存在时才跑探活定时器：没有预览标签页打开时不做任何网络探测。
 */
import { useEffect, useState } from 'react'
import { devServerMonitor, type PreviewServerStatus } from '@renderer/preview/devServerMonitor'

export function usePreviewServerStatus(sessionId?: string): PreviewServerStatus | null {
  const [status, setStatus] = useState<PreviewServerStatus | null>(
    sessionId ? devServerMonitor.getStatus(sessionId) ?? null : null,
  )

  useEffect(() => {
    if (!sessionId) {
      setStatus(null)
      return
    }

    return devServerMonitor.subscribe((statuses) => {
      setStatus(statuses.get(sessionId) ?? null)
    })
  }, [sessionId])

  return status
}
