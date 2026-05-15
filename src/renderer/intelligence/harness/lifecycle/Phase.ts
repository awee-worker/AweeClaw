export type LifecyclePhase = 'init' | 'starting' | 'ready' | 'running' | 'stopping' | 'stopped' | 'error'

export interface LifecyclePhaseTransition {
  from: LifecyclePhase
  to: LifecyclePhase
  timestamp: number
  participantId?: string
}
