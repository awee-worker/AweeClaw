import { BrowserWindow } from 'electron'
import { logger } from '@shared/utils/Logger'
import { channelService } from './ChannelService'
import { SyncService } from '../llm/services/SyncService'
import { resolveRuntimeLLMConfig } from '@shared/config/llmConfigResolver'
import type { InboundMessage, OutboundMessage, OutboundResult } from '@shared/types/channel'
import type { LLMConfig, LLMMessage } from '@shared/types'
import type Store from 'electron-store'

const CHANNEL_LABELS: Record<string, string> = {
  feishu: '飞书',
  wechat: '微信',
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  dingtalk: '钉钉',
  slack: 'Slack',
}

const REPLY_TIMEOUT_MS = 30_000

class ChannelBridge {
  private getMainWindow: (() => BrowserWindow | null) | null = null
  private activeConversations = new Map<string, { channelId: string; accountId: string; from: string; chatType: string; to: string }>()
  private syncService: SyncService
  private configStore: Store<Record<string, unknown>> | null = null
  private processingMessages = new Set<string>()
  private rendererReplies = new Map<string, { resolve: (text: string) => void; reject: (err: Error) => void }>()

  constructor() {
    this.syncService = new SyncService()
  }

  init(getMainWindow: () => BrowserWindow | null, configStore?: Store<Record<string, unknown>>): void {
    this.getMainWindow = getMainWindow
    this.configStore = configStore || null
    channelService.onInboundMessage(msg => this.handleInboundMessage(msg))
    logger.channel.info('[ChannelBridge] Initialized')
  }

  private getLLMConfig(): LLMConfig | null {
    if (!this.configStore) return null
    try {
      const appSettings = this.configStore.get('app-settings') as any
      if (!appSettings) return null
      const llmConfig = resolveRuntimeLLMConfig(appSettings.llmConfig, appSettings.providerConfigs || {})
      if (!llmConfig.apiKey) return null
      return llmConfig
    } catch (err) {
      logger.channel.error(`[ChannelBridge] Failed to resolve LLM config: ${err}`)
      return null
    }
  }

  private async handleInboundMessage(message: InboundMessage): Promise<void> {
    const conversationKey = `${message.channelId}:${message.chatType === 'group' ? message.to : message.from}`
    this.activeConversations.set(conversationKey, {
      channelId: message.channelId,
      accountId: message.accountId,
      from: message.from,
      chatType: message.chatType,
      to: message.to,
    })

    if (this.processingMessages.has(message.id)) return
    this.processingMessages.add(message.id)

    try {
      const win = this.getMainWindow?.()
      const rendererReady = win && !win.isDestroyed()

      if (rendererReady) {
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

        const replyText = await this.waitForRendererReply(message.id)
        if (replyText) {
          const result = await this.sendReply(conversationKey, replyText)
          if (!result.success) {
            logger.channel.error(`[ChannelBridge] Reply failed: ${result.error}`)
          }
          return
        }
      }

      await this.fallbackToMainProcess(message, conversationKey)
    } catch (err) {
      logger.channel.error(`[ChannelBridge] Error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      this.processingMessages.delete(message.id)
    }
  }

  private waitForRendererReply(messageId: string): Promise<string | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.rendererReplies.delete(messageId)
        resolve(null)
      }, REPLY_TIMEOUT_MS)

      this.rendererReplies.set(messageId, {
        resolve: (text: string) => {
          clearTimeout(timer)
          this.rendererReplies.delete(messageId)
          resolve(text)
        },
        reject: () => {
          clearTimeout(timer)
          this.rendererReplies.delete(messageId)
          resolve(null)
        },
      })
    })
  }

  receiveRendererReply(messageId: string, replyText: string): void {
    const pending = this.rendererReplies.get(messageId)
    if (pending) {
      pending.resolve(replyText)
    }
  }

  private async fallbackToMainProcess(message: InboundMessage, conversationKey: string): Promise<void> {
    const llmConfig = this.getLLMConfig()
    if (!llmConfig) {
      logger.channel.warn('[ChannelBridge] No LLM config, cannot process message')
      return
    }

    const channelLabel = CHANNEL_LABELS[message.channelId] || message.channelId
    const senderLabel = message.fromName || message.from

    const systemPrompt = `你是一个多渠道消息助手。当前消息来自${channelLabel}平台的用户${senderLabel}。请直接回复用户的问题，回复内容将被发送回${channelLabel}平台。回复时不需要包含平台标识和发送者名称，直接给出回答即可。`

    const messages: LLMMessage[] = [
      { role: 'user', content: message.text },
    ]

    try {
      const result = await this.syncService.generate({ config: llmConfig, messages, systemPrompt })
      const replyText = result.data?.trim()
      if (!replyText) {
        logger.channel.warn('[ChannelBridge] LLM returned empty response')
        return
      }

      const sendResult = await this.sendReply(conversationKey, replyText)
      if (!sendResult.success) {
        logger.channel.error(`[ChannelBridge] Reply failed: ${sendResult.error}`)
      }
    } catch (err) {
      logger.channel.error(`[ChannelBridge] Fallback LLM error: ${err instanceof Error ? err.message : String(err)}`)
    }
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
      return await channelService.sendMessage(outbound)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.channel.error(`[ChannelBridge] Failed to send reply: ${msg}`)
      return { success: false, error: msg }
    }
  }
}

export const channelBridge = new ChannelBridge()
