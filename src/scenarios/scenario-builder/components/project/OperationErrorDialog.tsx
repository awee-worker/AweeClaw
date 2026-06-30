/**
 * 操作失败弹窗
 *
 * 当校验 / 构建 / 打包 / 安装 / 发布 任一操作失败时弹出，
 * 明确展示失败的操作、项目名与错误详情，便于用户定位问题。
 *
 * 与右上角的 inline toast 互补：toast 仅作轻提示，弹窗用于强制提醒。
 */
import type React from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '@renderer/i18n'
import type { OpErrorInfo } from '../../hooks/useProjectOperations'

interface Props {
  error: OpErrorInfo | null
  onClose: () => void
}

const OperationErrorDialog: React.FC<Props> = ({ error, onClose }) => {
  const { t } = useI18n()
  if (!error) return null

  /** 格式化时间戳为本地可读时间 */
  const timeStr = new Date(error.timestamp).toLocaleTimeString()

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-text-inverted/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg mx-4 rounded-2xl border border-border/50 bg-background/95 backdrop-blur-xl shadow-2xl shadow-black/20 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部：错误标识 + 关闭按钮 */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border/50 bg-destructive/5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-bold text-text-primary">
              {error.operationLabel}
              {t('builder.action.failedSuffix')}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t('builder.action.errorProject')}: <span className="font-medium text-text-secondary">{error.projectName}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title={t('builder.action.close')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* 主体：错误消息 + 详情 */}
        <div className="px-5 py-4">
          <div className="mb-2 text-xs font-medium text-muted-foreground">
            {t('builder.action.errorMessage')}
          </div>
          <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm text-text-primary break-all">
            {error.message}
          </div>

          {error.detail && error.detail !== error.message && (
            <>
              <div className="mb-2 mt-4 text-xs font-medium text-muted-foreground">
                {t('builder.action.errorDetail')}
              </div>
              <pre className="max-h-48 overflow-auto rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs font-mono whitespace-pre-wrap break-all text-text-secondary">
                {error.detail}
              </pre>
            </>
          )}

          <div className="mt-3 text-xs text-muted-foreground">
            {t('builder.action.errorTime')}: {timeStr}
          </div>
        </div>

        {/* 底部：操作按钮 */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border/50">
          <button
            onClick={onClose}
            className="rounded-lg border border-accent/40 bg-accent/10 px-4 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/20"
          >
            {t('builder.action.close')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export default OperationErrorDialog
