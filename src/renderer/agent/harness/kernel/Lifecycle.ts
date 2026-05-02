export type LifecyclePhase = 'init' | 'ready' | 'running' | 'stopping' | 'stopped'

export interface LifecycleParticipant {
  readonly id: string
  readonly phase: LifecyclePhase
  readonly priority: number
  onStart(): Promise<void>
  onStop(): Promise<void>
  onHealthCheck?(): Promise<HealthStatus>
}

export interface HealthStatus {
  healthy: boolean
  message?: string
  details?: Record<string, unknown>
}

export abstract class AbstractLifecycleParticipant implements LifecycleParticipant {
  readonly abstract id: string
  readonly abstract priority: number
  private _phase: LifecyclePhase = 'init'

  get phase(): LifecyclePhase {
    return this._phase
  }

  protected setPhase(phase: LifecyclePhase): void {
    this._phase = phase
  }

  async onStart(): Promise<void> {
    this._phase = 'ready'
  }

  async onStop(): Promise<void> {
    this._phase = 'stopped'
  }

  async onHealthCheck?(): Promise<HealthStatus>
}
