import { logger } from '@shared/utils/Logger'
import type { ChannelId, OutboundMessage } from '@shared/types/channel'

export type RetryStrategy = 'exponential' | 'fixed' | 'none'

export interface RetryPolicy {
  maxRetries: number
  strategy: RetryStrategy
  baseDelayMs: number
  maxDelayMs: number
  retryableErrors: string[]
}

const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  strategy: 'exponential',
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  retryableErrors: [
    'rate_limit',
    'timeout',
    'network',
    'ECONNRESET',
    'ETIMEDOUT',
    'ENOTFOUND',
    'internal',
    'server_error',
  ],
}

interface PendingDelivery {
  message: OutboundMessage
  attempt: number
  nextRetryAt: number
  lastError?: string
  policy: RetryPolicy
}

class ChannelErrorHandler {
  private retryPolicies = new Map<ChannelId, RetryPolicy>()
  private pendingDeliveries: PendingDelivery[] = []
  private retryTimer: ReturnType<typeof setInterval> | null = null
  private deadLetterQueue: Array<{ message: OutboundMessage; error: string; attempts: number; failedAt: number }> = []

  constructor() {
    this.startRetryLoop()
  }

  setRetryPolicy(channelId: ChannelId, policy: Partial<RetryPolicy>): void {
    const existing = this.retryPolicies.get(channelId) || { ...DEFAULT_RETRY_POLICY }
    this.retryPolicies.set(channelId, { ...existing, ...policy })
  }

  getRetryPolicy(channelId: ChannelId): RetryPolicy {
    return this.retryPolicies.get(channelId) || { ...DEFAULT_RETRY_POLICY }
  }

  isRetryable(error: string, channelId: ChannelId): boolean {
    const policy = this.getRetryPolicy(channelId)
    const errorLower = error.toLowerCase()
    return policy.retryableErrors.some(retryable => errorLower.includes(retryable.toLowerCase()))
  }

  scheduleRetry(message: OutboundMessage, error: string): void {
    const policy = this.getRetryPolicy(message.channelId)
    const existing = this.pendingDeliveries.find(
      d => d.message.to === message.to && d.message.channelId === message.channelId && d.message.text === message.text
    )
    const attempt = existing ? existing.attempt + 1 : 1
    if (attempt > policy.maxRetries) {
      this.deadLetterQueue.push({
        message,
        error,
        attempts: attempt - 1,
        failedAt: Date.now(),
      })
      logger.channel.error(`Message to ${message.channelId}:${message.to} permanently failed after ${attempt - 1} retries: ${error}`)
      return
    }
    const delay = this.calculateDelay(attempt, policy)
    const pending: PendingDelivery = {
      message,
      attempt,
      nextRetryAt: Date.now() + delay,
      lastError: error,
      policy,
    }
    if (existing) {
      const idx = this.pendingDeliveries.indexOf(existing)
      this.pendingDeliveries[idx] = pending
    } else {
      this.pendingDeliveries.push(pending)
    }
    logger.channel.info(`Scheduled retry #${attempt} for ${message.channelId}:${message.to} in ${delay}ms`)
  }

  getPendingDeliveries(): PendingDelivery[] {
    return [...this.pendingDeliveries]
  }

  getDeadLetterQueue(): Array<{ message: OutboundMessage; error: string; attempts: number; failedAt: number }> {
    return [...this.deadLetterQueue]
  }

  clearDeadLetterQueue(): void {
    this.deadLetterQueue = []
  }

  removePendingDelivery(channelId: ChannelId, to: string): void {
    this.pendingDeliveries = this.pendingDeliveries.filter(
      d => !(d.message.channelId === channelId && d.message.to === to)
    )
  }

  destroy(): void {
    if (this.retryTimer) {
      clearInterval(this.retryTimer)
      this.retryTimer = null
    }
    this.pendingDeliveries = []
  }

  private calculateDelay(attempt: number, policy: RetryPolicy): number {
    switch (policy.strategy) {
      case 'exponential': {
        const delay = policy.baseDelayMs * Math.pow(2, attempt - 1)
        const jitter = Math.random() * policy.baseDelayMs
        return Math.min(delay + jitter, policy.maxDelayMs)
      }
      case 'fixed':
        return policy.baseDelayMs
      case 'none':
        return 0
    }
  }

  private startRetryLoop(): void {
    this.retryTimer = setInterval(() => this.processRetries(), 5000)
  }

  private async processRetries(): Promise<void> {
    const now = Date.now()
    const ready = this.pendingDeliveries.filter(d => d.nextRetryAt <= now)
    for (const delivery of ready) {
      const idx = this.pendingDeliveries.indexOf(delivery)
      if (idx >= 0) {
        this.pendingDeliveries.splice(idx, 1)
      }
      try {
        const { channelRegistry } = await import('./ChannelRegistry')
        const result = await channelRegistry.sendMessage(delivery.message)
        if (!result.success && this.isRetryable(result.error || '', delivery.message.channelId)) {
          this.scheduleRetry(delivery.message, result.error || 'unknown')
        } else if (!result.success) {
          this.deadLetterQueue.push({
            message: delivery.message,
            error: result.error || 'non-retryable error',
            attempts: delivery.attempt,
            failedAt: Date.now(),
          })
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (this.isRetryable(msg, delivery.message.channelId)) {
          this.scheduleRetry(delivery.message, msg)
        }
      }
    }
  }
}

export const channelErrorHandler = new ChannelErrorHandler()
