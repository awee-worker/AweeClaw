import { logger } from '@utils/Logger'
import type { LifecycleParticipant, HealthStatus } from '../kernel/Lifecycle'
import type { LifecyclePhase, LifecyclePhaseTransition } from './Phase'

export class LifecycleManager {
  private participants: LifecycleParticipant[] = []
  private phase: LifecyclePhase = 'init'
  private transitions: LifecyclePhaseTransition[] = []
  private shutdownHooks: Array<() => Promise<void>> = []
  private shutdownTimeoutMs: number
  private listeners = new Set<(transition: LifecyclePhaseTransition) => void>()

  constructor(shutdownTimeoutMs = 10000) {
    this.shutdownTimeoutMs = shutdownTimeoutMs
  }

  register(participant: LifecycleParticipant): void {
    if (this.phase !== 'init' && this.phase !== 'ready') {
      throw new Error(`[LifecycleManager] Cannot register participant "${participant.id}" in phase "${this.phase}"`)
    }
    this.participants.push(participant)
    this.participants.sort((a, b) => a.priority - b.priority)
    logger.agent.info(`[LifecycleManager] Registered participant: ${participant.id} (priority: ${participant.priority})`)
  }

  unregister(participantId: string): void {
    this.participants = this.participants.filter(p => p.id !== participantId)
  }

  async start(): Promise<void> {
    if (this.phase !== 'init') {
      throw new Error(`[LifecycleManager] Cannot start from phase "${this.phase}"`)
    }

    this.transition('starting')

    for (const participant of this.participants) {
      try {
        logger.agent.info(`[LifecycleManager] Starting: ${participant.id}`)
        await participant.onStart()
        logger.agent.info(`[LifecycleManager] Started: ${participant.id}`)
      } catch (error) {
        logger.agent.error(`[LifecycleManager] Failed to start ${participant.id}: ${error instanceof Error ? error.message : error}`)
        this.transition('error')
        throw error
      }
    }

    this.transition('ready')
    this.transition('running')
    logger.agent.info(`[LifecycleManager] All ${this.participants.length} participants started successfully`)
  }

  async shutdown(reason?: string): Promise<void> {
    if (this.phase === 'stopped' || this.phase === 'stopping') return

    logger.agent.info(`[LifecycleManager] Shutting down${reason ? `: ${reason}` : ''}`)
    this.transition('stopping')

    const shutdownPromise = this.executeShutdown()
    const timeoutPromise = new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error('Shutdown timeout')), this.shutdownTimeoutMs)
    )

    try {
      await Promise.race([shutdownPromise, timeoutPromise])
    } catch (error) {
      logger.agent.error(`[LifecycleManager] Shutdown error: ${error instanceof Error ? error.message : error}`)
    }

    for (const hook of this.shutdownHooks) {
      try {
        await hook()
      } catch {
        // swallow
      }
    }

    this.transition('stopped')
    logger.agent.info('[LifecycleManager] Shutdown complete')
  }

  addShutdownHook(hook: () => Promise<void>): void {
    this.shutdownHooks.push(hook)
  }

  async healthCheck(): Promise<Record<string, HealthStatus>> {
    const results: Record<string, HealthStatus> = {}
    for (const participant of this.participants) {
      if (participant.onHealthCheck) {
        try {
          results[participant.id] = await participant.onHealthCheck()
        } catch (error) {
          results[participant.id] = {
            healthy: false,
            message: error instanceof Error ? error.message : String(error),
          }
        }
      }
    }
    return results
  }

  getPhase(): LifecyclePhase {
    return this.phase
  }

  getParticipants(): ReadonlyArray<LifecycleParticipant> {
    return this.participants
  }

  getTransitions(): LifecyclePhaseTransition[] {
    return [...this.transitions]
  }

  addListener(listener: (transition: LifecyclePhaseTransition) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private async executeShutdown(): Promise<void> {
    const reversed = [...this.participants].reverse()
    for (const participant of reversed) {
      try {
        logger.agent.info(`[LifecycleManager] Stopping: ${participant.id}`)
        await participant.onStop()
        logger.agent.info(`[LifecycleManager] Stopped: ${participant.id}`)
      } catch (error) {
        logger.agent.error(`[LifecycleManager] Error stopping ${participant.id}: ${error instanceof Error ? error.message : error}`)
      }
    }
  }

  private transition(to: LifecyclePhase): void {
    const from = this.phase
    this.phase = to
    const transition: LifecyclePhaseTransition = { from, to, timestamp: Date.now() }
    this.transitions.push(transition)
    logger.agent.info(`[LifecycleManager] Phase: ${from} → ${to}`)
    for (const listener of this.listeners) {
      try {
        listener(transition)
      } catch {
        // swallow
      }
    }
  }
}
