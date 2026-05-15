import { logger } from '@shared/toolkit/LogEngine'
import type { InboundMessage, ChannelId, DmPolicy, GroupPolicy, ChannelAccountConfig } from '@shared/protocols/channel'

interface SecurityPolicy {
  dmPolicy: DmPolicy
  allowFrom: string[]
  groupPolicy: GroupPolicy
  groupAllowFrom: string[]
  blockedUsers: string[]
  rateLimitPerMinute: number
  maxMessageLength: number
}

const DEFAULT_SECURITY_POLICY: SecurityPolicy = {
  dmPolicy: 'open',
  allowFrom: [],
  groupPolicy: 'open',
  groupAllowFrom: [],
  blockedUsers: [],
  rateLimitPerMinute: 30,
  maxMessageLength: 4000,
}

interface RateLimitEntry {
  count: number
  windowStart: number
}

class ChannelSecurityManager {
  private policies = new Map<string, SecurityPolicy>()
  private rateLimitCounters = new Map<string, RateLimitEntry>()
  private pairingRequests = new Map<string, { from: string; channelId: ChannelId; timestamp: number }>()

  setPolicy(accountKey: string, policy: Partial<SecurityPolicy>): void {
    const existing = this.policies.get(accountKey) || { ...DEFAULT_SECURITY_POLICY }
    this.policies.set(accountKey, { ...existing, ...policy })
  }

  getPolicy(accountKey: string): SecurityPolicy {
    return this.policies.get(accountKey) || { ...DEFAULT_SECURITY_POLICY }
  }

  validateInboundMessage(message: InboundMessage, _account: ChannelAccountConfig): { allowed: boolean; reason?: string } {
    const accountKey = `${message.channelId}:${message.accountId}`
    const policy = this.getPolicy(accountKey)

    if (policy.blockedUsers.includes(message.from)) {
      logger.channel.warn(`Blocked message from ${message.from} on ${message.channelId}`)
      return { allowed: false, reason: 'User blocked' }
    }

    if (message.text.length > policy.maxMessageLength) {
      return { allowed: false, reason: 'Message too long' }
    }

    if (message.chatType === 'direct') {
      return this.validateDmPolicy(message, policy)
    } else if (message.chatType === 'group') {
      return this.validateGroupPolicy(message, policy)
    }

    return { allowed: true }
  }

  checkRateLimit(identifier: string, limitPerMinute: number): { allowed: boolean; remaining: number } {
    const now = Date.now()
    const entry = this.rateLimitCounters.get(identifier)

    if (!entry || now - entry.windowStart > 60_000) {
      this.rateLimitCounters.set(identifier, { count: 1, windowStart: now })
      return { allowed: true, remaining: limitPerMinute - 1 }
    }

    if (entry.count >= limitPerMinute) {
      return { allowed: false, remaining: 0 }
    }

    entry.count++
    return { allowed: true, remaining: limitPerMinute - entry.count }
  }

  requestPairing(pairingId: string, from: string, channelId: ChannelId): void {
    this.pairingRequests.set(pairingId, { from, channelId, timestamp: Date.now() })
    logger.channel.info(`Pairing request from ${from} on ${channelId}, id: ${pairingId}`)
  }

  approvePairing(pairingId: string): { from: string; channelId: ChannelId } | null {
    const request = this.pairingRequests.get(pairingId)
    if (!request) return null
    if (Date.now() - request.timestamp > 5 * 60 * 1000) {
      this.pairingRequests.delete(pairingId)
      return null
    }
    this.pairingRequests.delete(pairingId)
    return { from: request.from, channelId: request.channelId }
  }

  cleanup(): void {
    const now = Date.now()
    for (const [key, entry] of this.rateLimitCounters) {
      if (now - entry.windowStart > 60_000) {
        this.rateLimitCounters.delete(key)
      }
    }
    for (const [key, request] of this.pairingRequests) {
      if (now - request.timestamp > 5 * 60 * 1000) {
        this.pairingRequests.delete(key)
      }
    }
  }

  private validateDmPolicy(message: InboundMessage, policy: SecurityPolicy): { allowed: boolean; reason?: string } {
    switch (policy.dmPolicy) {
      case 'open':
        return { allowed: true }
      case 'allowlist':
        if (policy.allowFrom.length === 0 || policy.allowFrom.includes(message.from)) {
          return { allowed: true }
        }
        return { allowed: false, reason: 'User not in DM allowlist' }
      case 'pairing':
        if (policy.allowFrom.includes(message.from)) {
          return { allowed: true }
        }
        return { allowed: false, reason: 'Pairing required' }
      case 'disabled':
        return { allowed: false, reason: 'DM disabled' }
      default:
        return { allowed: false, reason: 'Unknown DM policy' }
    }
  }

  private validateGroupPolicy(message: InboundMessage, policy: SecurityPolicy): { allowed: boolean; reason?: string } {
    switch (policy.groupPolicy) {
      case 'open':
        return { allowed: true }
      case 'allowlist':
        if (policy.groupAllowFrom.length === 0 || policy.groupAllowFrom.includes(message.to)) {
          return { allowed: true }
        }
        return { allowed: false, reason: 'Group not in allowlist' }
      case 'disabled':
        return { allowed: false, reason: 'Group messages disabled' }
      default:
        return { allowed: false, reason: 'Unknown group policy' }
    }
  }
}

export const channelSecurityManager = new ChannelSecurityManager()
