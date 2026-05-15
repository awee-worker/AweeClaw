import React, { Component, ErrorInfo, ReactNode } from 'react'
import { AlertTriangle, RefreshCw, Home, Bug, Shield, Copy, CheckCircle } from 'lucide-react'
import { AppError, formatErrorMessage } from '@shared/exceptions'
import { logger } from '@shared/toolkit/LogEngine'
import { t } from '@renderer/i18n'
import { useStore } from '@store'

interface CrashGuardProps {
  children: ReactNode
  fallback?: ReactNode
  onError?: (error: Error, errorInfo: ErrorInfo) => void
  showDetails?: boolean
  isolate?: boolean
  componentName?: string
}

interface CrashGuardState {
  hasCrashed: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
  errorId: string
  copiedToClipboard: boolean
}

function generateErrorId(): string {
  return `ERR-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
}

export class CrashGuard extends Component<CrashGuardProps, CrashGuardState> {
  constructor(props: CrashGuardProps) {
    super(props)
    this.state = {
      hasCrashed: false,
      error: null,
      errorInfo: null,
      errorId: '',
      copiedToClipboard: false,
    }
  }

  static getDerivedStateFromError(error: Error): Partial<CrashGuardState> {
    return { hasCrashed: true, error, errorId: generateErrorId() }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo })

    this.props.onError?.(error, errorInfo)

    logger.ui.error(`[CrashGuard]${this.props.componentName ? ` <${this.props.componentName}>` : ''} Caught error:`, error)
    logger.ui.error('[CrashGuard] Component stack:', { componentStack: errorInfo.componentStack })
  }

  handleRecover = (): void => {
    this.setState({ hasCrashed: false, error: null, errorInfo: null, errorId: '', copiedToClipboard: false })
  }

  handleReload = (): void => {
    window.location.reload()
  }

  handleCopyErrorInfo = async (): Promise<void> => {
    const { error, errorInfo, errorId } = this.state
    const info = [
      `AweeClaw Error Report`,
      `Error ID: ${errorId}`,
      `Time: ${new Date().toISOString()}`,
      `Component: ${this.props.componentName || 'unknown'}`,
      ``,
      `Error: ${error?.message || 'Unknown'}`,
      ``,
      `Stack:`,
      error?.stack || 'N/A',
      ``,
      `Component Stack:`,
      errorInfo?.componentStack || 'N/A',
    ].join('\n')

    try {
      await navigator.clipboard.writeText(info)
      this.setState({ copiedToClipboard: true })
      setTimeout(() => this.setState({ copiedToClipboard: false }), 2000)
    } catch { /* ignore clipboard errors */ }
  }

  render(): ReactNode {
    if (this.state.hasCrashed) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      const { error, errorInfo, errorId, copiedToClipboard } = this.state
      const language = useStore.getState().language
      const appError = error ? AppError.fromError(error) : null
      const { title, description, suggestion } = appError?.getUserMessage() || {
        title: t('errorBoundary.somethingWentWrong', language),
        description: t('errorBoundary.unexpectedError', language),
        suggestion: t('errorBoundary.trySuggestion', language),
      }

      return (
        <div className="flex flex-col items-center justify-center min-h-[300px] p-8 bg-[var(--bg-primary)] text-[var(--text-primary)]">
          <div className="flex flex-col items-center max-w-md text-center">
            <div className="relative mb-5">
              <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/15 flex items-center justify-center">
                <AlertTriangle className="w-8 h-8 text-red-500" />
              </div>
              {this.props.isolate && (
                <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-yellow-500/20 border border-yellow-500/30 flex items-center justify-center">
                  <Shield className="w-3 h-3 text-yellow-500" />
                </div>
              )}
            </div>

            <h2 className="text-xl font-bold mb-2">{title}</h2>
            <p className="text-[var(--text-secondary)] mb-3 text-sm">{description}</p>

            {suggestion && (
              <p className="text-sm text-[var(--text-tertiary)] mb-5 flex items-center gap-1.5">
                <Bug className="w-3.5 h-3.5" />
                {suggestion}
              </p>
            )}

            <div className="flex items-center gap-1.5 mb-5 px-3 py-1.5 rounded-full bg-surface/50 border border-border/30">
              <span className="text-[10px] font-mono text-text-muted/60">ID: {errorId}</span>
            </div>

            <div className="flex gap-2.5">
              <button
                onClick={this.handleRecover}
                className="flex items-center gap-2 px-4 py-2 bg-[var(--accent-primary)] text-white rounded-lg hover:bg-[var(--accent-primary-hover)] transition-colors text-sm font-medium"
              >
                <RefreshCw className="w-4 h-4" />
                {t('errorBoundary.tryAgain', language)}
              </button>
              <button
                onClick={this.handleReload}
                className="flex items-center gap-2 px-4 py-2 bg-[var(--bg-secondary)] text-[var(--text-primary)] rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors text-sm font-medium"
              >
                <Home className="w-4 h-4" />
                {t('errorBoundary.reloadApp', language)}
              </button>
              <button
                onClick={this.handleCopyErrorInfo}
                className="flex items-center gap-2 px-3 py-2 bg-[var(--bg-secondary)] text-[var(--text-secondary)] rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors text-sm"
                title="Copy error info"
              >
                {copiedToClipboard ? <CheckCircle className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>

            {error && (
              <details className="mt-5 w-full text-left" open>
                <summary className="cursor-pointer text-[12px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] font-medium">
                  Error Details
                </summary>
                <div className="mt-2 p-3 bg-[var(--bg-secondary)] rounded-lg overflow-auto max-h-[180px]">
                  <pre className="text-[11px] text-red-400 whitespace-pre-wrap font-mono leading-relaxed">
                    {error.message}
                    {error.stack && <>{'\n\nStack:\n'}{error.stack}</>}
                    {errorInfo?.componentStack && <>{'\n\nComponent Stack:\n'}{errorInfo.componentStack}</>}
                  </pre>
                </div>
              </details>
            )}
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

export function withCrashGuard<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  options?: Omit<CrashGuardProps, 'children'>
): React.FC<P> {
  const displayName = WrappedComponent.displayName || WrappedComponent.name || 'Component'

  const GuardedComponent: React.FC<P> = (props) => (
    <CrashGuard {...options} componentName={displayName}>
      <WrappedComponent {...props} />
    </CrashGuard>
  )

  GuardedComponent.displayName = `withCrashGuard(${displayName})`

  return GuardedComponent
}

interface FaultNoticeProps {
  error: Error | string | null
  onDismiss?: () => void
  className?: string
}

export const FaultNotice: React.FC<FaultNoticeProps> = ({ error, onDismiss, className = '' }) => {
  if (!error) return null

  const message = typeof error === 'string' ? error : formatErrorMessage(error)

  return (
    <div className={`flex items-start gap-3 p-4 bg-red-500/8 border border-red-500/15 rounded-xl ${className}`}>
      <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-[13px] text-red-400 whitespace-pre-wrap leading-relaxed">{message}</p>
      </div>
      {onDismiss && (
        <button onClick={onDismiss} className="text-red-400/60 hover:text-red-300 transition-colors text-lg leading-none">×</button>
      )}
    </div>
  )
}

export default CrashGuard
