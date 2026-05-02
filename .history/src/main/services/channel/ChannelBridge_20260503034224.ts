import { BrowserWindow } from 'electron'
import { logger } from '@shared/utils/Logger'
import { channelService } from './ChannelService'
import { SyncService } from '../llm/services/SyncService'
import { resolveRuntimeLLMConfig } from '@shared/config/llmConfigResolver'
import type { InboundMessage, OutboundMessage, OutboundResult } from '@shared/types/channel'
import type { LLMConfig, LLMMessage } from '@shared/types'
import type { Store } from 'electron-store'

const CHANNEL_LABELS: Record<string, string> = {
  feishu: '飞书',
  wechat: '微信',
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  dingtalk: '钉钉',
  slack: 'Slack',
}

class ChannelBridge {
  private getMainWindow: (() => BrowserWindow | null) | null = null
  private activeConversations = new Map<string, { channelId: string; accountId: string; from: string; chatType: string; to: string }>()
  private syncService: SyncService
  private configStore: Store<Record<string, unknown>> | null = null
  private processingMessages = new Set<string>()

  constructor() {
    this.syncService = new SyncService()
  }

  init(getMainWindow: () => BrowserWindow | null, configStore?: Store<Record<string, unknown>>): void {
    this.getMainWindow = getMainWindow
    this.configStore = configStore || null
    channelService.onInboundMessage(msg => this.handleInboundMessage(msg))
    logger.channel.info('[ChannelBridge] Initialized, listening for inbound messages')
  }

  private getLLMConfig(): LLMConfig | null {
    if (!this.configStore) {
      logger.channel.warn('[ChannelBridge] No configStore available')
      return null
    }

    try {
      const appSettings = this.configStore.get('app-settings') as any
      if (!appSettings) {
        logger.channel.warn('[ChannelBridge] No app-settings found in configStore')
        return null
      }

      const llmConfig = resolveRuntimeLLMConfig(
        appSettings.llmConfig,
        appSettings.providerConfigs || {},
      )

      if (!llmConfig.apiKey) {
        logger.channel.warn('[ChannelBridge] No API key configured in LLM config')
        return null
      }

      return llmConfig
    } catch (err) {
      logger.channel.error(`[ChannelBridge] Failed to resolve LLM config: ${err}`)
      return null
    }
  }

  private async handleInboundMessage(message: InboundMessage): Promise<void> {
    logger.channel.info(`[ChannelBridge] handleInboundMessage: channelId=${message.channelId}, from=${message.from}, text=${message.text?.slice(0, 50)}`)

    const conversationKey = `${message.channelId}:${message.chatType === 'group' ? message.to : message.from}`
    this.activeConversations.set(conversationKey, {
      channelId: message.channelId,
      accountId: message.accountId,
      from: message.from,
      chatType: message.chatType,
      to: message.to,
    })

    this.forwardToRenderer(message, conversationKey)

    if (this.processingMessages.has(message.id)) {
      logger.channel.info(`[ChannelBridge] Message ${message.id} already being processed, skipping`)
      return
    }
    this.processingMessages.add(message.id)

    try {
      const llmConfig = this.getLLMConfig()
      if (!llmConfig) {
        logger.channel.warn('[ChannelBridge] Cannot process message: no LLM config available')
        return
      }

      const channelLabel = CHANNEL_LABELS[message.channelId] || message.channelId
      const senderLabel = message.fromName || message.from

      const systemPrompt = `你是一个多渠道消息助手。当前消息来自${channelLabel}平台的用户${senderLabel}。请直接回复用户的问题，回复内容将被发送回${channelLabel}平台。回复时不需要包含平台标识和发送者名称，直接给出回答即可。`

      const messages: LLMMessage[] = [
        {
          role: 'user',
          content: message.text,
        },
      ]

      logger.channel.info(`[ChannelBridge] Calling LLM for message from ${senderLabel}: ${message.text.slice(0, 80)}`)

      const result = await this.syncService.generate({
        config: llmConfig,
        messages,
        systemPrompt,
      })

      const replyText = result.data?.trim()
      if (!replyText) {
        logger.channel.warn('[ChannelBridge] LLM returned empty response')
        return
      }

      logger.channel.info(`[ChannelBridge] LLM response (${replyText.length} chars): ${replyText.slice(0, 80)}`)

      const sendResult = await this.sendReply(conversationKey, replyText)
      if (sendResult.success) {
        logger.channel.info(`[ChannelBridge] Reply sent successfully to ${conversationKey}`)
      } else {
        logger.channel.error(`[ChannelBridge] Reply failed: ${sendResult.error}`)
      }
    } catch (err) {
      logger.channel.error(`[ChannelBridge] Error processing message: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      this.processingMessages.delete(message.id)
    }
  }

  private forwardToRenderer(message: InboundMessage, conversationKey: string): void {
    const win = this.getMainWindow?.()
    if (!win || win.isDestroyed()) {
      logger.channel.warn('[ChannelBridge] No main window available, skipping renderer forward')
      return
    }

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

    logger.channel.info(`[ChannelBridge] Forwarded inbound message to renderer: ${conversationKey}`)
  }

  async sendReply(conversationKey: string, text: string): Promise<OutboundResult> {
    const conversation = this.activeConversations.get(conversationKey)
    if (!conversation) {
      logger.channel.error(`[ChannelBridge] No active conversation for key: ${conversationKey}`)
      return { success: false, error: 'No active conversation found for key: ' + conversationKey }
    }

    const outbound: OutboundMessage = {
      channelId: conversation.channelId as any,
      accountId: conversation.accountId,
      to: conversation.chatType === 'group' ? conversation.to : conversation.from,
      text,
      chatType: conversation.chatType as any,
    }

    logger.channel.info(`[ChannelBridge] Sending reply to ${conversation.channelId}, to=${outbound.to}, text=${text.slice(0, 50)}`)

    try {
      const result = await channelService.sendMessage(outbound)
      logger.channel.info(`[ChannelBridge] Reply result: success=${result.success}, error=${result.error || 'none'}`)
      return result
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.channel.error(`[ChannelBridge] Failed to send reply: ${msg}`)
      return { success: false, error: msg }
    }
  }
}

export const channelBridge = new ChannelBridge()
