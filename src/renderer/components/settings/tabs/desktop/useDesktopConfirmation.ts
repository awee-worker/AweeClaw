/**
 * 桌面控制权限确认 Hook
 * 监听主进程的权限确认请求，弹出确认对话框
 */

import { useEffect } from 'react'
import { type Language, t } from '@renderer/i18n'
import { globalDecide as globalConfirm } from '@components/foundation/DecisionOverlay'
import { logger } from '@renderer/toolkit/LogEngine'

export function useDesktopConfirmation(language: Language): void {
  useEffect(() => {
    if (!window.electronAPI?.onDesktopConfirmationRequest) return

    const unsubscribe = window.electronAPI.onDesktopConfirmationRequest(async (request: any) => {
      logger.desktop?.info?.('[DesktopConfirmation] Request received:', request)

      const riskColors: Record<string, string> = {
        low: 'info',
        medium: 'warning',
        high: 'danger',
      }

      const result = await globalConfirm({
        title: `${request.operationLabel} - 权限确认`,
        message: request.message,
        confirmText: t('common.allow', language) || '允许',
        cancelText: t('common.deny', language) || '拒绝',
        variant: (riskColors[request.riskLevel] || 'warning') as any,
      })

      const approved = result === true || result === 'save'
      const remember = result === 'save'

      // 回传给主进程
      if (window.electronAPI?.desktopResolveConfirmation) {
        await window.electronAPI.desktopResolveConfirmation(request.id, { approved, remember })
      }
    })

    return () => {
      if (unsubscribe) unsubscribe()
    }
  }, [language])
}
