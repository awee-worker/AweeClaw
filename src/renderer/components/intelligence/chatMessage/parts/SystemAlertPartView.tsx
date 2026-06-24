/**
 * 系统警告 Part 视图
 */
import type { AssistantPart } from '@intelligence/providerTypes'
import type { PartRenderContext } from '../types'
import { SystemAlert } from '../../SystemAlert'
import type { AlertType } from '../../SystemAlert'

export function SystemAlertPartView(part: AssistantPart, ctx: PartRenderContext): React.ReactNode {
  const alertPart = part as {
    alertType?: AlertType
    title?: string
    message?: string
    suggestion?: string
    compact?: boolean
    action?: any
  }
  return (
    <SystemAlert
      type={alertPart.alertType || 'info'}
      title={alertPart.title}
      message={alertPart.message || ''}
      suggestion={alertPart.suggestion}
      compact={alertPart.compact}
      action={alertPart.action}
      onAction={(action) => {
        if (action.actionType === 'continue') {
          window.dispatchEvent(new CustomEvent('chat-send-message', {
            detail: { content: '继续执行未完成的任务', messageId: ctx.messageId }
          }))
        } else if (action.actionType === 'retry') {
          window.dispatchEvent(new CustomEvent('chat-retry-message', {
            detail: { messageId: ctx.messageId }
          }))
        } else if (action.actionType === 'open-settings') {
          window.dispatchEvent(new CustomEvent('chat-open-settings', {
            detail: { messageId: ctx.messageId }
          }))
        } else if (action.actionType === 'switch-model') {
          window.dispatchEvent(new CustomEvent('chat-switch-model', {
            detail: { messageId: ctx.messageId }
          }))
        } else if (action.actionType === 'dismiss') {
          // 关闭提示，直接忽略
        }
      }}
    />
  )
}
