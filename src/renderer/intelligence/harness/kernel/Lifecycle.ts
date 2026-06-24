/**
 * 生命周期参与者
 *
 * AbstractLifecycleParticipant 复用 @aweeclaw/harness-core，
 * 客户端 HealthStatus 与 kernel/observability 保持兼容。
 */

import { AbstractLifecycleParticipant as CoreAbstractLifecycleParticipant } from '@aweeclaw/harness-core'
import type { LifecyclePhase } from '@aweeclaw/harness-core'

export type { LifecyclePhase }

export interface HealthStatus {
  healthy: boolean
  message?: string
  details?: Record<string, unknown>
}

export interface LifecycleParticipant {
  readonly id: string
  readonly phase: LifecyclePhase
  readonly priority: number
  onStart(): Promise<void>
  onStop(): Promise<void>
  onHealthCheck?(): Promise<HealthStatus>
}

export const AbstractLifecycleParticipant = CoreAbstractLifecycleParticipant
