import { logger } from '@shared/utils/Logger'
import { channelRegistry } from './ChannelRegistry'
import type {
  ChannelId,
  InboundMessage,
  OutboundMessage,
  OutboundResult,
  ChannelAccountConfig,
} from '@shared/types/channel'

export interface RouteRule {
  id: string
  name: string
  enabled: boolean
  sourceChannelId?: ChannelId
  sourceAccountId?: string
  sourceChatType?: string
  sourceFrom?: string
  targetChannelId: ChannelId
  targetAccountId?: string
  targetTo: string
  transform?: 'none' | 'prefix-channel' | 'prefix-sender' | 'custom'
  customTransform?: (message: InboundMessage) => string
}

export interface BroadcastTarget {
  channelId: ChannelId
  accountId?: string
  to: string
}

class MessageRouter {
  private rules: RouteRule[] = []
  private inboundProcessors: Array<(message: InboundMessage) => InboundMessage | null> = []
  private outboundProcessors: Array<(message: OutboundMessage) => OutboundMessage | null> = []

  constructor() {
    channelRegistry.onMessage(msg => this.handleInboundMessage(msg))
  }

  addRule(rule: RouteRule): void {
    this.rules.push(rule)
    logger.channel.info(`Added route rule: ${rule.name} (${rule.id})`)
  }

  removeRule(ruleId: string): void {
    this.rules = this.rules.filter(r => r.id !== ruleId)
  }

  getRules(): RouteRule[] {
    return [...this.rules]
  }

  setRules(rules: RouteRule[]): void {
    this.rules = rules
  }

  addInboundProcessor(processor: (message: InboundMessage) => InboundMessage | null): () => void {
    this.inboundProcessors.push(processor)
    return () => {
      const idx = this.inboundProcessors.indexOf(processor)
      if (idx >= 0) this.inboundProcessors.splice(idx, 1)
    }
  }

  addOutboundProcessor(processor: (message: OutboundMessage) => OutboundMessage | null): () => void {
    this.outboundProcessors.push(processor)
    return () => {
      const idx = this.outboundProcessors.indexOf(processor)
      if (idx >= 0) this.outboundProcessors.splice(idx, 1)
    }
  }

  async sendToChannel(message: OutboundMessage): Promise<OutboundResult> {
    const processed = this.processOutbound(message)
    if (!processed) {
      return { success: false, error: 'Message filtered by outbound processor' }
    }
    return channelRegistry.sendMessage(processed)
  }

  async broadcast(text: string, targets: BroadcastTarget[]): Promise<OutboundResult[]> {
    const results: OutboundResult[] = []
    for (const target of targets) {
      const message: OutboundMessage = {
        channelId: target.channelId,
        accountId: target.accountId,
        to: target.to,
        text,
      }
      const result = await this.sendToChannel(message)
      results.push(result)
    }
    return results
  }

  async replyToMessage(originalMessage: InboundMessage, text: string, accountId?: string): Promise<OutboundResult> {
    const message: OutboundMessage = {
      channelId: originalMessage.channelId,
      accountId: accountId || originalMessage.accountId,
      to: originalMessage.chatType === 'group' ? originalMessage.to : originalMessage.from,
      text,
      chatType: originalMessage.chatType,
      replyToId: originalMessage.id,
    }
    return this.sendToChannel(message)
  }

  private handleInboundMessage(message: InboundMessage): void {
    const processed = this.processInbound(message)
    if (!processed) return
    const matchedRules = this.findMatchingRules(processed)
    for (const rule of matchedRules) {
      this.applyRoute(processed, rule).catch(err => {
        logger.channel.error(`Route rule ${rule.id} failed: ${err}`)
      })
    }
  }

  private processInbound(message: InboundMessage): InboundMessage | null {
    let result: InboundMessage | null = message
    for (const processor of this.inboundProcessors) {
      if (!result) return null
      result = processor(result)
    }
    return result
  }

  private processOutbound(message: OutboundMessage): OutboundMessage | null {
    let result: OutboundMessage | null = message
    for (const processor of this.outboundProcessors) {
      if (!result) return null
      result = processor(result)
    }
    return result
  }

  private findMatchingRules(message: InboundMessage): RouteRule[] {
    return this.rules.filter(rule => {
      if (!rule.enabled) return false
      if (rule.sourceChannelId && rule.sourceChannelId !== message.channelId) return false
      if (rule.sourceAccountId && rule.sourceAccountId !== message.accountId) return false
      if (rule.sourceChatType && rule.sourceChatType !== message.chatType) return false
      if (rule.sourceFrom && rule.sourceFrom !== message.from) return false
      return true
    })
  }

  private async applyRoute(message: InboundMessage, rule: RouteRule): Promise<void> {
    let text = message.text
    switch (rule.transform) {
      case 'prefix-channel':
        text = `[${message.channelId}] ${text}`
        break
      case 'prefix-sender':
        text = `[${message.fromName || message.from}] ${text}`
        break
      case 'custom':
        if (rule.customTransform) {
          text = rule.customTransform(message)
        }
        break
    }
    const outbound: OutboundMessage = {
      channelId: rule.targetChannelId,
      accountId: rule.targetAccountId,
      to: rule.targetTo,
      text,
    }
    const result = await channelRegistry.sendMessage(outbound)
    if (!result.success) {
      logger.channel.error(`Route ${rule.id} delivery failed: ${result.error}`)
    }
  }
}

export const messageRouter = new MessageRouter()
