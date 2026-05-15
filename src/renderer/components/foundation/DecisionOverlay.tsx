import { useState, useCallback, createContext, useContext, type ReactNode, useEffect, useRef } from 'react'
import { AlertTriangle, Shield, Info, Clock, ShieldAlert, ShieldCheck } from 'lucide-react'
import { useStore } from '@store'
import { t } from '@renderer/i18n'
import { logger } from '@toolkit/LogEngine'
import { OverlayDialog } from '../ui/OverlayDialog'
import { ActionButton } from '../ui/ActionButton'

type DecisionSeverity = 'critical' | 'danger' | 'warning' | 'info'

interface DecisionOverlayProps {
  isOpen: boolean
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
  severity?: DecisionSeverity
  countdownSeconds?: number
  riskTag?: string
  auditAction?: string
  onConfirm: () => void
  onCancel: () => void
}

interface DecisionOptions {
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
  severity?: DecisionSeverity
  variant?: 'danger' | 'warning' | 'info'
  countdownSeconds?: number
  riskTag?: string
  auditAction?: string
}

interface DecisionContextType {
  decide: (options: DecisionOptions) => Promise<boolean>
}

const SEVERITY_CONFIG: Record<DecisionSeverity, {
  icon: typeof AlertTriangle
  iconClass: string
  buttonVariant: 'danger' | 'primary' | 'ghost'
  riskLevel: string
}> = {
  critical: {
    icon: ShieldAlert,
    iconClass: 'text-red-400 bg-red-500/15 border border-red-500/20',
    buttonVariant: 'danger',
    riskLevel: 'CRITICAL',
  },
  danger: {
    icon: ShieldAlert,
    iconClass: 'text-red-400 bg-red-500/10',
    buttonVariant: 'danger',
    riskLevel: 'HIGH',
  },
  warning: {
    icon: AlertTriangle,
    iconClass: 'text-yellow-400 bg-yellow-500/10',
    buttonVariant: 'primary',
    riskLevel: 'MEDIUM',
  },
  info: {
    icon: Info,
    iconClass: 'text-blue-400 bg-blue-500/10',
    buttonVariant: 'primary',
    riskLevel: 'LOW',
  },
}

function logAudit(action: string, result: boolean, details?: string) {
  logger.ui.info(`[DecisionAudit] action=${action} result=${result ? 'confirmed' : 'cancelled'}${details ? ` details=${details}` : ''}`)
}

export default function DecisionOverlay({
  isOpen,
  title,
  message,
  confirmText,
  cancelText,
  severity = 'warning',
  countdownSeconds = 0,
  riskTag,
  auditAction,
  onConfirm,
  onCancel,
}: DecisionOverlayProps) {
  const language = useStore((state) => state.language)
  const config = SEVERITY_CONFIG[severity]
  const Icon = config.icon
  const [countdown, setCountdown] = useState(countdownSeconds)
  const countdownRef = useRef<ReturnType<typeof setInterval>>()

  useEffect(() => {
    if (isOpen && countdownSeconds > 0) {
      setCountdown(countdownSeconds)
      countdownRef.current = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) {
            clearInterval(countdownRef.current)
            return 0
          }
          return prev - 1
        })
      }, 1000)
    }
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current)
    }
  }, [isOpen, countdownSeconds])

  const handleConfirm = useCallback(() => {
    if (countdown > 0) return
    if (auditAction) logAudit(auditAction, true, riskTag)
    onConfirm()
  }, [countdown, auditAction, riskTag, onConfirm])

  const handleCancel = useCallback(() => {
    if (auditAction) logAudit(auditAction, false, riskTag)
    onCancel()
  }, [auditAction, riskTag, onCancel])

  return (
    <OverlayDialog isOpen={isOpen} onClose={handleCancel} title={title} size="sm">
      <div className="flex items-start gap-4">
        <div className={`p-2.5 rounded-xl ${config.iconClass}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0 pt-1">
          <p className="text-sm text-text-secondary leading-relaxed">{message}</p>
          {(riskTag || severity === 'critical' || severity === 'danger') && (
            <div className="flex items-center gap-2 mt-3">
              {riskTag && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-surface/50 border border-border/50 text-text-muted">
                  <Shield className="w-3 h-3" />
                  {riskTag}
                </span>
              )}
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black ${
                severity === 'critical' ? 'bg-red-500/15 text-red-400 border border-red-500/20' :
                severity === 'danger' ? 'bg-red-500/10 text-red-400 border border-red-500/15' :
                severity === 'warning' ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/15' :
                'bg-blue-500/10 text-blue-400 border border-blue-500/15'
              }`}>
                {severity === 'critical' || severity === 'danger' ? <ShieldAlert className="w-3 h-3" /> : <ShieldCheck className="w-3 h-3" />}
                Risk: {config.riskLevel}
              </span>
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 mt-6">
        <ActionButton variant="ghost" size="sm" onClick={handleCancel}>
          {cancelText || t('cancel', language)}
        </ActionButton>
        <ActionButton
          variant={config.buttonVariant}
          size="sm"
          onClick={handleConfirm}
          disabled={countdown > 0}
          className={countdown > 0 ? 'opacity-50 cursor-not-allowed' : ''}
        >
          {countdown > 0 ? (
            <span className="flex items-center gap-1.5">
              <Clock className="w-3 h-3" />
              {countdown}s
            </span>
          ) : (
            confirmText || 'OK'
          )}
        </ActionButton>
      </div>
    </OverlayDialog>
  )
}

