import { BrowserWindow } from 'electron'
import { logger } from '@shared/utils/Logger'
import { channelService } from './ChannelService'
import { channelRegistry } from './ChannelRegistry'
import type { InboundMessage, OutboundMessage, OutboundResult } from '@shared/types/channel'

class ChannelBridge {
  private getMainWindow: (() => BrowserWindow | null) | null = null
  private activeConversations = new Map<string, { channelId: string; accountId: string; from: string; chatType: string; to: string }>()

  init(getMainWindow: () => BrowserWindow | null): void {
    this.getMainWindow = getMainWindow
    channelService.onInboundMessage(msg => this.handleInboundMessage(msg))
    logger.channel.info('Channel bridge initialized')
  }

  private handleInboundMessage(message: InboundMessage): void {
    const win = this.getMainWindow?.()
    if (!win || win.isDestroyed()) {
      logger.channel.warn('No main window available, dropping inbound message')
      return
    }

    const conversationKey = `${message.channelId}:${message.chatType === 'group' ? message.to : message.from}`
    this.activeConversations.set(conversationKey, {
      channelId: message.channelId,
      accountId: message.accountId,
      from: message.from,
      chatType: message.chatType,
      to: message.to,
    })

    win.webContents.send('channel:inboundMessage', {
      id: message.id,
      channelId: message.channelId,
      accountId: message.accountId,
      chatType: message.chatType,
      from: message.from,
      fromName: message.fromName,
      to: message.to,
      text: message.text,
      media: message.media,
      replyToId: message.replyToId,
      threadId: message.threadId,
      timestamp: message.timestamp,
      conversationKey,
    })

    logger.channel.info(`Bridged inbound message from ${message.channelId}:${message.from}`)
  }

  async sendReply(conversationKey: string, text: string): Promise<OutboundResult> {
    const conversation = this.activeConversations.get(conversationKey)
    if (!conversation) {
      return { success: false, error: 'No active conversation found for key: ' + conversationKey }
    }

    const outbound: OutboundMessage = {
      channelId: conversation.channelId as any,
      accountId: conversation.accountId,
      to: conversation.chatType === 'group' ? conversation.to : conversation.from,
      text,
      chatType: conversation.chatType as any,
    }

    try {
      const result = await channelService.sendMessage(outbound)
      logger.channel.info(`Reply sent to ${conversation.channelId}:${conversation.from}, success=${result.success}`)
      return result
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.channel.error(`Failed to send reply: ${msg}`)
      return { success: false, error: msg }
    }
  }
}

export const channelBridge = new ChannelBridge()