export function useDecisionOverlay() {
  const [state, setState] = useState<{
    isOpen: boolean
    options: DecisionOptions | null
    resolve: ((value: boolean) => void) | null
  }>({
    isOpen: false,
    options: null,
    resolve: null,
  })

  const decide = useCallback((options: DecisionOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setState({ isOpen: true, options, resolve })
    })
  }, [])

  const handleConfirm = useCallback(() => {
    if (state.options?.auditAction) logAudit(state.options.auditAction, true, state.options.riskTag)
    state.resolve?.(true)
    setState({ isOpen: false, options: null, resolve: null })
  }, [state.resolve, state.options])

  const handleCancel = useCallback(() => {
    if (state.options?.auditAction) logAudit(state.options.auditAction, false, state.options.riskTag)
    state.resolve?.(false)
    setState({ isOpen: false, options: null, resolve: null })
  }, [state.resolve, state.options])

  const OverlayComponent = state.options ? (
    <DecisionOverlay
      isOpen={state.isOpen}
      {...state.options}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  ) : null

  return { decide, OverlayComponent }
}

const DecisionContext = createContext<DecisionContextType | null>(null)

export function DecisionOverlayProvider({ children }: { children: ReactNode }) {
  const { decide, OverlayComponent } = useDecisionOverlay()

  return (
    <DecisionContext.Provider value={{ decide }}>
      {children}
      {OverlayComponent}
    </DecisionContext.Provider>
  )
}

export function useDecision() {
  const context = useContext(DecisionContext)
  if (!context) {
    throw new Error('useDecision must be used within DecisionOverlayProvider')
  }
  return context.decide
}

let globalResolve: ((value: boolean) => void) | null = null
let globalSetState: ((state: { isOpen: boolean; options: DecisionOptions | null }) => void) | null = null

export function GlobalDecisionOverlay() {
  const [state, setState] = useState<{
    isOpen: boolean
    options: DecisionOptions | null
  }>({
    isOpen: false,
    options: null,
  })

  useEffect(() => {
    globalSetState = setState
    return () => { globalSetState = null }
  }, [])

  const handleConfirm = useCallback(() => {
    if (state.options?.auditAction) logAudit(state.options.auditAction, true, state.options.riskTag)
    globalResolve?.(true)
    globalResolve = null
    setState({ isOpen: false, options: null })
  }, [state.options])

  const handleCancel = useCallback(() => {
    if (state.options?.auditAction) logAudit(state.options.auditAction, false, state.options.riskTag)
    globalResolve?.(false)
    globalResolve = null
    setState({ isOpen: false, options: null })
  }, [state.options])

  if (!state.options) return null

  return (
    <DecisionOverlay
      isOpen={state.isOpen}
      {...state.options}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  )
}

export function globalDecide(options: DecisionOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (!globalSetState) {
      logger.ui.warn('GlobalDecisionOverlay not mounted, canceling decision request')
      resolve(false)
      return
    }
    globalResolve = resolve
    globalSetState({ isOpen: true, options })
  })
}
